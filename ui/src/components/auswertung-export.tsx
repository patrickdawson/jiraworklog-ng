// The period controls and the PDF exports of the Auswertung page.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { commands } from "@/bindings";
import { rangeQuery, type ResolvedRange } from "@/lib/report-range";

const buttonBase: CSSProperties = {
  cursor: "pointer",
  background: "var(--surface)",
  borderColor: "var(--border-strong)",
  color: "var(--text)",
};

const buttonAccent: CSSProperties = {
  cursor: "pointer",
  background: "var(--accent)",
  borderColor: "var(--accent)",
  color: "#fff",
};

const buttonDisabled: CSSProperties = {
  cursor: "not-allowed",
  opacity: 0.5,
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--text-2)",
};

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      className="animate-spin"
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="4"
        fill="none"
      />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowLink({
  href,
  disabled,
  children,
  ariaLabel,
}: {
  href: string | null;
  disabled: boolean;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  const className =
    "rounded-lg border px-2.5 py-1.5 text-[13px] font-semibold leading-none";
  if (disabled || href === null) {
    return (
      <span className={className} style={buttonDisabled} aria-label={ariaLabel}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={className}
      style={buttonBase}
      aria-label={ariaLabel}
    >
      {children}
    </Link>
  );
}

function AnchorPicker({ resolved }: { resolved: ResolvedRange }) {
  const router = useRouter();

  if (resolved.kind === "all") return null;

  const inputClassName =
    "rounded-lg border px-2.5 py-1.5 text-[13px] min-w-0 flex-1 sm:flex-none";
  const inputStyle: CSSProperties = {
    background: "var(--surface)",
    borderColor: "var(--border-strong)",
    color: "var(--text)",
  };

  if (resolved.kind === "ytd") {
    const year = Number(resolved.anchor.slice(0, 4));
    return (
      <input
        type="number"
        min={2000}
        max={2100}
        value={year}
        onChange={(e) => {
          const y = Number(e.target.value);
          if (!Number.isFinite(y) || y < 2000 || y > 2100) return;
          router.push(`/auswertung${rangeQuery("ytd", `${y}-01-01`)}`);
        }}
        className={`${inputClassName} sm:w-[88px]`}
        style={inputStyle}
        aria-label="Jahr"
      />
    );
  }

  if (resolved.kind === "month") {
    return (
      <input
        type="month"
        value={resolved.anchor.slice(0, 7)}
        onChange={(e) => {
          const value = e.target.value;
          if (!/^\d{4}-\d{2}$/.test(value)) return;
          router.push(
            `/auswertung${rangeQuery("month", `${value}-01`)}`,
          );
        }}
        className={inputClassName}
        style={inputStyle}
        aria-label="Monat"
      />
    );
  }

  if (resolved.kind === "sprint") {
    return (
      <input
        type="date"
        value={resolved.anchor}
        onChange={(e) => {
          const value = e.target.value;
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
          router.push(`/auswertung${rangeQuery("sprint", value)}`);
        }}
        className={inputClassName}
        style={inputStyle}
        aria-label="Tag im Sprint"
      />
    );
  }

  // week
  return (
    <input
      type="date"
      value={resolved.anchor}
      onChange={(e) => {
        const value = e.target.value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
        router.push(`/auswertung${rangeQuery("week", value)}`);
      }}
      className={inputClassName}
      style={inputStyle}
      aria-label="Tag in der Woche"
    />
  );
}

/** First day (`YYYY-MM-01`) of the month the resolved range points at. */
function monthAnchor(resolved: ResolvedRange): string {
  const base = resolved.anchor || new Date().toISOString().slice(0, 10);
  return `${base.slice(0, 7)}-01`;
}

type SaveResult =
  | { status: "ok"; data: string | null }
  | { status: "error"; error: string };

/**
 * Rust renders the PDF, then asks where to save it (native "Speichern unter"
 * with the file name filled in, like the Electron download) and writes it.
 * Cancelling the dialog is not an error.
 */
async function savePdf(result: Promise<SaveResult>): Promise<void> {
  const r = await result;
  if (r.status === "error") throw new Error(r.error);
}

export function RangeControls({ resolved }: { resolved: ResolvedRange }) {
  const [loading, setLoading] = useState(false);
  const [loadingMonth, setLoadingMonth] = useState(false);
  // Shown inline: a native alert() would block the window.
  const [exportError, setExportError] = useState<string | null>(null);

  const prevHref =
    resolved.prevAnchor !== null ? rangeQuery(resolved.kind, resolved.prevAnchor) : null;
  const nextHref =
    resolved.nextAnchor !== null ? rangeQuery(resolved.kind, resolved.nextAnchor) : null;
  const todayHref =
    resolved.kind === "all" ? null : rangeQuery(resolved.kind, "");

  async function onExport() {
    setLoading(true);
    setExportError(null);
    try {
      const anchor =
        resolved.kind !== "all" && resolved.anchor ? resolved.anchor : null;
      await savePdf(commands.exportWorklogPdf(resolved.kind, anchor));
    } catch (err) {
      console.error(err);
      setExportError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  async function onExportMonth() {
    setLoadingMonth(true);
    setExportError(null);
    try {
      await savePdf(commands.exportCategoryPdf(monthAnchor(resolved)));
    } catch (err) {
      console.error(err);
      setExportError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoadingMonth(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap w-full lg:w-auto">
      <div className="flex items-center gap-1 flex-1 min-w-0 sm:flex-none sm:flex-shrink-0">
        <ArrowLink
          href={prevHref}
          disabled={!resolved.navigable}
          ariaLabel="Vorheriger Zeitraum"
        >
          ◀
        </ArrowLink>
        <AnchorPicker resolved={resolved} />
        <ArrowLink
          href={nextHref}
          disabled={!resolved.navigable}
          ariaLabel="Nächster Zeitraum"
        >
          ▶
        </ArrowLink>
      </div>
      {todayHref !== null ? (
        <Link
          href={todayHref}
          className="rounded-lg border px-3 py-1.5 text-[13px] font-semibold flex-shrink-0"
          style={buttonBase}
        >
          Heute
        </Link>
      ) : null}
      <button
        type="button"
        onClick={onExport}
        disabled={loading}
        className="rounded-lg border px-3 py-1.5 text-[13px] font-semibold inline-flex items-center justify-center gap-2 flex-shrink-0 ml-auto sm:ml-0"
        style={loading ? buttonDisabled : buttonAccent}
        title={`Stundenzettel für „${resolved.label}“ als PDF herunterladen`}
      >
        {loading ? <Spinner /> : null}
        <span>{loading ? "Erstelle PDF…" : "Als PDF"}</span>
      </button>
      <button
        type="button"
        onClick={onExportMonth}
        disabled={loadingMonth}
        className="rounded-lg border px-3 py-1.5 text-[13px] font-semibold inline-flex items-center justify-center gap-2 flex-shrink-0"
        style={loadingMonth ? buttonDisabled : buttonBase}
        title="Axapta-Bericht (Buchungsblöcke pro Kategorie) als PDF herunterladen"
      >
        {loadingMonth ? <Spinner /> : null}
        <span>{loadingMonth ? "Erstelle PDF…" : "Axapta-Bericht"}</span>
      </button>
      {exportError !== null ? (
        <span
          role="alert"
          className="w-full text-[12.5px]"
          style={{ color: "var(--neg)" }}
        >
          {exportError}
        </span>
      ) : null}
    </div>
  );
}
