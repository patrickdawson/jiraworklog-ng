//! Away time: the spans in which the screen was locked or the PC slept while a
//! timer ran. Port of the "Away" section of src/lib/actions.ts and of the
//! lock/sleep bookkeeping in electron/main.ts.

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::days::parse_iso;
use crate::entries::AllgemeinesCategory;
use crate::error::{Error, Result};
use crate::settings;
use crate::store;
use crate::time::to_iso;
use crate::timer::close_running;

/// Shorter locks (a quick coffee) are not worth a question.
pub const MIN_AWAY_SECONDS: i64 = 5 * 60;

/// A finished away span, as ISO timestamps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AwayPeriod {
    pub from: String,
    pub to: String,
}

/// Turns lock/unlock and suspend/resume notifications into away spans.
///
/// A lock and a sleep often overlap (sleep locks the screen), so the earliest
/// one starts the span, and the user is only back once the screen is unlocked.
#[derive(Debug, Default)]
pub struct AwayTracker {
    since: Option<DateTime<Utc>>,
    screen_locked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PowerEvent {
    Lock,
    Unlock,
    Suspend,
    Resume,
}

impl AwayTracker {
    /// Feeds one notification; returns the span when the user is back.
    pub fn on_event(&mut self, event: PowerEvent, now: DateTime<Utc>) -> Option<AwayPeriod> {
        match event {
            PowerEvent::Lock => {
                self.screen_locked = true;
                self.since.get_or_insert(now);
                None
            }
            PowerEvent::Suspend => {
                self.since.get_or_insert(now);
                None
            }
            PowerEvent::Unlock => {
                self.screen_locked = false;
                self.back(now)
            }
            PowerEvent::Resume if !self.screen_locked => self.back(now),
            PowerEvent::Resume => None,
        }
    }

    fn back(&mut self, now: DateTime<Utc>) -> Option<AwayPeriod> {
        self.since.take().map(|since| AwayPeriod {
            from: to_iso(since),
            to: to_iso(now),
        })
    }
}

/// An away span that overlaps the running timer and is worth asking about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AwayCheck {
    pub entry_id: i32,
    pub description: String,
    pub away_from: String,
    pub away_to: String,
}

/// Whether to ask about an away span. `None` when the setting is off, no timer
/// runs, or the part inside the running entry is shorter than
/// [`MIN_AWAY_SECONDS`].
pub fn check(
    conn: &Connection,
    period: &AwayPeriod,
    now: DateTime<Utc>,
) -> Result<Option<AwayCheck>> {
    if !settings::get(conn)?.values.away_check_enabled {
        return Ok(None);
    }
    let Some(running) = store::running_entry(conn)? else {
        return Ok(None);
    };
    let (Some(from), Some(to), Some(started)) = (
        parse_iso(&period.from),
        parse_iso(&period.to),
        parse_iso(&running.started_at),
    ) else {
        return Ok(None);
    };
    let from = from.max(started);
    let to = to.min(now);
    if (to - from).num_milliseconds() < MIN_AWAY_SECONDS * 1000 {
        return Ok(None);
    }
    Ok(Some(AwayCheck {
        entry_id: running.id,
        description: running.description,
        away_from: to_iso(from),
        away_to: to_iso(to),
    }))
}

/// What happens after the away time is cut off.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum AwayMode {
    /// A new entry with the same text starts where the user came back.
    Continue,
    /// The timer stays stopped.
    Stop,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolveAwayInput {
    pub entry_id: i32,
    pub away_from: String,
    pub away_to: String,
    pub mode: AwayMode,
}

/// Removes an away span from the running timer: the entry ends where the user
/// left, and with [`AwayMode::Continue`] a copy starts where they came back.
pub fn resolve<Tz: TimeZone>(
    conn: &mut Connection,
    input: &ResolveAwayInput,
    tz: &Tz,
) -> Result<()> {
    let invalid = |m: &str| Error::Validation(m.into());
    let (Some(from), Some(to)) = (parse_iso(&input.away_from), parse_iso(&input.away_to)) else {
        return Err(invalid("Ungültige Abwesenheit."));
    };
    let running = store::running_entry(conn)?
        .filter(|r| r.id == input.entry_id)
        .ok_or_else(|| invalid("Der Timer hat sich inzwischen geändert."))?;
    if parse_iso(&running.started_at).is_some_and(|s| from < s) {
        return Err(invalid("Abwesenheit beginnt vor dem Timer."));
    }

    let tx = conn.transaction()?;
    close_running(&tx, from, tz)?;
    if input.mode == AwayMode::Continue {
        tx.execute(
            "INSERT INTO time_entries (description, started_at, is_allgemeines, category) VALUES (?1, ?2, ?3, ?4)",
            params![
                running.description,
                to_iso(to),
                running.is_allgemeines,
                running.category.map(AllgemeinesCategory::as_str)
            ],
        )?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::timer;
    use chrono_tz::Europe::Berlin;

    fn at(iso: &str) -> DateTime<Utc> {
        parse_iso(iso).unwrap()
    }

    fn period(from: &str, to: &str) -> AwayPeriod {
        AwayPeriod {
            from: from.into(),
            to: to.into(),
        }
    }

    #[test]
    fn tracker_merges_lock_and_sleep() {
        let mut t = AwayTracker::default();
        assert_eq!(
            t.on_event(PowerEvent::Lock, at("2026-11-10T10:00:00.000Z")),
            None
        );
        assert_eq!(
            t.on_event(PowerEvent::Suspend, at("2026-11-10T10:05:00.000Z")),
            None
        );
        // Resume while still locked: not back yet.
        assert_eq!(
            t.on_event(PowerEvent::Resume, at("2026-11-10T11:00:00.000Z")),
            None
        );
        assert_eq!(
            t.on_event(PowerEvent::Unlock, at("2026-11-10T11:01:00.000Z")),
            Some(period(
                "2026-11-10T10:00:00.000Z",
                "2026-11-10T11:01:00.000Z"
            ))
        );
        // A plain sleep without lock ends on resume.
        t.on_event(PowerEvent::Suspend, at("2026-11-10T12:00:00.000Z"));
        assert_eq!(
            t.on_event(PowerEvent::Resume, at("2026-11-10T12:30:00.000Z")),
            Some(period(
                "2026-11-10T12:00:00.000Z",
                "2026-11-10T12:30:00.000Z"
            ))
        );
        assert_eq!(
            t.on_event(PowerEvent::Unlock, at("2026-11-10T12:31:00.000Z")),
            None
        );
    }

    #[test]
    fn check_clips_to_the_entry_and_ignores_short_spans() {
        let mut conn = open_in_memory().unwrap();
        let now = at("2026-11-10T12:00:00.000Z");
        assert!(check(
            &conn,
            &period("2026-11-10T09:00:00.000Z", "2026-11-10T10:00:00.000Z"),
            now
        )
        .unwrap()
        .is_none()); // nothing runs

        timer::start(
            &mut conn,
            "work",
            false,
            None,
            at("2026-11-10T09:30:00.000Z"),
            &Berlin,
        )
        .unwrap();
        let c = check(
            &conn,
            &period("2026-11-10T09:00:00.000Z", "2026-11-10T10:00:00.000Z"),
            now,
        )
        .unwrap()
        .unwrap();
        assert_eq!(c.away_from, "2026-11-10T09:30:00.000Z");
        assert_eq!(c.away_to, "2026-11-10T10:00:00.000Z");
        assert_eq!(c.description, "work");

        assert!(check(
            &conn,
            &period("2026-11-10T10:00:00.000Z", "2026-11-10T10:04:59.000Z"),
            now
        )
        .unwrap()
        .is_none());

        conn.execute("UPDATE settings SET away_check_enabled = 0", [])
            .unwrap();
        assert!(check(
            &conn,
            &period("2026-11-10T09:00:00.000Z", "2026-11-10T10:00:00.000Z"),
            now
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn resolve_cuts_and_optionally_continues() {
        let mut conn = open_in_memory().unwrap();
        timer::start(
            &mut conn,
            "work",
            true,
            Some(AllgemeinesCategory::Qa),
            at("2026-11-10T08:00:00.000Z"),
            &Berlin,
        )
        .unwrap();
        let id = store::running_entry(&conn).unwrap().unwrap().id;
        let mut input = ResolveAwayInput {
            entry_id: id,
            away_from: "2026-11-10T09:00:00.000Z".into(),
            away_to: "2026-11-10T10:00:00.000Z".into(),
            mode: AwayMode::Continue,
        };
        resolve(&mut conn, &input, &Berlin).unwrap();

        let all = store::all_entries(&conn).unwrap();
        assert_eq!(all.len(), 2);
        let next = &all[0];
        assert_eq!(
            (next.started_at.as_str(), next.ended_at.as_deref()),
            ("2026-11-10T10:00:00.000Z", None)
        );
        assert_eq!(
            (
                next.description.as_str(),
                next.is_allgemeines,
                next.category
            ),
            ("work", true, Some(AllgemeinesCategory::Qa))
        );
        assert_eq!(all[1].ended_at.as_deref(), Some("2026-11-10T09:00:00.000Z"));

        // The old id no longer runs.
        assert_eq!(
            resolve(&mut conn, &input, &Berlin).unwrap_err().to_string(),
            "Der Timer hat sich inzwischen geändert."
        );

        input.entry_id = next.id;
        input.away_from = "2026-11-10T09:59:00.000Z".into();
        assert_eq!(
            resolve(&mut conn, &input, &Berlin).unwrap_err().to_string(),
            "Abwesenheit beginnt vor dem Timer."
        );

        input.away_from = "2026-11-10T11:00:00.000Z".into();
        input.away_to = "2026-11-10T11:30:00.000Z".into();
        input.mode = AwayMode::Stop;
        resolve(&mut conn, &input, &Berlin).unwrap();
        assert!(store::running_entry(&conn).unwrap().is_none());
    }
}
