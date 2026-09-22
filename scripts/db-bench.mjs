#!/usr/bin/env node
// Seed / unseed a realistic multi-year history for performance measurement.
//
// `db-sample.mjs` seeds 27 hand-written rows onto ~27 calendar days. That is
// right for eyeballing the UI and useless for measuring how the app scales,
// which needs entries spread across hundreds of *distinct days* — the day count
// is what drives the payload and the rendered tree, not the row count.
//
// Rows are prefixed [BENCH], deliberately NOT [SAMPLE]: `npm run db:unseed`
// must not wipe a benchmark data set halfway through a measurement.
//
// Usage:
//   node scripts/db-bench.mjs seed [--days 365] [--per-day 7.4] [--seed 42]
//   node scripts/db-bench.mjs clean
//
// Point it at a scratch database, never your real one:
//   JWL_DB_PATH=./tests/.tmp/bench.db node scripts/db-bench.mjs seed --days 365

import Database from "better-sqlite3";

const DB_PATH = process.env.JWL_DB_PATH ?? "./data/jiraworklog.db";
const BENCH_PREFIX = "[BENCH]";

const command = process.argv[2];
if (command !== "seed" && command !== "clean") {
  console.error(
    "Usage: node scripts/db-bench.mjs <seed|clean> [--days N] [--per-day N] [--seed N]",
  );
  process.exit(1);
}

function flag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const DAYS = Math.max(1, Math.round(flag("days", 365)));
const PER_DAY = Math.max(1, flag("per-day", 7.4));
const SEED = Math.round(flag("seed", 42));

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
    .run(`${BENCH_PREFIX}%`);
  console.log(`Removed ${result.changes} benchmark entries.`);
  process.exit(0);
}

// ──────────────────────────────── seed ────────────────────────────────

/**
 * Deterministic PRNG (mulberry32). A before/after comparison against two
 * different random data sets measures nothing, so the data must be reproducible
 * from the `--seed` value alone.
 */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/**
 * Build the timestamp from a LOCAL date, exactly like `isoLocal` in
 * db-sample.mjs. A bench seed that wrote UTC-constructed timestamps would hide
 * the local-vs-UTC day-boundary bug that the range queries exist to avoid.
 */
function isoLocal(y, m, d, h, min) {
  return new Date(y, m - 1, d, h, min, 0).toISOString();
}

const PROJECTS = ["TXR", "TXAT", "TXPIV", "TXRS", "TX4B", "TX3B", "TXAM", "PQX", "DS"];
const TASKS = [
  "Review der offenen PRs",
  "Bugfix in der Auth-Middleware",
  "Testabdeckung erhoeht",
  "Refactoring des Report-Moduls",
  "Pairing zur Pipeline-Migration",
  "Edge Cases der Pagination",
  "Reproduzierbares Test-Setup",
  "Kundenfeedback eingearbeitet",
];
const ALLGEMEINES = [
  "Standup, E-Mails, Slack-Threads",
  "Architecture Review Meeting",
  "1:1 mit Lead",
  "Team Retro",
  "Sprint Planning",
];
const CATEGORIES = ["Projektorganisation", "Implementierung", "QA", "Release"];

/** A few descriptions recur, so DescGroup merging does realistic work. */
function concreteDescription() {
  return `${pick(PROJECTS)}-${between(100, 199)} ${pick(TASKS)}`;
}

const insert = db.prepare(`
  INSERT INTO time_entries
    (description, started_at, ended_at, submitted_at, is_allgemeines, category)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const today = new Date();
today.setHours(0, 0, 0, 0);

let rows = 0;
let seededDays = 0;

// One transaction around everything. 9,000+ individual statements against a WAL
// database takes minutes; inside a transaction it is under a second.
db.transaction(() => {
  for (let back = DAYS - 1; back >= 0; back--) {
    const day = new Date(today);
    day.setDate(day.getDate() - back);
    const weekday = day.getDay();
    if (weekday === 0 || weekday === 6) continue; // weekends stay empty

    const y = day.getFullYear();
    const m = day.getMonth() + 1;
    const d = day.getDate();
    seededDays++;

    // Vary around the requested average so day totals are not all identical.
    const count = Math.max(1, Math.round(PER_DAY + (rnd() * 4 - 2)));

    let cursorMinutes = between(8 * 60, 9 * 60 + 30);
    for (let i = 0; i < count; i++) {
      const duration = between(25, 120);
      const startMin = cursorMinutes;
      const endMin = startMin + duration;
      cursorMinutes = endMin + between(5, 20);

      const isAllgemeines = rnd() < 0.15;
      const description = isAllgemeines
        ? pick(ALLGEMEINES)
        : concreteDescription();
      // Most history is already booked; leaving it all open would make a stray
      // force-booking run try to post thousands of worklogs to Jira.
      const submitted = rnd() < 0.9;

      insert.run(
        `${BENCH_PREFIX} ${description}`,
        isoLocal(y, m, d, Math.floor(startMin / 60), startMin % 60),
        isoLocal(y, m, d, Math.floor(endMin / 60), endMin % 60),
        submitted && !isAllgemeines
          ? isoLocal(y, m, d, 23, 0)
          : null,
        isAllgemeines ? 1 : 0,
        isAllgemeines ? pick(CATEGORIES) : null,
      );
      rows++;
    }

    // Deliberate day-boundary rows once a month: a wrong local/UTC bound drops
    // the 00:15 entry and mis-files the one that crosses midnight.
    if (d === 15) {
      insert.run(
        `${BENCH_PREFIX} ${pick(PROJECTS)}-900 Frueher Start kurz nach Mitternacht`,
        isoLocal(y, m, d, 0, 15),
        isoLocal(y, m, d, 1, 30),
        isoLocal(y, m, d, 23, 0),
        0,
        null,
      );
      insert.run(
        `${BENCH_PREFIX} ${pick(PROJECTS)}-901 Spaete Session ueber Mitternacht`,
        isoLocal(y, m, d, 23, 40),
        isoLocal(y, m, d + 1, 0, 50),
        isoLocal(y, m, d + 1, 23, 0),
        0,
        null,
      );
      rows += 2;
    }
  }
})();

const distinctDays = db
  .prepare(
    "SELECT count(DISTINCT substr(started_at, 1, 10)) AS c FROM time_entries WHERE description LIKE ?",
  )
  .get(`${BENCH_PREFIX}%`).c;
const total = db.prepare("SELECT count(*) AS c FROM time_entries").get().c;
const pageSize = db.pragma("page_size", { simple: true });
const pageCount = db.pragma("page_count", { simple: true });

console.log(
  `Inserted ${rows} benchmark entries over ${seededDays} weekdays ` +
    `(${DAYS} calendar days back, seed ${SEED}).`,
);
console.log(`Distinct UTC day buckets: ${distinctDays}`);
console.log(`Rows in time_entries now: ${total}`);
console.log(`DB size: ${((pageSize * pageCount) / 1048576).toFixed(2)} MB`);
console.log(`All benchmark descriptions are prefixed with "${BENCH_PREFIX}".`);
console.log(`Remove with: node scripts/db-bench.mjs clean`);
