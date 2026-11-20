//! Absences: Urlaub, Krank or Feiertag over a range of days. An absent day
//! leaves the weekly average of the Auswertung and is marked in the Kalender.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate, Weekday};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::days::parse_key;
use crate::error::{Error, Result};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum AbsenceKind {
    Urlaub,
    Krank,
    Feiertag,
}

impl AbsenceKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Urlaub => "Urlaub",
            Self::Krank => "Krank",
            Self::Feiertag => "Feiertag",
        }
    }

    fn parse(s: &str) -> Option<Self> {
        match s {
            "Urlaub" => Some(Self::Urlaub),
            "Krank" => Some(Self::Krank),
            "Feiertag" => Some(Self::Feiertag),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Absence {
    pub id: i32,
    /// First day, `YYYY-MM-DD`.
    pub from_day: String,
    /// Last day, inclusive.
    pub to_day: String,
    pub kind: AbsenceKind,
    pub note: String,
    /// Monday to Friday within the range.
    pub workdays: i32,
}

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AbsenceInput {
    pub from_day: String,
    pub to_day: String,
    pub kind: AbsenceKind,
    pub note: String,
}

const MAX_DAYS: i64 = 366;
const MAX_NOTE_CHARS: usize = 200;

fn invalid(msg: &str) -> Error {
    Error::Validation(msg.into())
}

fn is_workday(d: NaiveDate) -> bool {
    !matches!(d.weekday(), Weekday::Sat | Weekday::Sun)
}

fn days_of(from: NaiveDate, to: NaiveDate) -> impl Iterator<Item = NaiveDate> {
    from.iter_days().take_while(move |d| *d <= to)
}

fn german(d: NaiveDate) -> String {
    d.format("%d.%m.%Y").to_string()
}

/// Every absence, newest first. Rows with an unknown kind are skipped.
pub fn list(conn: &Connection) -> Result<Vec<Absence>> {
    let mut stmt = conn.prepare(
        "SELECT id, from_day, to_day, kind, note FROM absences ORDER BY from_day DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, i32>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, from_day, to_day, kind, note) = row?;
        let (Some(kind), Some(from), Some(to)) =
            (AbsenceKind::parse(&kind), parse_key(&from_day), parse_key(&to_day))
        else {
            continue;
        };
        out.push(Absence {
            id,
            from_day,
            to_day,
            kind,
            note,
            workdays: days_of(from, to).filter(|d| is_workday(*d)).count() as i32,
        });
    }
    Ok(out)
}

/// Every absent day, `YYYY-MM-DD` → kind.
pub fn days(conn: &Connection) -> Result<BTreeMap<String, AbsenceKind>> {
    let mut map = BTreeMap::new();
    for a in list(conn)? {
        let (Some(from), Some(to)) = (parse_key(&a.from_day), parse_key(&a.to_day)) else {
            continue;
        };
        for d in days_of(from, to) {
            map.insert(d.format("%Y-%m-%d").to_string(), a.kind);
        }
    }
    Ok(map)
}

/// Checks the input against the rules and the other absences (all but
/// `except_id`); returns the trimmed note.
fn validate(conn: &Connection, input: &AbsenceInput, except_id: Option<i32>) -> Result<String> {
    let (Some(from), Some(to)) = (parse_key(&input.from_day), parse_key(&input.to_day)) else {
        return Err(invalid("Ungültiges Datum."));
    };
    if to < from {
        return Err(invalid("„Bis“ darf nicht vor „Von“ liegen."));
    }
    if (to - from).num_days() >= MAX_DAYS {
        return Err(invalid("Eine Abwesenheit darf höchstens ein Jahr lang sein."));
    }
    let note = input.note.trim().to_owned();
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(invalid("Die Notiz darf höchstens 200 Zeichen lang sein."));
    }
    // Keys sort like dates, so the overlap test works on the text.
    let clash = conn
        .prepare(
            "SELECT from_day, to_day FROM absences
             WHERE from_day <= ?2 AND to_day >= ?1 AND id IS NOT ?3 LIMIT 1",
        )?
        .query_map(params![input.from_day, input.to_day, except_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .next()
        .transpose()?;
    if let Some((f, t)) = clash {
        let span = match (parse_key(&f), parse_key(&t)) {
            (Some(f), Some(t)) if f == t => german(f),
            (Some(f), Some(t)) => format!("{}–{}", german(f), german(t)),
            _ => format!("{f}–{t}"),
        };
        return Err(Error::Validation(format!(
            "Überschneidet sich mit der Abwesenheit {span}."
        )));
    }
    Ok(note)
}

pub fn create(conn: &Connection, input: &AbsenceInput) -> Result<()> {
    let note = validate(conn, input, None)?;
    conn.execute(
        "INSERT INTO absences (from_day, to_day, kind, note) VALUES (?1, ?2, ?3, ?4)",
        params![input.from_day, input.to_day, input.kind.as_str(), note],
    )?;
    Ok(())
}

pub fn update(conn: &Connection, id: i32, input: &AbsenceInput) -> Result<()> {
    let note = validate(conn, input, Some(id))?;
    let changed = conn.execute(
        "UPDATE absences SET from_day = ?1, to_day = ?2, kind = ?3, note = ?4 WHERE id = ?5",
        params![input.from_day, input.to_day, input.kind.as_str(), note, id],
    )?;
    if changed == 0 {
        return Err(invalid("Abwesenheit nicht gefunden."));
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i32) -> Result<()> {
    conn.execute("DELETE FROM absences WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn input(from: &str, to: &str, kind: AbsenceKind, note: &str) -> AbsenceInput {
        AbsenceInput {
            from_day: from.into(),
            to_day: to.into(),
            kind,
            note: note.into(),
        }
    }

    fn err(r: Result<()>) -> String {
        r.unwrap_err().to_string()
    }

    #[test]
    fn create_list_update_delete() {
        let conn = open_in_memory().unwrap();
        // Wednesday to Tuesday: 5 workdays, the weekend does not count.
        create(&conn, &input("2026-12-02", "2026-12-08", AbsenceKind::Urlaub, " Ski ")).unwrap();
        create(&conn, &input("2026-12-24", "2026-12-24", AbsenceKind::Feiertag, "")).unwrap();

        let all = list(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].from_day, "2026-12-24");
        assert_eq!(all[0].workdays, 1);
        assert_eq!(all[1].note, "Ski");
        assert_eq!(all[1].workdays, 5);

        let id = all[1].id;
        update(&conn, id, &input("2026-12-02", "2026-12-03", AbsenceKind::Krank, "")).unwrap();
        let days = days(&conn).unwrap();
        assert_eq!(
            days.iter().map(|(k, v)| (k.as_str(), *v)).collect::<Vec<_>>(),
            [
                ("2026-12-02", AbsenceKind::Krank),
                ("2026-12-03", AbsenceKind::Krank),
                ("2026-12-24", AbsenceKind::Feiertag),
            ]
        );

        delete(&conn, id).unwrap();
        assert_eq!(list(&conn).unwrap().len(), 1);
        assert_eq!(
            err(update(&conn, id, &input("2026-12-02", "2026-12-02", AbsenceKind::Urlaub, ""))),
            "Abwesenheit nicht gefunden."
        );
    }

    #[test]
    fn rejects_bad_input_and_overlaps() {
        let conn = open_in_memory().unwrap();
        let u = AbsenceKind::Urlaub;
        assert_eq!(err(create(&conn, &input("2026-12-x", "2026-12-02", u, ""))), "Ungültiges Datum.");
        assert_eq!(
            err(create(&conn, &input("2026-12-05", "2026-12-02", u, ""))),
            "„Bis“ darf nicht vor „Von“ liegen."
        );
        // 366 days fit a leap year; 367 are too many.
        assert_eq!(
            err(create(&conn, &input("2026-01-01", "2027-01-02", u, ""))),
            "Eine Abwesenheit darf höchstens ein Jahr lang sein."
        );
        assert!(create(&conn, &input("2026-12-01", "2026-12-01", u, &"x".repeat(201))).is_err());

        create(&conn, &input("2026-12-02", "2026-12-05", u, "")).unwrap();
        assert_eq!(
            err(create(&conn, &input("2026-12-05", "2026-12-06", u, ""))),
            "Überschneidet sich mit der Abwesenheit 02.12.2026–05.12.2026."
        );
        assert!(create(&conn, &input("2026-11-30", "2026-12-10", u, "")).is_err());
        // Right next to it is fine, and an absence never clashes with itself.
        create(&conn, &input("2026-12-06", "2026-12-06", u, "")).unwrap();
        let id = list(&conn).unwrap()[1].id;
        update(&conn, id, &input("2026-12-01", "2026-12-05", u, "")).unwrap();
    }
}
