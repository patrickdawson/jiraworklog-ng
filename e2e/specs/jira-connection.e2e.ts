// Port of tests/e2e/jira-connection.spec.ts. The app talks to the local Jira
// mock (support/jira-server.ts) that the suite starts.
import { resetDb } from "../support/db.ts";
import { expectMyself, resetMock } from "../support/jira-mock.ts";
import { expect, page } from "../support/page.ts";

describe("jira connection", () => {
  beforeEach(async () => {
    await resetDb();
    await resetMock();
  });

  it("test connection — success shows the display name", async () => {
    await expectMyself({ status: 200, body: { displayName: "Ada Lovelace" } });

    await page.goto("/einstellungen");
    await page.locator("button").filter({ hasText: "Verbindung testen" }).click();
    await expect(page.getByText("Verbunden als Ada Lovelace.")).toBeVisible();
  });

  it("test connection — 401 surfaces an auth error", async () => {
    await expectMyself({ status: 401, body: { errorMessages: ["unauthorized"] } });

    await page.goto("/einstellungen");
    await page.locator("button").filter({ hasText: "Verbindung testen" }).click();
    await expect(page.getByText("E-Mail / API-Token ist falsch.")).toBeVisible();
  });
});
