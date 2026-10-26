# Changelog

Alle wichtigen Änderungen an diesem Projekt stehen in dieser Datei.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).
Die Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

## [0.7.0] - 2026-10-26

### Hinzugefügt
- Kalender: Der Tageskopf zeigt die Arbeitszeit des Tages. Pausen sind abgezogen, ein laufender Timer zählt live mit.

### Geändert
- Buchen: Beim Ändern der Startzeit des laufenden Timers steht die Uhrzeit vorn und das Datum dahinter. Du änderst so nicht mehr aus Versehen das Datum.

## [0.6.0] - 2026-10-21

### Hinzugefügt
- Buchen: „Gruppe bearbeiten“ ändert Beschreibung, Allgemein-Haken und Kategorie aller Einträge einer Gruppe auf einmal. Die Zeiten bleiben gleich.
- Eintrag bearbeiten und anlegen: Das Feld „Beschreibung“ zeigt dieselben Vorschläge wie das Timer-Feld, auch im Kalender. Ein Vorschlag übernimmt Beschreibung, Allgemein-Haken und Kategorie.

### Geändert
- Farbe pro Ticket: „Rot“ heißt jetzt „Pink“. „Orange“ ist jetzt ein kräftiges Orange statt Gelb-Orange. Schon gewählte Farben wechseln automatisch mit.
- Kalender: Lücken haben keine gelbe Fläche mehr, nur einen grauen gestrichelten Rand. Überlappungen sind grau statt rot schraffiert. So sieht kein Ticket mehr wie eine Lücke oder Überlappung aus. Die Zahlen im Tageskopf bleiben rot und gelb.

## [0.5.0] - 2026-10-14

### Hinzugefügt
- Hilfe: Die neue Seite „Hilfe“ in der Seitenleiste erklärt die wichtigsten Funktionen Schritt für Schritt. „Was ist neu“ zeigt die Änderungen pro Version.
- Desktop-App: Das Menü ist jetzt deutsch und schlank (Datei, Bearbeiten, Ansicht, Hilfe). Unter „Hilfe“ stehen Anleitung (F1), Was ist neu, Datenordner öffnen und Über JiraWorklog.
- Desktop-App: Externe Links öffnen im Standard-Browser.

### Geändert
- Einstellungen: „Speichern“ steht nicht mehr oben auf der Seite. Nach einer Änderung bleibt unten eine Leiste mit „Verwerfen“ und „Speichern“ sichtbar, auch beim Scrollen. Wer die Seite mit ungespeicherten Änderungen verlässt, wird vorher gefragt.

## [0.4.0] - 2026-10-13

### Hinzugefügt
- Farbe pro Ticket: Ein Punkt neben dem Ticket in „Buchen“ und im Bearbeiten-Dialog öffnet eine Palette mit 8 Farben. Alle Einträge mit demselben Issue-Key bekommen die Farbe. Allgemeines-Einträge bekommen eine Farbe pro Kategorie. „Standard“ setzt die Farbe zurück.
- Kalender: Die Blöcke zeigen die Farbe des Tickets.
- Buchen: Eine Zeile mit Farbe bekommt einen farbigen Hintergrund und einen farbigen linken Rand.
- Auswertung: Die neue Karte „Zeit pro Ticket“ zeigt die Zeit pro Ticket und Kategorie als Balken in der Ticket-Farbe, mit Anteil in Prozent.
- Desktop-App: Nach Bildschirmsperre oder Standby ab 5 Minuten fragt die App, was mit der Abwesenheitszeit des laufenden Timers passiert. Die Zeit bleibt, oder sie wird abgezogen und der Timer stoppt, oder sie wird abgezogen und der Timer läuft als neuer Eintrag weiter. Ein- und ausschalten unter Einstellungen → Pausen.

### Geändert
- Kalender: Eine Überlappung unter 1 Minute gilt nicht mehr als Überlappung. Die Einträge stehen dann nicht nebeneinander und sind nicht rot markiert.

## [0.3.0] - 2026-10-09

### Hinzugefügt
- Kalender: Der „Wochensaldo“ zeigt die Über- oder Minusstunden der gewählten Woche. Ein laufender Timer zählt live mit.
- Kalender: Klick auf eine Lücke öffnet den Dialog „Eintrag anlegen“. Beginn und Ende sind schon mit der Lücke gefüllt.

### Geändert
- Auswertung: Der Knopf „Monatsbericht“ heißt jetzt „Axapta-Bericht“.
- Das PDF heißt jetzt auch „Axapta-Bericht“, in der Überschrift und im Dateinamen (`axapta-bericht-<Monat>.pdf`).

## [0.2.0] - 2026-10-08

### Hinzugefügt
- Kalender: Wochenansicht als Zeitstrahl mit Lücken, Überschneidungen und Pausen. Klick auf einen Eintrag öffnet den Bearbeiten-Dialog.
- Windows-Desktop-App mit Electron: System-Tray mit laufendem Timer, Minimieren in den Tray, nur eine Instanz, optionaler Autostart.
- NSIS-Installer pro Benutzer (`JiraWorklog-<version>-setup.exe`).
- Vorschläge der zuletzt genutzten Einträge im Timer-Feld.
- Überstundensaldo läuft live mit, solange ein Timer läuft.
- Allgemeines-Einträge bleiben lokal und bekommen eine Kategorie (Projektorganisation, Implementierung, QA, Release).
- Monatsbericht als PDF mit Zeit pro Kategorie.
- Stundenzettel als PDF.
- Zeitraum „Sprint“ in der Auswertung, mit Sprint-Ankerdatum und Sprint-Länge.
- KPI „Quote konkrete Issues“ mit Zielwert und Diagramm pro Tag.
- Force-Buchung: bereits gebuchte Einträge erneut senden. Gilt nur bis zum Neustart.
- Startzeit des laufenden Timers nachträglich korrigieren.
- Überstunden-Startwert in den Einstellungen.
- Farbschema: System, Hell oder Dunkel.
- Proxy gegen Scanner und Anfrage-Fluten.

### Geändert
- Allgemeines-Einträge werden nicht mehr nach Jira gebucht. Die automatische Sammelbuchung ist entfernt.
- Die Eintragsliste zeigt standardmäßig nur die letzten 30 Tage. Ältere Tage lassen sich nachladen.
- Standard-Port ist jetzt 3877 statt 3000.
- Bestätigungen nutzen einen Dialog in der App statt des Browser-`confirm()`.

### Behoben
- Beim Löschen alter Einträge bleibt der Überstundensaldo erhalten.
- Fehler beim PDF-Export erscheinen direkt auf der Seite statt als `alert()`.
- Der Timer im Tray läuft weiter, wenn das Fenster versteckt ist.
- Schnellere Abfrage des laufenden Eintrags durch einen Index auf `ended_at`.

## [0.1.0] - 2026-05-26

### Hinzugefügt
- Erste Version: Timer, manuelle Einträge, KPI-Dashboard, Buchen nach Jira Cloud, Auswertung, Pausenabzug und Einstellungen.
