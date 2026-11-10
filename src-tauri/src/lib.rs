mod commands;
mod events;
mod menu;
mod power;
mod state;
mod tray;
mod window;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, WindowEvent};
use tauri_plugin_log::{Target, TargetKind};
use tauri_specta::{collect_commands, collect_events, Builder};

use state::{Db, ForceBooking, Zoom};

/// Where the generated TypeScript bindings land, relative to `src-tauri/`.
pub const BINDINGS_PATH: &str = "../ui/src/bindings.ts";

/// The command and event registry. The same builder serves the invoke handler
/// and the TypeScript export, so the bindings can never drift from the code.
pub fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            commands::app_info,
            commands::get_settings,
            commands::update_settings,
            commands::buchen_data,
            commands::start_timer,
            commands::stop_timer,
            commands::update_running_description,
            commands::update_running_allgemeines,
            commands::update_running_category,
            commands::update_running_started_at,
            commands::create_manual_entry,
            commands::update_entry,
            commands::update_entries,
            commands::delete_entry,
            commands::set_group_color,
            commands::check_away_time,
            commands::resolve_away_time,
            commands::show_window,
            commands::get_auto_launch,
            commands::set_auto_launch,
        ])
        .events(collect_events![
            events::TimerStopped,
            events::AwayEnded,
            events::Navigate
        ])
}

/// The log file sits next to the database. Not `main.log`: that is the
/// Electron app's, in the same folder.
fn log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::Folder {
                path: state::data_dir(),
                file_name: Some("tauri-main".into()),
            }),
        ])
        .build()
}

pub fn run() {
    let builder = specta_builder();

    tauri::Builder::default()
        // Must be first: a second start only brings the running app forward.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show(app);
        }))
        .plugin(log_plugin())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(builder.invoke_handler())
        .menu(menu::build)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            let _ = tray::on_menu_event(app, id) || menu::on_menu_event(app, id);
        })
        .setup(move |app| {
            builder.mount_events(app);

            let path = state::db_path();
            let (conn, report) = jwl_core::db::open(&path)?;
            log::info!(
                "db {} · migrated {:?} · backup {:?}",
                path.display(),
                report.migrated,
                report.backup
            );
            app.manage(Db::new(conn));
            app.manage(ForceBooking::default());
            app.manage(Zoom(std::sync::Mutex::new(menu::DEFAULT_ZOOM)));

            tray::create(app.handle())?;
            power::start(app.handle().clone());
            Ok(())
        })
        // Closing the window hides it to the tray; the timer keeps running.
        // Only "Beenden" (tray or menu) quits.
        .on_window_event(|win, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                window::hide(win.app_handle());
            }
        })
        // The window starts hidden (tauri.conf.json) and appears once the UI
        // has loaded, so the user never sees a blank frame.
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = webview.window().show();
                tray::refresh(webview.app_handle());
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
