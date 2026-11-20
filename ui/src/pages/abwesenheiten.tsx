import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { commands } from "@/bindings";
import { useConfirm } from "@/components/confirm-dialog";
import { Field, Select, TextInput } from "@/components/einstellungen-form";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import {
  createAbsence,
  deleteAbsence,
  updateAbsence,
  type Absence,
  type AbsenceKind,
} from "@/lib/actions";
import { orThrow } from "@/lib/query";
import { LoadError } from "@/pages/status";

const KINDS: { value: AbsenceKind; label: string }[] = [
  { value: "Urlaub", label: "Urlaub" },
  { value: "Krank", label: "Krank" },
  { value: "Feiertag", label: "Feiertag" },
];

type Draft = { fromDay: string; toDay: string; kind: AbsenceKind; note: string };

const EMPTY: Draft = { fromDay: "", toDay: "", kind: "Urlaub", note: "" };

/** `2026-12-02` → `02.12.2026`. */
function german(key: string): string {
  return key.split("-").reverse().join(".");
}

function spanLabel(a: Absence): string {
  return a.fromDay === a.toDay
    ? german(a.fromDay)
    : `${german(a.fromDay)} – ${german(a.toDay)}`;
}

export function AbwesenheitenPage() {
  const query = useQuery({
    queryKey: ["absences"],
    queryFn: () => orThrow(commands.listAbsences()),
  });
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (query.error) return <LoadError error={query.error} />;
  if (!query.data) return null;

  function setFrom(fromDay: string) {
    // A single day is the common case: "Bis" follows "Von" until it is later.
    setDraft((d) => ({
      ...d,
      fromDay,
      toDay: !d.toDay || d.toDay < fromDay ? fromDay : d.toDay,
    }));
  }

  function reset() {
    setDraft(EMPTY);
    setEditingId(null);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.fromDay || !draft.toDay) {
      setError("Bitte „Von“ und „Bis“ angeben.");
      return;
    }
    setPending(true);
    const res =
      editingId === null
        ? await createAbsence(draft)
        : await updateAbsence(editingId, draft);
    setPending(false);
    if (res.ok) reset();
    else setError(res.message ?? "Speichern fehlgeschlagen.");
  }

  function onEdit(a: Absence) {
    setDraft({ fromDay: a.fromDay, toDay: a.toDay, kind: a.kind, note: a.note });
    setEditingId(a.id);
    setError(null);
  }

  async function onDelete(a: Absence) {
    if (!(await confirm(`${a.kind} ${spanLabel(a)} wirklich löschen?`))) return;
    await deleteAbsence(a.id);
    if (editingId === a.id) reset();
  }

  return (
    <main className="px-4 py-5 sm:px-8 sm:py-7 max-w-[900px]">
      <PageHeader
        title="Abwesenheiten"
        subtitle="Urlaub, Krankheit und Feiertage zählen nicht in „Ø Arbeitszeit / Woche“."
      />

      <div className="mb-5">
        <Card>
          <div className="text-[14px] font-semibold mb-4">
            {editingId === null ? "Neue Abwesenheit" : "Abwesenheit bearbeiten"}
          </div>
          <form onSubmit={onSubmit}>
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">
              <Field label="Von">
                <TextInput type="date" value={draft.fromDay} onChange={setFrom} />
              </Field>
              <Field label="Bis">
                <TextInput
                  type="date"
                  value={draft.toDay}
                  onChange={(toDay) => setDraft((d) => ({ ...d, toDay }))}
                />
              </Field>
              <Field label="Art">
                <Select
                  value={draft.kind}
                  onChange={(kind) => setDraft((d) => ({ ...d, kind: kind as AbsenceKind }))}
                  options={KINDS}
                />
              </Field>
            </div>
            <Field label="Notiz (optional)">
              <TextInput
                value={draft.note}
                onChange={(note) => setDraft((d) => ({ ...d, note }))}
              />
            </Field>
            {error && (
              <div
                role="alert"
                className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]"
                style={{
                  background: "var(--neg-soft)",
                  borderColor: "var(--neg)",
                  color: "var(--neg)",
                }}
              >
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2.5">
              {editingId !== null && (
                <button
                  type="button"
                  onClick={reset}
                  disabled={pending}
                  className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60"
                  style={{
                    background: "var(--surface)",
                    borderColor: "var(--border-strong)",
                    color: "var(--text)",
                  }}
                >
                  Abbrechen
                </button>
              )}
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60"
                style={{
                  background: "var(--accent)",
                  borderColor: "var(--accent)",
                  color: "#fff",
                }}
              >
                {editingId === null ? "Hinzufügen" : "Speichern"}
              </button>
            </div>
          </form>
        </Card>
      </div>

      <Card padded={false}>
        {query.data.length === 0 ? (
          <EmptyState
            title="Noch keine Abwesenheiten"
            description="Trage oben Urlaub, Krankheit oder einen Feiertag ein."
          />
        ) : (
          <ul>
            {query.data.map((a, i) => (
              <li
                key={a.id}
                data-testid="absence-row"
                className="flex items-center gap-3 px-5 py-3 text-[13px]"
                style={{
                  borderTop: i === 0 ? undefined : "1px solid var(--border)",
                  background: a.id === editingId ? "var(--surface-2)" : undefined,
                }}
              >
                <span className="font-semibold tabular-nums min-w-[200px]">
                  {spanLabel(a)}
                </span>
                <Badge>{a.kind}</Badge>
                <span style={{ color: "var(--text-2)" }}>
                  {a.workdays === 1 ? "1 Arbeitstag" : `${a.workdays} Arbeitstage`}
                </span>
                <span className="flex-1 truncate" style={{ color: "var(--text-3)" }}>
                  {a.note}
                </span>
                <IconButton label={`${spanLabel(a)} bearbeiten`} onClick={() => onEdit(a)}>
                  <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
                </IconButton>
                <IconButton label={`${spanLabel(a)} löschen`} onClick={() => void onDelete(a)}>
                  <path d="M6 6l12 12M18 6L6 18" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5"
      style={{ color: "var(--text-2)" }}
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
    </button>
  );
}
