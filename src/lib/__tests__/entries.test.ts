import { describe, it, expect } from "vitest";
import type { TimeEntry } from "@/db/schema";
import {
  toEntryView,
  buildDayGroups,
  overtimeBalanceMinutes,
  workedSecondsByDay,
} from "../entries";
import type { EntryAnalysisConfig } from "../entries";

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 1,
    description: "",
    startedAt: new Date(2026, 4, 20, 9, 0, 0).toISOString(),
    endedAt: new Date(2026, 4, 20, 10, 0, 0).toISOString(),
    submittedAt: null,
    jiraIssueKey: null,
    isAllgemeines: false,
    createdAt: new Date(2026, 4, 20).toISOString(),
    updatedAt: new Date(2026, 4, 20).toISOString(),
    ...overrides,
  };
}

const cfg: EntryAnalysisConfig = {
  projectKeys: ["PROJ"],
  breaks: [],
  autoPauseEnabled: false,
};

describe("toEntryView", () => {
  it("parses description and sets issueKey", () => {
    const entry = makeEntry({ description: "PROJ-42 some work" });
    const view = toEntryView(entry, cfg);
    expect(view.issueKey).toBe("PROJ-42");
    expect(view.comment).toBe("some work");
  });

  it("sets effectiveSeconds for finished entries", () => {
    const start = new Date(2026, 4, 20, 9, 0, 0);
    const end = new Date(2026, 4, 20, 10, 0, 0);
    const entry = makeEntry({
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
    });
    const view = toEntryView(entry, cfg);
    expect(view.effectiveSeconds).toBe(3600);
  });

  it("sets effectiveSeconds to 0 for running entries", () => {
    const entry = makeEntry({ endedAt: null });
    const view = toEntryView(entry, cfg);
    expect(view.effectiveSeconds).toBe(0);
  });

  it("passes through id, submittedAt, jiraIssueKey, isAllgemeines", () => {
    const entry = makeEntry({
      id: 99,
      submittedAt: "2026-05-20T12:00:00.000Z",
      jiraIssueKey: "PROJ-1",
      isAllgemeines: true,
    });
    const view = toEntryView(entry, cfg);
    expect(view.id).toBe(99);
    expect(view.submittedAt).toBe("2026-05-20T12:00:00.000Z");
    expect(view.jiraIssueKey).toBe("PROJ-1");
    expect(view.isAllgemeines).toBe(true);
  });
});

describe("buildDayGroups", () => {
  it("excludes running (endedAt=null) entries", () => {
    const entries = [makeEntry({ id: 1, endedAt: null })];
    expect(buildDayGroups(entries, cfg)).toHaveLength(0);
  });

  it("groups entries into a single day", () => {
    const entries = [
      makeEntry({ id: 1, description: "PROJ-1 work" }),
      makeEntry({ id: 2, description: "PROJ-2 other" }),
    ];
    const days = buildDayGroups(entries, cfg);
    expect(days).toHaveLength(1);
    expect(days[0].groups).toHaveLength(2);
  });

  it("merges entries with the same description into one group", () => {
    const entries = [
      makeEntry({ id: 1, description: "PROJ-1 work", startedAt: new Date(2026, 4, 20, 9, 0).toISOString(), endedAt: new Date(2026, 4, 20, 10, 0).toISOString() }),
      makeEntry({ id: 2, description: "PROJ-1 work", startedAt: new Date(2026, 4, 20, 11, 0).toISOString(), endedAt: new Date(2026, 4, 20, 12, 0).toISOString() }),
    ];
    const days = buildDayGroups(entries, cfg);
    expect(days[0].groups).toHaveLength(1);
    expect(days[0].groups[0].entries).toHaveLength(2);
    expect(days[0].groups[0].totalSeconds).toBe(7200);
  });

  it("separates entries across different days", () => {
    const entries = [
      makeEntry({ id: 1, startedAt: new Date(2026, 4, 20, 9, 0).toISOString(), endedAt: new Date(2026, 4, 20, 10, 0).toISOString() }),
      makeEntry({ id: 2, startedAt: new Date(2026, 4, 21, 9, 0).toISOString(), endedAt: new Date(2026, 4, 21, 10, 0).toISOString() }),
    ];
    const days = buildDayGroups(entries, cfg);
    expect(days).toHaveLength(2);
  });

  it("sorts days newest first", () => {
    const entries = [
      makeEntry({ id: 1, startedAt: new Date(2026, 4, 19, 9, 0).toISOString(), endedAt: new Date(2026, 4, 19, 10, 0).toISOString() }),
      makeEntry({ id: 2, startedAt: new Date(2026, 4, 21, 9, 0).toISOString(), endedAt: new Date(2026, 4, 21, 10, 0).toISOString() }),
    ];
    const days = buildDayGroups(entries, cfg);
    expect(days[0].dayKey > days[1].dayKey).toBe(true);
  });

  it("counts unsubmitted entries on the day", () => {
    const entries = [
      makeEntry({ id: 1, submittedAt: "2026-05-20T12:00:00Z" }),
      makeEntry({ id: 2, submittedAt: null }),
    ];
    const days = buildDayGroups(entries, cfg);
    expect(days[0].unsubmittedCount).toBe(1);
  });

  it("marks allSubmitted=true when all entries have submittedAt", () => {
    const entries = [
      makeEntry({ id: 1, description: "PROJ-1 x", submittedAt: "2026-05-20T12:00:00Z" }),
    ];
    const days = buildDayGroups(entries, cfg);
    expect(days[0].groups[0].allSubmitted).toBe(true);
  });

  it("returns empty array for no entries", () => {
    expect(buildDayGroups([], cfg)).toEqual([]);
  });
});

describe("overtimeBalanceMinutes", () => {
  const regularWork = 480; // 8 hours

  it("returns baselineMinutes when map is empty", () => {
    expect(overtimeBalanceMinutes(new Map(), regularWork, 60)).toBe(60);
  });

  it("subtracts regular work minutes on weekdays", () => {
    // 2026-05-18 is Monday
    const map = new Map([["2026-05-18", 9 * 3600]]); // 9h worked
    expect(overtimeBalanceMinutes(map, regularWork)).toBe(60); // 1h overtime
  });

  it("counts full seconds on weekends as overtime", () => {
    // 2026-05-17 is Sunday
    const map = new Map([["2026-05-17", 2 * 3600]]); // 2h worked
    expect(overtimeBalanceMinutes(map, regularWork)).toBe(120); // all 2h = overtime
  });

  it("accumulates baseline with daily balance", () => {
    // 2026-05-18 Monday, worked exactly 8h → 0 delta
    const map = new Map([["2026-05-18", 8 * 3600]]);
    expect(overtimeBalanceMinutes(map, regularWork, -30)).toBe(-30);
  });

  it("works with negative overtime (undertime)", () => {
    // Worked 7h on a weekday → -60 min
    const map = new Map([["2026-05-18", 7 * 3600]]);
    expect(overtimeBalanceMinutes(map, regularWork)).toBe(-60);
  });
});

describe("workedSecondsByDay", () => {
  it("returns empty map for no entries", () => {
    expect(workedSecondsByDay([], cfg)).toEqual(new Map());
  });

  it("skips running entries", () => {
    const entries = [makeEntry({ endedAt: null })];
    expect(workedSecondsByDay(entries, cfg)).toEqual(new Map());
  });

  it("sums seconds for a single day", () => {
    const entries = [
      makeEntry({ id: 1, startedAt: new Date(2026, 4, 20, 9, 0).toISOString(), endedAt: new Date(2026, 4, 20, 10, 0).toISOString() }),
      makeEntry({ id: 2, startedAt: new Date(2026, 4, 20, 11, 0).toISOString(), endedAt: new Date(2026, 4, 20, 12, 0).toISOString() }),
    ];
    const map = workedSecondsByDay(entries, cfg);
    const key = `2026-05-20`;
    expect(map.get(key)).toBe(7200);
  });

  it("groups by local day key", () => {
    const entries = [
      makeEntry({ id: 1, startedAt: new Date(2026, 4, 19, 9, 0).toISOString(), endedAt: new Date(2026, 4, 19, 10, 0).toISOString() }),
      makeEntry({ id: 2, startedAt: new Date(2026, 4, 20, 9, 0).toISOString(), endedAt: new Date(2026, 4, 20, 10, 0).toISOString() }),
    ];
    const map = workedSecondsByDay(entries, cfg);
    expect(map.size).toBe(2);
  });
});
