//! The AutoKlipper-managed Python environment. AutoKlipper creates it only when the user clicks "Set up local AI".
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::error::AppResult;
use crate::media::ffmpeg;

const SCRIPT: &str = include_str!("../../ai/clipit_ai.py");
/// Pinned so a new release cannot change behaviour (or what gets installed) by itself.
pub const PACKAGES: &[&str] = &["faster-whisper==1.2.1", "sherpa-onnx==2.0.3"];
/// Added only when the user sets up face tracking.
pub const FACE_PACKAGE: &str = "opencv-python-headless==5.1.0.95";
pub const MODELS: &[&str] = &["tiny", "base", "small", "medium", "large-v3"];

pub fn script_path(ai_dir: &Path) -> PathBuf {
    ai_dir.join("clipit_ai.py")
}

/// Written at startup so the installed helper always matches this build.
pub fn write_script(ai_dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(ai_dir)?;
    std::fs::write(script_path(ai_dir), SCRIPT)?;
    Ok(())
}

pub fn venv_dir(ai_dir: &Path) -> PathBuf {
    ai_dir.join("venv")
}

pub fn venv_python(venv: &Path) -> PathBuf {
    if cfg!(windows) { venv.join("Scripts").join("python.exe") } else { venv.join("bin").join("python") }
}

/// The interpreter used to run the helper: `CLIPIT_AI_PYTHON` (developers and tests), else the managed venv.
pub fn python(ai_dir: &Path) -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("CLIPIT_AI_PYTHON").map(PathBuf::from).filter(|p| p.is_file()) {
        return Some(p);
    }
    Some(venv_python(&venv_dir(ai_dir))).filter(|p| p.is_file())
}

fn version_of(p: &Path) -> Option<String> {
    let out = ffmpeg::command(p).arg("--version").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let v = text.strip_prefix("Python ")?.to_string();
    out.status.success().then_some(v)
}

fn supported(version: &str) -> bool {
    let mut n = version.split('.').map(|x| x.parse::<u32>().unwrap_or(0));
    matches!((n.next(), n.next()), (Some(3), Some(m)) if (9..=13).contains(&m))
}

/// A system Python able to create the environment (3.9 to 3.13).
pub fn system_python() -> Option<(PathBuf, String)> {
    let mut found: Vec<PathBuf> = Vec::new();
    let exe = if cfg!(windows) { "python.exe" } else { "python3" };
    if let Some(path) = std::env::var_os("PATH") {
        found.extend(std::env::split_paths(&path).map(|d| d.join(exe)));
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        for minor in (9..=13).rev() {
            found.push(PathBuf::from(&local).join("Programs").join("Python").join(format!("Python3{minor}")).join(exe));
        }
    }
    found.into_iter().filter(|p| p.is_file()).find_map(|p| version_of(&p).filter(|v| supported(v)).map(|v| (p, v)))
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub python_found: bool,
    pub python_version: Option<String>,
    /// faster-whisper can be imported, so transcription works.
    pub ready: bool,
    pub faster_whisper: Option<String>,
    pub sherpa_onnx: Option<String>,
    pub gpus: u64,
    pub models: Vec<String>,
    pub speaker_models: bool,
    /// OpenCV is installed and the face model is present.
    pub face_ready: bool,
}

pub fn model_dir(models_root: &Path, name: &str) -> PathBuf {
    models_root.join(format!("whisper-{name}"))
}

pub fn speaker_dir(models_root: &Path) -> PathBuf {
    models_root.join("speaker")
}

pub fn face_model(models_root: &Path) -> PathBuf {
    models_root.join("face").join("yunet.onnx")
}

pub fn installed_models(models_root: &Path) -> Vec<String> {
    MODELS.iter().filter(|m| model_dir(models_root, m).join("model.bin").is_file()).map(|m| m.to_string()).collect()
}

pub fn has_speaker_models(models_root: &Path) -> bool {
    let d = speaker_dir(models_root);
    d.join("segmentation.onnx").is_file() && d.join("embedding.onnx").is_file()
}

pub fn status(ai_dir: &Path, models_root: &Path) -> AiStatus {
    let mut s = AiStatus { models: installed_models(models_root), speaker_models: has_speaker_models(models_root), ..Default::default() };
    if let Some((_, v)) = system_python() {
        s.python_found = true;
        s.python_version = Some(v);
    }
    if let Some(py) = python(ai_dir) {
        if let Ok(out) = ffmpeg::command(&py).arg(script_path(ai_dir)).arg("check").output() {
            if let Ok(j) = serde_json::from_slice::<Value>(&out.stdout) {
                s.python_found = true;
                s.python_version = j["python"].as_str().map(String::from);
                s.faster_whisper = j["fasterWhisper"].as_str().map(String::from);
                s.sherpa_onnx = j["sherpaOnnx"].as_str().map(String::from);
                s.gpus = j["gpus"].as_u64().unwrap_or(0);
                s.ready = s.faster_whisper.is_some();
                s.face_ready = j["opencv"].is_string() && face_model(models_root).is_file();
            }
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_supported_python_versions_are_used() {
        assert!(supported("3.12.10") && supported("3.9.0") && supported("3.13.1"));
        assert!(!supported("3.8.10") && !supported("3.14.0") && !supported("2.7.18") && !supported("junk"));
    }

    #[test]
    fn installed_models_need_the_model_file() {
        let d = std::env::temp_dir().join(format!("clipit-models-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(model_dir(&d, "base")).unwrap();
        std::fs::create_dir_all(model_dir(&d, "tiny")).unwrap();
        std::fs::write(model_dir(&d, "tiny").join("model.bin"), b"x").unwrap();
        assert_eq!(installed_models(&d), ["tiny"]);
        assert!(!has_speaker_models(&d));
    }

    #[test]
    fn the_helper_script_is_written_to_the_ai_folder() {
        let d = std::env::temp_dir().join(format!("clipit-ai-{}", uuid::Uuid::new_v4()));
        write_script(&d).unwrap();
        assert!(std::fs::read_to_string(script_path(&d)).unwrap().contains("def cmd_transcribe"));
    }
}
