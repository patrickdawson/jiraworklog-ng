// Release builds are GUI apps: no console window next to the main window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // The installer's one-off step after removing the Electron app. Runs
    // before Tauri, so it opens no window and does not hit the
    // single-instance lock.
    if jiraworklog_lib::upgrade::requested() {
        std::process::exit(jiraworklog_lib::upgrade::run());
    }
    jiraworklog_lib::run();
}
