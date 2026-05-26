import type { SettingsRow } from "@/db/schema";
import type { JiraAuth } from "@/lib/jira/worklog";

/** Parses the `jiraProjectKeys` JSON column into a clean list. */
export function parseProjectKeys(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
      .map((k) => k.trim().toUpperCase());
  } catch {
    return [];
  }
}

/** API token from settings (Cloud: stored in `jira_token`, legacy in `jira_password`). */
function resolveApiToken(s: SettingsRow): string | null {
  const token = s.jiraToken?.trim();
  if (token) return token;
  return s.jiraPassword?.trim() || null;
}

/** Builds Jira Cloud auth (Atlassian email + API token), or `null` if incomplete. */
export function deriveJiraAuth(s: SettingsRow): JiraAuth | null {
  const user = s.jiraUser?.trim();
  const password = resolveApiToken(s);
  if (!user || !password) return null;
  return { user, password };
}

/** Whether Jira is configured well enough to attempt a booking. */
export function isJiraConfigured(s: SettingsRow): boolean {
  return Boolean(s.jiraUrl?.trim()) && deriveJiraAuth(s) !== null;
}
