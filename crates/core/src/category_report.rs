//! The data of the "Axapta-Bericht": worked time of one calendar month per
//! report category, split into bookable blocks of at most 24 hours, plus a
//! per-day overview. Port of src/lib/category-report.ts and the query part of
//! src/app/api/report/category-pdf.

use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, NaiveDate, TimeZone, Utc};
use rusqlite::Connection;
use serde::Serialize;

use crate::days::day_key_of;
use crate::entries::{finished_seconds, AllgemeinesCategory, TimeEntry};
use crate::error::Result;
use crate::report_range::{RangeKind, ResolvedRange};
use crate::settings::SettingsInput;
use crate::store;
use crate::time::js_round;
use crate::worklog_report::{display_name, settings_and_range, started_in};

/// A single booking entry in the external tool may cover at most 24 hours.
const BLOCK_MINUTES: i32 = 24 * 60;

/// Fallback for Allgemeines entries that somehow lack a category.
const FALLBACK_CATEGORY: AllgemeinesCategory = AllgemeinesCategory::Projektorganisation;

/// The four report categories in their canonical order.
pub const CATEGORIES: [AllgemeinesCategory; 4] = [
    AllgemeinesCategory::Projektorganisation,
    AllgemeinesCategory::Implementierung,
    AllgemeinesCategory::Qa,
    AllgemeinesCategory::Release,
];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryReportItem {
    pub name: AllgemeinesCategory,
    pub total_minutes: i32,
    /// The total split into ≤ 24h blocks (`n × 1440` + remainder).
    pub blocks: Vec<i32>,
}

/// Per-day row for the verification overview: minutes per category + total.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryReportDay {
    pub day_key: String,
    /// Short German label, e.g. "Mo 01.06.".
    pub label: String,
    /// Every category, in canonical order (0 when unused).
    pub minutes_by_category: BTreeMap<AllgemeinesCategory, i32>,
    pub total_minutes: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryReport {
    pub display_name: String,
    pub range_label: String,
    /// Only categories with booked time, in the canonical category order.
    pub categories: Vec<CategoryReportItem>,
    /// Every day with tracked time, ascending; for capture verification.
    pub days: Vec<CategoryReportDay>,
    pub total_minutes: i32,
}

impl CategoryReport {
    /// The month total of `name`, 0 if unused.
    pub fn category_total(&self, name: AllgemeinesCategory) -> i32 {
        self.categories
            .iter()
            .find(|c| c.name == name)
            .map_or(0, |c| c.total_minutes)
    }
}

const WEEKDAY_SHORT: [&str; 7] = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/// `YYYY-MM-DD` → "Mo 01.06.".
fn format_day_short(dk: &str) -> String {
    match NaiveDate::parse_from_str(dk, "%Y-%m-%d") {
        Ok(d) => format!(
            "{} {:02}.{:02}.",
            WEEKDAY_SHORT[d.weekday().num_days_from_monday() as usize],
            d.day(),
            d.month()
        ),
        Err(_) => dk.to_owned(),
    }
}

/// Splits a duration into bookable blocks of at most 24 hours: as many full
/// 24:00 blocks as fit, followed by the remaining time.
pub fn split_into_blocks(total_minutes: i32) -> Vec<i32> {
    let mut blocks = Vec::new();
    let mut remaining = total_minutes;
    while remaining > BLOCK_MINUTES {
        blocks.push(BLOCK_MINUTES);
        remaining -= BLOCK_MINUTES;
    }
    if remaining > 0 {
        blocks.push(remaining);
    }
    blocks
}

fn minutes(seconds: f64) -> i32 {
    js_round(seconds / 60.0) as i32
}

/// Aggregates worked time within `range` into the four report categories.
/// Concrete (non-Allgemeines) entries all count as "Implementierung";
/// Allgemeines entries use their stored category.
pub fn build_category_report<Tz: TimeZone>(
    entries: &[TimeEntry],
    s: &SettingsInput,
    range: &ResolvedRange,
    tz: &Tz,
) -> CategoryReport {
    let mut seconds_by_category: BTreeMap<AllgemeinesCategory, f64> = BTreeMap::new();
    // dayKey → (category → seconds), for the per-day verification overview.
    let mut seconds_by_day: BTreeMap<String, BTreeMap<AllgemeinesCategory, f64>> = BTreeMap::new();

    for entry in entries {
        if entry.ended_at.is_none() || !started_in(entry, range) {
            continue;
        }
        let seconds = finished_seconds(
            &entry.started_at,
            entry.ended_at.as_deref(),
            &s.breaks,
            s.auto_pause_enabled,
            tz,
        );
        let category = if entry.is_allgemeines {
            entry.category.unwrap_or(FALLBACK_CATEGORY)
        } else {
            AllgemeinesCategory::Implementierung
        };
        *seconds_by_category.entry(category).or_default() += seconds;
        *seconds_by_day
            .entry(day_key_of(&entry.started_at, tz))
            .or_default()
            .entry(category)
            .or_default() += seconds;
    }

    let mut categories = Vec::new();
    let mut total_minutes = 0;
    for name in CATEGORIES {
        let m = minutes(seconds_by_category.get(&name).copied().unwrap_or(0.0));
        if m <= 0 {
            continue;
        }
        categories.push(CategoryReportItem {
            name,
            total_minutes: m,
            blocks: split_into_blocks(m),
        });
        total_minutes += m;
    }

    let days = seconds_by_day
        .into_iter()
        .map(|(dk, day_cats)| {
            let mut day_seconds = 0.0;
            let minutes_by_category = CATEGORIES
                .into_iter()
                .map(|name| {
                    let sec = day_cats.get(&name).copied().unwrap_or(0.0);
                    day_seconds += sec;
                    (name, minutes(sec))
                })
                .collect();
            CategoryReportDay {
                label: format_day_short(&dk),
                day_key: dk,
                minutes_by_category,
                total_minutes: minutes(day_seconds),
            }
        })
        .collect();

    CategoryReport {
        display_name: display_name(s),
        range_label: range.label.clone(),
        categories,
        days,
        total_minutes,
    }
}

/// The report of the calendar month around `anchor` (default: this month),
/// plus the month (its `slug`, `YYYY-MM`, names the file).
pub fn load<Tz: TimeZone>(
    conn: &Connection,
    anchor: Option<&str>,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<(CategoryReport, ResolvedRange)> {
    let (s, range) = settings_and_range(conn, RangeKind::Month, anchor, now, tz)?;
    let entries = store::entries_between(conn, &range.from, &range.to)?;
    Ok((build_category_report(&entries, &s, &range, tz), range))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::days::parse_iso;
    use crate::db::open_in_memory;
    use crate::timer::{self, EntryInput};
    use chrono_tz::Europe::Berlin;

    #[test]
    fn blocks_are_at_most_a_day() {
        assert_eq!(split_into_blocks(0), Vec::<i32>::new());
        assert_eq!(split_into_blocks(90), [90]);
        assert_eq!(split_into_blocks(1440), [1440]);
        assert_eq!(split_into_blocks(1441), [1440, 1]);
        assert_eq!(split_into_blocks(3 * 1440 + 58), [1440, 1440, 1440, 58]);
    }

    #[test]
    fn day_labels_are_german() {
        assert_eq!(format_day_short("2026-06-01"), "Mo 01.06.");
        assert_eq!(format_day_short("2026-11-15"), "So 15.11.");
    }

    fn add(
        conn: &Connection,
        desc: &str,
        start: &str,
        end: &str,
        cat: Option<AllgemeinesCategory>,
    ) {
        timer::create_manual_entry(
            conn,
            &EntryInput {
                description: desc.into(),
                started_at: Some(start.into()),
                ended_at: Some(end.into()),
                is_allgemeines: Some(cat.is_some()),
                category: cat,
            },
        )
        .unwrap();
    }

    #[test]
    fn month_is_grouped_by_category_and_day() {
        let conn = open_in_memory().unwrap();
        // 1 Nov 2026 is a Sunday. 23:30 UTC on 31 Oct is already 1 Nov in Berlin.
        add(
            &conn,
            "TXR-1",
            "2026-10-31T23:30:00.000Z",
            "2026-11-01T00:30:00.000Z",
            None,
        );
        add(
            &conn,
            "Planung",
            "2026-11-02T07:00:00.000Z",
            "2026-11-02T08:00:00.000Z",
            Some(AllgemeinesCategory::Projektorganisation),
        );
        add(
            &conn,
            "Test",
            "2026-11-02T08:00:00.000Z",
            "2026-11-02T08:20:00.000Z",
            Some(AllgemeinesCategory::Qa),
        );
        // October: not in the report.
        add(
            &conn,
            "TXR-2",
            "2026-10-30T07:00:00.000Z",
            "2026-10-30T08:00:00.000Z",
            None,
        );
        let now = parse_iso("2026-11-11T10:00:00.000Z").unwrap();
        let (r, range) = load(&conn, Some("2026-11-20"), now, &Berlin).unwrap();

        assert_eq!(range.slug, "2026-11");
        assert_eq!(r.range_label, "November 2026");
        let names: Vec<_> = r.categories.iter().map(|c| c.name).collect();
        assert_eq!(
            names,
            [
                AllgemeinesCategory::Projektorganisation,
                AllgemeinesCategory::Implementierung,
                AllgemeinesCategory::Qa
            ]
        );
        assert_eq!(r.total_minutes, 60 + 60 + 20);
        assert_eq!(r.category_total(AllgemeinesCategory::Release), 0);
        assert_eq!(r.days.len(), 2);
        assert_eq!(r.days[0].label, "So 01.11.");
        assert_eq!(r.days[0].total_minutes, 60);
        assert_eq!(r.days[1].label, "Mo 02.11.");
        assert_eq!(r.days[1].minutes_by_category[&AllgemeinesCategory::Qa], 20);
        assert_eq!(r.days[1].minutes_by_category.len(), 4);
    }
}
