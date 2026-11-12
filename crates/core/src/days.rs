//! Local calendar days. Port of the day helpers in src/lib/format.ts and
//! `isWeekendKey` from src/lib/entries.ts.
//!
//! Timestamps are stored as UTC ISO strings (`2026-11-10T14:09:00.123Z`); the
//! user thinks in local days. Every function takes the time zone explicitly so
//! tests can pin Europe/Berlin; the app passes [`chrono::Local`].

use chrono::{
    DateTime, Datelike, Days, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc, Weekday,
};

use crate::time::to_iso;

/// Parses a stored or submitted ISO timestamp.
pub fn parse_iso(iso: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(iso)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// `YYYY-MM-DD` of the local day an instant falls on.
pub fn day_key<Tz: TimeZone>(at: DateTime<Utc>, tz: &Tz) -> String {
    at.with_timezone(tz)
        .date_naive()
        .format("%Y-%m-%d")
        .to_string()
}

/// [`day_key`] of a stored ISO string; an unparseable value yields `""`.
pub fn day_key_of<Tz: TimeZone>(iso: &str, tz: &Tz) -> String {
    parse_iso(iso).map(|d| day_key(d, tz)).unwrap_or_default()
}

pub fn parse_key(key: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(key, "%Y-%m-%d").ok()
}

/// A local wall-clock time as an instant. Like JavaScript's `Date`, a time in
/// the spring-forward gap moves forward, and an ambiguous one takes the earlier.
pub fn local_instant<Tz: TimeZone>(naive: NaiveDateTime, tz: &Tz) -> DateTime<Utc> {
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(d) | LocalResult::Ambiguous(d, _) => d.with_timezone(&Utc),
        LocalResult::None => local_instant(naive + chrono::Duration::hours(1), tz),
    }
}

/// Local 00:00 of `date` as an instant.
pub fn local_midnight<Tz: TimeZone>(date: NaiveDate, tz: &Tz) -> DateTime<Utc> {
    local_instant(date.and_hms_opt(0, 0, 0).expect("midnight exists"), tz)
}

/// UTC ISO of local 00:00, `days_back` calendar days before `now`'s local day.
pub fn days_ago_start_iso<Tz: TimeZone>(days_back: u32, now: DateTime<Utc>, tz: &Tz) -> String {
    let today = now.with_timezone(tz).date_naive();
    let day = today - Days::new(days_back.into());
    to_iso(local_midnight(day, tz))
}

/// Whether a `YYYY-MM-DD` key is a Saturday or Sunday.
pub fn is_weekend_key(key: &str) -> bool {
    parse_key(key).is_some_and(|d| matches!(d.weekday(), Weekday::Sat | Weekday::Sun))
}

const WEEKDAYS: [&str; 7] = [
    "Montag",
    "Dienstag",
    "Mittwoch",
    "Donnerstag",
    "Freitag",
    "Samstag",
    "Sonntag",
];

/// `Heute`, `Gestern`, or `Mittwoch, 19.05.2026`.
pub fn day_label<Tz: TimeZone>(key: &str, now: DateTime<Utc>, tz: &Tz) -> String {
    if key == day_key(now, tz) {
        return "Heute".into();
    }
    // JS: dayKey(Date.now() - 86_400_000), a plain 24 h step back.
    if key == day_key(now - chrono::Duration::days(1), tz) {
        return "Gestern".into();
    }
    match parse_key(key) {
        Some(d) => format!(
            "{}, {:02}.{:02}.{}",
            WEEKDAYS[d.weekday().num_days_from_monday() as usize],
            d.day(),
            d.month(),
            d.year()
        ),
        None => key.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono_tz::Europe::Berlin;

    fn at(iso: &str) -> DateTime<Utc> {
        parse_iso(iso).unwrap()
    }

    #[test]
    fn day_key_uses_the_local_day() {
        // 23:30 UTC on 31 Aug is already 1 Sep in Berlin (UTC+2).
        assert_eq!(
            day_key(at("2026-08-31T23:30:00.000Z"), &Berlin),
            "2026-09-01"
        );
        assert_eq!(
            day_key(at("2026-01-15T22:59:59.999Z"), &Berlin),
            "2026-01-15"
        );
        assert_eq!(day_key_of("garbage", &Berlin), "");
    }

    #[test]
    fn days_ago_start_snaps_to_local_midnight_across_dst() {
        let now = at("2026-03-30T10:00:00.000Z"); // Monday after the switch to CEST
        assert_eq!(
            days_ago_start_iso(0, now, &Berlin),
            "2026-03-29T22:00:00.000Z"
        );
        assert_eq!(
            days_ago_start_iso(2, now, &Berlin),
            "2026-03-27T23:00:00.000Z"
        );
    }

    #[test]
    fn weekend_and_labels() {
        assert!(is_weekend_key("2026-11-14"));
        assert!(!is_weekend_key("2026-11-13"));
        let now = at("2026-11-10T12:00:00.000Z");
        assert_eq!(day_label("2026-11-10", now, &Berlin), "Heute");
        assert_eq!(day_label("2026-11-09", now, &Berlin), "Gestern");
        assert_eq!(
            day_label("2026-05-19", now, &Berlin),
            "Dienstag, 19.05.2026"
        );
    }

    #[test]
    fn gap_times_move_forward_like_javascript() {
        let naive = NaiveDate::from_ymd_opt(2026, 3, 29)
            .unwrap()
            .and_hms_opt(2, 30, 0)
            .unwrap();
        assert_eq!(
            to_iso(local_instant(naive, &Berlin)),
            "2026-03-29T01:30:00.000Z"
        );
    }
}
