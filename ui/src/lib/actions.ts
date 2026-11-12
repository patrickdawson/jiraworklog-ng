// The UI's mutations, backed by Tauri commands. Every mutation reloads all
// queries afterwards, so every page shows the new state.
import {
  commands,
  type AllgemeinesCategory,
  type AwayCheck,
  type BookingPlan,
  type GroupColor,
  type GroupEntriesPage,
  type SettingsInput_Serialize,
  type StartTimerResult,
  type StopTimerResult,
  type SubmitResult_Serialize,
} from "@/bindings";
import { orThrow, queryClient } from "@/lib/query";

export type { StartTimerResult, StopTimerResult };
export type ActionResult = { ok: boolean; message?: string };

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: string };

function revalidateAll(): void {
  void queryClient.invalidateQueries();
}

/** For actions whose old version threw on failure. */
async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  revalidateAll();
  if (r.status === "error") throw new Error(r.error);
  return r.data;
}

/** For actions whose old version returned `{ ok, message }`. */
async function toActionResult(p: Promise<Result<unknown>>): Promise<ActionResult> {
  const r = await p;
  revalidateAll();
  return r.status === "ok" ? { ok: true } : { ok: false, message: r.error };
}

// ── Timer ───────────────────────────────────────────────────────────────────

export function startTimer(
  description: string,
  isAllgemeines = false,
  category: AllgemeinesCategory | null = null,
): Promise<StartTimerResult> {
  return unwrap(commands.startTimer(description ?? "", isAllgemeines, category));
}

export function stopTimer(): Promise<StopTimerResult> {
  return unwrap(commands.stopTimer());
}

export async function updateRunningDescription(description: string): Promise<void> {
  await unwrap(commands.updateRunningDescription(description ?? ""));
}

export async function updateRunningAllgemeines(
  isAllgemeines: boolean,
  category: AllgemeinesCategory | null = null,
): Promise<void> {
  await unwrap(commands.updateRunningAllgemeines(isAllgemeines, category));
}

export async function updateRunningCategory(category: AllgemeinesCategory): Promise<void> {
  await unwrap(commands.updateRunningCategory(category));
}

export function updateRunningStartedAt(startedAtIso: string): Promise<ActionResult> {
  return toActionResult(commands.updateRunningStartedAt(startedAtIso));
}

// ── Away ────────────────────────────────────────────────────────────────────

export type { AwayCheck };

/** Whether an away span is worth a question; null when not. */
export function checkAwayTime(awayFromIso: string, awayToIso: string): Promise<AwayCheck | null> {
  return orThrow(commands.checkAwayTime({ from: awayFromIso, to: awayToIso }));
}

export function resolveAwayTime(input: {
  entryId: number;
  awayFrom: string;
  awayTo: string;
  mode: "continue" | "stop";
}): Promise<ActionResult> {
  return toActionResult(commands.resolveAwayTime(input));
}

// ── Entries ─────────────────────────────────────────────────────────────────

type EntryFields = {
  description: string;
  startedAt?: string;
  endedAt?: string;
  isAllgemeines?: boolean;
  category?: AllgemeinesCategory | null;
};

function entryInput(input: EntryFields) {
  return {
    description: input.description ?? "",
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    isAllgemeines: input.isAllgemeines ?? null,
    category: input.category ?? null,
  };
}

export function createManualEntry(input: EntryFields & { startedAt: string; endedAt: string }): Promise<ActionResult> {
  return toActionResult(commands.createManualEntry(entryInput(input)));
}

export function updateEntry(id: number, input: EntryFields): Promise<ActionResult> {
  return toActionResult(commands.updateEntry(id, entryInput(input)));
}

export function updateEntries(
  ids: number[],
  input: { description: string; isAllgemeines: boolean; category: AllgemeinesCategory | null },
): Promise<ActionResult> {
  return toActionResult(commands.updateEntries(ids, input));
}

export async function deleteEntry(id: number): Promise<void> {
  await unwrap(commands.deleteEntry(id));
}

export async function setGroupColor(groupKey: string, color: GroupColor | null): Promise<void> {
  await unwrap(commands.setGroupColor(groupKey, color));
}

// ── Settings ────────────────────────────────────────────────────────────────

export type SettingsInput = SettingsInput_Serialize;

const INTEGER_FIELDS = [
  "regularWorkMinutes",
  "dailyTargetMinutes",
  "dataRetentionDays",
  "overtimeBaselineMinutes",
  "sprintLengthDays",
  "concreteIssueTargetPercent",
  "overtimeCorridorCenterHours",
  "overtimeCorridorRangeHours",
] as const;

/**
 * Saves the settings form. Rust checks the ranges; numbers that are no
 * 32-bit integers would fail while the command's arguments are read, with a
 * technical text, so they get the old zod message here.
 */
export function updateSettings(input: SettingsInput): Promise<ActionResult> {
  const isI32 = (n: number) => Number.isInteger(n) && n >= -(2 ** 31) && n < 2 ** 31;
  if (!INTEGER_FIELDS.every((k) => isI32(input[k]))) {
    return Promise.resolve({ ok: false, message: "Ungültige Einstellungen." });
  }
  return toActionResult(commands.updateSettings(input));
}

// ── Jira ────────────────────────────────────────────────────────────────────

export type { PlannedWorklog, SkippedEntry } from "@/bindings";
export type DayBookingPlan = BookingPlan;
export type SubmitResult = Omit<SubmitResult_Serialize, "message"> & { message?: string };

function toSubmitResult(r: SubmitResult_Serialize): SubmitResult {
  const { message, ...rest } = r;
  return message == null ? rest : { ...rest, message };
}

/** Returns what would be booked for a day, without sending anything. */
export function previewDayBooking(dayKey: string): Promise<DayBookingPlan> {
  return orThrow(commands.previewDayBooking(dayKey));
}

/** Same as previewDayBooking, but across all days with open entries. */
export function previewAllOpenBooking(): Promise<DayBookingPlan> {
  return orThrow(commands.previewAllOpenBooking());
}

/** Books all not-yet-submitted entries of a day to Jira. */
export async function submitDayToJira(dayKey: string): Promise<SubmitResult> {
  return toSubmitResult(await unwrap(commands.submitDayToJira(dayKey)));
}

/** Books all not-yet-submitted entries across every day. */
export async function submitAllOpenToJira(): Promise<SubmitResult> {
  return toSubmitResult(await unwrap(commands.submitAllOpenToJira()));
}

/** Tests Jira credentials without persisting them. */
export async function testJiraConnection(input: {
  jiraUrl: string;
  jiraToken: string | null;
  jiraUser: string | null;
  jiraPassword?: string | null;
}): Promise<ActionResult> {
  const r = await commands.testJiraConnection({ ...input, jiraPassword: input.jiraPassword ?? null });
  return r.status === "ok" ? r.data : { ok: false, message: r.error };
}

/** Reads the runtime-only force-booking switch (not persisted). */
export function getForceBooking(): Promise<boolean> {
  return commands.getForceBooking();
}

/** Toggles force booking: also re-book submitted entries. Off again after a restart. */
export async function setForceBooking(enabled: boolean): Promise<void> {
  await commands.setForceBooking(enabled);
  revalidateAll();
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/** Deletes finished entries older than `days`, rolling their overtime into the baseline. */
export async function cleanupOldEntries(days: number): Promise<{
  ok: boolean;
  deleted: number;
  overtimeRolledMinutes: number;
  message?: string;
}> {
  if (!Number.isFinite(days) || days < 1) {
    return { ok: false, deleted: 0, overtimeRolledMinutes: 0, message: "Ungültige Tagesangabe." };
  }
  // Whole days; anything beyond ~270 years deletes nothing anyway.
  const r = await unwrap(commands.cleanupOldEntries(Math.min(Math.ceil(days), 100_000)));
  const { message, ...rest } = r;
  return message == null ? rest : { ...rest, message };
}

// ── Auswertung ──────────────────────────────────────────────────────────────

export type { GroupEntriesPage, GroupEntry } from "@/bindings";

/** One page of the finished entries of a "Zeit pro Ticket" bar, newest first. */
export function getGroupEntries(input: {
  fromIso: string;
  toIso: string;
  groupId: string;
  offset: number;
}): Promise<GroupEntriesPage> {
  return orThrow(commands.groupEntries(input));
}
