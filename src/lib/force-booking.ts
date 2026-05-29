import "server-only";

/**
 * Runtime-only "force booking" switch. When enabled, the Jira booking flow also
 * (re-)submits entries that were already booked ("gebucht"). This is deliberately
 * NOT persisted: it lives in process memory and resets to `false` on every app
 * restart, so a dangerous double-booking mode can never be left on across sessions.
 *
 * Stored on `globalThis` so the value survives Next.js module reloads (HMR) within
 * a single running process, while still resetting on a real restart.
 */
const KEY = Symbol.for("jwl.forceBookingEnabled");

type Store = { [KEY]?: boolean };

const store = globalThis as unknown as Store;

export function isForceBookingEnabled(): boolean {
  return store[KEY] ?? false;
}

export function setForceBookingState(enabled: boolean): void {
  store[KEY] = enabled;
}
