import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLocation, useNavigate, useSearchParams as useRouterSearchParams } from "react-router";

/**
 * Stand-in for `next/navigation`. `refresh()` used to re-run the server
 * components; here it reloads every query, which is the same thing.
 */
export function useRouter() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMemo(
    () => ({
      push: (href: string) => void navigate(href),
      replace: (href: string) => void navigate(href, { replace: true }),
      refresh: () => void queryClient.invalidateQueries(),
    }),
    [navigate, queryClient],
  );
}

export function usePathname(): string {
  return useLocation().pathname;
}

export function useSearchParams(): URLSearchParams {
  return useRouterSearchParams()[0];
}
