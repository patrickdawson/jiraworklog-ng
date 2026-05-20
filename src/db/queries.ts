import { desc, eq, isNull } from "drizzle-orm";
import { db } from "./index";
import { settings, timeEntries, type SettingsRow, type TimeEntry } from "./schema";

/** Returns the single settings row, creating it with defaults on first use. */
export function getSettings(): SettingsRow {
  const existing = db
    .select()
    .from(settings)
    .where(eq(settings.id, 1))
    .get();
  if (existing) return existing;

  db.insert(settings).values({ id: 1 }).run();
  return db.select().from(settings).where(eq(settings.id, 1)).get()!;
}

/** All time entries, newest first. */
export function getAllEntries(): TimeEntry[] {
  return db.select().from(timeEntries).orderBy(desc(timeEntries.startedAt)).all();
}

/** The currently running entry (`endedAt = null`), if any. */
export function getRunningEntry(): TimeEntry | undefined {
  return db
    .select()
    .from(timeEntries)
    .where(isNull(timeEntries.endedAt))
    .get();
}

export function getEntryById(id: number): TimeEntry | undefined {
  return db.select().from(timeEntries).where(eq(timeEntries.id, id)).get();
}
