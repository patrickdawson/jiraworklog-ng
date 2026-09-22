"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { effectiveDurationSeconds, type BreakWindow } from "@/lib/work-time";

/**
 * The ticking clock, held above the page tree instead of inside it.
 *
 * The point is what does *not* happen: `children` is a JSX element created
 * during the caller's render, so its identity survives a `setNow`. React
 * therefore bails out of the whole subtree and re-renders only the components
 * that actually called `useNow`/`useRunningSeconds`. Without this the 1 Hz tick
 * re-rendered every day section, group and entry row in the entire history —
 * a cost that grew with every entry ever tracked.
 *
 * `React.memo` would not help here and is not needed: context consumers
 * re-render whether memoized or not, and non-consumers do not re-render at all.
 */
const NowContext = createContext<Date | null>(null);

export function NowProvider({
  active,
  children,
}: {
  /** Whether a timer is running. When false the clock stops ticking. */
  active: boolean;
  children: ReactNode;
}) {
  // Initialized to null so SSR and first client render agree, then set on mount.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const initial = setTimeout(() => setNow(new Date()), 0);
    if (!active) return () => clearTimeout(initial);
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(id);
    };
  }, [active]);

  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

/** The current time, or `null` before the first client tick. */
export function useNow(): Date | null {
  return useContext(NowContext);
}

/** Effective seconds tracked by the running timer so far; 0 when none runs. */
export function useRunningSeconds(
  running: { startedAt: string } | null,
  breaks: BreakWindow[],
  autoPauseEnabled: boolean,
): number {
  const now = useNow();
  const startedAt = running?.startedAt ?? null;
  return useMemo(() => {
    if (!startedAt || !now) return 0;
    return effectiveDurationSeconds(
      startedAt,
      null,
      breaks,
      autoPauseEnabled,
      now,
    );
  }, [startedAt, breaks, autoPauseEnabled, now]);
}
