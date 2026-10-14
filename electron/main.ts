import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, createWriteStream, readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeImage,
  powerMonitor,
  shell,
  Tray,
  ipcMain,
  type MenuItemConstructorOptions,
} from "electron";
import {
  IPC_SECRET_HEADER,
  type AwayPeriod,
  type TimerStatus,
} from "./ipc-contract";

// ── Constants ────────────────────────────────────────────────────────────────
const DEV = !app.isPackaged;
const HOST = "127.0.0.1";
const DEV_PORT = 3877;
const STATUS_POLL_MS = 1000;

/** Appends a diagnostic line to userData/main.log (GUI apps have no console). */
function log(message: string): void {
  try {
    appendFileSync(
      join(app.getPath("userData"), "main.log"),
      `[${new Date().toISOString()}] ${message}\n`,
    );
  } catch {
    // Best-effort logging only.
  }
}

// In dev the secret is shared with `next dev` via the environment (set by the
// npm script). In production the main process is the sole owner of the secret.
const SECRET = DEV
  ? (process.env.JWL_IPC_SECRET ?? "dev-secret")
  : randomBytes(24).toString("hex");

// ── Module state ─────────────────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let appPort = DEV_PORT;
let isQuitting = false;

let lastStatus: TimerStatus = { running: false };
let lastTrayKey: string | null = null;

// Start of the current lock or sleep (epoch ms); null while the user is here.
let awaySince: number | null = null;
let screenLocked = false;

// ── Paths ────────────────────────────────────────────────────────────────────
function assetsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "assets")
    : join(__dirname, "..", "assets");
}

function trayIcon(running: boolean) {
  const file = running ? "tray-running.png" : "tray-idle.png";
  const img = nativeImage.createFromPath(join(assetsDir(), file));
  img.setTemplateImage(false);
  return img;
}

/** The installed executable; the autostart entry points here. */
function executablePath(): string {
  return process.execPath;
}

// ── Networking helpers ───────────────────────────────────────────────────────
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, HOST, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function apiRequest(
  method: "GET" | "POST",
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: HOST,
        port: appPort,
        path,
        method,
        headers: { [IPC_SECRET_HEADER]: SECRET },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function waitForServer(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = httpRequest(
        { host: HOST, port: appPort, path: "/", method: "GET" },
        (res) => {
          res.resume();
          resolve();
        },
      );
      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error("Timed out waiting for the app server to start."));
        } else {
          setTimeout(attempt, 300);
        }
      });
      req.end();
    };
    attempt();
  });
}

// ── Embedded Next.js server (production only) ────────────────────────────────
function startServer(): void {
  const serverDir = join(process.resourcesPath, "standalone");
  const serverEntry = join(serverDir, "server.js");
  const migrationsDir = join(process.resourcesPath, "drizzle");
  const dbPath = join(app.getPath("userData"), "jiraworklog.db");
  log(`Spawning server: ${serverEntry}`);

  const logStream = createWriteStream(
    join(app.getPath("userData"), "server.log"),
    { flags: "a" },
  );

  // Start from a clean environment: strip inherited Node flags (e.g. the VS
  // Code debugger's NODE_OPTIONS=--require bootloader) that are invalid for the
  // forked production server and would crash or hang it.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.NODE_OPTIONS;
  delete childEnv.ELECTRON_RUN_AS_NODE;

  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: serverDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...childEnv,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOSTNAME: HOST,
      PORT: String(appPort),
      JWL_DB_PATH: dbPath,
      JWL_MIGRATIONS_DIR: migrationsDir,
      JWL_IPC_SECRET: SECRET,
    },
  });

  serverProcess.stdout?.pipe(logStream);
  serverProcess.stderr?.pipe(logStream);

  serverProcess.on("error", (err) => {
    log(`Server spawn error: ${err.stack ?? String(err)}`);
  });

  serverProcess.on("exit", (code) => {
    log(`Server exited with code ${code}.`);
    serverProcess = null;
    if (!isQuitting) {
      app.quit();
    }
  });
}

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 640,
    show: false,
    icon: join(assetsDir(), "icon.png"),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep the live timer's setInterval ticking while the window is hidden in
      // the tray; Chromium otherwise throttles background timers heavily.
      backgroundThrottling: false,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  // External links (target="_blank") open in the default browser, not in a
  // second app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.loadURL(`http://${HOST}:${appPort}/`);

  mainWindow.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      // Only surface warnings/errors to keep the log readable.
      if (level >= 2) {
        log(`renderer [${level}] ${message} (${sourceId}:${line})`);
      }
    },
  );
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log(`renderer did-fail-load ${code} ${desc} ${url}`);
  });

  // Closing the window hides to tray instead of quitting; the timer keeps
  // running. A real quit only happens via the tray's "Beenden" action.
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Keep the tray's "show/hide window" label in sync with the window state.
  mainWindow.on("show", () => updateTray());
  mainWindow.on("hide", () => updateTray());
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ── App menu ─────────────────────────────────────────────────────────────────
/** Shows the window and asks the renderer to open an in-app route. */
function openRoute(path: string): void {
  showWindow();
  mainWindow?.webContents.send("navigate", path);
}

/**
 * The app version from package.json. `app.getVersion()` is not enough: in dev
 * Electron starts dist-electron/main.js without a package.json next to it and
 * then reports its own version.
 */
function appVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? app.getVersion();
  } catch {
    return app.getVersion();
  }
}

function showAbout(): void {
  const detail = [
    `Version ${appVersion()}`,
    "",
    `Electron ${process.versions.electron}`,
    `Chromium ${process.versions.chrome}`,
    `Node ${process.versions.node}`,
  ].join("\n");
  const options = {
    type: "info" as const,
    title: "Über JiraWorklog",
    message: "JiraWorklog Tracker",
    detail,
    buttons: ["OK"],
  };
  void (mainWindow
    ? dialog.showMessageBox(mainWindow, options)
    : dialog.showMessageBox(options));
}

function buildAppMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Datei",
      submenu: [
        {
          label: "Fenster schließen",
          accelerator: "CmdOrCtrl+W",
          click: () => mainWindow?.hide(),
        },
        {
          label: "Beenden",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "Bearbeiten",
      submenu: [
        { role: "undo", label: "Rückgängig" },
        { role: "redo", label: "Wiederholen" },
        { type: "separator" },
        { role: "cut", label: "Ausschneiden" },
        { role: "copy", label: "Kopieren" },
        { role: "paste", label: "Einfügen" },
        { role: "selectAll", label: "Alles auswählen" },
      ],
    },
    {
      label: "Ansicht",
      submenu: [
        { role: "reload", label: "Neu laden" },
        ...(DEV
          ? [{ role: "toggleDevTools", label: "Entwicklertools" } as const]
          : []),
        { type: "separator" },
        { role: "resetZoom", label: "Originalgröße" },
        { role: "zoomIn", label: "Vergrößern" },
        { role: "zoomOut", label: "Verkleinern" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Vollbild" },
      ],
    },
    {
      label: "Hilfe",
      submenu: [
        {
          label: "Anleitung",
          accelerator: "F1",
          click: () => openRoute("/hilfe"),
        },
        { label: "Was ist neu", click: () => openRoute("/hilfe/neu") },
        { type: "separator" },
        {
          label: "Datenordner öffnen",
          click: () => void shell.openPath(app.getPath("userData")),
        },
        { type: "separator" },
        { label: "Über JiraWorklog", click: () => showAbout() },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

// ── Tray ─────────────────────────────────────────────────────────────────────
function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

/** The fields the tray's menu, tooltip and icon are derived from. */
function trayRenderKey(): string {
  const visible = mainWindow?.isVisible() ? "1" : "0";
  return lastStatus.running
    ? `run|${lastStatus.effectiveSeconds}|${lastStatus.description}|${visible}`
    : `idle|${visible}`;
}

/**
 * Rebuilds the tray only when something it displays actually changed, so an
 * idle timer no longer churns the context menu every poll and a show/hide of
 * the window immediately refreshes the toggle label (both are driven through
 * this single entry point).
 */
function updateTray(): void {
  if (!tray) return;
  const key = trayRenderKey();
  if (key === lastTrayKey) return;
  lastTrayKey = key;
  renderTray();
}

function renderTray(): void {
  if (!tray) return;

  const running = lastStatus.running;
  const label = running
    ? `▶ ${formatElapsed(lastStatus.effectiveSeconds)} — ${
        lastStatus.description?.trim() || "Ohne Beschreibung"
      }`
    : "Kein laufender Timer";

  const template: MenuItemConstructorOptions[] = [
    { label, enabled: false },
    { type: "separator" },
    {
      label: "Timer stoppen",
      enabled: running,
      click: () => void stopTimerFromTray(),
    },
    {
      label: mainWindow?.isVisible()
        ? "Fenster ausblenden"
        : "Fenster anzeigen",
      click: () => {
        if (mainWindow?.isVisible()) {
          mainWindow.hide();
        } else {
          showWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "Beenden",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(
    running
      ? `JiraWorklog — läuft ${formatElapsed(lastStatus.effectiveSeconds)}`
      : "JiraWorklog — kein laufender Timer",
  );
  tray.setImage(trayIcon(running));
}

function createTray(): void {
  tray = new Tray(trayIcon(false));
  tray.on("click", () => showWindow());
  updateTray();
}

async function refreshStatus(): Promise<void> {
  try {
    const res = await apiRequest("GET", "/api/timer/status");
    if (res.status === 200) {
      lastStatus = JSON.parse(res.body) as TimerStatus;
    }
  } catch {
    // Server not ready yet or transient error — keep the last known status.
  }
  updateTray();
}

async function stopTimerFromTray(): Promise<void> {
  try {
    const res = await apiRequest("POST", "/api/timer/stop");
    if (res.status === 200) {
      lastStatus = { running: false };
      updateTray();
      mainWindow?.webContents.send("timer-stopped");
    }
  } catch {
    // Ignore — the next poll will reconcile the tray state.
  }
}

// ── Away detection (screen lock / sleep) ─────────────────────────────────────
// A lock and a sleep often overlap (sleep locks the screen), so the earliest
// one starts the away span and the user is only back once the screen is
// unlocked again.
function markAway(): void {
  awaySince ??= Date.now();
}

function markBack(): void {
  if (awaySince === null) return;
  const period: AwayPeriod = {
    from: new Date(awaySince).toISOString(),
    to: new Date().toISOString(),
  };
  awaySince = null;
  mainWindow?.webContents.send("away-ended", period);
}

function watchAway(): void {
  powerMonitor.on("lock-screen", () => {
    screenLocked = true;
    markAway();
  });
  powerMonitor.on("unlock-screen", () => {
    screenLocked = false;
    markBack();
  });
  powerMonitor.on("suspend", () => markAway());
  powerMonitor.on("resume", () => {
    if (!screenLocked) markBack();
  });
}

// ── Auto-launch (Windows login item) ─────────────────────────────────────────
function getAutoLaunch(): boolean {
  return app.getLoginItemSettings({ path: executablePath() }).openAtLogin;
}

function setAutoLaunch(enabled: boolean): boolean {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: executablePath(),
    args: [],
  });
  return getAutoLaunch();
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());

  app.whenReady().then(async () => {
    try {
      log(
        `Ready. packaged=${app.isPackaged} resources=${process.resourcesPath}`,
      );
      ipcMain.handle("auto-launch:get", () => getAutoLaunch());
      ipcMain.handle("auto-launch:set", (_e, enabled: boolean) =>
        setAutoLaunch(Boolean(enabled)),
      );
      ipcMain.handle("window:show", () => showWindow());

      appPort = DEV ? DEV_PORT : await findFreePort();
      log(`Using port ${appPort}`);

      if (!DEV) startServer();
      log("Waiting for server…");
      await waitForServer();
      log("Server ready.");

      Menu.setApplicationMenu(buildAppMenu());
      createWindow();
      createTray();
      watchAway();

      pollTimer = setInterval(() => void refreshStatus(), STATUS_POLL_MS);
      void refreshStatus();
    } catch (err) {
      log(`Startup failed: ${err instanceof Error ? err.stack : String(err)}`);
    }
  });

  app.on("window-all-closed", () => {
    // Intentionally do nothing: the app lives in the tray until "Beenden".
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    if (pollTimer) clearInterval(pollTimer);
    serverProcess?.kill();
  });
}
