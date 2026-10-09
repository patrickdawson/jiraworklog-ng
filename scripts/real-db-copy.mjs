#!/usr/bin/env node
// Copies the real desktop-app database into ./data/real-copy/ for local testing.
//
// The copy is made with SQLite's `VACUUM INTO`, which reads one consistent
// snapshot — safe while the desktop app is running and still writing to its WAL.
// The real file is opened read-only and never changed.
//
// The Jira credentials are cleared in the copy, so a click on "Buchen" while
// testing cannot book worklogs to the real Jira a second time.
//
// Usage:
//   npm run dev:realdb   # fresh copy, then the dev server on that copy
//
// Set JWL_REAL_DB_PATH to copy from somewhere else.

import Database from "better-sqlite3";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const SOURCE =
  process.env.JWL_REAL_DB_PATH ??
  join(process.env.APPDATA ?? "", "jiraworklog-ng", "jiraworklog.db");
const TARGET_DIR = "./data/real-copy";
const TARGET = join(TARGET_DIR, "jiraworklog.db");

if (!existsSync(SOURCE)) {
  console.error(`Real database not found: ${SOURCE}`);
  console.error("Set JWL_REAL_DB_PATH to its location and re-try.");
  process.exit(1);
}

mkdirSync(TARGET_DIR, { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(TARGET + suffix, { force: true });
}

const source = new Database(SOURCE, { readonly: true, fileMustExist: true });
source.prepare("VACUUM INTO ?").run(TARGET);
source.close();

const copy = new Database(TARGET);
copy
  .prepare(
    "UPDATE settings SET jira_token = NULL, jira_user = NULL, jira_password = NULL",
  )
  .run();
const { n } = copy.prepare("SELECT count(*) AS n FROM time_entries").get();
copy.close();

console.log(`Copied ${SOURCE}`);
console.log(`    to ${TARGET} (${n} entries, Jira credentials cleared)`);
