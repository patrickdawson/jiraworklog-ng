//! `jiraworklog.exe --post-install [--from-electron]`: the installer's step
//! after it copied the files (see `windows/installer-hooks.nsh`).
//!
//! Handled in `main` before Tauri starts: no window, no single-instance lock,
//! no tray. The logic is `jwl_core::electron_upgrade`; this file only adds the
//! real registry and the log. Never run it by hand on a machine whose
//! autostart you care about: it rewrites the current user's Run key.

use std::io::Write;
use std::path::Path;

use jwl_core::electron_upgrade::{migrate_autostart, AutostartOutcome, StartupRegistry};

use crate::state;

/// The flag the installer always passes after copying the files.
pub const FLAG: &str = "--post-install";
/// Added when the installer has just removed the Electron app.
pub const FROM_ELECTRON: &str = "--from-electron";

/// Whether this process was started for the post-install step.
pub fn requested() -> bool {
    std::env::args_os().skip(1).any(|a| a == FLAG)
}

/// Runs the step against the real registry and data folder, appends what it
/// did to `upgrade.log` next to the database and returns the exit code
/// (0 = everything worked). The installer only logs a failure; it never
/// undoes the install for it.
pub fn run() -> i32 {
    let from_electron = std::env::args_os().skip(1).any(|a| a == FROM_ELECTRON);
    let exe = match std::env::current_exe() {
        Ok(p) => p.display().to_string(),
        Err(e) => {
            append_log(&[format!("exe path unknown: {e}")]);
            return 1;
        }
    };
    #[cfg(windows)]
    let mut reg = registry::CurrentUser;
    #[cfg(not(windows))]
    let mut reg = jwl_core::electron_upgrade::FakeStartupRegistry::default();
    let report = run_with(&mut reg, &state::db_path(), &exe, from_electron);
    append_log(&report.lines);
    i32::from(!report.ok)
}

/// What [`run_with`] did, one line per action, for the log.
pub struct Report {
    pub ok: bool,
    pub lines: Vec<String>,
}

/// The step itself: after removing Electron, back up the database; always
/// bring the autostart entry in line with `exe`. A failed backup does not
/// stop the autostart step (the app makes its own copy before any schema
/// migration anyway).
pub fn run_with(
    reg: &mut impl StartupRegistry,
    db: &Path,
    exe: &str,
    from_electron: bool,
) -> Report {
    let mut ok = true;
    let mut lines = vec![format!(
        "post-install{}, exe {exe}",
        if from_electron {
            " after removing the Electron app"
        } else {
            ""
        }
    )];
    if from_electron {
        match jwl_core::db::backup_existing(db, "electron") {
            Ok(Some(p)) => lines.push(format!("db backup: {}", p.display())),
            Ok(None) => lines.push(format!("db backup: no database at {}", db.display())),
            Err(e) => {
                ok = false;
                lines.push(format!("db backup failed: {e}"));
            }
        }
    }
    lines.push(match migrate_autostart(reg, exe) {
        Ok(AutostartOutcome::NotSet) => "autostart: off, nothing set".into(),
        Ok(AutostartOutcome::WasDisabled) => {
            "autostart: Electron's was disabled in Task Manager, removed, nothing set".into()
        }
        Ok(AutostartOutcome::Carried { value }) => {
            format!("autostart: carried over from Electron as {value:?}")
        }
        Ok(AutostartOutcome::Kept) => "autostart: on, already points here".into(),
        Ok(AutostartOutcome::Repointed { from, value }) => {
            format!("autostart: re-pointed from {from:?} to {value:?}")
        }
        Err(e) => {
            ok = false;
            format!("autostart failed: {e}")
        }
    });
    Report { ok, lines }
}

fn append_log(lines: &[String]) {
    let dir = state::data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("upgrade.log"))
    else {
        return;
    };
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    for line in lines {
        let _ = writeln!(f, "[{stamp}] {line}");
    }
}

#[cfg(windows)]
mod registry {
    //! The current user's Run and StartupApproved\Run keys, accessed the way
    //! `auto-launch` (inside `tauri-plugin-autostart`) does.

    use jwl_core::electron_upgrade::StartupRegistry;
    use windows_registry::{Key, Type, CURRENT_USER};

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
    const APPROVED: &str =
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    /// HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)
    const NOT_FOUND: i32 = 0x8007_0002_u32 as i32;

    pub struct CurrentUser;

    fn io(e: windows_registry::Result<()>) -> std::io::Result<()> {
        e.map_err(std::io::Error::from)
    }

    fn missing_ok<T>(r: windows_registry::Result<T>) -> std::io::Result<Option<T>> {
        match r {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.code().0 == NOT_FOUND => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn writable(path: &str) -> windows_registry::Result<Key> {
        CURRENT_USER.options().read().write().open(path)
    }

    impl StartupRegistry for CurrentUser {
        fn run_value(&self, name: &str) -> std::io::Result<Option<String>> {
            missing_ok(CURRENT_USER.open(RUN).and_then(|k| k.get_string(name)))
        }

        fn set_run_value(&mut self, name: &str, value: &str) -> std::io::Result<()> {
            io(CURRENT_USER
                .create(RUN)
                .and_then(|k| k.set_string(name, value)))
        }

        fn delete_run_value(&mut self, name: &str) -> std::io::Result<()> {
            missing_ok(writable(RUN).and_then(|k| k.remove_value(name))).map(|_| ())
        }

        fn approved(&self, name: &str) -> std::io::Result<Option<Vec<u8>>> {
            missing_ok(
                CURRENT_USER
                    .open(APPROVED)
                    .and_then(|k| k.get_value(name))
                    .map(|v| v.to_vec()),
            )
        }

        fn set_approved_if_key_exists(
            &mut self,
            name: &str,
            bytes: &[u8],
        ) -> std::io::Result<bool> {
            match missing_ok(writable(APPROVED))? {
                Some(k) => {
                    io(k.set_bytes(name, Type::Bytes, bytes))?;
                    Ok(true)
                }
                None => Ok(false),
            }
        }

        fn delete_approved(&mut self, name: &str) -> std::io::Result<()> {
            missing_ok(writable(APPROVED).and_then(|k| k.remove_value(name))).map(|_| ())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jwl_core::electron_upgrade::{FakeStartupRegistry, ELECTRON_RUN_VALUE, TAURI_RUN_VALUE};

    #[test]
    fn backs_up_the_db_and_carries_autostart() {
        let dir = std::env::temp_dir().join(format!("jwl-upgrade-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("jiraworklog.db");
        drop(jwl_core::db::open(&db).unwrap());
        let mut reg = FakeStartupRegistry::default();
        reg.run
            .insert(ELECTRON_RUN_VALUE.into(), r"C:\old\JiraWorklog.exe".into());

        let report = run_with(&mut reg, &db, r"C:\new\jiraworklog.exe", true);

        assert!(report.ok, "{:?}", report.lines);
        assert_eq!(
            reg.run.get(TAURI_RUN_VALUE).unwrap(),
            r"C:\new\jiraworklog.exe "
        );
        assert!(!reg.run.contains_key(ELECTRON_RUN_VALUE));
        let backups: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("jiraworklog.db.backup-electron-")
            })
            .collect();
        assert_eq!(backups.len(), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_db_is_not_an_error() {
        let mut reg = FakeStartupRegistry::default();
        let report = run_with(
            &mut reg,
            Path::new(r"C:\does-not-exist\jwl\jiraworklog.db"),
            r"C:\new\jiraworklog.exe",
            true,
        );
        assert!(report.ok);
        assert!(reg.run.is_empty());
    }

    #[test]
    fn a_plain_update_makes_no_backup_and_keeps_autostart() {
        let dir = std::env::temp_dir().join(format!("jwl-update-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("jiraworklog.db");
        drop(jwl_core::db::open(&db).unwrap());
        let mut reg = FakeStartupRegistry::default();
        reg.run
            .insert(TAURI_RUN_VALUE.into(), r"C:\new\jiraworklog.exe ".into());
        let before = reg.clone();

        let report = run_with(&mut reg, &db, r"C:\new\jiraworklog.exe", false);

        assert!(report.ok, "{:?}", report.lines);
        assert_eq!(reg, before);
        let backups = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".backup-"))
            .count();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(backups, 0);
    }
}
