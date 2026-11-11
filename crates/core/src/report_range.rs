//! Report periods (Woche, Sprint, Monat, YTD, Alle). Port of
//! src/lib/report-range.ts.
//!
//! A period is a run of whole local days. `from` is local 00:00 of the first
//! day and `to` local 23:59:59.999 of the last, like the JavaScript version,
//! so `started_at BETWEEN from AND to` selects the same rows.

use chrono::{DateTime, Datelike, Days, Months, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::days::{local_instant, local_midnight};
use crate::time::to_iso;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum RangeKind {
    Week,
    Sprint,
    Month,
    Ytd,
    All,
}

impl RangeKind {
    /// Parses the `range` query value. Unknown or missing → `Month`.
    pub fn parse(value: Option<&str>) -> Self {
        match value {
            Some("week") => Self::Week,
            Some("sprint") => Self::Sprint,
            Some("ytd") => Self::Ytd,
            Some("all") => Self::All,
            _ => Self::Month,
        }
    }
}

/// Sprint cadence from the settings.
#[derive(Debug, Clone)]
pub struct SprintConfig {
    /// Start day (`YYYY-MM-DD`) of any sprint.
    pub anchor_date: String,
    pub length_days: i32,
}

impl Default for SprintConfig {
    fn default() -> Self {
        Self {
            anchor_date: "2026-01-07".into(),
            length_days: 14,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedRange {
    pub kind: RangeKind,
    /// Canonical anchor `YYYY-MM-DD`; empty for `All`.
    pub anchor: String,
    /// UTC ISO of local 00:00 of the first day.
    pub from: String,
    /// UTC ISO of local 23:59:59.999 of the last day.
    pub to: String,
    /// Short label for the UI ("Mai 2026").
    pub label: String,
    /// File name slug ("2026-05").
    pub slug: String,
    /// Whether previous/next make sense for this kind.
    pub navigable: bool,
    /// Set only for `Sprint`.
    pub sprint_length_days: Option<i32>,
    /// Anchor of the previous period; `None` when not navigable.
    pub prev_anchor: Option<String>,
    /// Anchor of the next period; `None` when not navigable.
    pub next_anchor: Option<String>,
    #[serde(skip)]
    pub first_day: NaiveDate,
    #[serde(skip)]
    pub last_day: NaiveDate,
}

impl ResolvedRange {
    /// Every local day of the period, ascending, as `YYYY-MM-DD`.
    pub fn day_keys(&self) -> Vec<String> {
        self.first_day
            .iter_days()
            .take_while(|d| *d <= self.last_day)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .collect()
    }
}

const MONTHS: [&str; 12] = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
];

fn key(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

/// `new Date(y, m0, d)`: month and day overflow into the next unit.
fn js_date(y: i32, m0: i32, d: i32) -> Option<NaiveDate> {
    let months = i64::from(y) * 12 + i64::from(m0);
    let year = i32::try_from(months.div_euclid(12)).ok()?;
    let month = u32::try_from(months.rem_euclid(12)).ok()? + 1;
    let first = NaiveDate::from_ymd_opt(year, month, 1)?;
    let offset = i64::from(d) - 1;
    first.checked_add_signed(chrono::Duration::days(offset))
}

/// `YYYY-MM-DD`, `YYYY-MM` or `YYYY` → local day; anything else → today.
fn parse_anchor(value: Option<&str>, today: NaiveDate) -> NaiveDate {
    let parsed = value.and_then(|v| {
        let parts: Vec<&str> = v.split('-').collect();
        let digits = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit());
        let num = |s: &str| s.parse::<i32>().ok();
        match parts.as_slice() {
            [y, m, d] if digits(y, 4) && digits(m, 2) && digits(d, 2) => {
                js_date(num(y)?, num(m)? - 1, num(d)?)
            }
            [y, m] if digits(y, 4) && digits(m, 2) => js_date(num(y)?, num(m)? - 1, 1),
            [y] if digits(y, 4) => js_date(num(y)?, 0, 1),
            _ => None,
        }
    });
    parsed.unwrap_or(today)
}

fn monday_of(d: NaiveDate) -> NaiveDate {
    d - Days::new(d.weekday().num_days_from_monday().into())
}

fn add_days(d: NaiveDate, n: i64) -> NaiveDate {
    d + chrono::Duration::days(n)
}

fn end_of_day<Tz: TimeZone>(d: NaiveDate, tz: &Tz) -> DateTime<Utc> {
    local_instant(
        d.and_hms_milli_opt(23, 59, 59, 999).expect("valid time"),
        tz,
    )
}

/// `dd.mm.–dd.mm.yyyy`
fn span_label(from: NaiveDate, to: NaiveDate) -> String {
    format!(
        "{:02}.{:02}.–{:02}.{:02}.{}",
        from.day(),
        from.month(),
        to.day(),
        to.month(),
        to.year()
    )
}

/// The period of `kind` that contains `anchor` (default: today).
pub fn resolve<Tz: TimeZone>(
    kind: RangeKind,
    anchor: Option<&str>,
    now: DateTime<Utc>,
    sprint: &SprintConfig,
    tz: &Tz,
) -> ResolvedRange {
    let today = now.with_timezone(tz).date_naive();
    let anchor_day = parse_anchor(anchor, today);

    let (first, last, label, slug, sprint_len) = match kind {
        RangeKind::Week => {
            let monday = monday_of(anchor_day);
            let sunday = add_days(monday, 6);
            let iso = monday.iso_week();
            (
                monday,
                sunday,
                format!("KW {:02} · {}", iso.week(), span_label(monday, sunday)),
                format!("{}-W{:02}", iso.year(), iso.week()),
                None,
            )
        }
        RangeKind::Sprint => {
            let length = sprint.length_days.max(1);
            let sprint_anchor = parse_anchor(Some(&sprint.anchor_date), today);
            let diff = (anchor_day - sprint_anchor).num_days();
            let index = diff.div_euclid(i64::from(length));
            let from = add_days(sprint_anchor, index * i64::from(length));
            let to = add_days(from, i64::from(length) - 1);
            (
                from,
                to,
                format!("Sprint · {}", span_label(from, to)),
                format!("sprint-{}", key(from)),
                Some(length),
            )
        }
        RangeKind::Month => {
            let first = anchor_day.with_day(1).expect("day 1 exists");
            let last = first + Months::new(1) - Days::new(1);
            (
                first,
                last,
                format!("{} {}", MONTHS[first.month0() as usize], first.year()),
                format!("{}-{:02}", first.year(), first.month()),
                None,
            )
        }
        RangeKind::Ytd => {
            let year = anchor_day.year();
            let first = NaiveDate::from_ymd_opt(year, 1, 1).expect("valid");
            let current = year == today.year();
            let last = if current {
                today
            } else {
                NaiveDate::from_ymd_opt(year, 12, 31).expect("valid")
            };
            let (label, slug) = if current {
                (format!("YTD {year}"), format!("ytd-{year}"))
            } else {
                (format!("Jahr {year}"), format!("jahr-{year}"))
            };
            (first, last, label, slug, None)
        }
        RangeKind::All => (
            NaiveDate::from_ymd_opt(2000, 1, 1).expect("valid"),
            today,
            "Alle Einträge".into(),
            "alle".into(),
            None,
        ),
    };

    let anchor = if kind == RangeKind::All {
        String::new()
    } else {
        key(first)
    };
    let shift = |delta: i64| shift_anchor(kind, first, sprint_len, delta);
    ResolvedRange {
        kind,
        from: to_iso(local_midnight(first, tz)),
        to: to_iso(end_of_day(last, tz)),
        label,
        slug,
        navigable: kind != RangeKind::All,
        sprint_length_days: sprint_len,
        prev_anchor: shift(-1),
        next_anchor: shift(1),
        anchor,
        first_day: first,
        last_day: last,
    }
}

/// The anchor of the period `delta` steps away. Port of `shiftRange`.
fn shift_anchor(
    kind: RangeKind,
    anchor: NaiveDate,
    sprint_len: Option<i32>,
    delta: i64,
) -> Option<String> {
    let d = match kind {
        RangeKind::Week => add_days(anchor, delta * 7),
        RangeKind::Sprint => add_days(anchor, delta * i64::from(sprint_len.unwrap_or(14))),
        RangeKind::Month => {
            if delta < 0 {
                anchor - Months::new(1)
            } else {
                anchor + Months::new(1)
            }
        }
        RangeKind::Ytd => NaiveDate::from_ymd_opt(anchor.year() + delta as i32, 1, 1)?,
        RangeKind::All => return None,
    };
    Some(key(d))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::days::parse_iso;
    use chrono_tz::Europe::Berlin;

    fn now() -> DateTime<Utc> {
        parse_iso("2026-11-11T10:00:00.000Z").unwrap() // Wednesday
    }

    fn r(kind: RangeKind, anchor: Option<&str>) -> ResolvedRange {
        resolve(kind, anchor, now(), &SprintConfig::default(), &Berlin)
    }

    #[test]
    fn week_runs_monday_to_sunday_in_local_time() {
        let w = r(RangeKind::Week, None);
        assert_eq!(w.anchor, "2026-11-09");
        assert_eq!(w.from, "2026-11-08T23:00:00.000Z");
        assert_eq!(w.to, "2026-11-15T22:59:59.999Z");
        assert_eq!(w.label, "KW 46 · 09.11.–15.11.2026");
        assert_eq!(w.slug, "2026-W46");
        assert_eq!(w.prev_anchor.as_deref(), Some("2026-11-02"));
        assert_eq!(w.next_anchor.as_deref(), Some("2026-11-16"));
        assert_eq!(w.day_keys().len(), 7);

        // ISO week year differs from the calendar year at the turn of the year.
        let w = r(RangeKind::Week, Some("2027-01-01"));
        assert_eq!(w.slug, "2026-W53");
        assert_eq!(w.anchor, "2026-12-28");
    }

    #[test]
    fn week_across_the_dst_switch() {
        let w = r(RangeKind::Week, Some("2026-03-25"));
        assert_eq!(w.from, "2026-03-22T23:00:00.000Z");
        assert_eq!(w.to, "2026-03-29T21:59:59.999Z");
    }

    #[test]
    fn sprint_counts_from_the_anchor_in_both_directions() {
        let s = r(RangeKind::Sprint, Some("2026-01-20"));
        assert_eq!(s.anchor, "2026-01-07");
        assert_eq!(s.label, "Sprint · 07.01.–20.01.2026");
        assert_eq!(s.slug, "sprint-2026-01-07");
        assert_eq!(s.sprint_length_days, Some(14));
        assert_eq!(s.next_anchor.as_deref(), Some("2026-01-21"));

        let before = r(RangeKind::Sprint, Some("2026-01-06"));
        assert_eq!(before.anchor, "2025-12-24");
    }

    #[test]
    fn month_ytd_and_all() {
        let m = r(RangeKind::Month, Some("2026-05-17"));
        assert_eq!(m.anchor, "2026-05-01");
        assert_eq!(m.label, "Mai 2026");
        assert_eq!(m.slug, "2026-05");
        assert_eq!(m.day_keys().len(), 31);
        assert_eq!(m.prev_anchor.as_deref(), Some("2026-04-01"));
        assert_eq!(m.next_anchor.as_deref(), Some("2026-06-01"));
        assert_eq!(r(RangeKind::Month, Some("2026-03")).label, "März 2026");

        let y = r(RangeKind::Ytd, None);
        assert_eq!(y.label, "YTD 2026");
        assert_eq!(y.to, "2026-11-11T22:59:59.999Z");
        let past = r(RangeKind::Ytd, Some("2024"));
        assert_eq!(past.label, "Jahr 2024");
        assert_eq!(past.slug, "jahr-2024");
        assert_eq!(past.day_keys().len(), 366);
        assert_eq!(past.next_anchor.as_deref(), Some("2025-01-01"));

        let all = r(RangeKind::All, Some("2026-01-01"));
        assert_eq!(all.anchor, "");
        assert!(!all.navigable);
        assert_eq!(all.prev_anchor, None);
        assert_eq!(all.from, "1999-12-31T23:00:00.000Z");
    }

    #[test]
    fn anchors_parse_like_javascript() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 11).unwrap();
        let p = |s: &str| key(parse_anchor(Some(s), today));
        assert_eq!(p("2026-02-31"), "2026-03-03"); // overflow like new Date()
        assert_eq!(p("2026-13-01"), "2027-01-01");
        assert_eq!(p("2026-00-10"), "2025-12-10");
        assert_eq!(p("2026-05"), "2026-05-01");
        assert_eq!(p("2026"), "2026-01-01");
        assert_eq!(p("garbage"), "2026-11-11");
        assert_eq!(key(parse_anchor(None, today)), "2026-11-11");
        assert_eq!(RangeKind::parse(Some("ytd")), RangeKind::Ytd);
        assert_eq!(RangeKind::parse(Some("x")), RangeKind::Month);
    }
}
