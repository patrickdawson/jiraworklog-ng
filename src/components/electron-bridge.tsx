"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Bridges Electron main-process events into the Next.js renderer. It refreshes
 * the current route when the timer is stopped from the system tray so the UI
 * reflects the change immediately, and opens the routes picked in the app
 * menu. No-op outside Electron.
 */
export function ElectronBridge() {
  const router = useRouter();

  useEffect(() => {
    const bridge = window.electron;
    if (!bridge) return;
    const offTimer = bridge.onTimerStopped(() => {
      router.refresh();
    });
    const offNavigate = bridge.onNavigate((path) => {
      // Go through a real link click so page guards (unsaved settings) can
      // intercept it in the capture phase. If none does, push the route here.
      const link = document.createElement("a");
      link.href = path;
      link.hidden = true;
      link.addEventListener("click", (e) => {
        e.preventDefault();
        router.push(path);
      });
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
    return () => {
      offTimer();
      offNavigate();
    };
  }, [router]);

  return null;
}
