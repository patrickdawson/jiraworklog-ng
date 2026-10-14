import { expect, test, type Page } from "@playwright/test";
import {
  getEntries,
  getSettingsRow,
  resetDb,
  seedEntries,
  seedSettings,
} from "./helpers/db";

/**
 * After a screen lock or sleep the desktop app asks whether the away time is
 * removed from the running timer. Playwright runs without Electron, so a fake
 * `window.electron` bridge stands in and lets the test fire `away-ended`.
 */

declare global {
  interface Window {
    __fireAway?: (period: { from: string; to: string }) => void;
  }
}

async function installFakeBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let listener: ((p: { from: string; to: string }) => void) | null = null;
    window.__fireAway = (p) => listener?.(p);
    window.electron = {
      isElectron: true,
      onTimerStopped: () => () => {},
      onAwayEnded: (cb) => {
        listener = cb;
        return () => {
          listener = null;
        };
      },
      onNavigate: () => () => {},
      showWindow: async () => {},
      getAutoLaunch: async () => false,
      setAutoLaunch: async (enabled) => enabled,
    };
  });
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/** Running timer started 120 min ago; away from 90 to 30 min ago. */
async function seedRunningAndFire(page: Page) {
  const started = minutesAgo(120);
  const from = minutesAgo(90).toISOString();
  const to = minutesAgo(30).toISOString();
  await seedEntries([
    { description: "TEST-1 Arbeit", startedAt: started.toISOString(), endedAt: null },
  ]);
  await page.goto("/");
  await page.evaluate((p) => window.__fireAway?.(p), { from, to });
  return { from, to };
}

const dialog = (page: Page) => page.getByRole("alertdialog", { name: "Abwesenheit" });

test.beforeEach(async ({ page }) => {
  await resetDb();
  await seedSettings({ autoPauseEnabled: false, breaks: "[]" });
  await installFakeBridge(page);
});

test("away check — cut and continue splits the running entry", async ({ page }) => {
  const { from, to } = await seedRunningAndFire(page);

  await expect(dialog(page)).toContainText("01:00 h weg");
  await dialog(page).getByRole("button", { name: "Abziehen und weiterlaufen" }).click();
  await expect(dialog(page)).toBeHidden();

  const entries = (await getEntries()).sort((a, b) => a.id - b.id);
  expect(entries).toHaveLength(2);
  expect(entries[0].endedAt).toBe(from);
  expect(entries[1].startedAt).toBe(to);
  expect(entries[1].endedAt).toBeNull();
  expect(entries[1].description).toBe("TEST-1 Arbeit");
});

test("away check — cut and stop ends the entry where the user left", async ({ page }) => {
  const { from } = await seedRunningAndFire(page);

  await dialog(page).getByRole("button", { name: "Abziehen und stoppen" }).click();
  await expect(dialog(page)).toBeHidden();

  const entries = await getEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0].endedAt).toBe(from);
});

test("away check — keep leaves the entry untouched", async ({ page }) => {
  await seedRunningAndFire(page);

  await dialog(page).getByRole("button", { name: "Zeit behalten" }).click();
  await expect(dialog(page)).toBeHidden();

  const entries = await getEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0].endedAt).toBeNull();
});

test("away check — a short lock does not ask", async ({ page }) => {
  await seedEntries([
    { description: "Läuft", startedAt: minutesAgo(60).toISOString(), endedAt: null },
  ]);
  await page.goto("/");
  await page.evaluate(
    (p) => window.__fireAway?.(p),
    { from: minutesAgo(4).toISOString(), to: new Date().toISOString() },
  );
  // Give the server action time to answer before checking nothing appeared.
  await page.waitForTimeout(1000);
  await expect(dialog(page)).toBeHidden();
});

test("away check — turned off in the settings, it does not ask", async ({ page }) => {
  await page.goto("/einstellungen");
  const toggle = page.getByLabel(
    "Nach Abwesenheit fragen, ob die Zeit abgezogen werden soll",
  );
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Einstellungen gespeichert.")).toBeVisible();
  expect((await getSettingsRow()).awayCheckEnabled).toBe(false);

  await seedRunningAndFire(page);
  await page.waitForTimeout(1000);
  await expect(dialog(page)).toBeHidden();
});
