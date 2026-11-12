// Port of tests/e2e/away-check.spec.ts. The Playwright spec ran without
// Electron and stubbed `window.electron` to fire `away-ended`. Here the real
// app listens; the test emits the same Tauri event the power watcher
// (src-tauri/src/power.rs) emits after a lock or sleep.
import {
  getEntries,
  getSettingsRow,
  resetDb,
  seedEntries,
  seedSettings,
} from "../support/db.ts";
import { expect, page } from "../support/page.ts";

/**
 * After a screen lock or sleep the desktop app asks whether the away time is
 * removed from the running timer.
 */

/**
 * Emits `away-ended`. The page subscribes with Tauri's async `listen` after
 * the layout mounted, so wait for the heading and give the subscription a
 * moment; otherwise the "does not ask" tests could pass on a lost event.
 */
async function fireAway(period: { from: string; to: string }) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  await page.emitEvent("away-ended", period);
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

/** Running timer started 120 min ago; away from 90 to 30 min ago. */
async function seedRunningAndFire() {
  const started = minutesAgo(120);
  const from = minutesAgo(90).toISOString();
  const to = minutesAgo(30).toISOString();
  await seedEntries([
    { description: "TEST-1 Arbeit", startedAt: started.toISOString(), endedAt: null },
  ]);
  await page.goto("/");
  await fireAway({ from, to });
  return { from, to };
}

const dialog = () => page.getByRole("alertdialog", { name: "Abwesenheit" });

describe("away check", () => {
  beforeEach(async () => {
    await resetDb();
    await seedSettings({ autoPauseEnabled: false, breaks: "[]" });
  });

  it("away check — cut and continue splits the running entry", async () => {
    const { from, to } = await seedRunningAndFire();

    await expect(dialog()).toContainText("01:00 h weg");
    await dialog().getByRole("button", { name: "Abziehen und weiterlaufen" }).click();
    await expect(dialog()).toBeHidden();

    const entries = (await getEntries()).sort((a, b) => a.id - b.id);
    expect(entries).toHaveLength(2);
    expect(entries[0].endedAt).toBe(from);
    expect(entries[1].startedAt).toBe(to);
    expect(entries[1].endedAt).toBeNull();
    expect(entries[1].description).toBe("TEST-1 Arbeit");
  });

  it("away check — cut and stop ends the entry where the user left", async () => {
    const { from } = await seedRunningAndFire();

    await dialog().getByRole("button", { name: "Abziehen und stoppen" }).click();
    await expect(dialog()).toBeHidden();

    const entries = await getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].endedAt).toBe(from);
  });

  it("away check — keep leaves the entry untouched", async () => {
    await seedRunningAndFire();

    await dialog().getByRole("button", { name: "Zeit behalten" }).click();
    await expect(dialog()).toBeHidden();

    const entries = await getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].endedAt).toBeNull();
  });

  it("away check — a short lock does not ask", async () => {
    await seedEntries([
      { description: "Läuft", startedAt: minutesAgo(60).toISOString(), endedAt: null },
    ]);
    await page.goto("/");
    await fireAway({ from: minutesAgo(4).toISOString(), to: new Date().toISOString() });
    // Give the command time to answer before checking nothing appeared.
    await page.waitForTimeout(1000);
    await expect(dialog()).toBeHidden();
  });

  // From here on through the power watcher: the notifications go in where
  // Windows' window messages arrive (src-tauri/src/power.rs), with chosen
  // times, so the Rust side's away tracking is part of the test.

  it("away check — a long screen lock reported by Windows asks", async () => {
    await seedEntries([
      { description: "TEST-1 Arbeit", startedAt: minutesAgo(120).toISOString(), endedAt: null },
    ]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);

    await page.powerEvent("lock", minutesAgo(30));
    await page.powerEvent("unlock", new Date());
    await expect(dialog()).toContainText("00:30 h weg");
    await dialog().getByRole("button", { name: "Zeit behalten" }).click();
    await expect(dialog()).toBeHidden();
  });

  it("away check — sleep and wake reported by Windows asks", async () => {
    await seedEntries([
      { description: "TEST-1 Arbeit", startedAt: minutesAgo(120).toISOString(), endedAt: null },
    ]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);

    await page.powerEvent("suspend", minutesAgo(20));
    await page.powerEvent("resume", new Date());
    await expect(dialog()).toContainText("00:20 h weg");
    await dialog().getByRole("button", { name: "Zeit behalten" }).click();
    await expect(dialog()).toBeHidden();
  });

  it("away check — a short screen lock reported by Windows does not ask", async () => {
    await seedEntries([
      { description: "Läuft", startedAt: minutesAgo(60).toISOString(), endedAt: null },
    ]);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);

    await page.powerEvent("lock", minutesAgo(3));
    await page.powerEvent("unlock", new Date());
    await page.waitForTimeout(1000);
    await expect(dialog()).toBeHidden();
  });

  it("away check — turned off in the settings, it does not ask", async () => {
    await page.goto("/einstellungen");
    const toggle = page.getByLabel("Nach Abwesenheit fragen, ob die Zeit abgezogen werden soll");
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Einstellungen gespeichert.")).toBeVisible();
    expect((await getSettingsRow()).awayCheckEnabled).toBe(false);

    await seedRunningAndFire();
    await page.waitForTimeout(1000);
    await expect(dialog()).toBeHidden();
  });
});
