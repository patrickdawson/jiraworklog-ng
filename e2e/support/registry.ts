import { execFileSync } from "node:child_process";

/** The current user's autostart key, where tauri-plugin-autostart writes. */
const RUN_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;

/** The Run value `name`, or `null` if it is not set. */
export function runValue(name: string): string | null {
  let out: string;
  try {
    out = execFileSync("reg.exe", ["query", RUN_KEY, "/v", name], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null; // reg exits with 1 when the value does not exist
  }
  // "    JiraWorklog    REG_SZ    C:\…\jiraworklog.exe "
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\s+(.+?)\s{4}REG_\w+\s{4}(.*)$/);
    if (m && m[1] === name) return m[2];
  }
  return null;
}

export function deleteRunValue(name: string): void {
  try {
    execFileSync("reg.exe", ["delete", RUN_KEY, "/v", name, "/f"], { stdio: "ignore" });
  } catch {
    // Not set.
  }
}
