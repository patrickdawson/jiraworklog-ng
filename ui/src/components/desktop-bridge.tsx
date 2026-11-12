import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect } from "react";
import { useNavigate } from "react-router";
import { desktop } from "@/lib/desktop";
import { reloadAll } from "@/lib/query";
import { listenForMenuShortcuts } from "@/lib/shortcuts";

/**
 * Bridges shell events into the UI: reloads the data when the timer is stopped
 * from the tray, opens the routes picked in the app menu, and sends external
 * links to the default browser instead of navigating the app window away.
 * It also catches the app menu's keyboard shortcuts.
 */
export function DesktopBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const offTimer = desktop.onTimerStopped(() => {
      reloadAll();
    });
    const offNavigate = desktop.onNavigate((path) => {
      // Go through a real link click so page guards (unsaved settings) can
      // intercept it in the capture phase. If none does, push the route here.
      const link = document.createElement("a");
      link.href = `#${path}`;
      link.hidden = true;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        void navigate(path);
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
    });

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement)) return;
      if (!/^https?:/i.test(a.href) || a.origin === window.location.origin) return;
      e.preventDefault();
      void openUrl(a.href);
    }
    // Capture phase: links such as IssueKeyLink stop propagation so the rows
    // around them do not react, which would hide the click from a bubbling
    // listener.
    document.addEventListener("click", onClick, true);
    const offShortcuts = listenForMenuShortcuts();

    return () => {
      offTimer();
      offNavigate();
      offShortcuts();
      document.removeEventListener("click", onClick, true);
    };
  }, [navigate]);

  return null;
}
