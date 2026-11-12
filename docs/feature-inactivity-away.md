# Feature idea: away detection from inactivity

**Status:** Idea. Not scheduled. Nothing below is decided. Likely hard to get
right; see "The main risk".

## Problem

The away check (`src-tauri/src/power.rs`, `crates/core/src/away.rs`) only
knows two signals from Windows: the session was locked, or the PC slept. Both
come from the session the app runs in.

Over Remote Desktop that misses the common case. Win+L always locks the
**local** PC; Windows never sends it to the remote session. The remote
session stays unlocked, the app sees nothing, and a timer keeps running
through a lunch break. Found on 2026-11-12 while testing 0.9.0-beta.5: the
dialog "did not work" until the remote session was locked with Ctrl+Alt+End.

Locking the remote session (Ctrl+Alt+End → Sperren) works today, but nobody
does that by habit.

## Idea

Treat "no keyboard or mouse input in this session for N minutes" as away,
in addition to lock and sleep. Windows reports the time of the last input of
the session (`GetLastInputInfo`); a check every few seconds is cheap. When
input comes back after a long gap, the app asks the same question as after a
lock: keep the time, cut it and stop, or cut it and go on.

## The main risk: inactive is not away

Plenty of work has no input for a long time:

- watching a video: a recorded meeting, a training, a screen share
- a call or meeting with the camera on, reading a long document, a code review
  on a second screen
- waiting for a build or a test run

A question after each of these is a nuisance, and a wrong "Abziehen" click
loses real working time. The feature is only worth having if it rarely asks
when the user was there.

## Ways to reduce false questions

To be evaluated, none decided:

- **Off by default.** A setting under Einstellungen → Pausen, next to
  "Nach Abwesenheit fragen", that users switch on knowingly. Perhaps only
  offered in a Remote Desktop session (`GetSystemMetrics(SM_REMOTESESSION)`).
- **A long threshold**, e.g. 30 minutes instead of the 5 minutes for a lock,
  configurable.
- **Respect "display required".** Video players and meeting apps ask Windows
  to keep the screen on while they play (a power request, as listed by
  `powercfg /requests`). While such a request is active, the inactivity does
  not count. Needs checking: whether a normal process may read these
  requests, and whether they are visible inside a Remote Desktop session.
- **A safe default answer.** "Zeit behalten" stays the default button, so an
  unread question changes nothing.
- **Say why it asks:** "Keine Eingabe seit 35 Minuten" instead of "Du warst
  weg", so the user sees it is a guess.

## Open questions

- Does `GetLastInputInfo` in the remote session reflect the remote user's
  input reliably, also when the RDP window is minimised on the client?
- How should inactivity combine with a lock that follows it (inactive from
  12:00, locked at 12:20)? Probably one question for the whole span, from the
  start of the inactivity.
- Is a notification ("Bist du noch da?") during the inactivity better than a
  question afterwards?
