// Regressionstests für Datumsgrenzen und Zahlungsstatus – nur synthetische Daten.
const assert = require('node:assert/strict');
const L = require('../logic.js');
const D = L.parseISO;
const I = L.iso;

function state(posten = [], zahlungen = [], einnahmen = []) {
  return { posten, zahlungen, einnahmen, staende: [] };
}
function p(id, fields = {}) {
  return { id, name: id, betrag: 10, rhythmus: 'monatlich',
    tag_im_monat: 31, zahlung: 'konto', ...fields };
}
function e(tag_im_monat, fields = {}) {
  return { person: 'Test', betrag: 100, tag_im_monat, aktiv: true, ...fields };
}

// 25. ist inklusive, der nächste 25. gehört bereits zum Folgemonat.
for (const [date, expected] of [
  ['2026-02-24', '2026-01-25'],
  ['2026-02-25', '2026-02-25'],
  ['2027-01-01', '2026-12-25'],
  ['2028-02-29', '2028-02-25']
]) assert.equal(I(L.periodStart(D(date))), expected);

// Bei Tag 31 liegt die Fälligkeit im Startmonat des Finanzmonats (ab Tag 25).
let s = state([p('end')]);
let items = L.itemsForPeriod(s, D('2026-02-25'), D('2026-03-01'));
assert.equal(I(items[0].date), '2026-02-28');
items = L.itemsForPeriod(s, D('2026-01-25'), D('2026-02-01'));
assert.equal(I(items[0].date), '2026-01-31');

// Einmalige Zahlungen sind nur im richtigen Zeitraum sichtbar.
s = state([p('once', { rhythmus: 'einmalig', faellig_am: '2026-11-25' })]);
assert.equal(L.itemsForPeriod(s, D('2026-10-25'), D('2026-11-14')).length, 0);
assert.equal(L.itemsForPeriod(s, D('2026-11-25'), D('2026-11-26')).length, 1);

// Bezahlte Posten dürfen nicht erneut als offen gerechnet werden.
s = state([p('paid', { tag_im_monat: 15 })],
  [{ posten_id: 'paid', finanzmonat: '2026-10-25', betrag: 10, erfasst_am: '2026-11-13T10:00:00Z' }],
  [e(25)]);
assert.equal(L.itemsForPeriod(s, D('2026-10-25'), D('2026-11-14'))[0].paid, true);
assert.equal(L.calcLage(s, D('2026-11-14')).offen, 0);

// Monatsende bei Einnahmen; deaktivierte Einnahmen nicht berücksichtigen.
s = state([], [], [e(31), e(10, { aktiv: false })]);
assert.equal(L.incomeInPeriod(s, D('2026-01-25')).sum, 100);
assert.equal(I(L.incomeInPeriod(s, D('2026-01-25')).list[0].date), '2026-01-31');

// Schaltjahr bei monatlicher Wiederholung.
assert.equal(I(L.nextRecurrence('2028-01-31', 'monatlich', D('2028-01-31'))), '2028-02-29');

console.log('Grenzfalltests bestanden');
