// Einstellungen → Desktop → Autostart writes the current user's Run key.
// That key is real, and on a developer machine it holds the installed app's
// autostart, so this runs only on CI runners (fresh machine every time).
import { APP_EXE } from "../support/paths.ts";
import { expect, page } from "../support/page.ts";
import { deleteRunValue, runValue } from "../support/registry.ts";

const onCi = process.env.CI === "true";
const NAME = "JiraWorklog";

describe("autostart", () => {
  (onCi ? it : it.skip)("autostart — the checkbox writes and removes the Run value", async () => {
    expect(runValue(NAME)).toBeNull();
    try {
      await page.goto("/einstellungen");
      const box = page.getByLabel("JiraWorklog automatisch beim Windows-Anmelden starten");
      await expect(box).toBeChecked({ checked: false });

      await box.check();
      // tauri-plugin-autostart: the unquoted exe path plus one space.
      await expect
        .poll(async () => runValue(NAME)?.trimEnd().toLowerCase() ?? null)
        .toBe(APP_EXE.toLowerCase());
      // Never for all users, also when the app runs elevated (as on CI).
      expect(runValue(NAME, "HKLM")).toBeNull();

      await page.reload();
      await expect(page.getByLabel("JiraWorklog automatisch beim Windows-Anmelden starten")).toBeChecked();

      await page.getByLabel("JiraWorklog automatisch beim Windows-Anmelden starten").uncheck();
      await expect.poll(async () => runValue(NAME)).toBe(null);
    } finally {
      deleteRunValue(NAME);
    }
  });
});
