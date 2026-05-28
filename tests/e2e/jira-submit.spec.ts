import { expect, test } from "@playwright/test";
import { getEntries, resetDb, seedEntries, seedSettings } from "./helpers/db";
import { expectWorklog, getReceived, resetMock } from "./helpers/jira-mock";

test.beforeEach(async () => {
  await resetDb();
  await resetMock();
  // The baseline enables the "Allgemeines" summary worklog, which would post a
  // second worklog (to the summary issue) per submission and muddy the
  // /__mock/received assertions. These specs exercise the core submit flow, so
  // a single concrete entry should produce exactly one POST.
  await seedSettings({ addAllgemeinesSummary: false });
});

/** ISO timestamp for today at the given local clock time. */
function todayAtIso(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

test("jira submit — happy path books the day and marks the entry submitted", async ({
  page,
}) => {
  const startIso = todayAtIso(9);
  await seedEntries([
    {
      description: "TEST-123 implement feature",
      startedAt: startIso,
      endedAt: todayAtIso(10),
    },
  ]);
  await expectWorklog({ issueKey: "TEST-123", status: 201 });

  await page.goto("/");

  const row = page.getByTestId("entry-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("offen")).toBeVisible();

  await page.getByTestId("open-jira-submit").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("TEST-123")).toBeVisible();
  await expect(dialog.getByText("1h 0m")).toBeVisible();

  await dialog.getByTestId("jira-submit-confirm").click();
  await expect(dialog.getByText(/Erfolgreich gebucht/)).toBeVisible();

  // The header "×" close button also has the accessible name "Schließen", so
  // target the footer button by its visible text to stay unambiguous.
  await dialog.locator("button", { hasText: "Schließen" }).click();
  await expect(page.getByTestId("entry-row").getByText("gebucht")).toBeVisible();

  const entries = await getEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0].submittedAt).not.toBeNull();
  expect(entries[0].jiraIssueKey).toBe("TEST-123");

  // The mock recorded exactly what the app sent to Jira.
  const posts = (await getReceived()).filter(
    (r) =>
      r.method === "POST" &&
      r.path === "/rest/api/2/issue/TEST-123/worklog",
  );
  expect(posts).toHaveLength(1);

  const body = JSON.parse(posts[0].body) as {
    timeSpent: string;
    started: string;
    comment?: string;
  };
  expect(body.timeSpent).toBe("1h 0m");
  expect(body.started).toBe(startIso.replace("Z", "+0000"));
  expect(body.comment).toBe("implement feature");

  const auth = posts[0].headers["authorization"];
  expect(typeof auth).toBe("string");
  expect(
    Buffer.from(String(auth).replace(/^Basic /, ""), "base64").toString("utf8"),
  ).toBe("tester@example.com:test-token");
});

test("jira submit — a Jira error leaves the entry unsubmitted", async ({
  page,
}) => {
  await seedEntries([
    {
      description: "TEST-999 will fail",
      startedAt: todayAtIso(9),
      endedAt: todayAtIso(10),
    },
  ]);
  await expectWorklog({
    issueKey: "TEST-999",
    status: 400,
    body: { errorMessages: ["Issue does not exist"] },
  });

  await page.goto("/");

  await page.getByTestId("open-jira-submit").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("TEST-999")).toBeVisible();

  await dialog.getByTestId("jira-submit-confirm").click();
  await expect(dialog.getByText("Buchung mit Fehlern.")).toBeVisible();
  await expect(dialog.getByText(/Jira lehnte die Anfrage ab/)).toBeVisible();

  const entries = await getEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0].submittedAt).toBeNull();
  expect(entries[0].jiraIssueKey).toBeNull();

  // Closing the failed dialog leaves the entry openly bookable.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByTestId("entry-row").getByText("offen")).toBeVisible();
  await expect(page.getByTestId("open-jira-submit")).toBeVisible();
});
