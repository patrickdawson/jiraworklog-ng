"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useGroupColors } from "@/components/group-colors-context";
import { setGroupColor } from "@/lib/actions";
import {
  GROUP_COLOR_LABELS,
  GROUP_COLORS,
  groupColorVars,
  type GroupColor,
} from "@/lib/group-color";

/**
 * Round swatch that shows a group's color; clicking it opens the palette.
 * The choice is stored per group, so every entry of that ticket or category
 * follows it.
 */
export function GroupColorPicker({
  groupKey,
  isAllgemeines,
  label,
}: {
  groupKey: string;
  isAllgemeines: boolean;
  /** Group name for the accessible label, e.g. the issue key. */
  label: string;
}) {
  const color = useGroupColors()[groupKey];
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function choose(next: GroupColor | null) {
    setOpen(false);
    startTransition(() => setGroupColor(groupKey, next));
  }

  const { accent } = groupColorVars(color, isAllgemeines);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        data-testid="group-color-picker"
        data-color={color ?? "default"}
        aria-label={`Farbe für ${label} wählen`}
        aria-haspopup="true"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((v) => !v)}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-full focus-visible:ring-2"
        style={{
          background: accent,
          boxShadow: "0 0 0 2px var(--surface), 0 0 0 3px var(--border-strong)",
        }}
      />
      {open && (
        <div
          role="menu"
          aria-label={`Farbe für ${label}`}
          className="absolute left-0 top-full z-30 mt-2 w-[168px] rounded-lg border p-2"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div className="grid grid-cols-4 gap-2">
            {GROUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="menuitemradio"
                aria-checked={c === color}
                aria-label={GROUP_COLOR_LABELS[c]}
                title={GROUP_COLOR_LABELS[c]}
                onClick={() => choose(c)}
                className="h-7 w-7 cursor-pointer rounded-full focus-visible:ring-2"
                style={{
                  background: `var(--gc-${c})`,
                  boxShadow:
                    c === color
                      ? "0 0 0 2px var(--surface), 0 0 0 4px var(--text)"
                      : undefined,
                }}
              />
            ))}
          </div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={color === undefined}
            onClick={() => choose(null)}
            className="mt-2 w-full cursor-pointer rounded-md px-2 py-1 text-left text-[12px]"
            style={{
              background: "var(--surface-2)",
              color: "var(--text-2)",
            }}
          >
            Standard
          </button>
        </div>
      )}
    </div>
  );
}
