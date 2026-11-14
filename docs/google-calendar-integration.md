# Google Kalender – technischer Integrationsplan (Entwurf, nicht aktiviert)

Stand: 2026-11-14. Ziel: **ein gemeinsamer Google Kalender „Lebenscockpit“**. Supabase ist führend. Keine Google-zu-App-Rücksynchronisation in V1.

## Festgelegtes Verhalten
- Aufgaben mit Fälligkeitsdatum werden zu Kalendereinträgen; ohne Datum keine Synchronisation.
- Standard: **60 Minuten Popup-Erinnerung** bei Terminen mit Uhrzeit. Ganztagstermine: Kalenderstandard/gesonderte all-day-Regel, **nicht** irreführend 60 Minuten vor Mitternacht.
- Bei Erledigung: zugehörigen Kalendereintrag **löschen**. Bei Wiederöffnung: Eintrag wiederherstellen, sofern die Aufgabe noch offen und datiert ist.
- Bei Umbenennung, Änderung von Zuständigkeit, Datum oder Uhrzeit: bestehenden Eintrag aktualisieren.
- Bei Löschung einer Aufgabe: zugehörigen Eintrag löschen.
- Wiederkehrende Aufgaben: **jede konkrete Aufgabeninstanz** ist ein eigenständiger Google-Termin. Keine zusätzliche Google-RRULE, damit keine Doppelserien entstehen.
- Zuständigkeit im Titel/Beschreibung sichtbar; **keine automatischen persönlichen Einladungen**. Beide Personen abonnieren den gemeinsamen Kalender und aktivieren Benachrichtigungen selbst.
- Zeitzone Europe/Berlin; bei Datum ohne Uhrzeit all-day event (end.date = start.date + 1 Tag). Bei Uhrzeit start/end.dateTime mit Zeitzone; Standarddauer 30 Minuten, konfigurierbar.
- Keine Finanzdaten in Google-Titel oder Beschreibung übertragen.

## Bestehende technische Ausgangslage
- Statische Browser-App (index.html, app.js, logic.js, style.css), Supabase Auth und Tabellen.
- Der Branch enthält die **noch nicht ausgerollte** SQL-Datei `sql/task_completion_atomic.sql` sowie einen Aufruf von `set_task_completion`. **Branch nicht deployen**, bevor RPC, RLS und Tests geprüft sind.
- Vor Kalenderarbeit die Aufgaben-RPC-Migration und den noch offenen transaktionalen Finanzabgleich fertigstellen. Migrationsdateien sind derzeit Entwürfe, nicht angewandt.

## Architektur
1. Browser schreibt nur Aufgaben in Supabase; niemals Google OAuth Refresh Token im Browser speichern.
2. Postgres-Trigger auf INSERT/UPDATE/DELETE von `aufgaben` schreibt in einer Transaktion einen **Outbox-Eintrag** (bei DELETE mit erhaltener Aufgaben-ID und Kalender-Event-ID).
3. Tabelle `kalender_sync`: `aufgabe_id` (UUID), `google_event_id` (TEXT, unique), `status`, `revision`, `synced_revision`, `attempts`, `next_attempt_at`, `last_error`, `updated_at`. Bei Löschung muss die Zuordnung erhalten bleiben (kein CASCADE).
4. Serverseitige Edge Function liest fällige Outbox-Einträge unter exklusivem Lease/Lock, prüft gewünschten **aktuellen** Zustand, erstellt/aktualisiert/löscht Google Events und bestätigt erst danach die Revision.
5. Idempotenz: stabile Google-Event-ID pro Aufgaben-UUID (Google Event ID-Syntax prüfen) oder zuverlässige Persistenz und Recovery bei Timeout nach erfolgreichem POST. Wiederholungsversuche mit Backoff, Dead-Letter/Fehleranzeige, 401 Refresh, 403 Berechtigungen, 404 beim Löschen als Erfolg.
6. Google OAuth: einmalige explizite Zustimmung eines berechtigten Kalender-Eigentümers, Offline-Zugriff, kleinster geeigneter Calendar-Scope; Refresh Token verschlüsselt serverseitig speichern. OAuth Client Secret in Supabase Secrets; niemals im Repository. Token-Rotation und Entzug berücksichtigen.
7. Edge Function nur mit geprüftem Auth-Kontext oder internem Scheduler-Secret aufrufen; keine öffentliche Admin-Funktion. RLS für alle neuen public-Tabellen, Mitgliedschaftsprüfung, keine ungeschützten service-role-Endpunkte.
8. Zunächst manueller Testlauf; später geplante Ausführung via Supabase Cron/Edge Functions. Sync-Status in App erst anzeigen, wenn Backend zuverlässig verfügbar ist.

## Reihenfolge und Gates
- **Gate 0**: Bestehende Branch-RPC und Finanzabgleich fertigstellen; Node-Tests + echte isolierte DB-Tests, RLS mit zwei Mitgliedern und einem Fremdnutzer.
- **Gate 1**: Google Cloud Projekt, OAuth Consent, Testnutzer und **separaten Testkalender** bereitstellen; Berechtigungen bestätigen. Keine produktiven Google-Termine.
- **Gate 2**: Schema-/Outbox-Migration auf isolierter Testdatenbank; Rollback und Datenübernahme für vorhandene Aufgaben testen.
- **Gate 3**: Edge Function + OAuth Callback + Synchronisationsworker entwickeln; Credentials nur in Testumgebung.
- **Gate 4**: Integrationstests: create/update/delete/done/undo, recurrence, parallele Geräte, Duplikatvermeidung, Netzfehler, 401/403/404/429, Token-Rotation, Zeitzone/DST, all-day, 60-Minuten-Erinnerung.
- **Gate 5**: PR, Actions auf PR nach main, Security Review, manuelle Freigabe; erst danach Produktionsmigration und Aktivierung, initiale Synchronisation kontrolliert.

## Noch zu entscheiden
- Ganztagstermine: Erinnerung z. B. am Vortag um 18 Uhr oder am Fälligkeitstag um 9 Uhr (Google-Event-Reminder-Minuten allein nicht ausreichend für lokale Uhrzeit).
- Sichtbarkeit: Kalender enthält Aufgabentitel; Zugriff nur für ausdrücklich eingeladene Personen.
- Google-OAuth-Hosting/Redirect-URL und ob App-Hosting einen serverseitigen OAuth-Callback erlaubt.
- Aufgabenuhrzeit im UI (optional); Aufgaben ohne Uhrzeit als ganztägig.
- Umgang mit Google-Terminen, die Nutzer manuell verändern (V1: App überschreibt beim nächsten Aufgaben-Update; keine Rücksync).

## Nicht im Umfang dieses vorbereitenden Commits
Keine produktive DB-Migration, keine Edge-Function-Deployment, keine Google API Calls, keine OAuth-Zugangsdaten, keine Veränderung bestehender App-Funktionen.
