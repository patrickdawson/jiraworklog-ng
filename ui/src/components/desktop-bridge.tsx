import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { desktop } from "@/lib/desktop";

/**
 * Bridges shell events into the UI (port of electron-bridge.tsx): reloads the
 * data when the timer is stopped from the tray, opens the routes picked in
 * the app menu, and sends external links to the default browser instead of
 * navigating the app window away.
 */
export function DesktopBridge() {
  const router = useRouter();

  useEffect(() => {
    const offTimer = desktop.onTimerStopped(() => {
      router.refresh();
    });
    const offNavigate = desktop.onNavigate((path) => {
      // Go through a real link click so page guards (unsaved settings) can
      // intercept it in the capture phase. If none does, push the route here.
      const link = document.createElement("a");
      link.href = `#${path}`;
      link.hidden = true;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        router.push(path);
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
    document.addEventListener("click", onClick);

    return () => {
      offTimer();
      offNavigate();
      document.removeEventListener("click", onClick);
    };
  }, [router]);

  return null;
}
