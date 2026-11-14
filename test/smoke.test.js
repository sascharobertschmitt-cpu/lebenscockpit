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
  createElement(tag) {
    if (tag === 'canvas') return { width: 0, height: 0, getContext: () => ({ drawImage() {}, fillRect() {}, set fillStyle(v) { calls.push(['canvas.fill', v]); } }), toBlob(cb, type, q) { cb({ size: 123456, type }); } };
    return { click() {}, remove() {}, set href(v) {}, set download(v) {} };
  },
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
db.einkauf_limits = [
  { id: 'l1', name: 'Lebensmittel', wochenlimit: '80.00', aktiv: true },
  { id: 'l2', name: 'Drogerie <i>x</i>', wochenlimit: '20.00', aktiv: true },
  { id: 'l3', name: 'Beendet', wochenlimit: '10.00', aktiv: false },
  { id: 'l4', name: 'Baeckerei', wochenlimit: '10.00', aktiv: true }
];
db.einkaeufe = [
  { id: 'e1', limit_id: 'l1', datum: '2026-11-10', betrag: '30.30', notiz: 'Rewe', beleg_pfad: 'aaaaaaaa-0000-4000-8000-000000000001.jpg', erfasst_am: '2026-11-10T10:00:00Z' },
  { id: 'e2', limit_id: 'l2', datum: '2026-11-11', betrag: '25.00', notiz: null, beleg_pfad: null, erfasst_am: '2026-11-11T10:00:00Z' },
  { id: 'e4', limit_id: 'l4', datum: '2026-11-12', betrag: '8.50', notiz: null, beleg_pfad: null, erfasst_am: '2026-11-12T10:00:00Z' },
  { id: 'e3', limit_id: 'l1', datum: '2026-11-02', betrag: '99.00', notiz: 'Vorwoche', beleg_pfad: null, erfasst_am: '2026-11-02T10:00:00Z' }
];
const calls = [];
const missing = new Set();           // Tabellen, die "noch nicht existieren"
const failOps = new Set();           // z. B. 'einkaeufe.upsert' oder 'storage.upload'
function from(table) {
  const q = { _t: table, _op: 'select' };
  const chain = ['select', 'order', 'limit', 'eq', 'gte'];
  chain.forEach((m) => { q[m] = () => q; });
  ['insert', 'update', 'delete', 'upsert'].forEach((m) => { q[m] = (arg, opt) => { q._op = m; calls.push([table, m, arg, opt]); return q; }; });
  q.then = (res) => {
    if (missing.has(table)) return res({ data: null, error: { code: '42P01', message: 'relation "public.' + table + '" does not exist' } });
    if (failOps.has(table + '.' + q._op)) { failOps.delete(table + '.' + q._op); return res({ data: null, error: { code: '08006', message: 'Netzfehler' } }); }
    return res({ data: q._op === 'select' ? db[table] : null, error: null });
  };
  return q;
}
const user = { email: 'test@example.com' };
const sandbox = {
  document, console, Intl, Date, Math, Number, String, Object, Array, JSON, Promise, setTimeout, clearTimeout, File: class {},
  Image: class { set src(v) { this.naturalWidth = 3000; this.naturalHeight = 2000; setTimeout(() => this.onload && this.onload(), 0); } },
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
      storage: { from: (bucket) => ({
        upload: async (path, blob, opts) => {
          calls.push(['storage.upload', bucket, path, blob && blob.size, opts]);
          if (failOps.delete('storage.upload')) return { data: null, error: { message: 'Netzfehler' } };
          return { data: { path }, error: null };
        },
        remove: async (paths) => { calls.push(['storage.remove', bucket, paths]); return { data: [], error: null }; },
        createSignedUrl: async (path) => { calls.push(['storage.sign', bucket, path]); return { data: { signedUrl: 'https://example.test/sign?t=1&x="y"' }, error: null }; }
      }) },
      rpc: async (name, args) => {
        calls.push(['rpc', name, args]);
        if (name === 'save_account_reconciliation' && sandbox.__failNextRpc) { sandbox.__failNextRpc = false; return { data: null, error: { message: 'Netzfehler' } }; }
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

  // Abgleich: stabile p_request_id je Abgleich
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const fields = { '#ab-betrag': { value: '1840,50' }, '#ab-minus': { checked: false }, '#ab-konto': { value: 'sascha' }, '#ab-err': { textContent: '' } };
  const payIds = (m.match(/name="pay" value="([^"]+)" checked/g) || []).map((x) => x.match(/value="([^"]+)"/)[1]);
  const abForm = { dataset: { form: 'abgleich' }, querySelector: (q) => fields[q], querySelectorAll: () => payIds.map((value) => ({ value })) };
  const submit = () => { handlers.submit.forEach((h) => h({ target: abForm, preventDefault() {} })); return tick().then(tick); };
  const abCalls = () => calls.filter((c) => c[0] === 'rpc' && c[1] === 'save_account_reconciliation');
  sandbox.__failNextRpc = true;
  await submit();               // schlägt fehl, Fenster bleibt offen
  await submit();               // Wiederholung
  assert.strictEqual(abCalls().length, 2);
  const id1 = abCalls()[0][2].p_request_id;
  assert.ok(UUID.test(id1), 'p_request_id ist eine UUID v4: ' + id1);
  assert.strictEqual(abCalls()[1][2].p_request_id, id1, 'Wiederholung nutzt dieselbe p_request_id');
  assert.strictEqual(abCalls()[1][2].p_zahlungen.length, payIds.length);
  click({ action: 'abgleich' }); // neuer Abgleich nach Erfolg
  await submit();
  const id2 = abCalls()[2][2].p_request_id;
  assert.ok(UUID.test(id2) && id2 !== id1, 'Neuer Abgleich bekommt neue p_request_id');

  // Posten bearbeiten
  click({ action: 'posten-edit', id: 'energis' });
  assert.ok(/Energis/.test(elements.modal.innerHTML) && /pe-b/.test(elements.modal.innerHTML));
  assert.ok(!/NaN|undefined/.test(elements.modal.innerHTML));


  // ---------- Wocheneinkauf ----------
  const flat = (x) => x.replace(/ | /g, ' ');
  click({ action: 'tab', tab: 'heute' });
  let a1 = flat(app());
  assert.ok(/Wocheneinkauf/.test(a1) && /Diese Woche noch übrig/.test(a1), 'Dashboard zeigt die Wocheneinkauf-Karte');
  assert.ok(/Lebensmittel/.test(a1) && /30,30 € \/ 80,00 €/.test(a1), 'Lebensmittel: nur Einkäufe der laufenden Woche (30,30 von 80,00)');
  assert.ok(/noch 49,70 €/.test(a1), 'Restbetrag Lebensmittel');
  assert.ok(/5,00 € über dem Limit/.test(a1), 'Überschreitung wird klar benannt');
  assert.ok(/noch 3 Tage/.test(a1), 'verbleibende Tage der Woche');
  assert.ok(/role="progressbar"/.test(a1) && /meter is-over/.test(a1) && /meter is-near/.test(a1), 'Balken mit ARIA-Rolle, rot bei Überschreitung, gelb ab 80 %');
  assert.ok(!/Beendet/.test(a1), 'beendetes Limit nicht im Überblick');
  assert.ok(/Drogerie &lt;i&gt;x&lt;\/i&gt;/.test(a1) && !/<i>x<\/i>/.test(a1), 'Limit-Namen werden maskiert');
  assert.ok(/63,80 € von 110,00 € ausgegeben/.test(a1), 'Summe über alle Limits');

  // Einkauf erfassen (ohne Foto): stabile ID, Wiederholung nach Netzfehler legt nichts doppelt an
  click({ action: 'einkauf-neu' });
  let mm = elements.modal.innerHTML;
  assert.ok(/Einkauf erfassen/.test(mm) && /id="ek-foto"/.test(mm) && /accept="image\/\*"/.test(mm), 'Fenster mit Foto-Auswahl');
  assert.ok(/Lebensmittel/.test(mm) && !/Beendet/.test(mm), 'nur aktive Limits wählbar');
  const ekFields = { '#ek-betrag': { value: '23,45' }, '#ek-datum': { value: '2026-11-13' }, '#ek-limit': { value: 'l1' }, '#ek-notiz': { value: ' Edeka ' }, '#ek-err': { textContent: '' }, '#ek-foto': null };
  const ekForm = { dataset: { form: 'einkauf', id: '' }, querySelector: (q) => ekFields[q] };
  const sub = (f) => { handlers.submit.forEach((h) => h({ target: f, preventDefault() {} })); return tick().then(tick).then(tick); };
  const ups = () => calls.filter((c) => c[0] === 'einkaeufe' && c[1] === 'upsert');
  failOps.add('einkaeufe.upsert');
  await sub(ekForm);                        // schlägt fehl, Fenster bleibt
  await sub(ekForm);                        // Wiederholung
  assert.strictEqual(ups().length, 2);
  assert.ok(UUID.test(ups()[0][2].id), 'Einkauf hat eine UUID als ID');
  assert.strictEqual(ups()[1][2].id, ups()[0][2].id, 'Wiederholung nutzt dieselbe ID (kein Duplikat)');
  assert.deepStrictEqual([ups()[1][2].limit_id, ups()[1][2].betrag, ups()[1][2].datum, ups()[1][2].notiz], ['l1', 23.45, '2026-11-13', 'Edeka']);
  assert.ok(ups()[1][3] && ups()[1][3].ignoreDuplicates === true, 'upsert ignoriert Duplikate statt zu überschreiben');
  assert.strictEqual(ups()[1][2].beleg_pfad, undefined, 'ohne Foto kein Belegpfad');

  // Validierung
  click({ action: 'einkauf-neu' });
  for (const [v, d, re] of [['0', '2026-11-13', /größer als 0/], ['abc', '2026-11-13', /größer als 0/], ['5', '2026-02-30', /gültiges Datum/], ['5', '2024-01-01', /zu weit/], ['5', '2027-01-01', /zu weit/]]) {
    ekFields['#ek-betrag'].value = v; ekFields['#ek-datum'].value = d; ekFields['#ek-err'].textContent = '';
    const before = ups().length;
    await sub(ekForm);
    assert.ok(re.test(ekFields['#ek-err'].textContent), 'Validierung ' + v + '/' + d + ': ' + ekFields['#ek-err'].textContent);
    assert.strictEqual(ups().length, before, 'bei ungültiger Eingabe wird nichts gespeichert');
  }

  // Mit Foto: verkleinern, privat hochladen, Belegpfad = <ID>.jpg; bei Datenbankfehler wird das Foto wieder entfernt
  click({ action: 'einkauf-neu' });
  ekFields['#ek-betrag'].value = '12,00'; ekFields['#ek-datum'].value = '2026-11-13'; ekFields['#ek-err'].textContent = '';
  ekFields['#ek-foto'] = { files: [{ name: 'zettel.heic', size: 9e6 }] };
  failOps.add('einkaeufe.upsert');
  const nUp = calls.filter((c) => c[0] === 'storage.upload').length, nUps = ups().length;
  await sub(ekForm);
  assert.ok(calls.some((c) => c[0] === 'canvas.fill' && c[1] === '#fff'), 'Hintergrund wird weiß gefüllt (Transparenz)');
  const uploads = calls.filter((c) => c[0] === 'storage.upload');
  assert.strictEqual(uploads.length, nUp + 1, 'Foto wird hochgeladen');
  const u = uploads[uploads.length - 1];
  assert.strictEqual(u[1], 'belege'); assert.ok(/^[0-9a-f-]{36}\.jpg$/.test(u[2]), 'Dateiname ist <uuid>.jpg: ' + u[2]);
  assert.strictEqual(u[4].contentType, 'image/jpeg'); assert.strictEqual(u[4].upsert, false, 'bestehende Belege werden nie überschrieben');
  assert.strictEqual(ups()[nUps][2].beleg_pfad, u[2], 'Belegpfad in der Zeile passt zur Datei');
  assert.ok(calls.some((c) => c[0] === 'storage.remove' && c[2][0] === u[2]), 'Foto wird entfernt, wenn der Einkauf nicht gespeichert werden konnte');
  // Upload scheitert: es wird kein Einkauf angelegt, Meldung im Formular
  failOps.add('storage.upload'); ekFields['#ek-err'].textContent = '';
  const nUps2 = ups().length;
  await sub(ekForm);
  assert.strictEqual(ups().length, nUps2, 'ohne Foto-Upload kein halber Einkauf');
  assert.ok(/Foto konnte nicht gespeichert werden/.test(ekFields['#ek-err'].textContent), 'klare Fehlermeldung');
  ekFields['#ek-foto'] = null;

  // Einkaufsliste, Belegansicht, Löschen
  click({ action: 'einkauf-liste' });
  mm = flat(elements.modal.innerHTML);
  assert.ok(/Rewe/.test(mm) && /30,30 €/.test(mm) && /Foto vorhanden/.test(mm), 'Liste zeigt Einkauf mit Foto-Hinweis');
  click({ action: 'beleg', id: 'e1' }); await tick(); await tick();
  assert.ok(calls.some((c) => c[0] === 'storage.sign' && c[2] === 'aaaaaaaa-0000-4000-8000-000000000001.jpg'), 'Beleg über signierte URL');
  assert.ok(/<img class="beleg"/.test(elements.modal.innerHTML) && /&quot;y&quot;/.test(elements.modal.innerHTML) && !/src="https:\/\/example\.test\/sign\?t=1&x="y""/.test(elements.modal.innerHTML), 'URL wird maskiert');
  click({ action: 'einkauf-del', id: 'e1' }); await tick(); await tick(); await tick();
  assert.ok(calls.some((c) => c[0] === 'einkaeufe' && c[1] === 'delete'), 'Einkauf gelöscht');
  assert.ok(calls.some((c) => c[0] === 'storage.remove' && c[2][0] === 'aaaaaaaa-0000-4000-8000-000000000001.jpg'), 'zugehöriges Foto entfernt');

  // Limits
  click({ action: 'limits' });
  assert.ok(/Wochenlimits/.test(elements.modal.innerHTML) && /80,00/.test(flat(elements.modal.innerHTML)) && /beendet/.test(elements.modal.innerHTML));
  click({ action: 'limit-neu' });
  const liFields = { '#li-name': { value: ' Haushalt ' }, '#li-betrag': { value: '35,5' }, '#li-err': { textContent: '' }, '#li-aktiv': null };
  const liForm = { dataset: { form: 'limit', id: '' }, querySelector: (q) => liFields[q] };
  await sub(liForm);
  const ins = calls.filter((c) => c[0] === 'einkauf_limits' && c[1] === 'insert');
  assert.strictEqual(JSON.stringify(ins[ins.length - 1][2]), JSON.stringify({ name: 'Haushalt', wochenlimit: 35.5 }), 'Limit wird angelegt');
  liFields['#li-betrag'].value = '-3'; liFields['#li-err'].textContent = '';
  const nIns = ins.length; await sub(liForm);
  assert.ok(/größer als 0/.test(liFields['#li-err'].textContent) && calls.filter((c) => c[0] === 'einkauf_limits' && c[1] === 'insert').length === nIns, 'negatives Limit abgelehnt');
  click({ action: 'limit-edit', id: 'l3' });
  assert.ok(/id="li-aktiv"/.test(elements.modal.innerHTML) && /Beendet/.test(elements.modal.innerHTML), 'Limit lässt sich wieder aktivieren');

  // Tabellen fehlen noch (Frontend vor Datenbank-Update): Rest der App bleibt benutzbar
  click({ action: 'close-modal' });
  missing.add('einkauf_limits'); missing.add('einkaeufe');
  click({ action: 'refresh' }); await tick(); await tick();
  click({ action: 'tab', tab: 'heute' });
  a1 = flat(app());
  assert.ok(/Noch nicht eingerichtet/.test(a1) && /Gemeinsam mit Luna/.test(a1), 'ohne Tabellen: Hinweis statt Absturz, Dashboard sonst intakt');
  missing.clear();
  click({ action: 'refresh' }); await tick(); await tick();
  assert.ok(/Diese Woche noch übrig/.test(flat(app())), 'nach dem Update erscheint die Karte ohne Neuinstallation');
  click({ action: 'tab', tab: 'mehr' });
  assert.ok(/Wochenlimits verwalten/.test(app()) && /keine Beleg-Fotos/.test(app()), 'Mehr: Limits verwalten, Hinweis zum Backup');

  const all = app() + elements.modal.innerHTML;
  assert.ok(!/NaN|undefined|\[object/.test(all), 'keine NaN oder undefined auf dem Bildschirm');
  console.log('Smoke-Test bestanden');
})().catch((e) => { console.error(e); process.exit(1); });
// Seit der RESTRICT-Migration (posten_zahlungen) scheitert das Loeschen eines Postens mit Zahlungen mit 23503; die App erklaert das.
assert.match(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), /err\.code === '23503'/);
