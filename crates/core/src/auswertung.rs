//! The Auswertung page's view model and the entries behind one "Zeit pro
//! Ticket" bar. Port of src/app/auswertung/page.tsx and `getGroupEntries` in
//! src/lib/actions.ts.

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::days::{day_key, parse_iso};
use crate::entries::{
    group_total_id, overtime_balance_minutes, overtime_balance_series, seconds_by_day,
    seconds_by_group, to_entry_view, AnalysisConfig, BalancePoint, GroupTotal,
};
use crate::error::{Error, Result};
use crate::report_range::{self, RangeKind, ResolvedRange, SprintConfig};
use crate::settings;
use crate::store::{self, GroupColorMap};
use crate::time::js_round;

/// How many of the last days of the period the bar charts show.
const CHART_DAYS: usize = 14;

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DailyBar {
    pub key: String,
    #[specta(type = crate::JsNumber)]
    pub seconds: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QuoteBar {
    pub key: String,
    pub percent: i32,
    pub has_data: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AuswertungData {
    pub range: ResolvedRange,
    pub regular_work_minutes: i32,
    #[specta(type = crate::JsNumber)]
    pub avg_per_week_minutes: f64,
    #[specta(type = crate::JsNumber)]
    pub avg_per_worked_day_minutes: f64,
    /// Over every tracked day, plus the baseline.
    pub total_overtime_minutes: i32,
    /// The current calendar week, whatever the selected period.
    #[specta(type = crate::JsNumber)]
    pub this_week_seconds: f64,
    #[specta(type = crate::JsNumber)]
    pub week_remaining_minutes: f64,
    pub concrete_quote_percent: i32,
    /// Worked seconds on the days with concrete work; 0 = no quote.
    #[specta(type = crate::JsNumber)]
    pub quote_seconds: f64,
    pub quote_met: bool,
    pub target_percent: i32,
    pub daily_bars: Vec<DailyBar>,
    pub quote_bars: Vec<QuoteBar>,
    pub balance: Vec<BalancePoint>,
    pub corridor_center_minutes: i32,
    pub corridor_range_minutes: i32,
    pub group_totals: Vec<GroupTotal>,
    pub group_colors: GroupColorMap,
}

fn analysis_config(s: &settings::SettingsInput) -> AnalysisConfig {
    AnalysisConfig {
        project_keys: s.jira_project_keys.clone(),
        breaks: s.breaks.clone(),
        auto_pause: s.auto_pause_enabled,
    }
}

/// The period of `kind` around `anchor` (default: today).
pub fn load<Tz: TimeZone>(
    conn: &Connection,
    kind: RangeKind,
    anchor: Option<&str>,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<AuswertungData> {
    let s = settings::get(conn)?.values;
    let cfg = analysis_config(&s);
    let sprint = SprintConfig {
        anchor_date: s.sprint_anchor_date.clone(),
        length_days: s.sprint_length_days,
    };
    let range = report_range::resolve(kind, anchor, now, &sprint, tz);

    // The balance is cumulative over every tracked day, so this aggregate reads
    // the whole history, but only three columns of it.
    let by_day = seconds_by_day(
        &store::finished_durations(conn)?,
        &cfg.breaks,
        cfg.auto_pause,
        tz,
    );
    let worked = &by_day.worked;
    let concrete = &by_day.concrete;
    let seconds_on = |k: &str| worked.get(k).copied().unwrap_or(0.0);
    let concrete_on = |k: &str| concrete.get(k).copied().unwrap_or(0.0);
    let total_overtime_minutes =
        overtime_balance_minutes(worked, s.regular_work_minutes, s.overtime_baseline_minutes);

    let day_keys = range.day_keys();
    let mut range_seconds = 0.0;
    let mut days_worked = 0u32;
    // The quote only looks at days with concrete work: days with nothing but
    // Allgemeines (sick leave, holidays) or nothing at all must not drag it down.
    let mut quote_seconds = 0.0;
    let mut quote_concrete = 0.0;
    for k in &day_keys {
        let seconds = seconds_on(k);
        if seconds > 0.0 {
            range_seconds += seconds;
            days_worked += 1;
        }
        let c = concrete_on(k);
        if c > 0.0 {
            quote_seconds += seconds;
            quote_concrete += c;
        }
    }
    let concrete_quote_percent = if quote_seconds > 0.0 {
        js_round(quote_concrete * 100.0 / quote_seconds) as i32
    } else {
        0
    };
    let target_percent = s.concrete_issue_target_percent;

    let this_week = report_range::resolve(RangeKind::Week, None, now, &sprint, tz);
    let this_week_seconds: f64 = this_week.day_keys().iter().map(|k| seconds_on(k)).sum();
    let week_target = f64::from(s.regular_work_minutes * 5);

    let weeks_in_range = (day_keys.len() as f64 / 7.0).max(1.0);
    let range_minutes = range_seconds / 60.0;

    let group_totals = seconds_by_group(
        &store::entries_between(conn, &range.from, &range.to)?
            .iter()
            .map(|e| to_entry_view(e, &cfg, tz))
            .collect::<Vec<_>>(),
    );

    let balance = overtime_balance_series(
        worked,
        s.regular_work_minutes,
        &day_keys,
        &day_key(now, tz),
        s.overtime_baseline_minutes,
    );

    let chart_days = &day_keys[day_keys.len().saturating_sub(CHART_DAYS)..];
    let daily_bars = chart_days
        .iter()
        .map(|k| DailyBar {
            key: k.clone(),
            seconds: seconds_on(k),
        })
        .collect();
    let quote_bars = chart_days
        .iter()
        .map(|k| {
            let c = concrete_on(k);
            QuoteBar {
                key: k.clone(),
                percent: if c > 0.0 {
                    js_round(c * 100.0 / seconds_on(k)) as i32
                } else {
                    0
                },
                has_data: c > 0.0,
            }
        })
        .collect();

    Ok(AuswertungData {
        regular_work_minutes: s.regular_work_minutes,
        avg_per_week_minutes: range_minutes / weeks_in_range,
        avg_per_worked_day_minutes: if days_worked > 0 {
            range_minutes / f64::from(days_worked)
        } else {
            0.0
        },
        total_overtime_minutes,
        this_week_seconds,
        week_remaining_minutes: (week_target - this_week_seconds / 60.0).max(0.0),
        concrete_quote_percent,
        quote_met: quote_seconds > 0.0 && concrete_quote_percent >= target_percent,
        quote_seconds,
        target_percent,
        daily_bars,
        quote_bars,
        balance,
        corridor_center_minutes: s.overtime_corridor_center_hours * 60,
        corridor_range_minutes: s.overtime_corridor_range_hours * 60,
        group_totals,
        group_colors: store::group_colors(conn)?,
        range,
    })
}

/// Entries per page of an opened bar.
pub const GROUP_ENTRIES_PAGE: usize = 20;

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupEntriesInput {
    pub from_iso: String,
    pub to_iso: String,
    pub group_id: String,
    pub offset: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupEntry {
    pub id: i32,
    pub started_at: String,
    pub ended_at: String,
    #[specta(type = crate::JsNumber)]
    pub seconds: f64,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct GroupEntriesPage {
    pub entries: Vec<GroupEntry>,
    /// All entries of the bar, not only this page.
    pub total: i32,
}

/// One page of the finished entries of a bar, newest first. Paged, because a
/// bar over "Alle" can hold thousands of entries.
pub fn group_entries<Tz: TimeZone>(
    conn: &Connection,
    input: &GroupEntriesInput,
    tz: &Tz,
) -> Result<GroupEntriesPage> {
    if parse_iso(&input.from_iso).is_none()
        || parse_iso(&input.to_iso).is_none()
        || input.group_id.chars().count() > 100
    {
        return Err(Error::Validation("Ungültige Anfrage.".into()));
    }
    let cfg = analysis_config(&settings::get(conn)?.values);
    let offset = input.offset as usize;

    // The group comes from the parsed description, so SQL cannot filter by
    // it: count every match, keep only the requested page.
    let mut entries = Vec::new();
    let mut total = 0usize;
    for row in store::entries_between(conn, &input.from_iso, &input.to_iso)? {
        let view = to_entry_view(&row, &cfg, tz);
        // Same filter as `seconds_by_group`, so the list adds up to the bar.
        let Some(ended_at) = view.ended_at.clone() else {
            continue;
        };
        if view.effective_seconds <= 0.0 || group_total_id(&view) != input.group_id {
            continue;
        }
        if total >= offset && entries.len() < GROUP_ENTRIES_PAGE {
            entries.push(GroupEntry {
                id: view.id,
                started_at: view.started_at,
                ended_at,
                seconds: view.effective_seconds,
                description: view.description,
            });
        }
        total += 1;
    }
    Ok(GroupEntriesPage {
        entries,
        total: total as i32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::entries::AllgemeinesCategory;
    use crate::timer::{self, EntryInput};
    use chrono_tz::Europe::Berlin;

    fn manual(conn: &Connection, desc: &str, start: &str, end: &str, allgemein: bool) {
        timer::create_manual_entry(
            conn,
            &EntryInput {
                description: desc.into(),
                started_at: Some(start.into()),
                ended_at: Some(end.into()),
                is_allgemeines: Some(allgemein),
                category: allgemein.then_some(AllgemeinesCategory::Qa),
            },
        )
        .unwrap();
    }

    fn seed(conn: &Connection) {
        // Monday 9 Nov: 6 h TXR-1 + 2 h Allgemeines.
        manual(
            conn,
            "TXR-1 a",
            "2026-11-09T07:00:00.000Z",
            "2026-11-09T13:00:00.000Z",
            false,
        );
        manual(
            conn,
            "Meeting",
            "2026-11-09T13:00:00.000Z",
            "2026-11-09T15:00:00.000Z",
            true,
        );
        // Tuesday 10 Nov: only Allgemeines (does not count for the quote).
        manual(
            conn,
            "Krank",
            "2026-11-10T07:00:00.000Z",
            "2026-11-10T14:00:00.000Z",
            true,
        );
        // October: 1 h on another ticket, outside the week.
        manual(
            conn,
            "TXR-2",
            "2026-10-05T07:00:00.000Z",
            "2026-10-05T08:00:00.000Z",
            false,
        );
    }

    #[test]
    fn week_kpis_and_charts() {
        let conn = open_in_memory().unwrap();
        seed(&conn);
        let now = parse_iso("2026-11-11T10:00:00.000Z").unwrap();
        let d = load(&conn, RangeKind::Week, None, now, &Berlin).unwrap();

        assert_eq!(d.range.label, "KW 46 · 09.11.–15.11.2026");
        // Mon +60, Tue 0, Oct 5: 1 h - 7 h = -360.
        assert_eq!(d.total_overtime_minutes, 60 - 360);
        assert_eq!(d.this_week_seconds, 15.0 * 3600.0);
        assert_eq!(d.week_remaining_minutes, 35.0 * 60.0 - 15.0 * 60.0);
        assert_eq!(d.avg_per_week_minutes, 15.0 * 60.0);
        assert_eq!(d.avg_per_worked_day_minutes, 7.5 * 60.0);
        // Only Monday has concrete work: 6 of 8 hours.
        assert_eq!(d.quote_seconds, 8.0 * 3600.0);
        assert_eq!(d.concrete_quote_percent, 75);
        assert!(d.quote_met == (75 >= d.target_percent));
        assert_eq!(d.daily_bars.len(), 7);
        assert_eq!(d.quote_bars[0].percent, 75);
        assert!(!d.quote_bars[1].has_data);
        // Balance: Oct 5 (-360) counts before the week; Mon +60, Tue 0, then today.
        let balance: Vec<i32> = d.balance.iter().map(|p| p.minutes).collect();
        assert_eq!(balance, [-300, -300, -300]);
        assert_eq!(
            d.group_totals
                .iter()
                .map(|g| g.id.as_str())
                .collect::<Vec<_>>(),
            ["cat:QA", "issue:TXR-1"]
        );
    }

    #[test]
    fn group_entries_are_paged() {
        let conn = open_in_memory().unwrap();
        seed(&conn);
        for i in 0..25 {
            let start = format!("2026-11-02T{:02}:00:00.000Z", i % 20);
            let end = format!("2026-11-02T{:02}:30:00.000Z", i % 20);
            manual(&conn, "TXR-1 more", &start, &end, false);
        }
        let input = |offset| GroupEntriesInput {
            from_iso: "2026-11-01T00:00:00.000Z".into(),
            to_iso: "2026-11-30T00:00:00.000Z".into(),
            group_id: "issue:TXR-1".into(),
            offset,
        };
        let first = group_entries(&conn, &input(0), &Berlin).unwrap();
        assert_eq!(first.total, 26);
        assert_eq!(first.entries.len(), 20);
        assert_eq!(first.entries[0].description, "TXR-1 a");
        let rest = group_entries(&conn, &input(20), &Berlin).unwrap();
        assert_eq!(rest.entries.len(), 6);

        let mut bad = input(0);
        bad.from_iso = "yesterday".into();
        assert!(group_entries(&conn, &bad, &Berlin).is_err());
    }
}
