#!/usr/bin/env node
// Seed / unseed example time entries for local testing.
//
// Every sample entry's `description` starts with the SAMPLE_PREFIX below, so
// `clean` can remove them without touching real data.
//
// Usage:
//   npm run db:seed      # insert sample entries (current + previous month)
//   npm run db:unseed    # remove ALL rows whose description starts with the prefix

import Database from "better-sqlite3";

const DB_PATH = process.env.JWL_DB_PATH ?? "./data/jiraworklog.db";
const SAMPLE_PREFIX = "[SAMPLE]";

const command = process.argv[2];
if (command !== "seed" && command !== "clean") {
  console.error("Usage: node scripts/db-sample.mjs <seed|clean>");
  process.exit(1);
}

const db = new Database(DB_PATH);

const tableExists = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='time_entries'",
  )
  .get();
if (!tableExists) {
  console.error(
    `time_entries table not found in ${DB_PATH}. Start the app once (\`npm run dev\`) so migrations run, then re-try.`,
  );
  process.exit(1);
}

if (command === "clean") {
  const result = db
    .prepare("DELETE FROM time_entries WHERE description LIKE ?")
    .run(`${SAMPLE_PREFIX}%`);
  console.log(`Removed ${result.changes} sample entries.`);
  process.exit(0);
}

// ──────────────────────────────── seed ────────────────────────────────

const now = new Date();
const Y = now.getFullYear();
const M = now.getMonth() + 1; // 1..12
const prev = new Date(Y, M - 2, 1);
const PY = prev.getFullYear();
const PM = prev.getMonth() + 1;

function isoLocal(y, m, d, h, min) {
  return new Date(y, m - 1, d, h, min, 0).toISOString();
}

function lastDayOfMonth(y, m) {
  return new Date(y, m, 0).getDate();
}

// Map calendar day → working weekday (Mon..Fri). If `day` lands on a weekend,
// nudge it forward to the next Monday so the seed always lives on a weekday.
function workday(y, m, day) {
  const d = new Date(y, m - 1, day);
  const wd = d.getDay();
  if (wd === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  else if (wd === 6) d.setDate(d.getDate() + 2); // Sat → Mon
  return d.getDate();
}

const submittedAt = new Date(now.getTime() - 86_400_000).toISOString();

// [day, startH, startM, endH, endM, isAllgemeines, description, submitted]
//   day is a target calendar day; weekend days are auto-nudged.
const CURRENT_MONTH_SAMPLES = [
  [2,  9,  0, 12, 30, false, "TXR-1042 Sprint Planning vorbereitet und moderiert", true],
  [2, 13, 15, 17, 30, false, "TXAT-203 Refactoring der Auth-Middleware", true],
  [3,  8, 45, 12,  0, false, "Pairing mit JK TXPIV-310 Tests gruen bekommen", true],
  [3, 13,  0, 16, 45, false, "DS-77 Data Pipeline Review", true],
  [4,  9, 30, 12, 15, true,  "Standup, E-Mails, Slack-Threads", true],
  [4, 13,  0, 17,  0, false, "TXRS-12 Implementation Plan finalisiert", true],
  [5,  8, 30, 12,  0, false, "TX4B-88 Build Pipeline Migration", false],
  [5, 13, 30, 17,  0, true,  "Architecture Review Meeting", false],
  [8,  9,  0, 12, 30, false, "TXAM-15 Onboarding Docs fuer neues Teammitglied", true],
  [8, 13,  0, 17, 15, false, "PQX-501 Kundengespraech und Follow-up", true],
  [9,  9, 15, 12,  0, false, "TXR-1098 Bug Investigation: Zero-Duration Entries", true],
  [9, 13,  0, 17,  0, false, "TX3B-43 PR Review Marathon", true],
  [10, 9, 30, 13,  0, true,  "Team Retro Q2", true],
  [10,14,  0, 17, 30, false, "TXAT-205 Reset Password Flow", false],
  [11, 9,  0, 12,  0, false, "Memo ohne Issue-Key, interne Klaerung mit Lead", false],
  [11,13,  0, 17,  0, false, "TXPIV-320 Pagination Edge Cases", true],
  [15, 9,  0, 12, 30, false, "DS-82 Migration Script Staging Run", true],
  [15,13, 30, 17,  0, true,  "1:1 mit Lead, Status-Update, kleinere Doku-Updates", true],
  [16, 9, 30, 12,  0, false, "TXR-1110 Sehr lange Beschreibung mit vielen Worten, um die Ellipsis-Logik in der Kommentar-Spalte zu testen, damit der Bericht nicht ueberlaeuft und die Tabelle sauber bleibt auch bei langen Texten", true],
  [16,13,  0, 17,  0, false, "TXAM-22 Documentation Polish", false],
  [17, 8, 45, 12, 15, false, "TXR-1112 Reproducible Test Setup", true],
  [17,13, 30, 17,  0, false, "TXAT-208 Code Review fuer JK", true],
];

const PREV_MONTH_SAMPLES = [
  [10, 9,  0, 12, 30, false, "TXR-1000 Vorbereitung Vormonat", true],
  [10,13,  0, 17,  0, false, "TXAT-180 Vorgaengerticket", true],
  [11, 9, 30, 12,  0, true,  "Diverse Kleinigkeiten Vormonat", true],
  [11,13,  0, 16, 45, false, "DS-60 Letzter Tag in einer Liste", true],
];

const insert = db.prepare(`
  INSERT INTO time_entries
    (description, started_at, ended_at, submitted_at, is_allgemeines)
  VALUES (?, ?, ?, ?, ?)
`);

let count = 0;
db.transaction(() => {
  const seedBatch = (y, m, batch) => {
    for (const [day, sh, sm, eh, em, isA, desc, sub] of batch) {
      const d = workday(y, m, Math.min(day, lastDayOfMonth(y, m)));
      const startIso = isoLocal(y, m, d, sh, sm);
      const endIso = isoLocal(y, m, d, eh, em);
      insert.run(
        `${SAMPLE_PREFIX} ${desc}`,
        startIso,
        endIso,
        sub ? submittedAt : null,
        isA ? 1 : 0,
      );
      count++;
    }
  };

  seedBatch(Y, M, CURRENT_MONTH_SAMPLES);
  seedBatch(PY, PM, PREV_MONTH_SAMPLES);

  // Cross-month entry: started on the last day of the previous month at 23:30,
  // ended on day 1 of the current month at 00:45. It must appear in the
  // *previous* month's PDF (entries are placed by their start date).
  const lastPrev = lastDayOfMonth(PY, PM);
  const crossStart = isoLocal(PY, PM, lastPrev, 23, 30);
  const crossEnd = isoLocal(Y, M, 1, 0, 45);
  insert.run(
    `${SAMPLE_PREFIX} TXR-9999 Cross-month night session (started prev. month)`,
    crossStart,
    crossEnd,
    submittedAt,
    0,
  );
  count++;
})();

console.log(
  `Inserted ${count} sample entries ` +
    `(${CURRENT_MONTH_SAMPLES.length} in ${Y}-${String(M).padStart(2, "0")}, ` +
    `${PREV_MONTH_SAMPLES.length} in ${PY}-${String(PM).padStart(2, "0")}, ` +
    `+1 cross-month).`,
);
console.log(`All sample descriptions are prefixed with "${SAMPLE_PREFIX}".`);
console.log(`Remove with: npm run db:unseed`);
