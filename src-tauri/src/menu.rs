//! The app menu (Datei / Bearbeiten / Ansicht / Hilfe). Port of
//! `buildAppMenu()` in electron/main.ts. On Windows, muda has no predefined
//! zoom or fullscreen items, so those are custom.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_specta::Event;

use crate::events::Navigate;
use crate::state::{data_dir, Zoom};
use crate::window;

/// Chromium's zoom levels; index [`DEFAULT_ZOOM`] is 100 %.
pub const ZOOM_STEPS: [f64; 11] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
pub const DEFAULT_ZOOM: usize = 5;

fn item(
    app: &AppHandle,
    id: &str,
    label: &str,
    accel: Option<&str>,
) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, id, label, true, accel)
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let datei = Submenu::with_items(
        app,
        "Datei",
        true,
        &[
            &item(
                app,
                "close-window",
                "Fenster schließen",
                Some("CmdOrCtrl+W"),
            )?,
            &item(app, "quit", "Beenden", Some("CmdOrCtrl+Q"))?,
        ],
    )?;
    let bearbeiten = Submenu::with_items(
        app,
        "Bearbeiten",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Rückgängig"))?,
            &PredefinedMenuItem::redo(app, Some("Wiederholen"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Ausschneiden"))?,
            &PredefinedMenuItem::copy(app, Some("Kopieren"))?,
            &PredefinedMenuItem::paste(app, Some("Einfügen"))?,
            &PredefinedMenuItem::select_all(app, Some("Alles auswählen"))?,
        ],
    )?;
    let ansicht = Submenu::with_id(app, "ansicht", "Ansicht", true)?;
    ansicht.append(&item(app, "reload", "Neu laden", Some("CmdOrCtrl+R"))?)?;
    if cfg!(debug_assertions) {
        ansicht.append(&item(
            app,
            "devtools",
            "Entwicklertools",
            Some("CmdOrCtrl+Shift+I"),
        )?)?;
    }
    ansicht.append_items(&[
        &PredefinedMenuItem::separator(app)?,
        &item(app, "zoom-reset", "Originalgröße", Some("CmdOrCtrl+0"))?,
        &item(app, "zoom-in", "Vergrößern", Some("CmdOrCtrl+Plus"))?,
        &item(app, "zoom-out", "Verkleinern", Some("CmdOrCtrl+-"))?,
        &PredefinedMenuItem::separator(app)?,
        &item(app, "fullscreen", "Vollbild", Some("F11"))?,
    ])?;
    let hilfe = Submenu::with_items(
        app,
        "Hilfe",
        true,
        &[
            &item(app, "help", "Anleitung", Some("F1"))?,
            &item(app, "whats-new", "Was ist neu", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "open-data-dir", "Datenordner öffnen", None)?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "about", "Über JiraWorklog", None)?,
        ],
    )?;
    Menu::with_items(app, &[&datei, &bearbeiten, &ansicht, &hilfe])
}

/// Handles the app menu's entries; returns false for ids it does not own.
pub fn on_menu_event(app: &AppHandle, id: &str) -> bool {
    let win = window::main_window(app);
    match id {
        "close-window" => window::hide(app),
        "quit" => app.exit(0),
        "reload" => {
            if let Some(w) = &win {
                let _ = w.eval("location.reload()");
            }
        }
        "devtools" =>
        {
            #[cfg(debug_assertions)]
            if let Some(w) = &win {
                w.open_devtools();
            }
        }
        "zoom-reset" | "zoom-in" | "zoom-out" => {
            let zoom = app.state::<Zoom>();
            let mut level = zoom.0.lock().unwrap_or_else(|e| e.into_inner());
            *level = match id {
                "zoom-in" => (*level + 1).min(ZOOM_STEPS.len() - 1),
                "zoom-out" => level.saturating_sub(1),
                _ => DEFAULT_ZOOM,
            };
            if let Some(w) = &win {
                let _ = w.set_zoom(ZOOM_STEPS[*level]);
            }
        }
        "fullscreen" => {
            if let Some(w) = &win {
                let on = w.is_fullscreen().unwrap_or(false);
                let _ = w.set_fullscreen(!on);
            }
        }
        "help" => open_route(app, "/hilfe"),
        "whats-new" => open_route(app, "/hilfe/neu"),
        "open-data-dir" => {
            if let Err(e) = app
                .opener()
                .open_path(data_dir().to_string_lossy(), None::<&str>)
            {
                log::error!("open data dir: {e}");
            }
        }
        "about" => show_about(app),
        _ => return false,
    }
    true
}

/// Shows the window and asks the UI to open a route.
fn open_route(app: &AppHandle, path: &str) {
    window::show(app);
    let _ = Navigate(path.into()).emit(app);
}

fn show_about(app: &AppHandle) {
    let webview = tauri::webview_version().unwrap_or_else(|_| "?".into());
    let detail = format!(
        "JiraWorklog Tracker\n\nVersion {}\n\nTauri {}\nWebView2 {webview}",
        app.package_info().version,
        tauri::VERSION,
    );
    let mut dialog = app
        .dialog()
        .message(detail)
        .title("Über JiraWorklog")
        .kind(MessageDialogKind::Info);
    if let Some(w) = window::main_window(app) {
        dialog = dialog.parent(&w);
    }
    dialog.show(|_| {});
}
