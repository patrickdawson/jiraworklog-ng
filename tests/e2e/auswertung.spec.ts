import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { resetDb, seedEntries } from "./helpers/db";

test.beforeEach(async () => {
  await resetDb();
});

/** ISO timestamp for a fixed local calendar day + clock time. */
function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): string {
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

/**
 * The value shown inside a `KpiCard`. Each card renders the label div followed
 * immediately by the big value div, so the value is the label's next sibling.
 */
function kpiValue(page: Page, label: string): Locator {
  return page
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::div[1]");
}

test("auswertung — switching the range period updates the KPIs", async ({
  page,
}) => {
  // The baseline disables auto-pause and has no break windows, so every entry's
  // worked time is exactly (ended - started). All entries are concrete (not
  // Allgemeines) by default, so the concrete-issue quote is 100 %.
  await seedEntries([
    // March 2026: one 8h day.
    {
      description: "TEST-1 march work",
      startedAt: localIso(2026, 3, 10, 8),
      endedAt: localIso(2026, 3, 10, 16),
    },
    // April 2026: two 4h days.
    {
      description: "TEST-2 april work",
      startedAt: localIso(2026, 4, 14, 8),
      endedAt: localIso(2026, 4, 14, 12),
    },
    {
      description: "TEST-3 april work",
      startedAt: localIso(2026, 4, 15, 8),
      endedAt: localIso(2026, 4, 15, 12),
    },
  ]);

  // March: 8h spread over a single worked day → Ø/Tag = 08:00.
  await page.goto("/auswertung?range=month&anchor=2026-03-01");
  await expect(page.getByText("März 2026")).toBeVisible();
  await expect(kpiValue(page, "Ø Arbeitszeit / Tag")).toHaveText("08:00");
  await expect(kpiValue(page, "Quote konkrete Issues")).toHaveText("100 %");

  // Step to the next period (April) via the range navigation arrow. April has
  // 8h over two worked days → Ø/Tag drops to 04:00.
  await page.getByRole("link", { name: "Nächster Zeitraum" }).click();
  await expect(page.getByText("April 2026")).toBeVisible();
  await expect(kpiValue(page, "Ø Arbeitszeit / Tag")).toHaveText("04:00");

  // Switching the range *kind* re-filters too: the April week containing both
  // entries holds 8h in a single week → Ø/Woche = 08:00 (vs 01:52 for the
  // whole April month).
  await expect(kpiValue(page, "Ø Arbeitszeit / Woche")).toHaveText("01:52");
  await page.goto("/auswertung?range=week&anchor=2026-04-14");
  await expect(kpiValue(page, "Ø Arbeitszeit / Woche")).toHaveText("08:00");

  // An empty period reports no data.
  await page.goto("/auswertung?range=month&anchor=2026-02-01");
  await expect(page.getByText("Februar 2026")).toBeVisible();
  await expect(kpiValue(page, "Ø Arbeitszeit / Tag")).toHaveText("00:00");
  await expect(page.getByText("Keine Erfassung im Zeitraum")).toBeVisible();
});

test("auswertung — the range buttons navigate between range kinds", async ({
  page,
}) => {
  await page.goto("/auswertung?range=month&anchor=2026-03-01");
  await page.getByRole("link", { name: "Woche", exact: true }).click();
  await page.waitForURL(/range=week/);
  await expect(
    page.getByRole("heading", { name: "Auswertung" }),
  ).toBeVisible();
});

test("auswertung — PDF export downloads a valid PDF", async ({ page }) => {
  await seedEntries([
    {
      description: "TEST-1 march work",
      startedAt: localIso(2026, 3, 10, 8),
      endedAt: localIso(2026, 3, 10, 16),
    },
  ]);

  await page.goto("/auswertung?range=month&anchor=2026-03-01");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("pdf-download").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("stundenzettel-2026-03.pdf");

  const filePath = await download.path();
  const buffer = await readFile(filePath);
  expect(buffer.byteLength).toBeGreaterThan(0);
  expect(buffer.subarray(0, 5).toString("utf8")).toBe("%PDF-");
});
