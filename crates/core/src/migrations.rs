//! Schema migrations, compatible with drizzle-orm's SQLite migrator.
//!
//! The Electron app applied `drizzle/*.sql` through drizzle and recorded each
//! one in `__drizzle_migrations` (`hash` = SHA-256 of the file,
//! `created_at` = the journal's `when`). This runner uses the same table and
//! the same rule — apply every migration whose `when` is newer than the newest
//! recorded `created_at` — so an existing database needs no baseline step, and
//! the old app and the new one can open the same file during the transition.
//!
//! New migrations go into `drizzle/` with a `when` above the last one and get
//! an entry in [`MIGRATIONS`].

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::error::Result;

/// One migration file. `when` orders and identifies it (drizzle's `folderMillis`).
#[derive(Debug, Clone, Copy)]
pub struct Migration {
    pub tag: &'static str,
    pub when: i64,
    pub sql: &'static str,
}

macro_rules! migration {
    ($tag:literal, $when:literal) => {
        Migration {
            tag: $tag,
            when: $when,
            sql: include_str!(concat!("../../../drizzle/", $tag, ".sql")),
        }
    };
}

/// All migrations in order. Must stay in sync with `drizzle/meta/_journal.json`
/// (checked by a test).
pub const MIGRATIONS: &[Migration] = &[
    migration!("0000_parallel_anthem", 1779340767565),
    migration!("0001_add_overtime_baseline", 1779340767566),
    migration!("0002_add_theme_mode", 1779340767567),
    migration!("0003_add_sprint_and_kpi", 1779340767568),
    migration!("0004_add_category_remove_allgemeines", 1779340767569),
    migration!("0005_add_ended_at_index", 1779340767570),
    migration!("0006_add_away_check_and_group_colors", 1779340767572),
    migration!("0007_rename_group_colors", 1779340767573),
    migration!("0008_add_overtime_corridor", 1779340767574),
    migration!("0009_add_recent_entries_limit", 1779340767575),
];

const BREAKPOINT: &str = "--> statement-breakpoint";

// Byte-for-byte drizzle's statement, including the odd `SERIAL` type.
const CREATE_TABLE: &str = "CREATE TABLE IF NOT EXISTS \"__drizzle_migrations\" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
)";

impl Migration {
    /// The hash drizzle stores: SHA-256 over the whole file, hex encoded.
    pub fn hash(&self) -> String {
        Sha256::digest(self.sql.as_bytes())
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    fn statements(&self) -> impl Iterator<Item = &'static str> {
        self.sql
            .split(BREAKPOINT)
            .map(str::trim)
            .filter(|s| !s.is_empty())
    }
}

/// The newest recorded `created_at`, or `None` for a database drizzle never touched.
pub fn last_applied(conn: &Connection) -> Result<Option<i64>> {
    conn.execute_batch(CREATE_TABLE)?;
    let last = conn.query_row(
        "SELECT CAST(MAX(created_at) AS INTEGER) FROM \"__drizzle_migrations\"",
        [],
        |row| row.get::<_, Option<i64>>(0),
    )?;
    Ok(last)
}

/// The migrations from `all` that still have to run on `conn`.
pub fn pending<'a>(conn: &Connection, all: &'a [Migration]) -> Result<Vec<&'a Migration>> {
    let last = last_applied(conn)?;
    Ok(all
        .iter()
        .filter(|m| last.is_none_or(|l| l < m.when))
        .collect())
}

/// Applies every pending migration in one transaction, like drizzle does.
/// Returns the tags that ran.
pub fn migrate(conn: &mut Connection) -> Result<Vec<&'static str>> {
    migrate_with(conn, MIGRATIONS)
}

pub(crate) fn migrate_with(
    conn: &mut Connection,
    all: &'static [Migration],
) -> Result<Vec<&'static str>> {
    let todo = pending(conn, all)?;
    if todo.is_empty() {
        return Ok(Vec::new());
    }
    let tx = conn.transaction()?;
    for m in &todo {
        for stmt in m.statements() {
            tx.execute_batch(stmt)?;
        }
        tx.execute(
            "INSERT INTO \"__drizzle_migrations\" (\"hash\", \"created_at\") VALUES (?1, ?2)",
            (m.hash(), m.when),
        )?;
    }
    tx.commit()?;
    Ok(todo.iter().map(|m| m.tag).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_matches_the_drizzle_journal() {
        let journal: serde_json::Value =
            serde_json::from_str(include_str!("../../../drizzle/meta/_journal.json")).unwrap();
        let entries = journal["entries"].as_array().unwrap();
        assert!(entries.len() <= MIGRATIONS.len());
        for (entry, m) in entries.iter().zip(MIGRATIONS) {
            assert_eq!(entry["tag"].as_str().unwrap(), m.tag);
            assert_eq!(entry["when"].as_i64().unwrap(), m.when, "{}", m.tag);
        }
        assert!(MIGRATIONS.windows(2).all(|w| w[0].when < w[1].when));
    }

    #[test]
    fn fresh_database_gets_every_migration_once() {
        let mut conn = Connection::open_in_memory().unwrap();
        assert_eq!(migrate(&mut conn).unwrap().len(), MIGRATIONS.len());
        assert!(migrate(&mut conn).unwrap().is_empty());
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM __drizzle_migrations", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(rows, MIGRATIONS.len() as i64);
    }

    #[test]
    fn older_database_only_gets_the_missing_migrations() {
        static FIRST_FIVE: &[Migration] = MIGRATIONS.split_at(5).0;
        let mut conn = Connection::open_in_memory().unwrap();
        migrate_with(&mut conn, FIRST_FIVE).unwrap();

        let ran = migrate(&mut conn).unwrap();
        assert_eq!(
            ran,
            MIGRATIONS[5..].iter().map(|m| m.tag).collect::<Vec<_>>()
        );
    }

    #[test]
    fn failed_migration_leaves_nothing_behind() {
        static BROKEN: &[Migration] = &[
            migration!("0000_parallel_anthem", 1779340767565),
            Migration {
                tag: "broken",
                when: 1779340767566,
                sql: "ALTER TABLE nope ADD x integer;",
            },
        ];
        let mut conn = Connection::open_in_memory().unwrap();
        assert!(migrate_with(&mut conn, BROKEN).is_err());
        assert_eq!(last_applied(&conn).unwrap(), None);
        let tables: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'settings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tables, 0);
    }
}
