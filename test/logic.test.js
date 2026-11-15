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
assert.strictEqual(L.parseBetrag('-7.000'), -7000);
assert.strictEqual(L.parseBetrag('−7.000'), -7000);
assert.strictEqual(L.parseBetrag('-7.623,29 €'), -7623.29);
assert.strictEqual(L.parseBetrag('-7623.29'), -7623.29);
assert.strictEqual(L.parseBetrag('+1.840'), 1840);
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

// Zahlung aus dem vorherigen Finanzmonat nach einem älteren Kontostand:
// Beim Monatswechsel darf sie nicht aus der Rechnung verschwinden.
{
  const state = {
    posten: [{ id: 'old', name: 'Einmalige Rechnung', rhythmus: 'einmalig', faellig_am: '2026-11-24', zahlung: 'konto', betrag: 100 }],
    einnahmen: [{ person: 'Sascha', tag_im_monat: 10, betrag: 1000 }],
    zahlungen: [{ posten_id: 'old', finanzmonat: '2026-10-25', betrag: 100, erfasst_am: '2026-11-24T12:00:00Z' }],
    staende: [{ konto: 'sascha', betrag: 500, erfasst_am: '2026-11-23T12:00:00Z' }]
  };
  close(L.calcLage(state, D('2026-11-26')).verfuegbar, 400, 'Zahlung vor Finanzmonatswechsel bleibt abgezogen');
  state.staende[0] = { konto: 'sascha', betrag: 400, erfasst_am: '2026-11-25T12:00:00Z' };
  close(L.calcLage(state, D('2026-11-26')).verfuegbar, 400, 'Neuer Stand zählt die Zahlung nicht doppelt');
}

// Eine spätere Änderung am Planbetrag verändert keine bereits erfasste Zahlung.
{
  const state = fresh();
  state.zahlungen[0] = { ...state.zahlungen[0], betrag: 80 };
  const item = L.itemsForPeriod(state, cs, today).find(i => i.p.id === 'auto1');
  close(item.betrag, 80, 'Gebuchter Betrag bleibt maßgeblich');
  close(L.monatSummary(state, cs, today).bezahlt, 80, 'Bezahlt-Summe nutzt Buchung');
}

// Finite installment plans reuse their existing monthly post, including history.
{
 const p = {id:'plan',name:'Testplan',rhythmus:'monatlich',tag_im_monat:29,betrag:10,zahlung:'konto',raten_ab_nummer:2,raten_gesamt:4,raten_ab_datum:'2027-01-29',raten_schlussbetrag:9.5};
 const state={posten:[p],zahlungen:[],einnahmen:[],staende:[]};
 let rows=L.installmentRows(state,p);
 assert.deepStrictEqual(rows.map(r=>L.iso(r.date)),['2027-01-29','2027-02-28','2027-03-29']);
 close(rows.reduce((s,r)=>s+r.betrag,0),29.5);
 close(L.itemsForPeriod(state,D('2027-03-25'),today)[0].betrag,9.5);
 assert.equal(L.itemsForPeriod(state,D('2027-04-25'),today).length,0);
 assert.equal(L.itemsForPeriod(state,D('2027-01-25'),today).length,1);
 state.zahlungen.push({posten_id:'plan',finanzmonat:'2027-01-25',betrag:10});
 assert.equal(L.installmentRows(state,p).filter(r=>!r.paid).length,2);
 assert.equal(L.itemsForPeriod(state,D('2026-12-25'),today).length,1,'Older periods retain existing history');
}

// Wiederkehrende Abbuchungen aus Bankumsätzen.
{
 const rows=[
  {gegenpartei:'Netflix',betrag:-12.99,buchungsdatum:'2026-09-03',buchungsstatus:'gebucht'},
  {gegenpartei:'NETFLIX ',betrag:-12.99,buchungsdatum:'2026-10-03',buchungsstatus:'gebucht'},
  {gegenpartei:'Netflix',betrag:-12.99,buchungsdatum:'2026-11-03',buchungsstatus:'vorgemerkt'},
  {gegenpartei:'Rewe',betrag:-20,buchungsdatum:'2026-10-05'},{gegenpartei:'Rewe',betrag:-30,buchungsdatum:'2026-10-20'},
  {gegenpartei:'Arbeitgeber',betrag:2000,buchungsdatum:'2026-09-30'},{gegenpartei:'Arbeitgeber',betrag:2000,buchungsdatum:'2026-10-30'},
  {gegenpartei:'PayPal (Europe)',verwendungszweck:'1234567890 Spotify',betrag:-10,buchungsdatum:'2026-09-10'},
  {gegenpartei:'PayPal (Europe)',verwendungszweck:'9876543210 Spotify',betrag:-10,buchungsdatum:'2026-10-10'},
  {gegenpartei:'PayPal (Europe)',verwendungszweck:'5555555555 Zalando',betrag:-50,buchungsdatum:'2026-09-12'},
  {gegenpartei:'PayPal (Europe)',verwendungszweck:'6666666666 Otto',betrag:-40,buchungsdatum:'2026-10-15'},
  {gegenpartei:null,betrag:-5,buchungsdatum:'2026-09-01'},{gegenpartei:'Defekt',betrag:-5,buchungsdatum:null},{gegenpartei:'Defekt',betrag:'x',buchungsdatum:'2026-10-01'}
 ];
 const c=L.recurringCandidates(rows);
 assert.deepStrictEqual(c.map(g=>g.name),['Netflix','PayPal · Spotify'],'nur gebuchte Abbuchungen, PayPal je Händler, kein Einkommen');
 assert.equal(c[0].count,2); close(c[0].sum,25.98); assert.equal(c[0].monthCount,2);
 assert.deepStrictEqual(L.recurringCandidates(null),[]);
}
