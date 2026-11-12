/** Jira Cloud REST API base path. */
export const JIRA_REST_API_PREFIX = "/rest/api/2";

export function trimJiraUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** The page of an issue in the Jira web UI: `${jiraUrl}/browse/${issueKey}`. */
export function jiraBrowseUrl(jiraUrl: string, issueKey: string): string {
  return `${trimJiraUrl(jiraUrl)}/browse/${encodeURIComponent(issueKey)}`;
}

/** `${jiraUrl}/rest/api/2${path}` — path must start with `/`. */
export function buildJiraApiUrl(jiraUrl: string, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${trimJiraUrl(jiraUrl)}${JIRA_REST_API_PREFIX}${normalized}`;
}
