const assert = require('assert');
const L = require('../logic.js');

const { posten, einnahmen } = require('./fixture.js');
const today = new Date(2026, 10, 13);
const D = (s) => L.parseISO(s);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, (msg || '') + ' erwartet ' + b + ' bekommen ' + a);

function fresh() {
  return {
    posten: posten, einnahmen: einnahmen,
    zahlungen: [{ posten_id: 'auto1', finanzmonat: '2026-10-25', betrag: 86, erfasst_am: '2026-11-13T16:52:16Z' }],
    staende: [{ betrag: 1840, erfasst_am: '2026-11-13T17:00:00Z' }]
  };
}

// Finanzmonat
assert.strictEqual(L.iso(L.periodStart(D('2026-11-13'))), '2026-10-25');
assert.strictEqual(L.iso(L.periodStart(D('2026-11-25'))), '2026-11-25');
assert.strictEqual(L.iso(L.periodStart(D('2026-11-24'))), '2026-10-25');
assert.strictEqual(L.iso(L.periodStart(D('2027-01-03'))), '2026-12-25');

// Termine im Finanzmonat 25.10. bis 25.11.
const cs = L.periodStart(today);
const items = L.itemsForPeriod(fresh(), cs, today);
const byId = Object.fromEntries(items.map((i) => [i.p.id, i]));
assert.strictEqual(L.iso(byId.creditplus.date), '2026-10-30');
assert.strictEqual(L.iso(byId.otto2.date), '2026-10-29');
assert.strictEqual(L.iso(byId.starlink.date), '2026-11-01');
assert.strictEqual(L.iso(byId.key.date), '2026-11-15');
assert.strictEqual(byId.energis.date, null);
assert.ok(byId.adobe, 'Adobe gehört in den aktuellen Monat');
assert.ok(byId.auto1.paid && !byId.auto2, 'Autokredit alt bezahlt, neue Rate noch nicht gültig');

// Monatssummen
const s = fresh();
const m0 = L.monatSummary(s, cs, today);
close(m0.einnahmen, 3178, 'Einnahmen');
close(m0.fixkosten, 1759.92, 'Fixkosten aktueller Monat inkl. Adobe');
close(m0.bar, 240, 'bar');
const v = L.vorschau(s, today, 6);
close(v[1].fixkosten, 1724.23, 'Dezember ohne Adobe');
close(v[2].fixkosten, 1724.23, 'Januar');
close(v[3].fixkosten, 1724.23, 'Februar, Autokredit noch reduziert');
close(v[4].fixkosten, 1810.03, 'März mit voller Rate');
close(v[4].rest, 3178 - 1810.03, 'Rest ab März');

// Nächstes Gehalt
const ni = L.nextIncome(s, today);
assert.strictEqual(L.iso(ni.date), '2026-11-25');
assert.strictEqual(ni.e.person, 'Sascha');
assert.strictEqual(L.iso(L.nextIncome(s, D('2026-11-25')).date), '2026-12-10');
assert.strictEqual(L.iso(L.nextIncome(s, D('2026-12-10')).date), '2026-12-25');

// Lage vor dem Abgleich: alles mit vergangenem Termin zählt noch als offen
let lage = L.calcLage(s, today);
close(lage.offen, 1433.92, 'offen vor Abgleich');
assert.strictEqual(lage.days, 12);
close(lage.verfuegbar, 406.08, 'verfügbar vor Abgleich (zu niedrig, bis abgehakt wird)');

// Abgleich: alle Posten mit vergangenem Termin als abgebucht markieren (Zeitstempel gleich Stand)
const ts = '2026-11-13T17:00:00Z';
const pastIds = items.filter((i) => !i.paid && i.date && i.date <= today && i.p.zahlung === 'konto').map((i) => i.p.id);
assert.strictEqual(pastIds.length, 13);
const s2 = fresh();
pastIds.forEach((id) => s2.zahlungen.push({ posten_id: id, finanzmonat: '2026-10-25', betrag: posten.find((p) => p.id === id).betrag, erfasst_am: ts }));
lage = L.calcLage(s2, today);
close(lage.offen, 559.50, 'offen nach Abgleich');
close(lage.verfuegbar, 1280.50, 'verfügbar');
close(lage.tagesbudget, 106.71, 'Tagesbudget');
assert.strictEqual(lage.luecke, null);
close(lage.barOffen, 240, 'bar offen');

// Zahlung nach dem Kontostand ändert die Rechnung nicht
const s3 = JSON.parse(JSON.stringify(s2));
s3.zahlungen.push({ posten_id: 'otelo', finanzmonat: '2026-10-25', betrag: 24.99, erfasst_am: '2026-11-14T08:00:00Z' });
close(L.calcLage(s3, today).verfuegbar, 1280.50, 'Zahlung nach Stand');
// neuer Kontostand mit abgegangener Zahlung bleibt konsistent
s3.staende.unshift({ betrag: 1815.01, erfasst_am: '2026-11-14T09:00:00Z' });
close(L.calcLage(s3, today).verfuegbar, 1280.50, 'neuer Stand');

// Lücke bei knappem Konto
const s4 = JSON.parse(JSON.stringify(s2));
s4.staende[0].betrag = 300;
lage = L.calcLage(s4, today);
close(lage.luecke, 259.50, 'Lücke');
assert.strictEqual(lage.tagesbudget, null);

// Eingabe von Beträgen
assert.strictEqual(L.parseBetrag('1.840,50'), 1840.5);
assert.strictEqual(L.parseBetrag('1840,5'), 1840.5);
assert.strictEqual(L.parseBetrag('1840.5'), 1840.5);
assert.strictEqual(L.parseBetrag('1.840'), 1840);
assert.strictEqual(L.parseBetrag('86 €'), 86);
assert.ok(Number.isNaN(L.parseBetrag('')));
assert.ok(Number.isNaN(L.parseBetrag('abc')));

// Wiederkehrende Aufgaben
assert.strictEqual(L.iso(L.nextRecurrence('2026-11-10', 'woechentlich', today)), '2026-11-20');
assert.strictEqual(L.iso(L.nextRecurrence('2026-11-20', 'woechentlich', today)), '2026-11-27');
assert.strictEqual(L.iso(L.nextRecurrence('2026-01-31', 'monatlich', D('2026-01-31'))), '2026-02-28');
assert.strictEqual(L.iso(L.nextRecurrence(null, 'taeglich', today)), '2026-11-14');

console.log('Alle Tests bestanden');

// Dispo als Spielraum: Stand -7623,29, Dispo 8000, offen 559,50 -> es fehlen 182,79
{
  const sD = JSON.parse(JSON.stringify(s));
  sD.staende = [{ betrag: -7623.29, erfasst_am: sD.staende && sD.staende[0] ? sD.staende[0].erfasst_am : new Date().toISOString() }];
  const lD = L.calcLage(sD, today, 8000);
  assert.strictEqual(lD.spielraum, 376.71);
  console.log('Dispo-Spielraum:', lD.spielraum, 'verfuegbar:', lD.verfuegbar, 'luecke:', lD.luecke);
}
