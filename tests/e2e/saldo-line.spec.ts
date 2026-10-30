import { expect, test, type Page } from "@playwright/test";
import { resetDb, seedEntries, seedSettings } from "./helpers/db";

/**
 * "Saldo-Verlauf" on the Auswertung: the absolute overtime balance at the end
 * of each day in the range, starting at the first tracked day.
 */

/** Local wall-clock time on 2026-09-14 + `day`, as ISO. */
const at = (day: number, h: number, m = 0) =>
  new Date(2026, 8, 14 + day, h, m).toISOString();

const chart = (page: Page) =>
  page.getByRole("img", { name: /^Saldo-Verlauf/ });

test.beforeEach(async () => {
  await resetDb();
  // Exact wall clock and a 7 h target, so the arithmetic below is stable.
  await seedSettings({
    autoPauseEnabled: false,
    breaks: "[]",
    regularWorkMinutes: 420,
    overtimeBaselineMinutes: 60,
  });
  await seedEntries([
    // Fri before the week: 8 h → +1 h, on top of the +1 h baseline.
    { description: "Vorher", startedAt: at(-3, 9), endedAt: at(-3, 17) },
    // Tue: 4 h → −3 h.
    { description: "Kurz", startedAt: at(1, 9), endedAt: at(1, 13) },
    // Thu: 9 h → +2 h.
    { description: "Lang", startedAt: at(3, 9), endedAt: at(3, 18) },
  ]);
});

test("saldo line — absolute balance per day of the week", async ({ page }) => {
  await page.goto("/auswertung?range=week&anchor=2026-09-15");

  const points = chart(page).getByTestId("saldo-point");
  await expect(points).toHaveCount(7);
  // Days before the range count, so Monday already starts at +2 h.
  await expect(points.nth(0).locator("title")).toHaveText("14.09.2026: +02:00");
  await expect(points.nth(1).locator("title")).toHaveText("15.09.2026: −01:00");
  // A weekday without entries leaves the balance flat.
  await expect(points.nth(2).locator("title")).toHaveText("16.09.2026: −01:00");
  await expect(points.nth(3).locator("title")).toHaveText("17.09.2026: +01:00");

  // The last point matches the KPI.
  await expect(chart(page).getByTestId("saldo-last")).toHaveText("+01:00");
  await expect(chart(page)).toHaveAttribute(
    "aria-label",
    "Saldo-Verlauf, aktuell +01:00",
  );
});

test("saldo line — starts at the first tracked day", async ({ page }) => {
  await page.goto("/auswertung?range=month&anchor=2026-09-01");
  const points = chart(page).getByTestId("saldo-point");
  // 11. to 30. September.
  await expect(points).toHaveCount(20);
  await expect(points.first().locator("title")).toHaveText("11.09.2026: +02:00");
});

test("saldo line — the y-axis shows the corridor while the balance stays in it", async ({
  page,
}) => {
  await seedSettings({
    overtimeCorridorCenterHours: 0,
    overtimeCorridorRangeHours: 5,
  });
  await page.goto("/auswertung?range=week&anchor=2026-09-15");
  await expect(chart(page).getByTestId("saldo-tick")).toHaveText([
    "+05:00",
    "+00:00",
    "−05:00",
  ]);
});

test("saldo line — the y-axis widens when the balance leaves the corridor", async ({
  page,
}) => {
  // Default corridor 100 ± 40 h, balance around 0 h: far below it.
  await page.goto("/auswertung?range=week&anchor=2026-09-15");
  await expect(chart(page).getByTestId("saldo-tick")).toHaveText([
    "+140:00",
    "+100:00",
    "+60:00",
    "+02:00",
  ]);
});

test("saldo line — empty before anything was tracked", async ({ page }) => {
  await page.goto("/auswertung?range=month&anchor=2026-08-01");
  await expect(chart(page)).toHaveCount(0);
  await expect(page.getByText("Saldo-Verlauf")).toBeVisible();
});
