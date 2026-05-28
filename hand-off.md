# Playwright e2e hand-off

## What landed (PR-1 — foundation + critical happy paths)

Foundation + 7 passing scenarios across 3 spec files:

- `playwright.config.ts` — `next build && next start -p 4571`, `workers: 1`, `trace: retain-on-failure`, env injects `JWL_DB_PATH=./tests/.tmp/e2e.db` so the test run never touches `data/jiraworklog.db`.
- `tests/e2e/helpers/db.ts` — `resetDb`, `seedEntries`, `seedSettings`, `getSettingsRow`, `getEntries`. Opens the same SQLite the Next.js webServer writes to.
- `tests/e2e/mocks/jira-server.ts` + `global-setup.ts` / `global-teardown.ts` — Node `http` mock on `127.0.0.1:4570` with FIFO expectation queue and admin endpoints (`/__mock/expect`, `/__mock/reset`, `/__mock/received`). `globalSetup` also pre-migrates the test DB to avoid `SQLITE_BUSY` during Next.js's multi-worker page-data collection.
- `tests/e2e/helpers/jira-mock.ts` — `expectMyself`, `expectWorklog`, `resetMock`.
- Spec files: `smoke.spec.ts` (page boot + sidebar nav), `settings.spec.ts` (save round-trip + DB cross-check + reload), `jira-connection.spec.ts` (mocked 200 + mocked 401).

Commands:
- `npm run test:e2e` — full run, builds Next.js once
- `npm run test:e2e:ui` — UI mode for debugging

Status at hand-off: 7/7 green, lint clean, `npx tsc --noEmit` clean.

## Open actions — before merging PR-1

1. **Decide whether `playwright-report/` and `test-results/` should be artifacted.** Currently ignored — if CI is added later (PR-6), the workflow should upload these on failure.

## Known quirk (FIXED in PR-2)

~~The "Verbindung testen" button has no accessible name because `EinstellungenForm` wraps it in `<Field label="&nbsp;">`.~~ Fixed in PR-2: the button now renders inside a plain `<div>` (with an `aria-hidden` `&nbsp;` spacer for vertical alignment) instead of a `<label>`, so its accessible name is "Verbindung testen". The existing `jira-connection.spec.ts` still uses the `page.locator('button', { hasText: 'Verbindung testen' })` workaround (PR-2 made no test changes), but future specs can use `getByRole('button', { name: 'Verbindung testen' })` or `getByTestId('settings-test-connection')`.

## Next PRs (priority order)

### PR-2 — `data-testid` pass (DONE) ✅

All eight test IDs added; no test code changes; lint + `tsc --noEmit` clean; 7/7 existing e2e green.

| Component file | Element | `data-testid` | Notes |
|---|---|---|---|
| `src/components/buchen-view.tsx` | Timer toggle button | `timer-toggle` | raw `<button>` |
| `src/components/einstellungen-form.tsx` | "Speichern" button | `settings-save` | |
| `src/components/einstellungen-form.tsx` | "Verbindung testen" button | `settings-test-connection` | `<Field label="&nbsp;">` replaced with a plain `<div>` + `aria-hidden` spacer |
| `src/components/buchen-view.tsx` | per-day "Nach Jira buchen" button | `open-jira-submit` | the **per-day** button in `DaySection` (scope `kind: "day"`). The header "Nach Jira buchen (N)" button (scope `kind: "all"`) is **not** tagged. |
| `src/components/buchen-view.tsx` | Confirm button inside `JiraSubmitDialog` | `jira-submit-confirm` | "Jetzt buchen" |
| `src/components/buchen-view.tsx` | Each entry row | `entry-row` + `data-entry-id={entry.id}` | On single-entry `GroupRow`s (the row *is* the entry) **and** on expanded `EntryRow`s. Multi-entry group header rows are **not** tagged. |
| `src/components/buchen-view.tsx` | "+ Eintrag" / new manual entry button | `manual-entry-new` | via new `testId` prop on the shared `Button` |
| `src/components/auswertung-export.tsx` | PDF download button | `pdf-download` | the "Als PDF" button in `RangeControls` |

Implementation note: the shared `Button` component in `buchen-view.tsx` gained an optional `testId?: string` prop (applied as `data-testid`) so `manual-entry-new` and `jira-submit-confirm` could be tagged without raw-button refactors.

### PR-3 — timer + manual entry scenarios (DONE) ✅

Spec files: `timer.spec.ts` (2 tests), `manual-entry.spec.ts` (2 tests). 11/11 e2e green, lint + `tsc --noEmit` clean.

- **Timer persist**: start with `TEST-123 some work`, back-date the "Gestartet" start by 30 min via the edit field so the tracked duration clears the 60s discard threshold (no wall-clock wait), stop, assert the day-section row shows `TEST-123` and `getEntries()` has the entry with `endedAt` set.
- **Timer discard (<60s)**: start, stop immediately, assert the discard toast appears and no entry persisted (relies on `MIN_TRACKED_SECONDS = 60` in `src/lib/actions.ts`). The hand-off's two suggested approaches both used: discard case stops immediately (genuinely <60s); persist case uses the start-edit field rather than a refactor. No clock injection / code refactor was needed.
- **Manual create**: open the manual-entry dialog, fill description/Beginn/Ende, save, assert row visible + DB row.
- **Manual edit**: `seedEntries(...)` an existing entry, open edit dialog, change description, save, assert change reflected in UI + DB.

Gotcha discovered: `page.getByLabel("Beschreibung")` does **substring** matching and a page-wide search collided with the always-rendered TimerCard checkbox label "Auf Allgemeines buchen (gesamte **Beschreibung** wird als Worklog-Text verwendet)". Root-cause fix: the shared `Modal` in `buchen-view.tsx` now carries `role="dialog"` + `aria-modal="true"` + `aria-label={title}` (a real a11y improvement), and dialog specs scope field lookups with `page.getByRole("dialog").getByLabel(...)`. Future specs touching any modal (incl. PR-4's `JiraSubmitDialog`) should do the same rather than searching the whole page.

Also fixed in this PR: `eslint.config.mjs` now ignores `playwright-report/**`, `test-results/**`, and `tests/.tmp/**` — running the suite generates those gitignored artifacts and ESLint was linting the minified trace bundles (164 phantom errors).

### PR-4 — Jira submit (book to Jira) flows

Spec: `jira-submit.spec.ts`. Cover:
- **Happy path**: `seedEntries` with unsubmitted entries for a single day, open the "Nach Jira buchen" dialog, mock `POST /rest/api/2/issue/:key/worklog` → 201, confirm, assert the row shows the "gebucht" badge and `getEntries()` rows have `submittedAt` set.
- **Error path**: mock 400 with a Jira error payload — assert error UI, assert `submittedAt` is still null.
- Optional: assert the mock `/__mock/received` log contains the correct `timeSpent` / `started` / `Authorization` Basic header.

### PR-5 — Auswertung range filter + PDF download

Spec: `auswertung.spec.ts`. Cover:
- Seed entries across multiple days. Navigate `/auswertung`, switch range (Woche / Sprint / Monat / YTD), assert the KPI numbers update.
- Click the PDF download button, await `page.waitForEvent('download')`, save to a temp file, assert non-zero size and `application/pdf` magic bytes (`%PDF-`).

### PR-6 — CI workflow (deferred)

Add `.github/workflows/e2e.yml`. Cache `~/.cache/ms-playwright`, run `npm ci && npx playwright install --with-deps chromium && npm run test:e2e`, upload `playwright-report/` and `test-results/` on failure. Don't enable required-status-checks until the suite has been stable for a couple of weeks.

## Gotchas to remember

- **Test server is `next build && next start`, not `next dev`.** Plan: ~30-60s cold start per `npm run test:e2e`. For local iteration, leave `npm run test:e2e:ui` open — Playwright reuses the running server (`reuseExistingServer: true` outside CI).
- **`globalSetup` pre-migrates the test DB.** Without this, Next.js's build-time page-data collection spawns N workers, each calls `migrate()` on an empty DB → `SQLITE_BUSY`. Don't remove the pre-migration step.
- **DB baseline.** `resetDb()` resets `settings` row 1 to a fixed baseline (jira URL = mock, valid user/token, fixed project keys, dark/light theme = light, autoPauseEnabled = false, etc.). Tests that need a different baseline use `seedSettings(patch)` *after* `resetDb()`. See `tests/e2e/helpers/db.ts:BASELINE`.
- **Mock expectation matching.** FIFO on `{ method, path }` — no body or header matching. If a test needs to assert what was sent, query `GET /__mock/received` (not yet wrapped in a helper, easy to add).
- **The real database (`data/jiraworklog.db`) is never touched by e2e.** Verified at hand-off via mtime check.

## File map

```
playwright.config.ts
tests/
  .tmp/                      (gitignored — e2e.db lives here)
  e2e/
    smoke.spec.ts
    settings.spec.ts
    jira-connection.spec.ts
    helpers/
      db.ts
      jira-mock.ts
    mocks/
      jira-server.ts
      global-setup.ts
      global-teardown.ts
```
