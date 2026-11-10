//! The commands the UI can invoke. Each is a thin wrapper over `jwl_core`,
//! with the local time zone and the current instant filled in.

use std::sync::atomic::Ordering;

use chrono::{Local, Utc};
use jwl_core::away::{self, AwayCheck, AwayPeriod, ResolveAwayInput};
use jwl_core::buchen::{self, BuchenData};
use jwl_core::entries::AllgemeinesCategory;
use jwl_core::settings::{self, Settings, SettingsInput};
use jwl_core::store::{self, GroupColor};
use jwl_core::timer::{self, EntriesTextInput, EntryInput, StartTimerResult, StopTimerResult};
use jwl_core::AppInfo;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::state::{CommandResult, Db, ForceBooking};

#[tauri::command]
#[specta::specta]
pub fn app_info() -> AppInfo {
    jwl_core::app_info()
}

// ── Settings ────────────────────────────────────────────────────────────────

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

// ── Buchen page ─────────────────────────────────────────────────────────────

/// Everything the Buchen page shows. `days = null` loads the whole history.
#[tauri::command]
#[specta::specta]
pub fn buchen_data(
    db: State<'_, Db>,
    force: State<'_, ForceBooking>,
    days: Option<u32>,
) -> CommandResult<BuchenData> {
    Ok(buchen::load(
        &db.lock(),
        days,
        force.0.load(Ordering::Relaxed),
        Utc::now(),
        &Local,
    )?)
}

// ── Timer ───────────────────────────────────────────────────────────────────

/// Stops any running timer, then starts a new one.
#[tauri::command]
#[specta::specta]
pub fn start_timer(
    db: State<'_, Db>,
    description: String,
    is_allgemeines: bool,
    category: Option<AllgemeinesCategory>,
) -> CommandResult<StartTimerResult> {
    Ok(timer::start(
        &mut db.lock(),
        &description,
        is_allgemeines,
        category,
        Utc::now(),
        &Local,
    )?)
}

#[tauri::command]
#[specta::specta]
pub fn stop_timer(db: State<'_, Db>) -> CommandResult<StopTimerResult> {
    Ok(timer::stop(&db.lock(), Utc::now(), &Local)?)
}

#[tauri::command]
#[specta::specta]
pub fn update_running_description(db: State<'_, Db>, description: String) -> CommandResult<()> {
    Ok(timer::update_running_description(&db.lock(), &description)?)
}

#[tauri::command]
#[specta::specta]
pub fn update_running_allgemeines(
    db: State<'_, Db>,
    is_allgemeines: bool,
    category: Option<AllgemeinesCategory>,
) -> CommandResult<()> {
    Ok(timer::update_running_allgemeines(
        &db.lock(),
        is_allgemeines,
        category,
    )?)
}

#[tauri::command]
#[specta::specta]
pub fn update_running_category(
    db: State<'_, Db>,
    category: AllgemeinesCategory,
) -> CommandResult<()> {
    Ok(timer::update_running_category(&db.lock(), category)?)
}

/// Back-dates the running timer.
#[tauri::command]
#[specta::specta]
pub fn update_running_started_at(db: State<'_, Db>, started_at: String) -> CommandResult<()> {
    Ok(timer::update_running_started_at(
        &db.lock(),
        &started_at,
        Utc::now(),
    )?)
}

// ── Entries ─────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn create_manual_entry(db: State<'_, Db>, input: EntryInput) -> CommandResult<()> {
    Ok(timer::create_manual_entry(&db.lock(), &input)?)
}

#[tauri::command]
#[specta::specta]
pub fn update_entry(db: State<'_, Db>, id: i32, input: EntryInput) -> CommandResult<()> {
    Ok(timer::update_entry(&db.lock(), id, &input)?)
}

/// Same text, flag and category for several entries (a Buchen group).
#[tauri::command]
#[specta::specta]
pub fn update_entries(
    db: State<'_, Db>,
    ids: Vec<i32>,
    input: EntriesTextInput,
) -> CommandResult<()> {
    Ok(timer::update_entries(&mut db.lock(), &ids, &input)?)
}

#[tauri::command]
#[specta::specta]
pub fn delete_entry(db: State<'_, Db>, id: i32) -> CommandResult<()> {
    Ok(timer::delete_entry(&db.lock(), id)?)
}

/// Stores a group's color; `null` resets it.
#[tauri::command]
#[specta::specta]
pub fn set_group_color(
    db: State<'_, Db>,
    group_key: String,
    color: Option<GroupColor>,
) -> CommandResult<()> {
    Ok(store::set_group_color(&db.lock(), &group_key, color)?)
}

// ── Away time ───────────────────────────────────────────────────────────────

/// Whether an away span (from the `away-ended` event) is worth a question.
#[tauri::command]
#[specta::specta]
pub fn check_away_time(db: State<'_, Db>, period: AwayPeriod) -> CommandResult<Option<AwayCheck>> {
    Ok(away::check(&db.lock(), &period, Utc::now())?)
}

/// Cuts the away span out of the running timer.
#[tauri::command]
#[specta::specta]
pub fn resolve_away_time(db: State<'_, Db>, input: ResolveAwayInput) -> CommandResult<()> {
    Ok(away::resolve(&mut db.lock(), &input, &Local)?)
}

// ── Desktop ─────────────────────────────────────────────────────────────────

/// Brings the window to the front, also out of the tray.
#[tauri::command]
#[specta::specta]
pub fn show_window(app: AppHandle) {
    crate::window::show(&app);
}

/// Whether the app starts at Windows login.
#[tauri::command]
#[specta::specta]
pub fn get_auto_launch(app: AppHandle) -> CommandResult<bool> {
    Ok(app.autolaunch().is_enabled()?)
}

/// Turns start at login on or off; returns the state that applies now.
#[tauri::command]
#[specta::specta]
pub fn set_auto_launch(app: AppHandle, enabled: bool) -> CommandResult<bool> {
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable()?;
    } else {
        launcher.disable()?;
    }
    Ok(launcher.is_enabled()?)
}
