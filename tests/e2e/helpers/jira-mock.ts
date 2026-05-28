import { MOCK_JIRA_URL } from "./db";
import type { ReceivedRequest } from "../mocks/jira-server";

type Expectation = {
  method: string;
  path: string;
  status?: number;
  body?: unknown;
};

async function adminFetch(action: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${MOCK_JIRA_URL}/__mock/${action}`, init);
  if (!res.ok) {
    throw new Error(`Jira mock admin call ${action} failed: ${res.status}`);
  }
  return res;
}

export async function resetMock(): Promise<void> {
  await adminFetch("reset", { method: "POST" });
}

export async function expectJira(expectation: Expectation | Expectation[]): Promise<void> {
  await adminFetch("expect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(expectation),
  });
}

export async function expectMyself(opts: { status?: number; body?: unknown } = {}): Promise<void> {
  await expectJira({
    method: "GET",
    path: "/rest/api/2/myself",
    status: opts.status,
    body: opts.body,
  });
}

export async function expectWorklog(opts: {
  issueKey: string;
  status?: number;
  body?: unknown;
}): Promise<void> {
  await expectJira({
    method: "POST",
    path: `/rest/api/2/issue/${opts.issueKey}/worklog`,
    status: opts.status,
    body: opts.body,
  });
}

/** Every request the mock has seen since the last reset, in arrival order. */
export async function getReceived(): Promise<ReceivedRequest[]> {
  const res = await adminFetch("received", { method: "GET" });
  const data = (await res.json()) as { received: ReceivedRequest[] };
  return data.received;
}
