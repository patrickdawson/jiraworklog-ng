//! Test hooks for the WebdriverIO suite in `e2e/`. Compiled only with the
//! `e2e` cargo feature, which `npm run tauri:e2e` builds into its own target
//! folder (`target/e2e`); the normal debug and release builds never contain
//! any of this.
//!
//! What the feature changes:
//! - no single-instance lock (see `lib.rs`), so a test run never hands its
//!   start over to a JiraWorklog the user has open, and one launch per spec
//!   file cannot collide with the previous one still shutting down;
//! - the fake clock below, the counterpart of Playwright's `page.clock`;
//! - the `e2e-hook` event (see [`Hook`]): the suite clicks tray and menu
//!   entries, sends lock and sleep notifications and reads the tray back.
//!   Events need no extra permission (`core:default` allows emitting).

use chrono::{DateTime, Utc};
use jwl_core::away::PowerEvent;
use serde::Deserialize;
use tauri::plugin::{Builder, TauriPlugin};
use tauri::{AppHandle, Listener, Wry};

/// Runs before the page's own scripts. `Date.now()` and `new Date()` (no
/// arguments) return the real time plus `window.__jwlE2eClockOffsetMs`, so a
/// test can move the UI's clock forward without a reload. Timers
/// (`setInterval`) keep running in real time, as with Playwright's
/// `clock.fastForward`. The Rust side keeps the real time.
const FAKE_CLOCK: &str = r#"
(() => {
  const RealDate = Date;
  const offset = () => Number(window.__jwlE2eClockOffsetMs) || 0;
  function E2EDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + offset()).toString();
    return args.length === 0
      ? new RealDate(RealDate.now() + offset())
      : new RealDate(...args);
  }
  E2EDate.prototype = RealDate.prototype;
  E2EDate.now = () => RealDate.now() + offset();
  E2EDate.parse = RealDate.parse;
  E2EDate.UTC = RealDate.UTC;
  window.Date = E2EDate;
})();
"#;

/// What a test asks for, as the payload of an `e2e-hook` event
/// (e2e/support/page.ts: `menuClick`, `appReport`, `powerEvent`).
#[derive(Debug, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
enum Hook {
    /// A click on a tray or app menu entry, through the real handler.
    Menu { id: String },
    /// Writes the tray and window state to `window.__jwlE2eReport`.
    Report,
    /// A lock, unlock, suspend or resume notification that arrived at `at`.
    Power { event: String, at: String },
}

pub fn plugin() -> TauriPlugin<Wry> {
    Builder::new("jwl-e2e")
        .js_init_script(FAKE_CLOCK)
        .setup(|app, _api| {
            let handle = app.clone();
            app.listen_any("e2e-hook", move |event| on_hook(&handle, event.payload()));
            Ok(())
        })
        .build()
}

fn on_hook(app: &AppHandle, payload: &str) {
    let hook: Hook = match serde_json::from_str(payload) {
        Ok(h) => h,
        Err(e) => {
            log::error!("e2e hook {payload}: {e}");
            return;
        }
    };
    log::info!("e2e hook {hook:?}");
    match hook {
        Hook::Menu { id } => crate::on_menu_event(app, &id),
        Hook::Report => report(app),
        Hook::Power { event, at } => {
            let event = match event.as_str() {
                "lock" => PowerEvent::Lock,
                "unlock" => PowerEvent::Unlock,
                "suspend" => PowerEvent::Suspend,
                "resume" => PowerEvent::Resume,
                other => {
                    log::error!("e2e hook: unknown power event {other}");
                    return;
                }
            };
            match DateTime::parse_from_rfc3339(&at) {
                Ok(at) => crate::power::inject(event, at.with_timezone(&Utc)),
                Err(e) => log::error!("e2e hook: bad time {at}: {e}"),
            }
        }
    }
}

fn report(app: &AppHandle) {
    let win = crate::window::main_window(app);
    let value = serde_json::json!({
        "tray": crate::tray::snapshot(app),
        "visible": crate::window::is_visible(app),
        "fullscreen": win.as_ref().and_then(|w| w.is_fullscreen().ok()),
    });
    if let Some(w) = win {
        let _ = w.eval(format!("window.__jwlE2eReport = {value};"));
    }
}
