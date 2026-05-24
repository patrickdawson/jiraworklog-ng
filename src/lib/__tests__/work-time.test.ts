import { describe, it, expect } from "vitest";
import {
  parseBreaks,
  breakOverlapSeconds,
  effectiveDurationSeconds,
} from "../work-time";

describe("parseBreaks", () => {
  it("returns [] for null", () => {
    expect(parseBreaks(null)).toEqual([]);
  });

  it("parses valid breaks", () => {
    const json = JSON.stringify([{ start: "12:00", end: "12:30" }]);
    expect(parseBreaks(json)).toEqual([{ start: "12:00", end: "12:30" }]);
  });

  it("filters out entries with invalid time format", () => {
    const json = JSON.stringify([
      { start: "12:00", end: "12:30" },
      { start: "bad", end: "12:30" },
    ]);
    expect(parseBreaks(json)).toHaveLength(1);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseBreaks("not json")).toEqual([]);
  });

  it("returns [] for non-array JSON", () => {
    expect(parseBreaks('{"start":"12:00","end":"12:30"}')).toEqual([]);
  });
});

describe("breakOverlapSeconds", () => {
  const breaks = [{ start: "12:00", end: "13:00" }];

  it("returns 0 when entry does not overlap the break", () => {
    const start = new Date(2026, 4, 24, 9, 0, 0);
    const end = new Date(2026, 4, 24, 11, 0, 0);
    expect(breakOverlapSeconds(start, end, breaks)).toBe(0);
  });

  it("returns full break duration for full overlap", () => {
    const start = new Date(2026, 4, 24, 11, 0, 0);
    const end = new Date(2026, 4, 24, 14, 0, 0);
    expect(breakOverlapSeconds(start, end, breaks)).toBe(3600);
  });

  it("returns partial overlap correctly", () => {
    const start = new Date(2026, 4, 24, 12, 30, 0);
    const end = new Date(2026, 4, 24, 14, 0, 0);
    expect(breakOverlapSeconds(start, end, breaks)).toBe(1800);
  });

  it("returns 0 for empty breaks list", () => {
    const start = new Date(2026, 4, 24, 12, 0, 0);
    const end = new Date(2026, 4, 24, 13, 0, 0);
    expect(breakOverlapSeconds(start, end, [])).toBe(0);
  });
});

describe("effectiveDurationSeconds", () => {
  const breaks = [{ start: "12:00", end: "13:00" }];
  // Use local noon so break window overlap is timezone-independent
  const startDate = new Date(2026, 4, 24, 11, 0, 0);
  const endDate = new Date(2026, 4, 24, 15, 0, 0);
  const startIso = startDate.toISOString();
  const endIso = endDate.toISOString();

  it("returns raw duration when auto-pause is disabled", () => {
    const raw = effectiveDurationSeconds(startIso, endIso, breaks, false);
    expect(raw).toBe(14400);
  });

  it("subtracts break overlap when auto-pause is enabled", () => {
    const effective = effectiveDurationSeconds(startIso, endIso, breaks, true);
    expect(effective).toBe(10800); // 4h minus 1h break = 3h
  });

  it("returns 0 for inverted start/end", () => {
    const result = effectiveDurationSeconds(endIso, startIso, breaks, false);
    expect(result).toBe(0);
  });

  it("uses now when endIso is null", () => {
    const recentStart = new Date(Date.now() - 5000).toISOString();
    const result = effectiveDurationSeconds(recentStart, null, [], false);
    expect(result).toBeGreaterThan(0);
  });
});
