import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  settings,
  timeEntries,
  type NewTimeEntry,
  type SettingsRow,
} from "../../../src/db/schema";

export const TEST_DB_PATH = path.resolve(
  __dirname,
  "../../..",
  "tests/.tmp/e2e.db",
);

export const MOCK_JIRA_URL = "http://127.0.0.1:4570";

type SettingsBaseline = Partial<typeof settings.$inferInsert>;

const BASELINE: SettingsBaseline = {
  id: 1,
  jiraUrl: MOCK_JIRA_URL,
  jiraUser: "tester@example.com",
  jiraToken: "test-token",
  jiraPassword: null,
  jiraAuthMode: "basic",
  jiraProjectKeys: JSON.stringify(["TEST", "DEMO", "TXR"]),
  allgemeinesIssueKey: "TEST-1",
  addAllgemeinesSummary: true,
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
};

function openDb() {
  if (!existsSync(TEST_DB_PATH)) {
    throw new Error(
      `Test DB not found at ${TEST_DB_PATH} — start Playwright so the Next.js webServer creates and migrates it.`,
    );
  }
  const sqlite = new Database(TEST_DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 10000");
  return { sqlite, db: drizzle(sqlite, { schema: { settings, timeEntries }, casing: "snake_case" }) };
}

async function withDb<T>(fn: (db: ReturnType<typeof openDb>["db"]) => T): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const handle = openDb();
    try {
      return fn(handle.db);
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (code !== "SQLITE_BUSY") throw err;
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    } finally {
      handle.sqlite.close();
    }
  }
  throw lastErr;
}

/** Wipe entries and reset settings to a known baseline pointing at the Jira mock. */
export async function resetDb(): Promise<void> {
  await withDb((db) => {
    db.delete(timeEntries).run();
    const existing = db.select().from(settings).where(eq(settings.id, 1)).get();
    if (existing) {
      db.update(settings).set(BASELINE).where(eq(settings.id, 1)).run();
    } else {
      db.insert(settings).values(BASELINE).run();
    }
  });
}

export async function getSettingsRow(): Promise<SettingsRow> {
  return withDb((db) => {
    const row = db.select().from(settings).where(eq(settings.id, 1)).get();
    if (!row) throw new Error("settings row missing");
    return row;
  });
}

export async function seedSettings(patch: SettingsBaseline): Promise<void> {
  await withDb((db) => {
    db.update(settings).set(patch).where(eq(settings.id, 1)).run();
  });
}

export async function seedEntries(rows: NewTimeEntry[]): Promise<void> {
  if (rows.length === 0) return;
  await withDb((db) => {
    for (const row of rows) {
      db.insert(timeEntries).values(row).run();
    }
  });
}

export async function getEntries() {
  return withDb((db) => db.select().from(timeEntries).all());
}
