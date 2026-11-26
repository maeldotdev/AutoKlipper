use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::db::models::{Clip, ClipPatch, Job, Project};
use crate::db::{self, repo};
use crate::error::{invalid, AppError, AppResult};
use crate::files::{self, CleanTarget, UsageItem};
use crate::paths::AppPaths;
use crate::settings;
use crate::state::AppState;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    schema_version: u32,
    paths: AppPaths,
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> AppResult<AppInfo> {
    let schema_version = db::schema_version(&*state.db()?)?;
    Ok(AppInfo { version: env!("CARGO_PKG_VERSION"), schema_version, paths: state.paths.clone() })
}

/* ---------------- settings ---------------- */

#[tauri::command]
pub fn load_settings(state: State<'_, AppState>) -> AppResult<Value> {
    settings::load(&state.paths.settings_file)
}

#[tauri::command]
pub fn patch_settings(state: State<'_, AppState>, patch: Value) -> AppResult<Value> {
    settings::patch(&state.paths.settings_file, settings::without_tool_paths(patch))
}

/// Let the user pick ffmpeg.exe or yt-dlp.exe in a Windows dialog and save it. `None` when cancelled.
#[tauri::command]
pub async fn choose_tool(app: tauri::AppHandle, state: State<'_, AppState>, tool: String) -> AppResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;
    let Some((key, stem)) = settings::tool(&tool) else { return invalid("Unknown tool.") };
    let picked = app.dialog().file().set_title(format!("Choose {stem}.exe")).add_filter("Program", &["exe"]).blocking_pick_file();
    let Some(picked) = picked else { return Ok(None) };
    let file = picked.into_path().map_err(|e| AppError::Invalid(e.to_string()))?;
    if !settings::tool_path_ok(&file, stem) {
        return invalid(format!("Choose the {stem}.exe file stored on this PC."));
    }
    let path = file.display().to_string();
    settings::patch(&state.paths.settings_file, serde_json::json!({ key: path }))?;
    Ok(Some(path))
}

/* ---------------- projects ---------------- */

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> AppResult<Vec<Project>> {
    repo::list_projects(&*state.db()?)
}

#[tauri::command]
pub fn create_project(state: State<'_, AppState>, project: Project) -> AppResult<()> {
    repo::insert_project(&*state.db()?, &project)?;
    tracing::info!(id = %project.id, "project created");
    Ok(())
}

#[tauri::command]
pub fn set_project_status(state: State<'_, AppState>, id: String, status: String) -> AppResult<()> {
    repo::set_project_status(&*state.db()?, &id, &status)
}

#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let source = {
        let db = state.db()?;
        let src = repo::get_project(&db, &id).ok().and_then(|p| p.source_path);
        repo::delete_project(&db, &id)?;
        src
    };
    // A video AutoKlipper downloaded belongs to the project. A file the user imported is never touched.
    if let Some(s) = source {
        if files::remove_if_inside(&state.paths.downloads, std::path::Path::new(&s)) {
            tracing::info!(%id, "downloaded source removed with its project");
        }
    }
    tracing::info!(%id, "project deleted");
    Ok(())
}

/* ---------------- clips ---------------- */

#[tauri::command]
pub fn list_clips(state: State<'_, AppState>) -> AppResult<Vec<Clip>> {
    repo::list_clips(&*state.db()?)
}

#[tauri::command]
pub fn create_clips(state: State<'_, AppState>, clips: Vec<Clip>) -> AppResult<()> {
    repo::insert_clips(&*state.db()?, &clips)
}

#[tauri::command]
pub fn update_clip(state: State<'_, AppState>, id: String, patch: ClipPatch) -> AppResult<Clip> {
    repo::update_clip(&*state.db()?, &id, patch)
}

#[tauri::command]
pub fn delete_clips(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<usize> {
    repo::delete_clips(&*state.db()?, &ids)
}

/* ---------------- jobs ---------------- */

#[tauri::command]
pub fn list_jobs(state: State<'_, AppState>) -> AppResult<Vec<Job>> {
    repo::list_jobs(&*state.db()?)
}

#[tauri::command]
pub fn save_job(state: State<'_, AppState>, job: Job) -> AppResult<()> {
    repo::save_job(&*state.db()?, &job)
}

#[tauri::command]
pub fn clear_finished_jobs(state: State<'_, AppState>) -> AppResult<usize> {
    repo::clear_finished_jobs(&*state.db()?)
}

/* ---------------- files ---------------- */

#[tauri::command]
pub async fn storage_usage(state: State<'_, AppState>) -> AppResult<Vec<UsageItem>> {
    Ok(files::usage(&state.paths))
}

#[tauri::command]
pub async fn clean_storage(state: State<'_, AppState>, target: CleanTarget) -> AppResult<u64> {
    files::clean(&state.paths, target)
}

/* ---------------- logging ---------------- */

/// Lets the frontend write into the same log file as the backend.
#[tauri::command]
pub fn frontend_log(level: String, message: String) {
    let m: String = message.chars().take(2000).collect();
    match level.as_str() {
        "error" => tracing::error!(target: "frontend", "{m}"),
        "warn" => tracing::warn!(target: "frontend", "{m}"),
        _ => tracing::info!(target: "frontend", "{m}"),
    }
}
