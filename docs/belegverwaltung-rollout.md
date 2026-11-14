# Belegverwaltung – geprüfte Vorbereitung (14.11.2026)

Status: **Entwurf, nicht deployen**. Branch ist ausschließlich zur Vorbereitung bestimmt.

## Verifizierter Istzustand
- Supabase-Projekt: Lebenscockpit (`txxlniprkltweeenmexf`).
- Tabellen: `posten` (UUID), `posten_zahlungen` (UUID, `posten_id`), `bankumsaetze` (BIGINT), daneben `einnahmen`, `kontostaende`, `aufgaben`, `mitglieder`.
- Bestehende RLS-Policies verwenden `private.ist_mitglied()` für `authenticated`.
- Bucket `belege` existiert nicht; auf `storage.objects` existieren keine Policies.
- `storage.objects` gehört `supabase_storage_admin`, die SQL-Verbindung läuft als `postgres`, ohne Mitgliedschaft in der Eigentümerrolle.
- In der Migrationstabelle sind vier bisherige Migrationen registriert; keine Beleg-Migration.

## Vorgeschlagener Umfang
- Beleg-Metadaten in eigener Tabelle mit UUID, Speicherpfad, Dateiname, MIME-Typ, Dateigröße, Zeitstempel und optionaler Zuordnung zu `posten`, `posten_zahlungen` oder `bankumsaetze`.
- Nur freigegebene Haushaltsmitglieder dürfen Metadaten und private Dateien lesen und hochladen.
- Keine öffentlichen Beleg-URLs, keine Service-Role-Schlüssel im Browser.
- Unveränderliche Speicherpfade und getrennte Löschentscheidung; Belege nicht ungeprüft kaskadierend löschen.
- Dateigrößen- und MIME-Beschränkungen; Dateityp serverseitig prüfen.

## Geplanter Migrationsschnitt
1. **Metadaten**: Tabelle, Fremdschlüssel, Indizes, RLS; bestehende Daten unverändert.
2. **Bucket**: `belege` privat mit Upload-Beschränkungen; über unterstützten Supabase-Storage-Verwaltungsweg.
3. **Storage-Policies**: Zugriff auf `storage.objects` über berechtigten Administrationsweg, getrennt von gewöhnlicher `postgres`-Migration. Niemals Eigentümerwechsel oder Rechteeskalation als Workaround.

## Offene Freigabeprüfungen
- Tatsächlichen Policy-Administrationsweg nachweisen, bevor `CREATE POLICY` ausgeführt wird.
- Datenmodell der Belegzuordnung fachlich prüfen (mehrere Belege pro Buchung? Zuordnung zu Zahlungen und Umsätzen?).
- Bestehende Tabellen-Constraints und Berechtigungen prüfen.
- Test mit zwei erlaubten Konten und einem nicht berechtigten Konto; Upload, Download, Auflistung, Update, Delete und fremde Pfade abdecken.
- Lokale/Staging-Migration und Rollback-Verfahren prüfen.
- Erst danach produktiven Rollout separat freigeben.

**Wichtig:** Diese Datei ist kein SQL-Migrationsskript und verändert keine produktiven Daten.
