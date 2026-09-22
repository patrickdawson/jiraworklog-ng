# Concept: scaling the tracked-time history

**Status:** Implemented. Stages 0-4 are on `main`. Stage 5 is deliberately
not done — see "Not done, on purpose".

## Goal

The history only grows. Nothing ever removes an entry unless the user presses
a button. The Buchen page must therefore cost the same after five years as it
does after five weeks.

It did not. The page read every entry ever tracked on every render, regrouped
all of them, and serialised the result into the RSC payload. Because
`revalidateAll()` (`src/lib/actions.ts`) fires after every mutation, starting
or stopping a timer paid that cost again.

## What it actually cost

Measured with `scripts/db-bench.mjs` at the observed rate of ~7.4 entries per
tracked day, against the real page over HTTP:

| History | Entries | Distinct days | Before | After (default view) |
| ------- | ------- | ------------- | ------ | -------------------- |
| 1 year  | 1,939   | 263           | 5.6 MB | 492 KB |
| 5 years | 9,715   | 1,312         | 26.2 MB | 474 KB |

The "after" column is flat, because the default view renders a fixed 30-day
window rather than everything. That is the whole point: the number stops
tracking the size of the history.

SQLite was never the problem. `SELECT *` over 9,240 rows takes under 10 ms.
The cost was the payload, the React element tree, and the repeated O(n) JS
passes over the full array.

## Stage 0: index `ended_at`

`getRunningEntry()` filters `ended_at IS NULL`, which had no index, so the
plan was `SCAN time_entries`. The Electron tray polls `/api/timer/status`
every second (`electron/main.ts`), so that scan ran 86,400 times a day and
grew with the table — whether or not the window was open.

`drizzle/0005_add_ended_at_index.sql` is hand-written. `drizzle/meta/` holds
only `0000_snapshot.json` while `_journal.json` lists five migrations, so
`drizzle-kit generate` would diff against a stale snapshot and re-emit DDL
that has already been applied. Migrations 0001-0004 were written the same way.
Anyone adding 0006 should follow that, not the generator.

## Stage 1: isolate the ticking clock

`BuchenView` held `now` with a 1 Hz `setInterval` at the top of the tree, and
nothing anywhere in `src/` was memoized. Every second, React re-rendered every
day section, group and entry row in the whole history to advance one clock.

`src/components/now-context.tsx` moves the clock above the tree. The
provider's `children` prop is a JSX element created during the caller's
render, so its identity survives a `setNow` and React bails out of the
subtree. Only `useNow`/`useRunningSeconds` consumers re-render.

`React.memo` would not have helped and is not used: context consumers
re-render whether memoized or not, and non-consumers do not re-render at all.
The fix is structural, not memoization.

Measured idle cost of the tick, from Chrome's own `ScriptDuration` counter
over a 12 s window, with the timer running versus stopped:

| View | Day sections | Tick cost |
| ---- | ------------ | --------- |
| default (30 days) | 22 | 1.1 ms/s |
| `?days=all`, 5 years | 1,303 | 4.7 ms/s |

The residual growth at `?days=all` is React's context propagation walking a
large fiber tree, not re-rendering. Re-rendering ~6,500 group rows every
second would cost far more than 4.7 ms.

The same stage fixed the `GroupRow` key. It was
`description + entries[0].id`, which changed whenever the group's newest entry
changed — remounting the row and silently resetting its collapse state.
`descGroupKey(g)` is the identity `buildDayGroups` already buckets by, so it
is correct rather than merely stable.

## Stage 2: window the list

`src/db/queries.ts` gained range-scoped reads. `getAllEntries()` survives but
is documented as serving only the explicit "Alles anzeigen" path.

The window lives in the URL (`?days=`), not in client state. `revalidatePath("/")`
runs after every mutation, so an accumulated "I loaded three more pages"
counter would reset or desync on every timer start. A search param survives
that for free, matches the `?range=` convention on `/auswertung`, and keeps
the back button working.

The default window is `DEFAULT_HISTORY_DAYS`, which is deliberately the same
constant as `RECENT_WINDOW_DAYS`. `buildRecentEntries` is fed from the day
groups the page already built, so a shorter display window would silently
truncate the timer dropdown's suggestions.

**Three figures must not follow the window**, and this is the part most likely
to be broken by a later change:

- the **overtime balance** is cumulative over every day ever tracked. It reads
  the full history through `getFinishedDurations()` — a three-column
  projection, which is what keeps it affordable.
- the **"Nach Jira buchen (N)"** count must match what the button books, which
  is all days. A windowed count would claim there is nothing to book while
  still submitting old entries.
- the **running entry** is read directly via `getRunningEntry()`. A timer
  started months ago is still running now.

`tests/e2e/history-window.spec.ts` asserts all three are identical at
`?days=30` and `?days=all`.

## Stage 3: local day bounds, and why they are easy to get wrong

`started_at` is always `new Date().toISOString()`, so it is fixed-width,
zero-padded UTC and a lexicographic compare is a chronological compare. That
part is safe.

The trap is comparing against the wrong string. `dayKey()` yields a **local**
day. Building a bound as `"2026-08-31" + "T00:00:00.000Z"` describes the UTC
day instead. Verified in Europe/Berlin at UTC+2:

```
local midnight 2026-08-31 -> correct bound: 2026-08-30T22:00:00.000Z
naive concatenated bound:                   2026-08-31T00:00:00.000Z
entry at 00:30 local       ->               2026-08-30T22:30:00.000Z
  passes correct bound? true
  passes naive bound?   false   <-- silently drops the entry
```

The fix is not to widen the range and re-filter in JS. It is
`new Date(y, m - 1, d, 0, 0, 0, 0).toISOString()`, which reads its components
as local time and therefore yields the exact UTC instant of local midnight,
DST included. `dayStartIso`, `dayEndExclusiveIso` and `daysAgoStartIso` in
`src/lib/format.ts` are the only three places this reasoning lives.

The riskiest single edit in this work was `buildDayPlan`, because it changes
which rows get posted to Jira, and nothing covered it —
`jira-connection.spec.ts` only tests credentials.
`tests/e2e/booking-plan.spec.ts` now does, and its subject is the boundary,
not the happy path.

One behaviour is **preserved, not fixed**: an entry that starts before a
cutoff and ends after it is excluded by a `started_at` bound. That already
matched the rest of the app, which buckets by the start timestamp everywhere.

## Stage 4: retention that does not corrupt the balance

`cleanupOldEntries` deleted rows but left `overtimeBaselineMinutes` alone,
while `overtimeBalanceMinutes` sums over whatever remains plus that baseline.
Pressing "Einträge löschen" therefore changed the Überstundensaldo silently.

The deleted days' contribution now rolls into the baseline first — which is
exactly what the baseline is for. The delta is computed by running
`overtimeBalanceMinutes` over the doomed subset with a baseline of 0, so the
weekend rule is reproduced by construction rather than restated.

The cutoff snaps to local midnight. A rolling instant split the boundary day:
half its overtime rolled into the baseline and half stayed in the live sum.

The baseline update and the delete share one transaction. A crash between them
would have left the balance permanently wrong.

Deletion stays manual. Windowing removed the only reason to want it automatic,
and silent data loss in a personal time tracker is not worth the convenience.

## Not done, on purpose

Stage 5 of the plan was `useCallback` + `React.memo` on the three row
components, plus `content-visibility` on day sections. After stages 1 and 2 the
default view renders 22 day sections and the tick costs 1.1 ms/s, so there is
nothing left to win. Do it only if a profile says otherwise — and note that
`React.memo` buys exactly zero until the inline callbacks in `BuchenView` are
hoisted, because `onSubmitJira` closes over `day` and would need its signature
changed first.

**React Compiler** is not enabled. It would fix the stage 1 symptom by
auto-memoizing, but nothing else here, and it does not remove the need to move
the clock — `runningSeconds` genuinely changes every second either way. It
would add `babel-plugin-react-compiler` to a five-step Electron build chain
that currently produces a working exe. `npm run lint` already enforces
compiler *compatibility* (`preserve-manual-memoization`, `purity`,
`immutability`, `static-components` are all errors and all clean), so enabling
it later stays a one-line config change.

Also rejected: a virtualization library (fixes DOM only, leaves the payload
untouched, adds a dependency for a list scrolled maybe weekly); a materialised
per-day rollup table (the full five-year aggregate is ~4 ms of SQL, and a
stale rollup would silently corrupt the overtime balance); pure-SQL `SUM` for
worked seconds (`effectiveDurationSeconds` subtracts overlap with local
wall-clock break windows — that is business logic, not arithmetic); an archive
table (row count was never the bottleneck).

## Open questions

- `buildAllOpenPlan` in **force** mode at five years would attempt ~9,000
  sequential Jira POSTs (`src/lib/actions.ts`). Pre-existing, already guarded
  by the force-booking warnings in the UI, and out of scope here — but it is a
  real footgun that scales with the history.
- There is still **no unit test runner**. The local/UTC bound arithmetic and
  the overtime rollup delta are pure functions whose output is the number the
  user trusts about their own hours, and they are currently covered only
  through Playwright, which needs a full production build per run. A scoped
  Vitest over `src/lib/` — plus a second run under `TZ=America/New_York` to
  catch sign errors Europe/Berlin cannot — would be cheap and worth it.
- `src/components/buchen-view.tsx` is ~1,500 lines. The dialogs are the
  obvious extraction and are untouched by this work. Separate PR, separate
  justification.

## Related

- `scripts/db-bench.mjs` — seeds a realistic multi-year history. Use
  `JWL_DB_PATH` to point it at a scratch database, never the real one.
- `tests/e2e/history-window.spec.ts`, `booking-plan.spec.ts`, `retention.spec.ts`
- `src/lib/format.ts` — the three day-bound helpers the correctness of stages
  2, 3 and 4 all reduce to.
- `docs/feature-keyboard-shortcuts.md`
