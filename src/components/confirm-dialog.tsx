"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * In-app replacement for `window.confirm`.
 *
 * The native dialog breaks keyboard input in Electron on Windows: after it
 * closes, inputs still take clicks but no longer receive keystrokes until the
 * window loses and regains focus (Alt+Tab). Every confirmation goes through
 * this provider instead. Every current caller confirms a delete, hence the
 * "Löschen" label.
 */
type Confirm = (message: string) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error("useConfirm must be used inside ConfirmProvider");
  return confirm;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const resolveRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((next) => {
    // A second request while one is open answers the first with "no".
    resolveRef.current?.(false);
    setMessage(next);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  function answer(ok: boolean) {
    resolveRef.current?.(ok);
    resolveRef.current = null;
    setMessage(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {message !== null && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center pt-24 px-4"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => answer(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border p-5"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              boxShadow: "var(--shadow-lg)",
            }}
            role="alertdialog"
            aria-modal="true"
            aria-label="Bestätigen"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                answer(false);
              }
            }}
          >
            <div className="text-[14px]" style={{ color: "var(--text)" }}>
              {message}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => answer(false)}
                className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold"
                style={{
                  background: "var(--surface)",
                  color: "var(--text)",
                  borderColor: "var(--border-strong)",
                }}
              >
                Abbrechen
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => answer(true)}
                className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold"
                style={{
                  background: "var(--surface)",
                  color: "var(--neg)",
                  borderColor: "var(--neg)",
                }}
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
