// Port of tests/e2e/settings.spec.ts.
import { getSettingsRow, resetDb } from "../support/db.ts";
import { expect, page } from "../support/page.ts";

describe("settings", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("settings — save round-trips to DB and survives reload", async () => {
    await page.goto("/einstellungen");

    const newUrl = "https://playwright.atlassian.net";
    const newEmail = "playwright@example.com";
    const newToken = "secret-token-xyz";

    await page.getByLabel("Jira-URL").fill(newUrl);
    await page.getByLabel("Atlassian-E-Mail").fill(newEmail);
    await page.getByLabel("API-Token").fill(newToken);
    await page.getByLabel("Saldo-Korridor: Mitte (h)").fill("-10");
    await page.getByLabel("Saldo-Korridor: Spanne ± (h)").fill("25");

    // Add a fresh project key so we know the array path also persists.
    const newKeyInput = page.getByPlaceholder("z.B. TXR");
    await newKeyInput.fill("PW");
    await newKeyInput.press("Enter");
    await expect(page.getByRole("button", { name: "PW entfernen" })).toBeVisible();

    await page.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Einstellungen gespeichert.")).toBeVisible();

    // DB reflects the change.
    const after = await getSettingsRow();
    expect(after.jiraUrl).toBe(newUrl);
    expect(after.jiraUser).toBe(newEmail);
    expect(after.jiraToken).toBe(newToken);
    expect(JSON.parse(after.jiraProjectKeys) as string[]).toContain("PW");
    expect(after.overtimeCorridorCenterHours).toBe(-10);
    expect(after.overtimeCorridorRangeHours).toBe(25);

    // Reload — values come back from the app.
    await page.reload();
    await expect(page.getByLabel("Jira-URL")).toHaveValue(newUrl);
    await expect(page.getByLabel("Atlassian-E-Mail")).toHaveValue(newEmail);
    await expect(page.getByLabel("API-Token")).toHaveValue(newToken);
    await expect(page.getByLabel("Saldo-Korridor: Mitte (h)")).toHaveValue("-10");
    await expect(page.getByRole("button", { name: "PW entfernen" })).toBeVisible();
  });

  it("settings — save bar shows only with unsaved changes", async () => {
    await page.goto("/einstellungen");
    const save = page.getByRole("button", { name: "Speichern" });
    await expect(save).toBeHidden();

    const url = page.getByLabel("Jira-URL");
    const before = await url.inputValue();
    await url.fill("https://discard-me.atlassian.net");
    await expect(page.getByText("Ungespeicherte Änderungen")).toBeVisible();
    await expect(save).toBeInViewport();

    await page.getByRole("button", { name: "Verwerfen" }).click();
    await expect(url).toHaveValue(before);
    await expect(save).toBeHidden();
  });

  it("settings — leaving with unsaved changes asks first", async () => {
    await page.goto("/einstellungen");
    await page.getByLabel("Jira-URL").fill("https://unsaved.atlassian.net");

    await page.getByRole("link", { name: "Kalender" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await expect(page).toHaveURL(/\/einstellungen$/);

    await page.getByRole("link", { name: "Kalender" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Verwerfen" }).click();
    await expect(page).toHaveURL(/\/kalender$/);
  });
});
