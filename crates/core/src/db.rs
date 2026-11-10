//! Opening the database: pragmas, backup, migrations.

use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::Connection;

use crate::error::Result;
use crate::migrations;

/// What [`open`] did, for the log.
#[derive(Debug, Default)]
pub struct OpenReport {
    /// Tags of the migrations that ran.
    pub migrated: Vec<&'static str>,
    /// Where the pre-migration copy went, if one was made.
    pub backup: Option<PathBuf>,
}

/// Opens (or creates) the database at `path`, makes a backup copy if an
/// existing file is about to be migrated, and applies pending migrations.
pub fn open(path: &Path) -> Result<(Connection, OpenReport)> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let existed = path.exists();
    let mut conn = Connection::open(path)?;
    configure(&conn)?;

    let mut report = OpenReport::default();
    if existed && !migrations::pending(&conn, migrations::MIGRATIONS)?.is_empty() {
        report.backup = Some(backup(&conn, path)?);
    }
    report.migrated = migrations::migrate(&mut conn)?;
    Ok((conn, report))
}

/// An in-memory database with the full schema, for tests.
pub fn open_in_memory() -> Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrations::migrate(&mut conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> Result<()> {
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Another process (the old app during the transition, a DB browser) may
    // hold a write lock for a moment: wait instead of failing.
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    Ok(())
}

/// Writes a consistent snapshot next to the database, named like the backups
/// the Electron app made: `jiraworklog.db.backup-2026-08-31T11-40-04`.
fn backup(conn: &Connection, path: &Path) -> Result<PathBuf> {
    let stamp = Utc::now().format("%Y-%m-%dT%H-%M-%S");
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(format!(".backup-{stamp}"));
    let target = path.with_file_name(name);
    // VACUUM INTO reads one snapshot, including what still sits in the WAL.
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy()])?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_file_is_migrated_without_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("jiraworklog.db");
        let (_conn, report) = open(&path).unwrap();
        assert_eq!(report.migrated.len(), migrations::MIGRATIONS.len());
        assert!(report.backup.is_none());
    }

    #[test]
    fn outdated_file_is_backed_up_before_migrating() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jiraworklog.db");
        {
            let mut conn = Connection::open(&path).unwrap();
            migrations::migrate_with(&mut conn, &migrations::MIGRATIONS[..3]).unwrap();
        }
        let (_conn, report) = open(&path).unwrap();
        assert_eq!(report.migrated.len(), migrations::MIGRATIONS.len() - 3);
        let backup = report.backup.expect("a backup");
        assert!(backup.exists());
        assert!(backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("jiraworklog.db.backup-"));
    }

    #[test]
    fn current_file_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jiraworklog.db");
        drop(open(&path).unwrap());
        let (_conn, report) = open(&path).unwrap();
        assert!(report.migrated.is_empty());
        assert!(report.backup.is_none());
    }
}
