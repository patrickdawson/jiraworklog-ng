// Jira worklog integration — Jira Cloud (Basic: Atlassian email + API token).

import { formatJiraFetchError } from "@/lib/jira/fetch-error";
import { formatJiraHttpErrorBody } from "@/lib/jira/format-http-error";
import {
  buildJiraApiUrl,
  jiraAuthHeader,
  JIRA_JSON_HEADERS,
  type JiraAuth,
} from "@/lib/jira/http";

export type { JiraAuth };

/** Jira-compatible `started` timestamp, e.g. `2026-05-19T10:00:00.000+0000`. */
export function toJiraTimestamp(date: Date): string {
  return date.toISOString().replace("Z", "+0000");
}

export type PostWorklogParams = {
  jiraUrl: string;
  auth: JiraAuth;
  issueKey: string;
  /** Jira `timeSpent` string, e.g. `"1h 30m"`. */
  timeSpent: string;
  /** Start of the worklog. */
  started: Date;
  comment: string | undefined;
};

async function assertOkResponse(
  res: Response,
  context: string,
): Promise<void> {
  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new Error(
      `Redirect erkannt (z.B. http→https). Bitte Jira-URL direkt auf HTTPS setzen. (${context})`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Jira lehnte die Anfrage ab (${context}): ${formatJiraHttpErrorBody(
        res.status,
        res.statusText,
        detail,
      )}`,
    );
  }
}

export async function postWorklogToJira(
  params: PostWorklogParams,
): Promise<void> {
  const { jiraUrl, auth, issueKey, timeSpent, started, comment } = params;
  const url = buildJiraApiUrl(jiraUrl, `/issue/${issueKey}/worklog`);

  const body: Record<string, string> = {
    timeSpent,
    started: toJiraTimestamp(started),
  };
  if (comment?.trim()) {
    body.comment = comment.trim();
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        ...JIRA_JSON_HEADERS,
        Authorization: jiraAuthHeader(auth),
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`${formatJiraFetchError(err)} (${issueKey})`, { cause: err });
  }

  await assertOkResponse(res, issueKey);
}

export type CredentialCheckResult =
  | { ok: true; displayName: string }
  | { ok: false; reason: string };

/** Validates credentials against `GET /rest/api/2/myself`. */
export async function checkCredentials(
  jiraUrl: string,
  auth: JiraAuth,
): Promise<CredentialCheckResult> {
  const url = buildJiraApiUrl(jiraUrl, "/myself");

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "manual",
      headers: {
        Authorization: jiraAuthHeader(auth),
        Accept: JIRA_JSON_HEADERS.Accept,
      },
    });
  } catch (err) {
    return { ok: false, reason: formatJiraFetchError(err) };
  }

  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    return {
      ok: false,
      reason:
        "Redirect erkannt (z.B. http→https). Bitte Jira-URL direkt auf HTTPS setzen.",
    };
  }
  if (res.status === 401) {
    return { ok: false, reason: "E-Mail / API-Token ist falsch." };
  }
  if (res.status === 403) {
    return {
      ok: false,
      reason:
        "Jira hat das Konto abgelehnt. Bitte im Browser anmelden und ggf. Captcha lösen.",
    };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      reason: formatJiraHttpErrorBody(res.status, res.statusText, detail),
    };
  }

  const data = (await res.json().catch(() => ({}))) as {
    displayName?: string;
  };
  return { ok: true, displayName: data.displayName ?? "unbekannt" };
}
