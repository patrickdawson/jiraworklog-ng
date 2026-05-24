import { describe, it, expect, vi, afterEach } from "vitest";
import { toJiraTimestamp, checkCredentials, postWorklogToJira } from "../../jira/worklog";
import type { JiraAuth, PostWorklogParams } from "../../jira/worklog";

afterEach(() => {
  vi.unstubAllGlobals();
});

const tokenAuth: JiraAuth = { mode: "token", token: "mytoken" };
const basicAuth: JiraAuth = { mode: "basic", user: "user", password: "pass" };

function mockFetch(status: number, body: unknown = {}, type = "default") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const res = {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    type,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(text),
  } as unknown as Response;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
}

describe("toJiraTimestamp", () => {
  it("replaces Z with +0000", () => {
    const d = new Date("2026-05-20T10:00:00.000Z");
    expect(toJiraTimestamp(d)).toBe("2026-05-20T10:00:00.000+0000");
  });
});

describe("checkCredentials", () => {

  it("returns ok=true with displayName on success", async () => {
    mockFetch(200, { displayName: "Alice" });
    const result = await checkCredentials("https://jira.example.com", tokenAuth);
    expect(result).toEqual({ ok: true, displayName: "Alice" });
  });

  it('falls back to "unbekannt" when displayName is missing', async () => {
    mockFetch(200, {});
    const result = await checkCredentials("https://jira.example.com", tokenAuth);
    expect(result).toEqual({ ok: true, displayName: "unbekannt" });
  });

  it("returns ok=false with auth error on 401", async () => {
    mockFetch(401);
    const result = await checkCredentials("https://jira.example.com", tokenAuth);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("falsch");
  });

  it("returns ok=false with captcha hint on 403", async () => {
    mockFetch(403);
    const result = await checkCredentials("https://jira.example.com", tokenAuth);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("Captcha");
  });

  it("returns ok=false for generic HTTP error", async () => {
    mockFetch(500);
    const result = await checkCredentials("https://jira.example.com", tokenAuth);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("HTTP 500");
  });

  it("returns ok=false for redirect response", async () => {
    mockFetch(302, {}, "opaqueredirect");
    const result = await checkCredentials("https://jira.example.com", tokenAuth);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain("Redirect");
  });

  it("returns ok=false when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await checkCredentials("https://jira.example.com", tokenAuth);
    expect(result.ok).toBe(false);
  });

  it("strips trailing slashes from jiraUrl", async () => {
    mockFetch(200, { displayName: "Bob" });
    await checkCredentials("https://jira.example.com///", tokenAuth);
    const called = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(called).not.toContain("///");
    expect(called).toContain("/rest/api/2/myself");
  });

  it("sends correct Authorization header for token auth", async () => {
    mockFetch(200, { displayName: "Bob" });
    await checkCredentials("https://jira.example.com", tokenAuth);
    const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe("Bearer mytoken");
  });

  it("sends correct Authorization header for basic auth", async () => {
    mockFetch(200, { displayName: "Bob" });
    await checkCredentials("https://jira.example.com", basicAuth);
    const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const encoded = Buffer.from("user:pass").toString("base64");
    expect((opts.headers as Record<string, string>)["Authorization"]).toBe(`Basic ${encoded}`);
  });
});

describe("postWorklogToJira", () => {
  const params: PostWorklogParams = {
    jiraUrl: "https://jira.example.com",
    auth: tokenAuth,
    issueKey: "PROJ-1",
    timeSpent: "1h 30m",
    started: new Date("2026-05-20T09:00:00.000Z"),
    comment: "did some work",
  };

  it("resolves without error on 201", async () => {
    mockFetch(201);
    await expect(postWorklogToJira(params)).resolves.toBeUndefined();
  });

  it("throws on non-ok status with issue key in message", async () => {
    mockFetch(400, "Bad Request");
    await expect(postWorklogToJira(params)).rejects.toThrow("PROJ-1");
  });

  it("throws redirect error for opaqueredirect", async () => {
    mockFetch(302, "", "opaqueredirect");
    await expect(postWorklogToJira(params)).rejects.toThrow("Redirect");
  });

  it("throws with issue key when fetch itself throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));
    await expect(postWorklogToJira(params)).rejects.toThrow("PROJ-1");
  });

  it("sends POST with correct body fields", async () => {
    mockFetch(201);
    await postWorklogToJira(params);
    const opts = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.timeSpent).toBe("1h 30m");
    expect(body.comment).toBe("did some work");
    expect(body.started).toMatch(/\+0000$/);
  });
});
