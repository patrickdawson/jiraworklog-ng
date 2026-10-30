"use client";

import { useState } from "react";
import { IssueKeyLink } from "@/components/issue-key-link";
import {
  getGroupEntries,
  type GroupEntriesPage,
  type GroupEntry,
} from "@/lib/actions";
import type { GroupTotal } from "@/lib/entries";
import { clockTime, dayKey, dayLabel, formatHm } from "@/lib/format";
import { groupColorVars, type GroupColorMap } from "@/lib/group-color";

/** Groups shown as their own bar; the rest is summed into one "Rest" bar. */
const GROUP_BARS_MAX = 12;

const ROW_GRID =
  "grid grid-cols-[16px_minmax(0,160px)_1fr_64px_44px] items-center gap-3 text-[13px]";

/** Share of the total as a whole percent; tiny but non-zero shares show as "<1 %". */
function formatShare(seconds: number, total: number): string {
  const pct = (seconds * 100) / total;
  return pct > 0 && pct < 1 ? "<1 %" : `${Math.round(pct)} %`;
}

function sumSeconds(groups: GroupTotal[]): number {
  return groups.reduce((sum, g) => sum + g.seconds, 0);
}

type Range = { fromIso: string; toIso: string };

/**
 * "Zeit pro Ticket": tickets and Allgemeines in two sections, so absences and
 * admin time do not push tickets out of the top bars. Shares are of the whole
 * range. A bar opens its entries; "Rest" opens the bars it sums up.
 */
export function TicketTime({
  data,
  colors,
  fromIso,
  toIso,
}: {
  data: GroupTotal[];
  colors: GroupColorMap;
  fromIso: string;
  toIso: string;
}) {
  if (data.length === 0) {
    return (
      <div
        className="text-center py-10 text-[13px]"
        style={{ color: "var(--text-2)" }}
      >
        Noch keine Daten im gewählten Zeitraum.
      </div>
    );
  }

  const total = sumSeconds(data);
  const range = { fromIso, toIso };
  const sections = [
    { title: "Tickets", groups: data.filter((g) => !g.isAllgemeines) },
    { title: "Allgemeines", groups: data.filter((g) => g.isAllgemeines) },
  ].filter((s) => s.groups.length > 0);

  return (
    <div className="space-y-5">
      {sections.map((s) => (
        <GroupSection
          key={s.title}
          title={s.title}
          groups={s.groups}
          total={total}
          colors={colors}
          range={range}
        />
      ))}
    </div>
  );
}

function GroupSection({
  title,
  groups,
  total,
  colors,
  range,
}: {
  title: string;
  groups: GroupTotal[];
  total: number;
  colors: GroupColorMap;
  range: Range;
}) {
  const [showAll, setShowAll] = useState(false);
  const collapsible = groups.length > GROUP_BARS_MAX;
  const shown = showAll ? groups : groups.slice(0, GROUP_BARS_MAX);
  const rest = showAll ? [] : groups.slice(GROUP_BARS_MAX);
  const restSeconds = sumSeconds(rest);
  const max = Math.max(restSeconds, ...shown.map((g) => g.seconds));
  const sectionSeconds = sumSeconds(groups);

  return (
    <section data-testid="group-section" aria-label={title}>
      <div
        className="flex items-baseline justify-between pb-2 text-[11px] uppercase tracking-wider"
        style={{ color: "var(--text-3)" }}
      >
        <span>{title}</span>
        <span className="num tabular-nums">
          {formatHm(Math.round(sectionSeconds / 60))} ·{" "}
          {formatShare(sectionSeconds, total)}
        </span>
      </div>
      <div className="space-y-2">
        {shown.map((g) => (
          <GroupRow
            key={g.id}
            group={g}
            max={max}
            total={total}
            colors={colors}
            range={range}
          />
        ))}
        {rest.length > 0 && (
          <button
            type="button"
            data-testid="group-bar-rest"
            onClick={() => setShowAll(true)}
            aria-label={`Rest (${rest.length}) aufklappen`}
            title="Alle anzeigen"
            className={`${ROW_GRID} w-full cursor-pointer text-left`}
          >
            <Chevron open={false} />
            <div className="truncate font-semibold">Rest ({rest.length})</div>
            <Bar seconds={restSeconds} max={max} fill="var(--border-strong)" />
            <Duration seconds={restSeconds} />
            <Share seconds={restSeconds} total={total} />
          </button>
        )}
        {collapsible && showAll && (
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="text-[12px] font-semibold cursor-pointer"
            style={{ color: "var(--accent)" }}
          >
            Weniger anzeigen
          </button>
        )}
      </div>
    </section>
  );
}

function GroupRow({
  group,
  max,
  total,
  colors,
  range,
}: {
  group: GroupTotal;
  max: number;
  total: number;
  colors: GroupColorMap;
  range: Range;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<GroupEntriesPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const color = group.key ? colors[group.key] : undefined;
  const fill = group.key
    ? groupColorVars(color, group.isAllgemeines).accent
    : "var(--text-3)";

  async function load(offset: number) {
    setLoading(true);
    setError(null);
    try {
      const page = await getGroupEntries({ ...range, groupId: group.id, offset });
      setLoaded((prev) => {
        // An entry booked between two pages shifts the offsets by one; skip
        // what is already shown instead of listing it twice.
        const seen = new Set(prev?.entries.map((e) => e.id));
        return {
          entries: [
            ...(prev?.entries ?? []),
            ...page.entries.filter((e) => !seen.has(e.id)),
          ],
          total: page.total,
        };
      });
    } catch {
      setError("Einträge konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) void load(0);
  }

  return (
    <div>
      <div
        data-testid="group-bar"
        data-group-color={color ?? "default"}
        onClick={toggle}
        className={`${ROW_GRID} cursor-pointer`}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Einträge zu ${group.label} anzeigen`}
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className="flex items-center justify-center cursor-pointer"
        >
          <Chevron open={open} />
        </button>
        <div className="truncate font-semibold" title={group.label}>
          {group.issueKey ? (
            <IssueKeyLink issueKey={group.issueKey} />
          ) : (
            group.label
          )}
        </div>
        <Bar seconds={group.seconds} max={max} fill={fill} />
        <Duration seconds={group.seconds} />
        <Share seconds={group.seconds} total={total} />
      </div>
      {open && (
        <div className="mt-2 mb-3 ml-7">
          {loaded && <GroupEntryList entries={loaded.entries} />}
          {error && (
            <div className="mt-1.5 text-[12px]" style={{ color: "var(--neg)" }}>
              {error}
            </div>
          )}
          {!loaded && !error && (
            <div className="text-[12px]" style={{ color: "var(--text-3)" }}>
              Lade …
            </div>
          )}
          {loaded && loaded.entries.length < loaded.total && (
            <div
              className="mt-1.5 flex items-center gap-3 text-[12px]"
              style={{ color: "var(--text-3)" }}
            >
              <span data-testid="group-entries-count">
                {loaded.entries.length} von {loaded.total} Einträgen
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={() => void load(loaded.entries.length)}
                className="font-semibold cursor-pointer disabled:cursor-default disabled:opacity-60"
                style={{ color: "var(--accent)" }}
              >
                {loading ? "Lade …" : "Weitere laden"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupEntryList({ entries }: { entries: GroupEntry[] }) {
  return (
    <div
      className="rounded-lg border divide-y"
      style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}
    >
      {entries.map((e) => (
        <div
          key={e.id}
          data-testid="group-entry"
          className="grid grid-cols-[110px_90px_1fr_48px] items-center gap-3 px-3 py-1.5 text-[12px]"
          style={{ borderColor: "var(--border)" }}
        >
          <span style={{ color: "var(--text-2)" }}>
            {dayLabel(dayKey(e.startedAt))}
          </span>
          <span className="num tabular-nums" style={{ color: "var(--text-2)" }}>
            {clockTime(e.startedAt)}–{clockTime(e.endedAt)}
          </span>
          <span className="truncate" title={e.description}>
            {e.description || "(ohne Beschreibung)"}
          </span>
          <span className="num text-right tabular-nums">
            {formatHm(Math.round(e.seconds / 60))}
          </span>
        </div>
      ))}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className="h-3 w-3 transition-transform"
      style={{
        color: "var(--text-3)",
        transform: open ? "rotate(90deg)" : undefined,
      }}
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function Bar({
  seconds,
  max,
  fill,
}: {
  seconds: number;
  max: number;
  fill: string;
}) {
  return (
    <div className="h-3 rounded" style={{ background: "var(--surface-2)" }}>
      <div
        className="h-3 rounded"
        style={{ width: `${(seconds * 100) / max}%`, background: fill }}
      />
    </div>
  );
}

function Duration({ seconds }: { seconds: number }) {
  return (
    <div
      className="num text-right tabular-nums"
      style={{ color: "var(--text-2)" }}
    >
      {formatHm(Math.round(seconds / 60))}
    </div>
  );
}

function Share({ seconds, total }: { seconds: number; total: number }) {
  return (
    <div
      data-testid="group-bar-percent"
      className="num text-right tabular-nums"
      style={{ color: "var(--text-3)" }}
    >
      {formatShare(seconds, total)}
    </div>
  );
}
