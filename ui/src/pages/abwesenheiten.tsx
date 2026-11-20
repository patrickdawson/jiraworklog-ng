import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { commands } from "@/bindings";
import { AbsenceDialog, absenceSpanLabel } from "@/components/absence-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { deleteAbsence, type Absence } from "@/lib/actions";
import { dayKey } from "@/lib/format";
import { orThrow } from "@/lib/query";
import { LoadError } from "@/pages/status";

/** Every absence, with edit and delete. New ones also come from the Kalender. */
export function AbwesenheitenPage() {
  const query = useQuery({
    queryKey: ["absences"],
    queryFn: () => orThrow(commands.listAbsences()),
  });
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<{ absence: Absence } | { day: string } | null>(null);

  if (query.error) return <LoadError error={query.error} />;
  if (!query.data) return null;

  async function onDelete(a: Absence) {
    if (!(await confirm(`${a.kind} ${absenceSpanLabel(a)} wirklich löschen?`))) return;
    await deleteAbsence(a.id);
  }

  return (
    <main className="px-4 py-5 sm:px-8 sm:py-7 max-w-[900px]">
      <PageHeader
        title="Abwesenheiten"
        subtitle="Urlaub, Krankheit und Feiertage. Du kannst sie auch im Kalender eintragen: Klicke auf einen Tag."
        actions={
          <button
            type="button"
            onClick={() => setDialog({ day: dayKey(new Date()) })}
            className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold"
            style={{
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "#fff",
            }}
          >
            Neue Abwesenheit
          </button>
        }
      />

      <Card padded={false}>
        {query.data.length === 0 ? (
          <EmptyState
            title="Noch keine Abwesenheiten"
            description="Klicke im Kalender auf einen Tag oder oben auf „Neue Abwesenheit“."
          />
        ) : (
          <ul>
            {query.data.map((a, i) => (
              <li
                key={a.id}
                data-testid="absence-row"
                className="flex items-center gap-3 px-5 py-3 text-[13px]"
                style={{ borderTop: i === 0 ? undefined : "1px solid var(--border)" }}
              >
                <span className="font-semibold tabular-nums min-w-[200px]">
                  {absenceSpanLabel(a)}
                </span>
                <Badge>{a.kind}</Badge>
                <span style={{ color: "var(--text-2)" }}>
                  {a.workdays === 1 ? "1 Arbeitstag" : `${a.workdays} Arbeitstage`}
                </span>
                <span className="flex-1 truncate" style={{ color: "var(--text-3)" }}>
                  {a.note}
                </span>
                <IconButton
                  label={`${absenceSpanLabel(a)} bearbeiten`}
                  onClick={() => setDialog({ absence: a })}
                >
                  <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
                </IconButton>
                <IconButton
                  label={`${absenceSpanLabel(a)} löschen`}
                  onClick={() => void onDelete(a)}
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog && <AbsenceDialog {...dialog} onClose={() => setDialog(null)} />}
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
