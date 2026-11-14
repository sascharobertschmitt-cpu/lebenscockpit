# Lebenscockpit

Gemeinsames Haushalts-Cockpit für zwei Personen: Kontolage bis zum nächsten Gehalt, feste Zahlungen, Aufgaben.

- Reine Browser-App ohne Build-Schritt (HTML, CSS, JavaScript)
- Daten und Anmeldung über Supabase, Zugriff nur für freigegebene E-Mail-Adressen
- Der Code enthält keine Zugangsdaten, nur die öffentliche Projektadresse und den öffentlichen Schlüssel
- Rechenlogik in `logic.js`, Tests mit `node test/logic.test.js` und `node test/smoke.test.js`

## Prüfungen

- `npm test`: Finanzlogik und Anwendungssmoketest.
- `npm ci && npx playwright install --with-deps chromium webkit && npm run test:browser`: echte Browserprüfung mit synthetischen Daten, ohne Supabase-Zugriff.
- GitHub Actions führt Chromium und WebKit bei 320, 390 und 1280 Pixeln aus. Screenshots liegen als kurzlebiges Workflow-Artefakt vor. Das ist keine Prüfung auf einem echten iPhone.

Klappzustände werden nur im jeweiligen Browser gespeichert. Ist der Browserspeicher nicht verfügbar, bleibt die Ansicht bedienbar.
