//! Test hooks for the WebdriverIO suite in `e2e/`. Compiled only with the
//! `e2e` cargo feature, which `npm run tauri:e2e` builds into its own target
//! folder (`target/e2e`); the normal debug and release builds never contain
//! any of this.
//!
//! What the feature changes:
//! - no single-instance lock (see `lib.rs`), so a test run never hands its
//!   start over to a JiraWorklog the user has open, and one launch per spec
//!   file cannot collide with the previous one still shutting down;
//! - the fake clock below, the counterpart of Playwright's `page.clock`.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

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

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("jwl-e2e").js_init_script(FAKE_CLOCK).build()
}
