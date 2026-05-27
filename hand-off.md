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

## Known quirk (worth fixing in PR-2)

The "Verbindung testen" button has no accessible name because `EinstellungenForm` wraps it in `<Field label="&nbsp;">` (the Field component renders the label inside a `<label>` element, and a `&nbsp;` becomes the button's accessible name). The test works around this with `page.locator('button', { hasText: 'Verbindung testen' })`. Fix idea for PR-2: render the button outside the `Field`, or change the label to a visually-hidden but accessible string — then the test can go back to `getByRole('button', { name: 'Verbindung testen' })`.

## Next PRs (priority order)

### PR-2 — `data-testid` pass (low-risk, no test changes)

Single PR, no test code changes. Add these eight test IDs:

| Component file | Element | `data-testid` |
|---|---|---|
| `src/components/buchen-view.tsx` | Timer toggle button | `timer-toggle` |
| `src/components/einstellungen-form.tsx` | "Speichern" button | `settings-save` |
| `src/components/einstellungen-form.tsx` | "Verbindung testen" button | `settings-test-connection` (and fix the `<Field label="&nbsp;">` wrapping while you're there) |
| `src/components/buchen-view.tsx` | "Nach Jira buchen" button | `open-jira-submit` |
| `src/components/buchen-view.tsx` | Confirm button inside `JiraSubmitDialog` | `jira-submit-confirm` |
| `src/components/buchen-view.tsx` | Each entry row | `entry-row` + `data-entry-id={entry.id}` |
| `src/components/buchen-view.tsx` | "+ Eintrag" / new manual entry button | `manual-entry-new` |
| `src/components/auswertung-export.tsx` | PDF download button | `pdf-download` |

### PR-3 — timer + manual entry scenarios

Spec files: `timer.spec.ts`, `manual-entry.spec.ts`. Cover:
- Start timer with description containing an issue key (e.g. `TEST-123 some work`), wait a few seconds, stop, assert the entry exists in the day section and `getEntries()` shows the right `jiraIssueKey`.
- Start, stop immediately (<60s) — assert no entry persisted (relies on `MIN_TRACKED_SECONDS = 60` in `src/lib/actions.ts`).
- Open the manual-entry dialog, fill start/end and description, save, assert row visible + DB has it.
- `seedEntries(...)` an existing entry, open edit dialog, change description, save, assert change reflected.

For time-sensitive flows: prefer `seedEntries` + UI assertion over real wall-clock waits. For the `<60s` case, time-travel is messier — either accept a few-seconds real wait or refactor the action to accept an injected clock (out of scope for this PR).

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
