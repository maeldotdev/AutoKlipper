//! The user's Sounds folder, and placing sounds from it on a clip.

use tauri::{AppHandle, Manager, State};

use crate::ai::{ollama, post, sounds, transcript};
use crate::db::models::{Clip, ClipPatch};
use crate::db::repo;
use crate::error::{invalid, AppError, AppResult};
use crate::state::AppState;

/// Choose and save sounds for one clip. `model` is `None` when Ollama is not available.
/// The database is not held while the model thinks.
pub fn choose(state: &AppState, base: &str, model: Option<&str>, clip_id: &str) -> AppResult<Clip> {
    let names = sounds::list(&state.paths.sounds);
    if names.is_empty() {
        return invalid("Your Sounds folder is empty. Add some audio files first.");
    }
    let (start, end, said) = {
        let db = state.db()?;
        let clip = repo::get_clip_pub(&db, clip_id)?;
        let words = repo::get_transcript(&db, &clip.project_id)?.map(|(_, _, all)| transcript::slice(&all, clip.start_sec, clip.end_sec)).unwrap_or_default();
        // Slicing counts from the start of the clip; sounds are kept in source seconds.
        let said: Vec<sounds::Said> = words.iter().flat_map(|s| &s.words).map(|w| sounds::Said { text: w.text.clone(), at: clip.start_sec + w.start }).collect();
        (clip.start_sec, clip.end_sec, said)
    };
    if said.is_empty() {
        return invalid("This clip has no transcript, so there is nothing to place sounds by. Add them by hand.");
    }
    let from_model = model.and_then(|m| match ollama::answer(base, m, &sounds::prompt(&names, &said, start)) {
        Ok(reply) => sounds::from_reply(&reply, &names, start, end),
        Err(e) => {
            tracing::warn!("choosing sounds with the model failed, using the words said: {e}");
            None
        }
    });
    let found = from_model.unwrap_or_else(|| sounds::by_rules(&names, &said));
    repo::update_clip(&*state.db()?, clip_id, ClipPatch { sfx: Some(found), ..Default::default() })
}

#[tauri::command]
pub fn list_sounds(state: State<'_, AppState>) -> Vec<String> {
    sounds::list(&state.paths.sounds)
}

/// The folder to put sounds in. Created when missing.
#[tauri::command]
pub fn sounds_folder(state: State<'_, AppState>) -> AppResult<String> {
    std::fs::create_dir_all(&state.paths.sounds)?;
    Ok(state.paths.sounds.display().to_string())
}

/// One sound's full path, allowed for playback in the preview.
#[tauri::command]
pub fn sound_file(app: AppHandle, state: State<'_, AppState>, name: String) -> AppResult<String> {
    let file = state.paths.sounds.join(&name);
    if !sounds::valid_name(&name) || !file.is_file() {
        return Err(AppError::NotFound(format!("the sound {name}")));
    }
    if let Err(e) = app.asset_protocol_scope().allow_file(&file) {
        tracing::warn!("sound will not play in the preview: {e}");
    }
    Ok(file.display().to_string())
}

/// The user asked for sounds to be chosen again.
#[tauri::command]
pub async fn suggest_sounds(app: AppHandle, clip_id: String) -> AppResult<Clip> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let cfg = post::Config::load(&state.paths.settings_file);
        let model = cfg.pick_model();
        choose(&state, &cfg.base, model.as_deref(), &clip_id)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}
