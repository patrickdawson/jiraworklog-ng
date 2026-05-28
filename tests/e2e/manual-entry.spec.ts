import { expect, test } from "@playwright/test";
import { getEntries, resetDb, seedEntries } from "./helpers/db";

test.beforeEach(async () => {
  await resetDb();
});

/** `YYYY-MM-DDTHH:MM` in local time — the value a `datetime-local` input expects. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** ISO timestamp for today at the given local clock time. */
function todayAtIso(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

test("manual entry — create via dialog persists and shows in the day section", async ({
  page,
}) => {
  await page.goto("/");

  await page.getByTestId("manual-entry-new").click();
  const dialog = page.getByRole("dialog");

  const start = new Date();
  start.setHours(9, 0, 0, 0);
  const end = new Date();
  end.setHours(10, 0, 0, 0);

  await dialog.getByLabel("Beschreibung").fill("TEST-789 manual work");
  await dialog.getByLabel("Beginn").fill(toLocalInput(start));
  await dialog.getByLabel("Ende").fill(toLocalInput(end));
  await dialog.getByRole("button", { name: "Speichern" }).click();

  const row = page.getByTestId("entry-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("TEST-789", { exact: true })).toBeVisible();

  const entries = await getEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0].description).toBe("TEST-789 manual work");
  expect(new Date(entries[0].startedAt).getHours()).toBe(9);
  expect(new Date(entries[0].endedAt!).getHours()).toBe(10);
});

test("manual entry — editing an existing entry updates the description", async ({
  page,
}) => {
  await seedEntries([
    {
      description: "TEST-100 original",
      startedAt: todayAtIso(9),
      endedAt: todayAtIso(10),
    },
  ]);

  await page.goto("/");

  const row = page.getByTestId("entry-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("TEST-100 original")).toBeVisible();

  await row.getByTitle("Bearbeiten").click();
  const dialog = page.getByRole("dialog");

  const description = dialog.getByLabel("Beschreibung");
  await expect(description).toHaveValue("TEST-100 original");
  await description.fill("TEST-100 edited");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  await expect(
    page.getByTestId("entry-row").getByText("TEST-100 edited"),
  ).toBeVisible();

  const entries = await getEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0].description).toBe("TEST-100 edited");
});
