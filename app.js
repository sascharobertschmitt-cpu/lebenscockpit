(function () {
  'use strict';

  var L = window.Logic;
  var SUPABASE_URL = 'https://txxlniprkltweeenmexf.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_dRrI8RUR1X8ciGA8R8mUxg_CQYAYZua';
  var DISPO = 8000;
  var VERSION = '1.0';

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  var S = { user: null, tab: 'heute', einnahmen: [], posten: [], zahlungen: [], staende: [], aufgaben: [], limits: [], kaeufe: [], eingang: [], eingangOk: false, einkaufFehler: false, showDone: false, folds: {}, loaded: false, busy: false };
  var $app = document.getElementById('app');
  var $modal = document.getElementById('modal');
  var $toast = document.getElementById('toast');

  // ---------- Helfer ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var fmtEur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
  var fmtEur0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  function eur(n) { return fmtEur.format(n); }
  function eur0(n) { return fmtEur0.format(n); }
  function fmtD(d) { return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }); }
  function fmtLong(d) { return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function todayD() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  var toastTimer;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.classList.remove('show'); }, 2600);
  }
  function fail(err) {
    var m = (err && err.message) || String(err);
    if (err && err.code === '23503') { toast('Das geht nicht: Zu diesem Posten gibt es bestätigte Zahlungen. Sie bleiben erhalten, beende den Posten stattdessen.'); return; }
    if (/jwt|token|not authenticated/i.test(m)) { toast('Bitte neu anmelden.'); logout(); return; }
    toast('Fehler: ' + m);
  }
  var WDH = { taeglich: 'täglich', woechentlich: 'wöchentlich', monatlich: 'monatlich', jaehrlich: 'jährlich' };

  // ---------- Daten ----------
  async function loadAll() {
    var r = await Promise.all([
      sb.from('einnahmen').select('*'),
      sb.from('posten').select('*'),
      sb.from('posten_zahlungen').select('*'),
      sb.from('kontostaende').select('*').eq('konto', 'sascha').order('erfasst_am', { ascending: false }).limit(5),
      sb.from('aufgaben').select('*').order('faellig', { ascending: true, nullsFirst: false }),
      sb.from('kontostaende').select('*').eq('konto', 'luna').order('erfasst_am', { ascending: false }).limit(5)
    ]);
    for (var i = 0; i < r.length; i++) if (r[i].error) throw r[i].error;
    S.einnahmen = r[0].data; S.posten = r[1].data; S.zahlungen = r[2].data; S.aufgaben = r[4].data;
    S.staende = r[3].data.concat(r[5].data).sort(function (a, b) { return String(b.erfasst_am).localeCompare(String(a.erfasst_am)); });
    S.loaded = true;
    await loadEinkauf();
  }
  // Wocheneinkauf liegt in eigenen Tabellen. Fehlen sie (Datenbank-Update noch nicht eingespielt), bleibt der Rest der App voll nutzbar.
  async function loadEinkauf() {
    try {
      var since = L.iso(new Date(L.weekStart(todayD()).getTime() - 49 * 86400000));
      var r = await Promise.all([
        sb.from('einkauf_limits').select('*').order('name', { ascending: true }),
        sb.from('einkaeufe').select('*').gte('datum', since).order('datum', { ascending: false }).order('erfasst_am', { ascending: false })
      ]);
      if (r[0].error || r[1].error) throw (r[0].error || r[1].error);
      S.limits = r[0].data || []; S.kaeufe = r[1].data || []; S.einkaufFehler = false;
    } catch (e) {
      S.limits = []; S.kaeufe = []; S.einkaufFehler = true;
    }
    // Belege-Eingang ist eine eigene, spätere Migration: fehlt sie, bleibt alles andere nutzbar
    try {
      var g = await sb.from('beleg_eingang').select('*').order('erfasst_am', { ascending: true });
      S.eingangOk = !g.error; S.eingang = g.error ? [] : (g.data || []);
    } catch (e2) { S.eingang = []; S.eingangOk = false; }
  }
  async function reload() {
    try { await loadAll(); } catch (e) { fail(e); }
    render();
  }
  async function run(fn) {
    if (S.busy) return;
    S.busy = true;
    try { await fn(); } catch (e) { fail(e); }
    S.busy = false;
  }

  // ---------- Login ----------
  function renderLogin(msg) {
    $app.innerHTML =
      '<div class="login"><h1>Lebenscockpit</h1><p class="note">Melde dich mit deiner E-Mail-Adresse an.</p>' +
      '<form data-form="login"><label for="em">E-Mail</label><input id="em" type="email" autocomplete="username" inputmode="email" required>' +
      '<label for="pw">Passwort</label><input id="pw" type="password" autocomplete="current-password" required>' +
      '<div class="err" id="loginerr">' + esc(msg || '') + '</div>' +
      '<button class="primary" type="submit">Anmelden</button></form></div>';
  }
  async function doLogin(form) {
    var email = form.querySelector('#em').value.trim();
    var pw = form.querySelector('#pw').value;
    var err = form.querySelector('#loginerr');
    err.textContent = '';
    var r = await sb.auth.signInWithPassword({ email: email, password: pw });
    if (r.error) { err.textContent = 'E-Mail oder Passwort stimmt nicht.'; return; }
    S.user = r.data.user;
    $app.innerHTML = '<p class="boot">Lädt…</p>';
    await reload();
  }
  async function logout() {
    try { await sb.auth.signOut(); } catch (e) { /* egal */ }
    S.user = null; S.loaded = false; S.einnahmen = []; S.posten = []; S.zahlungen = []; S.staende = []; S.aufgaben = [];
    closeModal();
    renderLogin();
  }

  // ---------- Ansichten ----------
  var ICONS = {
    heute: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    geld: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1"/>',
    aufgaben: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
    mehr: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'
  };
  var LABELS = { heute: 'Heute', geld: 'Geld', aufgaben: 'Aufgaben', mehr: 'Mehr' };

  function nav() {
    return '<nav aria-label="Hauptnavigation">' + Object.keys(LABELS).map(function (k) {
      return '<button type="button" class="' + (S.tab === k ? 'on' : '') + '" aria-current="' + (S.tab === k ? 'page' : 'false') + '" data-action="tab" data-tab="' + k + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg>' + LABELS[k] + '</button>';
    }).join('') + '</nav>';
  }

  function render() {
    if (!S.user) return renderLogin();
    var body = '';
    if (!S.loaded) body = '<p class="boot">Lädt…</p>';
    else if (!S.posten.length && !S.einnahmen.length) {
      body = '<div class="card"><b>Keine Daten sichtbar.</b><p class="note">Entweder ist die Datenbank leer oder diese E-Mail-Adresse ist nicht freigegeben.</p><button data-action="logout">Abmelden</button></div>';
    } else if (S.tab === 'heute') body = viewHeute();
    else if (S.tab === 'geld') body = viewGeld();
    else if (S.tab === 'aufgaben') body = viewAufgaben();
    else body = viewMehr();
    $app.innerHTML = body + nav();
  }

  function fold(key, title, body, openByDefault) {
    var open = key in S.folds ? S.folds[key] : !!openByDefault;
    return '<details class="dash-fold" data-fold="' + key + '"' + (open ? ' open' : '') + '><summary>' + title + '</summary><div class="dash-fold-body">' + body + '</div></details>';
  }

  function head(title, sub) {
    return '<div class="head"><h1>' + esc(title) + '</h1><span class="sub">' + esc(sub || '') + '</span></div>';
  }

  function taskRow(a) {
    var t = todayD();
    var due = a.faellig ? L.parseISO(a.faellig) : null;
    var over = due && due < t;
    var bits = [];
    if (a.zustaendig) bits.push('<span class="who">' + esc(a.zustaendig) + '</span>');
    if (due) bits.push(over ? '<span class="overdue">' + esc(fmtD(due)) + '</span>' : esc(fmtD(due)));
    if (a.wiederholung) bits.push(esc(WDH[a.wiederholung] || ''));
    return '<div class="row task' + (a.erledigt ? ' paid' : '') + '">' +
      '<input class="chk" type="checkbox" data-action="aufgabe-done" data-id="' + esc(a.id) + '"' + (a.erledigt ? ' checked' : '') + ' aria-label="erledigt">' +
      '<div class="main" data-action="aufgabe-edit" data-id="' + esc(a.id) + '"><div class="t">' + esc(a.titel) + '</div><div class="s">' + bits.join(' · ') + '</div></div></div>';
  }

  function restbudget(lage) {
    if (!lage.stand || !lage.next) return '';
    var konto = Number(lage.stand.betrag);
    var luna = lage.luna ? Number(lage.luna.betrag) : null;
    var offen = lage.offen + lage.nachStand;
    var rest = lage.verfuegbar;
    var combined = lage.gesamt;
    var h = '<section class="card restbudget" aria-label="Verbleibendes Geld bis zum nächsten Gehalt">' +
      '<h2>Was bleibt bis zum Gehalt?</h2>' +
      '<p class="note">Rechnerischer Spielraum bis ' + esc(fmtD(lage.next.date)) + ' – inklusive Dispo, kein reines Guthaben.</p>' +
      '<div class="restbudget-total"><span>Gemeinsam verbleibend</span><strong>' +
      (combined == null ? 'Lunas Stand fehlt' : eur(combined)) + '</strong></div>' +
      '<div class="restbudget-line"><span>Saschas Kontostand</span><b>' + eur(konto) + '</b></div>' +
      '<div class="restbudget-line"><span>Verfügbarer Disporahmen insgesamt</span><b>' + eur(DISPO) + '</b></div>' +
      '<div class="restbudget-line"><span>Noch abzuziehende Zahlungen</span><b>− ' + eur(offen) + '</b></div>' +
      '<div class="restbudget-line"><span>Spielraum Sascha</span><b>' + eur(rest) + '</b></div>' +
      '<div class="restbudget-line"><span>Lunas Kontostand</span><b>' + (luna == null ? 'Nicht erfasst' : eur(luna)) + '</b></div>' +
      '<p class="note">Ohne zusätzliche Einkäufe und nicht erfasste Kosten. Bargeldzahlungen sind in dieser Kontorechnung nicht berücksichtigt.</p>' +
      '</section>';
    return h;
  }

  function cardList(rows, emptyTxt) {
    return '<div class="card flat">' + (rows.length ? rows.join('') : '<div class="empty">' + emptyTxt + '</div>') + '</div>';
  }

  function viewHeute() {
    var t = todayD();
    var lage = L.calcLage(S, t, DISPO);
    var h = head('Heute', fmtLong(t));

    if (!lage.next) {
      h += '<div class="card">Es ist kein Gehalt eingetragen.</div>';
    } else if (!lage.stand) {
      h += '<div class="hero neutral"><div class="lbl">Noch kein Kontostand</div><div class="big">?</div><div class="sm">Trag deinen aktuellen Kontostand ein, dann rechnet die App.</div></div>';
    } else {
      var minus = lage.luecke != null;
      h += '<div class="hero' + (minus ? ' bad' : '') + '"><div class="lbl">Saschas ' + (minus ? 'Fehlbetrag' : 'Spielraum') + ' bis ' + esc(fmtD(lage.next.date)) + '</div>' +
        '<div class="big">' + eur(minus ? -lage.luecke : lage.verfuegbar) + '</div>' +
        '<div class="sm">Gemeinsam mit Luna: <b class="' + (lage.gesamt == null ? '' : lage.gesamt >= 0 ? 'money-positive' : 'money-negative') + '">' + (lage.gesamt == null ? 'Lunas Stand fehlt' : eur(lage.gesamt)) + '</b><br>Rechnerisch inklusive Dispo, noch nicht alle Verpflichtungen erfasst.</div></div>';
    }
    h += '<button class="primary" data-action="abgleich">Kontostand aktualisieren</button>';
    h += einkaufCard(t);

    if (lage.stand) {
      var age = L.daysBetween(new Date(lage.stand.erfasst_am), t);
      var ageTxt = age <= 0 ? 'heute' : age === 1 ? 'gestern' : 'vor ' + age + ' Tagen';
      var info = '<div class="grid2"><div class="stat"><div class="k">Kontostand</div><div class="v">' + eur(Number(lage.stand.betrag)) + '</div><div class="n">Stand ' + ageTxt + '</div></div>' +
        '<div class="stat"><div class="k">Offen bis Gehalt</div><div class="v">' + eur(lage.offen + lage.nachStand) + '</div><div class="n">' + lage.offenListe.length + ' Zahlungen</div></div></div>';
      if (Number(lage.stand.betrag) < 0) info += '<div class="warn">Dispo genutzt: ' + eur(-Number(lage.stand.betrag)) + ' von ' + eur0(DISPO) + ', noch frei: ' + eur(Math.max(0, lage.spielraum)) + '.</div>';
      if (age >= 7) info += '<div class="warn">Der Kontostand ist ' + age + ' Tage alt. Die Zahlen stimmen nur, wenn er aktuell ist.</div>';
      var overdue = lage.offenListe.filter(function (it) { return it.date && it.date < t; });
      if (overdue.length) info += '<div class="warn">' + overdue.length + (overdue.length === 1 ? ' Zahlung mit vergangenem Termin ist' : ' Zahlungen mit vergangenem Termin sind') + ' noch nicht abgehakt. Beim Aktualisieren des Kontostands bestätigst du, was schon abgebucht wurde.</div>';
      h += fold('stand', 'Kontostand und Hinweise', info, true);
      h += fold('rest', 'Restbudget im Detail', restbudget(lage), false);
    }

    var open = S.aufgaben.filter(function (a) { return !a.erledigt; });
    var todayTasks = open.filter(function (a) { return a.faellig && L.parseISO(a.faellig) <= t; });
    var futureTasks = open.filter(function (a) { return a.faellig && L.parseISO(a.faellig) > t; }).sort(function (a, b) { return a.faellig.localeCompare(b.faellig); });
    var undatedTasks = open.filter(function (a) { return !a.faellig; });
    h += fold('heute', 'Aufgaben heute und überfällig <span class="count">' + todayTasks.length + '</span>', cardList(todayTasks.map(taskRow), 'Nichts fällig.'), true);
    h += fold('spaeter', 'Zukünftige Aufgaben <span class="count">' + futureTasks.length + '</span>', cardList(futureTasks.map(taskRow), 'Keine zukünftigen Aufgaben.'));
    if (undatedTasks.length) h += fold('ohne', 'Aufgaben ohne Termin <span class="count">' + undatedTasks.length + '</span>', cardList(undatedTasks.map(taskRow), ''));

    var soon = lage.offenListe.filter(function (it) { return it.date && it.date >= t; });
    h += fold('zahlungen', 'Bald fällige Zahlungen <span class="count">' + soon.length + '</span>', cardList(soon.map(function (it) {
      return '<div class="row"><div class="main"><div class="t">' + esc(it.p.name) + '</div><div class="s">' + esc(fmtD(it.date)) + '</div></div><div class="amt">' + eur(it.betrag) + '</div></div>';
    }), 'Bis zum nächsten Gehalt ist nichts mit festem Termin offen.'));

    var klaeren = S.posten.filter(function (p) { return p.status === 'pruefen'; });
    if (klaeren.length) {
      h += fold('klaeren', 'Noch zu klären <span class="count">' + klaeren.length + '</span>', cardList(klaeren.map(function (p) {
        return '<div class="row"><div class="main" data-action="posten-edit" data-id="' + esc(p.id) + '"><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(p.notiz || 'Betrag oder Termin prüfen') + '</div></div><div class="amt">' + eur(Number(p.betrag)) + '</div></div>';
      }), ''));
    }
    return h;
  }

  function itemRow(it) {
    var p = it.p, t = todayD();
    var overdue = !it.paid && it.date && it.date < t && p.zahlung === 'konto';
    var when = it.date ? fmtD(it.date) : (p.tag_hinweis || 'Termin offen');
    var sub = [when, p.zahlung === 'bar' ? 'bar' : null, p.rhythmus === 'einmalig' ? 'einmalig' : null].filter(Boolean).join(' · ');
    return '<div class="row' + (it.paid ? ' paid' : '') + '">' +
      '<input class="chk" type="checkbox" data-action="toggle-paid" data-id="' + esc(p.id) + '"' + (it.paid ? ' checked' : '') + ' aria-label="bezahlt">' +
      '<div class="main" data-action="posten-edit" data-id="' + esc(p.id) + '"><div class="t">' + esc(p.name) +
      (p.status === 'pruefen' ? '<span class="badge">klären</span>' : '') + (overdue ? '<span class="badge red">abgebucht?</span>' : '') +
      '</div><div class="s">' + esc(sub) + '</div></div><div class="amt">' + eur(it.betrag) + '</div></div>';
  }

  function viewGeld() {
    var t = todayD();
    var cs = L.periodStart(t);
    var m = L.monatSummary(S, cs, t);
    var h = head('Geld', 'Finanzmonat ' + fmtD(m.start) + ' bis ' + fmtD(m.end));
    h += restbudget(L.calcLage(S, t, DISPO));

    var einnTxt = m.einnahmenListe.map(function (x) { return esc(x.e.person) + ' ' + eur0(Number(x.e.betrag)); }).join(', ');
    h += '<div class="card"><div class="restbudget-line"><span>Einnahmen</span><b>' + eur(m.einnahmen) + '</b></div>' +
      (einnTxt ? '<p class="sub-note">' + einnTxt + '</p>' : '') +
      '<div class="restbudget-line"><span>Feste Zahlungen</span><b>' + eur(m.fixkosten) + '</b></div>' +
      (m.bar ? '<p class="sub-note">davon bar reserviert ' + eur(m.bar) + '</p>' : '') +
      '<div class="restbudget-line total"><span>Bleibt für Alltag, Klarna, Kreditkarte, Dispozinsen</span><b class="' + (m.rest < 0 ? 'money-negative' : 'money-positive') + '">' + eur(m.rest) + '</b></div></div>';

    h += '<button data-action="posten-neu">Zahlung hinzufügen</button><p class="note">Klarna und Kreditkarte trägst du als einzelne Zahlung mit Datum ein.</p>';

    var offen = m.items.filter(function (i) { return !i.paid; });
    var bezahlt = m.items.filter(function (i) { return i.paid; });
    h += '<h2>Offen (' + offen.length + ')</h2><div class="card">' + (offen.length ? offen.map(itemRow).join('') : '<div class="empty">Alles bezahlt.</div>') + '</div>';
    h += '<h2>Bezahlt (' + bezahlt.length + ')</h2><div class="card">' + (bezahlt.length ? bezahlt.map(itemRow).join('') : '<div class="empty">Noch nichts abgehakt.</div>') + '</div>';

    var v = L.vorschau(S, t, 6);
    h += '<h2>Vorschau der nächsten Monate</h2><div class="card"><table><tr><th>Bis</th><th>Einnahmen</th><th>Feste Zahlungen</th><th>Rest</th></tr>' +
      v.map(function (x, i) {
        var step = i > 0 && Math.abs(x.fixkosten - v[i - 1].fixkosten) > 0.5;
        return '<tr class="' + (i === 0 ? 'now ' : '') + (step ? 'step' : '') + '"><td>' + esc(fmtD(x.end)) + '</td><td>' + eur0(x.einnahmen) + '</td><td>' + eur0(x.fixkosten) + '</td><td>' + eur0(x.rest) + '</td></tr>';
      }).join('') + '</table><p class="note">Rot markiert: Hier ändern sich die festen Zahlungen, zum Beispiel durch eine neue Rate.</p></div>';
    return h;
  }

  function viewAufgaben() {
    var t = todayD();
    var open = S.aufgaben.filter(function (a) { return !a.erledigt; });
    var due = function (a) { return a.faellig ? L.parseISO(a.faellig) : null; };
    var groups = [
      ['Überfällig', open.filter(function (a) { return due(a) && due(a) < t; })],
      ['Heute', open.filter(function (a) { return due(a) && L.daysBetween(t, due(a)) === 0; })],
      ['Später', open.filter(function (a) { return due(a) && due(a) > t; })],
      ['Ohne Datum', open.filter(function (a) { return !a.faellig; })]
    ];
    var h = head('Aufgaben', open.length + ' offen') + '<button class="primary" data-action="aufgabe-neu">Aufgabe hinzufügen</button>';
    var any = false;
    groups.forEach(function (g) {
      if (!g[1].length) return;
      any = true;
      h += '<h2>' + g[0] + '</h2><div class="card">' + g[1].map(taskRow).join('') + '</div>';
    });
    if (!any) h += '<div class="card"><div class="empty">Keine offenen Aufgaben.</div></div>';
    var done = S.aufgaben.filter(function (a) { return a.erledigt; }).sort(function (a, b) { return String(b.erledigt_am).localeCompare(String(a.erledigt_am)); }).slice(0, 15);
    if (done.length) {
      h += '<h2>Erledigt (' + done.length + ')</h2><button type="button" class="small" data-action="toggle-done">' + (S.showDone ? 'Ausblenden' : 'Anzeigen') + '</button>';
      if (S.showDone) h += '<div class="card">' + done.map(taskRow).join('') + '</div>';
    }
    return h;
  }

  function viewMehr() {
    return head('Mehr', 'Version ' + VERSION) +
      '<div class="card"><div class="row"><div class="main"><div class="t">Angemeldet als</div><div class="s">' + esc(S.user.email) + '</div></div></div></div>' +
      '<button data-action="limits">Wochenlimits verwalten</button><div class="gap"></div>' +
      '<button data-action="refresh">Daten neu laden</button><div class="gap"></div>' +
      '<button data-action="backup">Backup herunterladen</button><p class="note">Das Backup enthält alle Zahlen im Klartext, aber keine Beleg-Fotos. Bewahre die Datei sicher auf und mach es am besten einmal pro Woche.</p>' +
      '<button class="danger" data-action="logout">Abmelden</button>';
  }

  // ---------- Fenster ----------
  function openModal(html) { $modal.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>'; }
  function closeModal() { $modal.innerHTML = ''; }

  // Stabile UUID je Abgleich: einmal beim Öffnen des Fensters erzeugt, bei Wiederholung (Doppeltipp, Netzfehler) unverändert.
  function newRequestId() {
    var c = window.crypto || window.msCrypto;
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b); else for (var k = 0; k < 16; k++) b[k] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function modalAbgleich() {
    S.abgleichId = newRequestId();
    var t = todayD(), cs = L.periodStart(t);
    var items = L.itemsForPeriod(S, cs, t).filter(function (i) { return !i.paid && i.p.zahlung === 'konto'; });
    var past = items.filter(function (i) { return i.date && i.date <= t; });
    var undated = items.filter(function (i) { return !i.date; });
    var rows = past.map(function (i) { return abRow(i, true); }).join('') + undated.map(function (i) { return abRow(i, false); }).join('');
    var last = S.staende[0];
    openModal('<h1>Kontostand aktualisieren</h1><form data-form="abgleich">' +
      '<label for="ab-konto">Welches Konto?</label><select id="ab-konto"><option value="sascha">Saschas Konto</option><option value="luna">Lunas Konto</option></select>' +
      '<label for="ab-betrag">Aktueller Kontostand in Euro</label><input id="ab-betrag" inputmode="decimal" autocomplete="off" placeholder="zum Beispiel 1840,50" required>' +
      '<label class="inline"><input type="checkbox" id="ab-minus"> Das Konto ist im Minus (Dispo)</label>' +
      '<div id="ab-posten"><h2>Was ist seit dem letzten Stand abgebucht?</h2><p class="note">Ein Haken bedeutet: Der Betrag ist schon vom Konto weg und steckt im Kontostand. Ohne Haken bleibt die Zahlung offen und wird noch abgezogen.</p>' +
      '<div class="card">' + (rows || '<div class="empty">Nichts zu bestätigen.</div>') + '</div></div>' +
      '<div class="err" id="ab-err"></div><div class="actions"><button type="button" data-action="close-modal">Abbrechen</button><button class="primary" type="submit">Speichern</button></div></form>');
    var kSel = document.getElementById('ab-konto');
    if (kSel && kSel.addEventListener) kSel.addEventListener('change', function (e) { document.getElementById('ab-posten').style.display = e.target.value === 'luna' ? 'none' : ''; });
    setTimeout(function () { var el = document.getElementById('ab-betrag'); if (el) el.focus(); }, 50);
  }
  function abRow(i, checked) {
    return '<label class="row abrow"><input class="chk" type="checkbox" name="pay" value="' + esc(i.p.id) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="main"><span class="t">' + esc(i.p.name) + '</span><span class="s">' + (i.date ? esc(fmtD(i.date)) : 'Termin offen') + '</span></span><span class="amt">' + eur(i.betrag) + '</span></label>';
  }
  async function saveAbgleich(form) {
    var err = form.querySelector('#ab-err');
    err.textContent = '';
    var n = L.parseBetrag(form.querySelector('#ab-betrag').value);
    if (!isFinite(n)) { err.textContent = 'Bitte gib den Kontostand als Zahl ein.'; return; }
    if (form.querySelector('#ab-minus').checked) n = -Math.abs(n);
    var ts = new Date().toISOString();
    var t = todayD(), cs = L.periodStart(t);
    var konto = form.querySelector('#ab-konto').value;
    var ids = konto === 'luna' ? [] : Array.prototype.map.call(form.querySelectorAll('input[name=pay]:checked'), function (x) { return x.value; });
    var rows = ids.map(function (id) {
      var p = S.posten.find(function (x) { return x.id === id; });
      if (!p) throw new Error('Zahlung nicht mehr vorhanden: ' + id);
      return { posten_id: id, finanzmonat: L.iso(cs), betrag: Number(p.betrag), bezahlt_am: L.iso(t), erfasst_am: ts };
    });
    var r = await sb.rpc('save_account_reconciliation', {
      p_betrag: n, p_erfasst_am: ts, p_erfasst_von: S.user.email,
      p_konto: konto, p_zahlungen: rows, p_request_id: S.abgleichId || (S.abgleichId = newRequestId())
    });
    if (r.error) throw r.error;
    S.abgleichId = null;
    closeModal();
    await loadAll();
    render();
    toast('Kontostand gespeichert');
  }

  function modalPosten(id) {
    var p = S.posten.find(function (x) { return x.id === id; });
    if (!p) return;
    openModal('<h1>' + esc(p.name) + '</h1><form data-form="posten-edit" data-id="' + esc(p.id) + '">' +
      '<label for="pe-b">Betrag in Euro</label><input id="pe-b" inputmode="decimal" value="' + esc(String(p.betrag).replace('.', ',')) + '" required>' +
      (p.rhythmus === 'monatlich' ? '<label for="pe-t">Tag im Monat (leer lassen, wenn unbekannt)</label><input id="pe-t" type="number" inputmode="numeric" min="1" max="31" value="' + esc(p.tag_im_monat == null ? '' : p.tag_im_monat) + '">' : '') +
      '<label for="pe-s">Status</label><select id="pe-s"><option value="sicher"' + (p.status === 'sicher' ? ' selected' : '') + '>Sicher</option><option value="pruefen"' + (p.status === 'pruefen' ? ' selected' : '') + '>Noch klären</option></select>' +
      '<label for="pe-n">Notiz</label><input id="pe-n" value="' + esc(p.notiz || '') + '">' +
      '<div class="err" id="pe-err"></div><div class="actions"><button type="button" data-action="close-modal">Abbrechen</button><button class="primary" type="submit">Speichern</button></div></form>' +
      '<div class="gap"></div>' +
      (p.rhythmus === 'einmalig' ? '<button class="danger" data-action="posten-delete" data-id="' + esc(p.id) + '">Zahlung löschen</button>' : '<button class="danger" data-action="posten-end" data-id="' + esc(p.id) + '">Posten beenden</button><p class="note">Beenden bedeutet: Ab heute zählt dieser Posten nicht mehr. Bisherige Zahlungen bleiben erhalten.</p>'));
  }
  async function savePosten(form) {
    var id = form.dataset.id;
    var err = form.querySelector('#pe-err');
    var b = L.parseBetrag(form.querySelector('#pe-b').value);
    if (!isFinite(b) || b < 0) { err.textContent = 'Bitte gib einen Betrag als Zahl ein.'; return; }
    var upd = { betrag: b, status: form.querySelector('#pe-s').value, notiz: form.querySelector('#pe-n').value.trim() || null };
    var tEl = form.querySelector('#pe-t');
    if (tEl) {
      var tv = tEl.value.trim();
      if (tv === '') { upd.tag_im_monat = null; }
      else {
        var tn = Number(tv);
        if (!(tn >= 1 && tn <= 31)) { err.textContent = 'Der Tag muss zwischen 1 und 31 liegen.'; return; }
        upd.tag_im_monat = Math.round(tn); upd.tag_hinweis = null;
      }
    }
    var r = await sb.from('posten').update(upd).eq('id', id);
    if (r.error) throw r.error;
    closeModal(); await loadAll(); render(); toast('Gespeichert');
  }

  function modalPostenNeu() {
    openModal('<h1>Zahlung hinzufügen</h1><form data-form="posten-neu">' +
      '<label for="pn-n">Wofür</label><input id="pn-n" placeholder="zum Beispiel Klarna Zahlung" required>' +
      '<label for="pn-b">Betrag in Euro</label><input id="pn-b" inputmode="decimal" required>' +
      '<label for="pn-d">Fällig am</label><input id="pn-d" type="date" required>' +
      '<label for="pn-z">Wird bezahlt</label><select id="pn-z"><option value="konto">vom Konto</option><option value="bar">bar</option></select>' +
      '<div class="err" id="pn-err"></div><div class="actions"><button type="button" data-action="close-modal">Abbrechen</button><button class="primary" type="submit">Hinzufügen</button></div></form>');
  }
  async function savePostenNeu(form) {
    var err = form.querySelector('#pn-err');
    var name = form.querySelector('#pn-n').value.trim();
    var b = L.parseBetrag(form.querySelector('#pn-b').value);
    var d = form.querySelector('#pn-d').value;
    if (!name || !isFinite(b) || b <= 0 || !d) { err.textContent = 'Bitte fülle alle Felder aus. Der Betrag muss größer als null sein.'; return; }
    var r = await sb.from('posten').insert({ name: name, betrag: b, rhythmus: 'einmalig', faellig_am: d, zahlung: form.querySelector('#pn-z').value, kategorie: 'sonstiges', status: 'sicher' });
    if (r.error) throw r.error;
    closeModal(); await loadAll(); render(); toast('Hinzugefügt');
  }

  function modalAufgabe(id) {
    var a = id ? S.aufgaben.find(function (x) { return x.id === id; }) : null;
    var opt = function (v, label, cur) { return '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + label + '</option>'; };
    openModal('<h1>' + (a ? 'Aufgabe bearbeiten' : 'Neue Aufgabe') + '</h1><form data-form="aufgabe" data-id="' + esc(a ? a.id : '') + '">' +
      '<label for="au-t">Was ist zu tun</label><input id="au-t" value="' + esc(a ? a.titel : '') + '" required>' +
      '<label for="au-z">Wer</label><select id="au-z">' + opt('beide', 'Beide', a ? a.zustaendig : 'beide') + opt('Sascha', 'Sascha', a && a.zustaendig) + opt('Luna', 'Luna', a && a.zustaendig) + '</select>' +
      '<label for="au-f">Fällig am (optional)</label><input id="au-f" type="date" value="' + esc(a && a.faellig ? a.faellig : '') + '">' +
      '<label for="au-w">Wiederholung</label><select id="au-w">' + opt('', 'Keine', a ? a.wiederholung || '' : '') + opt('taeglich', 'Täglich', a && a.wiederholung) + opt('woechentlich', 'Wöchentlich', a && a.wiederholung) + opt('monatlich', 'Monatlich', a && a.wiederholung) + opt('jaehrlich', 'Jährlich', a && a.wiederholung) + '</select>' +
      '<div class="err" id="au-err"></div><div class="actions"><button type="button" data-action="close-modal">Abbrechen</button><button class="primary" type="submit">Speichern</button></div></form>' +
      (a ? '<div class="gap"></div><button class="danger" data-action="aufgabe-delete" data-id="' + esc(a.id) + '">Aufgabe löschen</button>' : ''));
    setTimeout(function () { var el = document.getElementById('au-t'); if (el && !a) el.focus(); }, 50);
  }
  async function saveAufgabe(form) {
    var err = form.querySelector('#au-err');
    var titel = form.querySelector('#au-t').value.trim();
    if (!titel) { err.textContent = 'Bitte gib einen Titel ein.'; return; }
    var f = form.querySelector('#au-f').value || null;
    var w = form.querySelector('#au-w').value || null;
    if (w && !f) f = L.iso(todayD());
    var row = { titel: titel, zustaendig: form.querySelector('#au-z').value, faellig: f, wiederholung: w };
    var id = form.dataset.id;
    var r = id ? await sb.from('aufgaben').update(row).eq('id', id) : await sb.from('aufgaben').insert(row);
    if (r.error) throw r.error;
    closeModal(); await loadAll(); render(); toast('Gespeichert');
  }

  // ---------- Aktionen ----------
  async function togglePaid(id, checked) {
    var t = todayD(), cs = L.periodStart(t);
    var p = S.posten.find(function (x) { return x.id === id; });
    if (!p) return;
    if (checked) {
      var r = await sb.from('posten_zahlungen').upsert({ posten_id: id, finanzmonat: L.iso(cs), betrag: Number(p.betrag), bezahlt_am: L.iso(t) }, { onConflict: 'posten_id,finanzmonat' });
      if (r.error) throw r.error;
    } else {
      var r2 = await sb.from('posten_zahlungen').delete().eq('posten_id', id).eq('finanzmonat', L.iso(cs));
      if (r2.error) throw r2.error;
    }
    await loadAll(); render();
  }
  // Recurring task transitions are executed atomically by the database.
  // The RPC links each successor to its exact predecessor, never by title.
  async function aufgabeDone(id, checked) {
    var r = await sb.rpc('set_task_completion', { p_task_id: id, p_done: checked });
    if (r.error) throw r.error;
    await loadAll(); render();
  }
  async function backup() {
    var r = await Promise.all([
      sb.from('einnahmen').select('*'), sb.from('posten').select('*'), sb.from('posten_zahlungen').select('*'),
      sb.from('kontostaende').select('*').order('erfasst_am', { ascending: false }), sb.from('aufgaben').select('*')
    ]);
    for (var i = 0; i < r.length; i++) if (r[i].error) throw r[i].error;
    var data = { exportiert_am: new Date().toISOString(), einnahmen: r[0].data, posten: r[1].data, posten_zahlungen: r[2].data, kontostaende: r[3].data, aufgaben: r[4].data };
    var e1 = await sb.from('einkauf_limits').select('*'), e2 = await sb.from('einkaeufe').select('*');
    data.einkauf_limits = e1.error ? null : e1.data; data.einkaeufe = e2.error ? null : e2.data;
    var e3 = await sb.from('beleg_eingang').select('*'); data.beleg_eingang = e3.error ? null : e3.data;
    var name = 'lebenscockpit-backup-' + L.iso(todayD()) + '.json';
    var file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    var url = URL.createObjectURL(file);
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // ---------- Wocheneinkauf ----------
  function meter(pct, over, label) {
    var cls = over ? ' is-over' : pct >= 80 ? ' is-near' : '';
    return '<div class="meter' + cls + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Number(pct) + '" aria-label="' + esc(label) + '"><span style="width:' + Number(pct) + '%"></span></div>';
  }
  function eingangBtn() {
    if (!S.eingangOk) return '';
    var n = S.eingang.length;
    return '<button data-action="eingang">' + (n ? 'Belege zuordnen <span class="count">' + n + '</span>' : 'Beleg-Fotos hinzufügen') + '</button>';
  }
  function einkaufCard(t) {
    if (S.einkaufFehler) return '<section class="card" aria-label="Wocheneinkauf"><h2>Wocheneinkauf</h2><p class="note">Noch nicht eingerichtet. Das Datenbank-Update fehlt, die übrige App funktioniert normal.</p></section>';
    var st = L.einkaufStatus(S.limits, S.kaeufe, t);
    var head = '<h2>Wocheneinkauf</h2><p class="note">' + esc(fmtD(st.start)) + ' bis ' + esc(fmtD(st.end)) + ', noch ' + st.daysLeft + (st.daysLeft === 1 ? ' Tag' : ' Tage') + '</p>';
    if (!st.rows.length) {
      return '<section class="card" aria-label="Wocheneinkauf">' + head.replace(/<p class="note">.*<\/p>/, '') +
        '<p class="note">Lege ein Wochenlimit an, zum Beispiel „Lebensmittel“ mit 80 Euro. Jeder erfasste Einkauf wird davon abgezogen, optional mit Foto vom Kassenzettel.</p>' +
        '<button class="primary" data-action="limit-neu">Wochenlimit anlegen</button>' + eingangBtn() + '</section>';
    }
    var tot = st.total;
    var h = '<section class="card einkauf" aria-label="Wocheneinkauf">' + head +
      '<div class="restbudget-total"><span>Diese Woche noch übrig</span><strong class="' + (tot.over ? 'money-negative' : 'money-positive') + '">' + eur(tot.rest) + '</strong>' +
      '<span>' + eur(tot.spent) + ' von ' + eur(tot.limit) + ' ausgegeben</span></div>';
    st.rows.forEach(function (r) {
      h += '<div class="limit-row"><div class="limit-top"><b>' + esc(r.limit.name) + '</b><span class="' + (r.over ? 'money-negative' : '') + '">' + eur(r.spent) + ' / ' + eur(r.limitBetrag) + '</span></div>' +
        meter(r.pct, r.over, r.limit.name + ': ' + r.pct + ' Prozent des Wochenlimits verbraucht') +
        '<div class="limit-sub ' + (r.over ? 'overdue' : '') + '">' + (r.over ? eur(-r.rest) + ' über dem Limit' : 'noch ' + eur(r.rest) + (r.proTag > 0 && st.daysLeft > 1 ? ' · rund ' + eur(r.proTag) + ' pro Tag' : '')) + '</div></div>';
    });
    h += '<button class="primary" data-action="einkauf-neu">Einkauf erfassen</button>' +
      eingangBtn() + '<button data-action="einkauf-import">Aus ChatGPT einfügen</button><div class="grid2 tight"><button data-action="einkauf-liste">Einkäufe und Belege</button><button data-action="limits">Limits ändern</button></div></section>';
    return h;
  }

  function aktiveLimits() { return S.limits.filter(function (l) { return l.aktiv; }); }
  function limitName(id) { var l = S.limits.find(function (x) { return x.id === id; }); return l ? l.name : 'Unbekanntes Limit'; }
  function validISO(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var d = L.parseISO(v);
    return L.iso(d) === v;
  }

  function modalEinkauf(id) {
    var e = id ? S.kaeufe.find(function (x) { return x.id === id; }) : null;
    if (id && !e) return;
    var limits = e ? S.limits : aktiveLimits();
    if (!limits.length) { modalLimit(null); return; }
    S.einkaufId = e ? e.id : newRequestId();   // stabile ID: Wiederholung nach Netzfehler legt keinen zweiten Einkauf an
    var sel = e ? e.limit_id : limits[0].id;
    var opts = limits.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === sel ? ' selected' : '') + '>' + esc(l.name) + (l.aktiv ? '' : ' (beendet)') + '</option>'; }).join('');
    openModal('<h1>' + (e ? 'Einkauf bearbeiten' : 'Einkauf erfassen') + '</h1><form data-form="einkauf" data-id="' + esc(e ? e.id : '') + '">' +
      '<label for="ek-limit">Limit</label><select id="ek-limit">' + opts + '</select>' +
      '<label for="ek-betrag">Betrag in Euro</label><input id="ek-betrag" inputmode="decimal" autocomplete="off" placeholder="zum Beispiel 23,45" value="' + esc(e ? String(e.betrag).replace('.', ',') : '') + '" required>' +
      '<label for="ek-datum">Datum</label><input id="ek-datum" type="date" value="' + esc(e ? String(e.datum).slice(0, 10) : L.iso(todayD())) + '" required>' +
      '<label for="ek-notiz">Notiz (optional)</label><input id="ek-notiz" maxlength="200" placeholder="zum Beispiel Rewe" value="' + esc(e ? e.notiz || '' : '') + '">' +
      (e ? '<p class="note">' + (e.beleg_pfad ? 'Ein Foto ist gespeichert und bleibt erhalten.' : 'Fotos lassen sich nur beim Erfassen hinzufügen.') + '</p>' :
        '<label for="ek-foto">Bild vom Einkaufszettel oder Kassenbon hochladen (optional)</label><input id="ek-foto" type="file" accept="image/*" data-action="foto-gewaehlt"><div class="note" id="ek-fotoinfo">Kamera, Mediathek oder Screenshot (JPG, PNG, HEIC, WebP). Das Bild wird verkleinert und privat gespeichert. Achte darauf, dass keine Kartendaten sichtbar sind.</div>') +
      '<div class="err" id="ek-err"></div><div class="actions"><button type="button" data-action="close-modal">Abbrechen</button><button class="primary" type="submit">Speichern</button></div></form>');
    setTimeout(function () { var el = document.getElementById('ek-betrag'); if (el) el.focus(); }, 50);
  }

  // Foto verkleinern und als JPEG neu kodieren: spart Speicher, entfernt EXIF/GPS-Daten, und die Datenbank erlaubt nur JPEG.
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var max = 1600, w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) throw new Error('leer');
          var k = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          var g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // PNG/WebP mit Transparenz sonst schwarz im JPEG
          g.drawImage(img, 0, 0, c.width, c.height);
          var q = 0.78;
          (function enc() {
            c.toBlob(function (b) {
              if (!b) { reject(new Error('Kodierung fehlgeschlagen')); return; }
              if (b.size > 2800000 && q > 0.4) { q -= 0.2; enc(); return; }
              URL.revokeObjectURL(url); resolve(b);
            }, 'image/jpeg', q);
          })();
        } catch (err) { URL.revokeObjectURL(url); reject(err); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Das Foto konnte nicht gelesen werden. Versuche ein anderes Foto oder lass es weg.')); };
      img.src = url;
    });
  }

  // Gemeinsame Eingabeprüfung (Einkauf erfassen und Beleg zuordnen)
  function pruefeEinkauf(betragTxt, datumTxt, limitId) {
    var b = L.parseBetrag(betragTxt);
    if (!isFinite(b) || b <= 0) return { error: 'Bitte gib einen Betrag größer als 0 ein.' };
    if (b > 100000) return { error: 'Der Betrag ist zu groß.' };
    if (!validISO(datumTxt)) return { error: 'Bitte gib ein gültiges Datum an.' };
    var t = todayD(), dd = L.parseISO(datumTxt);
    if (L.daysBetween(dd, t) > 365 || L.daysBetween(t, dd) > 7) return { error: 'Das Datum liegt zu weit in der Vergangenheit oder Zukunft.' };
    if (!S.limits.some(function (l) { return l.id === limitId; })) return { error: 'Bitte wähle ein Limit.' };
    return { betrag: L.round2(b), datum: datumTxt, limitId: limitId };
  }
  async function saveEinkauf(form) {
    var err = form.querySelector('#ek-err');
    err.textContent = '';
    var editId = form.dataset.id || '';
    var chk = pruefeEinkauf(form.querySelector('#ek-betrag').value, form.querySelector('#ek-datum').value, form.querySelector('#ek-limit').value);
    if (chk.error) { err.textContent = chk.error; return; }
    var b = chk.betrag, d = chk.datum, limitId = chk.limitId;
    var row = { limit_id: limitId, datum: d, betrag: b, notiz: form.querySelector('#ek-notiz').value.trim() || null };
    if (editId) {
      var u = await sb.from('einkaeufe').update(row).eq('id', editId);
      if (u.error) throw u.error;
      closeModal(); await loadAll(); render(); toast('Gespeichert');
      return;
    }
    var fEl = form.querySelector('#ek-foto');
    var file = fEl && fEl.files && fEl.files[0];
    row.id = S.einkaufId;
    var path = null;
    if (file) {
      var blob;
      try { blob = await shrinkImage(file); } catch (e1) { err.textContent = e1.message || 'Das Foto konnte nicht verarbeitet werden.'; return; }
      path = row.id + '.jpg';
      var up = await sb.storage.from('belege').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      // "existiert schon" heißt: derselbe Versuch wurde bereits hochgeladen (Wiederholung), das ist in Ordnung
      if (up.error && !/already exists|duplicate|409/i.test(String(up.error.message || '') + String(up.error.statusCode || ''))) {
        err.textContent = 'Das Foto konnte nicht gespeichert werden. Versuche es erneut oder speichere den Einkauf ohne Foto.';
        return;
      }
      row.beleg_pfad = path;
    }
    var r = await sb.from('einkaeufe').upsert(row, { onConflict: 'id', ignoreDuplicates: true });
    if (r.error) {
      if (path) { try { await sb.storage.from('belege').remove([path]); } catch (e2) { /* verwaiste Datei ist harmlos, nur Speicherplatz */ } }
      throw r.error;
    }
    S.einkaufId = null;
    closeModal(); await loadAll(); render(); toast('Einkauf gespeichert');
  }

  function modalEinkaeufe() {
    var rows = S.kaeufe.slice(0, 60).map(function (k) {
      return '<div class="row"><div class="main" data-action="einkauf-edit" data-id="' + esc(k.id) + '"><div class="t">' + esc(limitName(k.limit_id)) + (k.notiz ? ' · ' + esc(k.notiz) : '') + '</div>' +
        '<div class="s">' + esc(fmtD(L.parseISO(k.datum))) + (k.beleg_pfad ? ' · Foto vorhanden' : '') + '</div></div>' +
        '<div class="amt">' + eur(Number(k.betrag)) + '</div>' +
        (k.beleg_pfad ? '<button class="mini" data-action="beleg" data-id="' + esc(k.id) + '" aria-label="Foto ansehen">Foto</button>' : '') +
        '</div>';
    }).join('');
    openModal('<h1>Einkäufe</h1><p class="note">Die letzten 7 Wochen. Zum Ändern tippen.</p><div class="card flat">' + (rows || '<div class="empty">Noch keine Einkäufe erfasst.</div>') + '</div>' +
      '<div class="actions"><button type="button" data-action="close-modal">Schließen</button><button class="primary" data-action="einkauf-neu">Einkauf erfassen</button></div>');
  }
  async function showBeleg(id) {
    var k = S.kaeufe.find(function (x) { return x.id === id; });
    if (!k || !k.beleg_pfad) return;
    var r = await sb.storage.from('belege').createSignedUrl(k.beleg_pfad, 120);
    if (r.error || !r.data || !r.data.signedUrl) throw new Error('Das Foto konnte nicht geladen werden.');
    openModal('<h1>Beleg</h1><p class="note">' + esc(limitName(k.limit_id)) + ' · ' + esc(fmtD(L.parseISO(k.datum))) + ' · ' + eur(Number(k.betrag)) + '</p>' +
      '<img class="beleg" alt="Foto vom Einkaufszettel" src="' + esc(r.data.signedUrl) + '">' +
      '<div class="actions"><button type="button" data-action="einkauf-liste">Zurück</button></div><div class="gap"></div>' +
      '<button class="danger" data-action="einkauf-del" data-id="' + esc(k.id) + '">Einkauf samt Foto löschen</button>');
  }
  async function deleteEinkauf(id) {
    var k = S.kaeufe.find(function (x) { return x.id === id; });
    if (!k) return;
    var r = await sb.from('einkaeufe').delete().eq('id', id);
    if (r.error) throw r.error;
    if (k.beleg_pfad) { try { await sb.storage.from('belege').remove([k.beleg_pfad]); } catch (e) { /* Datei bleibt ggf. liegen */ } }
    closeModal(); await loadAll(); render(); toast('Gelöscht');
  }

  function modalLimits() {
    var rows = S.limits.map(function (l) {
      return '<div class="row"><div class="main" data-action="limit-edit" data-id="' + esc(l.id) + '"><div class="t">' + esc(l.name) + '</div><div class="s">' + (l.aktiv ? 'aktiv' : 'beendet') + ' · pro Woche</div></div><div class="amt">' + eur(Number(l.wochenlimit)) + '</div></div>';
    }).join('');
    openModal('<h1>Wochenlimits</h1><p class="note">Jede Woche (Montag bis Sonntag) beginnt bei 0. Ein Limit mit Einkäufen wird beendet statt gelöscht.</p><div class="card flat">' + (rows || '<div class="empty">Noch kein Limit.</div>') + '</div>' +
      '<div class="actions"><button type="button" data-action="close-modal">Schließen</button><button class="primary" data-action="limit-neu">Neues Limit</button></div>');
  }
  function modalLimit(id) {
    var l = id ? S.limits.find(function (x) { return x.id === id; }) : null;
    if (id && !l) return;
    openModal('<h1>' + (l ? 'Limit ändern' : 'Neues Wochenlimit') + '</h1><form data-form="limit" data-id="' + esc(l ? l.id : '') + '">' +
      '<label for="li-name">Name</label><input id="li-name" maxlength="60" placeholder="zum Beispiel Lebensmittel" value="' + esc(l ? l.name : '') + '" required>' +
      '<label for="li-betrag">Limit pro Woche in Euro</label><input id="li-betrag" inputmode="decimal" autocomplete="off" placeholder="zum Beispiel 80" value="' + esc(l ? String(l.wochenlimit).replace('.', ',') : '') + '" required>' +
      (l ? '<label class="inline"><input type="checkbox" id="li-aktiv"' + (l.aktiv ? ' checked' : '') + '> Limit ist aktiv</label>' : '') +
      '<div class="err" id="li-err"></div><div class="actions"><button type="button" data-action="close-modal">Abbrechen</button><button class="primary" type="submit">Speichern</button></div></form>');
    setTimeout(function () { var el = document.getElementById('li-name'); if (el) el.focus(); }, 50);
  }
  async function saveLimit(form) {
    var err = form.querySelector('#li-err');
    err.textContent = '';
    var id = form.dataset.id || '';
    var name = form.querySelector('#li-name').value.trim();
    if (!name || name.length > 60) { err.textContent = 'Bitte gib einen Namen mit höchstens 60 Zeichen ein.'; return; }
    var b = L.parseBetrag(form.querySelector('#li-betrag').value);
    if (!isFinite(b) || b <= 0 || b > 100000) { err.textContent = 'Bitte gib ein Limit größer als 0 ein.'; return; }
    var row = { name: name, wochenlimit: L.round2(b) };
    var aEl = form.querySelector('#li-aktiv');
    if (aEl) row.aktiv = !!aEl.checked;
    var r = id ? await sb.from('einkauf_limits').update(row).eq('id', id) : await sb.from('einkauf_limits').insert(row);
    if (r.error) {
      if (r.error.code === '23505') { err.textContent = 'Ein Limit mit diesem Namen gibt es schon.'; return; }
      throw r.error;
    }
    closeModal(); await loadAll(); render(); toast('Gespeichert');
  }

  // ---------- Einkäufe aus ChatGPT-Text ----------
  // Luna lädt den Bon in ChatGPT hoch. ChatGPT gibt je Einkauf eine Zeile `Betrag; Datum; Händler; Limit` aus,
  // die hier eingefügt, streng geprüft und erst nach Bestätigung gebucht wird.
  function chatgptPrompt() {
    var namen = aktiveLimits().map(function (l) { return l.name; }).join(', ') || 'Lebensmittel';
    return 'Lies das Foto vom Kassenbon. Gib mir NUR eine einzige Zeile aus, ohne Erklärung, genau in diesem Format:\n' +
      'Betrag; Datum; Händler; Limit\n' +
      'Betrag = Gesamtsumme in Euro mit Komma (zum Beispiel 23,45). Datum = Kaufdatum als TT.MM.JJJJ. Händler = Name des Geschäfts. ' +
      'Limit = genau eines von: ' + namen + '.\n' +
      'Mehrere Bons: eine Zeile je Bon. Wenn du etwas nicht sicher lesen kannst, schreibe stattdessen in die Zeile FRAGE: und was unklar ist, und rate nicht.';
  }
  function modalImport(text) {
    S.importRows = null;
    openModal('<h1>Aus ChatGPT einfügen</h1>' +
      '<p class="note">1. Bon in ChatGPT hochladen und den Prompt senden. 2. Die Antwort hier einfügen. 3. Prüfen und buchen.</p>' +
      '<button type="button" data-action="import-prompt">Prompt für ChatGPT kopieren</button>' +
      '<details class="dash-fold"><summary>Prompt anzeigen</summary><div class="dash-fold-body"><textarea readonly rows="6" aria-label="Prompt für ChatGPT">' + esc(chatgptPrompt()) + '</textarea></div></details>' +
      '<form data-form="import-pruefen"><label for="im-text">Antwort von ChatGPT</label>' +
      '<textarea id="im-text" rows="6" placeholder="23,45; 13.11.2026; Rewe; Lebensmittel" autocapitalize="off" spellcheck="false">' + esc(text || '') + '</textarea>' +
      '<p class="note">Eine Zeile je Einkauf: Betrag; Datum; Händler; Limit. Nichts wird gebucht, bevor du es bestätigst.</p>' +
      '<div class="err" id="im-err"></div><div class="actions"><button type="button" data-action="close-modal">Abbrechen</button><button class="primary" type="submit">Prüfen</button></div></form>');
  }
  function importPruefen(form) {
    var txt = form.querySelector('#im-text').value;
    var err = form.querySelector('#im-err');
    err.textContent = '';
    if (/FRAGE:/i.test(txt)) { err.textContent = 'ChatGPT war unsicher (FRAGE:). Klär das dort und füge die korrigierte Zeile ein.'; return; }
    var res = L.parseEinkaufText(txt, S.limits, S.kaeufe, todayD());
    if (res.errors.length && !res.rows.length) { err.textContent = res.errors[0] + '.'; return; }
    S.importText = txt;
    S.importRows = res.rows.map(function (r) { r.id = newRequestId(); return r; });   // feste IDs: Wiederholung nach Netzfehler bucht nichts doppelt
    S.importOk = res.ok;
    var rows = res.rows.map(function (r) {
      var msgs = r.errors.map(function (m) { return '<div class="err">' + esc(m) + '</div>'; }).join('') + r.warnings.map(function (m) { return '<div class="warn-line">' + esc(m) + '</div>'; }).join('');
      return '<div class="row"><div class="main"><div class="t">' + (r.limitName ? esc(r.limitName) : 'Zeile ' + r.zeile) + (r.notiz ? ' · ' + esc(r.notiz) : '') + '</div>' +
        '<div class="s">' + (r.datum ? esc(fmtD(L.parseISO(r.datum))) : esc(r.text)) + '</div>' + msgs + '</div>' +
        '<div class="amt">' + (r.betrag != null ? eur(r.betrag) : '') + '</div></div>';
    }).join('');
    var sum = res.rows.reduce(function (a, r) { return a + (r.betrag || 0); }, 0);
    openModal('<h1>Prüfen</h1>' +
      (res.ok ? '<p class="note">' + res.rows.length + (res.rows.length === 1 ? ' Einkauf' : ' Einkäufe') + ', zusammen ' + eur(L.round2(sum)) + '. Stimmt alles?</p>' : '<p class="note">Es gibt Fehler. Korrigiere den Text, es wird nichts gebucht, solange eine Zeile fehlerhaft ist.</p>') +
      '<div class="card flat">' + rows + '</div>' +
      '<div class="actions"><button type="button" data-action="import-zurueck">Text ändern</button>' +
      (res.ok ? '<button class="primary" data-action="import-buchen">Buchen</button>' : '') + '</div>');
  }
  async function importBuchen() {
    if (!S.importRows || !S.importOk) return;
    var rows = S.importRows.map(function (r) { return { id: r.id, limit_id: r.limit_id, datum: r.datum, betrag: r.betrag, notiz: r.notiz }; });
    var r = await sb.from('einkaeufe').upsert(rows, { onConflict: 'id', ignoreDuplicates: true });   // eine Anweisung: alles oder nichts
    if (r.error) throw r.error;
    var n = rows.length;
    S.importRows = null; S.importText = '';
    closeModal(); await loadAll(); render(); toast(n + (n === 1 ? ' Einkauf gebucht' : ' Einkäufe gebucht'));
  }
  async function kopiereText(txt) {
    try { await navigator.clipboard.writeText(txt); toast('Prompt kopiert'); }
    catch (e) { toast('Kopieren nicht möglich. Öffne „Prompt anzeigen“ und kopiere von Hand.'); }
  }

  // ---------- Belege-Eingang ----------
  // Fotos von Bons lassen sich ohne Betrag hinterlegen und später einem Einkauf zuordnen.
  function fmtZeit(iso) {
    var d = new Date(iso);
    return fmtD(d) + ', ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  function modalEingang(msg) {
    var rows = S.eingang.map(function (g) {
      return '<div class="row"><div class="main" data-action="eingang-zuordnen" data-id="' + esc(g.id) + '"><div class="t">Beleg vom ' + esc(fmtZeit(g.erfasst_am)) + '</div><div class="s">Tippen zum Zuordnen</div></div>' +
        '<button class="mini" data-action="eingang-zuordnen" data-id="' + esc(g.id) + '">Zuordnen</button></div>';
    }).join('');
    openModal('<h1>Belege-Eingang</h1><p class="note">Fotos von Bons hinterlegen und später einem Einkauf zuordnen. Ein Beleg zählt erst im Wochenlimit, wenn er zugeordnet ist.</p>' +
      '<label for="eg-fotos">Fotos hinzufügen (mehrere möglich, bis zu 10)</label><input id="eg-fotos" type="file" accept="image/*" multiple data-action="eingang-fotos">' +
      '<div class="note" id="eg-status" aria-live="polite">' + esc(msg || 'Kamera, Mediathek oder Screenshot. Das Foto wird verkleinert und privat gespeichert. Achte darauf, dass keine Kartendaten sichtbar sind.') + '</div>' +
      '<div class="card flat">' + (rows || '<div class="empty">Keine offenen Belege.</div>') + '</div>' +
      '<div class="actions"><button type="button" data-action="close-modal">Schließen</button></div>');
  }
  async function eingangHochladen(input) {
    var files = Array.prototype.slice.call(input.files || []);
    var status = document.getElementById('eg-status');
    if (!files.length) return;
    if (files.length > 10) { if (status) status.textContent = 'Bitte höchstens 10 Fotos auf einmal auswählen.'; return; }
    var ok = 0, fehler = 0;
    for (var i = 0; i < files.length; i++) {
      if (status) status.textContent = 'Foto ' + (i + 1) + ' von ' + files.length + ' wird gespeichert…';
      var id = newRequestId(), path = id + '.jpg', hochgeladen = false;
      try {
        var blob = await shrinkImage(files[i]);
        var up = await sb.storage.from('belege').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) throw up.error;
        hochgeladen = true;
        var ins = await sb.from('beleg_eingang').insert({ id: id, beleg_pfad: path });
        if (ins.error) throw ins.error;
        ok++;
      } catch (e) {
        fehler++;
        if (hochgeladen) { try { await sb.storage.from('belege').remove([path]); } catch (e3) { /* verwaiste Datei ist harmlos */ } }
      }
    }
    input.value = '';
    await loadAll(); render();
    modalEingang((ok ? ok + (ok === 1 ? ' Foto gespeichert. ' : ' Fotos gespeichert. ') : '') + (fehler ? fehler + (fehler === 1 ? ' Foto ist fehlgeschlagen, bitte erneut versuchen.' : ' Fotos sind fehlgeschlagen, bitte erneut versuchen.') : ''));
  }
  async function modalZuordnen(id) {
    var g = S.eingang.find(function (x) { return x.id === id; });
    if (!g) return;
    var limits = aktiveLimits();
    if (!limits.length) { toast('Lege zuerst ein Wochenlimit an.'); modalLimit(null); return; }
    var r = await sb.storage.from('belege').createSignedUrl(g.beleg_pfad, 300);
    if (r.error || !r.data || !r.data.signedUrl) throw new Error('Das Foto konnte nicht geladen werden.');
    var opts = limits.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.name) + '</option>'; }).join('');
    openModal('<h1>Beleg zuordnen</h1><img class="beleg compact" alt="Foto vom Bon, antippen zum Vergrößern" data-action="beleg-gross" src="' + esc(r.data.signedUrl) + '"><p class="note">Bild antippen zum Vergrößern.</p>' +
      '<form data-form="zuordnen" data-id="' + esc(g.id) + '">' +
      '<label for="zu-zeile">Zeile aus ChatGPT (optional)</label><input id="zu-zeile" autocomplete="off" placeholder="23,45; 13.11.2026; Rewe; Lebensmittel">' +
      '<button type="button" data-action="zeile-uebernehmen">Zeile übernehmen</button>' +
      '<label for="zu-limit">Limit</label><select id="zu-limit">' + opts + '</select>' +
      '<label for="zu-betrag">Betrag in Euro</label><input id="zu-betrag" inputmode="decimal" autocomplete="off" placeholder="zum Beispiel 23,45" required>' +
      '<label for="zu-datum">Datum</label><input id="zu-datum" type="date" value="' + esc(L.iso(new Date(g.erfasst_am))) + '" required>' +
      '<label for="zu-notiz">Notiz (optional)</label><input id="zu-notiz" maxlength="200" placeholder="zum Beispiel Rewe">' +
      '<div class="err" id="zu-err"></div><div class="actions"><button type="button" data-action="eingang">Zurück</button><button class="primary" type="submit">Zuordnen</button></div></form>' +
      '<div class="gap"></div><button class="danger" data-action="eingang-verwerfen" data-id="' + esc(g.id) + '">Beleg verwerfen</button>');
  }
  function zeileUebernehmen() {
    var inp = document.getElementById('zu-zeile'), err = document.getElementById('zu-err');
    if (err) err.textContent = '';
    var res = L.parseEinkaufText(inp ? inp.value : '', S.limits, S.kaeufe, todayD());
    if (res.rows.length !== 1) { if (err) err.textContent = 'Bitte genau eine Zeile einfügen.'; return; }
    var r = res.rows[0];
    if (r.errors.length) { if (err) err.textContent = r.errors[0] + '.'; return; }
    document.getElementById('zu-betrag').value = String(r.betrag).replace('.', ',');
    document.getElementById('zu-datum').value = r.datum;
    document.getElementById('zu-notiz').value = r.notiz || '';
    document.getElementById('zu-limit').value = r.limit_id;
    if (r.warnings.length && err) err.textContent = r.warnings[0] + '. Prüfe, ob der Einkauf nicht schon erfasst ist.';
  }
  async function saveZuordnung(form) {
    var err = form.querySelector('#zu-err');
    err.textContent = '';
    var chk = pruefeEinkauf(form.querySelector('#zu-betrag').value, form.querySelector('#zu-datum').value, form.querySelector('#zu-limit').value);
    if (chk.error) { err.textContent = chk.error; return; }
    var r = await sb.rpc('beleg_zuordnen', {
      p_eingang_id: form.dataset.id, p_limit_id: chk.limitId, p_datum: chk.datum, p_betrag: chk.betrag,
      p_notiz: form.querySelector('#zu-notiz').value.trim() || null
    });
    if (r.error) throw r.error;
    await loadAll(); render();
    toast('Zugeordnet');
    if (S.eingang.length) modalEingang(); else closeModal();
  }
  async function eingangVerwerfen(id) {
    var g = S.eingang.find(function (x) { return x.id === id; });
    if (!g) return;
    var r = await sb.from('beleg_eingang').delete().eq('id', id);
    if (r.error) throw r.error;
    try { await sb.storage.from('belege').remove([g.beleg_pfad]); } catch (e) { /* Datei bleibt ggf. liegen */ }
    await loadAll(); render(); toast('Beleg verworfen');
    modalEingang();
  }

  // ---------- Ereignisse ----------
  document.addEventListener('click', function (e) {
    if (e.target === $modal) { closeModal(); return; }
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action, id = el.dataset.id;
    if (a === 'toggle-paid' || a === 'aufgabe-done' || a === 'foto-gewaehlt' || a === 'eingang-fotos') return;
    if (a === 'tab') { S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); }
    else if (a === 'abgleich') modalAbgleich();
    else if (a === 'posten-edit') modalPosten(id);
    else if (a === 'posten-neu') modalPostenNeu();
    else if (a === 'aufgabe-neu') modalAufgabe(null);
    else if (a === 'aufgabe-edit') modalAufgabe(id);
    else if (a === 'einkauf-neu') modalEinkauf(null);
    else if (a === 'einkauf-edit') modalEinkauf(id);
    else if (a === 'einkauf-liste') modalEinkaeufe();
    else if (a === 'einkauf-import') modalImport('');
    else if (a === 'eingang') modalEingang();
    else if (a === 'beleg-gross') el.classList.toggle('compact');
    else if (a === 'eingang-zuordnen') run(function () { return modalZuordnen(id); });
    else if (a === 'zeile-uebernehmen') zeileUebernehmen();
    else if (a === 'eingang-verwerfen') { if (confirm('Diesen Beleg verwerfen? Das Foto wird gelöscht.')) run(function () { return eingangVerwerfen(id); }); }
    else if (a === 'import-zurueck') modalImport(S.importText || '');
    else if (a === 'import-buchen') run(importBuchen);
    else if (a === 'import-prompt') run(function () { return kopiereText(chatgptPrompt()); });
    else if (a === 'beleg') run(function () { return showBeleg(id); });
    else if (a === 'einkauf-del') { if (confirm('Diesen Einkauf samt Foto wirklich löschen?')) run(function () { return deleteEinkauf(id); }); }
    else if (a === 'limits') modalLimits();
    else if (a === 'limit-neu') modalLimit(null);
    else if (a === 'limit-edit') modalLimit(id);
    else if (a === 'close-modal') closeModal();
    else if (a === 'toggle-done') { S.showDone = !S.showDone; render(); }
    else if (a === 'refresh') run(async function () { await loadAll(); render(); toast('Aktualisiert'); });
    else if (a === 'backup') run(backup);
    else if (a === 'logout') logout();
    else if (a === 'posten-delete') {
      if (!confirm('Diese Zahlung wirklich löschen?')) return;
      run(async function () { var r = await sb.from('posten').delete().eq('id', id); if (r.error) throw r.error; closeModal(); await loadAll(); render(); toast('Gelöscht'); });
    } else if (a === 'posten-end') {
      if (!confirm('Diesen Posten ab heute beenden?')) return;
      run(async function () { var r = await sb.from('posten').update({ gueltig_bis: L.iso(todayD()) }).eq('id', id); if (r.error) throw r.error; closeModal(); await loadAll(); render(); toast('Beendet'); });
    } else if (a === 'aufgabe-delete') {
      if (!confirm('Diese Aufgabe wirklich löschen?')) return;
      run(async function () { var r = await sb.from('aufgaben').delete().eq('id', id); if (r.error) throw r.error; closeModal(); await loadAll(); render(); toast('Gelöscht'); });
    }
  });
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (d && d.dataset && d.dataset.fold) S.folds[d.dataset.fold] = d.open;
  }, true);
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el.dataset) return;
    if (el.dataset.action === 'toggle-paid') run(function () { return togglePaid(el.dataset.id, el.checked); });
    else if (el.dataset.action === 'aufgabe-done') run(function () { return aufgabeDone(el.dataset.id, el.checked); });
    else if (el.dataset.action === 'eingang-fotos') run(function () { return eingangHochladen(el); });
    else if (el.dataset.action === 'foto-gewaehlt') {
      var info = document.getElementById('ek-fotoinfo'), f = el.files && el.files[0];
      if (info) info.textContent = f ? 'Foto ausgewählt: ' + f.name : 'Kein Foto ausgewählt.';
    }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f.dataset || !f.dataset.form) return;
    e.preventDefault();
    var k = f.dataset.form;
    if (k === 'login') run(function () { return doLogin(f); });
    else if (k === 'abgleich') run(function () { return saveAbgleich(f); });
    else if (k === 'posten-edit') run(function () { return savePosten(f); });
    else if (k === 'posten-neu') run(function () { return savePostenNeu(f); });
    else if (k === 'aufgabe') run(function () { return saveAufgabe(f); });
    else if (k === 'einkauf') run(function () { return saveEinkauf(f); });
    else if (k === 'limit') run(function () { return saveLimit(f); });
    else if (k === 'import-pruefen') importPruefen(f);
    else if (k === 'zuordnen') run(function () { return saveZuordnung(f); });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && S.user && !$modal.innerHTML && !S.busy) reload();
  });

  // ---------- Start ----------
  (async function start() {
    var r = await sb.auth.getSession();
    if (r.data && r.data.session) {
      S.user = r.data.session.user;
      render();
      await reload();
    } else {
      renderLogin();
    }
    sb.auth.onAuthStateChange(function (ev) {
      if (ev === 'SIGNED_OUT' && S.user) { S.user = null; renderLogin(); }
    });
  })();
})();
