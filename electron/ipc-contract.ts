/**
 * Shared IPC boundary contract between the Electron shell (the HTTP *client*)
 * and the embedded Next.js server (the HTTP *server*). Kept dependency-free so
 * it can be compiled by both `tsconfig.electron.json` and the Next app without
 * dragging server code (drizzle, node:crypto) into the desktop bundle.
 *
 * Both sides MUST agree on these; this file is the single source of truth.
 */

/** Header carrying the per-launch shared secret on internal timer requests. */
export const IPC_SECRET_HEADER = "x-jwl-secret";

/**
 * Payload of the `away-ended` push event: the span (ISO timestamps) in which
 * the screen was locked or the PC slept. The renderer decides whether it
 * matters (setting on, timer running, long enough).
 */
export type AwayPeriod = { from: string; to: string };

/**
 * Wire shape of `GET /api/timer/status`. `category` is the `AllgemeinesCategory`
 * union at the source (see `src/db/schema.ts`) but is widened to `string` here
 * to keep this contract free of server-side imports.
 */
export type TimerStatus =
  | { running: false }
  | {
      running: true;
      description: string;
      startedAt: string;
      isAllgemeines: boolean;
      category: string | null;
      effectiveSeconds: number;
    };
