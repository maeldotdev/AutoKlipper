//! AutoKlipper backend. Phase 2: config, logging, SQLite, file management and the
//! command surface the frontend talks to. Video, AI and connectors come later.
mod ai;
mod ai_commands;
mod commands;
mod connectors;
mod db;
mod error;
mod files;
mod live_commands;
mod logging;
mod media;
mod media_commands;
mod paths;
mod settings;
mod state;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let paths = paths::AppPaths::locate(&app.path().app_data_dir()?)?;
            let guard = logging::init(&paths.logs);
            tracing::info!(version = env!("CARGO_PKG_VERSION"), root = %paths.root.display(), "AutoKlipper starting");
            if let Some(w) = &paths.warning {
                tracing::warn!("{w}");
            }
            ai::env::write_script(&paths.root.join("ai"))?;
            // Buffers left by a crash are useless: remove them.
            let _ = std::fs::remove_dir_all(paths.temp.join("live"));
            let conn = db::open(&paths.db_file)?;
            app.manage(state::AppState::new(conn, paths, guard));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::load_settings,
            commands::patch_settings,
            commands::list_projects,
            commands::create_project,
            commands::set_project_status,
            commands::delete_project,
            commands::list_clips,
            commands::create_clips,
            commands::update_clip,
            commands::delete_clips,
            commands::list_jobs,
            commands::save_job,
            commands::clear_finished_jobs,
            commands::storage_usage,
            commands::clean_storage,
            commands::frontend_log,
            media_commands::ffmpeg_status,
            media_commands::probe_media,
            media_commands::export_clips,
            media_commands::cancel_job,
            media_commands::reveal_path,
            media_commands::audio_peaks,
            ai_commands::ai_setup_face,
            ai_commands::track_faces,
            media_commands::ytdlp_status,
            media_commands::list_connectors,
            media_commands::probe_url,
            media_commands::start_download,
            ai_commands::ai_status,
            ai_commands::ai_setup,
            ai_commands::ai_download_model,
            ai_commands::ai_download_speakers,
            ai_commands::analyze_project,
            ai_commands::get_transcript,
            ai_commands::save_transcript,
            ai_commands::ollama_models,
            live_commands::live_start,
            live_commands::live_stop,
            live_commands::live_clip_now,
            live_commands::live_running,
        ])
        .build(tauri::generate_context!())
        .expect("error while building AutoKlipper")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<state::AppState>() {
                    state.live.stop_all();
                }
            }
        });
}
