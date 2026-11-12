# Feature idea: keyboard shortcuts

**Status:** Idea. Not scheduled. Nothing below is decided.

## Goal

Control the most used actions without the mouse: start a timer, stop a timer,
and open the recent-entries dropdown in the timer field.

## Two kinds of shortcut

### In-app keys

Handled in the WebView. They only work while the app window has focus.

Cheap: one `keydown` listener in `BuchenView`
(`ui/src/components/buchen-view.tsx`). No Rust change, no new command, no
migration.

Watch out for keys that fire while the user is typing in the description
field or in a dialog. The listener has to ignore events whose target is an
input, a textarea or a `role="combobox"`.

### Global hotkeys

Registered in Rust with `tauri-plugin-global-shortcut`. They work while the
app is hidden in the tray, which is the real value.

These are cheap too, because the Rust side owns the database. The tray's
"Timer stoppen" already shows the pattern (`src-tauri/src/tray.rs`): lock the
connection, call `jwl_core::timer::stop`, emit `TimerStopped` so an open
window reloads.

- A global *stop* reuses exactly that code.
- A global *start* calls `jwl_core::timer::start` the same way, plus a
  `TimerStarted` event next to `TimerStopped` (`src-tauri/src/events.rs`,
  registered in `src-tauri/src/lib.rs`, listened to in
  `ui/src/lib/desktop.ts` and `ui/src/components/desktop-bridge.tsx`), so an
  open window reloads after a start it did not trigger itself. Regenerate
  `ui/src/bindings.ts` after adding the event.

Registering the keys from Rust needs no entry in
`src-tauri/capabilities/default.json`; only calls from the UI do.

## Open questions

- Which actions get a key? Start, stop, toggle, show window, open the
  recents dropdown?
- Fixed keys, or user-configurable under **Einstellungen**? Configurable
  means a new settings column and a `drizzle/0009_*` migration (with a
  `when` above the last one, see `crates/core/src/migrations.rs`).
- What happens when a global hotkey is already taken by another app?
  Registering it returns an error. Fail silently, or show a warning in
  Einstellungen?
- Should a global start reuse the last entry, or just show the window and
  let the user pick?
- Do the in-app keys and the global keys use the same bindings, or
  different ones?

## Related

The recent-entries dropdown in the timer field
(`ui/src/components/description-combobox.tsx`) already has full keyboard
control once the field has focus: arrows move, `Enter` picks, `Escape`
closes. A "open the dropdown" shortcut only makes sense on top of that.
