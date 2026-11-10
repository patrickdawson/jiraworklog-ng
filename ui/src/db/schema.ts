// The types and constants the ported components imported from the Next app's
// drizzle schema. The source of truth is now Rust (see bindings.ts).
import type { AllgemeinesCategory } from "@/bindings";

export type {
  AllgemeinesCategory,
  BookingMode,
  JiraAuthMode,
  ThemeMode,
} from "@/bindings";

/** Categories an "Allgemeines" entry can be assigned to for the monthly report. */
export const ALLGEMEINES_CATEGORIES = [
  "Projektorganisation",
  "Implementierung",
  "QA",
  "Release",
] as const satisfies readonly AllgemeinesCategory[];
