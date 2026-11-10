//! JiraWorklog core: everything that does not need the desktop shell.
//!
//! The Tauri crate (`src-tauri`) only wires these functions to commands,
//! events, the tray and the window. Keeping them here makes them testable with
//! a plain `cargo test`.

pub mod db;
pub mod error;
pub mod migrations;
pub mod time;

pub use error::{Error, Result};

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
