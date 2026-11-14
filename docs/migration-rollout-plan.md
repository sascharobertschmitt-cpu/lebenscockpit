# Migrations- und Rolloutplan: Aufgaben-RPC und Kontoabgleich-RPC

Stand: 14.11.2026. Gegen das Produktivprojekt `txxlniprkltweeenmexf` (Lebenscockpit) **nur lesend** geprüft. Es wurde nichts an der produktiven Datenbank geändert.

## 1. Was die Migrationen tun

| Datei | Wirkung |
| --- | --- |
| `supabase/migrations/20261114200000_task_completion_atomic.sql` | Neue Spalten `aufgaben.vorgaenger_id` (uuid, FK auf `aufgaben.id`, ON DELETE SET NULL) und `aufgaben.auto_faellig` (date). Partieller Unique-Index `aufgaben_one_successor`. Funktion `set_task_completion(uuid, boolean)`. |
| `supabase/migrations/20261114200100_account_reconciliation_idempotent.sql` | Neue Spalte `kontostaende.request_id` (uuid). Partieller Unique-Index `kontostaende_request_id_key`. Funktion `save_account_reconciliation(..., p_request_id uuid)`. |

### Die neuen Spalten
- **`aufgaben.auto_faellig`** (nullbar): Fälligkeit, die das System für einen Nachfolger berechnet hat. Weicht `faellig` später davon ab, hat jemand den Termin manuell geändert, und „Erledigt rückgängig“ wird abgelehnt statt den Nachfolger zu löschen. Bestehende Aufgaben bleiben `NULL`. Das ist unkritisch, weil nur Nachfolger prüfen und nur solche mit `vorgaenger_id`.
- **`aufgaben.vorgaenger_id`** (nullbar): exakte Verknüpfung Nachfolger → Vorgänger statt Zuordnung über den Titel. Höchstens ein Nachfolger je Vorgänger (Unique-Index).
- **`kontostaende.request_id`** (nullbar): vom Client je Abgleich einmal erzeugte UUID. Gleiche ID heißt genau ein Kontostand. Wiederholung oder paralleler Doppelklick wird zum No-op. Alte Zeilen bleiben `NULL` und kollidieren nie (partieller Index nur für `NOT NULL`).

## 2. Prüfergebnis gegen Produktion (lesend)

| Bereich | Ergebnis |
| --- | --- |
| Spalten | `aufgaben`, `kontostaende`, `posten`, `posten_zahlungen` in Typ, Nullbarkeit und Default identisch mit dem Testschema. Die drei neuen Spalten existieren in Produktion noch nicht. |
| Constraints | `aufgaben_wiederholung_check` (4 Werte), `kontostaende_konto_check`, `UNIQUE (posten_id, finanzmonat)` vorhanden. Letzteres braucht `ON CONFLICT` im Kontoabgleich. |
| Konflikte mit Daten | Keine: 1 Aufgabe (nicht wiederkehrend, offen), 2 Kontostände (`erfasst_von` überall gesetzt), 14 Zahlungen mit Betrag = Postenbetrag, 2 Mitglieder. Beide neuen Unique-Indizes sind partiell und starten ohne Werte. |
| RLS | Auf allen 7 Tabellen aktiv. Je eine Policy „nur mitglieder“ `TO authenticated` über `private.ist_mitglied()`. `mitglieder` hat bewusst keine Policy. |
| Funktionsrechte | Neue Funktionen in `public` erhalten per Default-Privileges `EXECUTE` für `anon`, `authenticated`, `service_role`. Die Migrationen nehmen ihn per `REVOKE ... FROM PUBLIC, anon` zurück, sonst wären sie anonym aufrufbar. Beide Funktionen sind `SECURITY INVOKER`, daher gelten die RLS-Policies der Aufrufer weiter. |
| Funktionsumgebung | `search_path = ''`. Alle Referenzen sind schema-qualifiziert (`auth.uid()`, `public.*`). Es gibt keine Vorgängerfunktion. Das `DROP` der 5-Argument-Variante ist dort ein No-op. |
| Migrationshistorie | 4 Einträge, letzter `20261114163857`. Die neuen Versionen `20261114200000` und `…200100` liegen dahinter. |
| Read-only-Preflight | `supabase/checks/preflight_readonly.sql` auf Produktion: 15 von 15 Prüfungen grün. |

## 3. Auf dem Entwicklungsbranch behobene Probleme

1. **Migrationen waren nur „Entwürfe“ in `sql/`** auf zwei anderen Branches, mit „Draft only“-Kopf und ohne Version. Jetzt versionierte Dateien in `supabase/migrations/`, Tests und Workflow zeigen darauf.
2. **Testschema war nicht produktionsgetreu.** `private.ist_mitglied()` war case-sensitiv, Produktion vergleicht mit `lower()`. `bankumsaetze` fehlte. Nachgezogen.
3. **Der anon-Test war wertlos.** Das Testschema vergab keine Default-`EXECUTE`-Rechte auf Funktionen, wie sie Supabase vergibt. Ein fehlendes `REVOKE` wäre unentdeckt geblieben. Behoben und per Mutationsprobe bestätigt: ohne `REVOKE` wird der Postflight rot.
4. **Kein Pre-/Postflight, kein Rollback.** Neu: `supabase/checks/preflight_readonly.sql`, `postflight_readonly.sql` (nur `SELECT`) und `supabase/rollback/*_down.sql`. Alle drei laufen in `test/db/run.sh` mit. Das prüft auch Idempotenz, rückstandsfreies Entfernen und erneutes Anwenden.
5. Kleinigkeit: `test/sql-contract.test.js` meldete Erfolg, bevor die letzten Assertions liefen.

Ergebnis lokal (PostgreSQL 16): 81 Datenbanktests, Pre-/Postflight, Idempotenz, Rollback und Neuanwendung grün. Dazu `logic`, `smoke`, `calendar-draft` und `sql-contract` grün.

## 4. Rolloutplan

**Reihenfolge ist zwingend: Datenbank zuerst, Frontend danach.** Das Frontend auf diesem Branch ruft beide RPCs auf. Fehlen sie, scheitern Erledigen und Kontoabgleich. Die Migrationen sind rein additiv, der heutige Client auf `main` läuft mit dem neuen Schema unverändert weiter.

| # | Schritt | Wer | Abbruchkriterium |
| --- | --- | --- | --- |
| 0 | GitHub-Actions für diesen Branch grün (`db-integration`, Node-Tests). Review der beiden SQL-Dateien. | du | rot |
| 1 | **Backup**: Workflow `encrypted-drive-backup` manuell starten und Artefakt prüfen. Zusätzlich die App-Funktion „Backup“ (JSON) nutzen. | du | Backup fehlt oder leer |
| 2 | **Preflight** (`preflight_readonly.sql`) im SQL-Editor des Projekts ausführen. | du | irgendeine Zeile `false` |
| 3 | **Migration 1** anwenden, dann **Migration 2**, jeweils einzeln. Per `supabase db push` (hält die Versionsnummern) oder SQL-Editor. Beim SQL-Editor danach `supabase migration repair --status applied 20261114200000 20261114200100`, damit die Historie stimmt. Nicht über das MCP-Werkzeug `apply_migration`, das stempelt die aktuelle Uhrzeit als Version. | du | Fehlermeldung. Jede Datei als Ganzes ausführen. `supabase db push` führt sie je als Transaktion aus, bei Fehler ändert sich nichts. Im SQL-Editor nach einem Fehler den Preflight wiederholen, die Migrationen sind idempotent. |
| 4 | **Postflight** (`postflight_readonly.sql`) ausführen, Security-Advisor erneut prüfen. | du | irgendeine Zeile `false`. Dann Rollback (siehe unten). |
| 5 | **Test mit echtem Login** mit dem Branch-Frontend, nicht auf `main`: eine wiederkehrende Testaufgabe anlegen, erledigen, Nachfolger prüfen, rückgängig machen, wieder erledigen, Testdaten löschen. Danach Kontoabgleich mit Netzwerk-Abbruch und Wiederholung. Es muss genau ein Kontostand entstehen. Als Luna und als Sascha. | du, ich begleite | jede Abweichung |
| 6 | Frontend deployen (Merge nach `main`). Auf iPhone/PWA Cache-Refresh prüfen (siehe Risiko 3). | du | – |
| 7 | 48 Stunden beobachten. Es dürfen keine doppelten Folgeaufgaben oder doppelten Kontostände auftreten. | du | – |

### Rollback
- **Nur Frontend defekt:** `main` auf den vorherigen Stand zurücksetzen. Das Schema bleibt, der alte Client läuft damit.
- **Datenbank zurück:** erst Frontend zurücksetzen, dann `supabase/rollback/20261114200100_…_down.sql`, danach `…200000_…_down.sql`. Verloren gehen nur `request_id`-Werte sowie `vorgaenger_id` und `auto_faellig`. Die Folgeaufgaben bleiben als normale Aufgaben bestehen. Die Rollback-Skripte liegen bewusst nicht in `supabase/migrations`.
- Bei einem Rollback die Einträge in der Migrationshistorie mit `supabase migration repair --status reverted` korrigieren.

## 5. Verbleibende Risiken

1. **Nicht auf PostgreSQL 17 getestet.** Produktion läuft auf 17.11, die Tests auf 16. Kein 17-spezifisches Verhalten im SQL erkennbar, bleibt aber Annahme. Schritt 5 deckt das mit echtem Login ab.
2. **Auth nur simuliert.** Die Tests setzen JWT-Claims selbst. Echte Supabase-Auth/PostgREST-Pfade (z. B. Parameterübergabe `p_request_id` als JSON) prüft nur Schritt 5.
3. **Zwischenstand durch PWA-Cache.** Ein iPhone mit altem, gecachtem Client erzeugt Nachfolger noch clientseitig ohne `vorgaenger_id`. Wird dieselbe Aufgabe danach mit dem neuen Client rückgängig gemacht und erneut erledigt, entsteht ein zweiter Nachfolger. Der Fix für den Cache liegt in PR #8 (offen). Idealerweise vor Schritt 6 mergen.
4. **`request_id` ist optional.** Alte oder fremde Aufrufer ohne ID bleiben nicht idempotent (bewusst, Abwärtskompatibilität).
5. **E-Mail-Vergleich im Kontoabgleich ist case-sensitiv**, `ist_mitglied()` ist es nicht. Supabase speichert E-Mails kleingeschrieben und der Client sendet `S.user.email`, daher aktuell folgenlos.
6. **Zeitzone fest `Europe/Berlin`** im Wiederholungs-Datum. Für zwei Nutzer im selben Haushalt passend, bei Umzug anzupassen.
7. **Kein vollständiger Schema-Dump als Beweis.** Der Abgleich beruht auf Katalogabfragen (Spalten, Constraints, Indizes, Policies, Funktionen, Default-Privileges), nicht auf einem `pg_dump`-Diff. Geprüft wurden außerdem die Trigger (in Produktion keine). Views und Sequenzen wurden nicht gesondert geprüft.

## 6. Unabhängig davon in Produktion gefunden (nicht Teil dieser Migrationen, nicht geändert)

- **`bankumsaetze`: `anon` und `authenticated` haben `TRUNCATE`, `TRIGGER`, `REFERENCES`.** TRUNCATE umgeht Row Level Security. Wer den öffentlichen anon-Key kennt (steckt im Frontend), könnte die Tabelle leeren. Die Tabelle ist aktuell leer, wird aber mit dem CSV-Import befüllt. Der Fix liegt als `20261114120000_revoke_truncate_from_api_roles.sql` auf `chore/phase0-tests`, ist **noch nicht angewendet**. Das sollte vor dem CSV-Import passieren, unabhängig von diesem Rollout.
- `posten_zahlungen → posten` steht noch auf `ON DELETE CASCADE`. Das Löschen eines Postens löscht seine Zahlungsbestätigungen. Der RESTRICT-Fix ist als `20261114110000_protect_payment_history.sql` vorbereitet, nicht angewendet.
- **Migrationshistorie ≠ Datenbank:** `public.table_security_audit()` existiert in Produktion, steht aber nicht in der Historie. Zwei Branches belegen dieselbe Version `20261114120000` (`revoke_truncate…` und `table_security_audit`). Beim Zusammenführen die Versionen vereinheitlichen.
- Advisor: „Leaked password protection“ deaktiviert (Auth-Einstellung im Dashboard).
