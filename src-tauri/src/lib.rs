mod commands;
mod state;

use tauri::webview::PageLoadEvent;
use tauri::Manager;
use tauri_specta::{collect_commands, Builder};

use state::Db;

/// Where the generated TypeScript bindings land, relative to `src-tauri/`.
pub const BINDINGS_PATH: &str = "../ui/src/bindings.ts";

/// The command registry. The same builder serves the invoke handler and the
/// TypeScript export, so the bindings can never drift from the commands.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::app_info,
        commands::get_settings,
        commands::update_settings,
    ])
}

pub fn run() {
    let builder = specta_builder();

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            let path = state::db_path(app.handle())?;
            let (conn, report) = jwl_core::db::open(&path)?;
            // Replaced by the log plugin in milestone 4.
            eprintln!(
                "db {} · migrated {:?} · backup {:?}",
                path.display(),
                report.migrated,
                report.backup
            );
            app.manage(Db::new(conn));
            Ok(())
        })
        // The window starts hidden (tauri.conf.json) and appears once the UI
        // has loaded, so the user never sees a blank frame.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = webview.window().show();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running JiraWorklog");
}

#[cfg(test)]
mod tests {
    /// Regenerates `ui/src/bindings.ts`. Run via `npm run tauri:bindings`.
    #[test]
    fn export_bindings() {
        super::specta_builder()
            .export(
                specta_typescript::Typescript::default()
                    .header("// @ts-nocheck\n/* eslint-disable */"),
                super::BINDINGS_PATH,
            )
            .expect("failed to export TypeScript bindings");
    }
}
