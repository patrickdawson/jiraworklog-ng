"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  checkAwayTime,
  resolveAwayTime,
  type AwayCheck,
} from "@/lib/actions";
import { clockTime, formatHm } from "@/lib/format";

/**
 * Asks what to do with the running timer's time after the screen was locked or
 * the PC slept. The desktop app reports every away span; `checkAwayTime`
 * decides whether it is worth a question. No-op outside Electron.
 */
export function AwayDialog() {
  const router = useRouter();
  const [away, setAway] = useState<AwayCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const bridge = window.electron;
    if (!bridge) return;
    return bridge.onAwayEnded(async (period) => {
      try {
        const check = await checkAwayTime(period.from, period.to);
        if (!check) return;
        setError(null);
        setAway(check);
        void bridge.showWindow();
      } catch {
        // Server not reachable right after resume — the time stays as it is.
      }
    });
  }, []);

  if (!away) return null;

  const minutes =
    (new Date(away.awayTo).getTime() - new Date(away.awayFrom).getTime()) /
    60_000;

  async function cut(mode: "continue" | "stop") {
    if (!away) return;
    setPending(true);
    try {
      const res = await resolveAwayTime({
        entryId: away.entryId,
        awayFrom: away.awayFrom,
        awayTo: away.awayTo,
        mode,
      });
      if (!res.ok) {
        setError(res.message ?? "Abziehen fehlgeschlagen.");
        return;
      }
      setAway(null);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-24 px-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
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
        aria-label="Abwesenheit"
      >
        <div className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>
          Du warst {formatHm(minutes)} h weg
        </div>
        <div className="mt-2 text-[13px]" style={{ color: "var(--text-2)" }}>
          Von {clockTime(away.awayFrom)} bis {clockTime(away.awayTo)} lief der
          Timer „{away.description.trim() || "Ohne Beschreibung"}&rdquo; weiter.
          Soll diese Zeit abgezogen werden?
        </div>
        {error && (
          <div className="mt-3 text-[12.5px]" style={{ color: "var(--neg)" }}>
            {error}
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <DialogButton onClick={() => setAway(null)} disabled={pending}>
            Zeit behalten
          </DialogButton>
          <DialogButton onClick={() => cut("stop")} disabled={pending}>
            Abziehen und stoppen
          </DialogButton>
          <DialogButton onClick={() => cut("continue")} disabled={pending} primary>
            Abziehen und weiterlaufen
          </DialogButton>
        </div>
      </div>
    </div>
  );
}

function DialogButton({
  onClick,
  disabled,
  primary = false,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      autoFocus={primary}
      className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60"
      style={
        primary
          ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
          : {
              background: "var(--surface)",
              borderColor: "var(--border-strong)",
              color: "var(--text)",
            }
      }
    >
      {children}
    </button>
  );
}
