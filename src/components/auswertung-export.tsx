"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import {
  rangeQuery,
  shiftRange,
  type ResolvedRange,
} from "@/lib/report-range";

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

export function RangeControls({ resolved }: { resolved: ResolvedRange }) {
  const [loading, setLoading] = useState(false);

  const prev = shiftRange(resolved, -1);
  const next = shiftRange(resolved, 1);
  const prevHref = prev !== null ? rangeQuery(resolved.kind, prev) : null;
  const nextHref = next !== null ? rangeQuery(resolved.kind, next) : null;
  const todayHref =
    resolved.kind === "all" ? null : rangeQuery(resolved.kind, "");

  async function onExport() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ range: resolved.kind });
      if (resolved.kind !== "all" && resolved.anchor) {
        params.set("anchor", resolved.anchor);
      }
      const res = await fetch(`/api/report/pdf?${params}`);
      if (!res.ok) {
        throw new Error(`PDF konnte nicht erstellt werden (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stundenzettel-${resolved.slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
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
        data-testid="pdf-download"
        onClick={onExport}
        disabled={loading}
        className="rounded-lg border px-3 py-1.5 text-[13px] font-semibold inline-flex items-center justify-center gap-2 flex-shrink-0 ml-auto sm:ml-0"
        style={loading ? buttonDisabled : buttonAccent}
        title={`Bericht für „${resolved.label}“ als PDF herunterladen`}
      >
        {loading ? <Spinner /> : null}
        <span>{loading ? "Erstelle PDF…" : "Als PDF"}</span>
      </button>
    </div>
  );
}
