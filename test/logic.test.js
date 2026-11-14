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

// Luna-Konto gegenrechnen
{
  const sL = JSON.parse(JSON.stringify(s));
  const ts = sL.staende && sL.staende[0] ? sL.staende[0].erfasst_am : new Date().toISOString();
  sL.staende = [{ betrag: -7623.29, erfasst_am: ts, konto: 'sascha' }, { betrag: 300, erfasst_am: ts, konto: 'luna' }];
  const lL = L.calcLage(sL, today, 8000);
  assert.strictEqual(lL.luna.betrag, 300);
  assert.strictEqual(lL.gesamt, Math.round((lL.verfuegbar + 300) * 100) / 100);
  console.log('Luna-Gegenrechnung ok');
}

// ---------- Wocheneinkauf ----------
{
  const ymd = (d) => L.iso(d);
  // Wochengrenzen: Montag bis Sonntag, auch ueber Jahreswechsel und Zeitumstellung
  assert.strictEqual(ymd(L.weekStart(new Date(2026, 10, 13))), '2026-11-09', 'Freitag -> Montag');
  assert.strictEqual(ymd(L.weekStart(new Date(2026, 10, 9))), '2026-11-09', 'Montag bleibt Montag');
  assert.strictEqual(ymd(L.weekStart(new Date(2026, 10, 15))), '2026-11-09', 'Sonntag gehoert zur Woche davor');
  assert.strictEqual(ymd(L.weekEnd(new Date(2026, 10, 13))), '2026-11-15');
  assert.strictEqual(ymd(L.weekStart(new Date(2027, 0, 1))), '2026-12-28', 'Jahreswechsel');
  assert.strictEqual(ymd(L.weekEnd(new Date(2026, 11, 30))), '2027-01-03', 'Jahreswechsel Ende');
  assert.strictEqual(ymd(L.weekStart(new Date(2026, 9, 25))), '2026-10-19', 'Zeitumstellung 25.10.2026 (Sonntag)');
  assert.strictEqual(ymd(L.weekEnd(new Date(2026, 9, 21))), '2026-10-25', 'Woche mit Zeitumstellung endet am Sonntag');

  const limits = [
    { id: 'l1', name: 'Lebensmittel', wochenlimit: '80.00', aktiv: true },
    { id: 'l2', name: 'Drogerie', wochenlimit: 20, aktiv: true },
    { id: 'l3', name: 'Alt', wochenlimit: 50, aktiv: false }
  ];
  const kaeufe = [
    { limit_id: 'l1', datum: '2026-11-09', betrag: '0.10' },   // Montag, zaehlt
    { limit_id: 'l1', datum: '2026-11-12', betrag: '0.20' },
    { limit_id: 'l1', datum: '2026-11-15', betrag: '30.00' },  // Sonntag, zaehlt
    { limit_id: 'l1', datum: '2026-11-08', betrag: '99.00' },  // Vorwoche, zaehlt nicht
    { limit_id: 'l1', datum: '2026-11-16', betrag: '99.00' },  // Folgewoche, zaehlt nicht
    { limit_id: 'l2', datum: '2026-11-10T08:00:00Z', betrag: 25 }, // ueber Limit
    { limit_id: 'l3', datum: '2026-11-10', betrag: 10 }        // inaktives Limit: nicht im Ueberblick
  ];
  const st = L.einkaufStatus(limits, kaeufe, new Date(2026, 10, 13));
  assert.strictEqual(st.rows.length, 2, 'nur aktive Limits');
  const r1 = st.rows[0], r2 = st.rows[1];
  assert.strictEqual(r1.spent, 30.3, 'Cent-genau: 0,10 + 0,20 + 30');
  assert.strictEqual(r1.rest, 49.7);
  assert.strictEqual(r1.pct, 38);
  assert.strictEqual(r1.over, false);
  assert.strictEqual(r1.count, 3);
  assert.strictEqual(st.daysLeft, 3, 'Fr, Sa, So');
  assert.strictEqual(r1.proTag, 16.56, 'Rest pro verbleibendem Tag, abgerundet');
  assert.strictEqual(r2.over, true, 'Limit ueberschritten');
  assert.strictEqual(r2.rest, -5);
  assert.strictEqual(r2.pct, 100, 'Balken bei 100 % gedeckelt');
  assert.strictEqual(r2.proTag, 0, 'kein Tagesbudget bei ueberschrittenem Limit');
  assert.strictEqual(st.total.spent, 55.3);
  assert.strictEqual(st.total.limit, 100);
  assert.strictEqual(st.total.rest, 44.7);
  // leere und fehlende Daten
  assert.strictEqual(L.einkaufStatus([], [], new Date(2026, 10, 13)).rows.length, 0);
  assert.strictEqual(L.einkaufStatus(undefined, undefined, new Date(2026, 10, 13)).total.limit, 0);
  assert.strictEqual(L.einkaufStatus(limits, [], new Date(2026, 10, 13)).rows[0].spent, 0);
  // Genau am Limit ist nicht ueber dem Limit
  assert.strictEqual(L.einkaufStatus([limits[1]], [{ limit_id: 'l2', datum: '2026-11-13', betrag: 20 }], new Date(2026, 10, 13)).rows[0].over, false);
  console.log('Wocheneinkauf-Logik ok');
}
