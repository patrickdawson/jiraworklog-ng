import { expect, test, type Page } from "@playwright/test";
import { getEntries, resetDb, seedEntries } from "./helpers/db";

const REFACTORING = "Refactoring TXR-1 Aufräumen";
const DOKU = "Doku TXR-2 Text";
const DAILY = "Daily";

/**
 * A finished entry starting at `hour:00` local time, `daysAgo` days back.
 * Relative, so it stays inside the 30-day suggestion window.
 */
function span(daysAgo: number, hour: number, minutes: number) {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + minutes * 60_000);
  return { startedAt: start.toISOString(), endedAt: end.toISOString() };
}

function groupRow(page: Page, description: string) {
  return page.getByTestId("group-row").filter({ hasText: description });
}

test.beforeEach(async () => {
  await resetDb();
});

test("edit entry — picking a suggestion fills the form, Speichern saves it", async ({
  page,
}) => {
  await seedEntries([
    { description: REFACTORING, ...span(1, 10, 30) },
    {
      description: DAILY,
      isAllgemeines: true,
      category: "Projektorganisation",
      ...span(1, 9, 20),
    },
  ]);
  const before = (await getEntries()).find((e) => e.description === REFACTORING)!;

  await page.goto("/");
  await groupRow(page, REFACTORING).getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog", { name: "Eintrag bearbeiten" });
  await dialog.getByLabel("Beschreibung").click();
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await dialog.getByRole("option", { name: /^Daily/ }).click();

  await expect(dialog.getByLabel("Beschreibung")).toHaveValue(DAILY);
  await expect(dialog.getByLabel(/Als Allgemein speichern/)).toBeChecked();
  // Picking does not save on its own.
  expect((await getEntries()).find((e) => e.id === before.id)?.description).toBe(
    REFACTORING,
  );

  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();

  const after = (await getEntries()).find((e) => e.id === before.id)!;
  expect(after.description).toBe(DAILY);
  expect(after.isAllgemeines).toBe(true);
  expect(after.category).toBe("Projektorganisation");
  expect(after.startedAt).toBe(before.startedAt);
  expect(after.endedAt).toBe(before.endedAt);
});

test("edit group — one save changes every entry of the group", async ({ page }) => {
  await seedEntries([
    { description: REFACTORING, ...span(1, 8, 30) },
    { description: REFACTORING, ...span(1, 10, 30) },
    { description: REFACTORING, ...span(1, 12, 30) },
    { description: DOKU, ...span(1, 14, 20) },
  ]);
  const before = (await getEntries()).filter((e) => e.description === REFACTORING);
  expect(before).toHaveLength(3);

  await page.goto("/");
  await groupRow(page, REFACTORING)
    .getByRole("button", { name: "Gruppe bearbeiten" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Gruppe bearbeiten" });
  await expect(dialog).toContainText("Gilt für 3 Einträge.");
  await expect(dialog.getByLabel("Beschreibung")).toHaveValue(REFACTORING);

  await dialog.getByLabel("Beschreibung").click();
  await dialog.getByRole("option", { name: /^Doku/ }).click();
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();

  const rows = await getEntries();
  for (const old of before) {
    const row = rows.find((e) => e.id === old.id)!;
    expect(row.description).toBe(DOKU);
    expect(row.isAllgemeines).toBe(false);
    expect(row.startedAt).toBe(old.startedAt);
    expect(row.endedAt).toBe(old.endedAt);
  }
  // Same text on the same day: the two groups are now one.
  await expect(page.getByTestId("group-row")).toHaveCount(1);
  await expect(groupRow(page, DOKU)).toContainText("4");
});

test("single entries have no group edit button", async ({ page }) => {
  await seedEntries([{ description: DOKU, ...span(1, 14, 20) }]);

  await page.goto("/");
  const row = groupRow(page, DOKU);
  await expect(row.getByRole("button", { name: "Bearbeiten" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Gruppe bearbeiten" })).toHaveCount(0);
});

test("kalender — the entry dialog shows the suggestions too", async ({ page }) => {
  await seedEntries([
    { description: REFACTORING, ...span(0, 1, 30) },
    { description: DOKU, ...span(0, 2, 30) },
  ]);

  await page.goto("/kalender");
  // A Kalender block is named by its issue key.
  await page.getByRole("button", { name: /^TXR-1 / }).click();
  const dialog = page.getByRole("dialog", { name: "Eintrag bearbeiten" });
  await dialog.getByLabel("Beschreibung").click();
  await expect(dialog.getByRole("option")).toHaveCount(2);
});
