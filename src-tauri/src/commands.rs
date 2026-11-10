//! The commands the UI can invoke. Each is a thin wrapper over `jwl_core`.

use jwl_core::settings::{self, Settings, SettingsInput};
use jwl_core::AppInfo;
use tauri::State;

use crate::state::{CommandResult, Db};

#[tauri::command]
#[specta::specta]
pub fn app_info() -> AppInfo {
    jwl_core::app_info()
}

/// The settings, created with defaults on first use.
#[tauri::command]
#[specta::specta]
pub fn get_settings(db: State<'_, Db>) -> CommandResult<Settings> {
    Ok(settings::get(&db.lock())?)
}

/// Validates and saves the settings form, then returns what is stored.
#[tauri::command]
#[specta::specta]
pub fn update_settings(db: State<'_, Db>, input: SettingsInput) -> CommandResult<Settings> {
    let conn = db.lock();
    settings::update(&conn, &input)?;
    Ok(settings::get(&conn)?)
}
