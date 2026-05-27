import { expect, test } from "@playwright/test";
import { getSettingsRow, resetDb } from "./helpers/db";

test.beforeEach(async () => {
  await resetDb();
});

test("settings — save round-trips to DB and survives reload", async ({
  page,
}) => {
  await page.goto("/einstellungen");

  const newUrl = "https://playwright.atlassian.net";
  const newEmail = "playwright@example.com";
  const newToken = "secret-token-xyz";

  await page.getByLabel("Jira-URL").fill(newUrl);
  await page.getByLabel("Atlassian-E-Mail").fill(newEmail);
  await page.getByLabel("API-Token").fill(newToken);

  // Add a fresh project key so we know the array path also persists.
  const newKeyInput = page.getByPlaceholder("z.B. TXR");
  await newKeyInput.fill("PW");
  await newKeyInput.press("Enter");
  await expect(
    page.getByRole("button", { name: "PW entfernen" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Einstellungen gespeichert.")).toBeVisible();

  // DB reflects the change.
  const after = await getSettingsRow();
  expect(after.jiraUrl).toBe(newUrl);
  expect(after.jiraUser).toBe(newEmail);
  expect(after.jiraToken).toBe(newToken);
  expect(JSON.parse(after.jiraProjectKeys) as string[]).toContain("PW");

  // Reload — values come back from the server.
  await page.reload();
  await expect(page.getByLabel("Jira-URL")).toHaveValue(newUrl);
  await expect(page.getByLabel("Atlassian-E-Mail")).toHaveValue(newEmail);
  await expect(page.getByLabel("API-Token")).toHaveValue(newToken);
  await expect(
    page.getByRole("button", { name: "PW entfernen" }),
  ).toBeVisible();
});
