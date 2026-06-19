import type {
  AllgemeinesCategory,
  SettingsRow,
  TimeEntry,
} from "@/db/schema";
import { toEntryView } from "./entries";
import type { ResolvedRange } from "./report-range";
import { parseProjectKeys } from "./settings";
import { parseBreaks } from "./work-time";

export type ReportRow = {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  issueKey: string | null;
  isAllgemeines: boolean;
  category: AllgemeinesCategory | null;
  comment: string;
  submitted: boolean;
};

export type WorklogReport = {
  displayName: string;
  rangeLabel: string;
  rows: ReportRow[];
  totalSeconds: number;
};

export function buildReport(
  entries: TimeEntry[],
  s: SettingsRow,
  range: ResolvedRange,
): WorklogReport {
  const cfg = {
    projectKeys: parseProjectKeys(s.jiraProjectKeys),
    breaks: parseBreaks(s.breaks),
    autoPauseEnabled: s.autoPauseEnabled,
  };
  const fromMs = range.from.getTime();
  const toMs = range.to.getTime();

  const rows: ReportRow[] = [];
  for (const entry of entries) {
    if (entry.endedAt === null) continue;
    const startedMs = new Date(entry.startedAt).getTime();
    if (startedMs < fromMs || startedMs > toMs) continue;

    const view = toEntryView(entry, cfg);
    // Allgemeines entries are not booked to Jira and carry no issue key.
    const issueKey = view.isAllgemeines ? null : (view.issueKey ?? null);
    const comment = view.isAllgemeines
      ? view.description.trim()
      : view.issueKey
        ? view.comment
        : view.description.trim();

    rows.push({
      startedAt: entry.startedAt,
      endedAt: entry.endedAt,
      durationSeconds: view.effectiveSeconds,
      issueKey,
      isAllgemeines: view.isAllgemeines,
      category: view.category,
      comment,
      submitted: view.submittedAt !== null,
    });
  }

  rows.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));

  const totalSeconds = rows.reduce((sum, r) => sum + r.durationSeconds, 0);

  return {
    displayName: s.jiraUser?.trim() || "—",
    rangeLabel: range.label,
    rows,
    totalSeconds,
  };
}

export function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.`;
}

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

export function weekdayShort(iso: string): string {
  return WEEKDAY_SHORT[new Date(iso).getDay()];
}
