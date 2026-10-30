"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import {
  cleanupOldEntries,
  setForceBooking,
  testJiraConnection,
  updateSettings,
  type SettingsInput,
} from "@/lib/actions";
import {
  formatSignedHm,
  formatSignedHmInput,
  parseSignedHm,
} from "@/lib/format";
import type { BreakWindow } from "@/lib/work-time";

type Initial = SettingsInput & {
  breaks: BreakWindow[];
  forceBooking: boolean;
};

function minutesToHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function hmToMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m >= 60) return null;
  return h * 60 + m;
}

/** The fields that only persist through "Speichern", as the inputs hold them. */
type FormValues = {
  regular: string;
  target: string;
  breaks: BreakWindow[];
  autoPause: boolean;
  bookingMode: "grouped" | "individual";
  retention: string;
  jiraUrl: string;
  projectKeys: string[];
  token: string;
  jUser: string;
  overtimeBaseline: string;
  themeMode: "system" | "light" | "dark";
  sprintAnchorDate: string;
  sprintLengthDays: string;
  concreteTarget: string;
  corridorCenter: string;
  corridorRange: string;
  awayCheck: boolean;
};

function toFormValues(initial: Initial): FormValues {
  return {
    regular: minutesToHm(initial.regularWorkMinutes),
    target: minutesToHm(initial.dailyTargetMinutes),
    breaks: initial.breaks,
    autoPause: initial.autoPauseEnabled,
    bookingMode: initial.bookingMode,
    retention: String(initial.dataRetentionDays),
    jiraUrl: initial.jiraUrl,
    projectKeys: initial.jiraProjectKeys,
    token: initial.jiraToken ?? initial.jiraPassword ?? "",
    jUser: initial.jiraUser ?? "",
    overtimeBaseline: formatSignedHmInput(initial.overtimeBaselineMinutes),
    themeMode: initial.themeMode,
    sprintAnchorDate: initial.sprintAnchorDate,
    sprintLengthDays: String(initial.sprintLengthDays),
    concreteTarget: String(initial.concreteIssueTargetPercent),
    corridorCenter: String(initial.overtimeCorridorCenterHours),
    corridorRange: String(initial.overtimeCorridorRangeHours),
    awayCheck: initial.awayCheckEnabled,
  };
}

export function EinstellungenForm({ initial }: { initial: Initial }) {
  const [saved, setSaved] = useState(() => toFormValues(initial));
  const [regular, setRegular] = useState(saved.regular);
  const [target, setTarget] = useState(saved.target);
  const [breaks, setBreaks] = useState<BreakWindow[]>(saved.breaks);
  const [autoPause, setAutoPause] = useState(saved.autoPause);
  const [bookingMode, setBookingMode] = useState(saved.bookingMode);
  const [retention, setRetention] = useState(saved.retention);
  const [jiraUrl, setJiraUrl] = useState(saved.jiraUrl);
  const [projectKeys, setProjectKeys] = useState<string[]>(saved.projectKeys);
  const [newKey, setNewKey] = useState("");
  const [token, setToken] = useState(saved.token);
  const [jUser, setJUser] = useState(saved.jUser);
  const [overtimeBaseline, setOvertimeBaseline] = useState(
    saved.overtimeBaseline,
  );
  const [themeMode, setThemeMode] = useState(saved.themeMode);
  const [sprintAnchorDate, setSprintAnchorDate] = useState(
    saved.sprintAnchorDate,
  );
  const [sprintLengthDays, setSprintLengthDays] = useState(
    saved.sprintLengthDays,
  );
  const [concreteTarget, setConcreteTarget] = useState(saved.concreteTarget);
  const [corridorCenter, setCorridorCenter] = useState(saved.corridorCenter);
  const [corridorRange, setCorridorRange] = useState(saved.corridorRange);
  const [awayCheck, setAwayCheck] = useState(saved.awayCheck);
  const [forceBooking, setForceBookingState] = useState(initial.forceBooking);

  const values: FormValues = {
    regular,
    target,
    breaks,
    autoPause,
    bookingMode,
    retention,
    jiraUrl,
    projectKeys,
    token,
    jUser,
    overtimeBaseline,
    themeMode,
    sprintAnchorDate,
    sprintLengthDays,
    concreteTarget,
    corridorCenter,
    corridorRange,
    awayCheck,
  };
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  function discard() {
    setRegular(saved.regular);
    setTarget(saved.target);
    setBreaks(saved.breaks);
    setAutoPause(saved.autoPause);
    setBookingMode(saved.bookingMode);
    setRetention(saved.retention);
    setJiraUrl(saved.jiraUrl);
    setProjectKeys(saved.projectKeys);
    setToken(saved.token);
    setJUser(saved.jUser);
    setOvertimeBaseline(saved.overtimeBaseline);
    setThemeMode(saved.themeMode);
    setSprintAnchorDate(saved.sprintAnchorDate);
    setSprintLengthDays(saved.sprintLengthDays);
    setConcreteTarget(saved.concreteTarget);
    setCorridorCenter(saved.corridorCenter);
    setCorridorRange(saved.corridorRange);
    setAwayCheck(saved.awayCheck);
    setSaveStatus(null);
  }

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  // Desktop (Electron) integration: only available when running in the app.
  const [isElectron, setIsElectron] = useState(false);
  const [autoLaunch, setAutoLaunch] = useState(false);

  useEffect(() => {
    const bridge = window.electron;
    if (!bridge) return;
    bridge.getAutoLaunch().then((enabled) => {
      setIsElectron(true);
      setAutoLaunch(enabled);
    });
  }, []);

  async function toggleAutoLaunch(next: boolean) {
    const bridge = window.electron;
    if (!bridge) return;
    setAutoLaunch(await bridge.setAutoLaunch(next));
  }

  const [saveStatus, setSaveStatus] = useState<{
    tone: "ok" | "err";
    msg: string;
  } | null>(null);
  const [testStatus, setTestStatus] = useState<{
    tone: "ok" | "err";
    msg: string;
  } | null>(null);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirm = useConfirm();
  const router = useRouter();

  // The success note only confirms the click; it leaves the save bar on its own.
  useEffect(() => {
    if (saveStatus?.tone !== "ok") return;
    const id = window.setTimeout(() => setSaveStatus(null), 4000);
    return () => window.clearTimeout(id);
  }, [saveStatus]);

  // Unsaved changes: ask before an in-app link leaves the page, and let the
  // browser ask before a reload or tab close.
  const savedTheme = saved.themeMode;
  useEffect(() => {
    if (!dirty) return;

    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;
      const url = new URL(link.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      // Capture phase on document runs before Next's <Link> handler on the root.
      e.preventDefault();
      e.stopPropagation();
      void confirm(
        "Es gibt ungespeicherte Änderungen in den Einstellungen. Seite trotzdem verlassen?",
        "Verwerfen",
      ).then((leave) => {
        if (!leave) return;
        // Drop the unsaved theme preview before the next page shows.
        document.documentElement.dataset.theme = savedTheme;
        router.push(url.pathname + url.search + url.hash);
      });
    }

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }

    document.addEventListener("click", onClick, true);
    // Electron cancels the unload silently instead of asking, which would block
    // "Beenden" from the tray. The app keeps its in-page guard only.
    const inElectron = Boolean(window.electron);
    if (!inElectron) window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      if (!inElectron) window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, confirm, router, savedTheme]);

  async function onSave() {
    const regularMin = hmToMinutes(regular);
    const targetMin = hmToMinutes(target);
    if (regularMin === null || targetMin === null) {
      setSaveStatus({
        tone: "err",
        msg: "Bitte Zeiten im Format hh:mm angeben.",
      });
      return;
    }
    const baselineMin = parseSignedHm(overtimeBaseline);
    if (baselineMin === null) {
      setSaveStatus({
        tone: "err",
        msg: "Überstunden-Startwert bitte als ±hh:mm angeben.",
      });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sprintAnchorDate)) {
      setSaveStatus({
        tone: "err",
        msg: "Sprint-Ankerdatum bitte als YYYY-MM-DD angeben.",
      });
      return;
    }
    const sprintLen = Number(sprintLengthDays);
    if (!Number.isInteger(sprintLen) || sprintLen < 1 || sprintLen > 365) {
      setSaveStatus({
        tone: "err",
        msg: "Sprint-Länge bitte als ganze Zahl zwischen 1 und 365 angeben.",
      });
      return;
    }
    const targetPct = Number(concreteTarget);
    if (!Number.isInteger(targetPct) || targetPct < 0 || targetPct > 100) {
      setSaveStatus({
        tone: "err",
        msg: "Ziel-Prozentwert bitte als ganze Zahl zwischen 0 und 100 angeben.",
      });
      return;
    }
    const centerH = Number(corridorCenter);
    const rangeH = Number(corridorRange);
    if (
      corridorCenter.trim() === "" ||
      !Number.isInteger(centerH) ||
      Math.abs(centerH) > 9999 ||
      !Number.isInteger(rangeH) ||
      rangeH < 1 ||
      rangeH > 9999
    ) {
      setSaveStatus({
        tone: "err",
        msg: "Saldo-Korridor bitte als ganze Stunden angeben, Spanne mindestens 1.",
      });
      return;
    }
    setPending(true);
    try {
      const res = await updateSettings({
        regularWorkMinutes: regularMin,
        dailyTargetMinutes: targetMin,
        breaks,
        autoPauseEnabled: autoPause,
        bookingMode,
        dataRetentionDays: Number(retention) || initial.dataRetentionDays,
        jiraUrl,
        jiraProjectKeys: projectKeys,
        jiraAuthMode: "basic",
        jiraToken: token || null,
        jiraUser: jUser || null,
        jiraPassword: null,
        overtimeBaselineMinutes: baselineMin,
        themeMode,
        sprintAnchorDate,
        sprintLengthDays: sprintLen,
        concreteIssueTargetPercent: targetPct,
        overtimeCorridorCenterHours: centerH,
        overtimeCorridorRangeHours: rangeH,
        awayCheckEnabled: awayCheck,
      });
      if (res.ok) setSaved(values);
      setSaveStatus(
        res.ok
          ? { tone: "ok", msg: "Einstellungen gespeichert." }
          : { tone: "err", msg: res.message ?? "Speichern fehlgeschlagen." },
      );
    } finally {
      setPending(false);
    }
  }

  async function onTest() {
    setTestStatus(null);
    setPending(true);
    try {
      const res = await testJiraConnection({
        jiraUrl,
        jiraToken: token || null,
        jiraUser: jUser || null,
      });
      setTestStatus({
        tone: res.ok ? "ok" : "err",
        msg: res.message ?? (res.ok ? "Verbindung erfolgreich." : "Fehler."),
      });
    } finally {
      setPending(false);
    }
  }

  async function onCleanup() {
    const days = Number(retention);
    if (!Number.isFinite(days) || days < 1) {
      setCleanupStatus("Bitte eine Zahl ≥ 1 angeben.");
      return;
    }
    if (
      !(await confirm(
        `Wirklich alle erfassten Einträge älter als ${days} Tage lokal löschen? Jira bleibt unberührt.`,
      ))
    )
      return;
    setPending(true);
    try {
      const res = await cleanupOldEntries(days);
      setCleanupStatus(
        res.ok
          ? `${res.deleted} Eintrag/Einträge gelöscht. ` +
              `${formatSignedHm(res.overtimeRolledMinutes)} in den Startsaldo übernommen.`
          : res.message ?? "Fehler beim Löschen.",
      );
    } finally {
      setPending(false);
    }
  }

  async function toggleForceBooking(next: boolean) {
    setForceBookingState(next);
    await setForceBooking(next);
  }

  function addBreak() {
    setBreaks((b) => [...b, { start: "12:00", end: "12:30" }]);
  }
  function updateBreak(i: number, patch: Partial<BreakWindow>) {
    setBreaks((b) => b.map((br, idx) => (idx === i ? { ...br, ...patch } : br)));
  }
  function removeBreak(i: number) {
    setBreaks((b) => b.filter((_, idx) => idx !== i));
  }

  function addKey() {
    const k = newKey.trim().toUpperCase();
    if (!k || projectKeys.includes(k)) return;
    setProjectKeys((keys) => [...keys, k]);
    setNewKey("");
  }
  function removeKey(k: string) {
    setProjectKeys((keys) => keys.filter((x) => x !== k));
  }

  return (
    <main className="px-8 py-7">
      <PageHeader
        title="Einstellungen"
        subtitle="Arbeitszeit, Pausen, Jira-Anbindung"
      />

      <Section title="Arbeitszeit">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Regelarbeitszeit (hh:mm)">
            <TextInput value={regular} onChange={setRegular} placeholder="07:00" />
          </Field>
          <Field label="Tagesziel (hh:mm) — Default = Regelarbeitszeit">
            <TextInput value={target} onChange={setTarget} placeholder="07:00" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Überstunden-Startwert (±hh:mm)">
            <TextInput
              value={overtimeBaseline}
              onChange={setOvertimeBaseline}
              placeholder="+00:00"
            />
          </Field>
          <div className="text-[12px] self-end pb-2" style={{ color: "var(--text-3)" }}>
            Bereits vorhandenes Überstundensaldo, das vor dem Einsatz dieses Tools
            angefallen ist. Wird zum berechneten Saldo addiert.
          </div>
        </div>
      </Section>

      <Section title="Pausen">
        {breaks.length === 0 && (
          <div className="text-[13px] mb-2" style={{ color: "var(--text-2)" }}>
            Keine Pausen definiert.
          </div>
        )}
        {breaks.map((b, i) => (
          <div key={i} className="flex items-center gap-2.5 mb-2">
            <TextInput
              value={b.start}
              onChange={(v) => updateBreak(i, { start: v })}
              className="w-28"
            />
            <span style={{ color: "var(--text-3)" }}>bis</span>
            <TextInput
              value={b.end}
              onChange={(v) => updateBreak(i, { end: v })}
              className="w-28"
            />
            <button
              type="button"
              onClick={() => removeBreak(i)}
              className="rounded-md border px-2 py-1 text-[12px]"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--text-2)",
              }}
            >
              entfernen
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addBreak}
          className="mt-1 rounded-lg border px-3 py-1.5 text-[12px] font-semibold"
          style={{
            borderColor: "var(--border-strong)",
            color: "var(--text)",
            background: "var(--surface-2)",
          }}
        >
          + Pause hinzufügen
        </button>

        <label className="mt-4 flex items-center gap-3">
          <input
            type="checkbox"
            checked={autoPause}
            onChange={(e) => setAutoPause(e.target.checked)}
          />
          <span className="text-[13px]">
            Pausenzeiten automatisch von der Arbeitszeit abziehen
          </span>
        </label>

        <label className="mt-3 flex items-center gap-3">
          <input
            type="checkbox"
            checked={awayCheck}
            onChange={(e) => setAwayCheck(e.target.checked)}
          />
          <span className="text-[13px]">
            Nach Abwesenheit fragen, ob die Zeit abgezogen werden soll
          </span>
        </label>
        <div className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>
          Nur in der Desktop-App. Wenn der Bildschirm gesperrt war oder der PC im
          Standby war, fragt die App ab 5 Minuten Abwesenheit, was mit der Zeit
          des laufenden Timers passieren soll.
        </div>
      </Section>

      <Section title="Buchung">
        <Field label="Buchungsmodus">
          <Select
            value={bookingMode}
            onChange={(v) => setBookingMode(v as "grouped" | "individual")}
            options={[
              {
                value: "grouped",
                label: "Einträge gleicher Beschreibung gebündelt buchen",
              },
              { value: "individual", label: "Jeden Eintrag einzeln buchen" },
            ]}
          />
        </Field>
      </Section>

      <Section title="Darstellung">
        <Field label="Farbschema">
          <Select
            value={themeMode}
            onChange={(v) => setThemeMode(v as "system" | "light" | "dark")}
            options={[
              { value: "system", label: "Systemeinstellung übernehmen" },
              { value: "light", label: "Hell" },
              { value: "dark", label: "Dunkel" },
            ]}
          />
        </Field>
        <div className="text-[12px]" style={{ color: "var(--text-3)" }}>
          Die Änderung greift sofort als Vorschau und wird mit „Speichern&rdquo;
          dauerhaft übernommen.
        </div>
      </Section>

      {isElectron && (
        <Section title="Desktop">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={autoLaunch}
              onChange={(e) => toggleAutoLaunch(e.target.checked)}
            />
            <span className="text-[13px]">
              JiraWorklog automatisch beim Windows-Anmelden starten
            </span>
          </label>
          <div className="text-[12px]" style={{ color: "var(--text-3)" }}>
            Die App startet minimiert im System-Tray. Diese Einstellung wird
            sofort übernommen.
          </div>
        </Section>
      )}

      <Section title="Jira-Anbindung">
        <Field label="Jira-URL">
          <TextInput
            value={jiraUrl}
            onChange={setJiraUrl}
            placeholder="https://yourorg.atlassian.net"
          />
        </Field>
        <Field label="Projekt-Keys (für die Format-Auftrennung des Beschreibungstexts)">
          <div className="flex flex-wrap items-center gap-2">
            {projectKeys.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                {k}
                <button
                  type="button"
                  onClick={() => removeKey(k)}
                  aria-label={`${k} entfernen`}
                  style={{ opacity: 0.7 }}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addKey();
                }
              }}
              placeholder="z.B. TXR"
              className="rounded-md border px-2 py-1 text-[12px] w-24 outline-none"
              style={{
                background: "var(--surface-2)",
                borderColor: "var(--border-strong)",
                color: "var(--text)",
              }}
            />
            <button
              type="button"
              onClick={addKey}
              className="rounded-md border px-2 py-1 text-[12px]"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--text)",
                background: "var(--surface)",
              }}
            >
              + hinzufügen
            </button>
          </div>
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Atlassian-E-Mail">
            <TextInput
              value={jUser}
              onChange={setJUser}
              placeholder="name@example.com"
            />
          </Field>
          <Field label="API-Token">
            <TextInput value={token} onChange={setToken} type="password" />
          </Field>
          <Field label="&nbsp;">
            <button
              type="button"
              onClick={onTest}
              disabled={pending}
              className="w-full rounded-lg border px-3 py-2 text-[13px] font-semibold disabled:opacity-60"
              style={{
                background: "var(--surface)",
                borderColor: "var(--border-strong)",
                color: "var(--text)",
              }}
            >
              Verbindung testen
            </button>
          </Field>
        </div>
        <div className="text-[12px] -mt-1" style={{ color: "var(--text-3)" }}>
          Jira Cloud: API-Token unter{" "}
          <a
            href="https://id.atlassian.com/manage-profile/security/api-tokens"
            target="_blank"
            rel="noreferrer"
            className="underline"
            style={{ color: "var(--accent)" }}
          >
            id.atlassian.com
          </a>{" "}
          erstellen (nicht das Kontopasswort verwenden).
        </div>
        {testStatus && (
          <div
            className="mt-3 rounded-lg border px-3 py-2 text-[12.5px]"
            style={{
              background:
                testStatus.tone === "ok" ? "var(--pos-soft)" : "var(--neg-soft)",
              borderColor: testStatus.tone === "ok" ? "var(--pos)" : "var(--neg)",
              color: testStatus.tone === "ok" ? "var(--pos)" : "var(--neg)",
            }}
          >
            {testStatus.msg}
          </div>
        )}
      </Section>

      <Section title="Sprint & KPI">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Sprint-Ankerdatum">
            <TextInput
              value={sprintAnchorDate}
              onChange={setSprintAnchorDate}
              type="date"
            />
          </Field>
          <Field label="Sprint-Länge (Tage)">
            <TextInput
              value={sprintLengthDays}
              onChange={setSprintLengthDays}
              type="number"
            />
          </Field>
          <Field label="Ziel konkrete Issues (%)">
            <TextInput
              value={concreteTarget}
              onChange={setConcreteTarget}
              type="number"
            />
          </Field>
        </div>
        <div className="mt-1 text-[12px]" style={{ color: "var(--text-3)" }}>
          Beliebiger Tag aus einem vergangenen oder aktuellen Sprint reicht als
          Anker — alle anderen Sprints werden daraus berechnet. Die Quote misst
          den Anteil der Zeit, die nicht auf „Allgemeines&rdquo; gebucht wurde.
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <Field label="Saldo-Korridor: Mitte (h)">
            <TextInput
              value={corridorCenter}
              onChange={setCorridorCenter}
              type="number"
            />
          </Field>
          <Field label="Saldo-Korridor: Spanne ± (h)">
            <TextInput
              value={corridorRange}
              onChange={setCorridorRange}
              type="number"
            />
          </Field>
          <div className="text-[12px] self-end pb-2" style={{ color: "var(--text-3)" }}>
            Erlaubter Bereich für den Überstundensaldo, z. B. 100 ± 40 h. Der
            Saldo-Verlauf in der Auswertung zeigt diesen Bereich.
          </div>
        </div>
      </Section>

      <Section title="Datenpflege">
        <div className="grid grid-cols-3 gap-4 items-end">
          <Field label="Einträge löschen, älter als (Tage)">
            <TextInput value={retention} onChange={setRetention} type="number" />
          </Field>
          <div>
            <button
              type="button"
              onClick={onCleanup}
              disabled={pending}
              className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60"
              style={{
                background: "var(--surface)",
                borderColor: "var(--neg)",
                color: "var(--neg)",
              }}
            >
              Jetzt löschen
            </button>
          </div>
          <div />
        </div>
        <div className="mt-2 text-[12px]" style={{ color: "var(--text-3)" }}>
          Entfernt nur lokale Einträge aus der Datenbank. Jira-Worklogs bleiben unberührt.
          Der Überstundensaldo bleibt erhalten — die gelöschten Tage werden in den
          Startsaldo eingerechnet.
        </div>
        {cleanupStatus && (
          <div className="mt-2 text-[12.5px]" style={{ color: "var(--text-2)" }}>
            {cleanupStatus}
          </div>
        )}
      </Section>

      <DangerSection title="Gefahrenzone">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={forceBooking}
            onChange={(e) => toggleForceBooking(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-[13px]">
            <span className="font-semibold">Force-Buchung aktivieren</span> —
            erlaubt das erneute Senden bereits gebuchter Einträge an Jira.
          </span>
        </label>
        <div className="mt-2 text-[12px]" style={{ color: "var(--neg)" }}>
          Achtung: Dies kann doppelte Worklogs in Jira erzeugen. Die Einstellung
          wird nicht gespeichert und ist nach einem Neustart der App wieder
          deaktiviert.
        </div>
      </DangerSection>

      {(dirty || saveStatus) && (
        <SaveBar
          dirty={dirty}
          status={saveStatus}
          pending={pending}
          onSave={onSave}
          onDiscard={discard}
        />
      )}
    </main>
  );
}

/**
 * Stays at the bottom of the window while there is something to save, so the
 * button is in reach wherever the change was made.
 */
function SaveBar({
  dirty,
  status,
  pending,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  status: { tone: "ok" | "err"; msg: string } | null;
  pending: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  return (
    <div
      role="status"
      className="sticky bottom-4 z-10 flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{
        background: "var(--surface)",
        borderColor: dirty ? "var(--accent)" : "var(--pos)",
        boxShadow: "var(--shadow-lg)",
      }}
    >
      <div className="flex-1 text-[13px]">
        {status ? (
          <span
            style={{ color: status.tone === "ok" ? "var(--pos)" : "var(--neg)" }}
          >
            {status.msg}
          </span>
        ) : (
          <span className="font-semibold">Ungespeicherte Änderungen</span>
        )}
      </div>
      {dirty && (
        <>
          <button
            type="button"
            onClick={onDiscard}
            disabled={pending}
            className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold disabled:opacity-60"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border-strong)",
              color: "var(--text)",
            }}
          >
            Verwerfen
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={pending}
            className="rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-opacity disabled:opacity-60"
            style={{
              background: "var(--accent)",
              borderColor: "var(--accent)",
              color: "#fff",
            }}
          >
            Speichern
          </button>
        </>
      )}
    </div>
  );
}

function DangerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div
        className="rounded-xl border p-5"
        style={{ background: "var(--neg-soft)", borderColor: "var(--neg)" }}
      >
        <div
          className="text-[14px] font-semibold mb-4"
          style={{ color: "var(--neg)" }}
        >
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5">
      <Card>
        <div className="text-[14px] font-semibold mb-4">{title}</div>
        {children}
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block mb-3">
      <div className="text-[12px] mb-1.5" style={{ color: "var(--text-2)" }}>
        {label}
      </div>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-lg border px-3 py-2 text-[13px] outline-none ${className || "w-full"}`}
      style={{
        background: "var(--surface-2)",
        borderColor: "var(--border-strong)",
        color: "var(--text)",
      }}
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
      style={{
        background: "var(--surface-2)",
        borderColor: "var(--border-strong)",
        color: "var(--text)",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
