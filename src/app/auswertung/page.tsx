import { RangeControls } from "@/components/auswertung-export";
import { Card, KpiCard, PageHeader } from "@/components/ui";
import { getAllEntries, getSettings } from "@/db/queries";
import {
  concreteSecondsByDay,
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
  { key: "sprint", label: "Sprint" },
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
  const s = getSettings();
  const resolved = resolveRange(kind, params.anchor ?? null, new Date(), {
    anchorDate: s.sprintAnchorDate,
    lengthDays: s.sprintLengthDays,
  });

  const entries = getAllEntries();
  const cfg = {
    projectKeys: parseProjectKeys(s.jiraProjectKeys),
    breaks: parseBreaks(s.breaks),
    autoPauseEnabled: s.autoPauseEnabled,
  };

  const byDay = workedSecondsByDay(entries, cfg);
  const concreteByDay = concreteSecondsByDay(entries, cfg);
  const totalOvertime = overtimeBalanceMinutes(
    byDay,
    s.regularWorkMinutes,
    s.overtimeBaselineMinutes,
  );

  const dayKeys = enumerateDays(resolved.from, resolved.to);

  let rangeSeconds = 0;
  let daysWorked = 0;
  // The concrete-issue quote only considers days with actual concrete work.
  // Days with only Allgemeines bookings (sick leave, holidays, admin) or no
  // bookings at all (weekends) must not drag the quote down.
  let quoteSeconds = 0;
  let quoteConcreteSeconds = 0;
  for (const k of dayKeys) {
    const seconds = byDay.get(k) ?? 0;
    const concrete = concreteByDay.get(k) ?? 0;
    if (seconds > 0) {
      rangeSeconds += seconds;
      daysWorked += 1;
    }
    if (concrete > 0) {
      quoteSeconds += seconds;
      quoteConcreteSeconds += concrete;
    }
  }
  const concreteQuotePct =
    quoteSeconds > 0
      ? Math.round((quoteConcreteSeconds * 100) / quoteSeconds)
      : 0;
  const targetPct = s.concreteIssueTargetPercent;
  const quoteMet = quoteSeconds > 0 && concreteQuotePct >= targetPct;

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
  const quoteChartData = chartDays.map((k) => {
    const total = byDay.get(k) ?? 0;
    const concrete = concreteByDay.get(k) ?? 0;
    return {
      key: k,
      percent: concrete > 0 ? Math.round((concrete * 100) / total) : 0,
      hasData: concrete > 0,
    };
  });

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
                  href={`/auswertung${rangeQuery(r.key, r.key === resolved.kind ? resolved.anchor : "")}`}
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

      <div className="grid grid-cols-1 gap-3.5 mb-5 sm:grid-cols-2 lg:grid-cols-5">
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
        <KpiCard
          label="Quote konkrete Issues"
          value={`${concreteQuotePct} %`}
          tone={
            quoteSeconds === 0 ? "default" : quoteMet ? "pos" : "neg"
          }
          meta={
            quoteSeconds === 0
              ? "Keine Erfassung im Zeitraum"
              : `Ziel: ${targetPct} %`
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        <Card>
          <div className="text-[15px] font-semibold mb-3">
            Gearbeitete Zeit pro Tag
          </div>
          <DailyBars data={chartData} regularMinutes={s.regularWorkMinutes} />
        </Card>
        <Card>
          <div className="text-[15px] font-semibold mb-3">
            Quote konkrete Issues pro Tag
          </div>
          <QuoteBars data={quoteChartData} targetPercent={targetPct} />
        </Card>
      </div>
    </main>
  );
}

function QuoteBars({
  data,
  targetPercent,
}: {
  data: { key: string; percent: number; hasData: boolean }[];
  targetPercent: number;
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
  const barW = innerW / data.length;
  const targetY = padding.top + innerH - (targetPercent * innerH) / 100;

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
        Ziel {targetPercent}%
      </text>
      {data.map((d, i) => {
        const h = (d.percent * innerH) / 100;
        const x = padding.left + i * barW + barW * 0.15;
        const y = padding.top + innerH - h;
        const w = barW * 0.7;
        const fill = !d.hasData
          ? "var(--surface-2)"
          : d.percent >= targetPercent
            ? "var(--pos)"
            : "var(--accent)";
        const [y_, m_, day_] = d.key.split("-").map(Number);
        const weekday = new Date(y_, m_ - 1, day_).getDay();
        return (
          <g key={d.key}>
            <rect
              x={x}
              y={d.hasData ? y : padding.top + innerH - 2}
              width={w}
              height={d.hasData ? Math.max(0, h) : 2}
              rx="3"
              fill={fill}
            />
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
