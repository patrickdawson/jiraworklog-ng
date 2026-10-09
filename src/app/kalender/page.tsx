import { KalenderView } from "@/components/kalender-view";
import { getEntriesBetween, getRunningEntry, getSettings } from "@/db/queries";
import {
  isWeekendKey,
  overtimeBalanceMinutes,
  secondsByDay,
  toEntryView,
} from "@/lib/entries";
import { dayKey } from "@/lib/format";
import { resolveRange, shiftRange } from "@/lib/report-range";
import { parseProjectKeys } from "@/lib/settings";
import { consecutiveDayKeys } from "@/lib/timeline";
import { parseBreaks } from "@/lib/work-time";

export const dynamic = "force-dynamic";

export default async function KalenderPage({
  searchParams,
}: {
  searchParams: Promise<{ anchor?: string }>;
}) {
  const params = await searchParams;
  const s = getSettings();
  const week = resolveRange("week", params.anchor ?? null);

  const cfg = {
    projectKeys: parseProjectKeys(s.jiraProjectKeys),
    breaks: parseBreaks(s.breaks),
    autoPauseEnabled: s.autoPauseEnabled,
  };

  // Start one day early: an entry that began on Sunday night and ran past
  // midnight still has a piece on this Monday.
  const queryFrom = new Date(week.from);
  queryFrom.setDate(queryFrom.getDate() - 1);
  const rows = getEntriesBetween(queryFrom.toISOString(), week.to.toISOString());

  // A timer started before this window may still be running into it.
  const running = getRunningEntry();
  if (running && !rows.some((r) => r.id === running.id)) rows.push(running);

  const entries = rows.map((r) => toEntryView(r, cfg));

  // Same rule as the overall saldo, limited to the days of this week: every
  // day with tracked time counts its worked time minus the weekday target.
  const dayKeys = consecutiveDayKeys(week.from, 7);
  const worked = secondsByDay(rows, cfg).worked;
  for (const key of worked.keys()) {
    if (!dayKeys.includes(key)) worked.delete(key);
  }
  const weekOvertimeMinutes = overtimeBalanceMinutes(worked, s.regularWorkMinutes);

  // A running timer counts toward its start day once stopped. If that day has
  // no finished time yet, its target is not in the value above — the client
  // subtracts it while the timer runs, as on the Buchen page.
  const runningDayKey = running ? dayKey(running.startedAt) : null;
  const runningInWeek = runningDayKey !== null && dayKeys.includes(runningDayKey);
  const runningDayTargetMinutes =
    !runningInWeek || worked.has(runningDayKey) || isWeekendKey(runningDayKey)
      ? 0
      : s.regularWorkMinutes;

  return (
    <KalenderView
      data={{
        weekLabel: week.label,
        dayKeys,
        prevAnchor: shiftRange(week, -1) ?? week.anchor,
        nextAnchor: shiftRange(week, 1) ?? week.anchor,
        isCurrentWeek: week.anchor === resolveRange("week", dayKey(new Date())).anchor,
        hasRunning: running !== undefined,
        entries,
        breaks: cfg.breaks,
        autoPauseEnabled: cfg.autoPauseEnabled,
        weekOvertimeMinutes,
        runningInWeek,
        runningDayTargetMinutes,
      }}
    />
  );
}
