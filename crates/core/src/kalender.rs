//! The Kalender page's view model. Port of src/app/kalender/page.tsx.
//!
//! The timeline geometry (lanes, gaps, overlaps) stays in the UI
//! (ui/src/lib/timeline.ts): it follows the running timer every second.

use std::collections::BTreeMap;

use chrono::{DateTime, Days, TimeZone, Utc};
use rusqlite::Connection;
use serde::Serialize;
use specta::Type;

use crate::days::{day_key, day_key_of, days_ago_start_iso, is_weekend_key, local_midnight};
use crate::entries::{
    build_day_groups, build_recent_entries, overtime_balance_minutes, seconds_by_day,
    to_entry_view, AnalysisConfig, DurationRow, EntryView, RecentEntry, RECENT_WINDOW_DAYS,
};
use crate::error::Result;
use crate::report_range::{self, RangeKind, SprintConfig};
use crate::settings::{self, BreakWindow};
use crate::store::{self, GroupColorMap};
use crate::time::to_iso;

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KalenderData {
    pub week_label: String,
    pub day_keys: Vec<String>,
    pub prev_anchor: String,
    pub next_anchor: String,
    pub is_current_week: bool,
    pub has_running: bool,
    pub entries: Vec<EntryView>,
    pub group_colors: GroupColorMap,
    /// Suggestions for the description field of the entry dialog.
    pub recents: Vec<RecentEntry>,
    pub breaks: Vec<BreakWindow>,
    pub auto_pause_enabled: bool,
    /// Overtime of this week's days, from finished entries only.
    pub week_overtime_minutes: i32,
    /// Worked minutes per day key, from finished entries only.
    #[specta(type = BTreeMap<String, crate::JsNumber>)]
    pub worked_minutes_by_day: BTreeMap<String, f64>,
    /// Weekday target, for the tooltip of the day's worked time.
    pub regular_work_minutes: i32,
    /// Whether the running timer started on a day of this week.
    pub running_in_week: bool,
    /// Target of the running entry's day if it is not yet in the overtime.
    pub running_day_target_minutes: i32,
}

/// The week containing `anchor` (default: this week).
pub fn load<Tz: TimeZone>(
    conn: &Connection,
    anchor: Option<&str>,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<KalenderData> {
    let s = settings::get(conn)?.values;
    let cfg = AnalysisConfig {
        project_keys: s.jira_project_keys.clone(),
        breaks: s.breaks.clone(),
        auto_pause: s.auto_pause_enabled,
    };
    let sprint = SprintConfig::default();
    let week = report_range::resolve(RangeKind::Week, anchor, now, &sprint, tz);

    // Start one day early: an entry that began on Sunday night and ran past
    // midnight still has a piece on this Monday.
    let query_from = to_iso(local_midnight(week.first_day - Days::new(1), tz));
    let mut rows = store::entries_between(conn, &query_from, &week.to)?;

    // A timer started before this window may still be running into it.
    let running = store::running_entry(conn)?;
    if let Some(r) = &running {
        if !rows.iter().any(|row| row.id == r.id) {
            rows.push(r.clone());
        }
    }

    let entries = rows.iter().map(|r| to_entry_view(r, &cfg, tz)).collect();

    // Same suggestions as the Buchen timer field, independent of the week.
    let recent_rows =
        store::entries_from(conn, &days_ago_start_iso(RECENT_WINDOW_DAYS - 1, now, tz))?;
    let recents = build_recent_entries(
        &build_day_groups(&recent_rows, &cfg, now, tz),
        now,
        RECENT_WINDOW_DAYS,
        settings::recent_entries_limit(&s),
        tz,
    );

    // Same rule as the overall saldo, limited to the days of this week.
    let day_keys = week.day_keys();
    let durations: Vec<DurationRow> = rows
        .iter()
        .map(|r| DurationRow {
            started_at: r.started_at.clone(),
            ended_at: r.ended_at.clone(),
            is_allgemeines: r.is_allgemeines,
        })
        .collect();
    let mut worked = seconds_by_day(&durations, &cfg.breaks, cfg.auto_pause, tz).worked;
    worked.retain(|k, _| day_keys.contains(k));
    let week_overtime_minutes = overtime_balance_minutes(&worked, s.regular_work_minutes, 0);

    // A running timer counts toward its start day once stopped. If that day
    // has no finished time yet, its target is not in the value above; the UI
    // subtracts it while the timer runs, as on the Buchen page.
    let running_day = running.as_ref().map(|r| day_key_of(&r.started_at, tz));
    let running_in_week = running_day.as_ref().is_some_and(|k| day_keys.contains(k));
    let running_day_target_minutes = match &running_day {
        Some(k) if running_in_week && !worked.contains_key(k) && !is_weekend_key(k) => {
            s.regular_work_minutes
        }
        _ => 0,
    };

    let this_week =
        report_range::resolve(RangeKind::Week, Some(&day_key(now, tz)), now, &sprint, tz);

    Ok(KalenderData {
        week_label: week.label.clone(),
        prev_anchor: week
            .prev_anchor
            .clone()
            .unwrap_or_else(|| week.anchor.clone()),
        next_anchor: week
            .next_anchor
            .clone()
            .unwrap_or_else(|| week.anchor.clone()),
        is_current_week: week.anchor == this_week.anchor,
        has_running: running.is_some(),
        entries,
        group_colors: store::group_colors(conn)?,
        recents,
        breaks: cfg.breaks,
        auto_pause_enabled: cfg.auto_pause,
        week_overtime_minutes,
        worked_minutes_by_day: worked.into_iter().map(|(k, s)| (k, s / 60.0)).collect(),
        regular_work_minutes: s.regular_work_minutes,
        running_in_week,
        running_day_target_minutes,
        day_keys,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::days::parse_iso;
    use crate::db::open_in_memory;
    use crate::timer::{self, EntryInput};
    use chrono_tz::Europe::Berlin;

    fn manual(conn: &Connection, desc: &str, start: &str, end: &str) {
        timer::create_manual_entry(
            conn,
            &EntryInput {
                description: desc.into(),
                started_at: Some(start.into()),
                ended_at: Some(end.into()),
                is_allgemeines: None,
                category: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn week_view_model() {
        let mut conn = open_in_memory().unwrap();
        // Sunday night into Monday: belongs to Sunday, but has a piece on Monday.
        manual(
            &conn,
            "late",
            "2026-11-08T22:00:00.000Z",
            "2026-11-08T23:30:00.000Z",
        );
        manual(
            &conn,
            "mon",
            "2026-11-09T07:00:00.000Z",
            "2026-11-09T15:00:00.000Z",
        ); // 8 h: +60
        manual(
            &conn,
            "last week",
            "2026-11-03T07:00:00.000Z",
            "2026-11-03T08:00:00.000Z",
        );
        // Started on Wednesday of this week, still running.
        timer::start(
            &mut conn,
            "run",
            false,
            None,
            parse_iso("2026-11-11T07:00:00.000Z").unwrap(),
            &Berlin,
        )
        .unwrap();

        let now = parse_iso("2026-11-11T10:00:00.000Z").unwrap();
        let d = load(&conn, None, now, &Berlin).unwrap();
        assert_eq!(d.week_label, "KW 46 · 09.11.–15.11.2026");
        assert_eq!(d.day_keys.first().unwrap(), "2026-11-09");
        assert!(d.is_current_week);
        assert!(d.has_running);
        assert!(d.running_in_week);
        assert_eq!(d.running_day_target_minutes, 420);
        assert_eq!(
            d.entries
                .iter()
                .map(|e| e.description.as_str())
                .collect::<Vec<_>>(),
            ["run", "mon", "late"]
        );
        // Sunday's entry is outside the week's days and its saldo.
        assert_eq!(d.week_overtime_minutes, 60);
        assert_eq!(d.worked_minutes_by_day.len(), 1);
        assert_eq!(d.worked_minutes_by_day["2026-11-09"], 480.0);
        assert_eq!(d.prev_anchor, "2026-11-02");
        assert_eq!(d.recents.len(), 3);

        let prev = load(&conn, Some(&d.prev_anchor), now, &Berlin).unwrap();
        assert!(!prev.is_current_week);
        assert!(!prev.running_in_week);
        assert_eq!(prev.running_day_target_minutes, 0);
        // The running timer is always sent along; the timeline cuts it to the days.
        assert_eq!(
            prev.entries
                .iter()
                .map(|e| e.description.as_str())
                .collect::<Vec<_>>(),
            ["late", "last week", "run"]
        );
    }
}
