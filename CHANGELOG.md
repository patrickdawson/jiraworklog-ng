# Changelog

Alle wichtigen Änderungen an diesem Projekt stehen in dieser Datei.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).
Die Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Hinzugefügt
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
