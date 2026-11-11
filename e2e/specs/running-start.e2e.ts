// Port of tests/e2e/running-start.spec.ts.
import { getEntries, resetDb, seedEntries } from "../support/db.ts";
import { expect, page } from "../support/page.ts";

/**
 * Editing the start of the running timer: the time comes first, so the first
 * keystrokes change the time and not the date. Moving between the two fields
 * does not save yet.
 */

/** Yesterday at the given local time, as ISO — away from midnight on any day. */
function yesterdayAt(h: number, m = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

/** Local `YYYY-MM-DD` of an ISO timestamp. */
function dateOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe("running start", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEntries([{ description: "Läuft", startedAt: yesterdayAt(10), endedAt: null }]);
  });

  it("running start — time comes first and a new time keeps the date", async () => {
    await page.goto("/");
    await page.getByTitle("Startzeit anpassen").click();

    const time = page.getByLabel("Startzeit");
    const date = page.getByLabel("Startdatum");
    await expect(time).toBeFocused();
    await expect(time).toHaveValue("10:00");
    await expect(date).toHaveValue(dateOf(yesterdayAt(10)));

    // The time field sits left of the date field.
    const timeBox = await time.boundingBox();
    const dateBox = await date.boundingBox();
    expect(timeBox.x).toBeLessThan(dateBox.x);

    await time.fill("09:15");
    // Moving on to the date field leaves the editor open.
    await date.focus();
    await expect(time).toBeVisible();
    await date.press("Enter");

    await expect(time).toBeHidden();
    await expect.poll(async () => (await getEntries())[0].startedAt).toBe(yesterdayAt(9, 15));
  });

  it("running start — Abbrechen keeps the old start", async () => {
    await page.goto("/");
    await page.getByTitle("Startzeit anpassen").click();
    await page.getByLabel("Startzeit").fill("08:00");
    await page.getByRole("button", { name: "Abbrechen" }).click();

    await expect(page.getByLabel("Startzeit")).toBeHidden();
    expect((await getEntries())[0].startedAt).toBe(yesterdayAt(10));
  });
});
