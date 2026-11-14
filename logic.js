(function (root) {
  'use strict';

  // ---------- Hilfsfunktionen ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parseISO = (s) => {
    const p = String(s).slice(0, 10).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };
  const day0 = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysBetween = (a, b) => Math.round((day0(b) - day0(a)) / 86400000);
  const lastDayOfMonth = (y, m) => new Date(y, m + 1, 0).getDate();
  const dateIn = (y, m, d) => new Date(y, m, Math.min(d, lastDayOfMonth(y, m)));
  const num = (x) => Number(x) || 0;
  const round2 = (x) => Math.round(x * 100) / 100;

  function parseBetrag(s) {
    let t = String(s == null ? '' : s).replace(/[€\s]/g, '');
    if (t === '') return NaN;
    if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  }

  // ---------- Finanzmonat: 25. bis 25. ----------
  function periodStart(d) {
    const y = d.getFullYear(), m = d.getMonth();
    return d.getDate() >= 25 ? new Date(y, m, 25) : new Date(y, m - 1, 25);
  }
  function addPeriods(start, n) {
    return new Date(start.getFullYear(), start.getMonth() + n, 25);
  }

  function gueltig(p, d) {
    if (p.gueltig_ab && d < parseISO(p.gueltig_ab)) return false;
    if (p.gueltig_bis && d > parseISO(p.gueltig_bis)) return false;
    return true;
  }

  // undefined = gehört nicht in diesen Finanzmonat, null = gehört hinein, Termin unbekannt, Date = Termin
  function occurrence(state, p, start, today) {
    const end = addPeriods(start, 1);
    if (p.rhythmus === 'einmalig') {
      if (p.faellig_am) {
        const d = parseISO(p.faellig_am);
        return d >= start && d < end ? d : undefined;
      }
      const pays = state.zahlungen.filter((z) => z.posten_id === p.id);
      const cs = periodStart(today);
      const inc = pays.length ? pays.some((z) => z.finanzmonat === iso(start)) : iso(start) === iso(cs);
      return inc ? null : undefined;
    }
    if (p.rhythmus === 'jaehrlich') {
      if (!p.faellig_am) return undefined;
      const f = parseISO(p.faellig_am);
      for (const yr of [start.getFullYear(), start.getFullYear() + 1]) {
        const d = dateIn(yr, f.getMonth(), f.getDate());
        if (d >= start && d < end) return gueltig(p, d) ? d : undefined;
      }
      return undefined;
    }
    if (p.tag_im_monat == null) return gueltig(p, start) ? null : undefined;
    const t = Number(p.tag_im_monat);
    const baseMonth = t >= 25 ? start.getMonth() : start.getMonth() + 1;
    const d = dateIn(start.getFullYear(), baseMonth, t);
    return gueltig(p, d) ? d : undefined;
  }

  function itemsForPeriod(state, start, today) {
    const out = [];
    for (const p of state.posten) {
      const d = occurrence(state, p, start, today);
      if (d === undefined) continue;
      const pay = state.zahlungen.find((z) => z.posten_id === p.id && z.finanzmonat === iso(start));
      out.push({ p: p, date: d, paid: !!pay, pay: pay || null, betrag: num(p.betrag) });
    }
    out.sort((a, b) => {
      if (a.date && b.date) return a.date - b.date || a.p.name.localeCompare(b.p.name);
      if (a.date) return -1;
      if (b.date) return 1;
      return a.p.name.localeCompare(b.p.name);
    });
    return out;
  }

  // ---------- Einnahmen ----------
  function incomeDate(e, y, m) {
    return dateIn(y, m, Number(e.tag_im_monat));
  }
  function incomeValid(e, d) {
    if (e.aktiv === false) return false;
    if (e.gueltig_ab && d < parseISO(e.gueltig_ab)) return false;
    if (e.gueltig_bis && d > parseISO(e.gueltig_bis)) return false;
    return true;
  }
  function nextIncome(state, today) {
    let best = null;
    for (const e of state.einnahmen) {
      for (let k = 0; k <= 2; k++) {
        const d = incomeDate(e, today.getFullYear(), today.getMonth() + k);
        if (d > today && incomeValid(e, d)) {
          if (!best || d < best.date) best = { date: d, e: e };
          break;
        }
      }
    }
    return best;
  }
  function incomeInPeriod(state, start) {
    const end = addPeriods(start, 1);
    let sum = 0;
    const list = [];
    for (const e of state.einnahmen) {
      const t = Number(e.tag_im_monat);
      const baseMonth = t >= 25 ? start.getMonth() : start.getMonth() + 1;
      const d = incomeDate(e, start.getFullYear(), baseMonth);
      if (d >= start && d < end && incomeValid(e, d)) {
        sum += num(e.betrag);
        list.push({ e: e, date: d });
      }
    }
    return { sum: round2(sum), list: list };
  }

  // ---------- Die Lage: Wie viel ist bis zum nächsten Gehalt frei? ----------
  function calcLage(state, today, dispo) {
    dispo = Number(dispo) || 0;
    const cs = periodStart(today);
    const alle = state.staende || [];
    const stand = alle.find((x) => (x.konto || 'sascha') === 'sascha') || null;
    const luna = alle.find((x) => x.konto === 'luna') || null;
    const next = nextIncome(state, today);
    const res = { stand: stand, next: next, days: null, offen: 0, offenListe: [], nachStand: 0, verfuegbar: null, tagesbudget: null, luecke: null, barOffen: 0, dispo: dispo, spielraum: null, luna: luna, gesamt: null };
    if (!next) return res;
    res.days = Math.max(1, daysBetween(today, next.date));

    for (let k = 0; k <= 1; k++) {
      const start = addPeriods(cs, k);
      for (const it of itemsForPeriod(state, start, today)) {
        if (it.paid) continue;
        if (k === 1 && !it.date) continue;
        if (it.date && it.date >= next.date) continue;
        if (it.p.zahlung === 'bar') { res.barOffen += it.betrag; continue; }
        res.offen += it.betrag;
        res.offenListe.push(it);
      }
    }
    res.offen = round2(res.offen);

    if (stand) {
      const standTs = new Date(stand.erfasst_am).getTime();
      for (const z of state.zahlungen) {
        if (new Date(z.erfasst_am).getTime() > standTs) {
          const p = state.posten.find((x) => x.id === z.posten_id);
          if (p && p.zahlung === 'konto' && z.finanzmonat === iso(cs)) res.nachStand += num(z.betrag);
        }
      }
      res.nachStand = round2(res.nachStand);
      res.spielraum = round2(num(stand.betrag) + dispo);
      res.verfuegbar = round2(res.spielraum - res.offen - res.nachStand);
      if (luna) res.gesamt = round2(res.verfuegbar + num(luna.betrag));
      if (res.verfuegbar < 0) res.luecke = round2(-res.verfuegbar);
      else res.tagesbudget = round2(res.verfuegbar / res.days);
    }
    return res;
  }

  // ---------- Monatsansicht und Vorschau ----------
  function monatSummary(state, start, today) {
    const items = itemsForPeriod(state, start, today);
    let fix = 0, bar = 0, bezahlt = 0;
    for (const it of items) {
      fix += it.betrag;
      if (it.p.zahlung === 'bar') bar += it.betrag;
      if (it.paid) bezahlt += it.betrag;
    }
    const inc = incomeInPeriod(state, start);
    return {
      start: start, end: addPeriods(start, 1), items: items,
      einnahmen: inc.sum, einnahmenListe: inc.list,
      fixkosten: round2(fix), bar: round2(bar), bezahlt: round2(bezahlt),
      rest: round2(inc.sum - fix)
    };
  }
  function vorschau(state, today, n) {
    const cs = periodStart(today);
    const out = [];
    for (let k = 0; k < (n || 6); k++) out.push(monatSummary(state, addPeriods(cs, k), today));
    return out;
  }

  // ---------- Wiederkehrende Aufgaben ----------
  function nextRecurrence(faellig, wdh, today) {
    const base = faellig ? parseISO(faellig) : today;
    const from = base < today ? today : base;
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    if (wdh === 'taeglich') d.setDate(d.getDate() + 1);
    else if (wdh === 'woechentlich') d.setDate(d.getDate() + 7);
    else if (wdh === 'monatlich') return dateIn(from.getFullYear(), from.getMonth() + 1, base.getDate());
    else if (wdh === 'jaehrlich') return dateIn(from.getFullYear() + 1, from.getMonth(), base.getDate());
    return d;
  }

  // ---------- Wocheneinkauf ----------
  // Woche = Montag bis Sonntag in lokaler Zeit. Rechnet in Cent, damit 0,10 + 0,20 genau 0,30 ergibt.
  const weekStart = (d) => { const x = day0(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate() - ((x.getDay() + 6) % 7)); };
  const weekEnd = (d) => { const s = weekStart(d); return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6); };
  const cents = (x) => Math.round(num(x) * 100);
  function einkaufStatus(limits, kaeufe, today) {
    const start = weekStart(today), end = weekEnd(today);
    const a = iso(start), b = iso(end);
    const inWeek = (k) => { const d = String(k.datum).slice(0, 10); return d >= a && d <= b; };
    const daysLeft = daysBetween(today, end) + 1;
    let spentC = 0, limitC = 0;
    const rows = (limits || []).filter((l) => l.aktiv).map((l) => {
      const mine = (kaeufe || []).filter((k) => k.limit_id === l.id && inWeek(k));
      const sp = mine.reduce((acc, k) => acc + cents(k.betrag), 0);
      const lim = cents(l.wochenlimit);
      spentC += sp; limitC += lim;
      return {
        limit: l, count: mine.length, spent: sp / 100, limitBetrag: lim / 100, rest: (lim - sp) / 100,
        pct: lim > 0 ? Math.min(100, Math.round(sp / lim * 100)) : 0, over: sp > lim,
        proTag: lim - sp > 0 ? Math.floor((lim - sp) / daysLeft) / 100 : 0
      };
    });
    return {
      start, end, daysLeft, rows,
      total: { spent: spentC / 100, limit: limitC / 100, rest: (limitC - spentC) / 100, over: spentC > limitC, pct: limitC > 0 ? Math.min(100, Math.round(spentC / limitC * 100)) : 0 }
    };
  }

  // Text aus ChatGPT: je Zeile `Betrag; Datum; Haendler; Limit` (auch Tab oder Tabellen-Striche, Code-Block-Zaeune werden ignoriert).
  // Nichts wird geraten: Jede Zeile wird streng geprueft, und das Ergebnis enthaelt Fehler und Warnungen je Zeile.
  const fold = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').replace(/\s+/g, ' ').trim();
  function parseDatum(t) {
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    let y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})$/.exec(t))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (m[3].length === 2) y += 2000; }
    else return null;
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
  }
  function parseEinkaufText(text, limits, kaeufe, today) {
    const active = (limits || []).filter((l) => l.aktiv);
    const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^```/.test(l) && !/^#/.test(l) && !/^[|\-:\s]+$/.test(l));
    const rows = [], seen = new Set();
    let n = 0;
    for (const raw of lines) {
      const cells = raw.replace(/^\||\|$/g, '').split(/\s*[;\t|]\s*/).map((c) => c.trim());
      if (/^betrag/i.test(cells[0])) continue;                       // Kopfzeile
      n++;
      const r = { zeile: n, text: raw, errors: [], warnings: [] };
      const b = parseBetrag(cells[0]);
      if (!isFinite(b) || b <= 0) r.errors.push('Betrag fehlt oder ist keine Zahl über 0');
      else if (b > 100000) r.errors.push('Betrag ist zu groß');
      else r.betrag = round2(b);
      const d = cells[1] ? parseDatum(cells[1]) : null;
      if (!d) r.errors.push('Datum fehlt oder ist ungültig (erwartet 13.11.2026 oder 2026-11-13)');
      else if (daysBetween(d, today) > 365 || daysBetween(today, d) > 7) r.errors.push('Datum liegt zu weit in Vergangenheit oder Zukunft');
      else r.datum = iso(d);
      r.notiz = (cells[2] || '').trim() || null;
      if (r.notiz && r.notiz.length > 200) r.errors.push('Händler/Notiz ist länger als 200 Zeichen');
      const want = fold(cells[3]);
      let lim = null;
      if (want) {
        const exact = active.filter((l) => fold(l.name) === want);
        const part = exact.length ? exact : active.filter((l) => fold(l.name).includes(want) || want.includes(fold(l.name)));
        if (part.length === 1) lim = part[0];
        else r.errors.push(part.length ? 'Limit „' + cells[3] + '“ ist nicht eindeutig' : 'Limit „' + cells[3] + '“ gibt es nicht (aktiv: ' + (active.map((l) => l.name).join(', ') || 'keins') + ')');
      } else if (active.length === 1) lim = active[0];
      else r.errors.push('Limit fehlt (aktiv: ' + (active.map((l) => l.name).join(', ') || 'keins') + ')');
      if (lim) { r.limit_id = lim.id; r.limitName = lim.name; }
      if (cells.length > 4) r.warnings.push('Zusätzliche Spalten wurden ignoriert');
      if (r.betrag != null && r.datum && r.limit_id) {
        const key = r.limit_id + '|' + r.datum + '|' + cents(r.betrag);
        const bekannt = (kaeufe || []).some((k) => k.limit_id === r.limit_id && String(k.datum).slice(0, 10) === r.datum && cents(k.betrag) === cents(r.betrag));
        if (bekannt || seen.has(key)) r.warnings.push('Sieht doppelt aus: gleicher Betrag, Tag und Limit sind schon erfasst');
        seen.add(key);
      }
      rows.push(r);
    }
    const errors = [];
    if (!rows.length) errors.push('Kein Eintrag gefunden');
    if (rows.length > 30) errors.push('Zu viele Zeilen (höchstens 30 auf einmal)');
    return { rows, errors, ok: !errors.length && rows.every((r) => !r.errors.length) };
  }

  const api = {
    iso, parseISO, daysBetween, parseBetrag, periodStart, addPeriods, occurrence, itemsForPeriod,
    nextIncome, incomeInPeriod, calcLage, monatSummary, vorschau, nextRecurrence, round2, weekStart, weekEnd, einkaufStatus, parseEinkaufText, parseDatum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : this);
