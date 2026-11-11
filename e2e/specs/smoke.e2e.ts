// Port of tests/e2e/smoke.spec.ts.
import { resetDb } from "../support/db.ts";
import { expect, page } from "../support/page.ts";

beforeEach(async () => {
  await resetDb();
});

describe("smoke — top-level pages render", () => {
  for (const { path, heading } of [
    { path: "/", heading: "Buchen" },
    { path: "/auswertung", heading: "Auswertung" },
    { path: "/einstellungen", heading: "Einstellungen" },
  ]) {
    it(`${path} loads and shows "${heading}"`, async () => {
      // Console and page errors reach the app log (ui/src/lib/log.ts).
      const mark = page.consoleMark();

      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();

      expect(
        await page.consoleErrorsSince(mark),
        `unexpected console/page errors on ${path}`,
      ).toEqual([]);
    });
  }

  it("sidebar navigates between pages", async () => {
    await page.goto("/");
    await page.getByRole("link", { name: "Auswertung" }).click();
    await expect(page).toHaveURL(/\/auswertung$/);
    await page.getByRole("link", { name: "Einstellungen" }).click();
    await expect(page).toHaveURL(/\/einstellungen$/);
    await page.getByRole("link", { name: "Buchen" }).click();
    await expect(page).toHaveURL(/\/$/);
  });
});
