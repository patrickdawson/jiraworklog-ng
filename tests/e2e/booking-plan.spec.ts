import { expect, test, type Page } from "@playwright/test";
import { resetDb, seedEntries, seedSettings } from "./helpers/db";
import type { NewTimeEntry } from "../../src/db/schema";

/**
 * The per-day booking plan decides which rows get posted to Jira. It used to
 * read every entry ever tracked and narrow to one day in JS; it now asks SQL for
 * a half-open local-day range. That is the same set only if the range bounds are
 * built from local midnight — so the cross-midnight case is the real subject
 * here, not the happy path.
 *
 * `previewDayBooking` is preview-only, so nothing is sent to the Jira mock.
 */

function at(daysAgo: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function entry(
  description: string,
  start: Date,
  lengthMin: number,
): NewTimeEntry {
  return {
    description,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + lengthMin * 60_000).toISOString(),
    submittedAt: null,
  };
}

/**
 * Opens the day section's own "Nach Jira buchen" dialog and returns it.
 * Assertions must be scoped to the dialog: the same issue key also appears in
 * the entry list behind it.
 */
async function openDayPlan(page: Page, dayKeyIso: string) {
  await page
    .locator(`[data-day-section="${dayKeyIso}"]`)
    .getByRole("button", { name: "Nach Jira buchen" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Worklogs \(\d+\)/)).toBeVisible();
  return dialog;
}

function dayKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test.beforeEach(async () => {
  await resetDb();
  await seedSettings({ autoPauseEnabled: false, breaks: "[]" });
});

test("booking plan — a day plans exactly its own entries", async ({ page }) => {
  const target = at(1, 10, 0);
  const other = at(2, 10, 0);
  await seedEntries([
    entry("TXR-1 Erste Aufgabe", target, 60),
    entry("TXR-2 Zweite Aufgabe", target, 30),
    entry("TXR-9 Anderer Tag", other, 60),
  ]);

  await page.goto("/");
  const dialog = await openDayPlan(page, dayKeyOf(target));

  await expect(dialog.getByText("Worklogs (2)")).toBeVisible();
  await expect(dialog.getByText("TXR-1", { exact: true })).toBeVisible();
  await expect(dialog.getByText("TXR-2", { exact: true })).toBeVisible();
  await expect(dialog.getByText("TXR-9", { exact: true })).toHaveCount(0);
});

test("booking plan — an entry just after local midnight is planned on its own day", async ({
  page,
}) => {
  // 00:30 local is the previous *UTC* day east of Greenwich. A UTC-day bound
  // drops it from the plan entirely, which would silently under-book the day.
  const justAfterMidnight = at(1, 0, 30);
  await seedEntries([
    entry("TXR-3 Kurz nach Mitternacht", justAfterMidnight, 60),
    entry("TXR-4 Am selben Tag", at(1, 14, 0), 60),
  ]);

  await page.goto("/");
  const dialog = await openDayPlan(page, dayKeyOf(justAfterMidnight));

  await expect(dialog.getByText("Worklogs (2)")).toBeVisible();
  await expect(dialog.getByText("TXR-3", { exact: true })).toBeVisible();
  await expect(dialog.getByText("TXR-4", { exact: true })).toBeVisible();
});

test("booking plan — a session crossing midnight books under its start day", async ({
  page,
}) => {
  // Starts 23:40 on day D, ends 00:50 on day D+1. It belongs to D, because
  // every other part of the app also buckets by the START timestamp.
  const start = at(2, 23, 40);
  await seedEntries([entry("TXR-5 Nachtschicht", start, 70)]);

  await page.goto("/");
  const dialog = await openDayPlan(page, dayKeyOf(start));

  await expect(dialog.getByText("Worklogs (1)")).toBeVisible();
  await expect(dialog.getByText("TXR-5", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1h 10m")).toBeVisible();
});

test("booking plan — already submitted entries are not planned again", async ({
  page,
}) => {
  const target = at(1, 10, 0);
  const submitted = entry("TXR-6 Schon gebucht", target, 60);
  await seedEntries([
    { ...submitted, submittedAt: new Date().toISOString() },
    entry("TXR-7 Noch offen", at(1, 12, 0), 45),
  ]);

  await page.goto("/");
  const dialog = await openDayPlan(page, dayKeyOf(target));

  await expect(dialog.getByText("Worklogs (1)")).toBeVisible();
  await expect(dialog.getByText("TXR-7", { exact: true })).toBeVisible();
  await expect(dialog.getByText("TXR-6", { exact: true })).toHaveCount(0);
});
