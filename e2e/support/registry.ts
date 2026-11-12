import { execFileSync } from "node:child_process";

/** The autostart key below HKCU (the app's) or HKLM (all users). */
const runKey = (root: "HKCU" | "HKLM") =>
  String.raw`${root}\Software\Microsoft\Windows\CurrentVersion\Run`;

/** The Run value `name`, or `null` if it is not set. */
export function runValue(name: string, root: "HKCU" | "HKLM" = "HKCU"): string | null {
  let out: string;
  try {
    out = execFileSync("reg.exe", ["query", runKey(root), "/v", name], {
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
    execFileSync("reg.exe", ["delete", runKey("HKCU"), "/v", name, "/f"], { stdio: "ignore" });
  } catch {
    // Not set.
  }
}
