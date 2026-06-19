import {
  ALLGEMEINES_CATEGORIES,
  type AllgemeinesCategory,
  type SettingsRow,
  type TimeEntry,
} from "@/db/schema";
import { dayKey } from "./format";
import type { ResolvedRange } from "./report-range";
import { effectiveDurationSeconds, parseBreaks } from "./work-time";

/** A single booking entry in the external tool may cover at most 24 hours. */
const BLOCK_MINUTES = 24 * 60;

/** Fallback for Allgemeines entries that somehow lack a category. */
const FALLBACK_CATEGORY: AllgemeinesCategory = "Projektorganisation";

export type CategoryReportItem = {
  name: AllgemeinesCategory;
  totalMinutes: number;
  /** The total split into ≤ 24h blocks (`n × 1440` + remainder). */
  blocks: number[];
};

/** Per-day row for the verification overview: minutes per category + total. */
export type CategoryReportDay = {
  dayKey: string;
  /** Short German label, e.g. "Mo 01.06.". */
  label: string;
  minutesByCategory: Record<AllgemeinesCategory, number>;
  totalMinutes: number;
};

export type CategoryReport = {
  displayName: string;
  rangeLabel: string;
  /** Only categories with booked time, in the canonical category order. */
  categories: CategoryReportItem[];
  /** Every day with tracked time, ascending; for capture verification. */
  days: CategoryReportDay[];
  totalMinutes: number;
};

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** `YYYY-MM-DD` → "Mo 01.06." (local weekday, no timezone surprises). */
function formatDayShort(dk: string): string {
  const [y, m, d] = dk.split("-").map(Number);
  const wd = WEEKDAY_SHORT[new Date(y, m - 1, d).getDay()];
  return `${wd} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
}

/**
 * Splits a duration into bookable blocks of at most 24 hours: as many full
 * 24:00 blocks as fit, followed by the remaining time.
 */
export function splitIntoBlocks(totalMinutes: number): number[] {
  const blocks: number[] = [];
  let remaining = totalMinutes;
  while (remaining > BLOCK_MINUTES) {
    blocks.push(BLOCK_MINUTES);
    remaining -= BLOCK_MINUTES;
  }
  if (remaining > 0) blocks.push(remaining);
  return blocks;
}

/**
 * Aggregates worked time within `range` into the four report categories.
 * Concrete (non-Allgemeines) entries all count as "Implementierung";
 * Allgemeines entries use their stored category.
 */
export function buildCategoryReport(
  entries: TimeEntry[],
  s: SettingsRow,
  range: ResolvedRange,
): CategoryReport {
  const breaks = parseBreaks(s.breaks);
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();

  const secondsByCategory = new Map<AllgemeinesCategory, number>();
  // dayKey → (category → seconds), for the per-day verification overview.
  const secondsByDay = new Map<string, Map<AllgemeinesCategory, number>>();

  for (const entry of entries) {
    if (entry.endedAt === null) continue;
    const startedMs = new Date(entry.startedAt).getTime();
    if (startedMs < fromMs || startedMs > toMs) continue;

    const seconds = effectiveDurationSeconds(
      entry.startedAt,
      entry.endedAt,
      breaks,
      s.autoPauseEnabled,
    );
    const category: AllgemeinesCategory = entry.isAllgemeines
      ? (entry.category ?? FALLBACK_CATEGORY)
      : "Implementierung";
    secondsByCategory.set(
      category,
      (secondsByCategory.get(category) ?? 0) + seconds,
    );

    const dk = dayKey(entry.startedAt);
    let dayCats = secondsByDay.get(dk);
    if (!dayCats) {
      dayCats = new Map();
      secondsByDay.set(dk, dayCats);
    }
    dayCats.set(category, (dayCats.get(category) ?? 0) + seconds);
  }

  const categories: CategoryReportItem[] = [];
  let totalMinutes = 0;
  for (const name of ALLGEMEINES_CATEGORIES) {
    const minutes = Math.round((secondsByCategory.get(name) ?? 0) / 60);
    if (minutes <= 0) continue;
    categories.push({
      name,
      totalMinutes: minutes,
      blocks: splitIntoBlocks(minutes),
    });
    totalMinutes += minutes;
  }

  const days: CategoryReportDay[] = [...secondsByDay.keys()]
    .sort()
    .map((dk) => {
      const dayCats = secondsByDay.get(dk)!;
      const minutesByCategory = {} as Record<AllgemeinesCategory, number>;
      let daySeconds = 0;
      for (const name of ALLGEMEINES_CATEGORIES) {
        const sec = dayCats.get(name) ?? 0;
        minutesByCategory[name] = Math.round(sec / 60);
        daySeconds += sec;
      }
      return {
        dayKey: dk,
        label: formatDayShort(dk),
        minutesByCategory,
        totalMinutes: Math.round(daySeconds / 60),
      };
    });

  return {
    displayName: s.jiraUser?.trim() || "—",
    rangeLabel: range.label,
    categories,
    days,
    totalMinutes,
  };
}
