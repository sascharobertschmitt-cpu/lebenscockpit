# Isolierte Datenbanktests – Freigabeprotokoll

**Nicht auf dem produktiven Projekt `txxlniprkltweeenmexf` ausführen.** Es gibt derzeit kein bestätigtes separates Lebenscockpit-Testprojekt. Die bestehenden GitHub-Tests sind Node-/statische Tests, keine Postgres-Integrationstests.

## Testumgebung (Voraussetzung)
1. Lokale Supabase-Instanz oder gesondertes Supabase-Testprojekt verwenden. **Keine Produktionsdaten und keine produktiven Zugangsdaten kopieren.**
2. Schema inklusive Constraints, Triggern, `private.ist_mitglied()` und RLS-Policies aus versionierten, geprüften Baseline-Migrationen aufbauen. Bestehende SQL-Entwürfe allein reichen nicht für eine vollständige Testdatenbank.
3. Drei Test-Identitäten anlegen: zwei Haushaltsmitglieder, eine nicht berechtigte Person. Test-JWTs verwenden, niemals Service-Role als Ersatz für authentifizierte Nutzer.
4. Erst in der isolierten Datenbank `sql/task_completion_atomic.sql` und `sql/account_reconciliation_atomic.sql` anwenden.
5. Alle Tests mit unabhängigen Fixtures durchführen und nach jedem Fall Tabellenzustand prüfen; keine produktiven Datensätze verwenden.

## Aufgaben-RPC: verpflichtende Fälle
| Fall | Erwartung |
| --- | --- |
| Einmalige Aufgabe erledigen | `erledigt` und `erledigt_am` gesetzt; keine Folgeaufgabe |
| Wiederkehrende Aufgabe erledigen | Exakt ein Nachfolger, `vorgaenger_id` korrekt |
| Zweimal gleichzeitig erledigen | Maximal ein Nachfolger; keine Doppelung |
| Erledigung rückgängig machen | Nur unveränderter, offener eigener Nachfolger gelöscht |
| Nachfolger wurde bearbeitet | Undo wird abgelehnt, Nachfolger bleibt erhalten |
| Nachfolger wurde erledigt | Undo wird abgelehnt, Kette bleibt erhalten |
| Fällig 31. Januar, monatlich | Korrekte Begrenzung auf letzten Februartag |
| 29. Februar, jährlich | Korrekte Behandlung Nicht-Schaltjahr |
| Fälligkeit in Vergangenheit | Folgetermin relativ zur bestehenden `nextRecurrence`-Logik |
| Fremder Nutzer/anon | Keine Änderungen; RLS bzw. Funktionsrechte greifen |
| Nicht vorhandene Aufgaben-ID | Keine Änderungen; kontrollierter Fehler |

## Finanz-RPC: verpflichtende Fälle
| Fall | Erwartung |
| --- | --- |
| Kontostand ohne Zahlungen | Genau ein neuer Kontostand |
| Kontostand mit zwei gültigen Zahlungen | Beide Zahlungen und Kontostand zusammen gespeichert |
| Eine ungültige Zahlung in Liste | Weder Kontostand noch andere Zahlung gespeichert |
| Unbekannte Posten-ID | Vollständiger Rollback |
| Abweichender Postenbetrag | Vollständiger Rollback |
| Barzahlung in Kontoabgleich | Vollständiger Rollback |
| `luna` mit Zahlungen | Abgelehnt, keine Teilbuchung |
| E-Mail passt nicht zum JWT | Abgelehnt |
| `anon` / Fremder | Kein Zugriff |
| Zwei parallele Abgleiche | Definiertes Verhalten; keine unbeabsichtigten Duplikate |
| Ungültige JSON-Struktur / fehlende Werte | Abgelehnt, keine Teilbuchung |

## Vor dem Ausführen beheben bzw. festlegen
- Die bestehenden SQL-Dateien sind **Entwürfe**. Tabellen- und Constraint-Definitionen mit vollständigem Testschema abgleichen.
- Bei Aufgaben-Undo auch **manuell geänderte Fälligkeit** des Nachfolgers erkennen. Die aktuelle Schutzprüfung deckt Titel, Zuständigkeit, Wiederholung und Nachkommen ab, aber noch nicht sicher jede Datumsänderung.
- Die wiederkehrende Aufgabenlogik in SQL gegen `logic.js:nextRecurrence` vergleichen, einschließlich Monatsende und Schaltjahren.
- Für Finanzabgleich prüfen, ob die Wiederholung desselben Requests idempotent sein soll; derzeit kann ein erneuter Aufruf einen weiteren Kontostand anlegen.
- RLS und Rechte der RPCs mit realen JWTs überprüfen, nicht nur durch Textsuche im SQL.
- Nach jedem Fehlertest kontrollieren, dass sich **keine** betroffene Tabelle verändert hat.

## Freigabekriterien
- Alle Fälle auf isoliertem PostgreSQL bestanden und dokumentiert.
- Migrationen reproduzierbar aus frischem Schema ausführbar.
- GitHub Actions grün.
- Review der Auth-/RLS-/Transaktionslogik.
- Erst danach Entscheidung über produktive Migration und Merge nach `main`.

## Ausfuehrungsstand (isolierte PostgreSQL-16-Instanz)
Automatisiert in `test/db/run.sh` (Schema: `test/db/schema_baseline.sql` + `supabase_stub.sql`, nur synthetische Daten) und per GitHub Actions `db-integration.yml` (Wegwerf-Container, keine Secrets). Alle Faelle der Tabellen oben sind abgedeckt, inkl. paralleler Ausfuehrung und Rollback-Pruefung; RLS/Rechte laufen mit `SET ROLE authenticated/anon` und Test-JWT-Claims.

**Gefunden und behoben**
- Aufgaben-Undo erkannte eine manuell geaenderte Faelligkeit des Nachfolgers nicht (Nachfolger wurde geloescht). Neu: Spalte `auto_faellig`; Abweichung von `faellig` blockiert Undo.
- SQL nutzte `CURRENT_DATE` (UTC); die App rechnet mit lokalem Datum. Neu: Datum in `Europe/Berlin`.

**Offen / bewusst nicht geaendert**
- Finanzabgleich: Idempotenz ist ueber die optionale `p_request_id` umgesetzt (Spalte `kontostaende.request_id`, partieller Unique-Index). Die App erzeugt je Abgleich einmal beim Oeffnen des Fensters eine UUID (`S.abgleichId`), sendet sie als `p_request_id` und verwendet sie bei Wiederholung nach Fehlern erneut; erst nach Erfolg wird sie verworfen. Ohne ID bliebe das alte, nicht idempotente Verhalten (nur noch fuer Altaufrufer).
- Das Testschema ist ein Nachbau (inkl. nachgebildetem `private.ist_mitglied()`); vor Produktivfreigabe gegen die echten Migrationen abgleichen. `supabase/migrations` (RESTRICT-Fix fuer `posten_zahlungen`) liegt auf einem anderen Branch und ist hier nicht getestet.
- `auto_faellig` und `request_id` sind neue Spalten: Migration vor Produktivnutzung reviewen.
- Echte Supabase-Auth/JWT-Verifikation ist nicht Teil des Tests (Claims werden simuliert).
