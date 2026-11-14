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

Der aktuelle JSON-Export der Web-App deckt **nur fünf operative Tabellen** ab (ohne `mitglieder`, ohne Schema, RLS, Funktionen, Rechte und Auth). Er ist kein vollständiges Systembackup und enthält keine Wiederherstellungsfunktion.

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
- Berechtigungsbefund (Review vom 14.11.2026, Katalogabfrage ohne Datenzugriff): `anon` und `authenticated` besitzen auf allen sechs Tabellen `arwdDxtm`, also neben `TRUNCATE` auch `REFERENCES`, `TRIGGER` und (PostgreSQL 17) `MAINTAIN`; keine Rechte an `PUBLIC`. Diese Rechte umgehen RLS. **Über die REST-API (PostgREST) sind sie nicht ausnutzbar**, es gibt keine Funktionen oder Trigger in `public`. Das Risiko ist Defense in Depth: relevant, sobald später eine RPC-Funktion mit dynamischem SQL oder ein anderer SQL-Zugang als `anon`/`authenticated` dazukommt. Zusätzlich vergeben die Default-Privileges von `postgres` und `supabase_admin` diese Rechte an jede neue `public`-Tabelle erneut.
  - Die Migration `20261114120000_revoke_truncate_from_api_roles.sql` entzieht die vier Rechte von `PUBLIC`, `anon` und `authenticated` auf allen `public`-Tabellen und setzt die Default-Privileges von `postgres` zurück. `SELECT/INSERT/UPDATE/DELETE` und RLS bleiben unverändert. Test: `test/db/truncate_privileges.sql` (Rollen-Ausführung, RLS, Idempotenz, neue Tabelle nach der Migration).
  - **Restrisiko:** Default-Privileges von `supabase_admin` lassen sich als `postgres` nicht ändern. Tabellen, die über diese Rolle entstehen (nicht über SQL-Editor/Migrationen), erhalten die Rechte wieder. Nach jeder neuen Tabelle die Rechte prüfen.
  - **Noch nicht produktiv angewendet.** Vorher Backup/Restore-Nachweis und Freigabe.
  - `anon` verliert zusätzlich alle Tabellenrechte (heute und per Default-Privileges), da es auf keiner Tabelle eine Policy gibt und die App erst nach der Anmeldung als `authenticated` auf Tabellen zugreift.
- Supabase Advisor: Schutz gegen geleakte Passwörter deaktiviert. Siehe https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
- Eine mögliche Umstellung auf Auth-UID-basierte Mitgliedschaft erfordert eigene Migrations- und Zugriffstests.
- Funktionsdefinition geprüft: `private.ist_mitglied()` ist `SECURITY DEFINER` mit leerem `search_path` und vergleicht die E-Mail aus `auth.jwt()` gegen `mitglieder.email`. Dies ist keine nachgewiesene Fremdzugriffslücke, bindet die Berechtigung aber an E-Mail-Claims statt an unveränderliche Auth-IDs. Rollen-/Ausführungsrechte, E-Mail-Verifizierung und Änderungen an Mitgliedschaften vor Freigabe gezielt testen.

## Abnahme-Gates für M1

1. Alle CI-Tests grün.
2. Vollständiges Backup und erfolgreicher Wiederherstellungstest nachgewiesen.
3. RLS mit autorisierten, unautorisierten und anonymen Testidentitäten überprüft.
4. Sicherheitsbefunde priorisiert und kritische behoben.
5. Unabhängiges Claude-Review auf den GitHub-Diff, inklusive Datenverlust- und Sicherheitsprüfung.
6. Review-Befunde behoben und erneut getestet; erst danach Merge/Freigabe.


## Isolierter technischer Restore-Test (CI)

Skript: `test/db/backup_restore.sh` (läuft im Job `database-integrity` und lokal, siehe Kopf des Skripts). Ausschließlich **synthetische** Daten, kein Zugriff auf Supabase, Dump wird nicht hochgeladen.

| Datei | Zweck |
|---|---|
| `test/db/supabase_stub.sql` | Nachbau von Rollen, `auth.jwt()` und Supabase-Default-Privileges (in Quelle **und** Ziel) |
| `test/db/restore_fixture.sql` | Schema wie Produktion (Spalten, Checks, Unique/FK, Indizes, RLS, Policies, `private.ist_mitglied()`), synthetische Grenzwertdaten |
| `test/db/fingerprint.sql` | Fingerabdruck: Zeilenzahl + MD5 je Tabelle, Spalten, Constraints, Indizes, RLS, Policies, Funktionen, Tabellen-/Funktions-/Default-Rechte. Gibt keine Datenwerte aus |
| `test/db/restore_checks.sql` | Funktionsprüfung: Mitglied liest/schreibt, Upsert `posten_id,finanzmonat`, Nicht-Mitglied sieht nichts, `anon` ohne Zugriff, kein `TRUNCATE`, FK `RESTRICT`, CHECK |

Ablauf: Quelle aufbauen → Funktionsprüfung Quelle → `pg_dump -Fc --schema=public --schema=private` **mit** Rechten → Prüfsumme und Inhaltsverzeichnis (Daten aller 6 Tabellen, 5 Policies, Funktion, ACL, Default-ACL) → Restore in ein wie ein frisches Supabase-Projekt vorbereitetes Ziel → Sicherheitsmigration erneut anwenden → Fingerabdruck Quelle = Ziel (236 Prüfpunkte) → Funktionsprüfung Ziel.

Schutz gegen falsch-positive Ergebnisse (Negativkontrollen, alle müssen anschlagen):
1. Ein um 0,01 veränderter Zahlungsbetrag wird erkannt, und zwar genau in `posten_zahlungen`.
2. Ein Restore mit `--no-acl` ohne erneute Migration wird von Fingerabdruck **und** Funktionsprüfung erkannt.
3. Ein reiner `--schema=public`-Dump (frühere CI-Variante) scheitert, weil `private.ist_mitglied()` fehlt.

Außerdem prüft das Skript, dass Client- und Server-Hauptversion übereinstimmen. Die SHA-256 des Dumps ändert sich bei jedem Lauf (Zeitstempel im Dump) und dient nur dem Integritätsnachweis der jeweiligen Datei.

### Befunde aus dem Test (für den echten Restore relevant)

- **Rechte gehen beim Restore verloren, auch mit Rechten im Dump.** Neue Tabellen erhalten im Ziel die Supabase-Default-Privileges (`anon`/`authenticated`: alles inkl. `TRUNCATE`). Die im Dump gespeicherten Rechte entfernen diese nicht. Im Test: 146 abweichende Rechtezeilen direkt nach dem Restore, u. a. `anon` mit `TRUNCATE`. Supabase dokumentiert das ebenfalls („tables inherit ALL privileges from default privileges in the target database“). **Pflicht nach jedem Restore:** Sicherheitsmigration `20261114120000_…` erneut anwenden und Rechte prüfen. Danach ist der Fingerabdruck identisch.
- **Die frühere CI-Variante `--schema=public --no-acl` war als Sicherung unvollständig:** ohne `private.ist_mitglied()` lassen sich die Policies nicht wiederherstellen, und ohne Rechte wäre die Härtung weg. Der alte Test war trotzdem grün, weil die Testtabellen weder RLS noch Funktionen hatten.
- `auth`-Schema, Rollen und Auth-Benutzer sind in keinem `public/private`-Dump enthalten. Da die Mitgliedschaft über die E-Mail läuft, funktioniert die App nach einem Restore nur, wenn die Benutzer mit denselben E-Mail-Adressen existieren.

### Grenzen des CI-Tests

Kein echtes Supabase (nur Nachbau von Rollen, `auth.jwt()` und Default-Privileges), keine echten Daten, kein Auth-Dienst, kein PostgREST. Der Funktionsrumpf von `private.ist_mitglied()` ist nachgebildet. Der CI-Test beweist das **Verfahren**, nicht die Wiederherstellbarkeit der Produktionsdaten.

## Plan: echte Produktionssicherung mit isoliertem Restore-Test

**Geprüfte Fakten (14.11.2026):** Organisation im **Free-Plan**, Projekt `Lebenscockpit`, PostgreSQL 17, Region eu-central-1. Laut Supabase-Doku gibt es automatische tägliche Backups nur ab Pro (Pro 7 Tage, Team 14, Enterprise 30); für Free empfiehlt Supabase regelmäßige `supabase db dump`-Exporte und externe Aufbewahrung. PITR ist ein kostenpflichtiges Add-on. Quelle: https://supabase.com/docs/guides/platform/backups und https://supabase.com/docs/reference/cli/supabase-db-dump

**Ungeprüft:** ob im Dashboard trotzdem Backups angezeigt werden, ob im Free-Plan ein weiteres Projekt als Restore-Ziel frei ist, Datenmenge von `auth.users`.

Durchführung **lokal auf deinem Rechner**, nie in GitHub Actions (Produktionsdaten und Verbindungsdaten dürfen nicht nach GitHub). Kosten: 0 €.

1. **Vorbereitung:** Supabase CLI und Docker installieren. Verbindungszeichenfolge (Session Pooler) aus dem Dashboard nur als Umgebungsvariable setzen, nicht in Dateien oder Shell-Historie speichern.
2. **Sicherung (nur lesend):**
   ```sh
   supabase db dump --db-url "$PROD_DB_URL" -f roles.sql --role-only
   supabase db dump --db-url "$PROD_DB_URL" -f schema.sql
   supabase db dump --db-url "$PROD_DB_URL" -f data.sql --use-copy --data-only
   ```
   `data.sql` enthält laut Doku auch `auth.users`. Zusätzlich die Auth-Konfiguration (Provider, Redirect-URLs, E-Mail-Vorlagen, SMTP), Projekteinstellungen und den Git-Commit schriftlich festhalten. Secrets (JWT-Secret, Service-Key, DB-Passwort) nicht in die Sicherung schreiben.
3. **Verschlüsseln und extern aufbewahren:** z. B. `age` oder `gpg --symmetric` (AES-256), Passwort im Passwortmanager. Zwei Orte: externes Medium und ein Cloud-Speicher außerhalb von GitHub. SHA-256 und Erstellungszeit notieren. Unverschlüsselte Dateien danach löschen.
4. **Isolierter Restore:** lokales Supabase (`supabase start`, PostgreSQL-Hauptversion auf 17 stellen) ohne Verbindung zur Produktion. Vor dem Schema: `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;`. Dann `roles.sql`, `schema.sql`, `data.sql` mit `psql --single-transaction -v ON_ERROR_STOP=1` einspielen. Danach beide Migrationen anwenden (falls noch nicht produktiv) bzw. die Sicherheitsmigration erneut.
5. **Vergleich:** `test/db/fingerprint.sql` gegen Produktion (nur Lesen, lokal ausgeführt) und gegen die Wiederherstellung laufen lassen, `diff`. Erwartete Abweichungen nur durch die neu angewendeten Migrationen. Die Ausgabe enthält nur Prüfsummen und Strukturen, trotzdem nicht in GitHub posten.
6. **Funktionsprüfung:** lokale App gegen das lokale Supabase, Anmeldung mit beiden Mitglieds-E-Mails, Daten sichtbar; Anmeldung mit fremder E-Mail sieht nichts; `anon` ohne Zugriff; Rechte mit `has_table_privilege` prüfen. Dauer und Fehler protokollieren.
7. **Rhythmus:** vor jeder produktiven Migration und mindestens monatlich. Optional später: Pro-Plan (tägliche Backups, kostenpflichtig, nur nach deiner Zustimmung).

## M1-Abnahmekriterien

1. CI grün, inklusive `test/db/backup_restore.sh` mit allen drei Negativkontrollen.
2. Echte Sicherung nach Plan erstellt: drei Dateien, verschlüsselt, an zwei Orten außerhalb von GitHub, SHA-256 und Zeitpunkt dokumentiert.
3. Isolierter Restore erfolgreich, Fingerabdruck-Vergleich ohne unerklärte Abweichung, Funktionsprüfung (Mitglied, Nicht-Mitglied, `anon`) bestanden, Dauer dokumentiert.
4. Rechte nach Restore geprüft: `anon` ohne Tabellenrechte, `authenticated` ohne `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN`.
5. Erst danach: Migrationen produktiv anwenden, im Wartungsfenster, mit frischer Sicherung direkt davor und anschließender Rechte- und Funktionsprüfung.
6. Restpunkte bewusst entschieden: Leaked-Password-Protection, E-Mail-basierte Mitgliedschaft, Default-Privileges von `supabase_admin`.

**Kein produktiver Restore ohne gesonderte Freigabe.** Ein Restore auf das Live-Projekt würde den aktuellen Datenstand überschreiben.
