use serde_json::{Map, Value};
use std::path::Path;

use crate::error::{invalid, AppResult};

/// Settings are a JSON object stored in `settings.json`. The frontend owns the
/// keys and defaults; the backend only guarantees atomic, validated persistence.
pub fn load(file: &Path) -> AppResult<Value> {
    match std::fs::read_to_string(file) {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(v) if v.is_object() => Ok(v),
            // A corrupt file must not stop the app from starting: keep a copy and start clean.
            _ => {
                let bad = file.with_extension("json.corrupt");
                let _ = std::fs::rename(file, bad);
                tracing::warn!("settings.json was not a JSON object; moved aside");
                Ok(Value::Object(Map::new()))
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(e) => Err(e.into()),
    }
}

/// Programs AutoKlipper runs. Their paths are set only through `choose_tool`, never by page content.
const TOOL_KEYS: [&str; 2] = ["ffmpegPath", "ytdlpPath"];

/// What the page may change: it can put a tool back to automatic, but cannot name a program.
pub fn without_tool_paths(mut patch: Value) -> Value {
    if let Value::Object(p) = &mut patch {
        p.retain(|k, v| !TOOL_KEYS.contains(&k.as_str()) || v.is_null() || v.as_str() == Some(""));
    }
    patch
}

/// The settings key and the file name a hand-picked program must start with.
pub fn tool(which: &str) -> Option<(&'static str, &'static str)> {
    match which {
        "ffmpeg" => Some((TOOL_KEYS[0], "ffmpeg")),
        "ytdlp" => Some((TOOL_KEYS[1], "yt-dlp")),
        _ => None,
    }
}

/// A program on this PC (not a network share) whose name matches the tool.
pub fn tool_path_ok(file: &Path, stem: &str) -> bool {
    let name = file.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    !file.to_string_lossy().starts_with(r"\\") && name.starts_with(stem) && name.ends_with(".exe")
}

/// Shallow-merge `patch` into the stored settings and write atomically (temp file + rename).
pub fn patch(file: &Path, patch: Value) -> AppResult<Value> {
    let Value::Object(p) = patch else {
        return invalid("Settings patch must be a JSON object");
    };
    let Value::Object(mut cur) = load(file)? else {
        unreachable!("load always returns an object")
    };
    for (k, v) in p {
        cur.insert(k, v);
    }
    let merged = Value::Object(cur);
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&merged)?)?;
    std::fs::rename(&tmp, file)?;
    Ok(merged)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn dir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("clipit-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn missing_file_is_empty_object() {
        let f = dir().join("settings.json");
        assert_eq!(load(&f).unwrap(), json!({}));
    }

    #[test]
    fn patch_merges_and_persists() {
        let f = dir().join("settings.json");
        patch(&f, json!({"theme": "abyss", "concurrency": 2})).unwrap();
        let v = patch(&f, json!({"concurrency": 3})).unwrap();
        assert_eq!(v, json!({"theme": "abyss", "concurrency": 3}));
        assert_eq!(load(&f).unwrap(), v);
    }

    #[test]
    fn the_page_cannot_name_a_program() {
        let p = without_tool_paths(json!({"ffmpegPath": "C:\\x\\evil.exe", "ytdlpPath": "", "theme": "slate"}));
        assert_eq!(p, json!({"ytdlpPath": "", "theme": "slate"}));
    }

    #[test]
    fn a_picked_program_must_be_the_tool_and_on_this_pc() {
        assert!(tool_path_ok(Path::new(r"C:\tools\FFmpeg.exe"), "ffmpeg"));
        assert!(tool_path_ok(Path::new(r"C:\tools\yt-dlp_x86.exe"), "yt-dlp"));
        assert!(!tool_path_ok(Path::new(r"C:\tools\cmd.exe"), "ffmpeg"));
        assert!(!tool_path_ok(Path::new(r"C:\tools\ffmpeg.bat"), "ffmpeg"));
        assert!(!tool_path_ok(Path::new(r"\\server\share\ffmpeg.exe"), "ffmpeg"));
        assert!(tool("python").is_none());
    }

    #[test]
    fn rejects_non_object_patch() {
        let f = dir().join("settings.json");
        assert!(patch(&f, json!([1, 2])).is_err());
    }

    #[test]
    fn corrupt_file_is_recovered() {
        let d = dir();
        let f = d.join("settings.json");
        std::fs::write(&f, "{not json").unwrap();
        assert_eq!(load(&f).unwrap(), json!({}));
        assert!(d.join("settings.json.corrupt").exists());
    }
}
