import { execFileSync } from "node:child_process";

/**
 * Stops every process whose executable is exactly `exePath`.
 *
 * Never match by process name: the user's installed JiraWorklog.exe has the
 * same name (Windows compares names case-insensitively) and is their live app.
 */
export function killByExactPath(exePath: string): void {
  // The path travels as an environment variable, so no quoting can break it.
  const script =
    "Get-CimInstance Win32_Process | " +
    "Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $env:JWL_KILL_PATH } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  try {
    execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, JWL_KILL_PATH: exePath },
      stdio: "ignore",
    });
  } catch {
    // Nothing to stop.
  }
}
