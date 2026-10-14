# JiraWorklog NG

## Code Quality

All changes must be free of lint and compile errors before being considered complete.

- **Lint:** `npm run lint`
- **Type check:** `npx tsc --noEmit`

Run both after every change and fix any errors before finishing.

## User Docs

User-facing features are described in two places. Keep both in sync.

- `README.md`, section "Features"
- `src/app/hilfe/page.tsx`, the in-app guide (sidebar "Hilfe", Electron menu "Hilfe → Anleitung")

When you add, change or remove a user-facing feature:

1. Update the matching section in both files.
2. Add an entry to `CHANGELOG.md` under `[Unreleased]`. The page `/hilfe/neu` ("Was ist neu") shows this file.
