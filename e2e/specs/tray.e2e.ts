// The tray and the app menu. A test cannot click the native tray or menu, so
// it sends the entry's id through the e2e hook (src-tauri/src/e2e.rs) to the
// same handler a real click calls, and reads the tray back from the native
// menu. Not covered: that Windows shows the icon and delivers the click.
import { browser } from "@wdio/globals";
import { getEntries, resetDb, seedEntries } from "../support/db.ts";
import { expect, page } from "../support/page.ts";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

const tray = async () => {
  const t = (await page.appReport()).tray;
  if (!t) throw new Error("no tray state reported");
  return t;
};

/** The page subscribes to app events after mounting; wait for that first. */
async function openBuchen() {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Buchen", level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
}

describe("tray and app menu", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("tray — shows the running timer, ticks and stops it", async () => {
    await seedEntries([
      { description: "TEST-1 Tray", startedAt: minutesAgo(65).toISOString(), endedAt: null },
    ]);
    await openBuchen();

    await expect.poll(async () => (await tray()).runningIcon).toBe(true);
    const first = await tray();
    expect(first.status).toMatch(/^▶ 1:0\d:\d\d — TEST-1 Tray$/);
    expect(first.tooltip).toMatch(/^JiraWorklog — läuft 1:0\d:\d\d$/);
    expect(first.stopEnabled).toBe(true);

    // The label is updated in place (the menu is never replaced, so an open
    // menu stays open): it changes from one second to the next.
    await page.waitForTimeout(2200);
    expect((await tray()).status).not.toBe(first.status);

    await page.menuClick("tray-stop");
    await expect.poll(async () => (await getEntries())[0].endedAt !== null).toBe(true);
    await expect(page.getByRole("button", { name: "Timer starten" })).toBeVisible();
    await expect.poll(async () => (await tray()).status).toBe("Kein laufender Timer");
    const idle = await tray();
    expect(idle.stopEnabled).toBe(false);
    expect(idle.runningIcon).toBe(false);
    expect(idle.tooltip).toBe("JiraWorklog — kein laufender Timer");
  });

  it("tray — hides and shows the window", async () => {
    await openBuchen();
    await expect.poll(async () => (await tray()).toggle).toBe("Fenster ausblenden");
    expect((await page.appReport()).visible).toBe(true);

    await page.menuClick("tray-toggle");
    await expect.poll(async () => (await page.appReport()).visible).toBe(false);
    await expect.poll(async () => (await tray()).toggle).toBe("Fenster anzeigen");

    await page.menuClick("tray-toggle");
    await expect.poll(async () => (await page.appReport()).visible).toBe(true);
    await expect.poll(async () => (await tray()).toggle).toBe("Fenster ausblenden");
  });

  it("menu — Datei → Fenster schließen hides to the tray", async () => {
    await openBuchen();
    await page.menuClick("close-window");
    await expect.poll(async () => (await page.appReport()).visible).toBe(false);
    await page.menuClick("tray-toggle");
    await expect.poll(async () => (await page.appReport()).visible).toBe(true);
  });

  it("menu — Hilfe opens Anleitung and Was ist neu", async () => {
    await openBuchen();
    await page.menuClick("help");
    await expect(page.getByRole("heading", { name: "Hilfe", level: 1 })).toBeVisible();
    await page.menuClick("whats-new");
    await expect(page.getByRole("heading", { name: "Was ist neu", level: 1 })).toBeVisible();
  });

  it("menu — Ansicht zooms in, out and back", async () => {
    await openBuchen();
    const ratio = async () => (await browser.execute("return window.devicePixelRatio;")) as number;
    const base = await ratio();

    await page.menuClick("zoom-in");
    await expect.poll(ratio).toBeGreaterThan(base);
    await page.menuClick("zoom-reset");
    await expect.poll(ratio).toBe(base);
    await page.menuClick("zoom-out");
    await expect.poll(ratio).toBeLessThan(base);
    await page.menuClick("zoom-reset");
    await expect.poll(ratio).toBe(base);
  });

  it("menu — Ansicht → Vollbild toggles full screen", async () => {
    await openBuchen();
    expect((await page.appReport()).fullscreen).toBe(false);
    await page.menuClick("fullscreen");
    await expect.poll(async () => (await page.appReport()).fullscreen).toBe(true);
    await page.menuClick("fullscreen");
    await expect.poll(async () => (await page.appReport()).fullscreen).toBe(false);
  });
});
