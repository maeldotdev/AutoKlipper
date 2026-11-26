use serde::Deserialize;
use std::path::Path;

use super::process::{self, Outcome};
use crate::db::models::{Filters, Split};
use crate::error::{invalid, AppResult};

pub use super::process::Running;

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Fast,
    Balanced,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Encoder {
    X264,
    Nvenc,
    Amf,
    Qsv,
}

#[derive(Debug, Clone)]
pub struct RenderOptions {
    /// Short side in pixels: 480, 720 or 1080.
    pub resolution: u32,
    pub fps: u32,
    pub quality: Quality,
    pub encoder: Encoder,
    /// 0 = left edge, 100 = right edge, applied when the source is wider than the target.
    pub crop_x: f64,
    /// 1.0 = no zoom.
    pub zoom: f64,
    /// An expression in `t` giving the position 0..1. Replaces `crop_x` when a face path exists.
    pub x_expr: Option<String>,
    /// Game on top, camera below.
    pub split: Option<Split>,
    /// Parts to remove, in seconds from the start of the clip.
    pub cuts: Vec<[f64; 2]>,
    pub filters: Filters,
    /// Sound effects to mix in: file, start in the finished clip, volume.
    pub sounds: Vec<(std::path::PathBuf, f64, f64)>,
    /// Only matters with sound effects: a silent video needs an empty track under them.
    pub has_audio: bool,
}

/// The longest any one effect plays.
const SOUND_SECONDS: f64 = 6.0;

/// Speech (or silence) with each effect delayed to its moment and laid over it.
fn mix_graph(video: &str, speech_filters: &[String], o: &RenderOptions, length: f64) -> String {
    let mut speech: Vec<String> = speech_filters.to_vec();
    speech.push("aresample=48000".into());
    let speech = if o.has_audio { format!("[0:a]{}[a0]", speech.join(",")) } else { format!("anullsrc=r=48000:cl=stereo,atrim=0:{length:.3}[a0]") };
    let mut parts = vec![format!("[0:v]{video}[v]"), speech];
    let mut inputs = String::from("[a0]");
    for (i, (_, at, volume)) in o.sounds.iter().enumerate() {
        parts.push(format!(
            "[{n}:a]atrim=0:{SOUND_SECONDS},asetpts=PTS-STARTPTS,aresample=48000,volume={volume:.2},adelay={ms}:all=1[s{i}]",
            n = i + 1,
            ms = (at.max(0.0) * 1000.0).round() as u64
        ));
        inputs.push_str(&format!("[s{i}]"));
    }
    parts.push(format!("{inputs}amix=inputs={}:duration=first:normalize=0[a]", o.sounds.len() + 1));
    parts.join(";")
}

impl RenderOptions {
    pub fn validate(&self) -> AppResult<()> {
        if ![360, 480, 720, 1080, 1440].contains(&self.resolution) {
            return invalid("Resolution must be 480, 720 or 1080.");
        }
        if ![24, 25, 30, 50, 60].contains(&self.fps) {
            return invalid("Frame rate must be 24, 30 or 60.");
        }
        if !(0.0..=100.0).contains(&self.crop_x) || !(1.0..=3.0).contains(&self.zoom) {
            return invalid("Crop position must be 0 to 100 and zoom 1 to 3.");
        }
        Ok(())
    }
}

/// Nearest even number: H.264 with 4:2:0 needs even sizes.
fn even(n: f64) -> u32 {
    ((n / 2.0).round() as u32) * 2
}

/// Output pixel size for an aspect ratio, where `short` is the shorter side.
pub fn target_size(aspect: &str, short: u32) -> AppResult<(u32, u32)> {
    let s = short as f64;
    Ok(match aspect {
        "9:16" => (even(s), even(s * 16.0 / 9.0)),
        "1:1" => (even(s), even(s)),
        "4:5" => (even(s), even(s * 5.0 / 4.0)),
        "16:9" => (even(s * 16.0 / 9.0), even(s)),
        other => return invalid(format!("Unknown aspect ratio {other}")),
    })
}

/// Output heights of the game (top) and camera (bottom) halves of a gaming layout.
pub fn split_heights(height: u32, share: f64) -> (u32, u32) {
    let face = even(height as f64 * share);
    (height - face, face)
}

/// Game cropped to its half (positioned by `crop_x`, narrowed by `zoom`) stacked above the camera box.
fn split_graph(w: u32, h: u32, s: &Split, o: &RenderOptions) -> String {
    let (game, face) = split_heights(h, s.share);
    let r = w as f64 / game as f64;
    let p = o.crop_x / 100.0;
    format!(
        "split=2[g0][c0];\
         [g0]crop=w='min(iw,ih*{r:.6})/{z:.4}':h='min(ih,iw/{r:.6})/{z:.4}':x='(iw-out_w)*{p:.4}':y='(ih-out_h)*{gy:.4}',scale={w}:{game}:flags=lanczos,setsar=1[g];\
         [c0]crop=w='iw*{cw:.6}':h='ih*{ch:.6}':x='iw*{cx:.6}':y='ih*{cy:.6}',scale={w}:{face}:force_original_aspect_ratio=increase:flags=lanczos,crop={w}:{face},setsar=1[c];\
         {stack}vstack,fps={fps},format=yuv420p",
        stack = if s.top { "[c][g]" } else { "[g][c]" }, z = o.zoom, gy = s.gy, cx = s.x, cy = s.y, cw = s.w, ch = s.h, fps = o.fps
    )
}

/// Crop the source to the target shape (positioned by `crop_x`, narrowed by `zoom`), then scale.
pub fn filter_graph(aspect: &str, o: &RenderOptions) -> AppResult<String> {
    let (w, h) = target_size(aspect, o.resolution)?;
    if let Some(s) = o.split.filter(|_| aspect == "9:16") {
        return Ok(split_graph(w, h, &s, o));
    }
    let r = w as f64 / h as f64;
    let z = o.zoom;
    let p = o.x_expr.clone().unwrap_or_else(|| format!("{:.4}", o.crop_x / 100.0));
    Ok(format!(
        "crop=w='min(iw,ih*{r:.6})/{z:.4}':h='min(ih,iw/{r:.6})/{z:.4}':x='(iw-out_w)*({p})':y='(ih-out_h)/2',\
         scale={w}:{h}:flags=lanczos,setsar=1,fps={fps},format=yuv420p",
        fps = o.fps
    ))
}

/// Picture filters, applied to the framed video before captions are drawn on it.
pub fn video_filters(f: &Filters) -> Vec<String> {
    let s = f.strength.clamp(0.0, 1.0);
    let mut out = Vec::new();
    if f.denoise {
        out.push("hqdn3d=3:2:4:3".to_string());
    }
    match f.look.as_str() {
        "brighten" => out.push(format!("eq=brightness={:.3}:contrast={:.3}:gamma={:.3}", 0.05 * s, 1.0 + 0.08 * s, 1.0 + 0.2 * s)),
        "vivid" => out.push(format!("eq=contrast={:.3}:saturation={:.3}", 1.0 + 0.18 * s, 1.0 + 0.55 * s)),
        "warm" | "cool" => {
            let t = if f.look == "warm" { s } else { -s };
            out.push(format!("colorbalance=rm={:.3}:bm={:.3}:rh={:.3}:bh={:.3}", 0.2 * t, -0.2 * t, 0.1 * t, -0.1 * t));
        }
        "mono" => out.push(format!("hue=s={:.3},eq=contrast={:.3}", 1.0 - s, 1.0 + 0.1 * s)),
        _ => {}
    }
    if f.sharpen {
        out.push("unsharp=5:5:0.9:5:5:0.0".to_string());
    }
    out
}

/// Clearer voice: cut rumble, reduce hiss, then even out the loudness.
fn voice_filters(f: &Filters) -> Option<&'static str> {
    f.voice.then_some("highpass=f=90,afftdn=nf=-25,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000")
}

/// `captions` is the file name of an ASS file in the working folder, drawn after scaling.
pub fn build_args(input: &Path, start: f64, duration: f64, output: &Path, aspect: &str, o: &RenderOptions, captions: Option<&str>) -> AppResult<Vec<String>> {
    o.validate()?;
    if duration <= 0.0 || start < 0.0 {
        return invalid("Clip start and length must be positive.");
    }
    let mut a: Vec<String> = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-progress", "pipe:1", "-nostats"]
        .iter().map(|s| s.to_string()).collect();
    // -ss before -i seeks fast; re-encoding below keeps the cut frame accurate.
    let (seek, source, length) = (format!("{start:.3}"), input.display().to_string(), format!("{duration:.3}"));
    let mut graph = filter_graph(aspect, o)?;
    let mut audio: Vec<String> = Vec::new();
    if o.cuts.is_empty() && o.sounds.is_empty() {
        a.extend(["-ss".into(), seek, "-i".into(), source, "-t".into(), length]);
    } else {
        // Limit what is read (the output is shorter, or more inputs follow).
        a.extend(["-ss".into(), seek, "-t".into(), length, "-i".into(), source]);
    }
    if !o.cuts.is_empty() {
        // Drop the cut parts and close the gaps.
        let keep = super::cuts::keep_expr(&o.cuts);
        graph = format!("fps={},select='{keep}',setpts=N/FRAME_RATE/TB,{graph}", o.fps);
        audio.push(format!("aselect='{keep}',asetpts=N/SR/TB"));
    }
    audio.extend(voice_filters(&o.filters).map(String::from));
    for (file, _, _) in &o.sounds {
        a.extend(["-i".into(), file.display().to_string()]);
    }
    if o.sounds.is_empty() && !audio.is_empty() {
        a.extend(["-af".into(), audio.join(",")]);
    }
    let picture = video_filters(&o.filters);
    if !picture.is_empty() {
        graph.push_str(&format!(",{},format=yuv420p", picture.join(",")));
    }
    if let Some(name) = captions {
        if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.') {
            return invalid("Unsafe caption file name.");
        }
        graph.push_str(&format!(",ass={name}"));
    }
    if o.sounds.is_empty() {
        a.extend(["-vf".into(), graph]);
    } else {
        let out = super::cuts::remap(&o.cuts, duration);
        a.extend(["-filter_complex".into(), mix_graph(&graph, &audio, o, out)]);
        a.extend(["-map", "[v]", "-map", "[a]", "-t"].map(String::from));
        a.push(format!("{out:.3}"));
    }
    let (crf, preset, cq) = match o.quality {
        Quality::Fast => ("26", "veryfast", "28"),
        Quality::Balanced => ("23", "medium", "24"),
        Quality::High => ("19", "slow", "20"),
    };
    match o.encoder {
        Encoder::X264 => a.extend(["-c:v", "libx264", "-preset", preset, "-crf", crf].map(String::from)),
        Encoder::Nvenc => a.extend(["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", cq, "-b:v", "0"].map(String::from)),
        Encoder::Amf => a.extend(["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", cq, "-qp_p", cq].map(String::from)),
        Encoder::Qsv => a.extend(["-c:v", "h264_qsv", "-global_quality", cq].map(String::from)),
    }
    a.extend(["-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"].map(String::from));
    a.push(output.display().to_string());
    Ok(a)
}

/// Seconds encoded so far from one line of `-progress` output.
pub fn parse_progress_line(line: &str) -> Option<f64> {
    let v = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms="))?;
    v.trim().parse::<f64>().ok().filter(|us| *us >= 0.0).map(|us| us / 1_000_000.0)
}

/// Run FFmpeg to completion. `on_progress` receives 0..=100. Err carries a message fit for the UI.
#[cfg(test)]
pub fn run(ffmpeg_exe: &Path, args: &[String], duration: f64, running: &Running, on_progress: impl FnMut(f64)) -> Result<(), String> {
    run_in(None, ffmpeg_exe, args, duration, running, on_progress)
}

pub fn run_in(cwd: Option<&Path>, ffmpeg_exe: &Path, args: &[String], duration: f64, running: &Running, mut on_progress: impl FnMut(f64)) -> Result<(), String> {
    let outcome = process::run_lines_in(cwd, ffmpeg_exe, args, running, |line| {
        if let Some(sec) = parse_progress_line(line) {
            on_progress((sec / duration * 100.0).clamp(0.0, 99.0));
        }
    })?;
    match outcome {
        Outcome::Done => Ok(()),
        Outcome::Cancelled => Err("Cancelled".into()),
        Outcome::Failed(stderr) => {
            let tail: Vec<&str> = stderr.lines().rev().take(3).collect();
            let msg = tail.into_iter().rev().collect::<Vec<_>>().join(" ");
            Err(if msg.is_empty() { "FFmpeg stopped without finishing the file.".into() } else { format!("FFmpeg failed: {msg}") })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::{ffmpeg as ff, probe};
    use std::path::PathBuf;

    fn opts() -> RenderOptions {
        RenderOptions { resolution: 1080, fps: 30, quality: Quality::Balanced, encoder: Encoder::X264, crop_x: 50.0, zoom: 1.0, x_expr: None, split: None, cuts: Vec::new(), filters: Filters::default(), sounds: Vec::new(), has_audio: true }
    }

    #[test]
    fn target_sizes_are_even_and_correct() {
        assert_eq!(target_size("9:16", 1080).unwrap(), (1080, 1920));
        assert_eq!(target_size("9:16", 720).unwrap(), (720, 1280));
        assert_eq!(target_size("1:1", 1080).unwrap(), (1080, 1080));
        assert_eq!(target_size("4:5", 1080).unwrap(), (1080, 1350));
        assert_eq!(target_size("16:9", 1080).unwrap(), (1920, 1080));
        assert_eq!(target_size("9:16", 480).unwrap(), (480, 854));
        assert!(target_size("2:1", 1080).is_err());
    }

    #[test]
    fn filter_graph_crops_then_scales() {
        let g = filter_graph("9:16", &opts()).unwrap();
        assert!(g.starts_with("crop=w='min(iw,ih*0.562500)/1.0000'"), "{g}");
        assert!(g.contains("x='(iw-out_w)*(0.5000)'"));
        assert!(g.contains("scale=1080:1920"));
        assert!(g.ends_with("fps=30,format=yuv420p"));
    }

    #[test]
    fn args_place_seek_before_input_and_validate() {
        let a = build_args(Path::new("in.mp4"), 12.5, 30.0, Path::new("out.mp4"), "9:16", &opts(), None).unwrap();
        let ss = a.iter().position(|x| x == "-ss").unwrap();
        let i = a.iter().position(|x| x == "-i").unwrap();
        assert!(ss < i);
        assert_eq!(a[ss + 1], "12.500");
        assert_eq!(a.last().unwrap(), "out.mp4");
        assert!(a.contains(&"libx264".to_string()));
        let mut bad = opts();
        bad.zoom = 9.0;
        assert!(build_args(Path::new("in.mp4"), 0.0, 5.0, Path::new("o.mp4"), "9:16", &bad, None).is_err());
        assert!(build_args(Path::new("in.mp4"), 0.0, 0.0, Path::new("o.mp4"), "9:16", &opts(), None).is_err());
    }

    #[test]
    fn hardware_encoder_args() {
        let mut o = opts();
        o.encoder = Encoder::Nvenc;
        let a = build_args(Path::new("i"), 0.0, 5.0, Path::new("o"), "1:1", &o, None).unwrap();
        assert!(a.contains(&"h264_nvenc".to_string()));
        assert!(!a.contains(&"libx264".to_string()));
    }

    #[test]
    fn progress_lines_parse() {
        assert_eq!(parse_progress_line("out_time_us=1500000"), Some(1.5));
        assert_eq!(parse_progress_line("out_time_ms=2000000"), Some(2.0));
        assert_eq!(parse_progress_line("progress=continue"), None);
        assert_eq!(parse_progress_line("out_time_us=N/A"), None);
    }

    /// End to end with the real FFmpeg: make a 16:9 test video, cut and reframe it to 9:16, probe the result.
    /// Skipped (with a message) on machines without FFmpeg.
    #[test]
    fn real_ffmpeg_cuts_and_reframes_to_vertical() {
        let Some(tools) = ff::locate(None) else {
            eprintln!("SKIPPED: FFmpeg not installed");
            return;
        };
        let dir: PathBuf = std::env::temp_dir().join(format!("clipit-render-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        let made = ff::command(&tools.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "8", "-pix_fmt", "yuv420p"])
            .arg(&src)
            .status()
            .unwrap();
        assert!(made.success());

        let info = probe::probe(&tools, &src).unwrap();
        assert_eq!((info.width, info.height), (1280, 720));
        assert!(info.has_audio);
        assert!((info.duration_sec - 8.0).abs() < 0.3, "{}", info.duration_sec);

        let out = dir.join("clip.mp4");
        let mut o = opts();
        o.resolution = 720;
        let args = build_args(&src, 2.0, 3.0, &out, "9:16", &o, None).unwrap();
        let running = Running::default();
        let mut last = 0.0;
        run(&tools.ffmpeg, &args, 3.0, &running, |p| last = p).unwrap();
        assert!(last > 0.0, "progress should have been reported");

        let res = probe::probe(&tools, &out).unwrap();
        assert_eq!((res.width, res.height), (720, 1280));
        assert!((res.duration_sec - 3.0).abs() < 0.3, "cut length was {}", res.duration_sec);
        assert!(res.has_audio);
        assert_eq!(res.video_codec, "h264");
    }

    /// Every look, with sharpen, noise, voice and a cut together, must be accepted by the real FFmpeg.
    #[test]
    fn real_ffmpeg_accepts_every_filter() {
        let Some(tools) = ff::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-filter-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        assert!(ff::command(&tools.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "4", "-pix_fmt", "yuv420p"])
            .arg(&src)
            .status()
            .unwrap()
            .success());
        for look in crate::db::models::LOOKS {
            let mut o = opts();
            o.resolution = 360;
            o.filters = Filters { look: look.to_string(), strength: 1.0, sharpen: true, denoise: true, voice: true };
            o.cuts = vec![[1.0, 1.5]];
            let out = dir.join(format!("{look}.mp4"));
            let args = build_args(&src, 0.0, 3.0, &out, "9:16", &o, None).unwrap();
            run(&tools.ffmpeg, &args, 3.0, &Running::default(), |_| {}).unwrap_or_else(|e| panic!("{look}: {e}"));
            let res = probe::probe(&tools, &out).unwrap();
            assert!(res.has_audio && (res.duration_sec - 2.5).abs() < 0.3, "{look}: {}", res.duration_sec);
        }
        // Black and white at full strength really has no colour.
        let pixels = ff::command(&tools.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-ss", "1", "-i"])
            .arg(dir.join("mono.mp4"))
            .args(["-frames:v", "1", "-vf", "scale=8:8,format=rgb24", "-f", "rawvideo", "-"])
            .output()
            .unwrap()
            .stdout;
        assert!(pixels.chunks(3).all(|p| p.iter().max().unwrap() - p.iter().min().unwrap() < 12), "{pixels:?}");
    }

    /// Real FFmpeg: a beep placed at 2 s over silence is heard there and not before, with and without cuts.
    #[test]
    fn real_ffmpeg_mixes_sound_effects() {
        let Some(tools) = ff::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-sfx-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let (silent, mute, beep) = (dir.join("silent.mp4"), dir.join("mute.mp4"), dir.join("beep.wav"));
        let make = |args: &[&str], out: &Path| assert!(ff::command(&tools.ffmpeg).args(["-hide_banner", "-loglevel", "error", "-y"]).args(args).arg(out).status().unwrap().success());
        make(&["-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "6", "-pix_fmt", "yuv420p"], &silent);
        make(&["-f", "lavfi", "-i", "testsrc=size=640x360:rate=30", "-t", "6", "-pix_fmt", "yuv420p"], &mute);
        make(&["-f", "lavfi", "-i", "sine=frequency=880:duration=1"], &beep);
        let loudness = |file: &Path, from: &str| {
            let out = ff::command(&tools.ffmpeg)
                .args(["-hide_banner", "-ss", from, "-t", "0.6", "-i"])
                .arg(file)
                .args(["-vn", "-af", "volumedetect", "-f", "null", "-"])
                .output()
                .unwrap();
            let text = String::from_utf8_lossy(&out.stderr).into_owned();
            text.split("max_volume:").nth(1).and_then(|r| r.split_whitespace().next()?.parse::<f64>().ok()).unwrap()
        };
        for (src, has_audio, cuts) in [(&silent, true, vec![]), (&silent, true, vec![[0.5, 1.0]]), (&mute, false, vec![])] {
            let mut o = opts();
            o.resolution = 360;
            o.sounds = vec![(beep.clone(), 2.0, 0.8), (beep.clone(), 3.5, 0.5)];
            o.has_audio = has_audio;
            o.cuts = cuts.clone();
            let out = dir.join("mix.mp4");
            let args = build_args(src, 0.0, 5.0, &out, "9:16", &o, None).unwrap();
            run(&tools.ffmpeg, &args, 5.0, &Running::default(), |_| {}).unwrap();
            let want = 5.0 - if cuts.is_empty() { 0.0 } else { 0.5 };
            let got = probe::probe(&tools, &out).unwrap().duration_sec;
            assert!((got - want).abs() < 0.3, "{got} wanted {want}");
            assert!(loudness(&out, "2.1") > -30.0, "the effect is heard");
            assert!(loudness(&out, "0.5") < -60.0, "and not before its moment");
        }
    }

    #[test]
    fn no_filter_leaves_the_command_as_before() {
        let args = build_args(Path::new("a.mp4"), 0.0, 5.0, Path::new("b.mp4"), "9:16", &opts(), None).unwrap();
        assert!(!args.iter().any(|a| a == "-af"));
        assert!(video_filters(&Filters::default()).is_empty());
    }

    /// A blue "game" with a red "camera" in its bottom left corner: blue must end up on top, red below.
    #[test]
    fn real_ffmpeg_stacks_game_above_camera() {
        let Some(tools) = ff::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-split-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        assert!(ff::command(&tools.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:size=1280x720:rate=30",
                   "-vf", "drawbox=x=0:y=432:w=384:h=288:color=red:t=fill", "-t", "2", "-pix_fmt", "yuv420p"])
            .arg(&src)
            .status()
            .unwrap()
            .success());
        let mut o = opts();
        o.resolution = 720;
        o.crop_x = 100.0;
        o.split = Some(Split { x: 0.0, y: 0.6, w: 0.3, h: 0.4, share: 0.35, gy: 0.5, top: false });
        let out = dir.join("split.mp4");
        let args = build_args(&src, 0.0, 1.0, &out, "9:16", &o, None).unwrap();
        run(&tools.ffmpeg, &args, 1.0, &Running::default(), |_| {}).unwrap();
        let info = probe::probe(&tools, &out).unwrap();
        assert_eq!((info.width, info.height), (720, 1280));
        let pixel = |y: u32| {
            ff::command(&tools.ffmpeg)
                .args(["-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i"])
                .arg(&out)
                .args(["-frames:v", "1", "-vf", &format!("crop=2:2:360:{y},format=rgb24"), "-f", "rawvideo", "-"])
                .output()
                .unwrap()
                .stdout
        };
        let (game, face) = split_heights(1280, 0.35);
        assert_eq!((game, face), (832, 448));
        let (top, bottom) = (pixel(game / 2), pixel(game + face / 2));
        assert!(top[2] > 180 && top[0] < 80, "top should be the blue game: {:?}", &top[..3]);
        assert!(bottom[0] > 180 && bottom[2] < 80, "bottom should be the red camera: {:?}", &bottom[..3]);
        // Swapped, the camera is on top and the game below.
        o.split = o.split.map(|s| Split { top: true, ..s });
        let args = build_args(&src, 0.0, 1.0, &out, "9:16", &o, None).unwrap();
        run(&tools.ffmpeg, &args, 1.0, &Running::default(), |_| {}).unwrap();
        let (top, bottom) = (pixel(face / 2), pixel(face + game / 2));
        assert!(top[0] > 180 && top[2] < 80, "top should now be the red camera: {:?}", &top[..3]);
        assert!(bottom[2] > 180 && bottom[0] < 80, "bottom should now be the blue game: {:?}", &bottom[..3]);
        assert_eq!(o.split.unwrap().seam().round(), 35.0);
        // Other shapes ignore the layout.
        assert!(!filter_graph("1:1", &o).unwrap().contains("vstack"));
    }

    /// Cutting two seconds out of a six second clip leaves four, with sound.
    #[test]
    fn real_ffmpeg_removes_cut_parts() {
        let Some(tools) = ff::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-cuts-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        assert!(ff::command(&tools.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "10", "-pix_fmt", "yuv420p", "-shortest"])
            .arg(&src)
            .status()
            .unwrap()
            .success());
        let mut o = opts();
        o.resolution = 480;
        o.cuts = vec![[1.0, 2.0], [4.0, 5.0]];
        let out = dir.join("cut.mp4");
        let args = build_args(&src, 2.0, 6.0, &out, "9:16", &o, None).unwrap();
        run(&tools.ffmpeg, &args, 4.0, &Running::default(), |_| {}).unwrap();
        let res = probe::probe(&tools, &out).unwrap();
        assert!((res.duration_sec - 4.0).abs() < 0.3, "{}", res.duration_sec);
        assert!(res.has_audio);
        // The same together with the gaming layout.
        o.split = Some(Split { x: 0.0, y: 0.6, w: 0.3, h: 0.4, share: 0.35, gy: 0.5, top: false });
        let out = dir.join("cut-split.mp4");
        let args = build_args(&src, 2.0, 6.0, &out, "9:16", &o, None).unwrap();
        run(&tools.ffmpeg, &args, 4.0, &Running::default(), |_| {}).unwrap();
        assert!((probe::probe(&tools, &out).unwrap().duration_sec - 4.0).abs() < 0.3);
    }

    #[test]
    fn real_ffmpeg_reports_a_readable_error_for_bad_input() {
        let Some(tools) = ff::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-render-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let bad = dir.join("not-a-video.mp4");
        std::fs::write(&bad, b"this is not video data").unwrap();
        let args = build_args(&bad, 0.0, 2.0, &dir.join("o.mp4"), "9:16", &opts(), None).unwrap();
        let e = run(&tools.ffmpeg, &args, 2.0, &Running::default(), |_| {}).unwrap_err();
        assert!(e.starts_with("FFmpeg failed"), "{e}");
    }

    /// Burned-in captions must change the picture where the text is, and nowhere else need it.
    #[test]
    fn real_ffmpeg_burns_captions_into_the_picture() {
        let Some(tools) = ff::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-burn-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        assert!(ff::command(&tools.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x203050:size=1280x720:rate=30", "-t", "3", "-pix_fmt", "yuv420p"])
            .arg(&src)
            .status()
            .unwrap()
            .success());
        let segs = crate::ai::transcript::tests::make(&[(0.0, "CAPTION CHECK NOW")]);
        let style = crate::ai::ass::Style { pos_y: 50.0, ..Default::default() };
        std::fs::write(dir.join("cap.ass"), crate::ai::ass::build(&segs, &style, 720, 1280)).unwrap();
        let mut o = opts();
        o.resolution = 720;
        let frame = |captions: Option<&str>, name: &str| {
            let out = dir.join(format!("{name}.mp4"));
            let args = build_args(&src, 0.0, 2.0, &out, "9:16", &o, captions).unwrap();
            run_in(Some(&dir), &tools.ffmpeg, &args, 2.0, &Running::default(), |_| {}).unwrap();
            // raw grey pixels of one frame in the middle band where the caption sits
            let raw = ff::command(&tools.ffmpeg)
                .args(["-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i"])
                .arg(&out)
                .args(["-frames:v", "1", "-vf", "crop=iw:ih/5:0:ih*2/5,format=gray", "-f", "rawvideo", "-"])
                .output()
                .unwrap();
            raw.stdout
        };
        let plain = frame(None, "plain");
        let burned = frame(Some("cap.ass"), "burned");
        assert_eq!(plain.len(), burned.len());
        let changed = plain.iter().zip(&burned).filter(|(a, b)| a.abs_diff(**b) > 40).count();
        assert!(changed > plain.len() / 100, "captions should change many pixels, changed {changed} of {}", plain.len());
    }

    /// A face path must move the crop: a white square at the far left, then the far right.
    #[test]
    fn real_ffmpeg_follows_a_moving_path() {
        let Some(tools) = ff::locate(None) else { return };
        let dir = std::env::temp_dir().join(format!("clipit-pan-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("src.mp4");
        // black 1280x720; a white block sits at x=100 for 2 s, then at x=1060
        assert!(ff::command(&tools.ffmpeg)
            .args(["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:size=1280x720:rate=30", "-f", "lavfi", "-i", "color=c=white:size=120x720:rate=30", "-filter_complex", "[0][1]overlay=x='if(lt(t,2),100,1060)':y=0", "-t", "4", "-pix_fmt", "yuv420p"])
            .arg(&src)
            .status()
            .unwrap()
            .success());
        let path = [[0.0, 160.0 / 1280.0], [1.9, 160.0 / 1280.0], [2.1, 1120.0 / 1280.0], [4.0, 1120.0 / 1280.0]];
        let mut o = opts();
        o.resolution = 720;
        o.x_expr = crate::ai::reframe::expression(&path, 0.0, 1280, 720, 9.0 / 16.0, 1.0);
        let out = dir.join("pan.mp4");
        let args = build_args(&src, 0.0, 4.0, &out, "9:16", &o, None).unwrap();
        run(&tools.ffmpeg, &args, 4.0, &Running::default(), |_| {}).unwrap();
        // brightness of the middle column of the output: the block must be centred both early and late
        let centre = |at: &str| {
            let raw = ff::command(&tools.ffmpeg)
                .args(["-hide_banner", "-loglevel", "error", "-ss", at, "-i"])
                .arg(&out)
                .args(["-frames:v", "1", "-vf", "crop=40:ih:(iw-40)/2:0,format=gray", "-f", "rawvideo", "-"])
                .output()
                .unwrap()
                .stdout;
            raw.iter().map(|b| *b as u64).sum::<u64>() / raw.len().max(1) as u64
        };
        assert!(centre("0.5") > 200, "early frame is centred on the block: {}", centre("0.5"));
        assert!(centre("3.5") > 200, "late frame followed it to the right: {}", centre("3.5"));
    }

    #[test]
    fn unsafe_caption_names_are_refused() {
        assert!(build_args(Path::new("i"), 0.0, 1.0, Path::new("o"), "9:16", &opts(), Some("a.ass,drawtext=x")).is_err());
        assert!(build_args(Path::new("i"), 0.0, 1.0, Path::new("o"), "9:16", &opts(), Some("cap-1.ass")).is_ok());
    }

    #[test]
    fn a_cancelled_job_does_not_start() {
        let r = Running::default();
        r.cancel();
        let e = run(Path::new("nonexistent"), &[], 1.0, &r, |_| {}).unwrap_err();
        assert_eq!(e, "Cancelled");
    }
}
