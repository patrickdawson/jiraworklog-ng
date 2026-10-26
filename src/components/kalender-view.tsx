"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EditEntryDialog, type EntryDraft } from "@/components/entry-dialogs";
import { GroupColorsProvider, useGroupColors } from "@/components/group-colors-context";
import { Card, PageHeader } from "@/components/ui";
import { NowProvider, useNow, useRunningSeconds } from "@/components/now-context";
import { isWeekendKey, type EntryView, type RecentEntry } from "@/lib/entries";
import { dayKey, formatHm, formatSignedHm } from "@/lib/format";
import { resolveGroupColor, type GroupColorMap } from "@/lib/group-color";
import { buildTimeline, type DayTimeline, type Interval } from "@/lib/timeline";
import type { BreakWindow } from "@/lib/work-time";

export type KalenderData = {
  weekLabel: string;
  dayKeys: string[];
  prevAnchor: string;
  nextAnchor: string;
  isCurrentWeek: boolean;
  hasRunning: boolean;
  entries: EntryView[];
  groupColors: GroupColorMap;
  /** Suggestions for the description field of the entry dialog. */
  recents: RecentEntry[];
  breaks: BreakWindow[];
  autoPauseEnabled: boolean;
  /** Overtime of this week's days, from finished entries only. */
  weekOvertimeMinutes: number;
  /** Worked minutes per day key, from finished entries only. */
  workedMinutesByDay: Record<string, number>;
  /** Weekday target, for the tooltip of the day's worked time. */
  regularWorkMinutes: number;
  /** Whether the running timer started on a day of this week. */
  runningInWeek: boolean;
  /** Target of the running entry's day if it is not yet in the overtime. */
  runningDayTargetMinutes: number;
};

/** Vertical scale of the grid before the user zooms. */
const PX_PER_HOUR = 48;
/** Largest zoom: a quarter hour is 60 px. */
const MAX_PX_PER_HOUR = 240;
/** Zoom change per pixel of wheel delta. A mouse wheel notch is ~100 px. */
const ZOOM_PER_DELTA = 0.0015;
/** Space above and below the grid: page header, summary and day headers. */
const GRID_CHROME_PX = 220;
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

/**
 * A gap as a draft for a new entry. Seconds are rounded inward, so the new
 * entry does not overlap its neighbours.
 */
function gapDraft(key: string, gap: Interval): EntryDraft {
  const [y, m, d] = key.split("-").map(Number);
  const at = (min: number) => new Date(y, m - 1, d, 0, min).toISOString();
  return {
    startedAt: at(Math.ceil(gap.startMin)),
    endedAt: at(Math.floor(gap.endMin)),
  };
}

function totalMinutes(intervals: Interval[]): number {
  return intervals.reduce((sum, i) => sum + (i.endMin - i.startMin), 0);
}

export function KalenderView({ data }: { data: KalenderData }) {
  return (
    <NowProvider active={data.hasRunning}>
      <GroupColorsProvider colors={data.groupColors}>
        <KalenderInner data={data} />
      </GroupColorsProvider>
    </NowProvider>
  );
}

function KalenderInner({ data }: { data: KalenderData }) {
  const now = useNow();
  const [editEntry, setEditEntry] = useState<EntryView | null>(null);
  const [newDraft, setNewDraft] = useState<EntryDraft | null>(null);

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

  const running = data.runningInWeek
    ? (data.entries.find((e) => e.endedAt === null) ?? null)
    : null;
  const runningSeconds = useRunningSeconds(
    running,
    data.breaks,
    data.autoPauseEnabled,
  );
  // Before the first tick the running entry is not counted at all, so the
  // server and client markup agree.
  const weekOvertime =
    running && now
      ? Math.round(
          data.weekOvertimeMinutes -
            data.runningDayTargetMinutes +
            runningSeconds / 60,
        )
      : data.weekOvertimeMinutes;

  // Same rule as the saldo: an entry counts toward its start day, and the
  // running timer only after the first tick.
  const runningDayKey = running && now ? dayKey(running.startedAt) : null;
  const workedMinutes = (key: string) =>
    (data.workedMinutesByDay[key] ?? 0) +
    (key === runningDayKey ? runningSeconds / 60 : 0);

  const overlapList = days.flatMap((d) => d.overlaps);
  const gapList = days.flatMap((d) => d.gaps);

  // The grid always holds the whole day. The scroll area is as high as the
  // week's hours at the default scale, so the first view looks as before.
  // Ctrl + wheel changes the scale: in shows fewer hours, out shows more.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pxPerHour, setPxPerHour] = useState(PX_PER_HOUR);
  const pxRef = useRef(PX_PER_HOUR);
  // The minute to keep at `offsetY` px below the scroll area's top after the
  // next render.
  const anchorRef = useRef<{ minute: number; offsetY: number } | null>(
    null,
  );
  const firstHourRef = useRef(firstHour);

  const resetZoom = () => {
    pxRef.current = PX_PER_HOUR;
    anchorRef.current = { minute: firstHour * 60, offsetY: 0 };
    setPxPerHour(PX_PER_HOUR);
  };

  // Only the first render scrolls to the week's hours. A later timer tick
  // must not move a view the user has scrolled.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = firstHourRef.current * PX_PER_HOUR;
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor) return;
    anchorRef.current = null;
    el.scrollTop = (anchor.minute / 60) * pxPerHour - anchor.offsetY;
  }, [pxPerHour]);

  // React's onWheel is passive, so it cannot stop the browser's page zoom.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const px = pxRef.current;
      const minPx = el.clientHeight / 24;
      const next = Math.min(
        MAX_PX_PER_HOUR,
        Math.max(minPx, px * Math.exp(-e.deltaY * ZOOM_PER_DELTA)),
      );
      if (next === px) return;
      const offsetY = e.clientY - el.getBoundingClientRect().top;
      anchorRef.current = {
        minute: ((el.scrollTop + offsetY) / px) * 60,
        offsetY,
      };
      pxRef.current = next;
      setPxPerHour(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomed = pxPerHour !== PX_PER_HOUR;
  const hours = Array.from({ length: 24 }, (_, i) => i);
  // Finer lines when zoomed in, fewer labels when zoomed far out.
  const subStep = pxPerHour >= 192 ? 15 : pxPerHour >= 96 ? 30 : null;
  const subMinutes = subStep
    ? Array.from({ length: (24 * 60) / subStep }, (_, i) => i * subStep).filter(
        (m) => m % 60 !== 0,
      )
    : [];
  const labelEvery = pxPerHour < 28 ? 2 : 1;
  const gridHeight = 24 * pxPerHour;
  const viewHeight = `min(max(240px, calc(100vh - ${GRID_CHROME_PX}px)), ${
    (lastHour - firstHour) * PX_PER_HOUR
  }px)`;
  const toY = (min: number) => (min / 60) * pxPerHour;

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
        <span
          data-testid="kalender-overtime"
          title={`${
            weekOvertime >= 0 ? "Überstunden" : "Minusstunden"
          } dieser Woche${running && now ? " · inkl. laufendem Timer" : ""}`}
        >
          Wochensaldo{" "}
          <span
            className="tabular-nums font-semibold"
            style={{ color: weekOvertime >= 0 ? "var(--pos)" : "var(--neg)" }}
          >
            {formatSignedHm(weekOvertime)}
          </span>
        </span>
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
        {zoomed ? (
          <button
            type="button"
            onClick={resetZoom}
            className="ml-auto cursor-pointer rounded-md border px-2 py-0.5 text-[12px] font-medium"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text)",
            }}
          >
            Zoom zurücksetzen
          </button>
        ) : (
          // Same box as the button, so the row keeps its height.
          <span
            className="ml-auto border border-transparent py-0.5 text-[12px]"
            style={{ color: "var(--text-3)" }}
          >
            Strg + Mausrad zoomt die Zeitachse
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
              // Same gutter as the scroll area below, so the columns line up.
              overflowY: "hidden",
              scrollbarGutter: "stable",
            }}
          >
            <div />
            {days.map((d) => (
              <DayHeader
                key={d.dayKey}
                day={d}
                isToday={d.dayKey === todayKey}
                workedMinutes={workedMinutes(d.dayKey)}
                targetMinutes={isWeekendKey(d.dayKey) ? 0 : data.regularWorkMinutes}
                running={d.dayKey === runningDayKey}
              />
            ))}
          </div>

          {/* Grid body */}
          <div
            ref={scrollRef}
            data-testid="kalender-scroll"
            className="overflow-y-auto"
            style={{ height: viewHeight, scrollbarGutter: "stable" }}
          >
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
                    {h > 0 && h % labelEvery === 0
                      ? `${String(h).padStart(2, "0")}:00`
                      : ""}
                  </div>
                ))}
              </div>

              {days.map((d) => (
                <DayColumn
                  key={d.dayKey}
                  day={d}
                  hours={hours}
                  subMinutes={subMinutes}
                  height={gridHeight}
                  toY={toY}
                  entryById={entryById}
                  nowMin={d.dayKey === todayKey ? nowMin : null}
                  onEdit={setEditEntry}
                  onFillGap={(g) => setNewDraft(gapDraft(d.dayKey, g))}
                />
              ))}
            </div>
          </div>
        </div>
      </Card>

      {editEntry && (
        <EditEntryDialog
          entry={editEntry}
          onClose={() => setEditEntry(null)}
          recents={data.recents}
        />
      )}
      {newDraft && (
        <EditEntryDialog
          draft={newDraft}
          onClose={() => setNewDraft(null)}
          recents={data.recents}
        />
      )}
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

// Gaps and overlaps use neutral tones, not a hue, so no group color can be
// mistaken for them. The day header counts keep red and yellow.
const OVERLAP_HATCH =
  "repeating-linear-gradient(45deg, var(--text) 0 2px, transparent 2px 6px)";

function OverlapSwatch() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-sm"
      style={{ background: OVERLAP_HATCH, border: "1px solid var(--text-2)" }}
    />
  );
}

function GapSwatch() {
  return (
    <span
      className="inline-block h-3 w-3 rounded-sm"
      style={{ border: "1px dashed var(--text-3)" }}
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

function DayHeader({
  day,
  isToday,
  workedMinutes,
  targetMinutes,
  running,
}: {
  day: DayTimeline;
  isToday: boolean;
  workedMinutes: number;
  targetMinutes: number;
  running: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between gap-1 px-2 py-2 border-l text-[12.5px] font-semibold"
      style={{
        borderColor: "var(--border)",
        color: isToday ? "var(--accent)" : "var(--text)",
      }}
    >
      <span className="flex flex-col">
        <span>{dayHeading(day.dayKey)}</span>
        {workedMinutes > 0 && (
          <span
            data-testid="kalender-day-worked"
            className="text-[11px] font-normal tabular-nums"
            style={{ color: "var(--text-2)" }}
            title={`Arbeitszeit · Soll ${formatHm(targetMinutes)}${
              running ? " · inkl. laufendem Timer" : ""
            }`}
          >
            {formatHm(workedMinutes)}
          </span>
        )}
      </span>
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
  subMinutes,
  height,
  toY,
  entryById,
  nowMin,
  onEdit,
  onFillGap,
}: {
  day: DayTimeline;
  hours: number[];
  /** Half or quarter hour lines, when zoomed in. */
  subMinutes: number[];
  height: number;
  toY: (min: number) => number;
  entryById: Map<number, EntryView>;
  nowMin: number | null;
  onEdit: (entry: EntryView) => void;
  onFillGap: (gap: Interval) => void;
}) {
  const groupColors = useGroupColors();
  const firstMin = 0;
  const lastMin = 24 * 60;
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
      {subMinutes.map((m) => (
        <div
          key={`s${m}`}
          className="absolute inset-x-0 border-t border-dashed opacity-60"
          style={{ top: toY(m), borderColor: "var(--border)" }}
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
        <button
          key={`g${g.startMin}`}
          type="button"
          data-testid="kalender-gap"
          onClick={() => onFillGap(g)}
          aria-label={`Lücke ${clockOfMinutes(g.startMin)}–${clockOfMinutes(g.endMin)} als Eintrag anlegen`}
          className="absolute inset-x-1 flex cursor-pointer items-center justify-center overflow-hidden rounded text-[10.5px] font-semibold hover:bg-[var(--surface-2)] focus-visible:ring-2"
          style={{
            ...box(g),
            border: "1px dashed var(--text-3)",
            color: "var(--text-2)",
          }}
          title={`Lücke ${clockOfMinutes(g.startMin)}–${clockOfMinutes(g.endMin)} · ${formatHm(g.endMin - g.startMin)}\nKlicken, um die Lücke als Eintrag anzulegen`}
        >
          {g.endMin - g.startMin >= 15 && `Lücke ${formatHm(g.endMin - g.startMin)}`}
        </button>
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
        const { color, accent, soft } = resolveGroupColor(groupColors, e);
        const { top, height: h } = box(s);
        const time = `${clockOfMinutes(s.startMin)}–${s.running ? "läuft" : clockOfMinutes(s.endMin)} · ${formatHm(s.endMin - s.startMin)}`;
        // Saving the dialog sets an end time, which would stop a running
        // timer — so the running entry is not editable here.
        const Tag = s.running ? "div" : "button";
        return (
          <Tag
            key={`${s.entryId}-${s.startMin}`}
            data-testid="kalender-entry"
            data-group-color={color ?? "default"}
            {...(s.running
              ? {}
              : {
                  type: "button" as const,
                  onClick: () => onEdit(e),
                  "aria-label": `${title} ${time} bearbeiten`,
                })}
            className={`absolute overflow-hidden rounded px-1.5 py-0.5 text-left text-[11px] leading-tight ${
              s.running ? "" : "cursor-pointer hover:brightness-95 focus-visible:ring-2"
            }`}
            style={{
              top,
              height: h,
              left: `calc(${s.lane * width}% + 2px)`,
              width: `calc(${width}% - 4px)`,
              background: soft,
              borderLeft: `3px ${s.running ? "dashed" : "solid"} ${accent}`,
              outline: s.overlapping ? "1px solid var(--text-2)" : undefined,
              color: "var(--text)",
            }}
            title={`${time}\n${e.description}${
              s.running ? "\nLäuft – auf Buchen bearbeiten" : ""
            }`}
          >
            <div className="truncate font-semibold" style={{ color: accent }}>
              {title}
            </div>
            {h >= 30 && sub && <div className="truncate">{sub}</div>}
          </Tag>
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
