# Lebenscockpit

Gemeinsames Haushalts-Cockpit für zwei Personen: Kontolage bis zum nächsten Gehalt, feste Zahlungen, Aufgaben.

- Reine Browser-App ohne Build-Schritt (HTML, CSS, JavaScript)
- Daten und Anmeldung über Supabase, Zugriff nur für freigegebene E-Mail-Adressen
- Der Code enthält keine Zugangsdaten, nur die öffentliche Projektadresse und den öffentlichen Schlüssel
- Rechenlogik in `logic.js`, Tests mit `node test/logic.test.js` und `node test/smoke.test.js`
