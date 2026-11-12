//! Events the shell pushes to the UI. Typed through tauri-specta, so
//! `ui/src/bindings.ts` gets `events.timerStopped.listen(...)` etc.

use jwl_core::away::AwayPeriod;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri_specta::Event;

/// The timer was stopped outside the UI (tray); the UI reloads.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct TimerStopped;

/// The user is back after a screen lock or sleep. The UI decides (via
/// `check_away_time`) whether it is worth a question.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct AwayEnded(pub AwayPeriod);

/// The app menu asks the UI to open a route, e.g. `/hilfe`.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Event)]
pub struct Navigate(pub String);
