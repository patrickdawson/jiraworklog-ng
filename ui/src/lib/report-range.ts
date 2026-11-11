// Report periods are resolved in Rust (crates/core/src/report_range.rs); the
// UI only builds the links between them.
import type { RangeKind } from "@/bindings";

export type { RangeKind, ResolvedRange_Serialize as ResolvedRange } from "@/bindings";

/** Builds the search string for `/auswertung?...` for a given range. */
export function rangeQuery(kind: RangeKind, anchor: string): string {
  const params = new URLSearchParams({ range: kind });
  if (kind !== "all" && anchor) params.set("anchor", anchor);
  return `?${params.toString()}`;
}
