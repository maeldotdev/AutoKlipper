//! Writes each clip's post text and tells the window. A model can take a while, so new clips
//! are usable at once and their text arrives in the background.

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::{post, sounds, transcript};
use crate::{settings, sound_commands};
use crate::db::models::{Clip, ClipPatch};
use crate::db::repo;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Write and save one clip's post. The database is not held while the model thinks.
fn write_one(state: &AppState, cfg: &post::Config, model: Option<&str>, clip_id: &str) -> AppResult<Clip> {
    let (title, said, language, credit) = {
        let db = state.db()?;
        let clip = repo::get_clip_pub(&db, clip_id)?;
        let project = repo::get_project(&db, &clip.project_id)?;
        let (language, words) = repo::get_transcript(&db, &clip.project_id)?.map(|(lang, _, all)| (lang, transcript::slice(&all, clip.start_sec, clip.end_sec))).unwrap_or_default();
        let said: Vec<&str> = words.iter().flat_map(|s| &s.words).map(|w| w.text.trim()).collect();
        (clip.title, said.join(" "), language, project.uploader)
    };
    let text = post::write(cfg, model, &title, &said, &language, credit.as_deref());
    let text: String = text.chars().take(3000).collect();
    repo::update_clip(&*state.db()?, clip_id, ClipPatch { post: Some(text), ..Default::default() })
}

/// After clips are created: sound effects (when the Sounds folder has files) and post text,
/// each unless the user switched it off.
pub fn write_in_background(app: &AppHandle, clip_ids: Vec<String>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let cfg = post::Config::load(&state.paths.settings_file);
        let effects = settings::load(&state.paths.settings_file).map_or(true, |s| s["autoSounds"] != false)
            && !sounds::list(&state.paths.sounds).is_empty();
        if !cfg.enabled && !effects {
            return;
        }
        let model = cfg.pick_model();
        for id in clip_ids {
            if effects {
                match sound_commands::choose(&state, &cfg.base, model.as_deref(), &id) {
                    Ok(c) => {
                        let _ = app.emit("clip-sfx", json!({"clipId": c.id, "sfx": c.sfx}));
                    }
                    Err(e) => tracing::warn!("sound effects for a clip: {e}"),
                }
            }
            if cfg.enabled {
                match write_one(&state, &cfg, model.as_deref(), &id) {
                    Ok(c) => {
                        let _ = app.emit("clip-post", json!({"clipId": c.id, "post": c.post}));
                    }
                    // The clip may have been deleted in the meantime.
                    Err(e) => tracing::warn!("post text for a clip: {e}"),
                }
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
