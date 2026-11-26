//! Writes each clip's post text and tells the window. A model can take a while, so new clips
//! are usable at once and their text arrives in the background.

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::{post, transcript};
use crate::db::models::{Clip, ClipPatch};
use crate::db::repo;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Write and save one clip's post. The database is not held while the model thinks.
fn write_one(state: &AppState, cfg: &post::Config, model: Option<&str>, clip_id: &str) -> AppResult<Clip> {
    let (title, said, credit) = {
        let db = state.db()?;
        let clip = repo::get_clip_pub(&db, clip_id)?;
        let project = repo::get_project(&db, &clip.project_id)?;
        let words = repo::get_transcript(&db, &clip.project_id)?.map(|(_, _, all)| transcript::slice(&all, clip.start_sec, clip.end_sec)).unwrap_or_default();
        let said: Vec<&str> = words.iter().flat_map(|s| &s.words).map(|w| w.text.trim()).collect();
        (clip.title, said.join(" "), project.uploader)
    };
    let text = post::write(cfg, model, &title, &said, credit.as_deref());
    let text: String = text.chars().take(3000).collect();
    repo::update_clip(&*state.db()?, clip_id, ClipPatch { post: Some(text), ..Default::default() })
}

/// After clips are created, unless the user switched post captions off.
pub fn write_in_background(app: &AppHandle, clip_ids: Vec<String>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let cfg = post::Config::load(&state.paths.settings_file);
        if !cfg.enabled {
            return;
        }
        let model = cfg.pick_model();
        for id in clip_ids {
            match write_one(&state, &cfg, model.as_deref(), &id) {
                Ok(c) => {
                    let _ = app.emit("clip-post", json!({"clipId": c.id, "post": c.post}));
                }
                // The clip may have been deleted in the meantime.
                Err(e) => tracing::warn!("post text for a clip: {e}"),
            }
        }
    });
}

/// The user asked for a new version.
#[tauri::command]
pub async fn write_post(app: AppHandle, clip_id: String) -> AppResult<Clip> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cfg = post::Config::load(&state.paths.settings_file);
        let model = cfg.pick_model();
        write_one(&state, &cfg, model.as_deref(), &clip_id)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

/// Who to credit for a video. Typed by the user, or filled in from the link.
#[tauri::command]
pub fn set_credit(state: State<'_, AppState>, project_id: String, name: String) -> AppResult<()> {
    repo::set_project_uploader(&*state.db()?, &project_id, &name)
}
