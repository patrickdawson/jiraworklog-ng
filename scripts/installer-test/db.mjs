// Database helper for installer-test.ps1. Uses Node's built-in SQLite, so the
// CI job needs no npm install.
//
//   node db.mjs seed  <db>   two finished entries + theme "dark"
//   node db.mjs state <db>   one JSON line: what the checks compare
//
// Both work while an app has the file open (WAL, busy timeout).
import { DatabaseSync } from "node:sqlite";

const [cmd, path] = process.argv.slice(2);
if (!cmd || !path) {
  console.error("usage: node db.mjs seed|state <db>");
  process.exit(2);
}

const db = new DatabaseSync(path, { readOnly: cmd === "state", timeout: 10_000 });

const hasTable = (name) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
const hasColumn = (table, column) =>
  db.prepare(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = ?`).get(column) !== undefined;

if (cmd === "seed") {
  const insert = db.prepare(
    "INSERT INTO time_entries (description, started_at, ended_at, is_allgemeines) VALUES (?, ?, ?, ?)",
  );
  insert.run("TXR-1 Installer test", "2026-11-10T07:00:00.000Z", "2026-11-10T09:00:00.000Z", 0);
  insert.run("Meeting", "2026-11-10T09:00:00.000Z", "2026-11-10T09:30:00.000Z", 1);
  db.exec("INSERT OR IGNORE INTO settings (id) VALUES (1)");
  db.exec("UPDATE settings SET theme_mode = 'dark' WHERE id = 1");
} else if (cmd === "state") {
  const ready = hasTable("time_entries") && hasTable("settings");
  const settings = ready ? db.prepare("SELECT * FROM settings WHERE id = 1").get() : undefined;
  const state = {
    ready,
    entries: ready ? db.prepare("SELECT COUNT(*) AS n FROM time_entries").get().n : null,
    descriptions: ready
      ? db.prepare("SELECT description FROM time_entries ORDER BY id").all().map((r) => r.description)
      : [],
    themeMode: settings?.theme_mode ?? null,
    recentEntriesLimit:
      ready && hasColumn("settings", "recent_entries_limit") ? (settings?.recent_entries_limit ?? null) : null,
    lastMigration: hasTable("__drizzle_migrations")
      ? Number(db.prepare('SELECT MAX(CAST(created_at AS INTEGER)) AS w FROM "__drizzle_migrations"').get().w)
      : null,
  };
  console.log(JSON.stringify(state));
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
db.close();
