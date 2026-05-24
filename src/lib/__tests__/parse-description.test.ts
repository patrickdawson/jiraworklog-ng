import { describe, it, expect } from "vitest";
import { parseDescription } from "../parse-description";

describe("parseDescription", () => {
  it("extracts issue key, memo, and comment", () => {
    const result = parseDescription("My memo PROJ-123 some comment", ["PROJ"]);
    expect(result).toEqual({
      raw: "My memo PROJ-123 some comment",
      memo: "My memo",
      issueKey: "PROJ-123",
      comment: "some comment",
    });
  });

  it("uppercases the issue key", () => {
    const result = parseDescription("proj-42 fix bug", ["PROJ"]);
    expect(result.issueKey).toBe("PROJ-42");
  });

  it("returns undefined issueKey when no project keys provided", () => {
    const result = parseDescription("PROJ-123 some work", []);
    expect(result.issueKey).toBeUndefined();
    expect(result.comment).toBe("PROJ-123 some work");
  });

  it("returns undefined issueKey when description has no matching key", () => {
    const result = parseDescription("just some text", ["PROJ"]);
    expect(result.issueKey).toBeUndefined();
    expect(result.memo).toBe("just some text");
  });

  it("handles multiple project keys", () => {
    const result = parseDescription("OTH-99 review", ["PROJ", "OTH"]);
    expect(result.issueKey).toBe("OTH-99");
    expect(result.comment).toBe("review");
  });

  it("handles an empty description gracefully", () => {
    const result = parseDescription("", ["PROJ"]);
    expect(result.issueKey).toBeUndefined();
    expect(result.raw).toBe("");
  });
});
