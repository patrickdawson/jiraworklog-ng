// Jira worklog integration — ported from jiraworklog/lib/{jira-worklog,auth}.ts,
// using fetch instead of axios.

import { formatJiraFetchError } from "@/lib/jira/fetch-error";

export type JiraAuth =
  | { mode: "token"; token: string }
  | { mode: "basic"; user: string; password: string };

function authHeader(auth: JiraAuth): string {
  if (auth.mode === "token") {
    return `Bearer ${auth.token.trim()}`;
  }
  const encoded = Buffer.from(`${auth.user}:${auth.password}`).toString(
    "base64",
  );
  return `Basic ${encoded}`;
}

function trimUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

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

export async function postWorklogToJira(
  params: PostWorklogParams,
): Promise<void> {
  const { jiraUrl, auth, issueKey, timeSpent, started, comment } = params;
  const url = `${trimUrl(jiraUrl)}/rest/api/latest/issue/${issueKey}/worklog`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(auth),
      },
      body: JSON.stringify({
        timeSpent,
        started: toJiraTimestamp(started),
        comment,
      }),
    });
  } catch (err) {
    throw new Error(`${formatJiraFetchError(err)} (${issueKey})`, { cause: err });
  }

  if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
    throw new Error(
      `Redirect erkannt (z.B. http→https). Bitte Jira-URL direkt auf HTTPS setzen. (${issueKey})`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Jira lehnte das Worklog für ${issueKey} ab: HTTP ${res.status} ${res.statusText}${
        detail ? ` — ${detail.slice(0, 200)}` : ""
      }`,
    );
  }
}

export type CredentialCheckResult =
  | { ok: true; displayName: string }
  | { ok: false; reason: string };

/** Validates credentials against `/rest/api/2/myself`. */
export async function checkCredentials(
  jiraUrl: string,
  auth: JiraAuth,
): Promise<CredentialCheckResult> {
  const url = `${trimUrl(jiraUrl)}/rest/api/2/myself`;

  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "manual",
      headers: {
        Authorization: authHeader(auth),
        Accept: "application/json",
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
    return { ok: false, reason: "Benutzername / Token / Passwort ist falsch." };
  }
  if (res.status === 403) {
    return {
      ok: false,
      reason:
        "Jira hat das Konto abgelehnt. Bitte im Browser anmelden und ggf. Captcha lösen.",
    };
  }
  if (!res.ok) {
    return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` };
  }

  const data = (await res.json().catch(() => ({}))) as {
    displayName?: string;
  };
  return { ok: true, displayName: data.displayName ?? "unbekannt" };
}
