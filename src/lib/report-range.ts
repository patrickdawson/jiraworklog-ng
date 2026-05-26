export const RANGE_KINDS = ["week", "month", "ytd", "all"] as const;
export type RangeKind = (typeof RANGE_KINDS)[number];

export type ResolvedRange = {
  kind: RangeKind;
  /** Canonical anchor as `YYYY-MM-DD` for week/month/ytd; empty for `all`. */
  anchor: string;
  from: Date;
  to: Date;
  /** Short label for UI ("Mai 2026"). */
  label: string;
  /** Filename slug ("2026-05"). */
  slug: string;
  /** Whether prev/next navigation is meaningful for this range kind. */
  navigable: boolean;
};

const MONTH_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
});

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Monday 00:00 of the week containing `d` (local time, ISO weeks). */
function mondayOf(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const x = new Date(d);
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** ISO 8601 week number for a local date. */
function isoWeek(d: Date): { week: number; year: number } {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return { week, year: target.getUTCFullYear() };
}

/** Parses a `YYYY-MM-DD` anchor into a local-midnight Date. Falls back to today. */
function parseAnchor(value: string | null | undefined): Date {
  if (value) {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const date = new Date(y, mo - 1, d);
      if (!Number.isNaN(date.getTime())) return startOfDay(date);
    }
    // Tolerate `YYYY-MM` (month input) and `YYYY` for YTD.
    const mm = value.match(/^(\d{4})-(\d{2})$/);
    if (mm) return startOfDay(new Date(Number(mm[1]), Number(mm[2]) - 1, 1));
    const yy = value.match(/^(\d{4})$/);
    if (yy) return startOfDay(new Date(Number(yy[1]), 0, 1));
  }
  return startOfDay(new Date());
}

/** Parses + normalises a kind string. Unknown → `"month"`. */
export function parseRangeKind(value: string | null | undefined): RangeKind {
  return (RANGE_KINDS as readonly string[]).includes(value ?? "")
    ? (value as RangeKind)
    : "month";
}

export function resolveRange(
  kind: RangeKind,
  anchorRaw: string | null | undefined,
  now: Date = new Date(),
): ResolvedRange {
  const anchorDate = parseAnchor(anchorRaw);

  if (kind === "week") {
    const monday = mondayOf(anchorDate);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const iso = isoWeek(monday);
    const label = `KW ${pad(iso.week)} · ${pad(monday.getDate())}.${pad(
      monday.getMonth() + 1,
    )}.–${pad(sunday.getDate())}.${pad(sunday.getMonth() + 1)}.${sunday.getFullYear()}`;
    return {
      kind,
      anchor: localDayKey(monday),
      from: monday,
      to: endOfDay(sunday),
      label,
      slug: `${iso.year}-W${pad(iso.week)}`,
      navigable: true,
    };
  }

  if (kind === "month") {
    const first = new Date(
      anchorDate.getFullYear(),
      anchorDate.getMonth(),
      1,
    );
    const last = new Date(
      anchorDate.getFullYear(),
      anchorDate.getMonth() + 1,
      0,
    );
    return {
      kind,
      anchor: localDayKey(first),
      from: startOfDay(first),
      to: endOfDay(last),
      label: MONTH_FORMATTER.format(first),
      slug: `${first.getFullYear()}-${pad(first.getMonth() + 1)}`,
      navigable: true,
    };
  }

  if (kind === "ytd") {
    const year = anchorDate.getFullYear();
    const first = new Date(year, 0, 1);
    const isCurrent = year === now.getFullYear();
    const last = isCurrent ? endOfDay(now) : endOfDay(new Date(year, 11, 31));
    return {
      kind,
      anchor: localDayKey(first),
      from: startOfDay(first),
      to: last,
      label: isCurrent ? `YTD ${year}` : `Jahr ${year}`,
      slug: isCurrent ? `ytd-${year}` : `jahr-${year}`,
      navigable: true,
    };
  }

  // kind === "all"
  return {
    kind: "all",
    anchor: "",
    from: new Date(2000, 0, 1),
    to: endOfDay(now),
    label: "Alle Einträge",
    slug: "alle",
    navigable: false,
  };
}

/** Returns the anchor string for a previous/next period of the same kind. */
export function shiftRange(
  resolved: ResolvedRange,
  delta: -1 | 1,
): string | null {
  if (!resolved.navigable) return null;
  const base = parseAnchor(resolved.anchor);
  if (resolved.kind === "week") {
    base.setDate(base.getDate() + delta * 7);
    return localDayKey(base);
  }
  if (resolved.kind === "month") {
    base.setMonth(base.getMonth() + delta);
    return localDayKey(new Date(base.getFullYear(), base.getMonth(), 1));
  }
  if (resolved.kind === "ytd") {
    return `${base.getFullYear() + delta}-01-01`;
  }
  return null;
}

/** Builds the search string for `/auswertung?...` for a given range. */
export function rangeQuery(kind: RangeKind, anchor: string): string {
  const params = new URLSearchParams({ range: kind });
  if (kind !== "all" && anchor) params.set("anchor", anchor);
  return `?${params.toString()}`;
}
