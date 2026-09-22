/** Seconds → `hh:mm:ss` (hours not capped at 24). */
export function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Minutes → `hh:mm`. */
export function formatHm(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes → signed `±hh:mm` (used for the overtime balance). */
export function formatSignedHm(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "−" : "+";
  return `${sign}${formatHm(Math.abs(totalMinutes))}`;
}

/**
 * Minutes → signed `±hh:mm` using an ASCII `-`, suitable as an input value
 * the user can edit. (`formatSignedHm` uses a Unicode minus for display.)
 */
export function formatSignedHmInput(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "+";
  return `${sign}${formatHm(Math.abs(totalMinutes))}`;
}

/** Parses `±hh:mm` (or `hh:mm`) into signed minutes; returns null on failure. */
export function parseSignedHm(value: string): number | null {
  const match = value.trim().match(/^([+-−])?(\d{1,3}):(\d{2})$/);
  if (!match) return null;
  const sign = match[1] === "-" || match[1] === "−" ? -1 : 1;
  const h = Number(match[2]);
  const m = Number(match[3]);
  if (m >= 60) return null;
  return sign * (h * 60 + m);
}

/**
 * Minutes → Jira `timeSpent` format, e.g. `"1h 30m"` or `"45m"`.
 * Ported from jiraworklog/lib/duration.ts.
 */
export function formatDurationHoursMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours <= 0) {
    return `${remainingMinutes}m`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

/** Local calendar day key `YYYY-MM-DD` for an ISO timestamp. */
export function dayKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The UTC instant of local 00:00 on `key`, as an ISO string — i.e. a bound that
 * can be compared directly against a stored `started_at`.
 *
 * `started_at` is always written as `new Date().toISOString()`, so it is
 * fixed-width zero-padded UTC and a lexicographic compare *is* a chronological
 * compare. The trap is comparing against the wrong string: `dayKey` yields a
 * LOCAL day, so concatenating `"2026-08-31" + "T00:00:00.000Z"` describes the
 * UTC day instead. In Europe/Berlin at UTC+2 that silently drops every entry
 * started between 00:00 and 02:00 local, and wrongly pulls in the same slice of
 * the next day.
 *
 * Constructing through a local `Date` avoids that exactly, DST included — the
 * offset shifts with the date because the runtime resolves local wall-clock to
 * an absolute instant. No widening and no re-filtering in JS is needed.
 */
export function dayStartIso(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** The exclusive upper bound of local day `key` (= local 00:00 of the next day). */
export function dayEndExclusiveIso(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString();
}

/**
 * The UTC instant of local 00:00, `daysBack` days before `now`. Snapping to
 * midnight matters wherever a cutoff decides whether a whole day is in or out —
 * a rolling instant would split a day across the boundary.
 */
export function daysAgoStartIso(daysBack: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.toISOString();
}

const WEEKDAYS = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

/** Human label for a day key: `Heute`, `Gestern`, or `Mittwoch, 19.05.2026`. */
export function dayLabel(key: string): string {
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  if (key === today) return "Heute";
  if (key === yesterday) return "Gestern";
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${String(d).padStart(2, "0")}.${String(
    m,
  ).padStart(2, "0")}.${y}`;
}

/** `HH:MM` clock time for an ISO timestamp. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}
