//! "Alte Einträge löschen" in the settings. Port of `cleanupOldEntries` in
//! src/lib/actions.ts.

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use specta::Type;

use crate::days::days_ago_start_iso;
use crate::entries::{overtime_balance_minutes, seconds_by_day};
use crate::error::Result;
use crate::settings;
use crate::store;
use crate::time::now_iso;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub ok: bool,
    pub deleted: i32,
    pub overtime_rolled_minutes: i32,
    pub message: Option<String>,
}

/// Deletes finished entries that started before local midnight `days` days
/// ago, and first rolls the overtime they contributed into
/// `overtime_baseline_minutes`, so the balance does not change.
pub fn cleanup_old_entries<Tz: TimeZone>(
    conn: &mut Connection,
    days: i64,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<CleanupResult> {
    let Ok(days_back) = u32::try_from(days) else {
        return Ok(invalid());
    };
    if days_back < 1 {
        return Ok(invalid());
    }
    let s = settings::get(conn)?.values;
    // Midnight, not a rolling instant: a day must go as a whole.
    let cutoff = days_ago_start_iso(days_back, now, tz);
    let doomed = store::finished_durations_before(conn, &cutoff)?;
    // Baseline 0: exactly the contribution about to vanish, with the same
    // weekend rule as the live balance.
    let worked = seconds_by_day(&doomed, &s.breaks, s.auto_pause_enabled, tz).worked;
    let rolled = overtime_balance_minutes(&worked, s.regular_work_minutes, 0);

    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE settings SET overtime_baseline_minutes = ?1, updated_at = ?2 WHERE id = 1",
        params![s.overtime_baseline_minutes + rolled, now_iso()],
    )?;
    let deleted = tx.execute(
        "DELETE FROM time_entries WHERE started_at < ?1 AND ended_at IS NOT NULL",
        [&cutoff],
    )?;
    tx.commit()?;
    Ok(CleanupResult {
        ok: true,
        deleted: deleted as i32,
        overtime_rolled_minutes: rolled,
        message: None,
    })
}

fn invalid() -> CleanupResult {
    CleanupResult {
        ok: false,
        deleted: 0,
        overtime_rolled_minutes: 0,
        message: Some("Ungültige Tagesangabe.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::days::parse_iso;
    use crate::db::open_in_memory;
    use crate::timer::{self, EntryInput};
    use chrono_tz::Europe::Berlin;

    fn manual(conn: &Connection, start: &str, end: &str) {
        timer::create_manual_entry(
            conn,
            &EntryInput {
                description: "x".into(),
                started_at: Some(start.into()),
                ended_at: Some(end.into()),
                is_allgemeines: None,
                category: None,
            },
        )
        .unwrap();
    }

    #[test]
    fn deletes_old_entries_and_keeps_the_balance() {
        let mut conn = open_in_memory().unwrap();
        let mut s = settings::get(&conn).unwrap().values;
        s.breaks = vec![];
        s.regular_work_minutes = 480;
        s.overtime_baseline_minutes = 10;
        settings::update(&conn, &s).unwrap();
        // Mon 2026-11-02: 9 h → +60. Today Wed 2026-11-11, cutoff = local
        // midnight of 2026-11-04 (7 days).
        manual(
            &conn,
            "2026-11-02T07:00:00.000Z",
            "2026-11-02T16:00:00.000Z",
        );
        manual(
            &conn,
            "2026-11-10T07:00:00.000Z",
            "2026-11-10T15:00:00.000Z",
        );
        timer::start(
            &mut conn,
            "läuft",
            false,
            None,
            parse_iso("2026-10-01T07:00:00.000Z").unwrap(),
            &Berlin,
        )
        .unwrap();
        let now = parse_iso("2026-11-11T12:00:00.000Z").unwrap();

        let r = cleanup_old_entries(&mut conn, 7, now, &Berlin).unwrap();
        assert_eq!((r.ok, r.deleted, r.overtime_rolled_minutes), (true, 1, 60));
        assert_eq!(
            settings::get(&conn)
                .unwrap()
                .values
                .overtime_baseline_minutes,
            70
        );
        // The running timer survives even though it started before the cutoff.
        assert_eq!(store::all_entries(&conn).unwrap().len(), 2);

        let bad = cleanup_old_entries(&mut conn, 0, now, &Berlin).unwrap();
        assert_eq!(bad.message.as_deref(), Some("Ungültige Tagesangabe."));
    }
}
