import { EmptyState, PageHeader } from "@/components/ui";

/** Shown when a page's data could not be loaded. */
export function LoadError({ error }: { error: Error }) {
  return (
    <main className="px-8 py-7">
      <div
        className="rounded-lg border px-4 py-3 text-[13px]"
        style={{ background: "var(--neg-soft)", borderColor: "var(--neg)", color: "var(--neg)" }}
      >
        Laden fehlgeschlagen: {error.message}
      </div>
    </main>
  );
}

/** Placeholder for the pages that later milestones port. */
export function NotPortedYet({ title }: { title: string }) {
  return (
    <main className="px-8 py-7">
      <PageHeader title={title} />
      <EmptyState
        title="Noch nicht portiert"
        description="Diese Seite folgt in einem späteren Schritt der Tauri-Umstellung."
      />
    </main>
  );
}
