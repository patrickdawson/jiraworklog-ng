// The desktop shell's API: events from the tray and the app menu, and the
// window and autostart commands, over the generated Tauri bindings.
import { commands, events, type AwayPeriod } from "@/bindings";

type Unsubscribe = () => void;

/** Tauri's `listen` is async; this returns a synchronous unsubscribe. */
function subscribe(listen: () => Promise<() => void>): Unsubscribe {
  let off: (() => void) | null = null;
  let cancelled = false;
  void listen().then((fn) => {
    if (cancelled) fn();
    else off = fn;
  });
  return () => {
    cancelled = true;
    off?.();
  };
}

export const desktop = {
  /** The timer was stopped from the tray. */
  onTimerStopped(callback: () => void): Unsubscribe {
    return subscribe(() => events.timerStopped.listen(() => callback()));
  },

  /** The user is back after a screen lock or sleep. */
  onAwayEnded(callback: (period: AwayPeriod) => void): Unsubscribe {
    return subscribe(() => events.awayEnded.listen((e) => callback(e.payload)));
  },

  /** The app menu asks to open a route. */
  onNavigate(callback: (path: string) => void): Unsubscribe {
    return subscribe(() => events.navigate.listen((e) => callback(e.payload)));
  },

  showWindow(): Promise<void> {
    return commands.showWindow();
  },

  async getAutoLaunch(): Promise<boolean> {
    const r = await commands.getAutoLaunch();
    return r.status === "ok" ? r.data : false;
  },

  async setAutoLaunch(enabled: boolean): Promise<boolean> {
    const r = await commands.setAutoLaunch(enabled);
    if (r.status === "error") throw new Error(r.error);
    return r.data;
  },
};
