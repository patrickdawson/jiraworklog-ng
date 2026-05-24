import { describe, it, expect } from "vitest";
import { formatJiraFetchError } from "../../jira/fetch-error";

describe("formatJiraFetchError", () => {
  it("returns a generic message for a plain Error", () => {
    const result = formatJiraFetchError(new Error("connection refused"));
    expect(result).toContain("connection refused");
    expect(result).toContain("Keine Verbindung zum Server");
  });

  it("returns a TLS hint when message contains 'certificate'", () => {
    const result = formatJiraFetchError(new Error("certificate verify failed"));
    expect(result).toContain("TLS/Zertifikat");
  });

  it("returns a TLS hint when message contains 'self signed'", () => {
    const result = formatJiraFetchError(new Error("self signed certificate"));
    expect(result).toContain("TLS/Zertifikat");
  });

  it("returns a TLS hint when message contains 'fetch failed'", () => {
    const result = formatJiraFetchError(new Error("fetch failed"));
    expect(result).toContain("TLS/Zertifikat");
  });

  it("includes cause message in the output", () => {
    const cause = new Error("unable to verify the first certificate");
    const err = new Error("fetch failed", { cause });
    const result = formatJiraFetchError(err);
    expect(result).toContain("unable to verify the first certificate");
  });

  it("handles non-Error values", () => {
    const result = formatJiraFetchError("something went wrong");
    expect(result).toContain("something went wrong");
  });

  it("handles non-Error objects", () => {
    const result = formatJiraFetchError({ code: 42 });
    expect(result).toContain("[object Object]");
  });
});
