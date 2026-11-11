//! The commands the UI can invoke. Each is a thin wrapper over `jwl_core`,
//! with the local time zone and the current instant filled in.

use std::sync::atomic::Ordering;

use chrono::{Local, Utc};
use jwl_core::auswertung::{self, AuswertungData, GroupEntriesInput, GroupEntriesPage};
use jwl_core::away::{self, AwayCheck, AwayPeriod, ResolveAwayInput};
use jwl_core::booking::{self, BookingPlan, Plan, SubmitResult};
use jwl_core::buchen::{self, BuchenData};
use jwl_core::cleanup::{self, CleanupResult};
use jwl_core::entries::AllgemeinesCategory;
use jwl_core::jira::{self, ConnectionTestInput, ConnectionTestResult, HttpJira, JiraApi};
use jwl_core::kalender::{self, KalenderData};
use jwl_core::report_range::RangeKind;
use jwl_core::settings::{self, Settings, SettingsInput};
use jwl_core::store::{self, GroupColor};
use jwl_core::time::now_iso;
use jwl_core::timer::{self, EntriesTextInput, EntryInput, StartTimerResult, StopTimerResult};
use jwl_core::{category_report, pdf, worklog_report, AppInfo};
use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

use crate::state::{CommandError, CommandResult, Db, ForceBooking};
use crate::window;

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

// ── Kalender and Auswertung ─────────────────────────────────────────────────

/// The Kalender week containing `anchor` (`YYYY-MM-DD`); `null` = this week.
#[tauri::command]
#[specta::specta]
pub fn kalender_data(db: State<'_, Db>, anchor: Option<String>) -> CommandResult<KalenderData> {
    Ok(kalender::load(
        &db.lock(),
        anchor.as_deref(),
        Utc::now(),
        &Local,
    )?)
}

/// The Auswertung page. `range` is the `?range=` value (unknown → month),
/// `anchor` the `?anchor=` value.
#[tauri::command]
#[specta::specta]
pub fn auswertung_data(
    db: State<'_, Db>,
    range: Option<String>,
    anchor: Option<String>,
) -> CommandResult<AuswertungData> {
    Ok(auswertung::load(
        &db.lock(),
        RangeKind::parse(range.as_deref()),
        anchor.as_deref(),
        Utc::now(),
        &Local,
    )?)
}

/// One page of the entries behind a "Zeit pro Ticket" bar.
#[tauri::command]
#[specta::specta]
pub fn group_entries(
    db: State<'_, Db>,
    input: GroupEntriesInput,
) -> CommandResult<GroupEntriesPage> {
    Ok(auswertung::group_entries(&db.lock(), &input, &Local)?)
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

// ── Jira ────────────────────────────────────────────────────────────────────

/// Runs blocking work (HTTP) off the main thread, so the window stays responsive.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| CommandError::from(e.to_string()))
}

/// What booking one day would send, without sending anything.
#[tauri::command]
#[specta::specta]
pub fn preview_day_booking(
    db: State<'_, Db>,
    force: State<'_, ForceBooking>,
    day_key: String,
) -> CommandResult<BookingPlan> {
    let force = force.0.load(Ordering::Relaxed);
    Ok(booking::plan_day(&db.lock(), &day_key, force, &Local)?.preview())
}

/// What booking every open day would send, without sending anything.
#[tauri::command]
#[specta::specta]
pub fn preview_all_open_booking(
    db: State<'_, Db>,
    force: State<'_, ForceBooking>,
) -> CommandResult<BookingPlan> {
    let force = force.0.load(Ordering::Relaxed);
    Ok(booking::plan_all_open(&db.lock(), force, &Local)?.preview())
}

/// Plans with the database locked, then posts with it released: the lock is
/// taken again only to mark each sent worklog.
fn submit_plan(
    app: &AppHandle,
    plan: impl FnOnce(&Connection, bool) -> jwl_core::Result<Plan>,
) -> CommandResult<SubmitResult> {
    let db = app.state::<Db>();
    let force = app.state::<ForceBooking>().0.load(Ordering::Relaxed);
    let (plan, s) = {
        let conn = db.lock();
        (plan(&conn, force)?, settings::get(&conn)?.values)
    };
    let api = HttpJira::from_settings(&s);
    let result = booking::submit(api.as_ref().map(|a| a as &dyn JiraApi), plan, |wl| {
        booking::mark_submitted(&mut db.lock(), wl, &now_iso())
    });
    log::info!(
        "Jira: {} Worklogs / {} Einträge gebucht, {} Fehler",
        result.booked_worklogs,
        result.booked_entries,
        result.errors.len()
    );
    Ok(result)
}

/// Books the not yet submitted entries of a day to Jira.
#[tauri::command]
#[specta::specta]
pub async fn submit_day_to_jira(app: AppHandle, day_key: String) -> CommandResult<SubmitResult> {
    blocking(move || {
        submit_plan(&app, |conn, force| {
            booking::plan_day(conn, &day_key, force, &Local)
        })
    })
    .await?
}

/// Books every not yet submitted entry to Jira.
#[tauri::command]
#[specta::specta]
pub async fn submit_all_open_to_jira(app: AppHandle) -> CommandResult<SubmitResult> {
    blocking(move || {
        submit_plan(&app, |conn, force| {
            booking::plan_all_open(conn, force, &Local)
        })
    })
    .await?
}

/// Tests the settings form's Jira credentials without saving them.
#[tauri::command]
#[specta::specta]
pub async fn test_jira_connection(
    input: ConnectionTestInput,
) -> CommandResult<ConnectionTestResult> {
    blocking(move || jira::test_connection(&input)).await
}

/// Whether force booking (re-book submitted entries) is on. In memory only.
#[tauri::command]
#[specta::specta]
pub fn get_force_booking(force: State<'_, ForceBooking>) -> bool {
    force.0.load(Ordering::Relaxed)
}

#[tauri::command]
#[specta::specta]
pub fn set_force_booking(force: State<'_, ForceBooking>, enabled: bool) {
    force.0.store(enabled, Ordering::Relaxed);
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/// Deletes finished entries older than `days` days, keeping the balance.
#[tauri::command]
#[specta::specta]
pub fn cleanup_old_entries(db: State<'_, Db>, days: i32) -> CommandResult<CleanupResult> {
    Ok(cleanup::cleanup_old_entries(
        &mut db.lock(),
        i64::from(days),
        Utc::now(),
        &Local,
    )?)
}

// ── PDF reports ─────────────────────────────────────────────────────────────

/// Asks where to save `bytes` (native "Speichern unter", in Downloads with
/// `file_name` filled in, like the Electron app's download) and writes the
/// file. `None`: the user cancelled.
fn save_pdf(app: &AppHandle, file_name: &str, bytes: &[u8]) -> CommandResult<Option<String>> {
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(file_name)
        .add_filter("PDF-Dokument", &["pdf"]);
    if let Ok(dir) = app.path().download_dir() {
        dialog = dialog.set_directory(dir);
    }
    if let Some(window) = window::main_window(app) {
        dialog = dialog.set_parent(&window);
    }
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = path
        .into_path()
        .map_err(|e| CommandError::from(e.to_string()))?;
    std::fs::write(&path, bytes)
        .map_err(|e| CommandError::from(format!("PDF konnte nicht gespeichert werden: {e}")))?;
    log::info!("PDF gespeichert: {}", path.display());
    Ok(Some(path.display().to_string()))
}

/// "Als PDF": the timesheet of the Auswertung period, saved where the user
/// picks. Returns the path, or `None` if the dialog was cancelled.
#[tauri::command]
#[specta::specta]
pub async fn export_worklog_pdf(
    app: AppHandle,
    range: Option<String>,
    anchor: Option<String>,
) -> CommandResult<Option<String>> {
    blocking(move || {
        let (bytes, file_name) = {
            let db = app.state::<Db>();
            let (report, range) = worklog_report::load(
                &db.lock(),
                RangeKind::parse(range.as_deref()),
                anchor.as_deref(),
                Utc::now(),
                &Local,
            )?;
            (
                pdf::worklog_pdf(&report, &Local),
                format!("stundenzettel-{}.pdf", range.slug),
            )
        };
        save_pdf(&app, &file_name, &bytes)
    })
    .await?
}

/// "Axapta-Bericht": the category report of the month around `anchor`, saved
/// where the user picks. Returns the path, or `None` if cancelled.
#[tauri::command]
#[specta::specta]
pub async fn export_category_pdf(
    app: AppHandle,
    anchor: Option<String>,
) -> CommandResult<Option<String>> {
    blocking(move || {
        let (bytes, file_name) = {
            let db = app.state::<Db>();
            let (report, month) =
                category_report::load(&db.lock(), anchor.as_deref(), Utc::now(), &Local)?;
            (
                pdf::category_pdf(&report),
                format!("axapta-bericht-{}.pdf", month.slug),
            )
        };
        save_pdf(&app, &file_name, &bytes)
    })
    .await?
}
