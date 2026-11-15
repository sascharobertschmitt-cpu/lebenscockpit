// Spielt die App mit einer Attrappe für Browser und Datenbank durch.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { posten, einnahmen } = require('./fixture.js');

const root = path.join(__dirname, '..');
const handlers = {};
const elements = {};
function el(id) {
  return elements[id] || (elements[id] = {
    id, innerHTML: '', textContent: '', classList: { add() {}, remove() {} },
    focus() {}, querySelector() { return null; }, querySelectorAll() { return []; }
  });
}
const document = {
  getElementById: el, visibilityState: 'visible',
  addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  createElement() { return { click() {}, remove() {}, set href(v) {}, set download(v) {} }; },
  body: { appendChild() {} }
};

const db = {
  einnahmen: einnahmen,
  posten: posten.map((p) => Object.assign({ tag_hinweis: null, notiz: null, status: 'sicher', kategorie: 'sonstiges' }, p)),
  posten_zahlungen: [{ id: 'z1', posten_id: 'auto1', finanzmonat: '2026-10-25', betrag: 86, erfasst_am: '2026-11-13T16:52:16Z' }],
  kontostaende: [{ id: 'k1', betrag: 1840, erfasst_am: '2026-11-13T17:00:00Z', erfasst_von: 'test' }],
  wochenbudgets: [{ id: 'w1', name: 'Lebensmittel & Getränke', betrag: 80, sortierung: 1, aktiv: true }, { id: 'w2', name: 'Sprit', betrag: 30, sortierung: 2, aktiv: true }],
  wochenausgaben: [{ id: 'x1', budget_id: 'w1', betrag: 23.45, datum: '2026-11-12', notiz: 'Rewe', erfasst_am: '2026-11-12T10:00:00Z' }, { id: 'x2', budget_id: 'w1', betrag: 50, datum: '2026-11-08', erfasst_am: '2026-11-08T10:00:00Z' }],
  aufgaben: [
    { id: 'a1', titel: 'Müll rausstellen', zustaendig: 'Luna', faellig: '2026-11-13', wiederholung: 'woechentlich', erledigt: false },
    { id: 'a2', titel: 'Paket abholen <b>x</b>', zustaendig: 'Sascha', faellig: null, wiederholung: null, erledigt: false },
    { id: 'a3', titel: 'Termin vorbereiten', zustaendig: 'Sascha', faellig: '2026-11-20', wiederholung: null, erledigt: false }
  ]
};
const calls = [];
function from(table) {
  const q = { _t: table, _op: 'select' };
  const chain = ['select', 'order', 'limit', 'eq', 'or', 'range', 'in'];
  chain.forEach((m) => { q[m] = () => q; });
  ['insert', 'update', 'delete', 'upsert'].forEach((m) => { q[m] = (arg) => { q._op = m; calls.push([table, m, arg]); return q; }; });
  q.then = (res) => res({ data: q._op === 'select' ? db[table] : null, error: null });
  return q;
}
const user = { email: 'test@example.com' };
const saved = { 'cockpit-folds': JSON.stringify({ 'today-balances': true }) };
const sandbox = {
  localStorage: { getItem(key) { return saved[key] || null; }, setItem(key, value) { saved[key] = value; } },
  document, console, Intl, Date, Math, Number, String, Object, Array, JSON, Promise, setTimeout, clearTimeout, File: class {},
  addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
  navigator: {}, URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
  confirm: () => true, scrollTo() {},
  window: null
};
sandbox.window = sandbox;
sandbox.window.scrollTo = () => {};
sandbox.supabase = {
  createClient() {
    return {
      from,
      auth: {
        getSession: async () => ({ data: { session: { user } } }),
        onAuthStateChange() {}, signOut: async () => ({}), signInWithPassword: async () => ({ data: { user }, error: null })
      }
    };
  }
};
vm.createContext(sandbox);
// feste Uhr: 13.11.2026
const RealDate = Date;
sandbox.Date = class extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(2026, 10, 13, 17, 30); }
  static now() { return new RealDate(2026, 10, 13, 17, 30).getTime(); }
};
vm.runInContext(fs.readFileSync(path.join(root, 'logic.js'), 'utf8'), sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), sandbox);

function click(attrs, extra) {
  const node = { dataset: attrs, closest: () => node };
  handlers.click.forEach((h) => h(Object.assign({ target: node }, extra)));
}
const tick = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  await tick(); await tick();
  const app = () => elements.app.innerHTML;

  // Heute
  assert.ok(/Saschas Kontostand/.test(app()) && /Lunas Kontostand/.test(app()) && /Gemeinsam bis zum 25\. verfügbar inkl\. Dispo/.test(app()), 'Heute zeigt beide Kontostände und den gemeinsamen Spielraum');
  assert.ok(/dashboard-money-pair/.test(app()), 'Geldbeträge nebeneinander');
  assert.ok(/Zukünftige Aufgaben \(1\)/.test(app()) && /Termin vorbereiten/.test(app()), 'Zukünftige Aufgaben vollständig vorhanden');
  assert.ok(/Aufgaben ohne Termin \(1\)/.test(app()), 'Aufgaben ohne Termin separat');
  assert.ok(/Kontostand aktualisieren/.test(app()));
  assert.ok(/noch nicht abgehakt/.test(app()), 'Hinweis auf nicht abgehakte Zahlungen');
  assert.ok(/Müll rausstellen/.test(app()));
  assert.ok(/Noch zu klären/.test(app()) === false, 'Fixture hat keine Posten mit Status prüfen');
  assert.ok(!/Paket abholen <b>/.test(app()), 'HTML in Titeln wird maskiert');

  assert.ok(/data-fold="today-balances" open/.test(app()), 'Gespeicherter Klappzustand wird beim Start geladen');

  // Geöffnete Bereiche bleiben auch nach Tabwechseln erhalten.
  handlers.toggle.forEach((h) => h({ target: { dataset: { fold: 'today-future' }, open: true } }));
  handlers.toggle.forEach((h) => h({ target: { dataset: { fold: 'today-finances' }, open: false } }));
  assert.strictEqual(JSON.parse(saved['cockpit-folds'])['today-future'], true, 'Klappzustand wird gespeichert');
  click({ action: 'tab', tab: 'aufgaben' });
  assert.ok(/data-fold="tasks-2"/.test(app()), 'Zukünftige Aufgaben sind einklappbar');
  click({ action: 'tab', tab: 'heute' });
  assert.ok(/data-fold="today-future" open/.test(app()), 'Zukünftige Aufgaben bleiben geöffnet');
  assert.ok(/data-fold="today-finances"><summary>/.test(app()), 'Finanzlage bleibt geschlossen');

  // Wochenbudgets: nur Ausgaben der laufenden Woche (Mo 9.11. bis So 15.11.) zählen
  assert.ok(/56,55/.test(app()) && /110,00/.test(app()) && /Wochenbudgets/.test(app()), 'Wochenbudget zieht Ausgaben ab: ' + (app().match(/Wochenbudgets[^<]*/) || [''])[0]);
  click({ action: 'wbudget-detail', id: 'w1' });
  assert.ok(/Rewe/.test(elements.modal.innerHTML) && !/50,00/.test(elements.modal.innerHTML.replace(/80,00/, '')), 'Detail zeigt nur Ausgaben dieser Woche');
  click({ action: 'wausgabe-neu', id: 'w2' });
  assert.ok(/id="wa-s"/.test(elements.modal.innerHTML) && /value="w2" selected/.test(elements.modal.innerHTML), 'Ausgabe-Formular mit vorgewähltem Budget');
  click({ action: 'close-modal' });

  // Geld
  click({ action: 'tab', tab: 'geld' });
  assert.ok(/Finanzmonat 25\. Okt\.? bis 25\. Nov/.test(app()), 'Finanzmonat: ' + app().slice(0, 200));
  assert.ok(/Vorschau der nächsten Monate/.test(app()));
  assert.ok(/1\.759,92/.test(app().replace(/ /g, ' ')) || /1\.759,92/.test(app()), 'Fixkosten im Monat sichtbar');
  assert.ok(/class="step"/.test(app()) || /step/.test(app()), 'Stufe im März markiert');

  // Aufgaben
  click({ action: 'tab', tab: 'aufgaben' });
  assert.ok(/Überfällig|Heute/.test(app()));
  assert.ok(/&lt;b&gt;x&lt;\/b&gt;/.test(app()));

  // Mehr
  click({ action: 'tab', tab: 'mehr' });
  assert.ok(/test@example\.com/.test(app()));

  // Abgleich-Fenster
  click({ action: 'tab', tab: 'heute' });
  click({ action: 'abgleich' });
  const m = elements.modal.innerHTML;
  assert.ok(/Kontostand aktualisieren/.test(m) && /name="pay"/.test(m), 'Abgleich listet Zahlungen');
  assert.ok(!/NaN|undefined/.test(m), 'keine Platzhalterfehler im Fenster');
  const checked = (m.match(/name="pay" value="[^"]+" checked/g) || []).length;
  assert.strictEqual(checked, 13, 'genau die 13 Zahlungen mit vergangenem Termin sind vorausgewählt');

  // Posten bearbeiten
  click({ action: 'posten-edit', id: 'energis' });
  assert.ok(/Energis/.test(elements.modal.innerHTML) && /pe-b/.test(elements.modal.innerHTML));
  assert.ok(!/NaN|undefined/.test(elements.modal.innerHTML));

  const all = app() + elements.modal.innerHTML;
  assert.ok(!/NaN|undefined|\[object/.test(all), 'keine NaN oder undefined auf dem Bildschirm');
  console.log('Smoke-Test bestanden');
})().catch((e) => { console.error(e); process.exit(1); });
