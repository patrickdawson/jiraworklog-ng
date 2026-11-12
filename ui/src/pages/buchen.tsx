import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { commands } from "@/bindings";
import { BuchenView } from "@/components/buchen-view";
import { orThrow } from "@/lib/query";
import { LoadError } from "@/pages/status";

/** Must match DEFAULT_HISTORY_DAYS in crates/core/src/entries.rs. */
const DEFAULT_HISTORY_DAYS = 30;

/**
 * `?days=all` shows everything; anything else falls back to the default
 * window, so a hand-edited URL cannot make the page unbounded by accident.
 */
function parseWindowDays(raw: string | null): number | null {
  if (raw === "all") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_HISTORY_DAYS;
}

export function BuchenPage() {
  const [params] = useSearchParams();
  const days = parseWindowDays(params.get("days"));
  const query = useQuery({
    queryKey: ["buchen", days],
    queryFn: () => orThrow(commands.buchenData(days)),
    placeholderData: (previous) => previous,
  });

  if (query.error) return <LoadError error={query.error} />;
  if (!query.data) return null;
  const data = query.data;
  return (
    <BuchenView
      data={{
        ...data,
        history: {
          windowDays: data.history.windowDays ?? "all",
          hiddenOlderCount: data.history.hiddenOlderCount,
        },
      }}
    />
  );
}
