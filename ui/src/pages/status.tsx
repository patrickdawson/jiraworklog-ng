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
