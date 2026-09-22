import { BuchenView } from "@/components/buchen-view";
import {
  countBookableEntries,
  countEntriesBefore,
  getAllEntries,
  getEntriesFrom,
  getFinishedDurations,
  getRunningEntry,
  getSettings,
} from "@/db/queries";
import {
  buildDayGroups,
  buildRecentEntries,
  DEFAULT_HISTORY_DAYS,
  overtimeBalanceMinutes,
  secondsByDay,
} from "@/lib/entries";
import { dayKey, daysAgoStartIso } from "@/lib/format";
import { isForceBookingEnabled } from "@/lib/force-booking";
import { isJiraConfigured, parseProjectKeys } from "@/lib/settings";
import { parseBreaks } from "@/lib/work-time";

export const dynamic = "force-dynamic";

/**
 * How many days of history to render. `?days=all` shows everything; anything
 * else falls back to the default window, so a hand-edited URL cannot make the
 * page unbounded by accident.
 */
function parseWindowDays(raw: string | undefined): number | "all" {
  if (raw === "all") return "all";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_HISTORY_DAYS;
}

export default async function BuchenPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const windowDays = parseWindowDays(params.days);

  const s = getSettings();

  const cfg = {
    projectKeys: parseProjectKeys(s.jiraProjectKeys),
    breaks: parseBreaks(s.breaks),
    autoPauseEnabled: s.autoPauseEnabled,
  };

  // The rendered list is windowed; everything below that must not be.
  const cutoffIso =
    windowDays === "all" ? null : daysAgoStartIso(windowDays - 1);
  const entries = cutoffIso === null ? getAllEntries() : getEntriesFrom(cutoffIso);

  const days = buildDayGroups(entries, cfg);
  const recents = buildRecentEntries(days);

  // Read directly rather than scanning the windowed array: a timer started
  // months ago is still running now and must still appear.
  const runningRow = getRunningEntry() ?? null;

  const todayKey = dayKey(new Date());
  const todayCommittedSeconds =
    days.find((d) => d.dayKey === todayKey)?.totalSeconds ?? 0;

  // The overtime balance is cumulative over every day ever tracked, so it reads
  // the full history — but only three columns of it.
  const overtime = overtimeBalanceMinutes(
    secondsByDay(getFinishedDurations(), cfg).worked,
    s.regularWorkMinutes,
    s.overtimeBaselineMinutes,
  );

  // The header button books across ALL days, so its count must too. A windowed
  // count would hide old unbooked entries that the button would still submit.
  const force = isForceBookingEnabled();
  const openBookableCount = countBookableEntries(force);

  const hiddenOlderCount =
    cutoffIso === null ? 0 : countEntriesBefore(cutoffIso);

  return (
    <BuchenView
      data={{
        running: runningRow
          ? {
              id: runningRow.id,
              description: runningRow.description,
              startedAt: runningRow.startedAt,
              isAllgemeines: runningRow.isAllgemeines,
              category: runningRow.category,
            }
          : null,
        todayCommittedSeconds,
        overtimeBalanceMinutes: overtime,
        days,
        recents,
        openBookableCount,
        history: {
          windowDays,
          hiddenOlderCount,
        },
        config: {
          dailyTargetMinutes: s.dailyTargetMinutes,
          autoPauseEnabled: s.autoPauseEnabled,
          breaks: cfg.breaks,
          bookingMode: s.bookingMode,
          jiraConfigured: isJiraConfigured(s),
          forceBooking: force,
        },
      }}
    />
  );
}
