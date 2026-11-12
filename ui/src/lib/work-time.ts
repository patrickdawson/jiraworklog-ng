export type BreakWindow = { start: string; end: string };

/** Parses the `breaks` JSON column into a clean, validated list. */
export function parseBreaks(json: string | null | undefined): BreakWindow[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (b): b is BreakWindow =>
          !!b &&
          typeof b.start === "string" &&
          typeof b.end === "string" &&
          /^\d{1,2}:\d{2}$/.test(b.start) &&
          /^\d{1,2}:\d{2}$/.test(b.end),
      )
      .map((b) => ({ start: b.start, end: b.end }));
  } catch {
    return [];
  }
}

function atClock(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Total overlap (seconds) between [start, end] and the daily break windows. */
export function breakOverlapSeconds(
  start: Date,
  end: Date,
  breaks: BreakWindow[],
): number {
  if (end <= start || breaks.length === 0) return 0;

  let overlap = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= end) {
    for (const b of breaks) {
      const bStart = atClock(cursor, b.start);
      const bEnd = atClock(cursor, b.end);
      if (bEnd <= bStart) continue;
      const lo = Math.max(start.getTime(), bStart.getTime());
      const hi = Math.min(end.getTime(), bEnd.getTime());
      if (hi > lo) overlap += (hi - lo) / 1000;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return overlap;
}

/**
 * Effective tracked duration of an entry in seconds. When auto-pause is on,
 * the overlap with the configured break windows is subtracted.
 * For a running timer pass `endIso = null`; `now` is used as the end.
 */
export function effectiveDurationSeconds(
  startIso: string,
  endIso: string | null,
  breaks: BreakWindow[],
  autoPauseEnabled: boolean,
  now: Date = new Date(),
): number {
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : now;
  const raw = Math.max(0, (end.getTime() - start.getTime()) / 1000);
  if (!autoPauseEnabled) return raw;
  return Math.max(0, raw - breakOverlapSeconds(start, end, breaks));
}
