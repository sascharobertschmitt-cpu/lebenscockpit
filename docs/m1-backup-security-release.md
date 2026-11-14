# Meilenstein 1: Sicherung, Wiederherstellung und Freigabe

Stand: 14.11.2026. **M1 ist nicht freigegeben.** Dieses Dokument ist ein Prüf- und Ablaufplan, kein Nachweis einer vorhandenen Sicherung.

## Schutzziele

- Keine produktiven Finanzdaten während der Entwicklung überschreiben, löschen oder exportieren.
- Vor einer produktiven Schemaänderung muss eine **extern aufbewahrte, wiederherstellbare** Datenbanksicherung vorliegen.
- Wiederherstellung ausschließlich in einer isolierten Testumgebung mit Zugriffskontrolle und ohne produktive Anmeldedaten.
- Vertrauliche Finanzdaten nicht in GitHub, GitHub-Actions-Logs, Pull-Requests oder öffentliche Artefakte kopieren.

## Backup-Umfang

1. PostgreSQL-Schema: Tabellen, Constraints, Indizes, Funktionen, RLS-Richtlinien, Trigger, Extensions und Berechtigungen.
2. Operative Daten: `einnahmen`, `posten`, `posten_zahlungen`, `kontostaende`, `aufgaben`, `mitglieder`.
3. Authentifizierungs-Konfiguration und – soweit vom gewählten Sicherungsverfahren abgedeckt – Auth-Benutzer. Auth-Secrets niemals in das Repository schreiben.
4. Supabase-Projekteinstellungen, verwendete Environment-Konfiguration und Deployment-Konfiguration separat dokumentieren.
5. Versionsstand des Anwendungscodes und der Migrationen (Git-Commit).

Der aktuelle JSON-Export der Web-App deckt **nur fünf operative Tabellen** ab. Er ist kein vollständiges Systembackup und enthält keine Wiederherstellungsfunktion.

## Verbindlicher Wiederherstellungstest

- [ ] Backup-Verfahren und Berechtigung zur Sicherung bestätigt
- [ ] Sicherungsdatei außerhalb von GitHub sicher aufbewahrt
- [ ] Prüfsumme und Erstellungszeit dokumentiert
- [ ] Testumgebung isoliert, ohne Verbindung zur produktiven Anwendung
- [ ] Schema und Datensätze erfolgreich eingespielt
- [ ] Tabellenanzahlen und referenzielle Integrität mit Ausgangszustand verglichen
- [ ] Anmeldung, RLS und notwendige Funktionen gesondert geprüft
- [ ] Wiederherstellungsdauer und Fehler dokumentiert
- [ ] Verantwortliche Person bestätigt, dass die Sicherung im Notfall zugänglich ist

## Migration zum Schutz der Zahlungshistorie

Datei: `supabase/migrations/20261114110000_protect_payment_history.sql`.

Die Migration ersetzt `ON DELETE CASCADE` durch `ON DELETE RESTRICT` an `posten_zahlungen.posten_id`. Der isolierte PostgreSQL-Integrationstest prüft, dass historische Zahlungen beim Löschen eines Postens erhalten bleiben und das Löschen ohne Historie funktioniert.

**Nicht produktiv ausführen**, bevor der Wiederherstellungstest und das Claude-Review bestanden sind. Für produktive Ausführung ein Wartungsfenster, erneute Datenintegritätsprüfung und einen Rückfallplan festlegen.

## Sicherheitsbefunde (lesende Prüfung vom 14.11.2026)

- RLS auf sechs öffentlichen Anwendungstabellen aktiviert.
- Fünf operative Tabellen mit `private.ist_mitglied()` als RLS-Bedingung. Autorisierungsfunktion und API-Zugriff müssen gesondert getestet werden; eine Richtlinieninspektion allein beweist keine Zugriffssicherheit.
- `mitglieder`: RLS aktiviert, keine eigene Policy. Das ist nicht automatisch eine Schwachstelle; Auswirkungen auf legitime Nutzer und Verwaltungsprozesse prüfen.
- Supabase Advisor: Schutz gegen geleakte Passwörter deaktiviert. Siehe https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Eine mögliche Umstellung auf Auth-UID-basierte Mitgliedschaft erfordert eigene Migrations- und Zugriffstests.

## Abnahme-Gates für M1

1. Alle CI-Tests grün.
2. Vollständiges Backup und erfolgreicher Wiederherstellungstest nachgewiesen.
3. RLS mit autorisierten, unautorisierten und anonymen Testidentitäten überprüft.
4. Sicherheitsbefunde priorisiert und kritische behoben.
5. Unabhängiges Claude-Review auf den GitHub-Diff, inklusive Datenverlust- und Sicherheitsprüfung.
6. Review-Befunde behoben und erneut getestet; erst danach Merge/Freigabe.
