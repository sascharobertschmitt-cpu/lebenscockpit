# Lebenscockpit – verschlüsselte externe Backups

**Status:** vorbereitet, noch nicht aktiv. Keine Datenbanksicherung wurde erstellt.

## Ablauf
GitHub Actions exportiert täglich um 02:00 UTC die Supabase-PostgreSQL-Datenbank mit `pg_dump` (Custom Format), verschlüsselt die Datei lokal mit `age` und lädt **nur die verschlüsselte Datei** in den Google-Drive-Ordner hoch. Keine unverschlüsselten Dumps als GitHub-Artefakte. Der Runner löscht temporäre Dateien beim Abschluss.

## Vor der Aktivierung erforderlich
1. **Dedizierten Google-Zugang für Backups konfigurieren.** Rclone lokal mit Google Drive OAuth einrichten (`rclone config`), Remote `drive` benennen, möglichst eingeschränkte Zugriffsrechte wählen. Die gesamte rclone-Konfiguration Base64-kodiert als GitHub Actions Repository Secret `BACKUP_RCLONE_CONFIG_B64` hinterlegen. OAuth-Refresh-Token bleibt geheim. Google-Drive-Chat-Verbindung ist dafür **nicht** automatisch nutzbar.
2. **Datenbankzugang:** Geeignete PostgreSQL-Backup-Verbindungszeichenfolge (direkter DB-Endpunkt oder Session Pooler) als GitHub Secret `BACKUP_DATABASE_URL` hinterlegen. Der Zugang muss alle benötigten Schemas lesen können. Keine Secrets in Issues, Chat oder Dateien posten.
3. **Verschlüsselung:** Lokal mit `age-keygen -o lebenscockpit-backup-key.txt` ein Schlüsselpaar erzeugen. Den privaten Schlüssel offline und unabhängig von Drive/GitHub sicher verwahren. Den öffentlichen Empfänger `age1...` als GitHub Repository Variable `BACKUP_AGE_RECIPIENT` hinterlegen.
4. **Ordner:** Google-Drive-Ordner-ID `1Xgh2cJcJMwshOnuxCY4ovDJHNVEdPcLq` als GitHub Repository Variable `BACKUP_DRIVE_FOLDER_ID` hinterlegen.
5. **Manuell testen:** Workflow via `workflow_dispatch` starten, verschlüsselte Datei in Drive kontrollieren, Datei herunterladen, mit dem privaten age-Schlüssel entschlüsseln und testweise in einer **separaten** PostgreSQL-Testdatenbank mit `pg_restore` wiederherstellen. Keine produktive Datenbank überschreiben.
6. Erst nach erfolgreicher Wiederherstellung die geplante Ausführung aktivieren (Merge nach main).

## Noch offen
- Keine automatische 30-Tage-Löschung: Erst nach validierten Wiederherstellungstests und einer Schutzregel gegen versehentliches Löschen ergänzen.
- Die GitHub Actions cron-Zeit ist UTC und wechselt gegenüber der deutschen Ortszeit bei Sommerzeit.
- GitHub Actions-Schedules können verspätet ausführen oder ausfallen. Backup-Erfolg und Aktualität sollten überwacht werden.
- `pg_dump` sichert Datenbankobjekte, nicht automatisch Supabase Storage-Dateien, Auth-Konfiguration außerhalb der Datenbank oder Projekt-Secrets.
- Für regelmäßige Backups ist eine sichere Aufbewahrung des privaten Entschlüsselungsschlüssels unverzichtbar.
