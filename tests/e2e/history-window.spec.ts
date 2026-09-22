import { expect, test, type Page } from "@playwright/test";
import { resetDb, seedEntries, seedSettings } from "./helpers/db";

/**
 * The Buchen list only renders a window of recent days. These specs guard the
 * two things that can go wrong with that:
 *
 *  1. a figure that must cover the whole history silently becomes window-scoped
 *  2. a day bound gets built from a UTC day instead of a local one
 *
 * Both fail quietly in normal use, which is exactly why they are tested here.
 */

/**
 * A finished entry `daysAgo` days back, starting at local `hour:minute`.
 * Built from a LOCAL Date on purpose — the same way the app builds its bounds.
 * A UTC-constructed timestamp would hide the bug these specs exist to catch.
 */
function span(daysAgo: number, hour: number, minute: number, lengthMin: number) {
  const start = new Date();
  start.setDate(start.getDate() - daysAgo);
  start.setHours(hour, minute, 0, 0);
  const end = new Date(start.getTime() + lengthMin * 60_000);
  return { startedAt: start.toISOString(), endedAt: end.toISOString() };
}

const IN_WINDOW = "TXR-10 Innerhalb des Fensters";
const OLD = "TXR-20 Weit in der Vergangenheit";

const daySection = (page: Page) => page.locator("[data-day-section]");

test.beforeEach(async () => {
  await resetDb();
});

test("window — old entries are hidden by default and shown on demand", async ({
  page,
}) => {
  await seedEntries([
    { description: IN_WINDOW, ...span(1, 10, 0, 60) },
    { description: OLD, ...span(200, 10, 0, 60) },
  ]);

  await page.goto("/");
  await expect(page.getByText(IN_WINDOW)).toBeVisible();
  await expect(page.getByText(OLD)).toHaveCount(0);
  await expect(page.getByText(/1 älterer? Eintrag ausgeblendet/)).toBeVisible();

  await page.getByRole("link", { name: "Alles anzeigen" }).click();
  await expect(page).toHaveURL(/days=all/);
  await expect(page.getByText(OLD)).toBeVisible();
  await expect(page.getByText(IN_WINDOW)).toBeVisible();
});

test("window — the overtime balance covers the whole history, not the window", async ({
  page,
}) => {
  // Two identical 8h weekday-ish blocks, one inside the window and one far
  // outside it. If the balance were windowed, the two views would disagree.
  await seedEntries([
    { description: IN_WINDOW, ...span(1, 9, 0, 480) },
    { description: OLD, ...span(200, 9, 0, 480) },
  ]);

  await page.goto("/");
  const windowed = await page.getByText(/^[+−]\d+:\d{2}$/).first().textContent();

  await page.goto("/?days=all");
  const full = await page.getByText(/^[+−]\d+:\d{2}$/).first().textContent();

  expect(windowed).toBe(full);
});

test("window — the Jira button counts open entries outside the window too", async ({
  page,
}) => {
  // Both unsubmitted. The header button books across ALL days, so if its count
  // were windowed it would claim there is nothing to book while still booking
  // the old entry.
  await seedEntries([
    { description: IN_WINDOW, ...span(1, 10, 0, 60), submittedAt: null },
    { description: OLD, ...span(200, 10, 0, 60), submittedAt: null },
  ]);

  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Nach Jira buchen (2)" }),
  ).toBeVisible();
});

test("window — a timer started before the window still shows", async ({
  page,
}) => {
  const started = new Date();
  started.setDate(started.getDate() - 100);
  started.setHours(9, 0, 0, 0);
  await seedEntries([
    { description: "TXR-30 Sehr lange laufender Timer", startedAt: started.toISOString() },
  ]);

  await page.goto("/");
  // The running entry is read directly, not found by scanning the window.
  await expect(
    page.getByPlaceholder(/Woran arbeitest du/),
  ).toHaveValue("TXR-30 Sehr lange laufender Timer");
});

test("window — entries just after local midnight land on their local day", async ({
  page,
}) => {
  // The boundary case. A bound built as `"YYYY-MM-DD" + "T00:00:00.000Z"`
  // describes the UTC day; east of Greenwich that silently drops the 00:30
  // entry and pulls in a slice of the neighbouring day.
  await seedSettings({ autoPauseEnabled: false, breaks: "[]" });
  await seedEntries([
    { description: "TXR-40 Kurz nach Mitternacht", ...span(1, 0, 30, 60) },
    { description: "TXR-41 Kurz vor Mitternacht", ...span(1, 23, 30, 20) },
  ]);

  await page.goto("/");
  await expect(page.getByText("TXR-40 Kurz nach Mitternacht")).toBeVisible();
  await expect(page.getByText("TXR-41 Kurz vor Mitternacht")).toBeVisible();

  // Both started on the same local day, so they share one day section.
  await expect(daySection(page)).toHaveCount(1);
});
