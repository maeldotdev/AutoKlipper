//! Turning a stream link into the address(es) FFmpeg can read. Platform links go through yt-dlp,
//! which only returns what the user's own access allows. Direct HLS and RTMP links are used as given.
use serde_json::Value;
use std::time::Duration;

use super::ytdlp::{self, YtDlp};
use crate::connectors;
use crate::error::{invalid, AppError, AppResult};

#[derive(Debug, Clone, PartialEq)]
pub struct LiveSource {
    pub connector: &'static str,
    pub title: String,
    /// The channel, for the credit line.
    pub uploader: Option<String>,
    /// One address, or two when the site serves picture and sound separately.
    pub urls: Vec<String>,
    /// Request headers FFmpeg must send, already formatted for `-headers`.
    pub headers: String,
}

pub const NOT_LIVE: &str = "This is not live right now. Monitoring needs a stream that is currently broadcasting.";

fn header_block(v: &Value) -> String {
    let Some(map) = v.as_object() else { return String::new() };
    map.iter()
        .filter_map(|(k, v)| {
            let v = v.as_str()?;
            // A header can never smuggle in another one.
            (!k.contains(['\r', '\n', ':']) && !v.contains(['\r', '\n'])).then(|| format!("{k}: {v}\r\n"))
        })
        .collect()
}

fn http_url(v: &Value) -> Option<String> {
    v.as_str().filter(|u| u.starts_with("http://") || u.starts_with("https://") || u.starts_with("rtmp")).map(String::from)
}

/// Pure: yt-dlp's JSON for a link into stream addresses.
pub fn parse(json: &Value, connector: &'static str) -> AppResult<LiveSource> {
    let live = json["is_live"] == true || json["live_status"] == "is_live";
    if !live {
        return invalid(NOT_LIVE);
    }
    let mut headers = header_block(&json["http_headers"]);
    let urls: Vec<String> = match json["requested_formats"].as_array() {
        Some(f) if !f.is_empty() => {
            if headers.is_empty() {
                headers = header_block(&f[0]["http_headers"]);
            }
            f.iter().filter_map(|x| http_url(&x["url"])).take(2).collect()
        }
        _ => http_url(&json["url"]).into_iter().collect(),
    };
    if urls.is_empty() {
        return invalid("The site did not give a stream address AutoKlipper can record.");
    }
    let title = json["title"].as_str().or_else(|| json["uploader"].as_str()).unwrap_or("Livestream").to_string();
    let uploader = json["uploader"].as_str().map(String::from);
    Ok(LiveSource { connector, title, uploader, urls, headers })
}

/// True for links FFmpeg can open without help.
pub fn is_direct(url: &url::Url) -> bool {
    matches!(url.scheme(), "rtmp" | "rtmps") || {
        let p = url.path().to_ascii_lowercase();
        p.ends_with(".m3u8") || p.ends_with(".mpd") || p.ends_with(".ts") || p.ends_with(".flv")
    }
}

pub fn explain(stderr: &str) -> String {
    let low = stderr.to_lowercase();
    if ["is not currently live", "is offline", "channel is offline", "not live", "this live event will begin"].iter().any(|n| low.contains(n)) {
        NOT_LIVE.into()
    } else {
        ytdlp::explain_error(stderr)
    }
}

pub fn resolve(raw: &str, tool: Option<&YtDlp>, cookie_browser: Option<&str>, max_height: u32) -> AppResult<LiveSource> {
    let url = connectors::parse_url(raw)?;
    let connector = connectors::all().iter().find(|c| c.matches(&url)).map(|c| c.info()).ok_or_else(|| AppError::Invalid("No connector handles this link.".into()))?;
    if connector.id == "generic" && is_direct(&url) {
        let title = url.host_str().unwrap_or("Livestream").to_string();
        return Ok(LiveSource { connector: connector.id, title, uploader: None, urls: vec![url.to_string()], headers: String::new() });
    }
    let tool = tool.ok_or_else(|| AppError::Invalid(ytdlp::NO_YTDLP.into()))?;
    let height = if max_height == 0 { 2160 } else { max_height };
    let mut args: Vec<String> = ["--dump-single-json", "--no-playlist", "--skip-download", "--no-warnings", "-f"].map(String::from).to_vec();
    args.push(format!("best[height<={height}]/bv*[height<={height}]+ba/best"));
    args.extend(ytdlp::cookie_args(cookie_browser)?);
    args.extend(["--".into(), url.to_string()]);
    let (stdout, stderr, ok) = ytdlp::run_capture(&tool.path, &args, Duration::from_secs(60))?;
    if !ok {
        return Err(AppError::Invalid(explain(&stderr)));
    }
    let json: Value = serde_json::from_str(stdout.trim()).map_err(|_| AppError::Invalid("yt-dlp returned something AutoKlipper could not read.".into()))?;
    parse(&json, connector.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn live_json_gives_one_url_with_headers() {
        let j = json!({"is_live": true, "title": "Night grind", "url": "https://cdn.example/live.m3u8",
                       "http_headers": {"User-Agent": "UA", "Referer": "https://x/", "Bad\r\nHeader": "x", "Also": "a\r\nb"}});
        let s = parse(&j, "twitch").unwrap();
        assert_eq!(s.urls, ["https://cdn.example/live.m3u8"]);
        assert!(s.headers.contains("User-Agent: UA\r\n") && s.headers.contains("Referer: https://x/\r\n"));
        assert!(!s.headers.contains("Bad") && !s.headers.contains("Also"), "header injection is dropped");
    }

    #[test]
    fn separate_video_and_audio_are_both_kept() {
        let j = json!({"live_status": "is_live", "requested_formats": [{"url": "https://v"}, {"url": "https://a"}]});
        assert_eq!(parse(&j, "youtube").unwrap().urls, ["https://v", "https://a"]);
    }

    #[test]
    fn a_recorded_video_or_odd_address_is_refused() {
        assert!(parse(&json!({"is_live": false, "url": "https://x"}), "youtube").unwrap_err().to_string().contains("not live"));
        assert!(parse(&json!({"is_live": true, "url": "file:///etc/passwd"}), "youtube").is_err());
        assert!(explain("ERROR: [twitch:stream] x: The channel is not currently live").contains("not live right now"));
    }

    #[test]
    fn direct_stream_links_need_no_tool() {
        for u in ["https://example.com/live/playlist.m3u8", "rtmp://live.example.com/app/key", "http://127.0.0.1:8000/live.m3u8"] {
            let s = resolve(u, None, None, 720).unwrap();
            assert_eq!(s.connector, "generic");
            assert_eq!(s.urls.len(), 1);
        }
        assert!(resolve("https://www.twitch.tv/somechannel", None, None, 720).unwrap_err().to_string().contains("yt-dlp"));
        assert!(resolve("file:///c:/x.m3u8", None, None, 720).is_err());
    }
}
