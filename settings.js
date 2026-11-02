// Einstellungen der Quiz-App
// Aus dem Nickname wird intern eine Pseudo-E-Mail gebaut (z. B. "ali" -> ali@tefsir-quiz.app).
export const EMAIL_DOMAIN = "tefsir-quiz.app";

// Nicknames mit Admin-Rechten (klein geschrieben). Muss zu den Firestore-Regeln passen!
export const ADMIN_NICKS = ["sebahaddin"];

// Punkte
export const BASE_POINTS = 100;      // für eine ganz richtige Antwort
export const SPEED_BONUS = 50;       // maximaler Schnelligkeitsbonus
export const DEFAULT_TIME = 30;      // Sekunden pro Frage, wenn die Frage nichts anderes sagt
