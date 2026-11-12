import { QueryClient } from "@tanstack/react-query";

/**
 * One client for the whole app. Everything is local and cheap to reload, so
 * there is no caching beyond the current render: data is stale at once, and a
 * mutation simply invalidates every query.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: false,
      refetchOnWindowFocus: true,
    },
  },
});

/** Reloads every query, after a mutation or a change made outside the UI. */
export function reloadAll(): void {
  void queryClient.invalidateQueries();
}

type Result<T> = { status: "ok"; data: T } | { status: "error"; error: string };

/** Turns a typed command result into a value or a thrown error, for `useQuery`. */
export async function orThrow<T>(p: Promise<Result<T>>): Promise<T> {
  const r = await p;
  if (r.status === "error") throw new Error(r.error);
  return r.data;
}
