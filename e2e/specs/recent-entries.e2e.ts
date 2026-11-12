// Port of tests/e2e/recent-entries.spec.ts.
import { getEntries, type NewTimeEntry, resetDb, seedEntries } from "../support/db.ts";
import { expect, page } from "../support/page.ts";

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
  { description: DAILY, isAllgemeines: true, category: "Projektorganisation", ...span(1, 9, 20) },
  { description: DAILY, isAllgemeines: true, category: "Projektorganisation", ...span(2, 9, 20) },
  // Outside the 30-day window — must never be suggested.
  { description: URALT, ...span(45, 10, 30) },
];

const timerInput = () => page.getByPlaceholder(/Woran arbeitest du/);

/** The entry that is currently being tracked, if any. */
async function runningRow() {
  const rows = await getEntries();
  return rows.find((r) => r.endedAt === null);
}

async function openRecents() {
  await timerInput().click();
  await expect(page.getByRole("listbox")).toBeVisible();
}

describe("recent entries", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEntries(SEED);
  });

  it("recents — ranked most-recent first, merged across days", async () => {
    const mark = page.consoleMark();

    await page.goto("/");
    await openRecents();

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

    expect(await page.consoleErrorsSince(mark), "unexpected console/page errors").toEqual([]);
  });

  it("recents — typing filters the list", async () => {
    await page.goto("/");
    await openRecents();

    await timerInput().fill("doku");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option").first()).toContainText(DOKU);

    await timerInput().fill("gibtesnicht");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(page.getByText("Keine passenden Einträge")).toBeVisible();
  });

  it("recents — keyboard picks a suggestion and starts the timer", async () => {
    await page.goto("/");
    await timerInput().click();
    await timerInput().fill("doku");
    await expect(page.getByRole("option")).toHaveCount(1);

    await timerInput().press("ArrowDown");
    await timerInput().press("Enter");

    await expect(page.getByRole("button", { name: "Timer stoppen" })).toBeVisible();
    await expect(timerInput()).toHaveValue(DOKU);

    await expect.poll(async () => (await runningRow())?.description).toBe(DOKU);
  });

  it("recents — Escape closes the list without stopping anything", async () => {
    await page.goto("/");
    await openRecents();
    await timerInput().press("ArrowDown");
    await timerInput().press("Enter");
    await expect(page.getByRole("button", { name: "Timer stoppen" })).toBeVisible();

    await openRecents();
    await timerInput().press("Escape");
    await expect(page.getByRole("listbox")).toBeHidden();
    await expect(page.getByRole("button", { name: "Timer stoppen" })).toBeVisible();
  });

  it("recents — a running description still commits when focus leaves", async () => {
    await page.goto("/");
    await openRecents();
    await timerInput().press("ArrowDown");
    await timerInput().press("Enter");
    await expect(page.getByRole("button", { name: "Timer stoppen" })).toBeVisible();

    const edited = "Neue Beschreibung TXR-3";
    await timerInput().fill(edited);
    await page.getByRole("heading", { name: "Buchen", level: 1 }).click();

    await expect.poll(async () => (await runningRow())?.description).toBe(edited);
  });

  it("recents — picking a suggestion never writes the filter text to the old entry", async () => {
    // Seeded two hours back so the 1-minute discard rule keeps it on stop.
    const ORIGINAL = "Laufend TXR-9 Text";
    await seedEntries([
      { description: ORIGINAL, startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
    ]);

    await page.goto("/");
    await expect(timerInput()).toHaveValue(ORIGINAL);
    const runningId = (await runningRow())!.id;

    await openRecents();
    // "doku" is a filter here, not a description. It must never reach the DB.
    await timerInput().fill("doku");
    await page.getByRole("option").first().click();
    await expect(timerInput()).toHaveValue(DOKU);

    await expect.poll(async () => (await runningRow())?.description).toBe(DOKU);

    const rows = await getEntries();
    const old = rows.find((r) => r.id === runningId);
    expect(old?.description).toBe(ORIGINAL);
    expect(old?.endedAt).not.toBeNull();
  });

  it("recents — empty history hides the dropdown entirely", async () => {
    await resetDb();
    await page.goto("/");

    await expect(
      page.getByRole("button", { name: "Zuletzt verwendete Einträge anzeigen" }),
    ).toHaveCount(0);
    await timerInput().click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
});
