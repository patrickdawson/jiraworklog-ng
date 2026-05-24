import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatHms,
  formatHm,
  formatSignedHm,
  formatSignedHmInput,
  parseSignedHm,
  formatDurationHoursMinutes,
  dayKey,
  dayLabel,
  clockTime,
} from "../format";

describe("formatHms", () => {
  it("formats zero as 00:00:00", () => {
    expect(formatHms(0)).toBe("00:00:00");
  });

  it("formats seconds correctly", () => {
    expect(formatHms(3661)).toBe("01:01:01");
  });

  it("clamps negative values to 00:00:00", () => {
    expect(formatHms(-10)).toBe("00:00:00");
  });

  it("hours are not capped at 24", () => {
    expect(formatHms(90000)).toBe("25:00:00");
  });
});

describe("formatHm", () => {
  it("formats zero as 00:00", () => {
    expect(formatHm(0)).toBe("00:00");
  });

  it("formats 90 minutes as 01:30", () => {
    expect(formatHm(90)).toBe("01:30");
  });

  it("clamps negative values to 00:00", () => {
    expect(formatHm(-5)).toBe("00:00");
  });
});

describe("formatSignedHm", () => {
  it("prefixes positive values with +", () => {
    expect(formatSignedHm(90)).toBe("+01:30");
  });

  it("prefixes negative values with Unicode minus", () => {
    expect(formatSignedHm(-90)).toBe("−01:30");
  });

  it("treats zero as positive", () => {
    expect(formatSignedHm(0)).toBe("+00:00");
  });
});

describe("formatSignedHmInput", () => {
  it("prefixes negative with ASCII hyphen", () => {
    expect(formatSignedHmInput(-30)).toBe("-00:30");
  });

  it("prefixes positive with +", () => {
    expect(formatSignedHmInput(30)).toBe("+00:30");
  });
});

describe("parseSignedHm", () => {
  it("parses a positive value", () => {
    expect(parseSignedHm("+01:30")).toBe(90);
  });

  it("parses a negative value with ASCII minus", () => {
    expect(parseSignedHm("-01:30")).toBe(-90);
  });

  it("parses a negative value with Unicode minus", () => {
    expect(parseSignedHm("−01:30")).toBe(-90);
  });

  it("parses without sign as positive", () => {
    expect(parseSignedHm("02:00")).toBe(120);
  });

  it("returns null for invalid minutes ≥ 60", () => {
    expect(parseSignedHm("01:60")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseSignedHm("abc")).toBeNull();
  });
});

describe("formatDurationHoursMinutes", () => {
  it("formats minutes-only duration", () => {
    expect(formatDurationHoursMinutes(45)).toBe("45m");
  });

  it("formats hours and minutes", () => {
    expect(formatDurationHoursMinutes(90)).toBe("1h 30m");
  });

  it("formats exact hours", () => {
    expect(formatDurationHoursMinutes(120)).toBe("2h 0m");
  });
});

describe("dayKey", () => {
  it("returns YYYY-MM-DD for an ISO string", () => {
    expect(dayKey("2026-05-24T10:30:00")).toBe("2026-05-24");
  });

  it("accepts a Date object", () => {
    expect(dayKey(new Date("2026-01-01T00:00:00"))).toBe("2026-01-01");
  });
});

describe("clockTime", () => {
  it("returns HH:MM from an ISO timestamp", () => {
    const iso = new Date(2026, 4, 24, 9, 5).toISOString();
    expect(clockTime(iso)).toBe("09:05");
  });
});

describe("dayLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 4, 20, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Heute" for today', () => {
    expect(dayLabel(dayKey(new Date()))).toBe("Heute");
  });

  it('returns "Gestern" for yesterday', () => {
    expect(dayLabel(dayKey(new Date(Date.now() - 86_400_000)))).toBe("Gestern");
  });

  it("returns formatted weekday label for a Monday", () => {
    expect(dayLabel("2026-05-18")).toBe("Montag, 18.05.2026");
  });

  it("returns correct weekday for a Sunday", () => {
    expect(dayLabel("2026-05-17")).toBe("Sonntag, 17.05.2026");
  });
});
