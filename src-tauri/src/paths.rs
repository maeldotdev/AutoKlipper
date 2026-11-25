use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::error::AppResult;

/// Every folder AutoKlipper writes to. The database, settings and logs live under the per-user app data
/// folder. Large files (downloads, exports, models, temp, cache) live there too unless the user picks
/// another folder (`dataFolder` in settings), for example on a bigger drive.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub root: PathBuf,
    /// Set when the chosen app folder was unavailable and the default one is in use.
    pub warning: Option<String>,
    /// Where the large files go. Same as `root` unless the user chose a folder.
    pub data: PathBuf,
    pub db_file: PathBuf,
    pub settings_file: PathBuf,
    pub logs: PathBuf,
    pub cache: PathBuf,
    pub temp: PathBuf,
    pub models: PathBuf,
    pub exports: PathBuf,
    /// Videos AutoKlipper downloaded from links. AutoKlipper owns these files.
    pub downloads: PathBuf,
}

impl AppPaths {
    /// The app folder: `location.json` ({"root": "F:\\CLIPIT"}) inside the default app data folder
    /// moves the database, settings, logs and the AI environment elsewhere. If that folder cannot be
    /// used (drive unplugged) the default is used and the user is told, so nothing looks silently lost.
    pub fn locate(default: &Path) -> AppResult<Self> {
        let chosen = std::fs::read_to_string(default.join("location.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .and_then(|v| v["root"].as_str().map(PathBuf::from))
            .filter(|p| p.is_absolute());
        let Some(root) = chosen else { return Self::under(default) };
        match Self::under(&root) {
            Ok(p) => Ok(p),
            Err(e) => {
                let mut p = Self::under(default)?;
                p.warning = Some(format!("AutoKlipper could not use {}: {e}. Your library there is not shown until the drive is back.", root.display()));
                Ok(p)
            }
        }
    }

    /// Build the layout under `root` and create every directory.
    pub fn under(root: &Path) -> AppResult<Self> {
        // A folder that cannot be created (drive unplugged) falls back to the app data folder.
        let data = crate::settings::load(&root.join("settings.json"))
            .ok()
            .and_then(|v| v["dataFolder"].as_str().map(PathBuf::from))
            .filter(|p| p.is_absolute() && std::fs::create_dir_all(p).is_ok())
            .unwrap_or_else(|| root.to_path_buf());
        let p = AppPaths {
            root: root.to_path_buf(),
            warning: None,
            data: data.clone(),
            db_file: root.join("clipit.db"),
            settings_file: root.join("settings.json"),
            logs: root.join("logs"),
            cache: data.join("cache"),
            temp: data.join("temp"),
            models: data.join("models"),
            exports: data.join("exports"),
            downloads: data.join("downloads"),
        };
        for d in [&p.root, &p.logs, &p.cache, &p.temp, &p.models, &p.exports, &p.downloads] {
            std::fs::create_dir_all(d)?;
        }
        Ok(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("clipit-{name}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn large_files_follow_the_chosen_folder() {
        let (root, other) = (tmp("root"), tmp("data"));
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(AppPaths::under(&root).unwrap().downloads, root.join("downloads"));
        let json = serde_json::json!({ "dataFolder": other.display().to_string() });
        std::fs::write(root.join("settings.json"), json.to_string()).unwrap();
        let p = AppPaths::under(&root).unwrap();
        assert_eq!((p.downloads.clone(), p.temp.clone(), p.models.clone()), (other.join("downloads"), other.join("temp"), other.join("models")));
        assert_eq!(p.db_file, root.join("clipit.db"), "database stays in app data");
        assert!(p.exports.is_dir() && p.cache.is_dir());
    }

    #[test]
    fn location_file_moves_the_whole_app_folder() {
        let (default, moved) = (tmp("default"), tmp("moved"));
        std::fs::create_dir_all(&default).unwrap();
        assert_eq!(AppPaths::locate(&default).unwrap().root, default);
        std::fs::write(default.join("location.json"), serde_json::json!({ "root": moved.display().to_string() }).to_string()).unwrap();
        let p = AppPaths::locate(&default).unwrap();
        assert_eq!((p.root.clone(), p.db_file.clone(), p.logs.clone()), (moved.clone(), moved.join("clipit.db"), moved.join("logs")));
        assert!(p.warning.is_none());
        // a path that cannot be a folder falls back, with a warning
        let file = tmp("file");
        std::fs::write(&file, b"x").unwrap();
        std::fs::write(default.join("location.json"), serde_json::json!({ "root": file.join("no").display().to_string() }).to_string()).unwrap();
        let p = AppPaths::locate(&default).unwrap();
        assert_eq!(p.root, default);
        assert!(p.warning.unwrap().contains("could not use"));
    }

    #[test]
    fn a_relative_or_unusable_folder_is_ignored() {
        let root = tmp("root");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("settings.json"), r#"{"dataFolder":"relative/dir"}"#).unwrap();
        assert_eq!(AppPaths::under(&root).unwrap().data, root);
    }
}
