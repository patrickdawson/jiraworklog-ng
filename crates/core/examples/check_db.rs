//! Opens a database copy the way the app does and reports what happened.
//! Never prints credentials, only whether they are set.
//!
//!   cargo run -p jwl-core --example check_db -- <db>
//!   cargo run -p jwl-core --example check_db -- --snapshot <source> <dest>
//!
//! `--snapshot` copies `source` read-only via VACUUM INTO, so a live database
//! is never written to.

use std::path::Path;

use jwl_core::{db, migrations, settings};
use rusqlite::{Connection, OpenFlags};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [flag, src, dest] if flag == "--snapshot" => snapshot(Path::new(src), Path::new(dest)),
        [path] => check(Path::new(path)),
        _ => Err("usage: check_db <db> | check_db --snapshot <source> <dest>".into()),
    }
}

fn snapshot(src: &Path, dest: &Path) -> Result<(), Box<dyn std::error::Error>> {
    if dest.exists() {
        return Err(format!("{} exists already", dest.display()).into());
    }
    if let Some(dir) = dest.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy()])?;
    println!("snapshot {} -> {}", src.display(), dest.display());
    Ok(())
}

fn check(path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Recorded drizzle hashes before we touch anything.
    let before: Vec<(String, i64)> = {
        let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let mut stmt = conn.prepare(
            "SELECT hash, CAST(created_at AS INTEGER) FROM __drizzle_migrations ORDER BY created_at",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    println!("recorded migrations: {}", before.len());
    for (hash, when) in &before {
        let ours = migrations::MIGRATIONS.iter().find(|m| m.when == *when);
        let verdict = match ours {
            Some(m) if m.hash() == *hash => format!("{} hash ok", m.tag),
            Some(m) => format!("{} HASH DIFFERS", m.tag),
            None => "UNKNOWN to the Rust runner".into(),
        };
        println!("  {when} {verdict}");
    }

    let (conn, report) = db::open(path)?;
    println!("migrated now: {:?}", report.migrated);
    println!("backup: {:?}", report.backup);

    let s = settings::get(&conn)?.values;
    let set = |v: &Option<String>| v.as_deref().is_some_and(|t| !t.trim().is_empty());
    println!(
        "settings: work {} min, target {} min, {} breaks, mode {:?}, retention {} d, \
         theme {:?}, corridor {}±{} h, away check {}, {} suggestions, {} project keys",
        s.regular_work_minutes,
        s.daily_target_minutes,
        s.breaks.len(),
        s.booking_mode,
        s.data_retention_days,
        s.theme_mode,
        s.overtime_corridor_center_hours,
        s.overtime_corridor_range_hours,
        s.away_check_enabled,
        s.recent_entries_limit,
        s.jira_project_keys.len(),
    );
    println!(
        "jira: url set {}, auth mode {:?}, user set {}, token set {}, password set {}",
        !s.jira_url.trim().is_empty(),
        s.jira_auth_mode,
        set(&s.jira_user),
        set(&s.jira_token),
        set(&s.jira_password),
    );
    for table in ["time_entries", "group_colors"] {
        let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))?;
        println!("{table}: {n} rows");
    }
    let cols: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('settings')",
        [],
        |r| r.get(0),
    )?;
    println!("settings columns: {cols}");
    Ok(())
}
