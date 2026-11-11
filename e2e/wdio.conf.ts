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
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
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
  execFileSync(
    "npx",
    [
      "tauri",
      "build",
      ...(E2E_RELEASE ? [] : ["--debug"]),
      "--no-bundle",
      "--features",
      "e2e",
    ],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, CARGO_TARGET_DIR: E2E_TARGET_DIR },
    },
  );
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
    ensureTauriDriver();
    msedgedriverExe = await ensureMsedgedriver();
    // A run that was aborted may have left its app holding the database.
    killByExactPath(APP_EXE);
    killByExactPath(msedgedriverExe);
    buildApp();

    rmSync(RUN_DIR, { recursive: true, force: true });
    mkdirSync(RUN_DIR, { recursive: true });

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
