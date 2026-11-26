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
mod notify;
mod paths;
mod posts;
mod settings;
mod state;
mod tray;
mod update_commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch only brings the running window back: two copies would share one library.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
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
            if let Err(e) = tray::create(app.handle()) {
                tracing::warn!("no tray icon, closing will quit: {e}");
            }
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::load_settings,
            commands::patch_settings,
            commands::choose_tool,
            posts::write_post,
            posts::set_credit,
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
            media_commands::thumbnail,
            media_commands::find_cuts,
            media_commands::export_clips,
            media_commands::cancel_job,
            media_commands::reveal_path,
            media_commands::audio_peaks,
            ai_commands::ai_setup_face,
            ai_commands::track_faces,
            ai_commands::guess_camera,
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
            update_commands::check_update,
            update_commands::install_update,
            update_commands::open_link,
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
