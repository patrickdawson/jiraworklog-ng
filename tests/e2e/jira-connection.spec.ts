import { expect, test } from "@playwright/test";
import { resetDb } from "./helpers/db";
import { expectMyself, resetMock } from "./helpers/jira-mock";

test.beforeEach(async () => {
  await resetDb();
  await resetMock();
});

test("test connection — success shows the display name", async ({ page }) => {
  await expectMyself({
    status: 200,
    body: { displayName: "Ada Lovelace" },
  });

  await page.goto("/einstellungen");
  await page.locator("button", { hasText: "Verbindung testen" }).click();
  await expect(page.getByText("Verbunden als Ada Lovelace.")).toBeVisible();
});

test("test connection — 401 surfaces an auth error", async ({ page }) => {
  await expectMyself({
    status: 401,
    body: { errorMessages: ["unauthorized"] },
  });

  await page.goto("/einstellungen");
  await page.locator("button", { hasText: "Verbindung testen" }).click();
  await expect(
    page.getByText("E-Mail / API-Token ist falsch."),
  ).toBeVisible();
});
