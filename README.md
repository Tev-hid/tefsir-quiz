# Tefsir Quiz

Wöchentliches Quiz zur Tefsir-Sohbet (Fî Zılâli’l-Kur’ân) mit Nickname-Login und Liga.

- **Hosting:** GitHub Pages (statische Dateien, kein Build-Schritt)
- **Login & Datenbank:** Firebase Authentication (E-Mail/Passwort mit Pseudo-E-Mail aus dem Nickname) und Cloud Firestore
- **Drag & Drop:** SortableJS · **Konfetti:** canvas-confetti

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html`, `styles.css`, `app.js` | Die App |
| `firebase-config.js` | Öffentliche Firebase-Web-Konfiguration |
| `settings.js` | Admin-Nicknames, Punkte, Zeit pro Frage |
| `firestore.rules` | Sicherheitsregeln (in der Firebase-Konsole unter Firestore → Regeln einfügen) |
| `quizzes/index.json` | Liste aller Quizze |
| `quizzes/<id>.json` | Ein Quiz mit seinen Fragen |
| `img/` | Bilder für Fragen |

## Neues Quiz hinzufügen

1. Neue Datei `quizzes/wXX-....json` nach dem Muster von `w01-bakara-1-5.json` anlegen.
2. Eintrag in `quizzes/index.json` ergänzen.
3. In der App unter **Admin** auf **Freigeben** klicken.

## Fragetypen

- `mc` – Multiple Choice (`options`, `answer` = Index der richtigen Antwort; Optionen können `image` haben)
- `tf` – Richtig/Falsch (`answer`: true/false)
- `order` – Reihenfolge per Drag & Drop (`items` in richtiger Reihenfolge)
- `match` – Zuordnen per Drag & Drop (`pairs`: `{left, right}`)
- `bucket` – Karten in Körbe sortieren, per Ziehen oder Antippen (`buckets`: `[{label, icon}]`, `items`: `[{text, bucket: Index}]`)

Jede Frage kann zusätzlich `image`, `video` (YouTube-ID), `arabic`, `time` (Sekunden) und `explain` haben.
Texte sind entweder ein String oder `{ "tr": "...", "de": "..." }`.
