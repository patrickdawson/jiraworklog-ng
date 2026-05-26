import { RangeControls } from "@/components/auswertung-export";
import { Card, KpiCard, PageHeader } from "@/components/ui";
import { getAllEntries, getSettings } from "@/db/queries";
import {
  overtimeBalanceMinutes,
  workedSecondsByDay,
} from "@/lib/entries";
import { formatHm, formatSignedHm } from "@/lib/format";
import {
  parseRangeKind,
  rangeQuery,
  resolveRange,
  type RangeKind,
} from "@/lib/report-range";
import { parseProjectKeys } from "@/lib/settings";
import { parseBreaks } from "@/lib/work-time";
import Link from "next/link";

export const dynamic = "force-dynamic";

const RANGES: { key: RangeKind; label: string }[] = [
  { key: "week", label: "Woche" },
  { key: "month", label: "Monat" },
  { key: "ytd", label: "YTD" },
  { key: "all", label: "Alle" },
];

function isoDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function enumerateDays(from: Date, to: Date): string[] {
  const result: string[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= to) {
    result.push(isoDayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

export default async function AuswertungPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; anchor?: string }>;
}) {
  const params = await searchParams;
  const kind = parseRangeKind(params.range);
  const resolved = resolveRange(kind, params.anchor ?? null);

  const s = getSettings();
  const entries = getAllEntries();
  const cfg = {
    projectKeys: parseProjectKeys(s.jiraProjectKeys),
    breaks: parseBreaks(s.breaks),
    autoPauseEnabled: s.autoPauseEnabled,
  };

  const byDay = workedSecondsByDay(entries, cfg);
  const totalOvertime = overtimeBalanceMinutes(
    byDay,
    s.regularWorkMinutes,
    s.overtimeBaselineMinutes,
  );

  const dayKeys = enumerateDays(resolved.from, resolved.to);

  let rangeSeconds = 0;
  let daysWorked = 0;
  for (const k of dayKeys) {
    const seconds = byDay.get(k) ?? 0;
    if (seconds > 0) {
      rangeSeconds += seconds;
      daysWorked += 1;
    }
  }

  // "Diese Woche" always reflects the current calendar week, not the selection.
  const thisWeek = resolveRange("week", null);
  let thisWeekSeconds = 0;
  for (const k of enumerateDays(thisWeek.from, thisWeek.to)) {
    thisWeekSeconds += byDay.get(k) ?? 0;
  }
  const weekTargetMin = s.regularWorkMinutes * 5;
  const weekRemainingMin = Math.max(
    0,
    weekTargetMin - thisWeekSeconds / 60,
  );

  const totalDays = dayKeys.length;
  const weeksInRange = Math.max(1, totalDays / 7);
  const avgPerWeekMin = rangeSeconds / 60 / weeksInRange;
  const avgPerWorkedDayMin = daysWorked > 0 ? rangeSeconds / 60 / daysWorked : 0;

  const chartDays = dayKeys.slice(-14);
  const chartData = chartDays.map((k) => ({
    key: k,
    seconds: byDay.get(k) ?? 0,
  }));

  return (
    <main className="px-4 py-5 sm:px-8 sm:py-7">
      <PageHeader
        title="Auswertung"
        subtitle={`Zeitraum · ${resolved.label}`}
        actions={
          <div className="flex flex-col gap-2 w-full lg:w-auto lg:flex-row lg:items-center lg:gap-2.5">
            <div className="flex gap-2">
              {RANGES.map((r) => (
                <Link
                  key={r.key}
                  href={`/auswertung${rangeQuery(r.key, resolved.kind === "all" ? "" : resolved.anchor)}`}
                  className="rounded-lg border px-3 py-1.5 text-[13px] font-semibold flex-1 text-center sm:flex-none"
                  style={
                    r.key === kind
                      ? {
                          background: "var(--accent)",
                          borderColor: "var(--accent)",
                          color: "#fff",
                          cursor: "pointer",
                        }
                      : {
                          background: "var(--surface)",
                          borderColor: "var(--border-strong)",
                          color: "var(--text)",
                          cursor: "pointer",
                        }
                  }
                >
                  {r.label}
                </Link>
              ))}
            </div>
            <RangeControls resolved={resolved} />
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3.5 mb-5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Ø Arbeitszeit / Woche"
          value={formatHm(Math.round(avgPerWeekMin))}
          meta={`Soll: ${formatHm(s.regularWorkMinutes * 5)}`}
        />
        <KpiCard
          label="Ø Arbeitszeit / Tag"
          value={formatHm(Math.round(avgPerWorkedDayMin))}
          meta={`Soll: ${formatHm(s.regularWorkMinutes)}`}
        />
        <KpiCard
          label="Überstundensaldo"
          value={formatSignedHm(totalOvertime)}
          tone={totalOvertime >= 0 ? "pos" : "neg"}
          meta="über alle erfassten Tage"
        />
        <KpiCard
          label="Diese Woche"
          value={formatHm(Math.round(thisWeekSeconds / 60))}
          meta={
            weekRemainingMin > 0
              ? `noch ${formatHm(Math.round(weekRemainingMin))} bis Soll`
              : "Soll erreicht"
          }
        />
      </div>

      <Card>
        <div className="text-[15px] font-semibold mb-3">
          Gearbeitete Zeit pro Tag
        </div>
        <DailyBars data={chartData} regularMinutes={s.regularWorkMinutes} />
      </Card>
    </main>
  );
}

function DailyBars({
  data,
  regularMinutes,
}: {
  data: { key: string; seconds: number }[];
  regularMinutes: number;
}) {
  if (data.length === 0) {
    return (
      <div
        className="text-center py-10 text-[13px]"
        style={{ color: "var(--text-2)" }}
      >
        Noch keine Daten im gewählten Zeitraum.
      </div>
    );
  }

  const width = 720;
  const height = 220;
  const padding = { top: 24, right: 20, bottom: 30, left: 40 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const maxSeconds = Math.max(
    regularMinutes * 60 * 1.4,
    ...data.map((d) => d.seconds),
  );
  const barW = innerW / data.length;
  const targetY = padding.top + innerH - (regularMinutes * 60 * innerH) / maxSeconds;

  const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      <line
        x1={padding.left}
        y1={padding.top + innerH}
        x2={width - padding.right}
        y2={padding.top + innerH}
        stroke="var(--border)"
      />
      <line
        x1={padding.left}
        y1={targetY}
        x2={width - padding.right}
        y2={targetY}
        stroke="var(--border-strong)"
        strokeDasharray="4 4"
      />
      <text
        x={padding.left + 4}
        y={targetY - 4}
        fill="var(--text-3)"
        fontSize="10"
      >
        Soll {Math.floor(regularMinutes / 60)}h
      </text>
      {data.map((d, i) => {
        const h = (d.seconds * innerH) / maxSeconds;
        const x = padding.left + i * barW + barW * 0.15;
        const y = padding.top + innerH - h;
        const w = barW * 0.7;
        const targetSec = regularMinutes * 60;
        const fill =
          d.seconds <= 0
            ? "var(--surface-2)"
            : d.seconds >= targetSec
              ? "var(--pos)"
              : "var(--accent)";
        const [y_, m_, day_] = d.key.split("-").map(Number);
        const weekday = new Date(y_, m_ - 1, day_).getDay();
        return (
          <g key={d.key}>
            <rect x={x} y={y} width={w} height={Math.max(0, h)} rx="3" fill={fill} />
            <text
              x={padding.left + i * barW + barW / 2}
              y={padding.top + innerH + 18}
              fontSize="10.5"
              textAnchor="middle"
              fill="var(--text-3)"
            >
              {WEEKDAY_SHORT[weekday]} {day_}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
