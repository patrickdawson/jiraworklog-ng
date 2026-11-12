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

/// What the tray shows, computed from the timer and the window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayView {
    pub status: String,
    pub stop_enabled: bool,
    pub toggle: String,
    pub tooltip: String,
    pub running: bool,
}

/// The menu entries that change. The menu is built once and only these are
/// updated: replacing the whole menu (`set_menu`) closes it while it is open,
/// and the running timer changes the label every second.
struct TrayItems {
    status: MenuItem<Wry>,
    stop: MenuItem<Wry>,
    toggle: MenuItem<Wry>,
}

pub struct TrayState {
    items: TrayItems,
    /// The last applied view, so only what changed is touched.
    last: Mutex<Option<TrayView>>,
}

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
    let initial = view(None, window::is_visible(app));
    let items = TrayItems {
        status: MenuItem::with_id(app, "tray-status", &initial.status, false, None::<&str>)?,
        stop: MenuItem::with_id(
            app,
            "tray-stop",
            "Timer stoppen",
            initial.stop_enabled,
            None::<&str>,
        )?,
        toggle: MenuItem::with_id(app, "tray-toggle", &initial.toggle, true, None::<&str>)?,
    };
    let menu = Menu::with_items(
        app,
        &[
            &items.status,
            &PredefinedMenuItem::separator(app)?,
            &items.stop,
            &items.toggle,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "tray-quit", "Beenden", true, None::<&str>)?,
        ],
    )?;
    app.manage(TrayState {
        items,
        last: Mutex::new(Some(initial.clone())),
    });
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(IDLE_ICON)?)
        .tooltip(&initial.tooltip)
        .menu(&menu)
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

/// The tray as it is now, for the E2E suite (`e2e.rs`): the menu entries are
/// read back from the native menu; tooltip and icon from the last update.
#[cfg(feature = "e2e")]
pub fn snapshot(app: &AppHandle) -> Option<serde_json::Value> {
    let state = app.try_state::<TrayState>()?;
    let last = state
        .last
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()?;
    let items = &state.items;
    Some(serde_json::json!({
        "status": items.status.text().ok()?,
        "stopEnabled": items.stop.is_enabled().ok()?,
        "toggle": items.toggle.text().ok()?,
        "tooltip": last.tooltip,
        "runningIcon": last.running,
    }))
}

/// What the tray shows for this timer and window state.
pub fn view(running: Option<&RunningStatus>, visible: bool) -> TrayView {
    let (status, tooltip) = match running {
        Some(r) => {
            let text = r.description.trim();
            let text = if text.is_empty() {
                "Ohne Beschreibung"
            } else {
                text
            };
            let elapsed = format_elapsed(r.effective_seconds);
            (
                format!("▶ {elapsed} — {text}"),
                format!("JiraWorklog — läuft {elapsed}"),
            )
        }
        None => (
            "Kein laufender Timer".into(),
            "JiraWorklog — kein laufender Timer".into(),
        ),
    };
    let toggle = if visible {
        "Fenster ausblenden"
    } else {
        "Fenster anzeigen"
    };
    TrayView {
        status,
        stop_enabled: running.is_some(),
        toggle: toggle.into(),
        tooltip,
        running: running.is_some(),
    }
}

/// Updates the tray entries, tooltip and icon that changed. Never replaces
/// the menu, so an open menu stays open while the timer ticks.
pub fn refresh(app: &AppHandle) {
    let (Some(tray), Some(state)) = (app.tray_by_id(TRAY_ID), app.try_state::<TrayState>()) else {
        return;
    };
    let next = view(status(app).as_ref(), window::is_visible(app));
    let prev = {
        let mut last = state.last.lock().unwrap_or_else(|e| e.into_inner());
        if last.as_ref() == Some(&next) {
            return;
        }
        last.replace(next.clone())
    };
    let items = &state.items;
    let differs = |a: Option<&str>, b: &str| a != Some(b);
    if differs(prev.as_ref().map(|p| p.status.as_str()), &next.status) {
        let _ = items.status.set_text(&next.status);
    }
    if prev.as_ref().map(|p| p.stop_enabled) != Some(next.stop_enabled) {
        let _ = items.stop.set_enabled(next.stop_enabled);
    }
    if differs(prev.as_ref().map(|p| p.toggle.as_str()), &next.toggle) {
        let _ = items.toggle.set_text(&next.toggle);
    }
    if differs(prev.as_ref().map(|p| p.tooltip.as_str()), &next.tooltip) {
        let _ = tray.set_tooltip(Some(&next.tooltip));
    }
    if prev.as_ref().map(|p| p.running) != Some(next.running) {
        let icon = if next.running {
            RUNNING_ICON
        } else {
            IDLE_ICON
        };
        if let Ok(img) = Image::from_bytes(icon) {
            let _ = tray.set_icon(Some(img));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{format_elapsed, view};
    use jwl_core::timer::RunningStatus;

    #[test]
    fn view_of_an_idle_timer() {
        let v = view(None, true);
        assert_eq!(v.status, "Kein laufender Timer");
        assert_eq!(v.tooltip, "JiraWorklog — kein laufender Timer");
        assert_eq!(v.toggle, "Fenster ausblenden");
        assert!(!v.stop_enabled && !v.running);
        assert_eq!(view(None, false).toggle, "Fenster anzeigen");
    }

    #[test]
    fn view_of_a_running_timer() {
        let r = RunningStatus {
            description: " TXR-1 Fix ".into(),
            effective_seconds: 3725.4,
        };
        let v = view(Some(&r), false);
        assert_eq!(v.status, "▶ 1:02:05 — TXR-1 Fix");
        assert_eq!(v.tooltip, "JiraWorklog — läuft 1:02:05");
        assert!(v.stop_enabled && v.running);

        let blank = RunningStatus {
            description: "  ".into(),
            effective_seconds: 5.0,
        };
        assert_eq!(view(Some(&blank), true).status, "▶ 0:05 — Ohne Beschreibung");
    }

    #[test]
    fn elapsed_format_matches_the_electron_tray() {
        assert_eq!(format_elapsed(0.0), "0:00");
        assert_eq!(format_elapsed(59.9), "0:59");
        assert_eq!(format_elapsed(3599.0), "59:59");
        assert_eq!(format_elapsed(3600.0), "1:00:00");
        assert_eq!(format_elapsed(-5.0), "0:00");
    }
}
