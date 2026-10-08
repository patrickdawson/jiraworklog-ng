"use client";

/**
 * Entry form bits and dialogs shared by Buchen and Kalender.
 */

import { useState, type ReactNode } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import {
  ALLGEMEINES_CATEGORIES,
  type AllgemeinesCategory,
} from "@/db/schema";
import { deleteEntry, updateEntry } from "@/lib/actions";
import type { EntryView } from "@/lib/entries";

export const DEFAULT_CATEGORY: AllgemeinesCategory = "Projektorganisation";

/** Small labelled dropdown for picking an Allgemeines report category. */
export function CategorySelect({
  value,
  onChange,
  disabled,
}: {
  value: AllgemeinesCategory;
  onChange: (category: AllgemeinesCategory) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <span style={{ color: "var(--text-2)" }}>Kategorie</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as AllgemeinesCategory)}
        className="rounded-md border px-2 py-1 text-[13px] outline-none"
        style={{
          background: "var(--surface-2)",
          borderColor: "var(--border-strong)",
          color: "var(--text)",
        }}
      >
        {ALLGEMEINES_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const styles =
    variant === "primary"
      ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" }
      : variant === "danger"
        ? {
            background: "var(--surface)",
            color: "var(--neg)",
            borderColor: "var(--neg)",
          }
        : {
            background: "var(--surface)",
            color: "var(--text)",
            borderColor: "var(--border-strong)",
          };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-opacity disabled:opacity-60"
      style={styles}
    >
      {children}
    </button>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border"
        style={{
          background: "var(--surface)",
          borderColor: "var(--border)",
          boxShadow: "var(--shadow-lg)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="text-[15px] font-semibold">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px]"
            style={{ color: "var(--text-3)" }}
            aria-label="Schließen"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ───────────────────────── Datetime helpers ─────────────────────────

export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}

export function defaultStartedAt(): string {
  const d = new Date();
  d.setHours(d.getHours() - 1, d.getMinutes(), 0, 0);
  return toLocalInputValue(d.toISOString());
}

export function defaultEndedAt(): string {
  return toLocalInputValue(new Date().toISOString());
}

// ───────────────────────── Edit entry dialog ───────────────────────

export function EditEntryDialog({
  entry,
  onClose,
}: {
  entry: EntryView;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(entry.description);
  const [startedAt, setStartedAt] = useState(toLocalInputValue(entry.startedAt));
  const [endedAt, setEndedAt] = useState(
    entry.endedAt ? toLocalInputValue(entry.endedAt) : defaultEndedAt(),
  );
  const [isAllgemeines, setIsAllgemeines] = useState(entry.isAllgemeines);
  const [category, setCategory] = useState<AllgemeinesCategory>(
    entry.category ?? DEFAULT_CATEGORY,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirm = useConfirm();

  async function onSave() {
    setPending(true);
    setError(null);
    try {
      const res = await updateEntry(entry.id, {
        description,
        startedAt: fromLocalInputValue(startedAt),
        endedAt: fromLocalInputValue(endedAt),
        isAllgemeines,
        category: isAllgemeines ? category : null,
      });
      if (res.ok) onClose();
      else setError(res.message ?? "Speichern fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  async function onDelete() {
    if (!(await confirm("Diesen Eintrag wirklich löschen?"))) return;
    setPending(true);
    try {
      await deleteEntry(entry.id);
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal title="Eintrag bearbeiten" onClose={onClose}>
      <div className="space-y-3.5">
        <Field label="Beschreibung">
          <TextInput value={description} onChange={setDescription} />
        </Field>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={isAllgemeines}
              onChange={(e) => setIsAllgemeines(e.target.checked)}
            />
            <span style={{ color: "var(--text-2)" }}>
              Als Allgemein speichern (nicht nach Jira buchen)
            </span>
          </label>
          {isAllgemeines && (
            <CategorySelect value={category} onChange={setCategory} />
          )}
        </div>
        <div className="grid grid-cols-2 gap-3.5">
          <Field label="Beginn">
            <TextInput type="datetime-local" value={startedAt} onChange={setStartedAt} />
          </Field>
          <Field label="Ende">
            <TextInput type="datetime-local" value={endedAt} onChange={setEndedAt} />
          </Field>
        </div>
        {entry.submittedAt && (
          <div className="text-[12px]" style={{ color: "var(--text-3)" }}>
            Bereits nach Jira übertragen ({entry.jiraIssueKey}). Änderungen wirken nur lokal.
          </div>
        )}
        {error && (
          <div className="text-[13px]" style={{ color: "var(--neg)" }}>
            {error}
          </div>
        )}
        <div className="flex justify-between gap-2.5 pt-2">
          <Button variant="danger" onClick={onDelete} disabled={pending}>
            Löschen
          </Button>
          <div className="flex gap-2.5">
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="primary" onClick={onSave} disabled={pending}>
              Speichern
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ───────────────────────────── Form bits ───────────────────────────

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[12px] mb-1.5" style={{ color: "var(--text-2)" }}>
        {label}
      </div>
      {children}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
      style={{
        background: "var(--surface-2)",
        borderColor: "var(--border-strong)",
        color: "var(--text)",
      }}
    />
  );
}
