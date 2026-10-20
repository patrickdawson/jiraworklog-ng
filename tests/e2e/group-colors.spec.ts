import { expect, test } from "@playwright/test";
import { getGroupColorRows, resetDb, seedEntries } from "./helpers/db";

/**
 * A color picked for a ticket on the Buchen page is stored per group and
 * shows in the Kalender and in the Auswertung. "Standard" resets it.
 */

/** Local wall-clock time on Tuesday 2026-09-15, as ISO. */
const at = (h: number, m = 0) => new Date(2026, 8, 15, h, m).toISOString();

test.beforeEach(async () => {
  await resetDb();
});

test("group colors — pick, show everywhere, reset", async ({ page }) => {
  await seedEntries([
    { description: "Fix TEST-1 a", startedAt: at(9), endedAt: at(10) },
    { description: "Fix TEST-1 b", startedAt: at(10), endedAt: at(11) },
    { description: "Other DEMO-2 c", startedAt: at(11), endedAt: at(12) },
  ]);

  await page.goto("/?days=all");

  // Two description groups share the ticket, so there are two swatches.
  const swatches = page.getByRole("button", { name: "Farbe für TEST-1 wählen" });
  await expect(swatches).toHaveCount(2);
  await swatches.first().click();
  await page.getByRole("menuitemradio", { name: "Pink" }).click();
  await expect(swatches.last()).toHaveAttribute("data-color", "pink");

  // The whole row is tinted, not only the label; uncolored rows stay neutral.
  const rows = page.getByTestId("group-row");
  await expect(rows.filter({ hasText: "TEST-1" })).toHaveCount(2);
  for (const row of await rows.filter({ hasText: "TEST-1" }).all()) {
    await expect(row).toHaveAttribute("data-group-color", "pink");
    await expect(row).toHaveCSS("background-color", /rgba\(219, 39, 119/);
  }
  await expect(rows.filter({ hasText: "DEMO-2" })).toHaveAttribute(
    "data-group-color",
    "default",
  );

  await expect(
    page.getByRole("button", { name: "Farbe für TEST-1 wählen" }).first(),
  ).toHaveAttribute("data-color", "pink");
  await expect
    .poll(getGroupColorRows)
    .toEqual([expect.objectContaining({ groupKey: "issue:TEST-1", color: "pink" })]);

  await page.goto("/kalender?anchor=2026-09-15");
  const blocks = page.getByTestId("kalender-entry");
  await expect(blocks).toHaveCount(3);
  await expect(blocks.filter({ hasText: "TEST-1" }).first()).toHaveAttribute(
    "data-group-color",
    "pink",
  );
  await expect(blocks.filter({ hasText: "DEMO-2" })).toHaveAttribute(
    "data-group-color",
    "default",
  );

  await page.goto("/auswertung?range=week&anchor=2026-09-15");
  const bar = page.getByTestId("group-bar").filter({ hasText: "TEST-1" });
  await expect(bar).toHaveAttribute("data-group-color", "pink");
  await expect(bar).toContainText("2:00");
  // 2 of 3 hours.
  await expect(bar.getByTestId("group-bar-percent")).toHaveText("67 %");
  await expect(
    page
      .getByTestId("group-bar")
      .filter({ hasText: "DEMO-2" })
      .getByTestId("group-bar-percent"),
  ).toHaveText("33 %");

  await page.goto("/?days=all");
  await page
    .getByRole("button", { name: "Farbe für TEST-1 wählen" })
    .first()
    .click();
  await page.getByRole("menuitemradio", { name: "Standard" }).click();
  await expect.poll(getGroupColorRows).toEqual([]);
});
