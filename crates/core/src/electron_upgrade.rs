//! Taking over from the Electron app at install time.
//!
//! The NSIS installer stops and uninstalls the old Electron app (see
//! `src-tauri/windows/installer-hooks.nsh`) and then runs the new exe once with
//! `--post-install` (plus `--from-electron` after removing the old app). That
//! step lives here, behind the
//! [`StartupRegistry`] trait, so it can be tested without touching the real
//! registry:
//!
//! - the autostart setting moves from the Run value Electron's
//!   `setLoginItemSettings` wrote (`electron.app.JiraWorklog`) to the one
//!   `tauri-plugin-autostart` reads (`JiraWorklog`), in exactly the plugin's
//!   format (later installs re-point the value at the installed exe), and
//! - after removing Electron, the database gets a copy (`db::backup_existing`, label `electron`) before
//!   the new app opens it for the first time.
//!
//! The data folder itself needs nothing: both apps use
//! `%APPDATA%\jiraworklog-ng`.

/// Run value of the Electron app (`app.setLoginItemSettings` names it
/// `electron.app.<productName>`).
pub const ELECTRON_RUN_VALUE: &str = "electron.app.JiraWorklog";

/// Run value of the Tauri app: `tauri-plugin-autostart` uses the app's
/// `package_info().name`, which is `productName` from `tauri.conf.json`.
pub const TAURI_RUN_VALUE: &str = "JiraWorklog";

/// What the `auto-launch` crate (0.6, used by `tauri-plugin-autostart` 2.x)
/// writes to `StartupApproved\Run` when it enables a value.
pub const STARTUP_APPROVED_ENABLED: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/// The current user's startup entries: `HKCU\...\CurrentVersion\Run` (strings)
/// and `HKCU\...\Explorer\StartupApproved\Run` (Task Manager's on/off bytes).
pub trait StartupRegistry {
    fn run_value(&self, name: &str) -> std::io::Result<Option<String>>;
    fn set_run_value(&mut self, name: &str, value: &str) -> std::io::Result<()>;
    /// Removing a missing value is not an error.
    fn delete_run_value(&mut self, name: &str) -> std::io::Result<()>;
    /// `None` if the value (or the whole key) is missing.
    fn approved(&self, name: &str) -> std::io::Result<Option<Vec<u8>>>;
    /// Writes the bytes only if the `StartupApproved\Run` key exists (as
    /// `auto-launch` does); returns whether it wrote.
    fn set_approved_if_key_exists(&mut self, name: &str, bytes: &[u8]) -> std::io::Result<bool>;
    /// Removing a missing value or key is not an error.
    fn delete_approved(&mut self, name: &str) -> std::io::Result<()>;
}

/// The Run value `tauri-plugin-autostart` writes for `exe`: `auto-launch`
/// formats `"{app_path} {args joined by ' '}"`, so with no args the path is
/// unquoted and followed by one space. `app_path` is
/// `std::env::current_exe().display()`.
pub fn autostart_command(exe: &str, args: &[&str]) -> String {
    format!("{} {}", exe, args.join(" "))
}

/// Task Manager's verdict, read the way `auto-launch` reads it: no bytes (or
/// too few to tell) means enabled; otherwise the last eight bytes are a
/// "disabled since" FILETIME and must all be zero.
pub fn approved_is_enabled(bytes: Option<&[u8]>) -> bool {
    match bytes {
        Some(b) if b.len() >= 8 => b.iter().rev().take(8).all(|v| *v == 0),
        _ => true,
    }
}

/// What [`migrate_autostart`] found and did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AutostartOutcome {
    /// Neither app has an autostart entry: nothing set.
    NotSet,
    /// Electron's autostart was on: the new value was written (`value`) and
    /// the old one removed.
    Carried { value: String },
    /// Electron's value existed but was switched off in Task Manager:
    /// removed, nothing set, so the new app starts with autostart off too.
    WasDisabled,
    /// The Tauri app's own value already points to `exe`.
    Kept,
    /// The Tauri app's own value pointed elsewhere (e.g. installed to another
    /// folder this time) and now points to `exe`.
    Repointed { from: String, value: String },
}

/// Brings the autostart entry in line with the app just installed at `exe`.
///
/// - Electron's `electron.app.JiraWorklog` (if any) moves to `JiraWorklog`
///   (see [`AutostartOutcome`]).
/// - Otherwise an existing `JiraWorklog` value is pointed at `exe`, in the
///   plugin's format; its Task Manager state is left as it is.
/// - No value at all: nothing is written.
///
/// Idempotent.
pub fn migrate_autostart(
    reg: &mut impl StartupRegistry,
    exe: &str,
) -> std::io::Result<AutostartOutcome> {
    let value = autostart_command(exe, &[]);
    if reg.run_value(ELECTRON_RUN_VALUE)?.is_none() {
        return Ok(match reg.run_value(TAURI_RUN_VALUE)? {
            None => AutostartOutcome::NotSet,
            Some(current) if current == value => AutostartOutcome::Kept,
            Some(from) => {
                reg.set_run_value(TAURI_RUN_VALUE, &value)?;
                AutostartOutcome::Repointed { from, value }
            }
        });
    }
    let approved = reg.approved(ELECTRON_RUN_VALUE)?;
    let outcome = if approved_is_enabled(approved.as_deref()) {
        // Same order as auto-launch's enable: Run value, then the approval.
        reg.set_run_value(TAURI_RUN_VALUE, &value)?;
        reg.set_approved_if_key_exists(TAURI_RUN_VALUE, &STARTUP_APPROVED_ENABLED)?;
        AutostartOutcome::Carried { value }
    } else {
        AutostartOutcome::WasDisabled
    };
    // Only remove the old entry once the new one is in place.
    reg.delete_run_value(ELECTRON_RUN_VALUE)?;
    reg.delete_approved(ELECTRON_RUN_VALUE)?;
    Ok(outcome)
}

/// In-memory [`StartupRegistry`] for tests (here and in the shell crate).
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct FakeStartupRegistry {
    pub run: std::collections::BTreeMap<String, String>,
    /// `None` = the `StartupApproved\Run` key does not exist.
    pub approved: Option<std::collections::BTreeMap<String, Vec<u8>>>,
}

impl StartupRegistry for FakeStartupRegistry {
    fn run_value(&self, name: &str) -> std::io::Result<Option<String>> {
        Ok(self.run.get(name).cloned())
    }
    fn set_run_value(&mut self, name: &str, value: &str) -> std::io::Result<()> {
        self.run.insert(name.to_owned(), value.to_owned());
        Ok(())
    }
    fn delete_run_value(&mut self, name: &str) -> std::io::Result<()> {
        self.run.remove(name);
        Ok(())
    }
    fn approved(&self, name: &str) -> std::io::Result<Option<Vec<u8>>> {
        Ok(self.approved.as_ref().and_then(|a| a.get(name).cloned()))
    }
    fn set_approved_if_key_exists(&mut self, name: &str, bytes: &[u8]) -> std::io::Result<bool> {
        Ok(match self.approved.as_mut() {
            Some(a) => {
                a.insert(name.to_owned(), bytes.to_vec());
                true
            }
            None => false,
        })
    }
    fn delete_approved(&mut self, name: &str) -> std::io::Result<()> {
        if let Some(a) = self.approved.as_mut() {
            a.remove(name);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    const OLD_EXE: &str = r"C:\Users\u\AppData\Local\Programs\jiraworklog-ng\JiraWorklog.exe";
    const NEW_EXE: &str = r"C:\Users\u\AppData\Local\JiraWorklog\jiraworklog.exe";

    fn reg(run: &[(&str, &str)], approved: Option<&[(&str, &[u8])]>) -> FakeStartupRegistry {
        FakeStartupRegistry {
            run: run
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            approved: approved
                .map(|a| a.iter().map(|(k, v)| (k.to_string(), v.to_vec())).collect()),
        }
    }

    #[test]
    fn command_matches_auto_launch_format() {
        // auto-launch 0.6 windows.rs: format!("{} {}", app_path, args.join(" "))
        assert_eq!(autostart_command(NEW_EXE, &[]), format!("{NEW_EXE} "));
        assert_eq!(
            autostart_command(NEW_EXE, &["--minimized", "--x"]),
            format!("{NEW_EXE} --minimized --x")
        );
    }

    #[test]
    fn approval_bytes_are_read_like_auto_launch() {
        assert!(approved_is_enabled(None));
        assert!(approved_is_enabled(Some(&STARTUP_APPROVED_ENABLED)));
        assert!(approved_is_enabled(Some(&[
            6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
        ])));
        // Task Manager "disabled": 03 00 00 00 + FILETIME.
        assert!(!approved_is_enabled(Some(&[
            3, 0, 0, 0, 0x10, 0x8e, 0xa4, 0x2b, 0x9c, 0x5e, 0xdb, 0x01
        ])));
        assert!(approved_is_enabled(Some(&[3, 0, 0])));
    }

    #[test]
    fn carries_an_enabled_electron_autostart() {
        let mut r = reg(
            &[(ELECTRON_RUN_VALUE, OLD_EXE), ("OneDrive", "x")],
            Some(&[("OneDrive", &[2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]),
        );
        let out = migrate_autostart(&mut r, NEW_EXE).unwrap();
        assert_eq!(
            out,
            AutostartOutcome::Carried {
                value: format!("{NEW_EXE} ")
            }
        );
        assert_eq!(r.run.get(TAURI_RUN_VALUE).unwrap(), &format!("{NEW_EXE} "));
        assert!(!r.run.contains_key(ELECTRON_RUN_VALUE));
        assert_eq!(r.run.get("OneDrive").unwrap(), "x");
        let approved = r.approved.as_ref().unwrap();
        assert_eq!(
            approved.get(TAURI_RUN_VALUE).unwrap(),
            &STARTUP_APPROVED_ENABLED.to_vec()
        );
        assert!(approved.contains_key("OneDrive"));
    }

    #[test]
    fn without_the_approval_key_only_the_run_value_is_written() {
        let mut r = reg(&[(ELECTRON_RUN_VALUE, OLD_EXE)], None);
        let out = migrate_autostart(&mut r, NEW_EXE).unwrap();
        assert!(matches!(out, AutostartOutcome::Carried { .. }));
        assert_eq!(r.run.len(), 1);
        assert!(r.approved.is_none());
    }

    #[test]
    fn electron_value_approved_as_enabled_removes_its_approval() {
        let mut r = reg(
            &[(ELECTRON_RUN_VALUE, OLD_EXE)],
            Some(&[(ELECTRON_RUN_VALUE, &STARTUP_APPROVED_ENABLED)]),
        );
        migrate_autostart(&mut r, NEW_EXE).unwrap();
        let approved = r.approved.unwrap();
        assert!(!approved.contains_key(ELECTRON_RUN_VALUE));
        assert!(approved.contains_key(TAURI_RUN_VALUE));
    }

    #[test]
    fn nothing_is_set_when_electron_had_no_autostart() {
        let mut r = reg(&[("OneDrive", "x")], Some(&[]));
        let before = r.clone();
        assert_eq!(
            migrate_autostart(&mut r, NEW_EXE).unwrap(),
            AutostartOutcome::NotSet
        );
        assert_eq!(r, before);
    }

    #[test]
    fn disabled_in_task_manager_stays_off() {
        let disabled: &[u8] = &[3, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
        let mut r = reg(
            &[(ELECTRON_RUN_VALUE, OLD_EXE)],
            Some(&[(ELECTRON_RUN_VALUE, disabled)]),
        );
        assert_eq!(
            migrate_autostart(&mut r, NEW_EXE).unwrap(),
            AutostartOutcome::WasDisabled
        );
        assert!(r.run.is_empty());
        assert_eq!(r.approved, Some(BTreeMap::new()));
    }

    #[test]
    fn second_run_is_a_no_op() {
        let mut r = reg(&[(ELECTRON_RUN_VALUE, OLD_EXE)], Some(&[]));
        migrate_autostart(&mut r, NEW_EXE).unwrap();
        let after_first = r.clone();
        assert_eq!(
            migrate_autostart(&mut r, NEW_EXE).unwrap(),
            AutostartOutcome::Kept
        );
        assert_eq!(r, after_first);
    }

    #[test]
    fn a_tauri_value_for_another_folder_is_repointed() {
        let disabled: &[u8] = &[3, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];
        let old = r"C:\elsewhere\jiraworklog.exe ";
        let mut r = reg(
            &[(TAURI_RUN_VALUE, old)],
            Some(&[(TAURI_RUN_VALUE, disabled)]),
        );
        assert_eq!(
            migrate_autostart(&mut r, NEW_EXE).unwrap(),
            AutostartOutcome::Repointed {
                from: old.into(),
                value: format!("{NEW_EXE} ")
            }
        );
        assert_eq!(r.run.get(TAURI_RUN_VALUE).unwrap(), &format!("{NEW_EXE} "));
        // Task Manager's "disabled" stays as the user set it.
        assert_eq!(
            r.approved.unwrap().get(TAURI_RUN_VALUE).unwrap(),
            &disabled.to_vec()
        );
    }

    #[test]
    fn an_existing_tauri_value_is_replaced_by_the_installed_path() {
        let mut r = reg(
            &[
                (ELECTRON_RUN_VALUE, OLD_EXE),
                (TAURI_RUN_VALUE, r"C:\old\jiraworklog.exe "),
            ],
            None,
        );
        migrate_autostart(&mut r, NEW_EXE).unwrap();
        assert_eq!(r.run.get(TAURI_RUN_VALUE).unwrap(), &format!("{NEW_EXE} "));
    }
}
