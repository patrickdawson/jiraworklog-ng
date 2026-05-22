import { BuchenView } from "@/components/buchen-view";
import { getAllEntries, getSettings } from "@/db/queries";
import {
  buildDayGroups,
  overtimeBalanceMinutes,
  workedSecondsByDay,
} from "@/lib/entries";
import { dayKey } from "@/lib/format";
import { isJiraConfigured, parseProjectKeys } from "@/lib/settings";
import { parseBreaks } from "@/lib/work-time";

export const dynamic = "force-dynamic";

export default function BuchenPage() {
  const s = getSettings();
  const entries = getAllEntries();

  const cfg = {
    projectKeys: parseProjectKeys(s.jiraProjectKeys),
    breaks: parseBreaks(s.breaks),
    autoPauseEnabled: s.autoPauseEnabled,
  };

  const days = buildDayGroups(entries, cfg);
  const runningRow = entries.find((e) => e.endedAt === null) ?? null;
  const todayKey = dayKey(new Date());
  const todayCommittedSeconds =
    days.find((d) => d.dayKey === todayKey)?.totalSeconds ?? 0;
  const overtime = overtimeBalanceMinutes(
    workedSecondsByDay(entries, cfg),
    s.regularWorkMinutes,
    s.overtimeBaselineMinutes,
  );

  return (
    <BuchenView
      data={{
        running: runningRow
          ? {
              id: runningRow.id,
              description: runningRow.description,
              startedAt: runningRow.startedAt,
              isAllgemeines: runningRow.isAllgemeines,
            }
          : null,
        todayCommittedSeconds,
        overtimeBalanceMinutes: overtime,
        days,
        config: {
          dailyTargetMinutes: s.dailyTargetMinutes,
          autoPauseEnabled: s.autoPauseEnabled,
          breaks: cfg.breaks,
          bookingMode: s.bookingMode,
          jiraConfigured: isJiraConfigured(s),
        },
      }}
    />
  );
}
