import { expect, test, type Page } from "@playwright/test";
import { getEntries, getSettingsRow, resetDb, seedEntries, seedSettings } from "./helpers/db";
import type { NewTimeEntry } from "../../src/db/schema";

/**
 * Deleting old entries must not move the overtime balance.
 *
 * `overtimeBalanceMinutes` sums over whatever rows remain plus the configured
 * baseline, so deleting history deletes its contribution too. The cleanup rolls
 * that contribution into the baseline first. Without the roll-forward the
 * number the user trusts about their own working hours silently changes.
 */

/** A finished 8h block on the weekday `daysAgo` days back (weekends skipped). */
function workday(daysAgo: number, description: string): NewTimeEntry {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 480 * 60_000);
  return {
    description,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    submittedAt: end.toISOString(),
  };
}

/** Five consecutive days ending `firstDaysAgo` days back. */
function block(firstDaysAgo: number, label: string): NewTimeEntry[] {
  return [0, 1, 2, 3, 4].map((i) => workday(firstDaysAgo + i, `${label} ${i}`));
}

const overtimeValue = (page: Page) =>
  page.getByText(/^[+−]\d+:\d{2}$/).first();

async function runCleanup(page: Page, days: number) {
  page.once("dialog", (d) => d.accept());
  await page.goto("/einstellungen");
  await page
    .getByLabel("Einträge löschen, älter als (Tage)")
    .fill(String(days));
  await page.getByRole("button", { name: /löschen/i }).click();
  await expect(page.getByText(/gelöscht\./)).toBeVisible();
}

test.beforeEach(async () => {
  await resetDb();
  // Exact wall clock, so the arithmetic in these assertions is stable.
  await seedSettings({ autoPauseEnabled: false, breaks: "[]" });
});

test("retention — deleting old entries leaves the overtime balance unchanged", async ({
  page,
}) => {
  await seedEntries([...block(200, "Alt"), ...block(2, "Neu")]);

  await page.goto("/");
  const before = await overtimeValue(page).textContent();

  await runCleanup(page, 90);

  await page.goto("/");
  await expect(overtimeValue(page)).toHaveText(before!);

  // The old block is really gone, and the baseline absorbed its contribution.
  const rows = await getEntries();
  expect(rows.every((r) => !r.description.startsWith("Alt"))).toBe(true);
  const s = await getSettingsRow();
  expect(s.overtimeBaselineMinutes).not.toBe(0);
});

test("retention — running cleanup twice does not move the baseline again", async ({
  page,
}) => {
  await seedEntries([...block(200, "Alt"), ...block(2, "Neu")]);

  await runCleanup(page, 90);
  const afterFirst = (await getSettingsRow()).overtimeBaselineMinutes;

  await runCleanup(page, 90);
  const afterSecond = (await getSettingsRow()).overtimeBaselineMinutes;

  expect(afterSecond).toBe(afterFirst);
});

test("retention — a running timer is never deleted", async ({ page }) => {
  const started = new Date();
  started.setDate(started.getDate() - 200);
  started.setHours(9, 0, 0, 0);
  await seedEntries([
    ...block(200, "Alt"),
    { description: "Läuft noch", startedAt: started.toISOString() },
  ]);

  await runCleanup(page, 90);

  const rows = await getEntries();
  expect(rows.filter((r) => r.endedAt === null)).toHaveLength(1);
});
