// Seeds and reads the test database (target/e2e/run/jiraworklog.db) next to
// the running app, as tests/e2e/helpers/db.ts did with drizzle. Plain SQL on
// better-sqlite3 (a dependency of this package), so nothing here needs the old
// Next app. The app creates and migrates the file itself when it starts.
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { MOCK_JIRA_URL, TEST_DB_PATH } from "./paths.ts";

export { MOCK_JIRA_URL, TEST_DB_PATH };

/** A row of `time_entries`, in the camel case the old drizzle helpers used. */
export type TimeEntry = {
  id: number;
  description: string;
  startedAt: string;
  endedAt: string | null;
  submittedAt: string | null;
  jiraIssueKey: string | null;
  isAllgemeines: boolean;
  category: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewTimeEntry = Partial<Omit<TimeEntry, "startedAt">> & {
  startedAt: string;
};

export type SettingsRow = {
  id: number;
  regularWorkMinutes: number;
  dailyTargetMinutes: number;
  breaks: string;
  autoPauseEnabled: boolean;
  bookingMode: string;
  dataRetentionDays: number;
  jiraUrl: string;
  jiraProjectKeys: string;
  jiraAuthMode: string;
  jiraToken: string | null;
  jiraUser: string | null;
  jiraPassword: string | null;
  overtimeBaselineMinutes: number;
  themeMode: string;
  sprintAnchorDate: string;
  sprintLengthDays: number;
  concreteIssueTargetPercent: number;
  overtimeCorridorCenterHours: number;
  overtimeCorridorRangeHours: number;
  awayCheckEnabled: boolean;
  recentEntriesLimit: number;
  updatedAt: string;
};

type SettingsPatch = Partial<SettingsRow>;

const BOOLEAN_COLUMNS = new Set(["is_allgemeines", "auto_pause_enabled", "away_check_enabled"]);

const BASELINE: SettingsPatch = {
  id: 1,
  jiraUrl: MOCK_JIRA_URL,
  jiraUser: "tester@example.com",
  jiraToken: "test-token",
  jiraPassword: null,
  jiraAuthMode: "basic",
  jiraProjectKeys: JSON.stringify(["TEST", "DEMO", "TXR"]),
  themeMode: "light",
  bookingMode: "grouped",
  autoPauseEnabled: false,
  breaks: "[]",
  regularWorkMinutes: 420,
  dailyTargetMinutes: 420,
  dataRetentionDays: 90,
  overtimeBaselineMinutes: 0,
  sprintAnchorDate: "2026-01-07",
  sprintLengthDays: 14,
  concreteIssueTargetPercent: 60,
  overtimeCorridorCenterHours: 100,
  overtimeCorridorRangeHours: 40,
  awayCheckEnabled: true,
  recentEntriesLimit: 15,
};

const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** JS values → SQLite values (booleans as 0/1, as drizzle stored them). */
function toRow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[toSnake(k)] = typeof v === "boolean" ? (v ? 1 : 0) : v;
  }
  return out;
}

function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[toCamel(k)] = BOOLEAN_COLUMNS.has(k) ? v === 1 : v;
  }
  return out as T;
}

function openDb(): Database.Database {
  if (!existsSync(TEST_DB_PATH)) {
    throw new Error(
      `Test DB not found at ${TEST_DB_PATH}: the app creates it on start, so a session must be open.`,
    );
  }
  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 10000");
  return sqlite;
}

async function withDb<T>(fn: (db: Database.Database) => T): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const db = openDb();
    try {
      return fn(db);
    } catch (err) {
      lastErr = err;
      if ((err as { code?: string })?.code !== "SQLITE_BUSY") throw err;
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    } finally {
      db.close();
    }
  }
  throw lastErr;
}

function insert(db: Database.Database, table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => `@${c}`).join(", ")})`,
  ).run(row);
}

function updateSettingsRow(db: Database.Database, patch: SettingsPatch): void {
  const row = toRow(patch);
  delete row.id;
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  db.prepare(`UPDATE settings SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = 1`).run(
    row,
  );
}

/** Wipe entries and reset settings to a known baseline pointing at the Jira mock. */
export async function resetDb(): Promise<void> {
  await withDb((db) => {
    db.transaction(() => {
      db.prepare("DELETE FROM time_entries").run();
      db.prepare("DELETE FROM group_colors").run();
      const existing = db.prepare("SELECT id FROM settings WHERE id = 1").get();
      if (existing) updateSettingsRow(db, BASELINE);
      else insert(db, "settings", toRow(BASELINE));
    })();
  });
}

export async function getSettingsRow(): Promise<SettingsRow> {
  return withDb((db) => {
    const row = db.prepare("SELECT * FROM settings WHERE id = 1").get();
    if (!row) throw new Error("settings row missing");
    return fromRow<SettingsRow>(row as Record<string, unknown>);
  });
}

export async function seedSettings(patch: SettingsPatch): Promise<void> {
  await withDb((db) => updateSettingsRow(db, patch));
}

export async function seedEntries(rows: NewTimeEntry[]): Promise<void> {
  if (rows.length === 0) return;
  // One transaction: specs seed up to a few dozen rows at once.
  await withDb((db) => {
    db.transaction(() => {
      for (const row of rows) insert(db, "time_entries", toRow(row));
    })();
  });
}

export async function getGroupColorRows(): Promise<
  { groupKey: string; color: string; updatedAt: string }[]
> {
  return withDb((db) =>
    db
      .prepare("SELECT * FROM group_colors")
      .all()
      .map((r) => fromRow(r as Record<string, unknown>)),
  );
}

export async function getEntries(): Promise<TimeEntry[]> {
  return withDb((db) =>
    db
      .prepare("SELECT * FROM time_entries")
      .all()
      .map((r) => fromRow<TimeEntry>(r as Record<string, unknown>)),
  );
}
