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
