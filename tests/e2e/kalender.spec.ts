import { expect, test } from "@playwright/test";
import { resetDb, seedEntries, seedSettings } from "./helpers/db";

/**
 * The Kalender week view must mark time booked twice (overlap) and untracked
 * time between entries (gap). A configured break is not a gap.
 */

/** Local wall-clock time on Tuesday 2026-09-15, as ISO. */
const at = (h: number, m = 0) => new Date(2026, 8, 15, h, m).toISOString();

test.beforeEach(async () => {
  await resetDb();
  await seedSettings({
    breaks: JSON.stringify([{ start: "12:00", end: "12:30" }]),
  });
});

test("kalender — overlaps and gaps are marked, breaks are not gaps", async ({
  page,
}) => {
  await seedEntries([
    { description: "A", startedAt: at(9), endedAt: at(10, 30) },
    // 10:00–10:30 overlaps with A.
    { description: "B", startedAt: at(10), endedAt: at(12) },
    // 12:00–12:30 is the break: no gap.
    { description: "C", startedAt: at(12, 30), endedAt: at(13) },
    // 13:00–13:30 is a gap.
    { description: "D", startedAt: at(13, 30), endedAt: at(15) },
  ]);

  await page.goto("/kalender?anchor=2026-09-15");

  await expect(page.getByText("KW 38")).toBeVisible();
  await expect(page.getByTestId("kalender-entry")).toHaveCount(4);

  const summary = page.getByTestId("kalender-summary");
  await expect(summary).toContainText("1 Überlappung · 00:30");
  await expect(summary).toContainText("1 Lücke · 00:30");

  const tuesday = page.locator('[data-day="2026-09-15"]');
  await expect(tuesday.getByTestId("kalender-overlap")).toHaveCount(1);
  await expect(tuesday.getByTestId("kalender-gap")).toHaveCount(1);
  await expect(tuesday.getByTestId("kalender-gap")).toHaveAttribute(
    "title",
    /13:00–13:30/,
  );
});

test("kalender — back-to-back entries are neither overlap nor gap", async ({
  page,
}) => {
  await seedEntries([
    { description: "A", startedAt: at(9), endedAt: at(10) },
    { description: "B", startedAt: at(10), endedAt: at(11) },
  ]);

  await page.goto("/kalender?anchor=2026-09-15");

  const summary = page.getByTestId("kalender-summary");
  await expect(summary).toContainText("0 Überlappungen");
  await expect(summary).toContainText("0 Lücken");
});
