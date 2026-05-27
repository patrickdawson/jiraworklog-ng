import type { TimeEntry } from "@/db/schema";
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
};

export type DescGroup = {
  description: string;
  issueKey: string | undefined;
  entries: EntryView[];
  totalSeconds: number;
  allSubmitted: boolean;
  isAllgemeines: boolean;
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
      const descKey = `${view.isAllgemeines ? "A" : "P"}|${view.description.trim()}`;
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
      unsubmittedCount: dayEntries.filter((e) => e.submittedAt === null).length,
    });
  }

  days.sort((a, b) => (a.dayKey < b.dayKey ? 1 : -1));
  return days;
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

/** Effective worked seconds per local day, for finished entries. */
export function workedSecondsByDay(
  entries: TimeEntry[],
  cfg: EntryAnalysisConfig,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.endedAt) continue;
    const seconds = effectiveDurationSeconds(
      entry.startedAt,
      entry.endedAt,
      cfg.breaks,
      cfg.autoPauseEnabled,
    );
    const key = dayKey(entry.startedAt);
    map.set(key, (map.get(key) ?? 0) + seconds);
  }
  return map;
}

/**
 * Effective worked seconds per local day for entries that count toward
 * concrete-issue work — i.e. entries NOT flagged as Allgemeines. Entries
 * without a parseable issue key still count as "concrete" here, on the
 * assumption that the user simply forgot to add the key.
 */
export function concreteSecondsByDay(
  entries: TimeEntry[],
  cfg: EntryAnalysisConfig,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.endedAt) continue;
    if (entry.isAllgemeines) continue;
    const seconds = effectiveDurationSeconds(
      entry.startedAt,
      entry.endedAt,
      cfg.breaks,
      cfg.autoPauseEnabled,
    );
    const key = dayKey(entry.startedAt);
    map.set(key, (map.get(key) ?? 0) + seconds);
  }
  return map;
}
