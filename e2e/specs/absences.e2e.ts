import { resetDb } from "../support/db.ts";
import { expect, page } from "../support/page.ts";

/**
 * An absence is entered as a range on its own page, refuses an overlap,
 * shows in the Kalender day headers and can be deleted again.
 */

describe("absences", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("absences — add a range, refuse an overlap, show in the Kalender, delete", async () => {
    await page.goto("/abwesenheiten");
    await expect(page.getByText("Noch keine Abwesenheiten")).toBeVisible();

    // "Bis" follows "Von" for a single day, then extends to the Sunday.
    await page.getByLabel("Von").fill("2026-09-14");
    await expect(page.getByLabel("Bis")).toHaveValue("2026-09-14");
    await page.getByLabel("Bis").fill("2026-09-20");
    await page.getByLabel("Notiz (optional)").fill("Ostsee");
    await page.getByRole("button", { name: "Hinzufügen" }).click();

    const rows = page.getByTestId("absence-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("14.09.2026 – 20.09.2026");
    await expect(rows.first()).toContainText("Urlaub");
    await expect(rows.first()).toContainText("5 Arbeitstage");
    await expect(rows.first()).toContainText("Ostsee");

    await page.getByLabel("Von").fill("2026-09-18");
    await page.getByRole("button", { name: "Hinzufügen" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Überschneidet sich mit der Abwesenheit 14.09.2026–20.09.2026.",
    );
    await expect(rows).toHaveCount(1);

    await page.goto("/kalender?anchor=2026-09-15");
    await expect(page.getByText("KW 38")).toBeVisible();
    await expect(page.getByTestId("kalender-day-absence")).toHaveCount(7);
    await expect(page.getByTestId("kalender-day-absence").first()).toHaveText("Urlaub");

    await page.goto("/abwesenheiten");
    await page.getByRole("button", { name: "14.09.2026 – 20.09.2026 löschen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
    await expect(page.getByText("Noch keine Abwesenheiten")).toBeVisible();
  });
});
