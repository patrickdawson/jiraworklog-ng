import { and, count, desc, eq, gte, isNotNull, isNull, lt, lte, type SQL } from "drizzle-orm";
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

/**
 * Every time entry, newest first.
 *
 * Unbounded on purpose, and therefore only for the explicit "Alles anzeigen"
 * path. Everything else takes a range — the history grows forever, so a caller
 * that loads all of it pays a cost that grows with it. Use `getEntriesFrom` or
 * `getEntriesBetween` instead; both are served directly by
 * `time_entries_started_idx`.
 */
export function getAllEntries(): TimeEntry[] {
  return db.select().from(timeEntries).orderBy(desc(timeEntries.startedAt)).all();
}

/** Entries with `started_at >= fromIso`, newest first. */
export function getEntriesFrom(fromIso: string): TimeEntry[] {
  return db
    .select()
    .from(timeEntries)
    .where(gte(timeEntries.startedAt, fromIso))
    .orderBy(desc(timeEntries.startedAt))
    .all();
}

/**
 * Entries within a range, newest first. `toIso` is inclusive by default, which
 * matches `resolveRange`, whose `to` is the last millisecond of the local day.
 * Pass `exclusive` for a half-open `[from, to)` bound built from
 * `dayEndExclusiveIso`.
 */
export function getEntriesBetween(
  fromIso: string,
  toIso: string,
  opts: { exclusive?: boolean } = {},
): TimeEntry[] {
  const upper = opts.exclusive
    ? lt(timeEntries.startedAt, toIso)
    : lte(timeEntries.startedAt, toIso);
  return db
    .select()
    .from(timeEntries)
    .where(and(gte(timeEntries.startedAt, fromIso), upper))
    .orderBy(desc(timeEntries.startedAt))
    .all();
}

/**
 * The columns a per-day duration aggregate actually needs. Narrowing the
 * projection is what makes "sum over the whole history" affordable: the
 * cumulative overtime balance genuinely needs every day ever tracked, but it
 * never needs the description, the issue key, or the audit timestamps.
 */
export type DurationRow = Pick<
  TimeEntry,
  "startedAt" | "endedAt" | "isAllgemeines"
>;

const durationColumns = {
  startedAt: timeEntries.startedAt,
  endedAt: timeEntries.endedAt,
  isAllgemeines: timeEntries.isAllgemeines,
};

/** Lean projection over every finished entry, for per-day aggregates. */
export function getFinishedDurations(): DurationRow[] {
  return db
    .select(durationColumns)
    .from(timeEntries)
    .where(isNotNull(timeEntries.endedAt))
    .all();
}

/** The same, restricted to entries that started before `beforeIso`. */
export function getFinishedDurationsBefore(beforeIso: string): DurationRow[] {
  return db
    .select(durationColumns)
    .from(timeEntries)
    .where(
      and(
        isNotNull(timeEntries.endedAt),
        lt(timeEntries.startedAt, beforeIso),
      ),
    )
    .all();
}

/**
 * Finished, non-Allgemeines entries that can be sent to Jira. In force mode
 * already-submitted entries count again.
 *
 * Kept as one helper so the list and the count can never disagree — the header
 * button shows the count and then books whatever the list returns.
 */
function bookablePredicate(includeSubmitted: boolean): SQL | undefined {
  return and(
    isNotNull(timeEntries.endedAt),
    eq(timeEntries.isAllgemeines, false),
    includeSubmitted ? undefined : isNull(timeEntries.submittedAt),
  );
}

export function getBookableEntries(includeSubmitted: boolean): TimeEntry[] {
  return db
    .select()
    .from(timeEntries)
    .where(bookablePredicate(includeSubmitted))
    .orderBy(desc(timeEntries.startedAt))
    .all();
}

/** Bookable entries whose start falls in the half-open range `[from, to)`. */
export function getBookableEntriesBetween(
  fromIso: string,
  toIsoExclusive: string,
  includeSubmitted: boolean,
): TimeEntry[] {
  return db
    .select()
    .from(timeEntries)
    .where(
      and(
        bookablePredicate(includeSubmitted),
        gte(timeEntries.startedAt, fromIso),
        lt(timeEntries.startedAt, toIsoExclusive),
      ),
    )
    .orderBy(desc(timeEntries.startedAt))
    .all();
}

export function countBookableEntries(includeSubmitted: boolean): number {
  return (
    db
      .select({ value: count() })
      .from(timeEntries)
      .where(bookablePredicate(includeSubmitted))
      .get()?.value ?? 0
  );
}

/** How many entries start strictly before `beforeIso` — the hidden-history count. */
export function countEntriesBefore(beforeIso: string): number {
  return (
    db
      .select({ value: count() })
      .from(timeEntries)
      .where(lt(timeEntries.startedAt, beforeIso))
      .get()?.value ?? 0
  );
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
