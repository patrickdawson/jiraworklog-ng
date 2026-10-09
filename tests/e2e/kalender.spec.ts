import { expect, test } from "@playwright/test";
import { getEntries, resetDb, seedEntries, seedSettings } from "./helpers/db";

/**
 * The Kalender week view must mark time booked twice (overlap) and untracked
 * time between entries (gap). A configured break is not a gap.
 */

/** Local wall-clock time on Tuesday 2026-09-15, as ISO. */
const at = (h: number, m = 0) => new Date(2026, 8, 15, h, m).toISOString();

test.beforeEach(async () => {
  await resetDb();
  await seedSettings({
    breaks: JSON.stringify([{ start: "12:00", end: "12:30" }]),
  });
});

test("kalender — overlaps and gaps are marked, breaks are not gaps", async ({
  page,
}) => {
  await seedEntries([
    { description: "A", startedAt: at(9), endedAt: at(10, 30) },
    // 10:00–10:30 overlaps with A.
    { description: "B", startedAt: at(10), endedAt: at(12) },
    // 12:00–12:30 is the break: no gap.
    { description: "C", startedAt: at(12, 30), endedAt: at(13) },
    // 13:00–13:30 is a gap.
    { description: "D", startedAt: at(13, 30), endedAt: at(15) },
  ]);

  await page.goto("/kalender?anchor=2026-09-15");

  await expect(page.getByText("KW 38")).toBeVisible();
  await expect(page.getByTestId("kalender-entry")).toHaveCount(4);

  const summary = page.getByTestId("kalender-summary");
  await expect(summary).toContainText("1 Überlappung · 00:30");
  await expect(summary).toContainText("1 Lücke · 00:30");

  const tuesday = page.locator('[data-day="2026-09-15"]');
  await expect(tuesday.getByTestId("kalender-overlap")).toHaveCount(1);
  await expect(tuesday.getByTestId("kalender-gap")).toHaveCount(1);
  await expect(tuesday.getByTestId("kalender-gap")).toHaveAttribute(
    "title",
    /13:00–13:30/,
  );
});

test("kalender — back-to-back entries are neither overlap nor gap", async ({
  page,
}) => {
  await seedEntries([
    { description: "A", startedAt: at(9), endedAt: at(10) },
    { description: "B", startedAt: at(10), endedAt: at(11) },
  ]);

  await page.goto("/kalender?anchor=2026-09-15");

  const summary = page.getByTestId("kalender-summary");
  await expect(summary).toContainText("0 Überlappungen");
  await expect(summary).toContainText("0 Lücken");
});

test("kalender — clicking an entry opens the edit dialog and closes a gap", async ({
  page,
}) => {
  await seedEntries([
    { description: "A", startedAt: at(9), endedAt: at(10) },
    { description: "B", startedAt: at(10, 30), endedAt: at(11) },
  ]);

  await page.goto("/kalender?anchor=2026-09-15");
  const summary = page.getByTestId("kalender-summary");
  await expect(summary).toContainText("1 Lücke · 00:30");

  await page.getByRole("button", { name: /^A 09:00–10:00/ }).click();
  const dialog = page.getByRole("dialog", { name: "Eintrag bearbeiten" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Ende").fill("2026-09-15T10:30");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  await expect(dialog).toBeHidden();
  await expect(summary).toContainText("0 Lücken");
  const a = (await getEntries()).find((e) => e.description === "A");
  expect(a?.endedAt).toBe(at(10, 30));
});

test("kalender — the running entry is not editable here", async ({ page }) => {
  const started = new Date(Date.now() - 30 * 60_000);
  await seedEntries([
    { description: "Läuft", startedAt: started.toISOString(), endedAt: null },
  ]);

  await page.goto("/kalender");
  const block = page.getByTestId("kalender-entry");
  await expect(block).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Läuft/ })).toHaveCount(0);
  await block.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("kalender — clicking a gap opens the dialog prefilled with the gap", async ({
  page,
}) => {
  await seedEntries([
    { description: "A", startedAt: at(9), endedAt: at(10) },
    { description: "B", startedAt: at(10, 30), endedAt: at(11) },
  ]);

  await page.goto("/kalender?anchor=2026-09-15");
  const summary = page.getByTestId("kalender-summary");
  await expect(summary).toContainText("1 Lücke · 00:30");

  await page.getByTestId("kalender-gap").click();
  const dialog = page.getByRole("dialog", { name: "Eintrag anlegen" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Beginn")).toHaveValue("2026-09-15T10:00");
  await expect(dialog.getByLabel("Ende")).toHaveValue("2026-09-15T10:30");
  await expect(dialog.getByRole("button", { name: "Löschen" })).toHaveCount(0);

  await dialog.getByLabel("Beschreibung").fill("Lücke gefüllt");
  await dialog.getByRole("button", { name: "Speichern" }).click();

  await expect(dialog).toBeHidden();
  await expect(summary).toContainText("0 Lücken");
  const created = (await getEntries()).find((e) => e.description === "Lücke gefüllt");
  expect(created?.startedAt).toBe(at(10));
  expect(created?.endedAt).toBe(at(10, 30));
});
