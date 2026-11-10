// The server actions of the Next app, with the same names and signatures, now
// backed by Tauri commands. Every mutation reloads all queries afterwards,
// which replaces Next's `revalidatePath`.
import {
  commands,
  type AllgemeinesCategory,
  type GroupColor,
  type StartTimerResult,
  type StopTimerResult,
} from "@/bindings";
import { queryClient } from "@/lib/query";

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

// ── Jira booking (milestone 6) ──────────────────────────────────────────────

export type PlannedWorklog = {
  issueKey: string;
  timeSpent: string;
  minutes: number;
  comment: string;
  entryCount: number;
};
export type SkippedEntry = { description: string; reason: string };
export type DayBookingPlan = { worklogs: PlannedWorklog[]; skipped: SkippedEntry[] };
export type SubmitResult = {
  ok: boolean;
  bookedWorklogs: number;
  bookedEntries: number;
  errors: string[];
  skipped: SkippedEntry[];
  message?: string;
};

const NOT_YET = "Die Jira-Buchung ist in der neuen App noch nicht verfügbar.";

export async function previewDayBooking(dayKey: string): Promise<DayBookingPlan> {
  void dayKey;
  return { worklogs: [], skipped: [{ description: "Jira", reason: NOT_YET }] };
}

export function previewAllOpenBooking(): Promise<DayBookingPlan> {
  return previewDayBooking("");
}

export async function submitDayToJira(dayKey: string): Promise<SubmitResult> {
  void dayKey;
  return { ok: false, bookedWorklogs: 0, bookedEntries: 0, errors: [], skipped: [], message: NOT_YET };
}

export function submitAllOpenToJira(): Promise<SubmitResult> {
  return submitDayToJira("");
}
