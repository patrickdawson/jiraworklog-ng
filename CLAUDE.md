# JiraWorklog NG

## Code Quality

All changes must be free of lint, compile and test errors before being considered complete.

- **Check:** `npm run tauri:check` (clippy `-D warnings`, Rust tests, UI lint, UI and E2E type check)
- **E2E:** `npm run tauri:e2e` (WebdriverIO + tauri-driver; run it for UI or command changes)

Run the check after every change and fix any errors before finishing. When Tauri commands or their types change, regenerate `ui/src/bindings.ts` with `npm run tauri:bindings` and commit it.

## User Docs

User-facing features are described in two places. Keep both in sync.

- `README.md`, section "Features"
- `ui/src/pages/hilfe.tsx`, the in-app guide (sidebar "Hilfe", menu "Hilfe → Anleitung")

When you add, change or remove a user-facing feature:

1. Update the matching section in both files.
2. Add an entry to `CHANGELOG.md` under `[Unreleased]`. The page `/hilfe/neu` ("Was ist neu") shows this file.
