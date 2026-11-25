use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use super::ffmpeg::{self, exe, in_path};
use crate::connectors::{self, ConnectorInfo, UrlKind};
use crate::error::{invalid, AppError, AppResult};

/// yt-dlp is found the same way as FFmpeg and is never downloaded silently:
/// the `CLIPIT_YTDLP` variable (developers and tests), the path chosen in Settings, a `bin` folder next to the app,
/// every folder on PATH, then the WinGet links folder.
#[derive(Debug, Clone)]
pub struct YtDlp {
    pub path: PathBuf,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub found: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

fn version_of(p: &Path) -> Option<String> {
    let out = ffmpeg::command(p).arg("--version").output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string()).filter(|v| !v.is_empty())
}

pub fn locate(override_path: Option<&str>) -> Option<YtDlp> {
    let mut c: Vec<PathBuf> = Vec::new();
    if let Some(e) = std::env::var_os("CLIPIT_YTDLP") {
        c.push(PathBuf::from(e));
    }
    if let Some(o) = override_path.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(o);
        c.push(if p.is_dir() { p.join(exe("yt-dlp")) } else { p });
    }
    if let Some(dir) = std::env::current_exe().ok().and_then(|m| m.parent().map(Path::to_path_buf)) {
        c.push(dir.join("bin").join(exe("yt-dlp")));
    }
    c.extend(in_path("yt-dlp"));
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        c.push(PathBuf::from(local).join("Microsoft").join("WinGet").join("Links").join(exe("yt-dlp")));
    }
    c.into_iter().filter(|p| p.is_file()).find_map(|path| version_of(&path).map(|version| YtDlp { path, version }))
}

pub fn status(override_path: Option<&str>) -> ToolStatus {
    match locate(override_path) {
        Some(t) => ToolStatus { found: true, version: Some(t.version), path: Some(t.path.display().to_string()) },
        None => ToolStatus { found: false, version: None, path: None },
    }
}

/* ---------------- user-facing metadata ---------------- */

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UrlInfo {
    pub url: String,
    pub connector_id: &'static str,
    pub connector_name: &'static str,
    pub notice: &'static str,
    pub kind: UrlKind,
    pub title: String,
    pub duration_sec: Option<f64>,
    pub uploader: Option<String>,
    pub thumbnail: Option<String>,
    pub is_live: bool,
    pub extractor: Option<String>,
    /// Video heights offered by the site, ascending.
    pub heights: Vec<u32>,
    pub size_bytes_approx: Option<u64>,
    pub downloadable: bool,
    /// Why it cannot be downloaded, in words for the user.
    pub block_reason: Option<String>,
}

pub const NO_YTDLP: &str = "yt-dlp was not found. Install it (winget install yt-dlp.yt-dlp) or choose yt-dlp.exe in Settings, Processing.";

pub const LIVE_MESSAGE: &str = "This is a livestream. Add it on the Live Clipper page to monitor it, or paste a link to a recorded video or clip.";

/// Pure: yt-dlp's JSON into what the UI shows.
pub fn parse_info(json: &Value, c: &ConnectorInfo, url: &str) -> AppResult<UrlInfo> {
    if json["_type"] == "playlist" {
        return invalid("This link points to a playlist. Paste a link to one video.");
    }
    let live = json["is_live"] == true || matches!(json["live_status"].as_str(), Some("is_live" | "is_upcoming"));
    let mut heights: Vec<u32> = json["formats"]
        .as_array()
        .map(|f| f.iter().filter_map(|x| x["height"].as_u64()).map(|h| h as u32).collect())
        .unwrap_or_default();
    heights.sort_unstable();
    heights.dedup();
    let title = json["title"].as_str().filter(|t| !t.trim().is_empty()).unwrap_or("Untitled video").to_string();
    Ok(UrlInfo {
        url: url.to_string(),
        connector_id: c.id,
        connector_name: c.name,
        notice: c.notice,
        kind: if live { UrlKind::Live } else { UrlKind::Video },
        title,
        duration_sec: json["duration"].as_f64().filter(|d| *d > 0.0),
        uploader: json["uploader"].as_str().or_else(|| json["channel"].as_str()).map(String::from),
        thumbnail: json["thumbnail"].as_str().filter(|t| t.starts_with("https://")).map(String::from),
        is_live: live,
        extractor: json["extractor_key"].as_str().map(String::from),
        heights,
        size_bytes_approx: json["filesize_approx"].as_u64().or_else(|| json["filesize"].as_u64()),
        downloadable: !live,
        block_reason: live.then(|| LIVE_MESSAGE.to_string()),
    })
}

/// Turn yt-dlp's stderr into one sentence a person can act on.
pub fn explain_error(stderr: &str) -> String {
    let low = stderr.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|n| low.contains(n));
    let msg: &str = if has(&["cookie database", "failed to decrypt with dpapi"]) {
        // yt-dlp issue 7271: Chrome, Edge and Brave lock and encrypt their cookies on Windows.
        "Your browser did not let AutoKlipper read its sign-in. For a public video, set \"Use my browser's sign-in\" to Off in Settings, Processing. If the video needs your account, use Firefox."
    } else if has(&["not a bot","confirm you’re not a bot", "confirm you're not a bot"]) {
        "The site is asking for a sign-in check. Turn on \"Use my browser's sign-in\" in Settings, Processing, or try again later."
    } else if has(&["private video", "this video is private"]) {
        "This video is private. Only its owner can watch it. If you have access, sign in with your browser and turn on \"Use my browser's sign-in\" in Settings."
    } else if has(&["age-restricted", "confirm your age", "age restricted"]) {
        "This video is age-restricted. It needs your own signed-in account. Turn on \"Use my browser's sign-in\" in Settings, Processing."
    } else if has(&["members-only", "members only", "join this channel", "subscriber-only", "subscribers only"]) {
        "This video is only for members or subscribers. It can be used only if your own account has access."
    } else if has(&["not available in your country", "geo-restricted", "geo restricted", "blocked it in your country", "not made this video available in your country"]) {
        "This video is blocked in your region. AutoKlipper does not work around regional blocks."
    } else if has(&["drm"]) {
        "This video is protected by DRM and cannot be downloaded."
    } else if has(&["login required", "requires login", "you need to log in", "sign in", "log in", "cookies"]) {
        "This video needs you to be signed in. AutoKlipper does not sign in for you. You can turn on \"Use my browser's sign-in\" in Settings, Processing."
    } else if has(&["429", "too many requests", "rate limit", "rate-limit"]) {
        "The site is limiting requests. Wait a few minutes and try again."
    } else if has(&["unsupported url"]) {
        "This link is not supported. Try the direct page of a single video."
    } else if has(&["video unavailable", "this video is unavailable", "has been removed", "does not exist", "no longer available", "http error 404", "404: not found", "deleted"]) {
        "This video is unavailable. It may have been deleted, or the link is wrong."
    } else if has(&["http error 403", "403: forbidden", "forbidden"]) {
        "The site refused the request (HTTP 403). The video may need a sign-in, or yt-dlp may be out of date. Try updating yt-dlp."
    } else if has(&["unable to download webpage", "getaddrinfo", "timed out", "connection reset", "connection refused", "network is unreachable", "temporary failure in name resolution", "name or service not known", "no address associated"]) {
        "Could not reach the site. Check your internet connection and try again."
    } else if has(&["ffmpeg", "ffprobe"]) && has(&["not found", "not installed"]) {
        "yt-dlp could not find FFmpeg. Install FFmpeg or choose it in Settings, Processing."
    } else if has(&["no space left", "not enough space", "disk full"]) {
        "There is not enough free disk space for this download. Free some space and try again."
    } else {
        let last = stderr.lines().rev().find(|l| l.contains("ERROR")).or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty())).unwrap_or("");
        let clean: String = last.trim().trim_start_matches("ERROR:").trim().chars().take(280).collect();
        return if clean.is_empty() { "yt-dlp stopped without saying why.".into() } else { format!("yt-dlp said: {clean}") };
    };
    msg.to_string()
}

/* ---------------- arguments ---------------- */

const BROWSERS: &[&str] = &["chrome", "edge", "firefox", "brave", "opera", "vivaldi", "chromium"];

/// Opt-in only. Lets yt-dlp use the user's own browser sign-in for videos their account may watch.
pub fn cookie_args(browser: Option<&str>) -> AppResult<Vec<String>> {
    match browser.map(str::trim).filter(|b| !b.is_empty()) {
        None => Ok(vec![]),
        Some(b) if BROWSERS.contains(&b) => Ok(vec!["--cookies-from-browser".into(), b.into()]),
        Some(b) => invalid(format!("Unknown browser \"{b}\" for sign-in. Choose one from the list in Settings.")),
    }
}

pub fn probe_args(url: &str, extra: &[String], cookies: &[String]) -> Vec<String> {
    let mut a: Vec<String> = ["--dump-single-json", "--no-playlist", "--skip-download", "--no-warnings"].map(String::from).to_vec();
    a.extend(extra.iter().cloned());
    a.extend(cookies.iter().cloned());
    a.extend(["--".into(), url.into()]); // `--` stops a hostile link from being read as an option
    a
}

pub fn format_selector(max_height: u32) -> String {
    if max_height == 0 {
        "bv*+ba/b".into()
    } else {
        format!("bv*[height<={max_height}]+ba/b[height<={max_height}]/bv*+ba/b")
    }
}

pub const PROGRESS_PREFIX: &str = "CLIPIT_PROGRESS";

pub fn download_args(url: &str, dir: &Path, stem: &str, max_height: u32, ffmpeg_dir: &Path, extra: &[String], cookies: &[String]) -> Vec<String> {
    let mut a: Vec<String> = ["--no-playlist", "--no-warnings", "--newline", "--progress", "--no-mtime", "--progress-template"].map(String::from).to_vec();
    a.push(format!("download:{PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s"));
    a.extend(["-f".into(), format_selector(max_height), "--merge-output-format".into(), "mp4".into()]);
    a.extend(["--ffmpeg-location".into(), ffmpeg_dir.display().to_string()]);
    a.extend(["-o".into(), dir.join(format!("{stem}.%(ext)s")).display().to_string()]);
    a.extend(extra.iter().cloned());
    a.extend(cookies.iter().cloned());
    a.extend(["--".into(), url.into()]);
    a
}

/// Percent from one `CLIPIT_PROGRESS downloaded total estimate` line.
pub fn parse_progress(line: &str) -> Option<f64> {
    let rest = line.trim().strip_prefix(PROGRESS_PREFIX)?;
    let n: Vec<Option<f64>> = rest.split_whitespace().map(|t| t.parse::<f64>().ok()).collect();
    let done = (*n.first()?)?;
    let total = n.get(1).copied().flatten().or(n.get(2).copied().flatten()).filter(|t| *t > 0.0)?;
    Some((done / total * 100.0).clamp(0.0, 99.0))
}

/// The finished file for a download: the largest `<stem>.*` that is not a partial or fragment file.
pub fn find_output(dir: &Path, stem: &str) -> Option<PathBuf> {
    let prefix = format!("{stem}.");
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            n.starts_with(&prefix) && !n.ends_with(".part") && !n.ends_with(".ytdl") && !n.ends_with(".temp") && !n[prefix.len()..].starts_with('f')
        })
        .filter_map(|e| e.metadata().ok().filter(|m| m.is_file() && m.len() > 0).map(|m| (m.len(), e.path())))
        .max_by_key(|(len, _)| *len)
        .map(|(_, p)| p)
}

/// Remove everything a download left behind: partial files, fragments, the half-merged file.
pub fn cleanup(dir: &Path, stem: &str) {
    let prefix = format!("{stem}.");
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/* ---------------- looking a link up ---------------- */

fn read_all(mut r: impl Read + Send + 'static) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = r.read_to_end(&mut b);
        String::from_utf8_lossy(&b).into_owned()
    })
}

/// Run to completion with a time limit. Returns (stdout, stderr, success).
pub fn run_capture(exe: &Path, args: &[String], timeout: Duration) -> AppResult<(String, String, bool)> {
    let mut child = ffmpeg::command(exe)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Invalid(format!("Could not start yt-dlp: {e}")))?;
    let out = read_all(child.stdout.take().expect("piped stdout"));
    let err = read_all(child.stderr.take().expect("piped stderr"));
    let start = Instant::now();
    let ok = loop {
        match child.try_wait()? {
            Some(s) => break s.success(),
            None if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return invalid("The site took too long to answer. Check your connection and try again.");
            }
            None => std::thread::sleep(Duration::from_millis(40)),
        }
    };
    Ok((out.join().unwrap_or_default(), err.join().unwrap_or_default(), ok))
}

/// Look up a link without downloading anything. Livestream and channel links are answered without contacting the site.
pub fn probe_url(tool: Option<&YtDlp>, raw: &str, cookie_browser: Option<&str>) -> AppResult<UrlInfo> {
    let (conn, url, kind) = connectors::detect(raw)?;
    let info = conn.info();
    let u = url.to_string();
    if kind == UrlKind::Live {
        return Ok(UrlInfo {
            url: u,
            connector_id: info.id,
            connector_name: info.name,
            notice: info.notice,
            kind,
            title: url.host_str().unwrap_or("Livestream").to_string(),
            duration_sec: None,
            uploader: None,
            thumbnail: None,
            is_live: true,
            extractor: None,
            heights: vec![],
            size_bytes_approx: None,
            downloadable: false,
            block_reason: Some(LIVE_MESSAGE.into()),
        });
    }
    let tool = tool.ok_or_else(|| AppError::Invalid(NO_YTDLP.into()))?;
    let args = probe_args(&u, &conn.extra_args(), &cookie_args(cookie_browser)?);
    let (stdout, stderr, ok) = run_capture(&tool.path, &args, Duration::from_secs(60))?;
    if !ok {
        return Err(AppError::Invalid(explain_error(&stderr)));
    }
    let json: Value = serde_json::from_str(stdout.trim()).map_err(|_| AppError::Invalid("yt-dlp returned something AutoKlipper could not read. Try updating yt-dlp.".into()))?;
    parse_info(&json, &info, &u)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conn() -> ConnectorInfo {
        connectors::all()[0].info()
    }

    #[test]
    fn parses_video_metadata() {
        let j = json!({"title": "Big Buck Bunny", "duration": 597, "uploader": "Blender", "thumbnail": "https://i.ytimg.com/x.jpg",
                       "extractor_key": "Youtube", "filesize_approx": 123456, "is_live": false,
                       "formats": [{"height": 1080}, {"height": 360}, {"height": 1080}, {"height": null}, {}]});
        let i = parse_info(&j, &conn(), "https://youtu.be/x").unwrap();
        assert_eq!((i.title.as_str(), i.duration_sec, i.heights.clone()), ("Big Buck Bunny", Some(597.0), vec![360, 1080]));
        assert!(i.downloadable && !i.is_live && i.block_reason.is_none());
        assert_eq!(i.size_bytes_approx, Some(123456));
    }

    #[test]
    fn live_and_upcoming_are_not_downloadable() {
        for j in [json!({"title": "x", "is_live": true}), json!({"title": "x", "live_status": "is_upcoming"})] {
            let i = parse_info(&j, &conn(), "u").unwrap();
            assert!(i.is_live && !i.downloadable);
            assert!(i.block_reason.unwrap().contains("Live Clipper"));
        }
    }

    #[test]
    fn playlists_are_refused_and_odd_data_is_tolerated() {
        assert!(parse_info(&json!({"_type": "playlist"}), &conn(), "u").is_err());
        let i = parse_info(&json!({}), &conn(), "u").unwrap();
        assert_eq!(i.title, "Untitled video");
        assert_eq!(i.duration_sec, None);
        // a non-https thumbnail is dropped
        assert_eq!(parse_info(&json!({"thumbnail": "http://x/y.jpg"}), &conn(), "u").unwrap().thumbnail, None);
    }

    #[test]
    fn errors_become_plain_advice() {
        let cases = [
            ("ERROR: [youtube] x: Private video. Sign in if you've been granted access", "private"),
            ("ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate", "age-restricted"),
            ("ERROR: [youtube] x: Join this channel to get access to members-only content", "members or subscribers"),
            ("ERROR: [youtube] x: The uploader has not made this video available in your country", "region"),
            ("ERROR: [youtube] x: This video is DRM protected", "DRM"),
            ("ERROR: [youtube] x: Sign in to confirm you're not a bot", "sign-in check"),
            ("ERROR: [facebook] x: Cannot parse data; login required", "signed in"),
            ("ERROR: unable to download video data: HTTP Error 429: Too Many Requests", "limiting requests"),
            ("ERROR: unable to download video data: HTTP Error 403: Forbidden", "HTTP 403"),
            ("ERROR: Unsupported URL: https://example.com/page", "not supported"),
            ("ERROR: [youtube] aaaaaaaaaaa: This video is unavailable", "unavailable"),
            ("ERROR: [generic] Unable to download webpage: <urlopen error [Errno 11001] getaddrinfo failed>", "internet connection"),
        ];
        for (stderr, want) in cases {
            let m = explain_error(stderr);
            assert!(m.contains(want), "{stderr} -> {m}");
        }
        assert!(explain_error("ERROR: something odd happened\n").starts_with("yt-dlp said: something odd happened"));
        for e in ["ERROR: Could not copy Chrome cookie database. See https://github.com/yt-dlp/yt-dlp/issues/7271 for more info", "ERROR: Failed to decrypt with DPAPI."] {
            assert!(explain_error(e).contains("to Off"), "{e}");
        }
        assert_eq!(explain_error(""), "yt-dlp stopped without saying why.");
    }

    #[test]
    fn cookies_are_opt_in_and_whitelisted() {
        assert!(cookie_args(None).unwrap().is_empty());
        assert!(cookie_args(Some("")).unwrap().is_empty());
        assert_eq!(cookie_args(Some("firefox")).unwrap(), ["--cookies-from-browser", "firefox"]);
        assert!(cookie_args(Some("chrome:Profile 1 --exec calc")).is_err());
    }

    #[test]
    fn urls_are_always_after_the_option_terminator() {
        let a = probe_args("https://x/y", &[], &[]);
        assert_eq!(&a[a.len() - 2..], ["--", "https://x/y"]);
        let d = download_args("--exec calc", Path::new("C:/d"), "job1", 1080, Path::new("C:/ff"), &[], &[]);
        let i = d.iter().position(|x| x == "--").unwrap();
        assert_eq!(d[i + 1], "--exec calc", "hostile input stays a plain argument");
        assert!(d.contains(&"--ffmpeg-location".to_string()));
        assert!(d.iter().any(|x| x.ends_with("job1.%(ext)s")));
    }

    #[test]
    fn format_selector_caps_height() {
        assert_eq!(format_selector(720), "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b");
        assert_eq!(format_selector(0), "bv*+ba/b");
    }

    #[test]
    fn progress_lines_parse() {
        assert_eq!(parse_progress("CLIPIT_PROGRESS 500 1000 NA"), Some(50.0));
        assert_eq!(parse_progress("CLIPIT_PROGRESS 250 NA 1000"), Some(25.0));
        assert_eq!(parse_progress("CLIPIT_PROGRESS 1000 1000 NA"), Some(99.0));
        assert_eq!(parse_progress("CLIPIT_PROGRESS NA NA NA"), None);
        assert_eq!(parse_progress("[info] something else"), None);
    }

    #[test]
    fn output_finder_ignores_partials_and_fragments() {
        let d = std::env::temp_dir().join(format!("clipit-dl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("job1.mp4.part"), vec![0; 900]).unwrap();
        std::fs::write(d.join("job1.f137.mp4"), vec![0; 800]).unwrap();
        std::fs::write(d.join("job1.mp4"), vec![0; 100]).unwrap();
        std::fs::write(d.join("job2.mp4"), vec![0; 999]).unwrap();
        assert_eq!(find_output(&d, "job1").unwrap().file_name().unwrap(), "job1.mp4");
        cleanup(&d, "job1");
        assert!(find_output(&d, "job1").is_none());
        assert!(d.join("job2.mp4").exists(), "other jobs are untouched");
    }

    /* ---- real yt-dlp. Skipped when it is not installed or the network is down. ---- */

    fn real() -> Option<YtDlp> {
        let t = locate(None);
        if t.is_none() {
            eprintln!("SKIPPED: yt-dlp not installed");
        }
        t
    }
    fn offline(msg: &str) -> bool {
        let off = msg.contains("internet connection");
        if off {
            eprintln!("SKIPPED: no network");
        }
        off
    }

    #[test]
    fn real_probe_reads_a_public_youtube_video_without_downloading_it() {
        let Some(t) = real() else { return };
        match probe_url(Some(&t), "https://www.youtube.com/watch?v=YE7VzlLtp-4&list=PLxyz", None) {
            Ok(i) => {
                assert_eq!(i.connector_id, "youtube");
                assert_eq!(i.title, "Big Buck Bunny");
                assert!(i.duration_sec.unwrap() > 500.0);
                assert!(i.heights.contains(&720));
                assert!(i.downloadable && !i.is_live);
            }
            Err(e) if offline(&e.to_string()) => {}
            Err(e) => panic!("{e}"),
        }
    }

    #[test]
    fn real_probe_explains_a_missing_video() {
        let Some(t) = real() else { return };
        match probe_url(Some(&t), "https://www.youtube.com/watch?v=aaaaaaaaaaa", None) {
            Err(e) if offline(&e.to_string()) => {}
            Err(e) => assert!(e.to_string().contains("unavailable"), "{e}"),
            Ok(_) => panic!("a bad id must not succeed"),
        }
    }

    #[test]
    fn live_links_are_answered_without_yt_dlp_or_network() {
        let i = probe_url(None, "https://www.twitch.tv/somechannel", None).unwrap();
        assert!(i.is_live && !i.downloadable && i.kind == UrlKind::Live);
        assert!(i.block_reason.unwrap().contains("Live Clipper"));
        // a recorded video does need the tool
        assert!(probe_url(None, "https://youtu.be/abc", None).unwrap_err().to_string().contains("yt-dlp was not found"));
        // channel links are refused before anything runs
        assert!(probe_url(None, "https://www.youtube.com/@blender", None).is_err());
    }

    #[test]
    fn real_download_of_a_direct_mp4_produces_a_playable_file() {
        use crate::media::{ffmpeg, probe, process};
        let (Some(t), Some(tools)) = (real(), ffmpeg::locate(None)) else {
            eprintln!("SKIPPED: yt-dlp or FFmpeg missing");
            return;
        };
        let dir = std::env::temp_dir().join(format!("clipit-dl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let url = "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4";
        let (conn, u, kind) = connectors::detect(url).unwrap();
        assert_eq!((conn.info().id, kind), ("generic", UrlKind::Video));
        let args = download_args(u.as_str(), &dir, "job1", 720, tools.ffmpeg.parent().unwrap(), &conn.extra_args(), &[]);
        let running = process::Running::default();
        let mut last = None;
        let out = process::run_lines(&t.path, &args, &running, |l| {
            if let Some(p) = parse_progress(l) {
                last = Some(p);
            }
        })
        .unwrap();
        match out {
            process::Outcome::Done => {}
            process::Outcome::Failed(e) if offline(&explain_error(&e)) => return,
            process::Outcome::Failed(e) => panic!("{}", explain_error(&e)),
            process::Outcome::Cancelled => panic!("not cancelled"),
        }
        let f = find_output(&dir, "job1").expect("a finished file");
        let info = probe::probe(&tools, &f).unwrap();
        assert!(info.width > 0 && (info.duration_sec - 10.0).abs() < 1.0, "{info:?}");
        assert!(last.is_some(), "progress should have been reported");
        cleanup(&dir, "job1");
        assert!(find_output(&dir, "job1").is_none());
    }

    #[test]
    fn real_download_can_be_cancelled_and_leaves_nothing() {
        use crate::media::{ffmpeg, process};
        let (Some(t), Some(tools)) = (real(), ffmpeg::locate(None)) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-dl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let args = download_args("https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_30MB.mp4", &dir, "job2", 1080, tools.ffmpeg.parent().unwrap(), &[], &[]);
        let running = std::sync::Arc::new(process::Running::default());
        let r2 = running.clone();
        let stopper = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(900));
            r2.cancel();
        });
        let out = process::run_lines(&t.path, &args, &running, |_| {}).unwrap();
        stopper.join().unwrap();
        match out {
            process::Outcome::Cancelled => {}
            process::Outcome::Done => eprintln!("download finished before the cancel; nothing to check"),
            process::Outcome::Failed(e) if offline(&explain_error(&e)) => return,
            process::Outcome::Failed(e) => panic!("{}", explain_error(&e)),
        }
        cleanup(&dir, "job2");
        assert!(std::fs::read_dir(&dir).unwrap().next().is_none(), "no leftovers after cleanup");
    }
}
