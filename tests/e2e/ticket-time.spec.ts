import { expect, test } from "@playwright/test";
import { MOCK_JIRA_URL, resetDb, seedEntries } from "./helpers/db";

/**
 * "Zeit pro Ticket" on the Auswertung: tickets and Allgemeines in separate
 * sections, an expandable "Rest" bar, the entries behind a bar, and issue keys
 * that link to Jira.
 */

/** Local wall-clock time on 2026-09-14 + `day`, as ISO. */
const at = (day: number, h: number, m = 0) =>
  new Date(2026, 8, 14 + day, h, m).toISOString();

const WEEK = "/auswertung?range=week&anchor=2026-09-15";

test.beforeEach(async () => {
  await resetDb();
});

test("ticket time — sections, drilldown and Jira link", async ({ page }) => {
  await seedEntries([
    { description: "Fix TEST-1 a", startedAt: at(1, 9), endedAt: at(1, 10) },
    { description: "Fix TEST-1 b", startedAt: at(2, 9), endedAt: at(2, 10) },
    {
      description: "Krank",
      isAllgemeines: true,
      category: "Projektorganisation",
      startedAt: at(1, 10),
      endedAt: at(1, 11),
    },
  ]);

  await page.goto(WEEK);
  const tickets = page.getByRole("region", { name: "Tickets" });
  const general = page.getByRole("region", { name: "Allgemeines" });
  await expect(tickets.getByTestId("group-bar")).toHaveCount(1);
  await expect(general.getByTestId("group-bar")).toHaveCount(1);
  // Shares stay relative to the whole range: 2 of 3 hours.
  await expect(tickets.getByTestId("group-bar-percent")).toHaveText("67 %");
  await expect(general.getByTestId("group-bar-percent")).toHaveText("33 %");

  const link = tickets.getByRole("link", { name: "TEST-1" });
  await expect(link).toHaveAttribute("href", `${MOCK_JIRA_URL}/browse/TEST-1`);
  await expect(link).toHaveAttribute("target", "_blank");

  const toggle = page.getByRole("button", {
    name: "Einträge zu TEST-1 anzeigen",
  });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const entries = tickets.getByTestId("group-entry");
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText("Fix TEST-1 b");
  await expect(entries.first()).toContainText("09:00–10:00");
  await expect(general.getByTestId("group-entry")).toHaveCount(0);

  await toggle.click();
  await expect(entries).toHaveCount(0);
});

test("ticket time — the Rest bar opens the remaining tickets", async ({
  page,
}) => {
  // 14 tickets with distinct durations, so the order is fixed.
  await seedEntries(
    Array.from({ length: 14 }, (_, i) => ({
      description: `Work TEST-${i + 1}`,
      startedAt: at(1, 0, 0),
      endedAt: at(1, 0, 60 + (14 - i) * 5),
    })),
  );

  await page.goto(WEEK);
  const tickets = page.getByRole("region", { name: "Tickets" });
  await expect(tickets.getByTestId("group-bar")).toHaveCount(12);
  await page.getByRole("button", { name: "Rest (2) aufklappen" }).click();
  await expect(tickets.getByTestId("group-bar")).toHaveCount(14);
  await expect(tickets.getByTestId("group-bar-rest")).toHaveCount(0);

  await page.getByRole("button", { name: "Weniger anzeigen" }).click();
  await expect(tickets.getByTestId("group-bar")).toHaveCount(12);
});

test("ticket time — a bar's entries load in pages of 20", async ({ page }) => {
  // 45 ten-minute entries on one ticket, spread over two days.
  await seedEntries(
    Array.from({ length: 45 }, (_, i) => ({
      description: `Work TEST-1 #${i + 1}`,
      startedAt: at(1 + (i % 2), 6, i * 10),
      endedAt: at(1 + (i % 2), 6, i * 10 + 10),
    })),
  );

  await page.goto(WEEK);
  await page.getByRole("button", { name: "Einträge zu TEST-1 anzeigen" }).click();
  const entries = page.getByTestId("group-entry");
  const count = page.getByTestId("group-entries-count");
  const more = page.getByRole("button", { name: "Weitere laden" });

  await expect(entries).toHaveCount(20);
  await expect(count).toHaveText("20 von 45 Einträgen");
  await more.click();
  await expect(entries).toHaveCount(40);
  await expect(count).toHaveText("40 von 45 Einträgen");
  await more.click();
  await expect(entries).toHaveCount(45);
  await expect(more).toHaveCount(0);
});

test("issue keys on the Buchen page link to Jira", async ({ page }) => {
  await seedEntries([
    { description: "Fix TEST-1 a", startedAt: at(1, 9), endedAt: at(1, 10) },
  ]);

  await page.goto("/?days=all");
  await expect(
    page.getByTestId("group-row").getByRole("link", { name: "TEST-1" }),
  ).toHaveAttribute("href", `${MOCK_JIRA_URL}/browse/TEST-1`);
});
