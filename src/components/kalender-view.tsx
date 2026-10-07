"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { AllgemeinesCategory } from "@/db/schema";
import { Card, PageHeader } from "@/components/ui";
import { NowProvider, useNow } from "@/components/now-context";
import { dayKey, formatHm } from "@/lib/format";
import { buildTimeline, type DayTimeline, type Interval } from "@/lib/timeline";
import type { BreakWindow } from "@/lib/work-time";

export type KalenderEntry = {
  id: number;
  startedAt: string;
  endedAt: string | null;
  description: string;
  issueKey: string | null;
  comment: string;
  isAllgemeines: boolean;
  category: AllgemeinesCategory | null;
};

export type KalenderData = {
  weekLabel: string;
  dayKeys: string[];
  prevAnchor: string;
  nextAnchor: string;
  isCurrentWeek: boolean;
  hasRunning: boolean;
  entries: KalenderEntry[];
  breaks: BreakWindow[];
};

/** Vertical scale of the grid. */
const PX_PER_HOUR = 48;
/** Hours shown when the week has no entries outside them. */
const DEFAULT_FIRST_HOUR = 7;
const DEFAULT_LAST_HOUR = 19;

const WEEKDAY_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function clockOfMinutes(min: number): string {
  const m = Math.round(min);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function dayHeading(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAY_SHORT[date.getDay()]} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.`;
}

function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.endMin - i.startMin), 0);
}

export function KalenderView({ data }: { data: KalenderData }) {
  return (
    <NowProvider active={data.hasRunning}>
      <KalenderInner data={data} />
    </NowProvider>
  );
}

function KalenderInner({ data }: { data: KalenderData }) {
  const now = useNow();

  // Before the first client tick `now` is null; the running entry is then left
  // out, so server and client render the same markup.
  const days = useMemo(() => {
    const entries = now
      ? data.entries
      : data.entries.filter((e) => e.endedAt !== null);
    return buildTimeline(entries, data.dayKeys, data.breaks, now ?? new Date(0));
  }, [data.entries, data.dayKeys, data.breaks, now]);

  const entryById = useMemo(
    () => new Map(data.entries.map((e) => [e.id, e])),
    [data.entries],
  );

  const todayKey = now ? dayKey(now) : null;
  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : null;

  const [firstHour, lastHour] = useMemo(() => {
    let lo = DEFAULT_FIRST_HOUR * 60;
    let hi = DEFAULT_LAST_HOUR * 60;
    for (const d of days) {
      for (const s of d.segments) {
        lo = Math.min(lo, s.startMin);
        hi = Math.max(hi, s.endMin);
      }
    }
    return [Math.max(0, Math.floor(lo / 60)), Math.min(24, Math.ceil(hi / 60))];
  }, [days]);

  const overlapList = days.flatMap((d) => d.overlaps);
  const gapList = days.flatMap((d) => d.gaps);
  const hours = Array.from(
    { length: lastHour - firstHour },
    (_, i) => firstHour + i,
  );
  const gridHeight = (lastHour - firstHour) * PX_PER_HOUR;
  const toY = (min: number) => ((min - firstHour * 60) / 60) * PX_PER_HOUR;

  return (
    <main className="px-4 py-5 sm:px-8 sm:py-7">
      <PageHeader
        title="Kalender"
        subtitle={`Zeitraum · ${data.weekLabel}`}
        actions={
          <>
            <NavLink href={`/kalender?anchor=${data.prevAnchor}`} label="Vorherige Woche">
              ◀
            </NavLink>
            <NavLink href={`/kalender?anchor=${data.nextAnchor}`} label="Nächste Woche">
              ▶
            </NavLink>
            {!data.isCurrentWeek && (
              <NavLink href="/kalender" label="Aktuelle Woche">
                Heute
              </NavLink>
            )}
          </>
        }
      />

      <div
        data-testid="kalender-summary"
        className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mb-4 text-[13px]"
        style={{ color: "var(--text-2)" }}
      >
        <SummaryItem
          swatch={<OverlapSwatch />}
          text={`${overlapList.length} Überlappung${overlapList.length === 1 ? "" : "en"}`}
          minutes={totalMinutes(overlapList)}
          tone={overlapList.length > 0 ? "var(--neg)" : undefined}
        />
        <SummaryItem
          swatch={<GapSwatch />}
          text={`${gapList.length} Lücke${gapList.length === 1 ? "" : "n"}`}
          minutes={totalMinutes(gapList)}
          tone={gapList.length > 0 ? "var(--warn)" : undefined}
        />
        {data.breaks.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <BreakSwatch /> Pause (keine Lücke)
          </span>
        )}
      </div>

      <Card padded={false} className="overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Day headers */}
          <div
            className="grid border-b"
            style={{
              gridTemplateColumns: "52px repeat(7, minmax(0, 1fr))",
              borderColor: "var(--border)",
            }}
          >
            <div />
            {days.map((d) => (
              <DayHeader key={d.dayKey} day={d} isToday={d.dayKey === todayKey} />
            ))}
          </div>

          {/* Grid body */}
          <div
            className="grid"
            style={{ gridTemplateColumns: "52px repeat(7, minmax(0, 1fr))" }}
          >
            <div className="relative" style={{ height: gridHeight }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute right-2 text-[11px] -translate-y-1/2 tabular-nums"
                  style={{ top: toY(h * 60), color: "var(--text-3)" }}
                >
                  {h > firstHour ? `${String(h).padStart(2, "0")}:00` : ""}
                </div>
              ))}
            </div>

            {days.map((d) => (
              <DayColumn
                key={d.dayKey}
                day={d}
                hours={hours}
                height={gridHeight}
                toY={toY}
                entryById={entryById}
                nowMin={d.dayKey === todayKey ? nowMin : null}
                firstMin={firstHour * 60}
                lastMin={lastHour * 60}
              />
            ))}
          </div>
        </div>
      </Card>
    </main>
  );
}

function NavLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-3 text-[13px] font-medium"
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        color: "var(--text)",
      }}
    >
      {children}
    </Link>
  );
}

function SummaryItem({
  swatch,
  text,
  minutes,
  tone,
}: {
  swatch: React.ReactNode;
  text: string;
  minutes: number;
  tone?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      <span style={tone ? { color: tone, fontWeight: 600 } : undefined}>
        {text}
        {minutes > 0 && (
          <span className="tabular-nums font-normal">{` · ${formatHm(minutes)}`}</span>
        )}
      </span>
    </span>
  );
}

const OVERLAP_HATCH =
  "repeating-linear-gradient(45deg, var(--neg) 0 2px, transparent 2px 6px)";

function OverlapSwatch() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-sm"
      style={{ background: OVERLAP_HATCH, border: "1px solid var(--neg)" }}
    />
  );
}

function GapSwatch() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-sm"
      style={{ background: "var(--warn-soft)", border: "1px dashed var(--warn)" }}
    />
  );
}

function BreakSwatch() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-sm"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    />
  );
}

function DayHeader({ day, isToday }: { day: DayTimeline; isToday: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-1 px-2 py-2 border-l text-[12.5px] font-semibold"
      style={{
        borderColor: "var(--border)",
        color: isToday ? "var(--accent)" : "var(--text)",
      }}
    >
      <span>{dayHeading(day.dayKey)}</span>
      <span className="flex gap-1">
        {day.overlaps.length > 0 && (
          <span
            className="rounded-full px-1.5 text-[10.5px]"
            style={{ background: "var(--neg-soft)", color: "var(--neg)" }}
            title="Überlappungen"
          >
            {day.overlaps.length}
          </span>
        )}
        {day.gaps.length > 0 && (
          <span
            className="rounded-full px-1.5 text-[10.5px]"
            style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
            title="Lücken"
          >
            {day.gaps.length}
          </span>
        )}
      </span>
    </div>
  );
}

function DayColumn({
  day,
  hours,
  height,
  toY,
  entryById,
  nowMin,
  firstMin,
  lastMin,
}: {
  day: DayTimeline;
  hours: number[];
  height: number;
  toY: (min: number) => number;
  entryById: Map<number, KalenderEntry>;
  nowMin: number | null;
  firstMin: number;
  lastMin: number;
}) {
  const visible = (i: Interval) => i.endMin > firstMin && i.startMin < lastMin;
  const box = (i: Interval) => {
    const top = toY(Math.max(i.startMin, firstMin));
    const bottom = toY(Math.min(i.endMin, lastMin));
    return { top, height: Math.max(2, bottom - top) };
  };

  return (
    <div
      className="relative border-l"
      style={{ height, borderColor: "var(--border)" }}
      data-day={day.dayKey}
    >
      {hours.map((h) => (
        <div
          key={h}
          className="absolute inset-x-0 border-t"
          style={{ top: toY(h * 60), borderColor: "var(--border)" }}
        />
      ))}

      {day.breaks.filter(visible).map((b) => (
        <div
          key={`b${b.startMin}`}
          className="absolute inset-x-0"
          style={{ ...box(b), background: "var(--surface-2)" }}
          title={`Pause ${clockOfMinutes(b.startMin)}–${clockOfMinutes(b.endMin)}`}
        />
      ))}

      {day.gaps.filter(visible).map((g) => (
        <div
          key={`g${g.startMin}`}
          data-testid="kalender-gap"
          className="absolute inset-x-1 flex items-center justify-center overflow-hidden rounded text-[10.5px] font-semibold"
          style={{
            ...box(g),
            background: "var(--warn-soft)",
            border: "1px dashed var(--warn)",
            color: "var(--warn)",
          }}
          title={`Lücke ${clockOfMinutes(g.startMin)}–${clockOfMinutes(g.endMin)} · ${formatHm(g.endMin - g.startMin)}`}
        >
          {g.endMin - g.startMin >= 15 && `Lücke ${formatHm(g.endMin - g.startMin)}`}
        </div>
      ))}

      {day.segments.filter(visible).map((s) => {
        const e = entryById.get(s.entryId);
        if (!e) return null;
        const title = e.isAllgemeines
          ? (e.category ?? "Allgemeines")
          : (e.issueKey ?? e.description);
        const subRaw = e.isAllgemeines ? e.description : e.comment;
        const sub = subRaw === title ? "" : subRaw;
        const width = 100 / s.lanes;
        const accent = e.isAllgemeines ? "var(--teal)" : "var(--accent)";
        const soft = e.isAllgemeines ? "var(--teal-soft)" : "var(--accent-soft)";
        const { top, height: h } = box(s);
        return (
          <div
            key={`${s.entryId}-${s.startMin}`}
            data-testid="kalender-entry"
            className="absolute overflow-hidden rounded px-1.5 py-0.5 text-[11px] leading-tight"
            style={{
              top,
              height: h,
              left: `calc(${s.lane * width}% + 2px)`,
              width: `calc(${width}% - 4px)`,
              background: soft,
              borderLeft: `3px ${s.running ? "dashed" : "solid"} ${s.overlapping ? "var(--neg)" : accent}`,
              outline: s.overlapping ? "1px solid var(--neg)" : undefined,
              color: "var(--text)",
            }}
            title={`${clockOfMinutes(s.startMin)}–${s.running ? "läuft" : clockOfMinutes(s.endMin)} · ${formatHm(s.endMin - s.startMin)}\n${e.description}`}
          >
            <div className="truncate font-semibold" style={{ color: accent }}>
              {title}
            </div>
            {h >= 30 && sub && <div className="truncate">{sub}</div>}
          </div>
        );
      })}

      {day.overlaps.filter(visible).map((o) => (
        <div
          key={`o${o.startMin}`}
          data-testid="kalender-overlap"
          className="pointer-events-none absolute inset-x-0"
          style={{ ...box(o), background: OVERLAP_HATCH, opacity: 0.35 }}
          title={`Überlappung ${clockOfMinutes(o.startMin)}–${clockOfMinutes(o.endMin)}`}
        />
      ))}

      {nowMin !== null && nowMin >= firstMin && nowMin <= lastMin && (
        <div
          className="pointer-events-none absolute inset-x-0 h-0.5"
          style={{ top: toY(nowMin), background: "var(--neg)" }}
        />
      )}
    </div>
  );
}
