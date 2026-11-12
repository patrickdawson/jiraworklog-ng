//! Effective durations: tracked time minus the daily break windows.
//! Port of src/lib/work-time.ts.

use chrono::{DateTime, Days, NaiveTime, TimeZone, Utc};

use crate::days::{local_instant, local_midnight};
use crate::settings::BreakWindow;

fn clock(hhmm: &str) -> Option<NaiveTime> {
    let (h, m) = hhmm.split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    // JS setHours(25, 0) rolls into the next day; real settings never do that.
    NaiveTime::from_hms_opt(h, m, 0)
}

/// Seconds of `[start, end]` that overlap the break windows, on every local
/// day the span touches.
pub fn break_overlap_seconds<Tz: TimeZone>(
    start: DateTime<Utc>,
    end: DateTime<Utc>,
    breaks: &[BreakWindow],
    tz: &Tz,
) -> f64 {
    if end <= start || breaks.is_empty() {
        return 0.0;
    }
    let mut overlap_ms: i64 = 0;
    let mut day = start.with_timezone(tz).date_naive();
    while local_midnight(day, tz) <= end {
        for b in breaks {
            let (Some(from), Some(to)) = (clock(&b.start), clock(&b.end)) else {
                continue;
            };
            let b_start = local_instant(day.and_time(from), tz);
            let b_end = local_instant(day.and_time(to), tz);
            if b_end <= b_start {
                continue;
            }
            let lo = start.max(b_start);
            let hi = end.min(b_end);
            if hi > lo {
                overlap_ms += (hi - lo).num_milliseconds();
            }
        }
        day = day + Days::new(1);
    }
    overlap_ms as f64 / 1000.0
}

/// Tracked seconds of an entry (`end = None`: still running, ends `now`),
/// minus the break overlap when auto-pause is on.
pub fn effective_duration_seconds<Tz: TimeZone>(
    start: DateTime<Utc>,
    end: Option<DateTime<Utc>>,
    breaks: &[BreakWindow],
    auto_pause: bool,
    now: DateTime<Utc>,
    tz: &Tz,
) -> f64 {
    let end = end.unwrap_or(now);
    let raw = ((end - start).num_milliseconds() as f64 / 1000.0).max(0.0);
    if !auto_pause {
        return raw;
    }
    (raw - break_overlap_seconds(start, end, breaks, tz)).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::days::parse_iso;
    use chrono_tz::Europe::Berlin;

    fn at(iso: &str) -> DateTime<Utc> {
        parse_iso(iso).unwrap()
    }

    fn lunch() -> Vec<BreakWindow> {
        vec![BreakWindow {
            start: "12:00".into(),
            end: "12:30".into(),
        }]
    }

    #[test]
    fn subtracts_the_lunch_break_in_local_time() {
        // 09:00–17:00 Berlin (CEST) = 07:00–15:00 UTC.
        let s = effective_duration_seconds(
            at("2026-06-01T07:00:00.000Z"),
            Some(at("2026-06-01T15:00:00.000Z")),
            &lunch(),
            true,
            Utc::now(),
            &Berlin,
        );
        assert_eq!(s, 7.5 * 3600.0);
    }

    #[test]
    fn partial_overlap_and_auto_pause_off() {
        let (start, end) = (
            at("2026-06-01T10:15:00.000Z"),
            at("2026-06-01T11:00:00.000Z"),
        );
        let on = effective_duration_seconds(start, Some(end), &lunch(), true, Utc::now(), &Berlin);
        assert_eq!(on, 30.0 * 60.0); // 12:15–13:00 local loses 12:15–12:30
        let off =
            effective_duration_seconds(start, Some(end), &lunch(), false, Utc::now(), &Berlin);
        assert_eq!(off, 45.0 * 60.0);
    }

    #[test]
    fn spans_over_several_days_lose_every_break() {
        let s = break_overlap_seconds(
            at("2026-06-01T08:00:00.000Z"),
            at("2026-06-03T08:00:00.000Z"),
            &lunch(),
            &Berlin,
        );
        assert_eq!(s, 2.0 * 30.0 * 60.0);
    }

    #[test]
    fn running_entry_ends_now_and_never_goes_negative() {
        let now = at("2026-06-01T08:00:00.123Z");
        let s = effective_duration_seconds(
            at("2026-06-01T07:00:00.000Z"),
            None,
            &[],
            true,
            now,
            &Berlin,
        );
        assert_eq!(s, 3600.123);
        let neg = effective_duration_seconds(
            now,
            Some(at("2026-06-01T07:00:00.000Z")),
            &[],
            true,
            now,
            &Berlin,
        );
        assert_eq!(neg, 0.0);
    }
}
