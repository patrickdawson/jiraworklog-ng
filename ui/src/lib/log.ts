// Sends the WebView's warnings and errors to the app log (tauri-main.log next
// to the database), as the Electron app did with its renderer console. A GUI
// app has no console the user could look at.
import { error as logError, warn as logWarn } from "@tauri-apps/plugin-log";

function text(args: unknown[]): string {
  return args
    .map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === "string" ? a : safeJson(a)))
    .join(" ");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function forwardConsoleToLog(): void {
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => {
    warn(...args);
    void logWarn(`ui: ${text(args)}`);
  };
  console.error = (...args: unknown[]) => {
    error(...args);
    void logError(`ui: ${text(args)}`);
  };
  window.addEventListener("error", (e) => {
    void logError(`ui: ${e.message} (${e.filename}:${e.lineno})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    void logError(`ui: unhandled rejection: ${text([e.reason])}`);
  });
}
