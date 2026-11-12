// WebdriverIO + tauri-driver against the built Tauri app.
//
//   npm run tauri:e2e                       build, then run every spec
//   JWL_E2E_SKIP_BUILD=1 npm run tauri:e2e  reuse target/e2e/debug/jiraworklog.exe
//   JWL_E2E_RELEASE=1 npm run tauri:e2e     same suite against a release build
//                                           (target/e2e/release, release profile)
//   npm run tauri:e2e -- --spec specs/kalender.e2e.ts
//
// The app runs on a fresh database in target/e2e/run (JWL_DB_PATH), never on
// the user's. Each spec file gets its own app launch (one WebDriver session).
import { execFileSync, execSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { startJiraMock, type JiraMockHandle } from "./support/jira-server.ts";
import {
  APP_EXE,
  DRIVER_PORT,
  E2E_RELEASE,
  E2E_TARGET_DIR,
  MOCK_JIRA_PORT,
  REPO_ROOT,
  RUN_DIR,
  TEST_DB_PATH,
} from "./support/paths.ts";
import { killByExactPath } from "./support/processes.ts";
import { ensureMsedgedriver, ensureTauriDriver } from "./support/tools.ts";

let tauriDriver: ChildProcess | null = null;
let jiraMock: JiraMockHandle | null = null;
let msedgedriverExe = "";

function buildApp(): void {
  if (process.env.JWL_E2E_SKIP_BUILD === "1" && existsSync(APP_EXE)) return;
  const profile = E2E_RELEASE ? "release" : "debug";
  console.log(`[e2e] building the app (${profile}, bundled UI, feature e2e)…`);
  // `tauri build --debug` embeds ui/dist (custom protocol) instead of pointing
  // at the Vite dev server, as a plain `cargo build` would.
  // One command string: npx is a .cmd and needs the shell, and Node deprecates
  // passing an argument list together with `shell: true` (DEP0190).
  execSync(`npx tauri build${E2E_RELEASE ? "" : " --debug"} --no-bundle --features e2e`, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, CARGO_TARGET_DIR: E2E_TARGET_DIR },
  });
}

async function waitForDriver(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`tauri-driver did not answer on port ${DRIVER_PORT}`);
}

/**
 * Opens and closes one session before any spec runs. If the app cannot be
 * started (driver/WebView2 mismatch, app crash), the suite stops here with
 * the driver's answer and its log, instead of every spec failing silently
 * after its connection retries.
 */
async function probeSession(): Promise<void> {
  const base = `http://127.0.0.1:${DRIVER_PORT}`;
  const res = await fetch(`${base}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      capabilities: {
        alwaysMatch: { browserName: "wry", "tauri:options": { application: APP_EXE } },
      },
    }),
    signal: AbortSignal.timeout(90_000),
  }).catch((e: unknown) => {
    throw new Error(`session probe: no answer from tauri-driver (${String(e)})`);
  });
  const text = await res.text();
  const sessionId = (JSON.parse(text || "{}") as { value?: { sessionId?: string } }).value?.sessionId;
  if (!res.ok || !sessionId) {
    throw new Error(`session probe failed: HTTP ${res.status} ${text}`);
  }
  await fetch(`${base}/session/${sessionId}`, { method: "DELETE" });
  // The probe's app must be gone before the first spec opens the database.
  killByExactPath(APP_EXE);
  console.log("[e2e] session probe ok");
}

function driverLogTail(): string {
  try {
    const lines = readFileSync(path.join(RUN_DIR, "tauri-driver.log"), "utf8").trimEnd().split(/\r?\n/);
    return `\n--- tauri-driver.log (last 40 lines) ---\n${lines.slice(-40).join("\n")}`;
  } catch {
    return "";
  }
}

function stopEverything(): void {
  if (tauriDriver?.pid) {
    // By PID, with its tree (msedgedriver and the app it started).
    try {
      execFileSync("taskkill", ["/PID", String(tauriDriver.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } catch {
      // already gone
    }
  }
  tauriDriver = null;
  // Anything left from this suite, matched by full path, never by name: the
  // user's own JiraWorklog.exe must survive.
  killByExactPath(APP_EXE);
  if (msedgedriverExe) killByExactPath(msedgedriverExe);
}

/**
 * Builds the app and starts the Jira mock and tauri-driver. Lives outside
 * `onPrepare` because WebdriverIO only writes an error thrown there to
 * wdio-logs/wdio.log and then runs every spec anyway: each fails to get a
 * session, with no reason on the console.
 */
async function prepare(): Promise<void> {
  ensureTauriDriver();
  msedgedriverExe = await ensureMsedgedriver();
  // A run that was aborted may have left its app holding the database.
  killByExactPath(APP_EXE);
  killByExactPath(msedgedriverExe);
  buildApp();

  // Clear the last run, except wdio-logs: WebdriverIO already holds its log
  // file open there, and deleting it crashes the run (ENOENT) at the first
  // warning, hiding the actual error.
  mkdirSync(RUN_DIR, { recursive: true });
  for (const name of readdirSync(RUN_DIR)) {
    if (name !== "wdio-logs") rmSync(path.join(RUN_DIR, name), { recursive: true, force: true });
  }

  jiraMock = await startJiraMock(MOCK_JIRA_PORT);

  const driverLog = createWriteStream(path.join(RUN_DIR, "tauri-driver.log"));
  tauriDriver = spawn(
    ensureTauriDriver(),
    ["--port", String(DRIVER_PORT), "--native-driver", msedgedriverExe],
    {
      cwd: RUN_DIR,
      // The app inherits this environment through tauri-driver and
      // msedgedriver: its database (and log) go to the run folder.
      env: { ...process.env, JWL_DB_PATH: TEST_DB_PATH },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  tauriDriver.stdout?.pipe(driverLog);
  tauriDriver.stderr?.pipe(driverLog);
  await waitForDriver();
  await probeSession();
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: DRIVER_PORT,
  capabilities: [
    {
      browserName: "wry",
      "tauri:options": { application: APP_EXE },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: "warn",
  outputDir: path.join(RUN_DIR, "wdio-logs"),
  waitforTimeout: 10_000,
  connectionRetryTimeout: 60_000,
  connectionRetryCount: 1,
  // Specs import `browser` from @wdio/globals and `expect`/`page` from
  // support/page.ts (Playwright-style locators and assertions).
  injectGlobals: false,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 120_000 },

  onPrepare: async () => {
    try {
      await prepare();
    } catch (e) {
      console.error(`[e2e] setup failed: ${e instanceof Error ? e.message : String(e)}${driverLogTail()}`);
      stopEverything();
      await jiraMock?.stop();
      process.exit(1);
    }
  },

  onComplete: async () => {
    stopEverything();
    await jiraMock?.stop();
    jiraMock = null;
  },
};

// Ctrl+C while the suite runs: do not leave the driver and the app behind.
// Only in the launcher; the workers load this file too.
if (!process.env.WDIO_WORKER_ID) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      stopEverything();
      process.exit(130);
    });
  }
}
