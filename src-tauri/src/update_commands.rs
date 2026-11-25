//! In-app updates from the project's GitHub releases, and the two outside links the app offers.
//! The updater only installs files signed with the project's update key.

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

use crate::error::{invalid, AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

fn failed(e: impl std::fmt::Display) -> AppError {
    tracing::warn!("update: {e}");
    AppError::Invalid(format!("Could not reach the update service. {e}"))
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> AppResult<Option<UpdateInfo>> {
    let found = app.updater().map_err(failed)?.check().await.map_err(failed)?;
    Ok(found.map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() }))
}

/// Why an update must wait, if it must. Installing closes the app, which would cut off work.
pub fn blocker(jobs: usize, live: usize) -> Option<&'static str> {
    if live > 0 {
        Some("A livestream is being monitored. Stop it first, then update.")
    } else if jobs > 0 {
        Some("A job is still running. Let it finish or cancel it, then update.")
    } else {
        None
    }
}

/// Download the newest version, install it and restart. Only ever runs on the user's click.
#[tauri::command]
pub async fn install_update(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    if let Some(why) = blocker(state.queue.active(), state.live.running().len()) {
        return invalid(why);
    }
    let Some(update) = app.updater().map_err(failed)?.check().await.map_err(failed)? else {
        return invalid("You already have the newest version.");
    };
    tracing::info!(version = %update.version, "installing update");
    update.download_and_install(|_, _| {}, || {}).await.map_err(failed)?;
    app.restart();
}

/// Only these addresses can be opened, so page content can never choose one.
pub fn link(which: &str) -> Option<&'static str> {
    match which {
        "kofi" => Some("https://ko-fi.com/maeldotdev"),
        "github" => Some("https://github.com/MaelPlays/AutoKlipper"),
        _ => None,
    }
}

#[tauri::command]
pub fn open_link(app: AppHandle, which: String) -> AppResult<()> {
    let Some(url) = link(&which) else { return invalid("Unknown link.") };
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::Internal(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_project_links_open() {
        assert!(link("kofi").is_some_and(|u| u.starts_with("https://ko-fi.com/")));
        assert!(link("github").is_some_and(|u| u.starts_with("https://github.com/")));
        assert_eq!(link("https://example.com"), None);
    }

    #[test]
    fn an_update_waits_for_running_work() {
        assert_eq!(blocker(0, 0), None);
        assert!(blocker(1, 0).unwrap().contains("job"));
        assert!(blocker(0, 1).unwrap().contains("livestream"));
    }
}
