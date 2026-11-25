use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// FFmpeg is never downloaded silently. AutoKlipper looks for it in this order:
/// the path chosen in Settings, a `bin` folder next to the app (used by the installer in Phase 8),
/// every folder on PATH, then the WinGet links folder.
#[derive(Debug, Clone)]
pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub found: bool,
    pub version: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub ffprobe_path: Option<String>,
    /// Hardware H.264 encoders this build of FFmpeg offers: nvenc, amf, qsv.
    pub hardware_encoders: Vec<String>,
}

pub(super) fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// A command that never flashes a console window on Windows.
pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

pub(super) fn in_path(name: &str) -> Option<PathBuf> {
    let file = exe(name);
    std::env::split_paths(&std::env::var_os("PATH")?).map(|d| d.join(&file)).find(|p| p.is_file())
}

fn candidates(override_path: Option<&str>) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(o) = override_path.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(o);
        v.push(if p.is_dir() { p.join(exe("ffmpeg")) } else { p });
    }
    if let Ok(me) = std::env::current_exe() {
        if let Some(dir) = me.parent() {
            v.push(dir.join("bin").join(exe("ffmpeg")));
        }
    }
    if let Some(p) = in_path("ffmpeg") {
        v.push(p);
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        v.push(PathBuf::from(local).join("Microsoft").join("WinGet").join("Links").join(exe("ffmpeg")));
    }
    v
}

fn version_of(p: &Path) -> Option<String> {
    let out = command(p).arg("-version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().next()?;
    // "ffmpeg version 7.1-full_build ..." -> "7.1-full_build"
    Some(line.split_whitespace().nth(2).unwrap_or(line).to_string())
}

pub fn locate(override_path: Option<&str>) -> Option<Tools> {
    for ffmpeg in candidates(override_path) {
        if !ffmpeg.is_file() {
            continue;
        }
        let Some(version) = version_of(&ffmpeg) else { continue };
        let sibling = ffmpeg.with_file_name(exe("ffprobe"));
        let ffprobe = if sibling.is_file() { sibling } else { match in_path("ffprobe") { Some(p) => p, None => continue } };
        return Some(Tools { ffmpeg, ffprobe, version });
    }
    None
}

pub fn hardware_encoders(ffmpeg: &Path) -> Vec<String> {
    let Ok(out) = command(ffmpeg).args(["-hide_banner", "-encoders"]).output() else { return vec![] };
    let text = String::from_utf8_lossy(&out.stdout);
    ["nvenc", "amf", "qsv"]
        .iter()
        .filter(|n| text.contains(&format!("h264_{n}")))
        // FFmpeg lists every encoder it was built with, with or without the hardware. Try a tiny encode.
        .filter(|n| {
            command(ffmpeg)
                .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=size=640x360:rate=30", "-t", "0.2", "-c:v", &format!("h264_{n}"), "-f", "null", "-"])
                .output()
                .is_ok_and(|o| o.status.success())
        })
        .map(|n| n.to_string())
        .collect()
}

pub fn status(override_path: Option<&str>) -> FfmpegStatus {
    match locate(override_path) {
        Some(t) => FfmpegStatus {
            found: true,
            version: Some(t.version.clone()),
            hardware_encoders: hardware_encoders(&t.ffmpeg),
            ffmpeg_path: Some(t.ffmpeg.display().to_string()),
            ffprobe_path: Some(t.ffprobe.display().to_string()),
        },
        None => FfmpegStatus { found: false, version: None, ffmpeg_path: None, ffprobe_path: None, hardware_encoders: vec![] },
    }
}
