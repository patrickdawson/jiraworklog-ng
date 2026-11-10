use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager};

/// Folder of the Electron app's `userData` (named after package.json `name`).
/// The new app keeps using it so existing data is picked up as it is.
const DATA_DIR_NAME: &str = "jiraworklog-ng";
const DB_FILE: &str = "jiraworklog.db";

/// The one database connection. Single user, so a mutex is all we need.
pub struct Db(Mutex<Connection>);

impl Db {
    pub fn new(conn: Connection) -> Self {
        Self(Mutex::new(conn))
    }

    pub fn lock(&self) -> MutexGuard<'_, Connection> {
        // A panic while holding the lock leaves the connection usable; SQLite
        // rolled back whatever was in flight.
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// "Force booking": also (re-)book entries already sent to Jira. Deliberately
/// in memory only, so this dangerous mode resets on every app start.
#[derive(Default)]
pub struct ForceBooking(pub std::sync::atomic::AtomicBool);

/// `%APPDATA%\jiraworklog-ng\jiraworklog.db`, or `JWL_DB_PATH` if set
/// (dev on a real-DB copy, E2E runs).
pub fn db_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    if let Some(p) = std::env::var_os("JWL_DB_PATH").filter(|p| !p.is_empty()) {
        return Ok(PathBuf::from(p));
    }
    Ok(app.path().data_dir()?.join(DATA_DIR_NAME).join(DB_FILE))
}

/// Error type of every command. It reaches the UI as a plain string.
#[derive(Debug, Serialize, Type)]
#[serde(transparent)]
pub struct CommandError(String);

impl From<jwl_core::Error> for CommandError {
    fn from(e: jwl_core::Error) -> Self {
        Self(e.to_string())
    }
}

pub type CommandResult<T> = Result<T, CommandError>;
