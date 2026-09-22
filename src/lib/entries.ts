import type { AllgemeinesCategory, TimeEntry } from "@/db/schema";
import { dayKey, dayLabel } from "./format";
import { parseDescription } from "./parse-description";
import { effectiveDurationSeconds, type BreakWindow } from "./work-time";

export type EntryView = {
  id: number;
  description: string;
  startedAt: string;
  endedAt: string | null;
  submittedAt: string | null;
  jiraIssueKey: string | null;
  issueKey: string | undefined;
  comment: string;
  effectiveSeconds: number;
  isAllgemeines: boolean;
  category: AllgemeinesCategory | null;
};

export type DescGroup = {
  description: string;
  issueKey: string | undefined;
  entries: EntryView[];
  totalSeconds: number;
  allSubmitted: boolean;
  isAllgemeines: boolean;
  category: AllgemeinesCategory | null;
};

export type DayGroup = {
  dayKey: string;
  label: string;
  groups: DescGroup[];
  totalSeconds: number;
  unsubmittedCount: number;
};

export type EntryAnalysisConfig = {
  projectKeys: string[];
  breaks: BreakWindow[];
  autoPauseEnabled: boolean;
};

/** How far back the "recently used" suggestions look. */
export const RECENT_WINDOW_DAYS = 30;

/**
 * How many days of history the Buchen page shows before the user asks for more.
 *
 * Deliberately the same window as the suggestions: `buildRecentEntries` is fed
 * from the day groups the page already built, so a shorter display window would
 * silently truncate the timer dropdown. One cutoff, one query, one class of bug
 * that cannot happen.
 */
export const DEFAULT_HISTORY_DAYS = RECENT_WINDOW_DAYS;
/** How many suggestions the timer dropdown offers at most. */
export const RECENT_LIMIT = 8;

/**
 * One distinct piece of work the user can pick up again, merged across days.
 * Every field is derived from *finished* entries only, so nothing here depends
 * on a clock — the value is safe to compute on the server and hand to the
 * client without a hydration mismatch.
 */
export type RecentEntry = {
  /** `descGroupKey` of the merged group; also the React key. */
  key: string;
  /** Replayed verbatim into `startTimer`. */
  description: string;
  issueKey: string | undefined;
  isAllgemeines: boolean;
  category: AllgemeinesCategory | null;
  /** Number of finished entries inside the window. */
  count: number;
  totalSeconds: number;
  /** ISO timestamp of the newest entry in the group; the primary sort key. */
  lastStartedAt: string;
};

/**
 * Identity of "the same piece of work": the Allgemeines flag and category plus
 * the trimmed description. Case-sensitive on purpose — the description is
 * replayed verbatim into `startTimer`, so two spellings are two entries.
 */
export function descGroupKey(v: {
  isAllgemeines: boolean;
  category: AllgemeinesCategory | null;
  description: string;
}): string {
  return `${
    v.isAllgemeines ? `A:${v.category ?? ""}` : "P"
  }|${v.description.trim()}`;
}

export function toEntryView(
  entry: TimeEntry,
  cfg: EntryAnalysisConfig,
): EntryView {
  const parsed = parseDescription(entry.description, cfg.projectKeys);
  const effectiveSeconds = entry.endedAt
    ? effectiveDurationSeconds(
        entry.startedAt,
        entry.endedAt,
        cfg.breaks,
        cfg.autoPauseEnabled,
      )
    : 0;
  return {
    id: entry.id,
    description: entry.description,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    submittedAt: entry.submittedAt,
    jiraIssueKey: entry.jiraIssueKey,
    issueKey: parsed.issueKey,
    comment: parsed.comment,
    effectiveSeconds,
    isAllgemeines: entry.isAllgemeines,
    category: entry.category,
  };
}

/** Groups finished entries by day, then by identical description. */
export function buildDayGroups(
  entries: TimeEntry[],
  cfg: EntryAnalysisConfig,
): DayGroup[] {
  const finished = entries.filter((e) => e.endedAt !== null);
  const byDay = new Map<string, EntryView[]>();

  for (const entry of finished) {
    const view = toEntryView(entry, cfg);
    const key = dayKey(view.startedAt);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(view);
    else byDay.set(key, [view]);
  }

  const days: DayGroup[] = [];
  for (const [key, dayEntries] of byDay) {
    const byDesc = new Map<string, EntryView[]>();
    for (const view of dayEntries) {
      const descKey = descGroupKey(view);
      const bucket = byDesc.get(descKey);
      if (bucket) bucket.push(view);
      else byDesc.set(descKey, [view]);
    }

    const groups: DescGroup[] = [...byDesc.values()].map((es) => {
      es.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
      return {
        description: es[0].description,
        issueKey: es[0].issueKey,
        entries: es,
        totalSeconds: es.reduce((s, e) => s + e.effectiveSeconds, 0),
        allSubmitted: es.every((e) => e.submittedAt !== null),
        isAllgemeines: es[0].isAllgemeines,
        category: es[0].category,
      };
    });
    groups.sort((a, b) =>
      a.entries[0].startedAt < b.entries[0].startedAt ? 1 : -1,
    );

    days.push({
      dayKey: key,
      label: dayLabel(key),
      groups,
      totalSeconds: groups.reduce((s, g) => s + g.totalSeconds, 0),
      // Allgemeines entries are never booked to Jira, so they don't count as
      // "open" work waiting to be submitted.
      unsubmittedCount: dayEntries.filter(
        (e) => e.submittedAt === null && !e.isAllgemeines,
      ).length,
    });
  }

  days.sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1));
  return days;
}

/**
 * The distinct pieces of work the user can pick up again, ranked most-recent
 * first (tie-break: most used first).
 *
 * Derived from the already-built day groups rather than from the raw rows or
 * from SQL: `DescGroup` has run `parseDescription` for the issue key and
 * `effectiveDurationSeconds` for the tracked time, and neither can be
 * expressed as a `GROUP BY`. Reusing it also guarantees the dropdown and the
 * history below it agree on what counts as "the same entry".
 *
 * The running entry is excluded for free — `buildDayGroups` only keeps
 * finished ones.
 *
 * `now` defaults to the server clock, which is only correct because the
 * Buchen page opts out of caching (`export const dynamic = "force-dynamic"`).
 */
export function buildRecentEntries(
  days: DayGroup[],
  opts: { now?: Date; windowDays?: number; limit?: number } = {},
): RecentEntry[] {
  const {
    now = new Date(),
    windowDays = RECENT_WINDOW_DAYS,
    limit = RECENT_LIMIT,
  } = opts;

  // `dayKey` is `YYYY-MM-DD`, so a plain string compare orders days correctly
  // and we never parse a date inside the loop.
  const cutoffKey = dayKey(new Date(now.getTime() - windowDays * 86_400_000));
  const merged = new Map<string, RecentEntry>();

  // `days` is newest-first, so the first sighting of a key carries the most
  // recent spelling of the description.
  for (const day of days) {
    if (day.dayKey < cutoffKey) continue;
    for (const group of day.groups) {
      if (group.description.trim() === "") continue;
      const key = descGroupKey(group);
      const latestStart = group.entries[0].startedAt;
      const existing = merged.get(key);
      if (existing) {
        existing.count += group.entries.length;
        existing.totalSeconds += group.totalSeconds;
        if (latestStart > existing.lastStartedAt) {
          existing.lastStartedAt = latestStart;
        }
      } else {
        merged.set(key, {
          key,
          description: group.description,
          issueKey: group.issueKey,
          isAllgemeines: group.isAllgemeines,
          category: group.category,
          count: group.entries.length,
          totalSeconds: group.totalSeconds,
          lastStartedAt: latestStart,
        });
      }
    }
  }

  return [...merged.values()]
    .sort(
      (a, b) =>
        b.lastStartedAt.localeCompare(a.lastStartedAt) || b.count - a.count,
    )
    .slice(0, limit);
}

/**
 * Overtime balance in minutes: for every day that has tracked time, the worked
 * minutes minus the regular target (weekdays only — weekend work is all overtime).
 * An optional `baselineMinutes` represents overtime carried in from before the
 * tool was used.
 */
export function overtimeBalanceMinutes(
  workedByDay: Map<string, number>,
  regularWorkMinutes: number,
  baselineMinutes = 0,
): number {
  let balance = baselineMinutes;
  for (const [key, seconds] of workedByDay) {
    const [y, m, d] = key.split("-").map(Number);
    const weekday = new Date(y, m - 1, d).getDay();
    const isWeekend = weekday === 0 || weekday === 6;
    balance += seconds / 60 - (isWeekend ? 0 : regularWorkMinutes);
  }
  return Math.round(balance);
}

/** The columns the per-day aggregate needs — see `DurationRow` in the queries. */
export type DurationLike = Pick<
  TimeEntry,
  "startedAt" | "endedAt" | "isAllgemeines"
>;

/**
 * Effective worked seconds per local day, for finished entries.
 *
 * `concrete` counts only entries NOT flagged as Allgemeines. An entry without a
 * parseable issue key still counts as concrete, on the assumption that the user
 * simply forgot the key.
 *
 * Both maps come from one pass. They used to be two near-identical loops that
 * differed by a single `if`, and the Auswertung page walked the whole history
 * twice to build them.
 *
 * The narrow `DurationLike` input is deliberate: the overtime balance is
 * cumulative over every day ever tracked, so this is the one aggregate that
 * cannot be windowed. Taking only three columns is what keeps it cheap.
 */
export function secondsByDay(
  rows: DurationLike[],
  cfg: Pick<EntryAnalysisConfig, "breaks" | "autoPauseEnabled">,
): { worked: Map<string, number>; concrete: Map<string, number> } {
  const worked = new Map<string, number>();
  const concrete = new Map<string, number>();
  for (const row of rows) {
    if (!row.endedAt) continue;
    const seconds = effectiveDurationSeconds(
      row.startedAt,
      row.endedAt,
      cfg.breaks,
      cfg.autoPauseEnabled,
    );
    const key = dayKey(row.startedAt);
    worked.set(key, (worked.get(key) ?? 0) + seconds);
    if (!row.isAllgemeines) {
      concrete.set(key, (concrete.get(key) ?? 0) + seconds);
    }
  }
  return { worked, concrete };
}
