import Link from "next/link";
import type { ReactNode } from "react";
import { Card, PageHeader } from "@/components/ui";

// Hand-written user guide. Keep it in sync with the "Features" part of
// README.md (see CLAUDE.md → Nutzer-Doku).

const SECTIONS = [
  { id: "start", title: "Erste Schritte" },
  { id: "format", title: "Beschreibungsformat" },
  { id: "erfassen", title: "Zeit erfassen" },
  { id: "allgemeines", title: "Allgemeines" },
  { id: "jira", title: "Nach Jira buchen" },
  { id: "farben", title: "Ticket-Farben" },
  { id: "kalender", title: "Kalender" },
  { id: "auswertung", title: "KPIs und Auswertung" },
  { id: "pausen", title: "Pausen und Abwesenheit" },
  { id: "desktop", title: "Desktop-App" },
  { id: "einstellungen", title: "Einstellungen" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export default function HilfePage() {
  return (
    <main className="px-4 py-5 sm:px-8 sm:py-7 max-w-[920px]">
      <PageHeader
        title="Hilfe"
        subtitle="Anleitung zu den wichtigsten Funktionen"
        actions={
          <Link
            href="/hilfe/neu"
            className="px-3 py-1.5 rounded-lg text-[13px] font-medium border"
            style={{ borderColor: "var(--border)", color: "var(--text-2)" }}
          >
            Was ist neu
          </Link>
        }
      />

      <Card className="mb-5">
        <div
          className="text-[12px] font-medium mb-2"
          style={{ color: "var(--text-2)" }}
        >
          Inhalt
        </div>
        <ol className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13.5px] list-decimal pl-5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} style={{ color: "var(--accent)" }}>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </Card>

      <div className="flex flex-col gap-5">
        <Section id="start">
          <P>
            JiraWorklog erfasst deine Arbeitszeit lokal auf deinem Rechner. Du
            buchst sie danach als Worklogs nach Jira. Es gibt keine Cloud und
            kein Konto.
          </P>
          <Steps>
            <li>
              Öffne <Ui>Einstellungen</Ui> → <Ui>Jira-Anbindung</Ui>.
            </li>
            <li>
              Trage die Jira-URL ein, z. B.{" "}
              <Code>https://firma.atlassian.net</Code>. Schreibe keinen Pfad ans
              Ende.
            </li>
            <li>Trage die E-Mail deines Atlassian-Kontos ein.</li>
            <li>
              Lege einen{" "}
              <ExternalLink href="https://id.atlassian.com/manage-profile/security/api-tokens">
                API-Token
              </ExternalLink>{" "}
              an und trage ihn ein. Das Kontopasswort funktioniert nicht.
            </li>
            <li>
              Trage die Projekt-Keys ein, z. B. <Code>TX4B</Code>. Nur Issues
              dieser Projekte werden erkannt.
            </li>
            <li>
              Klicke auf <Ui>Verbindung testen</Ui> und dann auf{" "}
              <Ui>Speichern</Ui>.
            </li>
          </Steps>
          <P>
            Stelle unter <Ui>Arbeitszeit</Ui> auch deine Regelarbeitszeit und
            dein Tagesziel ein. Saldo und KPIs rechnen damit.
          </P>
        </Section>

        <Section id="format">
          <P>Die Beschreibung eines Eintrags hat drei Teile:</P>
          <pre
            className="my-3 px-4 py-3 rounded-lg text-[13px] overflow-x-auto"
            style={{ background: "var(--surface-2)" }}
          >
            Merksatz  ISSUE-123  Worklog-Kommentar für Jira
          </pre>
          <List>
            <li>
              <b>Merksatz</b> — freier Text für dich. Er bleibt lokal und geht
              nicht nach Jira.
            </li>
            <li>
              <b>ISSUE-123</b> — der Jira-Issue-Key. Er muss zu einem deiner
              Projekt-Keys passen.
            </li>
            <li>
              <b>Worklog-Kommentar</b> — erscheint als Kommentar im Jira-Worklog.
              Er ist optional.
            </li>
          </List>
          <P>
            Ohne Issue-Key zeigt der Eintrag <Ui>kein Issue-Key</Ui>. Beim
            Buchen wird er übersprungen.
          </P>
        </Section>

        <Section id="erfassen">
          <List>
            <li>
              <b>Timer</b> — Gib oben in <Ui>Buchen</Ui> eine Beschreibung ein
              und starte den Timer. Die Zeit läuft live mit.
            </li>
            <li>
              <b>Vorschläge</b> — Klicke in das Feld. Du siehst die acht zuletzt
              genutzten Einträge der letzten 30 Tage. Tippe zum Filtern. Wähle
              mit den Pfeiltasten. <Kbd>Enter</Kbd> startet den Timer.
            </li>
            <li>
              <b>Startzeit korrigieren</b> — Zu spät gestartet? Setze die
              Startzeit des laufenden Timers einfach früher.
            </li>
            <li>
              <b>Manuell anlegen</b> — Mit <Ui>Eintrag manuell anlegen</Ui> gibst
              du Beginn und Ende selbst ein.
            </li>
            <li>
              <b>Bearbeiten und löschen</b> — Klicke auf den Stift an einem
              Eintrag. Das Feld <Ui>Beschreibung</Ui> zeigt dieselben Vorschläge
              wie das Timer-Feld. Ein Vorschlag übernimmt Beschreibung,
              Allgemein-Haken und Kategorie. Gespeichert wird erst mit{" "}
              <Ui>Speichern</Ui>.
            </li>
            <li>
              <b>Gruppe bearbeiten</b> — Einträge mit gleicher Beschreibung am
              selben Tag bilden eine Gruppe. Der Stift an der Gruppe öffnet{" "}
              <Ui>Gruppe bearbeiten</Ui>. Dort änderst du die Beschreibung aller
              Einträge auf einmal. Die Zeiten bleiben gleich. Passt die neue
              Beschreibung zu einer anderen Gruppe des Tages, werden beide eine
              Gruppe.
            </li>
            <li>
              <b>Wiederholen</b> — Der Play-Knopf an einem Eintrag startet einen
              neuen Timer mit derselben Beschreibung.
            </li>
            <li>
              <b>Verlauf</b> — Die Liste zeigt die letzten 30 Tage. Unten lädst
              du weitere 90 Tage oder alles. Saldo und Zähler gelten immer für
              alle Tage.
            </li>
          </List>
          <Hint>
            Ein Timer unter 1 Minute wird verworfen. Er ist zu kurz für Jira.
          </Hint>
        </Section>

        <Section id="allgemeines">
          <P>
            Manche Arbeit gehört zu keinem Jira-Issue. Dafür gibt es
            „Allgemeines“.
          </P>
          <List>
            <li>
              Setze den Haken <Ui>Als Allgemein speichern (nicht nach Jira
              buchen)</Ui>. Das geht im Timer, beim manuellen Anlegen und im
              Bearbeiten-Dialog.
            </li>
            <li>
              Wähle eine Kategorie: <Code>Projektorganisation</Code>,{" "}
              <Code>Implementierung</Code>, <Code>QA</Code> oder{" "}
              <Code>Release</Code>.
            </li>
            <li>
              Der Eintrag bleibt lokal. Er geht nie nach Jira und zählt nicht
              als offen.
            </li>
            <li>
              Die Zeit buchst du von Hand in Axapta. Den passenden Bericht
              findest du unter <a href="#auswertung" style={{ color: "var(--accent)" }}>Auswertung</a>.
            </li>
          </List>
        </Section>

        <Section id="jira">
          <Steps>
            <li>
              Öffne <Ui>Buchen</Ui>. Offene Einträge haben das Badge{" "}
              <Ui>offen</Ui>, gebuchte das Badge <Ui>gebucht</Ui>.
            </li>
            <li>
              Buche einen einzelnen Tag oder alle offenen Einträge auf einmal.
            </li>
            <li>
              Prüfe die Vorschau. Sie zeigt jeden Worklog, der nach Jira geht.
            </li>
            <li>
              Klicke auf <Ui>Jetzt buchen</Ui>.
            </li>
          </Steps>
          <P>
            Unter <Ui>Einstellungen</Ui> → <Ui>Buchung</Ui> wählst du den Modus:
          </P>
          <List>
            <li>
              <b>Gebündelt</b> — Einträge mit gleicher Beschreibung werden ein
              Worklog.
            </li>
            <li>
              <b>Einzeln</b> — Jeder Eintrag wird ein eigener Worklog.
            </li>
          </List>
          <Hint>
            <b>Force-Buchung</b> (Einstellungen → Gefahrenzone) sendet auch
            gebuchte Einträge noch einmal. Sie gilt nur bis zum nächsten
            Neustart. Solange sie an ist, zeigt <Ui>Buchen</Ui> eine Warnung.
          </Hint>
        </Section>

        <Section id="farben">
          <List>
            <li>
              Klicke auf den Punkt neben einem Ticket. Das geht in{" "}
              <Ui>Buchen</Ui> und im Bearbeiten-Dialog.
            </li>
            <li>
              Wähle eine von 8 Farben. Alle Einträge mit demselben Issue-Key
              bekommen sie. Allgemeines-Einträge bekommen eine Farbe pro
              Kategorie.
            </li>
            <li>
              <Ui>Standard</Ui> setzt die Farbe zurück.
            </li>
            <li>
              Die Farbe erscheint in der Liste, im Kalender und in der
              Auswertung.
            </li>
          </List>
        </Section>

        <Section id="kalender">
          <P>
            Der Kalender zeigt eine Woche als Zeitstrahl. Jeder Tag ist eine
            Spalte.
          </P>
          <List>
            <li>
              <b>Überschneidungen</b> — Einträge, die sich überlappen, stehen
              nebeneinander. Die gemeinsame Zeit ist schraffiert. Unter 1
              Minute zählt nicht. Der Tageskopf zeigt die Anzahl rot.
            </li>
            <li>
              <b>Lücken</b> — Zeit ohne Eintrag zwischen dem ersten und letzten
              Eintrag eines Tages ist grau gestrichelt umrandet. Ein Klick auf
              eine Lücke legt einen Eintrag an. Beginn und Ende sind schon
              gefüllt. Der Tageskopf zeigt die Anzahl gelb.
            </li>
            <li>
              <b>Pausen</b> — Deine Pausenfenster sind grau. Sie zählen nicht als
              Lücke.
            </li>
            <li>
              <b>Korrigieren</b> — Ein Klick auf einen Eintrag öffnet den
              Bearbeiten-Dialog. Den laufenden Timer bearbeitest du in{" "}
              <Ui>Buchen</Ui>.
            </li>
            <li>
              <b>Wochensaldo</b> — zeigt die Über- oder Minusstunden der Woche.
            </li>
          </List>
        </Section>

        <Section id="auswertung">
          <P>
            Oben in <Ui>Buchen</Ui> siehst du die KPIs für heute:
          </P>
          <List>
            <li>
              <b>Heute erfasst</b> und <b>Verbleibend bis Ziel</b> — mit dem
              Tagesziel aus den Einstellungen.
            </li>
            <li>
              <b>Überstundensaldo</b> — Plus oder Minus über alle Tage. Zeit aus
              der Zeit vor der App trägst du als Startwert ein.
            </li>
          </List>
          <P>
            In <Ui>Auswertung</Ui> wählst du einen Zeitraum: Woche, Sprint,
            Monat, YTD oder alles. Mit den Pfeilen blätterst du.
          </P>
          <List>
            <li>Arbeitszeit pro Tag als Balkendiagramm.</li>
            <li>Durchschnitt pro Woche und pro Arbeitstag, Wochenstatus.</li>
            <li>
              <b>Quote konkrete Issues</b> — Anteil der Zeit auf echten
              Jira-Issues. Das Ziel stellst du unter <Ui>Sprint &amp; KPI</Ui>{" "}
              ein. Dort legst du auch Sprint-Start und Sprint-Länge fest.
            </li>
            <li>
              <b>Zeit pro Ticket</b> — Balken pro Ticket und Kategorie, mit
              Anteil in Prozent.
            </li>
            <li>
              <b>Stundenzettel</b> — alle Einträge des Zeitraums als PDF.
            </li>
            <li>
              <b>Axapta-Bericht</b> — Zeit pro Allgemeines-Kategorie für einen
              Monat, als PDF. Die Zeit ist in Blöcke von max. 24 h geteilt. Zeit
              auf konkreten Issues zählt als <Code>Implementierung</Code>.
            </li>
          </List>
        </Section>

        <Section id="pausen">
          <List>
            <li>
              <b>Pausenfenster</b> — z. B. 12:00–13:00. Die App zieht diese Zeit
              automatisch ab. Du kannst mehrere Fenster anlegen.
            </li>
            <li>
              <b>Auto-Pause</b> — schaltet den Abzug ganz ein oder aus.
            </li>
            <li>
              <b>Abwesenheit</b> (nur Desktop-App) — Nach Bildschirmsperre oder
              Standby ab 5 Minuten fragt die App, was mit der Zeit passiert. Die
              Zeit bleibt. Oder sie wird abgezogen und der Timer stoppt. Oder
              sie wird abgezogen und der Timer läuft als neuer Eintrag weiter.
            </li>
          </List>
          <P>
            Alles das stellst du unter <Ui>Einstellungen</Ui> →{" "}
            <Ui>Pausen</Ui> ein.
          </P>
        </Section>

        <Section id="desktop">
          <List>
            <li>
              <b>Tray</b> — Das Symbol unten rechts zeigt den laufenden Timer.
              Rechtsklick: Timer stoppen, Fenster zeigen, Beenden.
            </li>
            <li>
              <b>Schließen</b> — Das Fenster geht nur in den Tray. Der Timer
              läuft weiter. Ganz beenden: Tray → <Ui>Beenden</Ui> oder Menü{" "}
              <Ui>Datei</Ui> → <Ui>Beenden</Ui>.
            </li>
            <li>
              <b>Autostart</b> — Startet die App beim Anmelden in Windows,
              minimiert im Tray. Einschalten unter <Ui>Einstellungen</Ui> →{" "}
              <Ui>Desktop</Ui>.
            </li>
            <li>
              <b>Eine Instanz</b> — Ein zweiter Start holt das offene Fenster
              nach vorne.
            </li>
            <li>
              <b>Menü Hilfe</b> — öffnet diese Seite (<Kbd>F1</Kbd>), „Was ist
              neu“ und den Datenordner mit Datenbank und Logs.
            </li>
          </List>
        </Section>

        <Section id="einstellungen">
          <List>
            <li>
              <b>Arbeitszeit</b> — Regelarbeitszeit, Tagesziel,
              Überstunden-Startwert.
            </li>
            <li>
              <b>Pausen</b> — Pausenfenster, Auto-Pause, Abwesenheit.
            </li>
            <li>
              <b>Jira-Anbindung</b> — URL, E-Mail, API-Token, Projekt-Keys.
            </li>
            <li>
              <b>Buchung</b> — gebündelt oder einzeln.
            </li>
            <li>
              <b>Sprint &amp; KPI</b> — Sprint-Start, Sprint-Länge, Ziel der
              Quote.
            </li>
            <li>
              <b>Darstellung</b> — System, Hell oder Dunkel.
            </li>
            <li>
              <b>Datenpflege</b> — alte Einträge löschen. Der Saldo bleibt
              erhalten.
            </li>
          </List>
          <P>
            Nach einer Änderung erscheint unten eine Leiste mit{" "}
            <Ui>Verwerfen</Ui> und <Ui>Speichern</Ui>. Verlässt du die Seite
            ohne Speichern, fragt die App vorher.
          </P>
        </Section>
      </div>

      <div
        className="mt-6 text-[12px] flex gap-3"
        style={{ color: "var(--text-3)" }}
      >
        <span>JiraWorklog v{process.env.NEXT_PUBLIC_APP_VERSION}</span>
        <Link href="/hilfe/neu" style={{ color: "var(--accent)" }}>
          Was ist neu
        </Link>
      </div>
    </main>
  );
}

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const index = SECTIONS.findIndex((s) => s.id === id);
  return (
    <section id={id} className="scroll-mt-6">
      <Card>
        <h2 className="text-[16px] font-semibold mb-3">
          {index + 1}. {SECTIONS[index].title}
        </h2>
        <div className="text-[13.5px] leading-relaxed">{children}</div>
      </Card>
    </section>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="my-2">{children}</p>;
}

function List({ children }: { children: ReactNode }) {
  return <ul className="my-2 pl-5 list-disc flex flex-col gap-1">{children}</ul>;
}

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="my-2 pl-5 list-decimal flex flex-col gap-1">{children}</ol>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <div
      className="mt-3 px-3 py-2 rounded-lg text-[13px]"
      style={{ background: "var(--warn-soft)", color: "var(--text)" }}
    >
      {children}
    </div>
  );
}

/** Name of a button, field or page as it appears in the app. */
function Ui({ children }: { children: ReactNode }) {
  return <span className="font-medium">„{children}“</span>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code
      className="px-1 py-0.5 rounded text-[12.5px]"
      style={{ background: "var(--surface-2)" }}
    >
      {children}
    </code>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className="px-1.5 py-0.5 rounded border text-[12px]"
      style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
    >
      {children}
    </kbd>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{ color: "var(--accent)" }}
    >
      {children}
    </a>
  );
}
