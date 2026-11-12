# Changelog

Alle wichtigen Änderungen an diesem Projekt stehen in dieser Datei.

Das Format folgt [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).
Die Versionen folgen [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

## [0.9.0-beta.4] - 2026-11-12

### Geändert
- Version: Die erste Tauri-Version heißt 0.9.0 statt 0.10.0. Wer eine Testversion 0.10.0-beta.x installiert hat, wählt beim Installieren einmal „Vor der Installation deinstallieren“. Daten und Autostart bleiben erhalten.

### Behoben
- Tray: Das Menü nach einem Rechtsklick auf das Symbol bleibt offen, auch wenn ein Timer läuft. Bisher schloss es sich nach spätestens einer Sekunde wieder.
- Autostart: Der Schalter gilt immer nur für den eigenen Windows-Benutzer. Lief die App mit Administratorrechten, galt er bisher für alle Benutzer des PCs und blieb nach einer Deinstallation bestehen.

## [0.9.0-beta.3] - 2026-11-12

### Geändert
- Vorschläge im Beschreibungsfeld: Die Auswahl zeigt jetzt 15 statt 8 zuletzt genutzte Einträge. Die Anzahl lässt sich unter Einstellungen → Darstellung von 1 bis 50 einstellen.

## [0.9.0-beta.2] - 2026-11-12

### Behoben
- Issue-Keys: Ein Klick öffnet das Issue wieder im Browser. Seit der Umstellung auf Tauri passierte dabei nichts.

## [0.9.0-beta.1] - 2026-11-12

### Geändert
- Desktop-App: Die App ist neu gebaut, mit Tauri statt Electron. Der Installer ist rund 3 MB statt 96 MB groß, die installierte App rund 8 MB statt 328 MB. Daten und Einstellungen bleiben im selben Ordner und gehen nicht verloren.
- Installation: Der neue Installer ersetzt die alte Version. Er beendet und deinstalliert sie selbst und sichert vorher die Datenbank (`jiraworklog.db.backup-electron-…`). War Autostart an, bleibt er an. Startmenü- und Desktop-Verknüpfung heißen wie vorher. Die App liegt jetzt unter `%LOCALAPPDATA%\JiraWorklog`, der Installer ist auf Deutsch.
- Jira: Die App prüft jetzt das Zertifikat des Jira-Servers. Ein Jira mit firmeneigenem Zertifikat funktioniert nur, wenn Windows diesem Zertifikat vertraut. Die Umgebungsvariable `JIRA_TLS_STRICT` gibt es nicht mehr.
- Jira: Fehlermeldungen sind genauer. Nur ein Zertifikatsproblem nennt noch das Zertifikat. Erreicht die App den Server nicht, steht dort „Keine Verbindung zum Server. Bitte Jira-URL prüfen.“
- Jira: Eine Anfrage an Jira bricht nach 60 Sekunden ab. Vorher wartete die App unbegrenzt.
- PDF: Stundenzettel und Axapta-Bericht bringen ihre Schrift mit. Text lässt sich sauber kopieren. Sehr lange Wörter werden an anderer Stelle getrennt als vorher.
- Autostart: Einstellungen und Anleitung sagen jetzt richtig, dass sich beim Anmelden das Fenster öffnet. Die App startete nie minimiert im Tray.

### Entfernt
- Browser-Modus: JiraWorklog läuft nur noch als Desktop-App für Windows. Den Webserver unter `localhost:3877` und den Schutz gegen Scanner-Anfragen gibt es nicht mehr, weil die App keinen Port mehr öffnet.

## [0.8.0] - 2026-10-30

### Hinzugefügt
- Kalender: Strg + Mausrad zoomt die Zeitachse. Hinein zeigt weniger Stunden, heraus mehr bis zum ganzen Tag. Das Mausrad allein scrollt im Kalender. „Zoom zurücksetzen“ stellt die Startansicht wieder her.
- Kalender: Das Raster nutzt die ganze Fensterhöhe. Ein hohes Fenster zeigt mehr Stunden.
- Issue-Keys sind Links. Ein Klick öffnet das Issue in Jira im Browser. Das gilt in „Buchen“, in der Buchungsvorschau, im Bearbeiten-Dialog und in der Auswertung.
- Auswertung: Ein Klick auf einen Balken in „Zeit pro Ticket“ zeigt die Einträge dahinter, je 20 auf einmal. „Weitere laden“ zeigt die nächsten 20.
- Auswertung: Der Balken „Rest“ in „Zeit pro Ticket“ lässt sich aufklappen und zeigt dann alle Tickets.
- Auswertung: Das neue Liniendiagramm „Saldo-Verlauf“ zeigt den Überstundensaldo am Ende jedes Tages im gewählten Zeitraum. Ein Band zeigt den erlaubten Korridor, Standard 100 ± 40 h. Mitte und Spanne stellst du unter „Sprint & KPI“ ein. Verlässt der Saldo den Korridor, wird die Achse größer und die Linie rot.

### Geändert
- Auswertung: „Zeit pro Ticket“ zeigt Tickets und Allgemeines in getrennten Abschnitten. Krankheit oder Urlaub verdrängen so keine Tickets mehr aus den Top 12.

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
