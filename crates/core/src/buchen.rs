//! The Buchen page's view model. Port of src/app/page.tsx.

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::Connection;
use serde::Serialize;
use specta::Type;

use crate::days::{day_key, day_key_of, days_ago_start_iso, is_weekend_key};
use crate::entries::{
    build_day_groups, build_recent_entries, overtime_balance_minutes, seconds_by_day,
    AllgemeinesCategory, AnalysisConfig, DayGroup, RecentEntry, RECENT_WINDOW_DAYS,
};
use crate::error::Result;
use crate::settings::{self, BookingMode, BreakWindow};
use crate::store::{self, GroupColorMap};

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RunningEntry {
    pub id: i32,
    pub description: String,
    pub started_at: String,
    pub is_allgemeines: bool,
    pub category: Option<AllgemeinesCategory>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HistoryWindow {
    /// Days of history `days` covers; `None` = everything.
    pub window_days: Option<u32>,
    /// Entries older than the window; 0 when everything is shown.
    pub hidden_older_count: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BuchenConfig {
    pub daily_target_minutes: i32,
    pub auto_pause_enabled: bool,
    pub breaks: Vec<BreakWindow>,
    pub booking_mode: BookingMode,
    pub jira_configured: bool,
    pub force_booking: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BuchenData {
    pub running: Option<RunningEntry>,
    #[specta(type = crate::JsNumber)]
    pub today_committed_seconds: f64,
    /// Overtime balance from finished entries only.
    pub overtime_balance_minutes: i32,
    /// Target the running entry's start day adds once the timer stops; 0 when
    /// that day already has finished time, is a weekend, or nothing runs.
    pub running_day_target_minutes: i32,
    pub days: Vec<DayGroup>,
    pub group_colors: GroupColorMap,
    pub recents: Vec<RecentEntry>,
    /// Bookable entries across the WHOLE history; the header button books all.
    pub open_bookable_count: i32,
    pub history: HistoryWindow,
    pub config: BuchenConfig,
}

/// Builds the page. `window_days = None` shows the whole history.
pub fn load<Tz: TimeZone>(
    conn: &Connection,
    window_days: Option<u32>,
    force_booking: bool,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<BuchenData> {
    let s = settings::get(conn)?.values;
    let cfg = AnalysisConfig {
        project_keys: s.jira_project_keys.clone(),
        breaks: s.breaks.clone(),
        auto_pause: s.auto_pause_enabled,
    };

    // The rendered list is windowed; everything below that must not be.
    let cutoff = window_days.map(|n| days_ago_start_iso(n.max(1) - 1, now, tz));
    let entries = match &cutoff {
        Some(c) => store::entries_from(conn, c)?,
        None => store::all_entries(conn)?,
    };
    let days = build_day_groups(&entries, &cfg, now, tz);
    let recents = build_recent_entries(
        &days,
        now,
        RECENT_WINDOW_DAYS,
        settings::recent_entries_limit(&s),
        tz,
    );

    // Read directly: a timer started months ago is outside the window but runs.
    let running = store::running_entry(conn)?;

    let today = day_key(now, tz);
    let today_committed_seconds = days
        .iter()
        .find(|d| d.day_key == today)
        .map_or(0.0, |d| d.total_seconds);

    // Cumulative over the whole history, but only three columns of it.
    let worked = seconds_by_day(
        &store::finished_durations(conn)?,
        &cfg.breaks,
        cfg.auto_pause,
        tz,
    )
    .worked;
    let overtime =
        overtime_balance_minutes(&worked, s.regular_work_minutes, s.overtime_baseline_minutes);

    // Once stopped, the running entry counts toward its start day. If that day
    // has no finished time yet, its target is not in `overtime`; the UI
    // subtracts it while the timer runs so the live saldo does not jump.
    let running_day_target_minutes = match &running {
        Some(r) => {
            let key = day_key_of(&r.started_at, tz);
            if worked.contains_key(&key) || is_weekend_key(&key) {
                0
            } else {
                s.regular_work_minutes
            }
        }
        None => 0,
    };

    Ok(BuchenData {
        running: running.map(|r| RunningEntry {
            id: r.id,
            description: r.description,
            started_at: r.started_at,
            is_allgemeines: r.is_allgemeines,
            category: r.category,
        }),
        today_committed_seconds,
        overtime_balance_minutes: overtime,
        running_day_target_minutes,
        group_colors: store::group_colors(conn)?,
        recents,
        days,
        open_bookable_count: store::count_bookable(conn, force_booking)?,
        history: HistoryWindow {
            window_days,
            hidden_older_count: match &cutoff {
                Some(c) => store::count_entries_before(conn, c)?,
                None => 0,
            },
        },
        config: BuchenConfig {
            daily_target_minutes: s.daily_target_minutes,
            auto_pause_enabled: s.auto_pause_enabled,
            jira_configured: settings::is_jira_configured(&s),
            breaks: s.breaks,
            booking_mode: s.booking_mode,
            force_booking,
        },
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
    fn window_hides_older_entries_but_not_from_the_balance() {
        let mut conn = open_in_memory().unwrap();
        let now = parse_iso("2026-11-10T15:00:00.000Z").unwrap(); // Tuesday
        manual(
            &conn,
            "today",
            "2026-11-10T07:00:00.000Z",
            "2026-11-10T15:00:00.000Z",
        ); // 8 h
        manual(
            &conn,
            "old",
            "2026-08-03T07:00:00.000Z",
            "2026-08-03T13:00:00.000Z",
        ); // Mon, 6 h

        let d = load(&conn, Some(30), false, now, &Berlin).unwrap();
        assert_eq!(d.days.len(), 1);
        assert_eq!(d.history.hidden_older_count, 1);
        assert_eq!(d.today_committed_seconds, 8.0 * 3600.0);
        assert_eq!(d.overtime_balance_minutes, 60 - 60); // +60 today, -60 in August
        assert_eq!(d.open_bookable_count, 2);
        assert_eq!(d.recents.len(), 1);

        let all = load(&conn, None, false, now, &Berlin).unwrap();
        assert_eq!(all.days.len(), 2);
        assert_eq!(all.history.hidden_older_count, 0);

        // A timer started on a weekday without finished time owes its target.
        timer::start(
            &mut conn,
            "run",
            false,
            None,
            parse_iso("2026-11-11T07:00:00.000Z").unwrap(),
            &Berlin,
        )
        .unwrap();
        let later = parse_iso("2026-11-11T08:00:00.000Z").unwrap();
        let d = load(&conn, Some(30), false, later, &Berlin).unwrap();
        assert_eq!(d.running.as_ref().unwrap().description, "run");
        assert_eq!(d.running_day_target_minutes, 420);
    }
}
