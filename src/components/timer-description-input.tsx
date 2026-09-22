"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RecentEntry } from "@/lib/entries";
import { formatHms } from "@/lib/format";

const LISTBOX_ID = "timer-recents-listbox";
const optionId = (index: number) => `timer-recents-option-${index}`;

/**
 * The timer description field plus a dropdown of recently used entries.
 *
 * Input and listbox live in one component on purpose: the field commits its
 * text to the running timer on blur, so picking a suggestion must be able to
 * tell "focus left the widget" from "focus moved onto a suggestion". That
 * needs a single wrapper ref, which only works if both halves are here.
 */
export function TimerDescriptionInput({
  value,
  onChange,
  onCommit,
  onEnter,
  onPick,
  recents,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Focus really left the widget — persist the draft, as before. */
  onCommit: () => void;
  /** Enter with no suggestion highlighted — the pre-existing behaviour. */
  onEnter: () => void;
  onPick: (entry: RecentEntry) => void;
  recents: RecentEntry[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // -1 means "nothing highlighted". Load-bearing: if a row were highlighted by
  // default, typing a brand new description and pressing Enter would start the
  // top suggestion instead of what the user typed.
  const [highlight, setHighlight] = useState(-1);
  // `null` means "nothing typed since the dropdown opened", so focusing the
  // field while a timer runs still shows the full list instead of filtering by
  // the running description. `value` stays the only source of truth for text.
  const [query, setQuery] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLLIElement | null)[]>([]);

  const filtered = useMemo(() => {
    const q = (query ?? "").trim().toLowerCase();
    if (!q) return recents;
    return recents.filter((r) =>
      `${r.description} ${r.issueKey ?? ""} ${r.category ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [recents, query]);

  function close() {
    setOpen(false);
    setHighlight(-1);
    setQuery(null);
  }

  function openList() {
    if (recents.length === 0) return;
    setOpen(true);
    setQuery(null);
  }

  // Clicks on page chrome that cannot take focus still have to close the list.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setHighlight(-1);
        setQuery(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (highlight < 0) return;
    optionRefs.current[highlight]?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function pick(entry: RecentEntry) {
    // Deliberately no onCommit(): whatever is in the field was a filter, not a
    // description, and writing it to the entry we are about to close would
    // corrupt it.
    close();
    onPick(entry);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openList();
        setHighlight(0);
      } else {
        setHighlight((h) => Math.min(filtered.length - 1, h + 1));
      }
      return;
    }
    if (event.key === "ArrowUp") {
      if (!open) return;
      event.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && highlight >= 0 && filtered[highlight]) {
        pick(filtered[highlight]);
        return;
      }
      if (open) close();
      onEnter();
      return;
    }
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab" && open) {
      close();
    }
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1"
      onBlur={(event) => {
        if (containerRef.current?.contains(event.relatedTarget as Node)) return;
        close();
        onCommit();
      }}
    >
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setQuery(e.target.value);
          setHighlight(-1);
          if (!open) openList();
        }}
        onFocus={openList}
        // Also on click: after picking a suggestion the field keeps focus, so
        // a second click would fire no focus event and the list would stay shut.
        onClick={openList}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={LISTBOX_ID}
        aria-autocomplete="list"
        aria-activedescendant={
          open && highlight >= 0 ? optionId(highlight) : undefined
        }
        autoComplete="off"
        className="w-full rounded-lg border py-3 pl-3.5 pr-10 text-[15px] outline-none"
        style={{
          background: "var(--surface-2)",
          borderColor: "var(--border-strong)",
          color: "var(--text)",
        }}
      />

      {recents.length > 0 && (
        <button
          type="button"
          tabIndex={-1}
          // Keeps focus in the input, so no blur fires and nothing is committed.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? close() : openList())}
          title="Zuletzt verwendete Einträge"
          aria-label="Zuletzt verwendete Einträge anzeigen"
          aria-expanded={open}
          aria-controls={LISTBOX_ID}
          className="absolute right-2 top-1/2 flex h-[26px] w-[26px] -translate-y-1/2 items-center justify-center rounded-md"
          style={{ color: "var(--text-3)" }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-[14px] w-[14px]"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}

      {open && (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Zuletzt verwendete Einträge"
          // z-40 stays below Modal's z-50, so an open dialog always wins.
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-[320px] overflow-auto rounded-lg border py-1"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border-strong)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <li
            role="presentation"
            className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--text-3)" }}
          >
            Zuletzt verwendet
          </li>

          {filtered.length === 0 ? (
            <li
              role="presentation"
              className="px-3 py-2 text-[13px]"
              style={{ color: "var(--text-3)" }}
            >
              Keine passenden Einträge
            </li>
          ) : (
            filtered.map((entry, index) => (
              <li
                key={entry.key}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                role="option"
                id={optionId(index)}
                aria-selected={index === highlight}
                title="Mit gleicher Beschreibung neu starten"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => pick(entry)}
                className="flex cursor-pointer items-center gap-3 px-3 py-2"
                style={{
                  background:
                    index === highlight ? "var(--accent-soft)" : undefined,
                }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px]" title={entry.description}>
                    {entry.description}
                  </div>
                  <div
                    className="text-[12px] font-semibold"
                    style={{
                      color: entry.isAllgemeines
                        ? "var(--teal)"
                        : entry.issueKey
                          ? "var(--accent)"
                          : "var(--text-3)",
                    }}
                  >
                    {entry.isAllgemeines
                      ? `Allgemein · ${entry.category ?? "—"}`
                      : (entry.issueKey ?? "kein Issue-Key")}
                  </div>
                </div>
                <div
                  className="num text-[12px] tabular-nums"
                  style={{ color: "var(--text-3)" }}
                  title={`${entry.count} Einträge`}
                >
                  {entry.count}×
                </div>
                <div className="num text-[13px] font-semibold tabular-nums">
                  {formatHms(entry.totalSeconds)}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
