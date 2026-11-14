# Beleg-Fotos: Backup- und Restore-Grenzen

Stand: 2026-11-14. **Keine produktive Storage-Änderung.**

## Bestehender Schutz
Der Workflow `.github/workflows/encrypted-drive-backup.yml` sichert per `pg_dump` ausschließlich PostgreSQL-Daten. Die Binärdateien aus Supabase Storage (Bucket `belege`) sind **nicht** Teil dieses Dumps. Eine erfolgreiche Datenbank-Wiederherstellung allein stellt daher keine Belegfotos wieder her.

## Sichere Umsetzung vor Foto-Rollout
1. Eigenständigen, verschlüsselten Storage-Export für `belege` einrichten. Der Export muss die Originalbytes und eine Manifestdatei (Objektpfad, Größe, SHA-256, Zeitstempel) enthalten. Keine öffentlichen Bucket-URLs und keine Zugangsdaten in Logs/Artifacts.
2. Für den Export einen separaten, eng begrenzten Zugriff prüfen. **Keinen Service-Role-Key in einen Browser oder ins Frontend einbauen.** GitHub-Secrets nur nach expliziter Freigabe und mit minimalen Rechten.
3. Backup mit demselben öffentlichen `age`-Empfänger wie die bestehende Datenbanksicherung verschlüsseln; den privaten Schlüssel weiterhin ausschließlich offline halten. Die Aufbewahrungsdauer und Speichergrenzen der GitHub-Artefakte berücksichtigen.
4. Mindestens einen Restore mit synthetischen JPEG-Dateien in einer isolierten Umgebung durchführen. Nach dem Restore Hashes vergleichen und prüfen, ob `einkaeufe.beleg_pfad` und `beleg_eingang.beleg_pfad` zu vorhandenen Objekten passen.
5. Erst danach produktive Foto-Uploads freigeben, wenn die Wiederherstellbarkeit von Belegen eine Anforderung ist.

## End-to-End-Prüfmatrix (noch offen)
- Mitglied A: Upload `<uuid>.jpg`, signierte URL, Zuordnung, Bildanzeige, Löschen.
- Mitglied B: Dasselbe Bild ansehen und Zuordnung durchführen.
- `anon` und angemeldetes Nichtmitglied: Upload, Download/signierte URL und Löschen jeweils verweigert.
- Ungültiger Name, fremder Bucket, falscher MIME-Type, über 3 MB: abgelehnt.
- Gleichzeitige Zuordnung: genau ein Einkauf; keine Doppelbuchung.
- Fehlgeschlagener Upload und fehlgeschlagene DB-Buchung: keine halben Datensätze; verwaiste Objekte gesondert erfassen.
- iPhone: Kamera, HEIC-Konvertierung, Mehrfachauswahl, Zoom und Tastatur bei Zuordnung.

**Wichtig:** Die SQL-Postflight-Prüfung kann nicht beweisen, dass keine *allgemeine* `storage.objects`-Policy zusätzlich Zugriff erlaubt. Nur echte API-Tests unter unterschiedlichen Identitäten decken das zuverlässig ab.

## Release-Entscheidung
Solange der Bucket nicht mit echten Auth-/Storage-API-Aufrufen getestet und ein akzeptierter Backup-/Restore-Weg geklärt ist, ist der Foto-Eingang **nicht produktionsfreigegeben**. Die datenbankseitigen Tests allein sind dafür kein Ersatz.
