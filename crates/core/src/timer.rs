//! Timer and entry actions. Port of the "Timer" and "Entries" sections of
//! src/lib/actions.ts.

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{params, params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::days::parse_iso;
use crate::entries::AllgemeinesCategory;
use crate::error::{Error, Result};
use crate::settings;
use crate::store;
use crate::time::to_iso;
use crate::work_time::effective_duration_seconds;

/// Entries shorter than this are discarded on stop (Jira takes no worklog
/// under a minute).
pub const MIN_TRACKED_SECONDS: f64 = 60.0;

fn invalid(msg: &str) -> Error {
    Error::Validation(msg.into())
}

fn category_text(c: Option<AllgemeinesCategory>) -> Option<&'static str> {
    c.map(AllgemeinesCategory::as_str)
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CloseResult {
    pub had_running: bool,
    pub discarded: bool,
    pub seconds_tracked: f64,
}

/// Ends the running timer at `ended`. Below [`MIN_TRACKED_SECONDS`] of
/// effective time the row is deleted instead.
pub fn close_running<Tz: TimeZone>(
    conn: &Connection,
    ended: DateTime<Utc>,
    tz: &Tz,
) -> Result<CloseResult> {
    let Some(running) = store::running_entry(conn)? else {
        return Ok(CloseResult {
            had_running: false,
            discarded: false,
            seconds_tracked: 0.0,
        });
    };
    let s = settings::get(conn)?.values;
    let start = parse_iso(&running.started_at).unwrap_or(ended);
    let seconds = effective_duration_seconds(
        start,
        Some(ended),
        &s.breaks,
        s.auto_pause_enabled,
        ended,
        tz,
    );

    if seconds < MIN_TRACKED_SECONDS {
        conn.execute("DELETE FROM time_entries WHERE id = ?1", [running.id])?;
        return Ok(CloseResult {
            had_running: true,
            discarded: true,
            seconds_tracked: seconds,
        });
    }
    conn.execute(
        "UPDATE time_entries SET ended_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![to_iso(ended), to_iso(Utc::now()), running.id],
    )?;
    Ok(CloseResult {
        had_running: true,
        discarded: false,
        seconds_tracked: seconds,
    })
}

/// What the tray shows about the running timer.
#[derive(Debug, Clone, PartialEq)]
pub struct RunningStatus {
    pub description: String,
    pub effective_seconds: f64,
}

/// The running timer with its effective time so far (breaks deducted), like
/// the old `/api/timer/status` route.
pub fn running_status<Tz: TimeZone>(
    conn: &Connection,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<Option<RunningStatus>> {
    let Some(running) = store::running_entry(conn)? else {
        return Ok(None);
    };
    let s = settings::get(conn)?.values;
    let seconds = parse_iso(&running.started_at).map_or(0.0, |start| {
        effective_duration_seconds(start, None, &s.breaks, s.auto_pause_enabled, now, tz)
    });
    Ok(Some(RunningStatus {
        description: running.description,
        effective_seconds: seconds,
    }))
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StartTimerResult {
    pub previous_discarded: bool,
    #[specta(type = crate::JsNumber)]
    pub previous_seconds_tracked: f64,
}

/// Stops any running timer, then starts a new one with the given text.
pub fn start<Tz: TimeZone>(
    conn: &mut Connection,
    description: &str,
    is_allgemeines: bool,
    category: Option<AllgemeinesCategory>,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<StartTimerResult> {
    let tx = conn.transaction()?;
    let previous = close_running(&tx, now, tz)?;
    tx.execute(
        "INSERT INTO time_entries (description, started_at, is_allgemeines, category) VALUES (?1, ?2, ?3, ?4)",
        params![
            description,
            to_iso(now),
            is_allgemeines,
            category_text(AllgemeinesCategory::resolve(is_allgemeines, category))
        ],
    )?;
    tx.commit()?;
    Ok(StartTimerResult {
        previous_discarded: previous.discarded,
        previous_seconds_tracked: previous.seconds_tracked,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StopTimerResult {
    pub stopped: bool,
    pub discarded: bool,
    #[specta(type = crate::JsNumber)]
    pub seconds_tracked: f64,
}

pub fn stop<Tz: TimeZone>(
    conn: &Connection,
    now: DateTime<Utc>,
    tz: &Tz,
) -> Result<StopTimerResult> {
    let r = close_running(conn, now, tz)?;
    Ok(StopTimerResult {
        stopped: r.had_running,
        discarded: r.discarded,
        seconds_tracked: r.seconds_tracked,
    })
}

pub fn update_running_description(conn: &Connection, description: &str) -> Result<()> {
    conn.execute(
        "UPDATE time_entries SET description = ?1, updated_at = ?2 WHERE ended_at IS NULL",
        params![description, to_iso(Utc::now())],
    )?;
    Ok(())
}

/// Toggles Allgemeines on the running timer; on assigns the (default) category,
/// off clears it.
pub fn update_running_allgemeines(
    conn: &Connection,
    is_allgemeines: bool,
    category: Option<AllgemeinesCategory>,
) -> Result<()> {
    conn.execute(
        "UPDATE time_entries SET is_allgemeines = ?1, category = ?2, updated_at = ?3 WHERE ended_at IS NULL",
        params![
            is_allgemeines,
            category_text(AllgemeinesCategory::resolve(is_allgemeines, category)),
            to_iso(Utc::now())
        ],
    )?;
    Ok(())
}

pub fn update_running_category(conn: &Connection, category: AllgemeinesCategory) -> Result<()> {
    conn.execute(
        "UPDATE time_entries SET category = ?1, updated_at = ?2 WHERE ended_at IS NULL",
        params![category.as_str(), to_iso(Utc::now())],
    )?;
    Ok(())
}

/// Back-dates the running timer.
pub fn update_running_started_at(
    conn: &Connection,
    started_at: &str,
    now: DateTime<Utc>,
) -> Result<()> {
    let running = store::running_entry(conn)?.ok_or_else(|| invalid("Kein laufender Timer."))?;
    let start = parse_iso(started_at).ok_or_else(|| invalid("Ungültiges Datum."))?;
    if start >= now {
        return Err(invalid("Start muss in der Vergangenheit liegen."));
    }
    conn.execute(
        "UPDATE time_entries SET started_at = ?1, updated_at = ?2 WHERE id = ?3",
        params![to_iso(start), to_iso(now), running.id],
    )?;
    Ok(())
}

/// The form of the "Eintrag hinzufügen" and "Eintrag bearbeiten" dialogs.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EntryInput {
    pub description: String,
    /// Both times or neither (a description-only edit).
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub is_allgemeines: Option<bool>,
    pub category: Option<AllgemeinesCategory>,
}

/// Checks a start/end pair and normalises both to the stored format.
fn checked_span(started_at: &str, ended_at: &str) -> Result<(String, String)> {
    let (Some(start), Some(end)) = (parse_iso(started_at), parse_iso(ended_at)) else {
        return Err(invalid("Ungültiges Datum."));
    };
    if end <= start {
        return Err(invalid("Ende muss nach dem Beginn liegen."));
    }
    Ok((to_iso(start), to_iso(end)))
}

/// Creates a finished entry without the timer.
pub fn create_manual_entry(conn: &Connection, input: &EntryInput) -> Result<()> {
    let (Some(s), Some(e)) = (input.started_at.as_deref(), input.ended_at.as_deref()) else {
        return Err(invalid("Ungültige Eingabe."));
    };
    if s.is_empty() || e.is_empty() {
        return Err(invalid("Ungültige Eingabe."));
    }
    let (start, end) = checked_span(s, e)?;
    let is_allgemeines = input.is_allgemeines.unwrap_or(false);
    conn.execute(
        "INSERT INTO time_entries (description, started_at, ended_at, is_allgemeines, category)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            input.description,
            start,
            end,
            is_allgemeines,
            category_text(AllgemeinesCategory::resolve(is_allgemeines, input.category))
        ],
    )?;
    Ok(())
}

/// Edits an entry. Times are only changed when both are given.
pub fn update_entry(conn: &Connection, id: i32, input: &EntryInput) -> Result<()> {
    let mut sets: Vec<&str> = vec!["description = ?", "updated_at = ?"];
    let mut values: Vec<rusqlite::types::Value> =
        vec![input.description.clone().into(), to_iso(Utc::now()).into()];

    if let (Some(s), Some(e)) = (input.started_at.as_deref(), input.ended_at.as_deref()) {
        if !s.is_empty() && !e.is_empty() {
            let (start, end) = checked_span(s, e)?;
            sets.extend(["started_at = ?", "ended_at = ?"]);
            values.extend([start.into(), end.into()]);
        }
    }
    let category = match input.is_allgemeines {
        Some(flag) => {
            sets.push("is_allgemeines = ?");
            values.push(i64::from(flag).into());
            Some(AllgemeinesCategory::resolve(flag, input.category))
        }
        None => input.category.map(Some),
    };
    if let Some(c) = category {
        sets.push("category = ?");
        values.push(category_text(c).map(str::to_owned).into());
    }

    values.push(i64::from(id).into());
    let sql = format!("UPDATE time_entries SET {} WHERE id = ?", sets.join(", "));
    conn.execute(&sql, params_from_iter(values))?;
    Ok(())
}

/// The "Gruppe bearbeiten" dialog: same text, flag and category for many entries.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EntriesTextInput {
    pub description: String,
    pub is_allgemeines: bool,
    pub category: Option<AllgemeinesCategory>,
}

pub fn update_entries(conn: &mut Connection, ids: &[i32], input: &EntriesTextInput) -> Result<()> {
    if ids.is_empty() || ids.iter().any(|&id| id <= 0) {
        return Err(invalid("Ungültige Eingabe."));
    }
    let category = category_text(AllgemeinesCategory::resolve(
        input.is_allgemeines,
        input.category,
    ));
    let now = to_iso(Utc::now());
    let tx = conn.transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE time_entries SET description = ?1, is_allgemeines = ?2, category = ?3, updated_at = ?4
             WHERE id = ?5",
            params![input.description, input.is_allgemeines, category, now, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn delete_entry(conn: &Connection, id: i32) -> Result<()> {
    conn.execute("DELETE FROM time_entries WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use chrono_tz::Europe::Berlin;

    fn at(iso: &str) -> DateTime<Utc> {
        parse_iso(iso).unwrap()
    }

    #[test]
    fn start_closes_the_previous_timer_and_discards_short_ones() {
        let mut conn = open_in_memory().unwrap();
        let r = start(
            &mut conn,
            "first",
            false,
            None,
            at("2026-11-10T08:00:00.000Z"),
            &Berlin,
        )
        .unwrap();
        assert!(!r.previous_discarded);

        // 30 s later: the first entry is too short and disappears.
        let r = start(
            &mut conn,
            "second",
            true,
            None,
            at("2026-11-10T08:00:30.000Z"),
            &Berlin,
        )
        .unwrap();
        assert!(r.previous_discarded);
        assert_eq!(r.previous_seconds_tracked, 30.0);
        assert_eq!(store::all_entries(&conn).unwrap().len(), 1);

        let running = store::running_entry(&conn).unwrap().unwrap();
        assert_eq!(running.description, "second");
        assert_eq!(
            running.category,
            Some(AllgemeinesCategory::Projektorganisation)
        );

        let stopped = stop(&conn, at("2026-11-10T09:00:30.000Z"), &Berlin).unwrap();
        assert!(stopped.stopped && !stopped.discarded);
        assert_eq!(stopped.seconds_tracked, 3600.0);
        assert!(store::running_entry(&conn).unwrap().is_none());
        assert_eq!(
            store::all_entries(&conn).unwrap()[0].ended_at.as_deref(),
            Some("2026-11-10T09:00:30.000Z")
        );

        let nothing = stop(&conn, at("2026-11-10T10:00:00.000Z"), &Berlin).unwrap();
        assert!(!nothing.stopped);
    }

    #[test]
    fn stop_subtracts_breaks_before_the_minimum_check() {
        let mut conn = open_in_memory().unwrap();
        conn.execute(
            r#"INSERT INTO settings (id, breaks) VALUES (1, '[{"start":"12:00","end":"12:30"}]')"#,
            [],
        )
        .unwrap();
        // 11:59:30–12:30:30 local (CET): 31 min raw, 1 min effective → kept.
        start(
            &mut conn,
            "x",
            false,
            None,
            at("2026-11-10T10:59:30.000Z"),
            &Berlin,
        )
        .unwrap();
        let r = stop(&conn, at("2026-11-10T11:30:30.000Z"), &Berlin).unwrap();
        assert_eq!(r.seconds_tracked, 60.0);
        assert!(!r.discarded);
    }

    #[test]
    fn running_updates() {
        let mut conn = open_in_memory().unwrap();
        let now = at("2026-11-10T08:00:00.000Z");
        start(&mut conn, "x", false, None, now, &Berlin).unwrap();
        update_running_description(&conn, "TXR-1 y").unwrap();
        update_running_allgemeines(&conn, true, Some(AllgemeinesCategory::Release)).unwrap();
        let r = store::running_entry(&conn).unwrap().unwrap();
        assert_eq!(
            (r.description.as_str(), r.is_allgemeines, r.category),
            ("TXR-1 y", true, Some(AllgemeinesCategory::Release))
        );

        update_running_category(&conn, AllgemeinesCategory::Qa).unwrap();
        update_running_allgemeines(&conn, false, None).unwrap();
        let r = store::running_entry(&conn).unwrap().unwrap();
        assert_eq!(r.category, None);

        let err = update_running_started_at(&conn, "2026-11-10T09:00:00.000Z", now).unwrap_err();
        assert_eq!(err.to_string(), "Start muss in der Vergangenheit liegen.");
        assert_eq!(
            update_running_started_at(&conn, "nope", now)
                .unwrap_err()
                .to_string(),
            "Ungültiges Datum."
        );
        update_running_started_at(&conn, "2026-11-10T07:30:00+00:00", now).unwrap();
        assert_eq!(
            store::running_entry(&conn).unwrap().unwrap().started_at,
            "2026-11-10T07:30:00.000Z"
        );
    }

    #[test]
    fn manual_entries_and_edits() {
        let mut conn = open_in_memory().unwrap();
        let mut input = EntryInput {
            description: "manual".into(),
            started_at: Some("2026-11-10T08:00:00.000Z".into()),
            ended_at: Some("2026-11-10T08:00:00.000Z".into()),
            is_allgemeines: Some(true),
            category: None,
        };
        assert_eq!(
            create_manual_entry(&conn, &input).unwrap_err().to_string(),
            "Ende muss nach dem Beginn liegen."
        );
        input.ended_at = Some("2026-11-10T09:00:00.000Z".into());
        create_manual_entry(&conn, &input).unwrap();
        let e = store::all_entries(&conn).unwrap().remove(0);
        assert_eq!(e.category, Some(AllgemeinesCategory::Projektorganisation));

        let edit = EntryInput {
            description: "edited".into(),
            started_at: None,
            ended_at: None,
            is_allgemeines: Some(false),
            category: Some(AllgemeinesCategory::Qa),
        };
        update_entry(&conn, e.id, &edit).unwrap();
        let e2 = store::entry_by_id(&conn, e.id).unwrap().unwrap();
        assert_eq!(
            (e2.description.as_str(), e2.is_allgemeines, e2.category),
            ("edited", false, None)
        );
        assert_eq!(e2.started_at, e.started_at);

        create_manual_entry(&conn, &input).unwrap();
        let ids: Vec<i32> = store::all_entries(&conn)
            .unwrap()
            .iter()
            .map(|e| e.id)
            .collect();
        let group = EntriesTextInput {
            description: "same".into(),
            is_allgemeines: true,
            category: Some(AllgemeinesCategory::Release),
        };
        update_entries(&mut conn, &ids, &group).unwrap();
        assert!(store::all_entries(&conn)
            .unwrap()
            .iter()
            .all(|e| e.description == "same" && e.category == Some(AllgemeinesCategory::Release)));
        assert!(update_entries(&mut conn, &[], &group).is_err());

        delete_entry(&conn, ids[0]).unwrap();
        assert_eq!(store::all_entries(&conn).unwrap().len(), 1);
    }
}
