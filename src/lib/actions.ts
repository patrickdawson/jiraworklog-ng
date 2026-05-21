"use server";

import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { settings, timeEntries } from "@/db/schema";
import { getAllEntries, getRunningEntry, getSettings } from "@/db/queries";
import { dayKey, formatDurationHoursMinutes } from "@/lib/format";
import {
  checkCredentials,
  postWorklogToJira,
  type JiraAuth,
} from "@/lib/jira/worklog";
import { parseDescription } from "@/lib/parse-description";
import { deriveJiraAuth, parseProjectKeys } from "@/lib/settings";
import { effectiveDurationSeconds, parseBreaks } from "@/lib/work-time";

function nowIso(): string {
  return new Date().toISOString();
}

function revalidateAll(): void {
  revalidatePath("/");
  revalidatePath("/auswertung");
  revalidatePath("/einstellungen");
}

// ───────────────────────────── Timer ──────────────────────────────

/** Entries shorter than this are discarded on stop instead of being saved. */
const MIN_TRACKED_SECONDS = 60;

/**
 * Closes the running timer (if any). When the effective duration is below
 * `MIN_TRACKED_SECONDS` the row is deleted instead of getting an `endedAt`,
 * matching Jira's "no worklog under one minute" constraint.
 *
 * Returns metadata so the UI can show a toast for discarded entries.
 */
function closeRunningTimer(): {
  hadRunning: boolean;
  discarded: boolean;
  secondsTracked: number;
} {
  const running = getRunningEntry();
  if (!running) return { hadRunning: false, discarded: false, secondsTracked: 0 };

  const s = getSettings();
  const seconds = effectiveDurationSeconds(
    running.startedAt,
    null,
    parseBreaks(s.breaks),
    s.autoPauseEnabled,
  );

  if (seconds < MIN_TRACKED_SECONDS) {
    db.delete(timeEntries).where(eq(timeEntries.id, running.id)).run();
    return { hadRunning: true, discarded: true, secondsTracked: seconds };
  }

  const ended = nowIso();
  db.update(timeEntries)
    .set({ endedAt: ended, updatedAt: ended })
    .where(eq(timeEntries.id, running.id))
    .run();
  return { hadRunning: true, discarded: false, secondsTracked: seconds };
}

export type StartTimerResult = {
  previousDiscarded: boolean;
  previousSecondsTracked: number;
};

/** Stops any running timer, then starts a new one with the given text. */
export async function startTimer(
  description: string,
  isAllgemeines = false,
): Promise<StartTimerResult> {
  const previous = closeRunningTimer();
  db.insert(timeEntries)
    .values({
      description: description ?? "",
      startedAt: nowIso(),
      isAllgemeines,
    })
    .run();
  revalidateAll();
  return {
    previousDiscarded: previous.discarded,
    previousSecondsTracked: previous.secondsTracked,
  };
}

export type StopTimerResult = {
  stopped: boolean;
  discarded: boolean;
  secondsTracked: number;
};

/** Stops the running timer, if any. */
export async function stopTimer(): Promise<StopTimerResult> {
  const result = closeRunningTimer();
  revalidateAll();
  return {
    stopped: result.hadRunning,
    discarded: result.discarded,
    secondsTracked: result.secondsTracked,
  };
}

/** Updates the description of the currently running timer. */
export async function updateRunningDescription(
  description: string,
): Promise<void> {
  db.update(timeEntries)
    .set({ description: description ?? "", updatedAt: nowIso() })
    .where(isNull(timeEntries.endedAt))
    .run();
  revalidateAll();
}

/** Toggles the Allgemeines flag on the currently running timer. */
export async function updateRunningAllgemeines(
  isAllgemeines: boolean,
): Promise<void> {
  db.update(timeEntries)
    .set({ isAllgemeines, updatedAt: nowIso() })
    .where(isNull(timeEntries.endedAt))
    .run();
  revalidateAll();
}

// ──────────────────────────── Entries ─────────────────────────────

const manualEntrySchema = z.object({
  description: z.string(),
  startedAt: z.string().min(1),
  endedAt: z.string().min(1),
  isAllgemeines: z.boolean().optional(),
});

export type ActionResult = { ok: boolean; message?: string };

/** Creates a finished entry manually (without using the timer). */
export async function createManualEntry(input: {
  description: string;
  startedAt: string;
  endedAt: string;
  isAllgemeines?: boolean;
}): Promise<ActionResult> {
  const parsed = manualEntrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Ungültige Eingabe." };

  const start = new Date(parsed.data.startedAt);
  const end = new Date(parsed.data.endedAt);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { ok: false, message: "Ungültiges Datum." };
  }
  if (end <= start) {
    return { ok: false, message: "Ende muss nach dem Beginn liegen." };
  }

  db.insert(timeEntries)
    .values({
      description: parsed.data.description,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      isAllgemeines: parsed.data.isAllgemeines ?? false,
    })
    .run();
  revalidateAll();
  return { ok: true };
}

/** Edits an existing entry. Times are optional (description-only edit allowed). */
export async function updateEntry(
  id: number,
  input: {
    description: string;
    startedAt?: string;
    endedAt?: string;
    isAllgemeines?: boolean;
  },
): Promise<ActionResult> {
  const patch: Record<string, string | boolean | null> = {
    description: input.description ?? "",
    updatedAt: nowIso(),
  };

  if (input.startedAt && input.endedAt) {
    const start = new Date(input.startedAt);
    const end = new Date(input.endedAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { ok: false, message: "Ungültiges Datum." };
    }
    if (end <= start) {
      return { ok: false, message: "Ende muss nach dem Beginn liegen." };
    }
    patch.startedAt = start.toISOString();
    patch.endedAt = end.toISOString();
  }

  if (typeof input.isAllgemeines === "boolean") {
    patch.isAllgemeines = input.isAllgemeines;
  }

  db.update(timeEntries).set(patch).where(eq(timeEntries.id, id)).run();
  revalidateAll();
  return { ok: true };
}

export async function deleteEntry(id: number): Promise<void> {
  db.delete(timeEntries).where(eq(timeEntries.id, id)).run();
  revalidateAll();
}

// ──────────────────────────── Settings ────────────────────────────

const breakSchema = z.object({
  start: z.string().regex(/^\d{1,2}:\d{2}$/),
  end: z.string().regex(/^\d{1,2}:\d{2}$/),
});

const settingsSchema = z.object({
  regularWorkMinutes: z.number().int().min(0).max(1440),
  dailyTargetMinutes: z.number().int().min(0).max(1440),
  breaks: z.array(breakSchema),
  autoPauseEnabled: z.boolean(),
  bookingMode: z.enum(["grouped", "individual"]),
  dataRetentionDays: z.number().int().min(1).max(3650),
  jiraUrl: z.string(),
  jiraProjectKeys: z.array(z.string()),
  jiraAuthMode: z.enum(["token", "basic"]),
  jiraToken: z.string().nullable(),
  jiraUser: z.string().nullable(),
  jiraPassword: z.string().nullable(),
  allgemeinesIssueKey: z.string(),
  addAllgemeinesSummary: z.boolean(),
});

export type SettingsInput = z.infer<typeof settingsSchema>;

export async function updateSettings(
  input: SettingsInput,
): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Ungültige Einstellungen." };
  }
  const d = parsed.data;
  getSettings(); // ensure row exists

  db.update(settings)
    .set({
      regularWorkMinutes: d.regularWorkMinutes,
      dailyTargetMinutes: d.dailyTargetMinutes,
      breaks: JSON.stringify(d.breaks),
      autoPauseEnabled: d.autoPauseEnabled,
      bookingMode: d.bookingMode,
      dataRetentionDays: d.dataRetentionDays,
      jiraUrl: d.jiraUrl.trim(),
      jiraProjectKeys: JSON.stringify(
        d.jiraProjectKeys.map((k) => k.trim().toUpperCase()).filter(Boolean),
      ),
      jiraAuthMode: d.jiraAuthMode,
      jiraToken: d.jiraToken,
      jiraUser: d.jiraUser,
      jiraPassword: d.jiraPassword,
      allgemeinesIssueKey: d.allgemeinesIssueKey.trim().toUpperCase(),
      addAllgemeinesSummary: d.addAllgemeinesSummary,
      updatedAt: nowIso(),
    })
    .where(eq(settings.id, 1))
    .run();
  revalidateAll();
  return { ok: true };
}

/** Tests Jira credentials without persisting them. */
export async function testJiraConnection(input: {
  jiraUrl: string;
  jiraAuthMode: "token" | "basic";
  jiraToken: string | null;
  jiraUser: string | null;
  jiraPassword: string | null;
}): Promise<ActionResult> {
  if (!input.jiraUrl.trim()) {
    return { ok: false, message: "Bitte zuerst eine Jira-URL angeben." };
  }
  let auth: JiraAuth | null = null;
  if (input.jiraAuthMode === "token") {
    auth = input.jiraToken ? { mode: "token", token: input.jiraToken } : null;
  } else if (input.jiraUser && input.jiraPassword) {
    auth = {
      mode: "basic",
      user: input.jiraUser,
      password: input.jiraPassword,
    };
  }
  if (!auth) {
    return { ok: false, message: "Zugangsdaten unvollständig." };
  }

  const result = await checkCredentials(input.jiraUrl.trim(), auth);
  return result.ok
    ? { ok: true, message: `Verbunden als ${result.displayName}.` }
    : { ok: false, message: result.reason };
}

// ──────────────────────────── Cleanup ─────────────────────────────

export async function cleanupOldEntries(
  days: number,
): Promise<{ ok: boolean; deleted: number; message?: string }> {
  if (!Number.isFinite(days) || days < 1) {
    return { ok: false, deleted: 0, message: "Ungültige Tagesangabe." };
  }
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  // Only delete finished entries older than the cutoff — never a running timer.
  const stale = db
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(lt(timeEntries.startedAt, cutoff), isNotNull(timeEntries.endedAt)))
    .all();

  for (const row of stale) {
    db.delete(timeEntries).where(eq(timeEntries.id, row.id)).run();
  }
  revalidateAll();
  return { ok: true, deleted: stale.length };
}

// ────────────────────────── Jira booking ──────────────────────────

export type PlannedWorklog = {
  issueKey: string;
  timeSpent: string;
  minutes: number;
  comment: string;
  entryCount: number;
  /** True for the auto-appended "Allgemeines" sum worklog. */
  isSummary?: boolean;
};

export type SkippedEntry = { description: string; reason: string };

export type DayBookingPlan = {
  worklogs: PlannedWorklog[];
  skipped: SkippedEntry[];
};

type InternalWorklog = PlannedWorklog & { started: Date; entryIds: number[] };

type Parsed = {
  id: number;
  issueKey: string;
  comment: string;
  seconds: number;
  started: Date;
};

/**
 * Turns a set of finished, unsubmitted entries (typically already filtered to
 * a single day) into the worklogs Jira should receive. Grouped/individual mode
 * is read from settings. Callers must never mix entries from different days
 * here — grouped mode would otherwise produce a single worklog spanning days.
 */
function buildPlanInternal(
  candidates: import("@/db/schema").TimeEntry[],
  s: import("@/db/schema").SettingsRow,
): { worklogs: InternalWorklog[]; skipped: SkippedEntry[] } {
  const projectKeys = parseProjectKeys(s.jiraProjectKeys);
  const breaks = parseBreaks(s.breaks);
  const allgemeinesKey = s.allgemeinesIssueKey.trim().toUpperCase();
  const skipped: SkippedEntry[] = [];
  const valid: Parsed[] = [];

  for (const entry of candidates) {
    const seconds = effectiveDurationSeconds(
      entry.startedAt,
      entry.endedAt,
      breaks,
      s.autoPauseEnabled,
    );

    let issueKey: string | undefined;
    let comment: string;

    if (entry.isAllgemeines) {
      if (!allgemeinesKey) {
        skipped.push({
          description: entry.description || "(ohne Beschreibung)",
          reason: "Allgemeines-Issue ist nicht konfiguriert",
        });
        continue;
      }
      issueKey = allgemeinesKey;
      comment = entry.description.trim();
    } else {
      const parsed = parseDescription(entry.description, projectKeys);
      if (!parsed.issueKey) {
        skipped.push({
          description: entry.description || "(ohne Beschreibung)",
          reason: "Kein Issue-Key erkannt",
        });
        continue;
      }
      issueKey = parsed.issueKey;
      comment = parsed.comment;
    }

    if (Math.round(seconds / 60) < 1) {
      skipped.push({
        description: entry.description || "(ohne Beschreibung)",
        reason: "Dauer unter 1 Minute",
      });
      continue;
    }
    valid.push({
      id: entry.id,
      issueKey,
      comment,
      seconds,
      started: new Date(entry.startedAt),
    });
  }

  const worklogs: InternalWorklog[] = [];

  if (s.bookingMode === "grouped") {
    const byIssue = new Map<string, Parsed[]>();
    for (const p of valid) {
      const bucket = byIssue.get(p.issueKey);
      if (bucket) bucket.push(p);
      else byIssue.set(p.issueKey, [p]);
    }
    for (const [issueKey, group] of byIssue) {
      const minutes = Math.round(
        group.reduce((sum, p) => sum + p.seconds, 0) / 60,
      );
      const comments = [
        ...new Set(group.map((p) => p.comment).filter(Boolean)),
      ];
      const started = group.reduce(
        (min, p) => (p.started < min ? p.started : min),
        group[0].started,
      );
      worklogs.push({
        issueKey,
        minutes,
        timeSpent: formatDurationHoursMinutes(minutes),
        comment: comments.join(", "),
        entryCount: group.length,
        started,
        entryIds: group.map((p) => p.id),
      });
    }
  } else {
    for (const p of valid) {
      const minutes = Math.round(p.seconds / 60);
      worklogs.push({
        issueKey: p.issueKey,
        minutes,
        timeSpent: formatDurationHoursMinutes(minutes),
        comment: p.comment,
        entryCount: 1,
        started: p.started,
        entryIds: [p.id],
      });
    }
  }

  if (s.addAllgemeinesSummary && allgemeinesKey) {
    const contributing = worklogs.filter((w) => w.issueKey !== allgemeinesKey);
    const summaryMinutes = contributing.reduce((sum, w) => sum + w.minutes, 0);
    if (summaryMinutes > 0) {
      const started = contributing.reduce(
        (min, w) => (w.started < min ? w.started : min),
        contributing[0].started,
      );
      worklogs.push({
        issueKey: allgemeinesKey,
        minutes: summaryMinutes,
        timeSpent: formatDurationHoursMinutes(summaryMinutes),
        comment: "",
        entryCount: contributing.reduce((n, w) => n + w.entryCount, 0),
        started,
        entryIds: [],
        isSummary: true,
      });
    }
  }

  return { worklogs, skipped };
}

function buildDayPlan(dayKeyStr: string): {
  worklogs: InternalWorklog[];
  skipped: SkippedEntry[];
} {
  const s = getSettings();
  const candidates = getAllEntries().filter(
    (e) =>
      e.endedAt !== null &&
      e.submittedAt === null &&
      dayKey(e.startedAt) === dayKeyStr,
  );
  return buildPlanInternal(candidates, s);
}

/** Plan covering every day that still has unsubmitted entries. */
function buildAllOpenPlan(): {
  worklogs: InternalWorklog[];
  skipped: SkippedEntry[];
} {
  const s = getSettings();
  const candidates = getAllEntries().filter(
    (e) => e.endedAt !== null && e.submittedAt === null,
  );

  const byDay = new Map<string, typeof candidates>();
  for (const entry of candidates) {
    const key = dayKey(entry.startedAt);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(entry);
    else byDay.set(key, [entry]);
  }

  const worklogs: InternalWorklog[] = [];
  const skipped: SkippedEntry[] = [];
  for (const dayEntries of byDay.values()) {
    const plan = buildPlanInternal(dayEntries, s);
    worklogs.push(...plan.worklogs);
    skipped.push(...plan.skipped);
  }
  return { worklogs, skipped };
}

function stripInternal(worklogs: InternalWorklog[]): PlannedWorklog[] {
  return worklogs.map(({ started: _s, entryIds: _i, ...rest }) => {
    void _s;
    void _i;
    return rest;
  });
}

/** Returns what would be booked for a day, without sending anything. */
export async function previewDayBooking(
  dayKeyStr: string,
): Promise<DayBookingPlan> {
  const { worklogs, skipped } = buildDayPlan(dayKeyStr);
  return { worklogs: stripInternal(worklogs), skipped };
}

/** Same as previewDayBooking, but across all days with open entries. */
export async function previewAllOpenBooking(): Promise<DayBookingPlan> {
  const { worklogs, skipped } = buildAllOpenPlan();
  return { worklogs: stripInternal(worklogs), skipped };
}

export type SubmitResult = {
  ok: boolean;
  bookedWorklogs: number;
  bookedEntries: number;
  errors: string[];
  skipped: SkippedEntry[];
  message?: string;
};

async function postPlanToJira(
  worklogs: InternalWorklog[],
  skipped: SkippedEntry[],
): Promise<SubmitResult> {
  const s = getSettings();
  const auth = deriveJiraAuth(s);
  if (!s.jiraUrl || !auth) {
    return {
      ok: false,
      bookedWorklogs: 0,
      bookedEntries: 0,
      errors: [],
      skipped,
      message: "Jira ist nicht vollständig konfiguriert (siehe Einstellungen).",
    };
  }

  if (worklogs.length === 0) {
    return {
      ok: true,
      bookedWorklogs: 0,
      bookedEntries: 0,
      errors: [],
      skipped,
      message: "Keine buchbaren Einträge gefunden.",
    };
  }

  const errors: string[] = [];
  let bookedWorklogs = 0;
  let bookedEntries = 0;

  for (const wl of worklogs) {
    try {
      await postWorklogToJira({
        jiraUrl: s.jiraUrl,
        auth,
        issueKey: wl.issueKey,
        timeSpent: wl.timeSpent,
        started: wl.started,
        comment: wl.comment || undefined,
      });
      const submittedAt = nowIso();
      for (const id of wl.entryIds) {
        db.update(timeEntries)
          .set({
            submittedAt,
            jiraIssueKey: wl.issueKey,
            updatedAt: submittedAt,
          })
          .where(eq(timeEntries.id, id))
          .run();
      }
      bookedWorklogs += 1;
      bookedEntries += wl.entryIds.length;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  revalidateAll();
  return {
    ok: errors.length === 0,
    bookedWorklogs,
    bookedEntries,
    errors,
    skipped,
  };
}

/** Books all not-yet-submitted entries of a day to Jira. */
export async function submitDayToJira(
  dayKeyStr: string,
): Promise<SubmitResult> {
  const { worklogs, skipped } = buildDayPlan(dayKeyStr);
  return postPlanToJira(worklogs, skipped);
}

/** Books all not-yet-submitted entries across every day. */
export async function submitAllOpenToJira(): Promise<SubmitResult> {
  const { worklogs, skipped } = buildAllOpenPlan();
  return postPlanToJira(worklogs, skipped);
}
