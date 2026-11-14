# Wocheneinkauf: Limits, Einkäufe, Beleg-Fotos

Stand: 14.11.2026. Nur auf dem Entwicklungsbranch umgesetzt und getestet. **Nichts davon ist in Produktion.**

## Annahmen (bitte mit Luna gegenchecken)
1. **„Einkaufszettel“ = Foto vom Kassenbon.** Wer „Wocheneinkäufe abziehen“ sagt, meint Beträge, also Belege. Eine Einkaufsliste (was gekauft werden soll) wäre ein anderes Feature.
2. **Limits gelten für den Haushalt**, nicht je Person. Beide sehen und ändern dieselben Limits, wie bei allen anderen Daten.
3. **Mehrere benannte Limits** (z. B. Lebensmittel 80 €, Drogerie 20 €) statt eines einzigen. Ein Limit reicht auch.
4. **Woche = Montag bis Sonntag**, jede Woche beginnt bei 0, nicht verbrauchtes Geld wird nicht übertragen.
5. **Die Einkäufe laufen separat vom Restbudget bis zum Gehalt.** Sie werden dort nicht noch einmal abgezogen: Was mit Karte bezahlt wurde, steckt schon im Kontostand, und Bargeld ist in der Kontorechnung ohnehin nicht enthalten. Sonst würde doppelt gezählt.

## Erfassung über ChatGPT (aktueller Weg)
Statt automatischer Auslese in der App (Anthropic-API, Edge-Function, API-Key) läuft die Erkennung in ChatGPT. Die App bekommt dafür keine Zugangsdaten.
1. Luna lädt den Bon in ChatGPT hoch und sendet den Prompt (Button „Prompt für ChatGPT kopieren“, enthält die aktiven Limit-Namen).
2. ChatGPT antwortet mit einer Zeile je Einkauf: `Betrag; Datum; Händler; Limit`. Ist es unsicher, schreibt es `FRAGE:` statt zu raten.
3. Luna fügt die Antwort in der App unter „Aus ChatGPT einfügen“ ein. Die App prüft jede Zeile streng (Betrag über 0, gültiges Datum der letzten 12 Monate, Limit existiert und ist eindeutig, höchstens 30 Zeilen, Duplikat-Warnung) und zeigt eine Vorschau mit Summe.
4. Erst „Buchen“ speichert, in einer einzigen Anweisung (alles oder nichts). Feste IDs verhindern Doppelbuchung bei Wiederholung nach Netzfehler. Bei auch nur einer fehlerhaften Zeile ist Buchen gesperrt.

Das Bild bleibt in ChatGPT. Der Foto-Upload in der App (privater Bucket) bleibt optional erhalten.

**Preis dieses Wegs:** Die Bons gehen an OpenAI und nicht mehr nur an Supabase. Prüft, ob das für Kassenbons (Kartenziffern, Kundenkarten) in Ordnung ist, und schaltet in ChatGPT das Training mit Chats ab, falls nicht geschehen. Außerdem bleibt es ein Handgriff mehr (Kopieren und Einfügen), und ChatGPT kann Beträge falsch lesen: Die Vorschau ist der Prüfpunkt, die App kann nicht erkennen, ob 23,45 wirklich auf dem Bon steht.

## Was gebaut ist
- **Dashboard (Heute):** Karte „Wocheneinkauf“ direkt unter „Kontostand aktualisieren“. Oben „Diese Woche noch übrig“ und die Summe, darunter je Limit Betrag, Balken (gelb ab 80 %, rot bei Überschreitung), Rest, „rund X € pro Tag“ und die verbleibenden Tage.
- **Einkauf erfassen:** Limit, Betrag, Datum, Notiz, optional Foto (Kamera oder Mediathek). Das Foto wird auf dem Gerät auf max. 1600 px verkleinert und als JPEG neu kodiert. Das spart Speicher und entfernt EXIF/GPS-Daten.
- **Einkäufe und Belege:** Liste der letzten 7 Wochen, Antippen zum Ändern, „Foto“ zeigt den Beleg (kurzlebiger signierter Link, 2 Minuten), Löschen entfernt Eintrag und Foto.
- **Limits:** anlegen, Betrag ändern, beenden. Ein Limit mit Einkäufen wird beendet statt gelöscht (Datenbank erzwingt das).
- **Robust:** Wiederholt man das Speichern nach einem Netzfehler, entsteht kein zweiter Einkauf (feste ID). Scheitert das Foto, wird kein halber Einkauf angelegt. Scheitert der Einkauf nach dem Foto, wird das Foto wieder entfernt.
- **Rolloutsicher:** Fehlen die neuen Tabellen noch, zeigt die Karte „Noch nicht eingerichtet“, und der Rest der App läuft unverändert.

## Datenbank
| Datei | Inhalt |
| --- | --- |
| `supabase/migrations/20261115100000_einkauf_limits_und_einkaeufe.sql` | Tabellen `einkauf_limits`, `einkaeufe`. RLS nur für Mitglieder, `anon` ohne Rechte, kein TRUNCATE/REFERENCES/TRIGGER, Betrags-/Längen-/Pfadprüfungen, FK RESTRICT. |
| `supabase/migrations/20261115100100_belege_storage.sql` | Privater Bucket `belege` (nur JPEG, max. 3 MB) und drei Policies auf `storage.objects` (lesen, hochladen, löschen; kein UPDATE). Dateiname muss `<uuid>.jpg` sein. |
| `supabase/checks/postflight_einkauf_readonly.sql` | Nur `SELECT`, danach müssen alle Zeilen `true` sein. |
| `supabase/rollback/…_down.sql` | Teil 1 verweigert sich, solange Daten existieren. Teil 2 entfernt nur die Policies. |

Der Storage-Teil ist bewusst getrennt: Die Tabelle `storage.objects` gehört in Produktion `supabase_storage_admin`, und `postgres` ist dort kein Mitglied. **Ob `CREATE POLICY` per Migration dort funktioniert, ist nicht verifiziert.** Ohne Schreibzugriff ließ sich das nicht prüfen.

## Getestet
- 175 Datenbanktests auf isoliertem PostgreSQL 16 (davon rund 50 neu): Constraints, RLS für Mitglied, Nicht-Mitglied und anon, TRUNCATE verweigert, Restriktion beim Löschen von Limits, Storage-Policies (Namensformat, fremder Bucket, kein UPDATE, nur Mitglieder), Idempotenz, Rollback und Neuanwendung.
- Textimport: Formate (Komma/Punkt, TT.MM.JJJJ/ISO, Code-Block, Markdown-Tabelle, Tab), Limit-Zuordnung, 10 Fehlerfälle, Duplikate, Grenzen. Smoke-Test: Vorschau, Buchen, Wiederholung mit gleichen IDs, Fehlertext bucht nichts.
- Rechenlogik (Wochengrenzen inkl. Jahreswechsel und Zeitumstellung, Cent-Genauigkeit, Überschreitung, inaktive Limits).
- App-Smoke-Test: Karte, Erfassen, Wiederholung, Validierung, Foto-Upload und Aufräumen, Belegansicht, Löschen, Limits, „Tabellen fehlen“.
- Gerendert auf 390 px Breite (kein horizontaler Überlauf, keine Konsolenfehler). Dabei fiel ein Darstellungsfehler auf (Balken-Klasse kollidierte mit einer bestehenden Klasse), er ist behoben.

## Rollout
1. Backup wie im Plan `docs/migration-rollout-plan.md`.
2. **Teil 1** im SQL-Editor anwenden, `postflight_einkauf_readonly.sql` ausführen (Zeilen `S1`/`S2` sind dann noch rot).
3. **Teil 2 zuerst auf einem Testprojekt oder Supabase-Branch** probieren. Klappt `CREATE POLICY` nicht per SQL, Bucket und drei Policies im Dashboard (Storage) mit denselben Bedingungen anlegen. Dann Postflight komplett grün.
4. `supabase migration repair --status applied 20261115100000 20261115100100`.
5. Test mit echtem Login auf dem Branch-Frontend: Limit anlegen, Einkauf mit Foto auf iPhone erfassen, Foto ansehen, als Sascha dasselbe sehen, Einkauf löschen und prüfen, dass das Foto verschwindet.
6. Frontend mergen (Cache-Version ist auf `20261115-1` erhöht).

Die Reihenfolge Datenbank, dann Frontend gilt hier nicht streng: Das Frontend verträgt die fehlenden Tabellen.

## Risiken und offene Entscheidungen
1. **Fotos sind nicht im Backup.** Der verschlüsselte Backup-Workflow sichert nur die Datenbank. Gehen Fotos verloren (z. B. Projekt gelöscht), bleiben die Beträge, die Bilder nicht. Das JSON-Backup in der App enthält Limits und Einkäufe, aber keine Fotos. Entscheidung: Ist das für Belege akzeptabel, oder soll der Workflow den Bucket mitsichern?
2. **Datenschutz:** Kassenbons können Kartenziffern oder Kundenkarten zeigen. Der Bucket ist privat, Zugriff nur für beide Mitglieder, der Hinweis im Formular steht. Es gibt keine automatische Schwärzung.
3. **Speicher:** Ein verkleinertes Foto liegt meist bei 0,2 bis 0,5 MB. Beim Free-Tier (1 GB) reicht das für sehr viele Belege, ein Löschkonzept (z. B. nach 12 Monaten) gibt es noch nicht.
4. **Storage-Migration unverifiziert** (siehe oben).
5. **Nur echte Geräte zeigen es sicher:** Kamera-Auswahl, HEIC-Fotos und Dateidialog sind nur im Browser-Mock getestet, nicht auf einem iPhone. HEIC lässt sich in Safari und Chrome auf Android dekodieren, in einem Desktop-Chrome nicht (dann klare Fehlermeldung, Foto weglassen).
6. **Gleichzeitiges Bearbeiten:** Zwei Geräte, die gleichzeitig denselben Einkauf ändern, überschreiben sich (letzter gewinnt). Bei zwei Personen im Haushalt unkritisch.
7. **Verwaiste Fotos:** Bricht die Verbindung genau zwischen Foto-Upload und Löschversuch ab, bleibt eine Datei ohne Eintrag liegen (nur Speicherplatz, nicht lesbar ohne Mitgliedschaft). Ein Aufräum-Job existiert nicht.
8. **Nicht enthalten:** Rückerstattungen (negative Beträge), Wiederkehr von Einkäufen, Übertrag von Restbeträgen, Auswertung über Wochen, Erinnerung bei Überschreitung, Limits je Person.
