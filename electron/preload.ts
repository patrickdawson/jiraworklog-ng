import { contextBridge, ipcRenderer } from "electron";
import type { AwayPeriod } from "./ipc-contract";

/**
 * Bridge exposed to the Next.js renderer. Kept intentionally small and typed to
 * mirror `src/types/electron.d.ts`. Uses contextIsolation, so the renderer only
 * ever sees these functions — never `ipcRenderer` directly.
 */
const bridge = {
  isElectron: true as const,

  onTimerStopped(callback: () => void): () => void {
    const listener = () => callback();
    ipcRenderer.on("timer-stopped", listener);
    return () => {
      ipcRenderer.removeListener("timer-stopped", listener);
    };
  },

  onAwayEnded(callback: (period: AwayPeriod) => void): () => void {
    const listener = (_e: unknown, period: AwayPeriod) => callback(period);
    ipcRenderer.on("away-ended", listener);
    return () => {
      ipcRenderer.removeListener("away-ended", listener);
    };
  },

  showWindow(): Promise<void> {
    return ipcRenderer.invoke("window:show");
  },

  getAutoLaunch(): Promise<boolean> {
    return ipcRenderer.invoke("auto-launch:get");
  },

  setAutoLaunch(enabled: boolean): Promise<boolean> {
    return ipcRenderer.invoke("auto-launch:set", enabled);
  },
};

contextBridge.exposeInMainWorld("electron", bridge);
