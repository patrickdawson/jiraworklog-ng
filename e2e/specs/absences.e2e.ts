import { resetDb } from "../support/db.ts";
import { expect, page } from "../support/page.ts";

/**
 * An absence is entered by clicking a day header in the Kalender, edited the
 * same way, listed on the Abwesenheiten page and deleted there. Overlaps are
 * refused.
 */

describe("absences", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("absences — enter and edit in the Kalender, overlap refused, delete in the list", async () => {
    await page.goto("/kalender?anchor=2026-09-15");
    await expect(page.getByText("KW 38")).toBeVisible();

    // The header click starts on that day; "Bis" extends it to Sunday.
    await page.getByRole("button", { name: "Abwesenheit am Mo 14.09. eintragen" }).click();
    let dialog = page.getByRole("dialog", { name: "Abwesenheit eintragen" });
    await expect(dialog.getByLabel("Von")).toHaveValue("2026-09-14");
    await expect(dialog.getByLabel("Bis")).toHaveValue("2026-09-14");
    await dialog.getByLabel("Bis").fill("2026-09-20");
    await dialog.getByLabel("Notiz (optional)").fill("Ostsee");
    await dialog.getByRole("button", { name: "Speichern" }).click();

    await expect(page.locator('[data-absent="true"]')).toHaveCount(7);
    await expect(page.getByTestId("kalender-day-absence")).toHaveCount(7);
    await expect(page.getByTestId("kalender-day-absence").first()).toHaveText("Urlaub");

    // A click on an absent day opens that absence; shorten it to Friday.
    await page.getByRole("button", { name: "Urlaub am Di 15.09. bearbeiten" }).click();
    dialog = page.getByRole("dialog", { name: "Abwesenheit bearbeiten" });
    await expect(dialog.getByLabel("Von")).toHaveValue("2026-09-14");
    await expect(dialog.getByLabel("Bis")).toHaveValue("2026-09-20");
    await dialog.getByLabel("Bis").fill("2026-09-18");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(page.locator('[data-absent="true"]')).toHaveCount(5);

    await page.goto("/abwesenheiten");
    const rows = page.getByTestId("absence-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("14.09.2026 – 18.09.2026");
    await expect(rows.first()).toContainText("Urlaub");
    await expect(rows.first()).toContainText("5 Arbeitstage");
    await expect(rows.first()).toContainText("Ostsee");

    await page.getByRole("button", { name: "Neue Abwesenheit" }).click();
    dialog = page.getByRole("dialog", { name: "Abwesenheit eintragen" });
    await dialog.getByLabel("Von").fill("2026-09-18");
    await dialog.getByLabel("Bis").fill("2026-09-18");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Überschneidet sich mit der Abwesenheit 14.09.2026–18.09.2026.",
    );
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(rows).toHaveCount(1);

    await page.getByRole("button", { name: "14.09.2026 – 18.09.2026 löschen" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
    await expect(page.getByText("Noch keine Abwesenheiten")).toBeVisible();
  });
});
