/** Jira Cloud REST API base path. */
export const JIRA_REST_API_PREFIX = "/rest/api/2";

export function trimJiraUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** `${jiraUrl}/rest/api/2${path}` — path must start with `/`. */
export function buildJiraApiUrl(jiraUrl: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${trimJiraUrl(jiraUrl)}${JIRA_REST_API_PREFIX}${normalized}`;
}

/** Jira Cloud: Atlassian account email + API token (Basic auth). */
export type JiraAuth = { user: string; password: string };

export function jiraAuthHeader(auth: JiraAuth): string {
  const encoded = Buffer.from(
    `${auth.user.trim()}:${auth.password.trim()}`,
  ).toString("base64");
  return `Basic ${encoded}`;
}

export const JIRA_JSON_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;
