import { KalenderView, type KalenderEntry } from "@/components/kalender-view";
import { getEntriesBetween, getRunningEntry, getSettings } from "@/db/queries";
import { toEntryView } from "@/lib/entries";
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

  const entries: KalenderEntry[] = rows.map((r) => {
    const v = toEntryView(r, cfg);
    return {
      id: v.id,
      startedAt: v.startedAt,
      endedAt: v.endedAt,
      description: v.description,
      issueKey: v.issueKey ?? null,
      comment: v.comment,
      isAllgemeines: v.isAllgemeines,
      category: v.category,
    };
  });

  return (
    <KalenderView
      data={{
        weekLabel: week.label,
        dayKeys: consecutiveDayKeys(week.from, 7),
        prevAnchor: shiftRange(week, -1) ?? week.anchor,
        nextAnchor: shiftRange(week, 1) ?? week.anchor,
        isCurrentWeek: week.anchor === resolveRange("week", dayKey(new Date())).anchor,
        hasRunning: running !== undefined,
        entries,
        breaks: cfg.breaks,
      }}
    />
  );
}
