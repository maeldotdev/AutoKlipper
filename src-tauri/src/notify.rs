//! Windows pop-up notifications. Clicking one brings the window back on the page it is about.
//! The click works while AutoKlipper is running, including from the tray.

use tauri::{AppHandle, Emitter, Manager};

use crate::{settings, state::AppState};

fn wanted(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .and_then(|s| settings::load(&s.paths.settings_file).ok())
        .map_or(true, |s| s["notifications"] != false)
}

/// "1 clip is ready", "3 clips are ready".
pub fn ready_text(n: usize) -> String {
    match n {
        0 => "No new moments left".into(),
        1 => "1 clip is ready".into(),
        _ => format!("{n} clips are ready"),
    }
}

/// `route` is the page to open on click, such as `/clips?project=abc`.
pub fn show(app: &AppHandle, title: &str, body: &str, route: String) {
    if !wanted(app) {
        return;
    }
    #[cfg(windows)]
    {
        use tauri_winrt_notification::Toast;
        // An installed app is known to Windows by its identifier; a development build is not.
        let id = if cfg!(debug_assertions) { Toast::POWERSHELL_APP_ID.to_string() } else { app.config().identifier.clone() };
        let handle = app.clone();
        let shown = Toast::new(&id)
            .title(title)
            .text1(&body.chars().take(200).collect::<String>())
            .on_activated(move |_| {
                crate::tray::show(&handle);
                let _ = handle.emit("open-route", route.clone());
                Ok(())
            })
            .show();
        if let Err(e) = shown {
            tracing::warn!("notification not shown: {e}");
        }
    }
    #[cfg(not(windows))]
    let _ = (title, body, route, Emitter::emit(app, "noop", ()), Manager::config(app));
}

#[cfg(test)]
mod tests {
    #[test]
    fn counts_read_naturally() {
        assert_eq!(super::ready_text(1), "1 clip is ready");
        assert_eq!(super::ready_text(3), "3 clips are ready");
    }
}
