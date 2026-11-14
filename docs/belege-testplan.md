# Belegverwaltung: Prüfplan

**Nicht produktiv ausführen, bevor alle Punkte bestanden sind.**

1. Prüfen: Migration 01 in isolierter Testdatenbank; FK, RLS, grants, Constraints.
2. Bucket 02 privat, 10 MB, PDF/JPEG/PNG/WebP; bestehende Konfiguration auf Abweichungen prüfen.
3. Storage-Policy 03 mit nachgewiesener Eigentümerberechtigung ausführen, ohne Rollen-/Owner-Manipulation.
4. Erlaubter Account A: Datei hochladen, Metadatensatz anlegen, Datei lesen.
5. Erlaubter Account B: gemeinschaftlich gespeicherten Beleg lesen.
6. Nicht freigegebener Account: keine Metadaten, kein Upload, kein Download, keine Listen.
7. Anonymer Account: alle Operationen verweigert.
8. Datei ohne Metadatensatz darf nicht gelesen werden; doppelte Pfade werden abgelehnt.
9. Update/Delete/Upsert verweigert; Datei >10MB oder anderer MIME-Typ verweigert.
10. Bei abgebrochenem Metadateninsert verwaiste Datei dokumentieren und sicheren Cleanup testen.
11. Datenschutz/Retention, Löschkonzept, Backup/Restore und Benutzerführung freigeben.
12. Nach Freigabe: Deploy-Reihenfolge 01 → 02 → 03 → UI, danach Smoke-Test.

Hinweis: `private.ist_mitglied()` ist eine bereits bestehende Auth-Hilfsfunktion. Berechtigung zum Aufruf im Storage-Kontext vorab prüfen.
