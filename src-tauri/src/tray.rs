//! Closing the window keeps AutoKlipper running in the system tray, so jobs and livestreams carry on.
//! The user can turn this off in Settings, General.

use serde_json::Value;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};

const TRAY: &str = "main";

/// On unless the user switched it off.
fn enabled(settings: &Value) -> bool {
    settings["closeToTray"].as_bool().unwrap_or(true)
}

/// Bring the window back, from the tray or from a second launch.
pub fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open AutoKlipper", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip("AutoKlipper")
        .menu(&Menu::with_items(app, &[&open, &quit])?)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub fn on_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else { return };
    let app = window.app_handle();
    // Without a tray icon a hidden window could never be reopened, so close normally.
    if window.label() != "main" || app.tray_by_id(TRAY).is_none() {
        return;
    }
    let Some(state) = app.try_state::<crate::state::AppState>() else { return };
    if crate::settings::load(&state.paths.settings_file).map(|s| enabled(&s)).unwrap_or(true) && window.hide().is_ok() {
        api.prevent_close();
    }
}

#[cfg(test)]
mod tests {
    use super::enabled;
    use serde_json::json;

    #[test]
    fn on_by_default_and_off_only_when_switched_off() {
        assert!(enabled(&json!({})));
        assert!(enabled(&json!({ "closeToTray": true })));
        assert!(!enabled(&json!({ "closeToTray": false })));
    }
}
