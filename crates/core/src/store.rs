//! Reads of `time_entries` and `group_colors`. Port of src/db/queries.ts.

use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::entries::{AllgemeinesCategory, DurationRow, TimeEntry};
use crate::error::{Error, Result};
use crate::time::now_iso;

const ENTRY_COLUMNS: &str =
    "id, description, started_at, ended_at, submitted_at, jira_issue_key, is_allgemeines, category";

fn entry_from_row(r: &Row) -> rusqlite::Result<TimeEntry> {
    Ok(TimeEntry {
        id: r.get(0)?,
        description: r.get(1)?,
        started_at: r.get(2)?,
        ended_at: r.get(3)?,
        submitted_at: r.get(4)?,
        jira_issue_key: r.get(5)?,
        is_allgemeines: r.get(6)?,
        category: r
            .get::<_, Option<String>>(7)?
            .as_deref()
            .and_then(AllgemeinesCategory::parse),
    })
}

fn entries(conn: &Connection, filter: &str, args: impl rusqlite::Params) -> Result<Vec<TimeEntry>> {
    let sql = format!("SELECT {ENTRY_COLUMNS} FROM time_entries {filter} ORDER BY started_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(args, entry_from_row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Every entry, newest first. Unbounded: only for "Alles anzeigen".
pub fn all_entries(conn: &Connection) -> Result<Vec<TimeEntry>> {
    entries(conn, "", [])
}

/// Entries with `started_at >= from_iso`, newest first.
pub fn entries_from(conn: &Connection, from_iso: &str) -> Result<Vec<TimeEntry>> {
    entries(conn, "WHERE started_at >= ?1", [from_iso])
}

/// Entries with `from_iso <= started_at <= to_iso`, newest first.
pub fn entries_between(conn: &Connection, from_iso: &str, to_iso: &str) -> Result<Vec<TimeEntry>> {
    entries(
        conn,
        "WHERE started_at >= ?1 AND started_at <= ?2",
        [from_iso, to_iso],
    )
}

/// Lean projection over every finished entry, for per-day aggregates.
pub fn finished_durations(conn: &Connection) -> Result<Vec<DurationRow>> {
    let mut stmt = conn.prepare(
        "SELECT started_at, ended_at, is_allgemeines FROM time_entries WHERE ended_at IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DurationRow {
            started_at: r.get(0)?,
            ended_at: r.get(1)?,
            is_allgemeines: r.get(2)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Finished, non-Allgemeines entries that can go to Jira; in force mode the
/// already submitted ones count again.
pub fn count_bookable(conn: &Connection, include_submitted: bool) -> Result<i32> {
    let submitted = if include_submitted {
        ""
    } else {
        "AND submitted_at IS NULL"
    };
    let sql = format!(
        "SELECT COUNT(*) FROM time_entries WHERE ended_at IS NOT NULL AND is_allgemeines = 0 {submitted}"
    );
    Ok(conn.query_row(&sql, [], |r| r.get(0))?)
}

/// How many entries start strictly before `before_iso`.
pub fn count_entries_before(conn: &Connection, before_iso: &str) -> Result<i32> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM time_entries WHERE started_at < ?1",
        [before_iso],
        |r| r.get(0),
    )?)
}

/// The running entry (`ended_at IS NULL`), if any.
pub fn running_entry(conn: &Connection) -> Result<Option<TimeEntry>> {
    let sql = format!("SELECT {ENTRY_COLUMNS} FROM time_entries WHERE ended_at IS NULL LIMIT 1");
    Ok(conn.query_row(&sql, [], entry_from_row).optional()?)
}

pub fn entry_by_id(conn: &Connection, id: i32) -> Result<Option<TimeEntry>> {
    let sql = format!("SELECT {ENTRY_COLUMNS} FROM time_entries WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], entry_from_row).optional()?)
}

/// Palette a group can be colored with; the theme decides the shade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum GroupColor {
    Indigo,
    Teal,
    Pink,
    Orange,
    Green,
    Sky,
    Purple,
    Slate,
}

/// Group key (`issue:<KEY>` / `cat:<category>`) → color.
pub type GroupColorMap = BTreeMap<String, GroupColor>;

/// Every stored group color; rows with an unknown palette name are skipped.
pub fn group_colors(conn: &Connection) -> Result<GroupColorMap> {
    let mut stmt = conn.prepare("SELECT group_key, color FROM group_colors")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut map = GroupColorMap::new();
    for row in rows {
        let (key, color) = row?;
        if let Ok(c) = serde_json::from_value(serde_json::Value::String(color)) {
            map.insert(key, c);
        }
    }
    Ok(map)
}

/// `^(issue|cat):\S+$`, at most 100 characters.
fn valid_group_key(key: &str) -> bool {
    let rest = key
        .strip_prefix("issue:")
        .or_else(|| key.strip_prefix("cat:"));
    key.chars().count() <= 100
        && rest.is_some_and(|r| !r.is_empty() && !r.chars().any(char::is_whitespace))
}

/// Stores the color of a group; `None` resets it to the default.
pub fn set_group_color(conn: &Connection, key: &str, color: Option<GroupColor>) -> Result<()> {
    if !valid_group_key(key) {
        return Err(Error::Validation("Ungültige Gruppe.".into()));
    }
    match color {
        None => {
            conn.execute("DELETE FROM group_colors WHERE group_key = ?1", [key])?;
        }
        Some(c) => {
            let value = serde_json::to_value(c).expect("serialises");
            let now = now_iso();
            conn.execute(
                "INSERT INTO group_colors (group_key, color, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(group_key) DO UPDATE SET color = excluded.color, updated_at = excluded.updated_at",
                params![key, value.as_str(), now],
            )?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn group_colors_round_trip_and_reject_bad_keys() {
        let conn = open_in_memory().unwrap();
        set_group_color(&conn, "issue:TXR-1", Some(GroupColor::Pink)).unwrap();
        set_group_color(&conn, "cat:QA", Some(GroupColor::Sky)).unwrap();
        set_group_color(&conn, "issue:TXR-1", Some(GroupColor::Green)).unwrap();
        conn.execute(
            "INSERT INTO group_colors (group_key, color) VALUES ('issue:X-1', 'rose')",
            [],
        )
        .unwrap();
        let map = group_colors(&conn).unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(map["issue:TXR-1"], GroupColor::Green);

        set_group_color(&conn, "cat:QA", None).unwrap();
        assert!(!group_colors(&conn).unwrap().contains_key("cat:QA"));

        for bad in ["TXR-1", "issue:", "issue:a b", "cat:"] {
            assert!(
                set_group_color(&conn, bad, Some(GroupColor::Teal)).is_err(),
                "{bad}"
            );
        }
    }
}
