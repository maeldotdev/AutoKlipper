use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::paths::AppPaths;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageItem {
    pub id: &'static str,
    pub label: &'static str,
    pub bytes: u64,
}

pub fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

pub fn usage(paths: &AppPaths) -> Vec<UsageItem> {
    let file = |p: &Path| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    vec![
        UsageItem { id: "exports", label: "Exported clips", bytes: dir_size(&paths.exports) },
        UsageItem { id: "downloads", label: "Downloaded videos", bytes: dir_size(&paths.downloads) },
        UsageItem { id: "models", label: "AI models", bytes: dir_size(&paths.models) },
        UsageItem { id: "cache", label: "Cache", bytes: dir_size(&paths.cache) },
        UsageItem { id: "temp", label: "Temporary files", bytes: dir_size(&paths.temp) },
        UsageItem { id: "data", label: "Database and logs", bytes: file(&paths.db_file) + dir_size(&paths.logs) },
    ]
}

/// Only these two folders can be cleaned. The caller never supplies a path.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CleanTarget {
    Cache,
    Temp,
}

/// Delete the contents of the cache or temp folder (not the folder itself). Returns bytes freed.
pub fn clean(paths: &AppPaths, target: CleanTarget) -> AppResult<u64> {
    let dir = match target {
        CleanTarget::Cache => &paths.cache,
        CleanTarget::Temp => &paths.temp,
    };
    // Defence in depth: refuse to touch anything that is not inside the app root.
    let root = paths.data.canonicalize()?;
    let canon = dir.canonicalize()?;
    if !canon.starts_with(&root) || canon == root {
        return Err(AppError::Internal("refusing to clean a folder outside the app data root".into()));
    }
    let before = dir_size(&canon);
    for entry in std::fs::read_dir(&canon)? {
        let p = entry?.path();
        if p.is_dir() {
            std::fs::remove_dir_all(&p)?;
        } else {
            std::fs::remove_file(&p)?;
        }
    }
    tracing::info!(?target, freed = before, "storage cleaned");
    Ok(before)
}

/// Delete `file` only if it lives inside `dir` (the downloads folder). Anything else is left alone.
pub fn remove_if_inside(dir: &Path, file: &Path) -> bool {
    let (Ok(d), Ok(f)) = (dir.canonicalize(), file.canonicalize()) else { return false };
    f.starts_with(&d) && f != d && std::fs::remove_file(f).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths() -> AppPaths {
        let d = std::env::temp_dir().join(format!("clipit-files-{}", uuid::Uuid::new_v4()));
        AppPaths::under(&d).unwrap()
    }

    #[test]
    fn clean_removes_contents_but_keeps_folder() {
        let p = paths();
        std::fs::write(p.cache.join("a.bin"), vec![0u8; 100]).unwrap();
        std::fs::create_dir(p.cache.join("sub")).unwrap();
        std::fs::write(p.cache.join("sub").join("b.bin"), vec![0u8; 50]).unwrap();
        std::fs::write(p.temp.join("keep.bin"), vec![0u8; 10]).unwrap();
        assert_eq!(clean(&p, CleanTarget::Cache).unwrap(), 150);
        assert!(p.cache.exists());
        assert_eq!(dir_size(&p.cache), 0);
        assert_eq!(dir_size(&p.temp), 10, "temp must be untouched");
    }

    #[test]
    fn only_files_inside_downloads_are_removed() {
        let p = paths();
        let mine = p.downloads.join("a.mp4");
        let theirs = p.exports.join("b.mp4");
        std::fs::write(&mine, b"x").unwrap();
        std::fs::write(&theirs, b"x").unwrap();
        assert!(!remove_if_inside(&p.downloads, &theirs), "a file outside downloads must survive");
        assert!(theirs.exists());
        assert!(remove_if_inside(&p.downloads, &mine));
        assert!(!mine.exists());
        assert!(!remove_if_inside(&p.downloads, &p.downloads.join("missing.mp4")));
    }

    #[test]
    fn usage_reports_each_area() {
        let p = paths();
        std::fs::write(p.models.join("m.bin"), vec![0u8; 2048]).unwrap();
        let u = usage(&p);
        assert_eq!(u.iter().find(|i| i.id == "models").unwrap().bytes, 2048);
        assert_eq!(u.len(), 6);
    }
}
