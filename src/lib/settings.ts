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

/** Builds the Jira auth object from settings, or `null` if incomplete. */
export function deriveJiraAuth(s: SettingsRow): JiraAuth | null {
  if (s.jiraAuthMode === "token") {
    return s.jiraToken ? { mode: "token", token: s.jiraToken } : null;
  }
  return s.jiraUser && s.jiraPassword
    ? { mode: "basic", user: s.jiraUser, password: s.jiraPassword }
    : null;
}

/** Whether Jira is configured well enough to attempt a booking. */
export function isJiraConfigured(s: SettingsRow): boolean {
  return Boolean(s.jiraUrl) && deriveJiraAuth(s) !== null;
}
