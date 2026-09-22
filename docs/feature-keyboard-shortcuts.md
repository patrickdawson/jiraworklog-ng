# Feature idea: keyboard shortcuts

**Status:** Idea. Not scheduled. Nothing below is decided.

## Goal

Control the most used actions without the mouse: start a timer, stop a timer,
and open the recent-entries dropdown in the timer field.

## Two kinds of shortcut

The difference matters, because the cost is very different.

### In-app keys

Handled in the renderer. They only work while the app window has focus.

Cheap: one `keydown` listener in `BuchenView` (`src/components/buchen-view.tsx`).
No Electron change, no new route, no migration.

Watch out for keys that fire while the user is typing in the description
field or in a dialog. The listener has to ignore events whose target is an
input, a textarea or a `role="combobox"`.

### Global hotkeys

Registered with Electron `globalShortcut` in `electron/main.ts`. They work
while the app is hidden in the tray, which is the real value.

These cost much more, because the main process holds no database access —
it is an HTTP client of the embedded Next server (see the `x-jwl-secret`
contract in `electron/ipc-contract.ts`).

A global *start* would need:

1. A new secret-guarded route `POST /api/timer/start`, mirroring
   `src/app/api/timer/stop/route.ts` and reusing `assertLocalSecret` from
   `src/lib/electron-ipc.ts`.
2. A `"timer-started"` push event next to the existing `"timer-stopped"`
   (`electron/preload.ts`, `electron/main.ts`, `src/components/electron-bridge.tsx`),
   so an open window refreshes after a start it did not trigger itself.

A global *stop* is cheaper — `POST /api/timer/stop` already exists and the
tray menu already calls it.

## Open questions

- Which actions get a key? Start, stop, toggle, show window, open the
  recents dropdown?
- Fixed keys, or user-configurable under **Einstellungen**? Configurable
  means a new settings column and a `drizzle/0005_*` migration.
- What happens when a global hotkey is already taken by another app?
  `globalShortcut.register` returns `false`. Fail silently, or show a
  warning in Einstellungen?
- Should a global start reuse the last entry, or just show the window and
  let the user pick?
- Do the in-app keys and the global keys use the same bindings, or
  different ones?

## Related

The recent-entries dropdown in the timer field
(`src/components/timer-description-input.tsx`) already has full keyboard
control once the field has focus: arrows move, `Enter` picks, `Escape`
closes. A "open the dropdown" shortcut only makes sense on top of that.
