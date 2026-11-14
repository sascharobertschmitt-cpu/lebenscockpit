# Migrations- und Rolloutplan: Aufgaben-RPC und Kontoabgleich-RPC

Stand: 14.11.2026. Gegen das Produktivprojekt `txxlniprkltweeenmexf` (Lebenscockpit) **nur lesend** geprüft. Es wurde nichts an der produktiven Datenbank geändert.

## 1. Was die Migrationen tun

| Datei | Wirkung |
| --- | --- |
| `supabase/migrations/20261114200000_task_completion_atomic.sql` | Neue Spalten `aufgaben.vorgaenger_id` (uuid, FK auf `aufgaben.id`, ON DELETE SET NULL) und `aufgaben.auto_faellig` (date). Partieller Unique-Index `aufgaben_one_successor`. Funktion `set_task_completion(uuid, boolean)`. |
| `supabase/migrations/20261114200100_account_reconciliation_idempotent.sql` | Neue Spalte `kontostaende.request_id` (uuid). Partieller Unique-Index `kontostaende_request_id_key`. Funktion `save_account_reconciliation(..., p_request_id uuid)`. |

| `supabase/migrations/20261114200200_revoke_truncate_from_api_roles.sql` | Entzieht `anon`/`authenticated` TRUNCATE, REFERENCES, TRIGGER (ab PG 17 auch MAINTAIN), `anon` alle Tabellenrechte, Default-Privileges für neue Tabellen. Zusätzlich `UPDATE`/`DELETE` auf `bankumsaetze` für `authenticated` (siehe Abschnitt 6). |
| `supabase/migrations/20261114200300_protect_payment_history.sql` | `posten_zahlungen → posten` von `ON DELETE CASCADE` auf `RESTRICT`. |
| `supabase/migrations/20261114163857_add_bankumsaetze_csv_import.sql` | **Nicht anwenden.** Wortgleiche Kopie der bereits in Produktion laufenden Migration, nur damit Repo und Historie übereinstimmen. |

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
| 3 | **Migration 1** anwenden, dann **Migration 2**, jeweils einzeln. Im SQL-Editor (nicht `db push`, siehe 6.3). Danach `supabase migration repair --status applied 20261114200000 20261114200100`, damit die Historie stimmt. Nicht über das MCP-Werkzeug `apply_migration`, das stempelt die aktuelle Uhrzeit als Version. | du | Fehlermeldung. Jede Datei als Ganzes ausführen. Nach einem Fehler den Preflight wiederholen, die Migrationen sind idempotent. |
| 4 | **Postflight** (`postflight_readonly.sql`) ausführen, Security-Advisor erneut prüfen. | du | irgendeine Zeile `false`. Dann Rollback (siehe unten). |
| 4a | **Sicherheitsmigrationen** (unabhängig von 1–4, aber vor dem Merge des CSV-Imports, PR #4): Backup erneuern, dann `…200300_protect_payment_history` und `…200200_revoke_truncate_from_api_roles` einzeln anwenden, danach `supabase/checks/postflight_security_readonly.sql` (alle Zeilen `true`) und Security-Advisor. Danach `supabase migration repair --status applied 20261114200200 20261114200300`. | du | irgendeine Zeile `false`. Dann Rollback `supabase/rollback/…200200…_down.sql` bzw. `…200300…_down.sql`. |
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

## 6. Sicherheitsmigrationen (bankumsaetze, RESTRICT) und Migrationshistorie

Stand der Prüfung: 14.11.2026, lesend gegen Produktion, getestet auf isolierter PostgreSQL-16-Instanz (`test/db/cases_security.sh`).

### 6.1 Rechte auf `bankumsaetze` und TRUNCATE (`…200200`)
- **Ist-Zustand Produktion (`relacl`):** `bankumsaetze` hat für `anon` und `authenticated` *alle* Rechte (TRUNCATE, TRIGGER, REFERENCES, MAINTAIN, UPDATE, DELETE). Die Anlage-Migration wollte nur `select, insert` für `authenticated`. Die Default-Privileges haben den Rest vergeben. Die älteren Tabellen haben bei `anon`/`authenticated` bereits kein TRUNCATE, aber noch `MAINTAIN` (PG 17) und bei `anon` DML-Rechte, die nur die RLS blockt.
- **Korrektur meiner früheren Einschätzung:** Ich hatte geschrieben, wer den anon-Key kennt, könne die Tabelle leeren. Das ist zu stark. PostgREST bietet kein TRUNCATE an, und es gibt keine RPC mit dynamischem SQL. Ausnutzbar wäre das erst mit einer SQL-Ausführung als diese Rollen. Es ist **Härtung gegen künftige Fehler, keine akute Ausnutzbarkeit**. Trotzdem sollte es vor dem CSV-Import geschlossen sein.
- **Fix:** Die vorbereitete Migration von `chore/phase0-tests` (neu versioniert) plus ein Zusatz: `REVOKE UPDATE, DELETE ON bankumsaetze FROM authenticated`. Das entspricht der Absicht der Anlage-Migration (Anfüge-Journal) und die App aktualisiert oder löscht dort nichts (nur `upsert … ignoreDuplicates` und `select`). **Das ist eine Entscheidung für dich:** Soll später „Import rückgängig“ möglich sein, wird `…_down.sql` benötigt oder die Zeile entfällt.
- **Getestet (alle grün):** TRUNCATE als `anon` und `authenticated` auf allen 7 Tabellen scheitert mit `permission denied`. `anon` hat keine Tabellenrechte. `authenticated` behält SELECT/INSERT und auf den App-Tabellen UPDATE/DELETE. CSV-Upsert (`ON CONFLICT DO NOTHING`) läuft idempotent. Nicht-Mitglied wird von RLS blockiert. `service_role` und eine `pg_read_all_data`-Rolle wie `backup_reader` sind unberührt. Neue Tabellen erben die Rechte nicht. Zweiter Lauf, Rollback und Neuanwendung funktionieren. Gegenproben: ohne die jeweiligen `REVOKE` werden die Tests rot.
- **Nicht getestet:** der `MAINTAIN`-Zweig (PG 17), weil lokal nur PG 16 verfügbar ist. Er ist in der Migration hinter eine Versionsabfrage gelegt. Falls er in Produktion fehlschlägt, bricht die ganze Transaktion ab und ändert nichts.
- **Nebenwirkung:** Ohne gültige Session fragt die App als `anon` an und bekommt künftig `permission denied` statt leerer Ergebnisse. Das ist nur sichtbar, wenn der JWT-Abgleich in `fail()` nicht greift, und führt dann zu einer Fehlermeldung statt zum Login.
- **Rest:** Default-Privileges von `supabase_admin` auf `public` werden nicht verändert. `postgres` darf das voraussichtlich nicht. Tabellen, die Supabase-intern von `supabase_admin` angelegt werden, erhielten die Rechte weiter. Eigene Tabellen laufen als `postgres`.

### 6.2 RESTRICT-Fix (`…200300`)
- **Inhaltlich richtig:** Der Fremdschlüssel behält Namen und Spalten, nur die Löschregel ändert sich. Produktion: 32 Posten, 14 Zahlungen, 0 verwaiste Zahlungen, die Validierung beim Anlegen des Schlüssels ist trivial (kurze Sperre auf zwei winzigen Tabellen).
- **Geändert:** `DROP CONSTRAINT IF EXISTS`, damit die Migration auch nach einem Teilabbruch wieder läuft.
- **Auswirkung auf die App:** Löschen ist nur für einmalige Posten möglich (`posten-delete`). Hat ein solcher Posten bestätigte Zahlungen, scheitert das jetzt mit FK-Verletzung (23503). Die App zeigt dafür eine verständliche Meldung statt der rohen Datenbankmeldung. Dauerhafte Posten werden beendet, nicht gelöscht, und bleiben unberührt. Das Abwählen einer Zahlung im Kontoabgleich löscht die Zahlung direkt und ist unberührt.
- **Getestet:** Bestandszahlung bleibt unverändert, Löschen mit Zahlung scheitert, Posten und Zahlung bleiben, Löschen ohne Zahlung und direktes Löschen einer Zahlung funktionieren, idempotent, Rollback (zurück auf CASCADE) und Neuanwendung. Danach laufen alle RPC-Fälle unter den gehärteten Rechten grün.

### 6.3 Konflikte in der Migrationshistorie
| Befund | Folge | Behandlung |
| --- | --- | --- |
| Produktion kennt 4 Versionen, letzte `20261114163857`. Die Fixes auf `chore/phase0-tests` trugen `…110000` und `…120000`, also **vor** der letzten angewendeten Version. | `supabase db push` verweigert Dateien vor der Remote-Spitze. | Auf `…200200` und `…200300` neu versioniert. Ein Test (`sql-contract`) erzwingt künftig: eindeutige Versionen, alle hinter `20261114163857`, Rollback-Skript vorhanden, keine Daten- oder destruktive DDL-Änderung. |
| Zwei Branches belegen `20261114120000`: `chore/phase0-tests` (revoke) und `feature/table-security-guard` (PR #2, `table_security_audit`). | Zweite Datei kollidiert in der Historie. | Der Revoke ist jetzt auf `…200200`. PR #2 muss vor dem Merge auf eine freie Version umbenannt werden, z. B. `…200400`. |
| `public.table_security_audit()` existiert in Produktion (Text identisch mit PR #2), steht aber **nicht** in der Historie. | Repo und Datenbank gehen auseinander. | Beim Merge von PR #2 die Version mit `supabase migration repair --status applied` eintragen oder die idempotente Datei einmal anwenden. |
| Die Audit-Funktion kennt `bankumsaetze` nicht und meldet sie dauerhaft als „Neue, noch nicht geprüfte Tabelle“. Sie prüft MAINTAIN nicht. | Dauerwarnung in der App (PR #2). | In PR #2 `bankumsaetze` in die Liste aufnehmen. Nicht Teil dieses Branches. |
| `add_bankumsaetze_csv_import` (`20261114163857`) ist in Produktion angewendet, in **keinem** Branch als Datei vorhanden. | `db push` meldet Remote-Version ohne lokale Datei. | Wortgleiche Kopie mit Hinweis „nicht anwenden“ hinzugefügt. Der Test kennt diese Version als bereits angewendet. |
| Die ersten drei Produktionsmigrationen (`20261113163928`, `…165216`, `…192402`) fehlen im Repo. Die Grundmigration wurde nicht kopiert, weil sie Bestandsdaten enthalten kann. | `db push` meldet auch diese als Remote-only. | Bis das geklärt ist, **nicht `supabase db push` verwenden**, sondern die Dateien einzeln im SQL-Editor ausführen und danach `supabase migration repair --status applied <Versionen>`. Erwartetes CLI-Verhalten, nicht ausprobiert, weil das eine Änderung an Produktion wäre. |
| Die Branches `chore/phase0-tests` und `claude/upbeat-pasteur-4yl21g` enthalten die alten Dateinamen und `test/db/truncate_privileges.sql` verweist darauf. | Nach dem Merge beider Seiten stünde derselbe Revoke doppelt unter zwei Versionen. | Beim Merge auf `…200200`/`…200300` umstellen oder die alten Dateien dort löschen. |

## 7. Weitere Befunde (nicht geändert)
- Advisor: „Leaked password protection“ deaktiviert (Auth-Einstellung im Dashboard).
- `mitglieder` hat RLS ohne Policy. Das ist gewollt: Zugriff läuft nur über `private.ist_mitglied()`.
