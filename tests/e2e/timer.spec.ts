import { expect, test } from "@playwright/test";
import { getEntries, resetDb } from "./helpers/db";

test.beforeEach(async () => {
  await resetDb();
});

/** `YYYY-MM-DDTHH:MM` in local time — the value a `datetime-local` input expects. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

test("timer — start, back-date the start, stop → entry persists with parsed issue key", async ({
  page,
}) => {
  await page.goto("/");

  const toggle = page.getByTestId("timer-toggle");
  await page.getByPlaceholder(/Woran arbeitest du/).fill("TEST-123 some work");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Timer stoppen");

  // Back-date the start by 30 min via the "Gestartet" edit field so the tracked
  // duration clears the 60-second discard threshold without a real wall-clock
  // wait. Waiting for the input to disappear confirms the server action landed.
  await page.getByTitle("Startzeit anpassen").click();
  const startInput = page.locator('input[type="datetime-local"]');
  await startInput.fill(toLocalInput(new Date(Date.now() - 30 * 60 * 1000)));
  await startInput.press("Enter");
  await expect(startInput).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Timer starten");

  const row = page.getByTestId("entry-row");
  await expect(row).toHaveCount(1);
  await expect(row.getByText("TEST-123", { exact: true })).toBeVisible();

  const entries = await getEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0].description).toBe("TEST-123 some work");
  expect(entries[0].endedAt).not.toBeNull();
});

test("timer — stopping under a minute discards the entry", async ({ page }) => {
  await page.goto("/");

  const toggle = page.getByTestId("timer-toggle");
  await page.getByPlaceholder(/Woran arbeitest du/).fill("TEST-456 too short");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Timer stoppen");

  // Stop immediately — well under MIN_TRACKED_SECONDS (60s), so it is discarded.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-label", "Timer starten");
  await expect(page.getByText(/Timer lief weniger als 1 Minute/)).toBeVisible();

  expect(await getEntries()).toHaveLength(0);
  await expect(page.getByTestId("entry-row")).toHaveCount(0);
});
