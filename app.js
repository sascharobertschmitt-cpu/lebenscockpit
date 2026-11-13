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

  var S = { user: null, tab: 'heute', einnahmen: [], posten: [], zahlungen: [], staende: [], aufgaben: [], showDone: false, loaded: false, busy: false };
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
  function poss(n) { return /s$/i.test(n) ? n + "'" : n + 's'; }
  var toastTimer;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $toast.classList.remove('show'); }, 2600);
  }
  function fail(err) {
    var m = (err && err.message) || String(err);
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
      sb.from('kontostaende').select('*').order('erfasst_am', { ascending: false }).limit(30),
      sb.from('aufgaben').select('*').order('faellig', { ascending: true, nullsFirst: false })
    ]);
    for (var i = 0; i < r.length; i++) if (r[i].error) throw r[i].error;
    S.einnahmen = r[0].data; S.posten = r[1].data; S.zahlungen = r[2].data; S.staende = r[3].data; S.aufgaben = r[4].data;
    S.loaded = true;
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
    return '<nav>' + Object.keys(LABELS).map(function (k) {
      return '<button class="' + (S.tab === k ? 'on' : '') + '" data-action="tab" data-tab="' + k + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg>' + LABELS[k] + '</button>';
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

  function head(title, sub) {
    return '<div class="head"><h1>' + esc(title) + '</h1><span class="sub">' + esc(sub || '') + '</span></div>';
  }

  function taskRow(a) {
    var t = todayD();
    var due = a.faellig ? L.parseISO(a.faellig) : null;
    var over = due && due < t;
    var bits = [];
    if (a.zustaendig) bits.push('<span class="who">' + esc(a.zustaendig) + '</span>');
    if (due) bits.push(over ? '<span style="color:var(--danger)">' + esc(fmtD(due)) + '</span>' : esc(fmtD(due)));
    if (a.wiederholung) bits.push(esc(WDH[a.wiederholung] || ''));
    return '<div class="row task' + (a.erledigt ? ' paid' : '') + '">' +
      '<input class="chk" type="checkbox" data-action="aufgabe-done" data-id="' + esc(a.id) + '"' + (a.erledigt ? ' checked' : '') + ' aria-label="erledigt">' +
      '<div class="main" data-action="aufgabe-edit" data-id="' + esc(a.id) + '"><div class="t">' + esc(a.titel) + '</div><div class="s">' + bits.join(' · ') + '</div></div></div>';
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
      var who = poss(lage.next.e.person) + ' Gehalt am ' + fmtD(lage.next.date);
      if (lage.luecke != null) {
        h += '<div class="hero bad"><div class="lbl">Bis ' + esc(who) + ' fehlen</div><div class="big">' + eur0(lage.luecke) + '</div>' +
          '<div class="sm">Auch mit vollem Dispo reicht es nicht: ' + eur(lage.spielraum) + ' Spielraum (Kontostand plus Dispo) minus ' + eur(lage.offen + lage.nachStand) + ' offene Zahlungen. Dieses Geld muss noch beschafft werden.</div></div>';
      } else {
        h += '<div class="hero"><div class="lbl">Frei verfügbar pro Tag</div><div class="big">' + eur0(lage.tagesbudget) + '</div>' +
          '<div class="sm">' + eur0(lage.verfuegbar) + ' Spielraum nach offenen Zahlungen (inkl. Dispo), ' + lage.days + (lage.days === 1 ? ' Tag' : ' Tage') + ' bis ' + esc(who) + '</div></div>';
      }
    }

    if (lage.stand) {
      var age = L.daysBetween(new Date(lage.stand.erfasst_am), t);
      var ageTxt = age <= 0 ? 'heute' : age === 1 ? 'gestern' : 'vor ' + age + ' Tagen';
      h += '<div class="grid2"><div class="stat"><div class="k">Kontostand</div><div class="v">' + eur(Number(lage.stand.betrag)) + '</div><div class="n">Stand ' + ageTxt + '</div></div>' +
        '<div class="stat"><div class="k">Offen bis Gehalt</div><div class="v">' + eur(lage.offen + lage.nachStand) + '</div><div class="n">' + lage.offenListe.length + ' Zahlungen</div></div></div>';
      if (Number(lage.stand.betrag) < 0) {
        h += '<div class="warn">Dispo genutzt: ' + eur(-Number(lage.stand.betrag)) + ' von ' + eur0(DISPO) + ', noch frei: ' + eur(Math.max(0, lage.spielraum)) + '.</div>';
      }
      if (age >= 7) h += '<div class="warn">Der Kontostand ist ' + age + ' Tage alt. Die Zahlen stimmen nur, wenn er aktuell ist.</div>';
      var overdue = lage.offenListe.filter(function (it) { return it.date && it.date < t; });
      if (overdue.length) h += '<div class="warn">' + overdue.length + (overdue.length === 1 ? ' Zahlung mit vergangenem Termin ist' : ' Zahlungen mit vergangenem Termin sind') + ' noch nicht abgehakt. Beim Aktualisieren des Kontostands bestätigst du, was schon abgebucht wurde.</div>';
    }
    h += '<button class="primary" data-action="abgleich">Kontostand aktualisieren</button>';

    var open = S.aufgaben.filter(function (a) { return !a.erledigt && a.faellig && L.parseISO(a.faellig) <= t; });
    h += '<h2>Aufgaben heute und überfällig</h2><div class="card">' +
      (open.length ? open.slice(0, 6).map(taskRow).join('') : '<div class="empty">Nichts fällig.</div>') + '</div>';

    var soon = lage.offenListe.filter(function (it) { return it.date && it.date >= t; }).slice(0, 6);
    h += '<h2>Bald fällig</h2><div class="card">' + (soon.length ? soon.map(function (it) {
      return '<div class="row"><div class="main"><div class="t">' + esc(it.p.name) + '</div><div class="s">' + esc(fmtD(it.date)) + '</div></div><div class="amt">' + eur(it.betrag) + '</div></div>';
    }).join('') : '<div class="empty">Bis zum nächsten Gehalt ist nichts mit festem Termin offen.</div>') + '</div>';

    var klaeren = S.posten.filter(function (p) { return p.status === 'pruefen'; });
    if (klaeren.length) {
      h += '<h2>Noch zu klären</h2><div class="card">' + klaeren.map(function (p) {
        return '<div class="row"><div class="main" data-action="posten-edit" data-id="' + esc(p.id) + '"><div class="t">' + esc(p.name) + '</div><div class="s">' + esc(p.notiz || 'Betrag oder Termin prüfen') + '</div></div><div class="amt">' + eur(Number(p.betrag)) + '</div></div>';
      }).join('') + '</div>';
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

    var einnTxt = m.einnahmenListe.map(function (x) { return esc(x.e.person) + ' ' + eur0(Number(x.e.betrag)); }).join(', ');
    h += '<div class="card"><table><tr><td>Einnahmen</td><td>' + eur(m.einnahmen) + '</td></tr>' +
      '<tr><td colspan="2" class="s" style="text-align:left;font-size:12.5px;color:var(--muted);border:0;padding-top:0">' + einnTxt + '</td></tr>' +
      '<tr><td>Feste Zahlungen</td><td>' + eur(m.fixkosten) + '</td></tr>' +
      (m.bar ? '<tr><td colspan="2" style="text-align:left;font-size:12.5px;color:var(--muted);border:0;padding-top:0">davon bar reserviert ' + eur(m.bar) + '</td></tr>' : '') +
      '<tr class="now"><td>Bleibt für Alltag, Klarna, Kreditkarte, Dispozinsen</td><td style="color:var(--' + (m.rest < 0 ? 'danger' : 'ok') + ')">' + eur(m.rest) + '</td></tr></table></div>';

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
      h += '<h2><span data-action="toggle-done" style="cursor:pointer">Erledigt (' + done.length + ') ' + (S.showDone ? 'ausblenden' : 'anzeigen') + '</span></h2>';
      if (S.showDone) h += '<div class="card">' + done.map(taskRow).join('') + '</div>';
    }
    return h;
  }

  function viewMehr() {
    return head('Mehr', 'Version ' + VERSION) +
      '<div class="card"><div class="row"><div class="main"><div class="t">Angemeldet als</div><div class="s">' + esc(S.user.email) + '</div></div></div></div>' +
      '<button data-action="refresh">Daten neu laden</button><div style="height:10px"></div>' +
      '<button data-action="backup">Backup herunterladen</button><p class="note">Das Backup enthält alle Zahlen im Klartext. Bewahre die Datei sicher auf und mach es am besten einmal pro Woche.</p>' +
      '<button class="danger" data-action="logout">Abmelden</button>';
  }

  // ---------- Fenster ----------
  function openModal(html) { $modal.innerHTML = '<div class="sheet">' + html + '</div>'; }
  function closeModal() { $modal.innerHTML = ''; }

  function modalAbgleich() {
    var t = todayD(), cs = L.periodStart(t);
    var items = L.itemsForPeriod(S, cs, t).filter(function (i) { return !i.paid && i.p.zahlung === 'konto'; });
    var past = items.filter(function (i) { return i.date && i.date <= t; });
    var undated = items.filter(function (i) { return !i.date; });
    var rows = past.map(function (i) { return abRow(i, true); }).join('') + undated.map(function (i) { return abRow(i, false); }).join('');
    var last = S.staende[0];
    openModal('<h1>Kontostand aktualisieren</h1><form data-form="abgleich">' +
      '<label for="ab-betrag">Aktueller Kontostand in Euro</label><input id="ab-betrag" inputmode="decimal" autocomplete="off" placeholder="zum Beispiel 1840,50" required>' +
      '<label class="inline"><input type="checkbox" id="ab-minus"> Das Konto ist im Minus (Dispo)</label>' +
      '<h2>Was ist seit dem letzten Stand abgebucht?</h2><p class="note">Ein Haken bedeutet: Der Betrag ist schon vom Konto weg und steckt im Kontostand. Ohne Haken bleibt die Zahlung offen und wird noch abgezogen.</p>' +
      '<div class="card">' + (rows || '<div class="empty">Nichts zu bestätigen.</div>') + '</div>' +
      '<div class="err" id="ab-err"></div><div class="actions"><button type="button" data-action="close-modal">Abbrechen</button><button class="primary" type="submit">Speichern</button></div></form>');
    setTimeout(function () { var el = document.getElementById('ab-betrag'); if (el) el.focus(); }, 50);
  }
  function abRow(i, checked) {
    return '<label class="row" style="margin:0;color:var(--text);font-size:16px"><input class="chk" type="checkbox" name="pay" value="' + esc(i.p.id) + '"' + (checked ? ' checked' : '') + '>' +
      '<span class="main"><span class="t" style="display:block">' + esc(i.p.name) + '</span><span class="s" style="display:block">' + (i.date ? esc(fmtD(i.date)) : 'Termin offen') + '</span></span><span class="amt">' + eur(i.betrag) + '</span></label>';
  }
  async function saveAbgleich(form) {
    var err = form.querySelector('#ab-err');
    err.textContent = '';
    var n = L.parseBetrag(form.querySelector('#ab-betrag').value);
    if (!isFinite(n)) { err.textContent = 'Bitte gib den Kontostand als Zahl ein.'; return; }
    if (form.querySelector('#ab-minus').checked) n = -Math.abs(n);
    var ts = new Date().toISOString();
    var t = todayD(), cs = L.periodStart(t);
    var r = await sb.from('kontostaende').insert({ betrag: n, erfasst_am: ts, erfasst_von: S.user.email });
    if (r.error) throw r.error;
    var ids = Array.prototype.map.call(form.querySelectorAll('input[name=pay]:checked'), function (x) { return x.value; });
    if (ids.length) {
      var rows = ids.map(function (id) {
        var p = S.posten.find(function (x) { return x.id === id; });
        return { posten_id: id, finanzmonat: L.iso(cs), betrag: Number(p.betrag), bezahlt_am: L.iso(t), erfasst_am: ts };
      });
      var r2 = await sb.from('posten_zahlungen').upsert(rows, { onConflict: 'posten_id,finanzmonat' });
      if (r2.error) throw r2.error;
    }
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
      '<div style="height:12px"></div>' +
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
      (a ? '<div style="height:12px"></div><button class="danger" data-action="aufgabe-delete" data-id="' + esc(a.id) + '">Aufgabe löschen</button>' : ''));
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
  async function aufgabeDone(id, checked) {
    var a = S.aufgaben.find(function (x) { return x.id === id; });
    if (!a) return;
    var r = await sb.from('aufgaben').update({ erledigt: checked, erledigt_am: checked ? new Date().toISOString() : null }).eq('id', id);
    if (r.error) throw r.error;
    if (checked && a.wiederholung) {
      var next = L.nextRecurrence(a.faellig, a.wiederholung, todayD());
      var r2 = await sb.from('aufgaben').insert({ titel: a.titel, zustaendig: a.zustaendig, faellig: L.iso(next), wiederholung: a.wiederholung });
      if (r2.error) throw r2.error;
    }
    await loadAll(); render();
  }
  async function backup() {
    var r = await Promise.all([
      sb.from('einnahmen').select('*'), sb.from('posten').select('*'), sb.from('posten_zahlungen').select('*'),
      sb.from('kontostaende').select('*').order('erfasst_am', { ascending: false }), sb.from('aufgaben').select('*')
    ]);
    for (var i = 0; i < r.length; i++) if (r[i].error) throw r[i].error;
    var data = { exportiert_am: new Date().toISOString(), einnahmen: r[0].data, posten: r[1].data, posten_zahlungen: r[2].data, kontostaende: r[3].data, aufgaben: r[4].data };
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

  // ---------- Ereignisse ----------
  document.addEventListener('click', function (e) {
    if (e.target === $modal) { closeModal(); return; }
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var a = el.dataset.action, id = el.dataset.id;
    if (a === 'toggle-paid' || a === 'aufgabe-done') return;
    if (a === 'tab') { S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); }
    else if (a === 'abgleich') modalAbgleich();
    else if (a === 'posten-edit') modalPosten(id);
    else if (a === 'posten-neu') modalPostenNeu();
    else if (a === 'aufgabe-neu') modalAufgabe(null);
    else if (a === 'aufgabe-edit') modalAufgabe(id);
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
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!el.dataset) return;
    if (el.dataset.action === 'toggle-paid') run(function () { return togglePaid(el.dataset.id, el.checked); });
    else if (el.dataset.action === 'aufgabe-done') run(function () { return aufgabeDone(el.dataset.id, el.checked); });
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
