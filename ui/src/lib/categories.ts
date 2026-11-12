import type { AllgemeinesCategory } from "@/bindings";

/** Categories an "Allgemeines" entry can be assigned to for the monthly report. */
export const ALLGEMEINES_CATEGORIES = [
  "Projektorganisation",
  "Implementierung",
  "QA",
  "Release",
] as const satisfies readonly AllgemeinesCategory[];
