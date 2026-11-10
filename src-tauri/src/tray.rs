//! The tray icon: live timer in the menu and tooltip, idle/running icon,
//! "Timer stoppen", show/hide and quit. Port of the tray in electron/main.ts.

use std::sync::Mutex;
use std::time::Duration;

use chrono::{Local, Utc};
use jwl_core::timer::{self, RunningStatus};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_specta::Event;

use crate::events::TimerStopped;
use crate::state::Db;
use crate::window;

const TRAY_ID: &str = "main";
const IDLE_ICON: &[u8] = include_bytes!("../../assets/tray-idle.png");
const RUNNING_ICON: &[u8] = include_bytes!("../../assets/tray-running.png");

/// The last rendered state, so the tray is only rebuilt when it changes.
#[derive(Default)]
pub struct TrayState(Mutex<Option<String>>);

/// `h:mm:ss`, or `m:ss` below an hour.
pub fn format_elapsed(total_seconds: f64) -> String {
    let s = total_seconds.max(0.0).floor() as u64;
    let (h, m, sec) = (s / 3600, (s % 3600) / 60, s % 60);
    if h > 0 {
        format!("{h}:{m:02}:{sec:02}")
    } else {
        format!("{m}:{sec:02}")
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    app.manage(TrayState::default());
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(IDLE_ICON)?)
        .tooltip("JiraWorklog")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::show(tray.app_handle());
            }
        })
        .build(app)?;
    refresh(app);

    // The elapsed time in the menu label ticks every second.
    let handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        refresh(&handle);
    });
    Ok(())
}

/// Handles the tray's menu entries; returns false for ids it does not own.
pub fn on_menu_event(app: &AppHandle, id: &str) -> bool {
    match id {
        "tray-stop" => {
            let stopped = {
                let db = app.state::<Db>();
                let conn = db.lock();
                timer::stop(&conn, Utc::now(), &Local)
            };
            match stopped {
                Ok(_) => {
                    let _ = TimerStopped.emit(app);
                }
                Err(e) => log::error!("tray stop failed: {e}"),
            }
            refresh(app);
        }
        "tray-toggle" => {
            if window::is_visible(app) {
                window::hide(app);
            } else {
                window::show(app);
            }
        }
        "tray-quit" => app.exit(0),
        _ => return false,
    }
    true
}

fn status(app: &AppHandle) -> Option<RunningStatus> {
    let db = app.try_state::<Db>()?;
    let conn = db.lock();
    timer::running_status(&conn, Utc::now(), &Local)
        .ok()
        .flatten()
}

/// Re-renders the tray if anything it shows has changed.
pub fn refresh(app: &AppHandle) {
    let (Some(tray), Some(state)) = (app.tray_by_id(TRAY_ID), app.try_state::<TrayState>()) else {
        return;
    };
    let running = status(app);
    let visible = window::is_visible(app);
    let key = match &running {
        Some(r) => format!(
            "run|{}|{}|{visible}",
            r.effective_seconds.floor(),
            r.description
        ),
        None => format!("idle|{visible}"),
    };
    {
        let mut last = state.0.lock().unwrap_or_else(|e| e.into_inner());
        if last.as_deref() == Some(key.as_str()) {
            return;
        }
        *last = Some(key);
    }

    match build_menu(app, running.as_ref(), visible) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(e) => log::error!("tray menu: {e}"),
    }
    let tooltip = match &running {
        Some(r) => format!(
            "JiraWorklog — läuft {}",
            format_elapsed(r.effective_seconds)
        ),
        None => "JiraWorklog — kein laufender Timer".into(),
    };
    let _ = tray.set_tooltip(Some(tooltip));
    let icon = if running.is_some() {
        RUNNING_ICON
    } else {
        IDLE_ICON
    };
    if let Ok(img) = Image::from_bytes(icon) {
        let _ = tray.set_icon(Some(img));
    }
}

fn build_menu(
    app: &AppHandle,
    running: Option<&RunningStatus>,
    visible: bool,
) -> tauri::Result<Menu<Wry>> {
    let label = match running {
        Some(r) => {
            let text = r.description.trim();
            let text = if text.is_empty() {
                "Ohne Beschreibung"
            } else {
                text
            };
            format!("▶ {} — {text}", format_elapsed(r.effective_seconds))
        }
        None => "Kein laufender Timer".into(),
    };
    let toggle = if visible {
        "Fenster ausblenden"
    } else {
        "Fenster anzeigen"
    };
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, "tray-status", label, false, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "tray-stop",
                "Timer stoppen",
                running.is_some(),
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "tray-toggle", toggle, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "tray-quit", "Beenden", true, None::<&str>)?,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::format_elapsed;

    #[test]
    fn elapsed_format_matches_the_electron_tray() {
        assert_eq!(format_elapsed(0.0), "0:00");
        assert_eq!(format_elapsed(59.9), "0:59");
        assert_eq!(format_elapsed(3599.0), "59:59");
        assert_eq!(format_elapsed(3600.0), "1:00:00");
        assert_eq!(format_elapsed(-5.0), "0:00");
    }
}
