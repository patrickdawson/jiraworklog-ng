import { dayKey } from "./format";
import type { BreakWindow } from "./work-time";

/**
 * Calendar timeline geometry. Everything is in minutes since local midnight of
 * one day, so a day column can place blocks without knowing about time zones.
 * Entries that cross midnight are split into one segment per day.
 */

export type TimelineEntry = {
  id: number;
  startedAt: string;
  /** `null` for the running timer; it then ends at `now`. */
  endedAt: string | null;
};

export type Segment = {
  entryId: number;
  startMin: number;
  endMin: number;
  running: boolean;
};

export type Interval = { startMin: number; endMin: number };

export type PlacedSegment = Segment & {
  /** Side-by-side column inside its overlap cluster, 0-based. */
  lane: number;
  /** Number of columns that cluster needs. */
  lanes: number;
  /** Shares time with at least one other segment of the same day. */
  overlapping: boolean;
};

export type DayTimeline = {
  dayKey: string;
  segments: PlacedSegment[];
  overlaps: Interval[];
  gaps: Interval[];
  breaks: Interval[];
};

/** Gaps shorter than this are rounding noise, not missing time. */
const MIN_GAP_MINUTES = 1;

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function localMidnight(key: string, plusDays = 0): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d + plusDays, 0, 0, 0, 0);
}

/** Splits entries into per-day segments for the given day keys. */
export function splitByDay(
  entries: TimelineEntry[],
  dayKeys: string[],
  now: Date,
): Map<string, Segment[]> {
  const result = new Map<string, Segment[]>(dayKeys.map((k) => [k, []]));
  for (const e of entries) {
    const start = new Date(e.startedAt);
    const end = e.endedAt ? new Date(e.endedAt) : now;
    if (end <= start) continue;
    for (const key of dayKeys) {
      const dayStart = localMidnight(key);
      const dayEnd = localMidnight(key, 1);
      if (end <= dayStart || start >= dayEnd) continue;
      const startMin = start <= dayStart ? 0 : minutesOfDay(start);
      const endMin = end >= dayEnd ? 24 * 60 : minutesOfDay(end);
      if (endMin <= startMin) continue;
      result.get(key)!.push({
        entryId: e.id,
        startMin,
        endMin,
        running: e.endedAt === null,
      });
    }
  }
  for (const list of result.values()) {
    list.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  }
  return result;
}

/** Merges intervals into a sorted list of disjoint intervals. */
function union(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.startMin - b.startMin);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, i.endMin);
    } else {
      out.push({ startMin: i.startMin, endMin: i.endMin });
    }
  }
  return out;
}

/** Removes `cut` from `base`. Both lists must be sorted and disjoint. */
function subtract(base: Interval[], cut: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const b of base) {
    let pieces: Interval[] = [b];
    for (const c of cut) {
      pieces = pieces.flatMap((p) => {
        if (c.endMin <= p.startMin || c.startMin >= p.endMin) return [p];
        const rest: Interval[] = [];
        if (c.startMin > p.startMin) {
          rest.push({ startMin: p.startMin, endMin: c.startMin });
        }
        if (c.endMin < p.endMin) {
          rest.push({ startMin: c.endMin, endMin: p.endMin });
        }
        return rest;
      });
    }
    out.push(...pieces);
  }
  return out;
}

/** Time ranges where two or more segments run at once, merged. */
export function findOverlaps(segments: Segment[]): Interval[] {
  const events: { at: number; delta: 1 | -1 }[] = [];
  for (const s of segments) {
    events.push({ at: s.startMin, delta: 1 }, { at: s.endMin, delta: -1 });
  }
  // Ends before starts at the same minute: back-to-back is not an overlap.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  const out: Interval[] = [];
  let depth = 0;
  let openedAt = 0;
  for (const ev of events) {
    const before = depth;
    depth += ev.delta;
    if (before < 2 && depth >= 2) openedAt = ev.at;
    if (before >= 2 && depth < 2 && ev.at > openedAt) {
      out.push({ startMin: openedAt, endMin: ev.at });
    }
  }
  return union(out);
}

/** Configured break windows of one day, as minutes. */
export function breakIntervals(breaks: BreakWindow[]): Interval[] {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  return union(
    breaks
      .map((b) => ({ startMin: toMin(b.start), endMin: toMin(b.end) }))
      .filter((b) => b.endMin > b.startMin),
  );
}

/**
 * Untracked time between the first start and the last end of the day.
 * Break windows are not gaps.
 */
export function findGaps(segments: Segment[], breaks: Interval[]): Interval[] {
  if (segments.length === 0) return [];
  const covered = union(segments);
  const span: Interval = {
    startMin: covered[0].startMin,
    endMin: covered[covered.length - 1].endMin,
  };
  const holes = subtract([span], covered);
  return subtract(holes, breaks).filter(
    (g) => g.endMin - g.startMin >= MIN_GAP_MINUTES,
  );
}

/**
 * Calendar lane packing: segments that overlap sit side by side. A cluster is
 * a run of transitively overlapping segments; all of them share its lane count.
 */
export function layoutLanes(segments: Segment[]): PlacedSegment[] {
  const sorted = [...segments].sort(
    (a, b) => a.startMin - b.startMin || b.endMin - a.endMin,
  );
  const placed: PlacedSegment[] = [];
  let cluster: PlacedSegment[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;

  const closeCluster = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const s of sorted) {
    if (s.startMin >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= s.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.endMin);
    } else {
      laneEnds[lane] = s.endMin;
    }
    const p: PlacedSegment = { ...s, lane, lanes: 1, overlapping: false };
    cluster.push(p);
    placed.push(p);
    clusterEnd = Math.max(clusterEnd, s.endMin);
  }
  closeCluster();

  for (const p of placed) {
    p.overlapping = placed.some(
      (o) => o !== p && o.startMin < p.endMin && p.startMin < o.endMin,
    );
  }
  return placed;
}

/** Full timeline for a list of days: placed blocks, overlaps, gaps, breaks. */
export function buildTimeline(
  entries: TimelineEntry[],
  dayKeys: string[],
  breaks: BreakWindow[],
  now: Date,
): DayTimeline[] {
  const byDay = splitByDay(entries, dayKeys, now);
  const breakMins = breakIntervals(breaks);
  return dayKeys.map((key) => {
    const segments = byDay.get(key) ?? [];
    return {
      dayKey: key,
      segments: layoutLanes(segments),
      overlaps: findOverlaps(segments),
      gaps: findGaps(segments, breakMins),
      breaks: breakMins,
    };
  });
}

/** `YYYY-MM-DD` keys for `count` consecutive local days from `from`. */
export function consecutiveDayKeys(from: Date, count: number): string[] {
  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    keys.push(dayKey(d));
  }
  return keys;
}
