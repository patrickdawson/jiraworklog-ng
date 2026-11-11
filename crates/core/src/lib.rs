//! JiraWorklog core: everything that does not need the desktop shell.
//!
//! The Tauri crate (`src-tauri`) only wires these functions to commands,
//! events, the tray and the window. Keeping them here makes them testable with
//! a plain `cargo test`.

pub mod auswertung;
pub mod away;
pub mod buchen;
pub mod days;
pub mod db;
pub mod description;
pub mod entries;
pub mod error;
pub mod kalender;
pub mod migrations;
pub mod report_range;
pub mod settings;
pub mod store;
pub mod time;
pub mod timer;
pub mod work_time;

pub use error::{Error, Result};

/// Overrides the TypeScript type of `f64` fields. specta exports `f64` as
/// `number | null` (serde writes NaN as null); ours are never NaN, so the UI
/// gets a plain `number`. Only the TS type changes, the value stays a float.
pub(crate) type JsNumber = i32;

use serde::Serialize;
use specta::Type;

/// Static facts about the running build, shown in "Über JiraWorklog".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
}

/// Returns the build's facts. The version is the workspace version.
pub fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_info_reports_the_workspace_version() {
        assert_eq!(app_info().version, env!("CARGO_PKG_VERSION"));
    }
}
