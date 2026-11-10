//! Screen lock and sleep notifications → `away-ended` events. Tauri has no
//! power monitor, so this listens with a hidden window on its own thread:
//! `WM_WTSSESSION_CHANGE` for lock/unlock and `WM_POWERBROADCAST` for
//! suspend/resume.
//!
//! The window is top-level (never shown), not message-only: broadcasts like
//! `WM_POWERBROADCAST` are not delivered to message-only windows.

use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;

use chrono::Utc;
use jwl_core::away::{AwayTracker, PowerEvent};
use tauri::AppHandle;
use tauri_specta::Event;

use crate::events::AwayEnded;

/// Window class of the listener. A test can post messages to it.
pub const CLASS_NAME: &str = "JiraWorklogPowerWatcher";

static EVENTS: OnceLock<Sender<PowerEvent>> = OnceLock::new();

pub fn start(app: AppHandle) {
    let (tx, rx) = channel::<PowerEvent>();
    if EVENTS.set(tx).is_err() {
        return; // already running
    }
    std::thread::spawn(move || {
        let mut tracker = AwayTracker::default();
        for event in rx {
            log::info!("power event {event:?}");
            if let Some(period) = tracker.on_event(event, Utc::now()) {
                log::info!("away from {} to {}", period.from, period.to);
                let _ = AwayEnded(period).emit(&app);
            }
        }
    });
    #[cfg(windows)]
    std::thread::spawn(win::run);
}

#[cfg(windows)]
mod win {
    use super::{PowerEvent, CLASS_NAME, EVENTS};
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Power::RegisterSuspendResumeNotification;
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
        TranslateMessage, DEVICE_NOTIFY_WINDOW_HANDLE, MSG, PBT_APMRESUMEAUTOMATIC, PBT_APMSUSPEND,
        WM_POWERBROADCAST, WM_WTSSESSION_CHANGE, WNDCLASSW, WS_OVERLAPPED, WTS_SESSION_LOCK,
        WTS_SESSION_UNLOCK,
    };

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    unsafe extern "system" fn wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        let event = match (msg, wparam as u32) {
            (WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK) => Some(PowerEvent::Lock),
            (WM_WTSSESSION_CHANGE, WTS_SESSION_UNLOCK) => Some(PowerEvent::Unlock),
            (WM_POWERBROADCAST, PBT_APMSUSPEND) => Some(PowerEvent::Suspend),
            (WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC) => Some(PowerEvent::Resume),
            _ => None,
        };
        if let (Some(e), Some(tx)) = (event, EVENTS.get()) {
            let _ = tx.send(e);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    pub fn run() {
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = wide(CLASS_NAME);
            let wc = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: instance,
                lpszClassName: class.as_ptr(),
                ..std::mem::zeroed()
            };
            if RegisterClassW(&wc) == 0 {
                log::error!("power watcher: RegisterClassW failed");
                return;
            }
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                WS_OVERLAPPED,
                0,
                0,
                0,
                0,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                log::error!("power watcher: CreateWindowExW failed");
                return;
            }
            if WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) == 0 {
                log::error!("power watcher: WTSRegisterSessionNotification failed");
            }
            // Needed for suspend/resume on Modern Standby machines.
            RegisterSuspendResumeNotification(hwnd, DEVICE_NOTIFY_WINDOW_HANDLE);
            log::info!("power watcher running");

            let mut msg: MSG = std::mem::zeroed();
            while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        }
    }
}
