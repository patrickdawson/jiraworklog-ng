import { expect, test, type Page } from "@playwright/test";
import { getEntries, resetDb, seedEntries } from "./helpers/db";
import type { NewTimeEntry } from "../../src/db/schema";

const REFACTORING = "Refactoring TXR-1 Aufräumen";
const DOKU = "Doku TXR-2 Text";
const DAILY = "Daily";
const URALT = "Uralt TEST-1 Alt";

/**
 * A finished entry starting at `hour:00` local time, `daysAgo` days back.
 * Timestamps are relative because the suggestion window is relative; a
 * hard-coded date would silently fall out of it.
 */
function span(daysAgo: number, hour: number, minutes: number) {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + minutes * 60_000);
  return { startedAt: start.toISOString(), endedAt: end.toISOString() };
}

// BASELINE has autoPauseEnabled: false and breaks: "[]", so the totals below
// are exact wall clock and the duration assertions are stable.
const SEED: NewTimeEntry[] = [
  { description: REFACTORING, ...span(1, 10, 30) },
  { description: REFACTORING, ...span(2, 10, 30) },
  { description: REFACTORING, ...span(3, 10, 30) },
  { description: DOKU, ...span(1, 12, 20) },
  {
    description: DAILY,
    isAllgemeines: true,
    category: "Projektorganisation",
    ...span(1, 9, 20),
  },
  {
    description: DAILY,
    isAllgemeines: true,
    category: "Projektorganisation",
    ...span(2, 9, 20),
  },
  // Outside the 30-day window — must never be suggested.
  { description: URALT, ...span(45, 10, 30) },
];

const timerInput = (page: Page) => page.getByPlaceholder(/Woran arbeitest du/);

/** The entry that is currently being tracked, if any. */
async function runningRow() {
  const rows = await getEntries();
  return rows.find((r) => r.endedAt === null);
}

async function openRecents(page: Page) {
  await timerInput(page).click();
  await expect(page.getByRole("listbox")).toBeVisible();
}

test.beforeEach(async () => {
  await resetDb();
  await seedEntries(SEED);
});

test("recents — ranked most-recent first, merged across days", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");
  await openRecents(page);

  const options = page.getByRole("option");
  await expect(options).toHaveCount(3);

  // Ranking is by last use, not by count: yesterday's Doku (12:00) outranks
  // Refactoring (10:00, but used 3×), which outranks Daily (09:00).
  await expect(options.nth(0)).toContainText(DOKU);
  await expect(options.nth(1)).toContainText(REFACTORING);
  await expect(options.nth(2)).toContainText(DAILY);
  await expect(options.nth(2)).toContainText("Allgemein · Projektorganisation");

  // Three days still merge into one suggestion: 3 entries, 90 minutes.
  await expect(options.nth(1)).toContainText("3×");
  await expect(options.nth(1)).toContainText("01:30:00");

  // The 45-day-old entry is out of the window.
  await expect(page.getByRole("option", { name: /Uralt/ })).toHaveCount(0);

  expect(consoleErrors, "unexpected console/page errors").toEqual([]);
});

test("recents — typing filters the list", async ({ page }) => {
  await page.goto("/");
  await openRecents(page);

  await timerInput(page).fill("doku");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(page.getByRole("option").first()).toContainText(DOKU);

  await timerInput(page).fill("gibtesnicht");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.getByText("Keine passenden Einträge")).toBeVisible();
});

test("recents — keyboard picks a suggestion and starts the timer", async ({
  page,
}) => {
  await page.goto("/");
  await timerInput(page).click();
  await timerInput(page).fill("doku");
  await expect(page.getByRole("option")).toHaveCount(1);

  await timerInput(page).press("ArrowDown");
  await timerInput(page).press("Enter");

  await expect(
    page.getByRole("button", { name: "Timer stoppen" }),
  ).toBeVisible();
  await expect(timerInput(page)).toHaveValue(DOKU);

  await expect
    .poll(async () => (await runningRow())?.description)
    .toBe(DOKU);
});

test("recents — Escape closes the list without stopping anything", async ({
  page,
}) => {
  await page.goto("/");
  await openRecents(page);
  await timerInput(page).press("ArrowDown");
  await timerInput(page).press("Enter");
  await expect(
    page.getByRole("button", { name: "Timer stoppen" }),
  ).toBeVisible();

  await openRecents(page);
  await timerInput(page).press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Timer stoppen" }),
  ).toBeVisible();
});

test("recents — a running description still commits when focus leaves", async ({
  page,
}) => {
  await page.goto("/");
  await openRecents(page);
  await timerInput(page).press("ArrowDown");
  await timerInput(page).press("Enter");
  await expect(
    page.getByRole("button", { name: "Timer stoppen" }),
  ).toBeVisible();

  const edited = "Neue Beschreibung TXR-3";
  await timerInput(page).fill(edited);
  await page.getByRole("heading", { name: "Buchen", level: 1 }).click();

  await expect
    .poll(async () => (await runningRow())?.description)
    .toBe(edited);
});

test("recents — picking a suggestion never writes the filter text to the old entry", async ({
  page,
}) => {
  // Seeded two hours back so the 1-minute discard rule keeps it on stop.
  const ORIGINAL = "Laufend TXR-9 Text";
  await seedEntries([
    {
      description: ORIGINAL,
      startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    },
  ]);

  await page.goto("/");
  await expect(timerInput(page)).toHaveValue(ORIGINAL);
  const runningId = (await runningRow())!.id;

  await openRecents(page);
  // "doku" is a filter here, not a description. It must never reach the DB.
  await timerInput(page).fill("doku");
  await page.getByRole("option").first().click();
  await expect(timerInput(page)).toHaveValue(DOKU);

  await expect
    .poll(async () => (await runningRow())?.description)
    .toBe(DOKU);

  const rows = await getEntries();
  const old = rows.find((r) => r.id === runningId);
  expect(old?.description).toBe(ORIGINAL);
  expect(old?.endedAt).not.toBeNull();
});

test("recents — empty history hides the dropdown entirely", async ({
  page,
}) => {
  await resetDb();
  await page.goto("/");

  await expect(
    page.getByRole("button", { name: "Zuletzt verwendete Einträge anzeigen" }),
  ).toHaveCount(0);
  await timerInput(page).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});
