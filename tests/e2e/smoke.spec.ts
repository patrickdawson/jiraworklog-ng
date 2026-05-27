import { expect, test } from "@playwright/test";
import { resetDb } from "./helpers/db";

test.beforeEach(async () => {
  await resetDb();
});

test.describe("smoke — top-level pages render", () => {
  for (const { path, heading } of [
    { path: "/", heading: "Buchen" },
    { path: "/auswertung", heading: "Auswertung" },
    { path: "/einstellungen", heading: "Einstellungen" },
  ]) {
    test(`${path} loads and shows "${heading}"`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("pageerror", (err) => consoleErrors.push(String(err)));
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading, level: 1 }),
      ).toBeVisible();

      expect(consoleErrors, `unexpected console/page errors on ${path}`).toEqual(
        [],
      );
    });
  }

  test("sidebar navigates between pages", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Auswertung" }).click();
    await expect(page).toHaveURL(/\/auswertung$/);
    await page.getByRole("link", { name: "Einstellungen" }).click();
    await expect(page).toHaveURL(/\/einstellungen$/);
    await page.getByRole("link", { name: "Buchen" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
