import { expect, test, type Page } from "@playwright/test";
import { resetDb, seedEntries, seedSettings } from "./helpers/db";

/**
 * The Überstundensaldo on Buchen must move while a timer runs, and must not
 * jump when the timer stops: the live value is the value the saldo will have
 * once the running entry is finished.
 */

const overtimeValue = (page: Page) =>
  page.getByText(/^[+−]\d+:\d{2}$/).first();

/** A running entry started `minutes` ago. */
async function seedRunning(minutes: number): Promise<Date> {
  const started = new Date(Date.now() - minutes * 60_000);
  await seedEntries([
    { description: "Läuft", startedAt: started.toISOString(), endedAt: null },
  ]);
  return started;
}

test.beforeEach(async () => {
  await resetDb();
  // Exact wall clock, so the arithmetic in these assertions is stable.
  await seedSettings({ autoPauseEnabled: false, breaks: "[]" });
});

test("live overtime — the saldo grows each minute while the timer runs", async ({
  page,
}) => {
  // No regular target, so the saldo is exactly the tracked time.
  await seedSettings({ regularWorkMinutes: 0 });
  await seedRunning(30);

  await page.clock.install();
  await page.goto("/");
  await expect(overtimeValue(page)).toHaveText("+00:30");

  await page.clock.fastForward("01:00");
  await expect(overtimeValue(page)).toHaveText("+00:31");
});

test("live overtime — a fresh day's target counts at once, so stopping does not jump", async ({
  page,
}) => {
  const started = await seedRunning(30);
  const weekday = started.getDay();
  const expected = weekday === 0 || weekday === 6 ? "+00:30" : "−06:30";

  await page.goto("/");
  await expect(overtimeValue(page)).toHaveText(expected);

  await page.getByRole("button", { name: "Timer stoppen" }).click();
  await expect(page.getByRole("button", { name: "Timer starten" })).toBeVisible();
  await expect(overtimeValue(page)).toHaveText(expected);
});
