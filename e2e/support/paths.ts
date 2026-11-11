// Where the suite keeps its files. Everything lives in the repo's ignored
// target/ folder; nothing is written to the user's own folders.
import path from "node:path";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

/** Cargo target folder of the E2E build, apart from the dev build's target/debug. */
export const E2E_TARGET_DIR = path.join(REPO_ROOT, "target", "e2e");

/** The app under test: debug build with the bundled UI and the `e2e` feature. */
export const APP_EXE = path.join(E2E_TARGET_DIR, "debug", "jiraworklog.exe");

/** Wiped at the start of every run: the fresh database and the app's log. */
export const RUN_DIR = path.join(E2E_TARGET_DIR, "run");
export const TEST_DB_PATH = path.join(RUN_DIR, "jiraworklog.db");
export const APP_LOG_PATH = path.join(RUN_DIR, "tauri-main.log");

/** tauri-driver and msedgedriver, see support/tools.ts. */
export const TOOLS_DIR = path.join(REPO_ROOT, "target", "tools");

export const MOCK_JIRA_PORT = 4570;
export const MOCK_JIRA_URL = `http://127.0.0.1:${MOCK_JIRA_PORT}`;

/** tauri-driver's WebDriver port (it forwards to msedgedriver on port + 1). */
export const DRIVER_PORT = Number(process.env.JWL_E2E_DRIVER_PORT ?? 4444);

/** Origin of the bundled UI in WebView2. */
export const APP_ORIGIN = "http://tauri.localhost";
