// View types of the entry analysis. Computed in Rust (crates/core/src/entries.rs);
// these are the shapes it sends.
import type { AllgemeinesCategory } from "@/bindings";

export type {
  DayGroup_Serialize as DayGroup,
  DescGroup_Serialize as DescGroup,
  EntryView_Serialize as EntryView,
  RecentEntry_Serialize as RecentEntry,
} from "@/bindings";

/**
 * Identity of "the same piece of work". Mirrors `desc_group_key` in Rust; the
 * UI only uses it for React keys and to match the running timer to a group.
 */
export function descGroupKey(v: {
  isAllgemeines: boolean;
  category: AllgemeinesCategory | null;
  description: string;
}): string {
  return `${v.isAllgemeines ? `A:${v.category ?? ""}` : "P"}|${v.description.trim()}`;
}

export type { BalancePoint, GroupTotal_Serialize as GroupTotal } from "@/bindings";

/** Whether a `YYYY-MM-DD` day key falls on a Saturday or Sunday. */
export function isWeekendKey(key: string): boolean {
  const [y, m, d] = key.split("-").map(Number);
  const weekday = new Date(y, m - 1, d).getDay();
  return weekday === 0 || weekday === 6;
}
