import { describe, it, expect } from "vitest";
import type { SettingsRow } from "@/db/schema";
import { parseProjectKeys, deriveJiraAuth, isJiraConfigured } from "../settings";

function makeSettings(overrides: Partial<SettingsRow> = {}): SettingsRow {
  return {
    id: 1,
    regularWorkMinutes: 480,
    dailyTargetMinutes: 480,
    breaks: "[]",
    autoPauseEnabled: true,
    bookingMode: "grouped",
    dataRetentionDays: 90,
    jiraUrl: "https://jira.example.com",
    jiraProjectKeys: "[]",
    jiraAuthMode: "token",
    jiraToken: null,
    jiraUser: null,
    jiraPassword: null,
    allgemeinesIssueKey: "PROJ-1",
    addAllgemeinesSummary: false,
    overtimeBaselineMinutes: 0,
    themeMode: "system",
    updatedAt: "2026-05-20T00:00:00Z",
    ...overrides,
  };
}

describe("parseProjectKeys", () => {
  it("returns [] for null", () => {
    expect(parseProjectKeys(null)).toEqual([]);
  });

  it("returns [] for empty string", () => {
    expect(parseProjectKeys("")).toEqual([]);
  });

  it("parses a valid JSON array", () => {
    expect(parseProjectKeys(JSON.stringify(["proj", "oth"]))).toEqual([
      "PROJ",
      "OTH",
    ]);
  });

  it("trims and uppercases keys", () => {
    expect(parseProjectKeys(JSON.stringify([" mykey "]))).toEqual(["MYKEY"]);
  });

  it("filters out non-string and blank entries", () => {
    expect(parseProjectKeys(JSON.stringify(["PROJ", 42, "", "  "]))).toEqual([
      "PROJ",
    ]);
  });

  it("returns [] for non-array JSON", () => {
    expect(parseProjectKeys('{"a":1}')).toEqual([]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseProjectKeys("not json")).toEqual([]);
  });
});

describe("deriveJiraAuth", () => {
  it("returns token auth when mode is token and token is set", () => {
    const s = makeSettings({ jiraAuthMode: "token", jiraToken: "mytoken" });
    expect(deriveJiraAuth(s)).toEqual({ mode: "token", token: "mytoken" });
  });

  it("returns null when mode is token but token is missing", () => {
    const s = makeSettings({ jiraAuthMode: "token", jiraToken: null });
    expect(deriveJiraAuth(s)).toBeNull();
  });

  it("returns basic auth when mode is basic and credentials are set", () => {
    const s = makeSettings({
      jiraAuthMode: "basic",
      jiraUser: "user",
      jiraPassword: "pass",
    });
    expect(deriveJiraAuth(s)).toEqual({
      mode: "basic",
      user: "user",
      password: "pass",
    });
  });

  it("returns null when mode is basic but user is missing", () => {
    const s = makeSettings({
      jiraAuthMode: "basic",
      jiraUser: null,
      jiraPassword: "pass",
    });
    expect(deriveJiraAuth(s)).toBeNull();
  });

  it("returns null when mode is basic but password is missing", () => {
    const s = makeSettings({
      jiraAuthMode: "basic",
      jiraUser: "user",
      jiraPassword: null,
    });
    expect(deriveJiraAuth(s)).toBeNull();
  });
});

describe("isJiraConfigured", () => {
  it("returns true when URL and token are set", () => {
    const s = makeSettings({ jiraUrl: "https://jira.example.com", jiraAuthMode: "token", jiraToken: "tok" });
    expect(isJiraConfigured(s)).toBe(true);
  });

  it("returns false when URL is empty", () => {
    const s = makeSettings({ jiraUrl: "", jiraAuthMode: "token", jiraToken: "tok" });
    expect(isJiraConfigured(s)).toBe(false);
  });

  it("returns false when auth is incomplete", () => {
    const s = makeSettings({ jiraUrl: "https://jira.example.com", jiraAuthMode: "token", jiraToken: null });
    expect(isJiraConfigured(s)).toBe(false);
  });

  it("returns false when both URL and auth are missing", () => {
    const s = makeSettings({ jiraUrl: "", jiraAuthMode: "token", jiraToken: null });
    expect(isJiraConfigured(s)).toBe(false);
  });
});
