// Finds (and on first use fetches) the two drivers the suite needs:
//
// - tauri-driver 2.1.0: `cargo install` into target/tools/bin.
// - msedgedriver: must match the installed WebView2 runtime exactly. WebView2
//   updates itself, so the version is read at run time and the matching driver
//   is downloaded from Microsoft into target/tools/msedgedriver/<version>/.
//
// Overrides: JWL_TAURI_DRIVER and JWL_MSEDGEDRIVER (full paths to the exes),
// JWL_WEBVIEW2_VERSION (skip the version lookup).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, TOOLS_DIR } from "./paths.ts";

export const TAURI_DRIVER_VERSION = "2.1.0";

const WEBVIEW2_DIRS = [
  "C:\\Program Files (x86)\\Microsoft\\EdgeWebView\\Application",
  "C:\\Program Files\\Microsoft\\EdgeWebView\\Application",
  path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "EdgeWebView", "Application"),
];

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The newest installed WebView2 runtime, e.g. "157.0.4341.42". */
export function webview2Version(): string {
  if (process.env.JWL_WEBVIEW2_VERSION) return process.env.JWL_WEBVIEW2_VERSION;
  const found: string[] = [];
  for (const dir of WEBVIEW2_DIRS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) found.push(name);
    }
  }
  if (found.length === 0) {
    throw new Error(
      "No WebView2 runtime found. Set JWL_WEBVIEW2_VERSION or JWL_MSEDGEDRIVER.",
    );
  }
  return found.sort(compareVersions).at(-1)!;
}

export function tauriDriverPath(): string {
  return (
    process.env.JWL_TAURI_DRIVER ?? path.join(TOOLS_DIR, "bin", "tauri-driver.exe")
  );
}

export function msedgedriverPath(): string {
  return (
    process.env.JWL_MSEDGEDRIVER ??
    path.join(TOOLS_DIR, "msedgedriver", webview2Version(), "msedgedriver.exe")
  );
}

export function ensureTauriDriver(): string {
  const exe = tauriDriverPath();
  if (existsSync(exe)) return exe;
  console.log(`[e2e] installing tauri-driver ${TAURI_DRIVER_VERSION} into ${TOOLS_DIR}`);
  execFileSync(
    "cargo",
    [
      "install", "tauri-driver",
      "--locked", "--version", TAURI_DRIVER_VERSION,
      // The registry name matters on machines with a crates.io mirror.
      "--registry", "crates-io",
      "--root", TOOLS_DIR,
    ],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  return exe;
}

export async function ensureMsedgedriver(): Promise<string> {
  const exe = msedgedriverPath();
  if (existsSync(exe)) return exe;
  if (process.env.JWL_MSEDGEDRIVER) {
    throw new Error(`JWL_MSEDGEDRIVER points to a missing file: ${exe}`);
  }
  const version = webview2Version();
  const dir = path.dirname(exe);
  const url = `https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`;
  console.log(`[e2e] downloading msedgedriver ${version} from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`msedgedriver download failed: ${res.status} ${url}`);
  mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, "edgedriver_win64.zip");
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  // Windows' own bsdtar unpacks zip files; Git Bash's GNU tar does not.
  execFileSync(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), [
    "-xf", zip, "-C", dir,
  ]);
  if (!existsSync(exe)) throw new Error(`msedgedriver.exe not found in ${zip}`);
  return exe;
}
