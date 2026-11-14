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
    focus() {}, querySelector() { return null; }
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
  aufgaben: [
    { id: 'a1', titel: 'Müll rausstellen', zustaendig: 'Luna', faellig: '2026-11-13', wiederholung: 'woechentlich', erledigt: false },
    { id: 'a2', titel: 'Paket abholen <b>x</b>', zustaendig: 'Sascha', faellig: null, wiederholung: null, erledigt: false },
    { id: 'a3', titel: 'Termin vorbereiten', zustaendig: 'Sascha', faellig: '2026-11-20', wiederholung: null, erledigt: false }
  ]
};
const calls = [];
function from(table) {
  const q = { _t: table, _op: 'select' };
  const chain = ['select', 'order', 'limit', 'eq'];
  chain.forEach((m) => { q[m] = () => q; });
  ['insert', 'update', 'delete', 'upsert'].forEach((m) => { q[m] = (arg) => { q._op = m; calls.push([table, m, arg]); return q; }; });
  q.then = (res) => res({ data: q._op === 'select' ? db[table] : null, error: null });
  return q;
}
const user = { email: 'test@example.com' };
const sandbox = {
  document, console, Intl, Date, Math, Number, String, Object, Array, JSON, Promise, setTimeout, clearTimeout, File: class {},
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
      rpc: async (name, args) => {
        calls.push(['rpc', name, args]);
        return { data: null, error: null };
      },
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
  assert.ok(/Gemeinsam mit Luna/.test(app()) && /Saschas (Spielraum|Fehlbetrag)/.test(app()), 'Heute zeigt beide großen Geldbeträge');
  assert.ok(/class="hero/.test(app()), 'Geldbetrag als Hero');
  assert.ok(/Zukünftige Aufgaben <span class="count">1<\/span>/.test(app()) && /Termin vorbereiten/.test(app()), 'Zukünftige Aufgaben vollständig vorhanden');
  assert.ok(/Aufgaben ohne Termin <span class="count">1<\/span>/.test(app()), 'Aufgaben ohne Termin separat');
  assert.ok(/Kontostand aktualisieren/.test(app()));
  assert.ok(/noch nicht abgehakt/.test(app()), 'Hinweis auf nicht abgehakte Zahlungen');
  assert.ok(/Müll rausstellen/.test(app()));
  assert.ok(/Noch zu klären/.test(app()) === false, 'Fixture hat keine Posten mit Status prüfen');
  assert.ok(!/Paket abholen <b>/.test(app()), 'HTML in Titeln wird maskiert');

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

  // The app uses atomic RPCs, not separate task or finance writes.
  assert.ok(fs.readFileSync(path.join(root, 'app.js'), 'utf8').includes("sb.rpc('set_task_completion'"));
  assert.ok(fs.readFileSync(path.join(root, 'app.js'), 'utf8').includes("sb.rpc('save_account_reconciliation'"));

  // A completion checkbox must invoke the atomic RPC, not a direct table write.
  handlers.change.forEach((h) => h({ target: { dataset: { action: 'aufgabe-done', id: 'a1' }, checked: true } }));
  await tick(); await tick();
  assert.ok(calls.some((c) => c[0] === 'rpc' && c[1] === 'set_task_completion' &&
    c[2].p_task_id === 'a1' && c[2].p_done === true), 'Aufgabe uses atomic RPC');

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
