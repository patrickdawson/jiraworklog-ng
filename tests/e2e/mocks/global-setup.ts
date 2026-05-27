import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { TEST_DB_PATH } from "../helpers/db";
import { startJiraMock, type JiraMockHandle } from "./jira-server";

const PORT = 4570;

declare global {
  var __JIRA_MOCK__: JiraMockHandle | undefined;
}

function migrateTestDb() {
  mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  const sqlite = new Database(TEST_DB_PATH);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 10000");
    const db = drizzle(sqlite);
    const migrationsFolder = path.resolve(__dirname, "../../..", "drizzle");
    migrate(db, { migrationsFolder });
  } finally {
    sqlite.close();
  }
}

export default async function globalSetup(): Promise<void> {
  migrateTestDb();
  if (!globalThis.__JIRA_MOCK__) {
    globalThis.__JIRA_MOCK__ = await startJiraMock(PORT);
  }
}
