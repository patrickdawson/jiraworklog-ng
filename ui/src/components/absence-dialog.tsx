/**
 * Enter or change an absence (Urlaub, Krank, Feiertag). Opened from a day
 * header in the Kalender and from the Abwesenheiten page.
 */

import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { Button, Field, Modal, TextInput } from "@/components/entry-dialogs";
import {
  createAbsence,
  deleteAbsence,
  updateAbsence,
  type Absence,
  type AbsenceKind,
} from "@/lib/actions";

const KINDS: AbsenceKind[] = ["Urlaub", "Krank", "Feiertag"];

/** `2026-12-02` → `02.12.2026`. */
function german(key: string): string {
  return key.split("-").reverse().join(".");
}

/** `02.12.2026` or `02.12.2026 – 05.12.2026`. */
export function absenceSpanLabel(a: Absence): string {
  return a.fromDay === a.toDay
    ? german(a.fromDay)
    : `${german(a.fromDay)} – ${german(a.toDay)}`;
}

/**
 * With `absence` it edits that absence; otherwise it starts a new one on
 * `day` (`YYYY-MM-DD`).
 */
export function AbsenceDialog({
  onClose,
  ...target
}: ({ absence: Absence } | { day: string }) & { onClose: () => void }) {
  const absence = "absence" in target ? target.absence : null;
  const day = "day" in target ? target.day : "";
  const [fromDay, setFromDay] = useState(absence?.fromDay ?? day);
  const [toDay, setToDay] = useState(absence?.toDay ?? day);
  const [kind, setKind] = useState<AbsenceKind>(absence?.kind ?? "Urlaub");
  const [note, setNote] = useState(absence?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirm = useConfirm();

  function onFromChange(value: string) {
    setFromDay(value);
    // A single day is the common case: "Bis" follows "Von" until it is later.
    if (!toDay || toDay < value) setToDay(value);
  }

  async function onSave() {
    if (!fromDay || !toDay) {
      setError("Bitte „Von“ und „Bis“ angeben.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const input = { fromDay, toDay, kind, note };
      const res = absence
        ? await updateAbsence(absence.id, input)
        : await createAbsence(input);
      if (res.ok) onClose();
      else setError(res.message ?? "Speichern fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function onDelete() {
    if (!absence) return;
    if (!(await confirm(`${absence.kind} ${absenceSpanLabel(absence)} wirklich löschen?`))) {
      return;
    }
    setPending(true);
    try {
      await deleteAbsence(absence.id);
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      title={absence ? "Abwesenheit bearbeiten" : "Abwesenheit eintragen"}
      onClose={onClose}
    >
      <form
        className="space-y-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
      >
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <Field label="Von">
            <TextInput type="date" value={fromDay} onChange={onFromChange} />
          </Field>
          <Field label="Bis">
            <TextInput type="date" value={toDay} onChange={setToDay} />
          </Field>
          <Field label="Art">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as AbsenceKind)}
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
              style={{
                background: "var(--surface-2)",
                borderColor: "var(--border-strong)",
                color: "var(--text)",
              }}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Notiz (optional)">
          <TextInput value={note} onChange={setNote} />
        </Field>
        {error && (
          <div role="alert" className="text-[13px]" style={{ color: "var(--neg)" }}>
            {error}
          </div>
        )}
        <div className="flex justify-between gap-2.5 pt-2">
          {absence ? (
            <Button variant="danger" onClick={onDelete} disabled={pending}>
              Löschen
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2.5">
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" type="submit" disabled={pending}>
              Speichern
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
