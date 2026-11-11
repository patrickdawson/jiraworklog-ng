// The period controls of the Auswertung page. The PDF export buttons of the
// old component come back with milestone 7 (PDF reports).
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { rangeQuery, type ResolvedRange } from "@/lib/report-range";

const buttonBase: CSSProperties = {
  cursor: "pointer",
  background: "var(--surface)",
  borderColor: "var(--border-strong)",
  color: "var(--text)",
};

const buttonDisabled: CSSProperties = {
  cursor: "not-allowed",
  opacity: 0.5,
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--text-2)",
};

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
  const prevHref =
    resolved.prevAnchor !== null ? rangeQuery(resolved.kind, resolved.prevAnchor) : null;
  const nextHref =
    resolved.nextAnchor !== null ? rangeQuery(resolved.kind, resolved.nextAnchor) : null;
  const todayHref =
    resolved.kind === "all" ? null : rangeQuery(resolved.kind, "");

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
    </div>
  );
}
