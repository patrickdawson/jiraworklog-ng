import { z } from "zod";
import type { AllgemeinesCategory } from "@/db/schema";

/**
 * Palette a group can be colored with. Each name maps to the CSS tokens
 * `--gc-<name>` and `--gc-<name>-soft` in `globals.css`, which carry a light
 * and a dark shade.
 */
export const GROUP_COLORS = [
  "indigo",
  "teal",
  "rose",
  "amber",
  "green",
  "sky",
  "purple",
  "slate",
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const groupColorSchema = z.enum(GROUP_COLORS);

export const GROUP_COLOR_LABELS: Record<GroupColor, string> = {
  indigo: "Indigo",
  teal: "Türkis",
  rose: "Rot",
  amber: "Orange",
  green: "Grün",
  sky: "Blau",
  purple: "Lila",
  slate: "Grau",
};

/** Group key → palette color, as loaded by `getGroupColors()`. */
export type GroupColorMap = Record<string, GroupColor>;

/**
 * The key a color is stored under: the issue key for concrete entries, the
 * category for Allgemeines. Concrete entries without an issue key have no group.
 */
export function groupColorKey(e: {
  isAllgemeines: boolean;
  category: AllgemeinesCategory | null;
  issueKey: string | undefined;
}): string | null {
  if (e.isAllgemeines) return e.category ? `cat:${e.category}` : null;
  return e.issueKey ? `issue:${e.issueKey.toUpperCase()}` : null;
}

/** Looks up an entry's group: its key, stored color and CSS colors. */
export function resolveGroupColor(
  colors: GroupColorMap,
  e: Parameters<typeof groupColorKey>[0],
): { key: string | null; color: GroupColor | undefined; accent: string; soft: string } {
  const key = groupColorKey(e);
  const color = key ? colors[key] : undefined;
  return { key, color, ...groupColorVars(color, e.isAllgemeines) };
}

/** Strong and soft CSS colors for a group, falling back to teal/accent. */
export function groupColorVars(
  color: GroupColor | undefined,
  isAllgemeines: boolean,
): { accent: string; soft: string } {
  if (color) {
    return { accent: `var(--gc-${color})`, soft: `var(--gc-${color}-soft)` };
  }
  return isAllgemeines
    ? { accent: "var(--teal)", soft: "var(--teal-soft)" }
    : { accent: "var(--accent)", soft: "var(--accent-soft)" };
}
