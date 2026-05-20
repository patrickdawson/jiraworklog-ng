import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border ${className}`}
      style={{
        background: "var(--surface)",
        borderColor: "var(--border)",
        boxShadow: "var(--shadow)",
      }}
    >
      <div className={padded ? "p-5" : ""}>{children}</div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
        {subtitle && (
          <div className="text-[13px] mt-1" style={{ color: "var(--text-2)" }} suppressHydrationWarning>
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  );
}

type Tone = "default" | "pos" | "neg" | "warn" | "accent";

const TONE_COLOR: Record<Tone, string> = {
  default: "var(--text)",
  pos: "var(--pos)",
  neg: "var(--neg)",
  warn: "var(--warn)",
  accent: "var(--accent)",
};

export function KpiCard({
  label,
  value,
  meta,
  tone = "default",
  progress,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: Tone;
  /** 0..1 — renders a thin progress bar below the value. */
  progress?: number;
}) {
  return (
    <Card>
      <div
        className="text-[12px] font-medium mb-2"
        style={{ color: "var(--text-2)" }}
      >
        {label}
      </div>
      <div
        className="text-[26px] font-semibold tracking-tight num"
        style={{ color: TONE_COLOR[tone] }}
      >
        {value}
      </div>
      {progress !== undefined && (
        <div
          className="mt-2.5 h-1.5 rounded-full overflow-hidden"
          style={{ background: "var(--surface-2)" }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(0, progress * 100))}%`,
              background: "linear-gradient(90deg, var(--accent), #ec4899)",
            }}
          />
        </div>
      )}
      {meta && (
        <div
          className="mt-2 text-[12px] flex items-center gap-1.5"
          style={{ color: "var(--text-3)" }}
        >
          {meta}
        </div>
      )}
    </Card>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "open" | "booked";
}) {
  const style =
    tone === "booked"
      ? { background: "var(--pos-soft)", color: "var(--pos)" }
      : tone === "open"
        ? { background: "var(--warn-soft)", color: "var(--warn)" }
        : { background: "var(--surface-2)", color: "var(--text-2)" };
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap"
      style={style}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="text-center py-10 px-6">
      <div className="text-[15px] font-medium">{title}</div>
      {description && (
        <div className="mt-1.5 text-[13px]" style={{ color: "var(--text-2)" }}>
          {description}
        </div>
      )}
    </div>
  );
}
