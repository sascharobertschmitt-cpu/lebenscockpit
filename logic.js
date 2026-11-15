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
    let t = String(s == null ? '' : s).replace(/[€\s]/g, '').replace(/−/g, '-');
    if (t === '') return NaN;
    if (t.indexOf(',') !== -1) t = t.replace(/\./g, '').replace(',', '.');
    else if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
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

  function installmentRows(state, p) {
    if (!p.raten_ab_datum || !Number.isInteger(p.raten_gesamt) || !Number.isInteger(p.raten_ab_nummer) || p.raten_gesamt > 600 || p.raten_ab_nummer < 1 || p.raten_ab_nummer > p.raten_gesamt) return [];
    const first = parseISO(p.raten_ab_datum);
    const rows = [];
    for (let n = p.raten_ab_nummer; n <= p.raten_gesamt; n++) {
      const date = dateIn(first.getFullYear(), first.getMonth() + n - p.raten_ab_nummer, first.getDate());
      const pay = state.zahlungen.find(z => z.posten_id === p.id && z.finanzmonat === iso(periodStart(date)));
      const rb = p.raten_betraege;
      const override = rb ? (rb[iso(date)] != null ? rb[iso(date)] : rb[String(n)]) : null;
      const planned = override != null && Number.isFinite(Number(override)) && Number(override) >= 0 ? Number(override) : n === p.raten_gesamt ? num(p.raten_schlussbetrag) : num(p.betrag);
      rows.push({ number: n, date, paid: !!pay, betrag: pay ? num(pay.betrag) : planned });
    }
    return rows;
  }

  function gueltig(p, d) {
    if (p.gueltig_ab && d < parseISO(p.gueltig_ab)) return false;
    if (p.gueltig_bis && d > parseISO(p.gueltig_bis)) return false;
    return true;
  }

  // undefined = gehört nicht in diesen Finanzmonat, null = gehört hinein, Termin unbekannt, Date = Termin
  function occurrence(state, p, start, today) {
    const end = addPeriods(start, 1);
    const rates = installmentRows(state, p);
    if (rates.length && end > rates[0].date) {
      const rate = rates.find(r => r.date >= start && r.date < end);
      return rate && gueltig(p, rate.date) ? rate.date : undefined;
    }
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
      const rate = installmentRows(state, p).find(r => d && iso(r.date) === iso(d));
      out.push({ p: p, date: d, paid: !!pay, pay: pay || null, betrag: num(pay ? pay.betrag : rate ? rate.betrag : p.betrag) });
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

  // ---------- Vorgemerkte Bankumsätze ----------
  // Vormerkungen sind noch nicht im Bankkontostand abgezogen, aber so gut wie sicher.
  // Sie mindern den Spielraum, ohne etwas als bezahlt zu markieren (keine posten_zahlungen).
  // Doppelzählung wird verhindert:
  //  - passt eine Vormerkung zu einem offenen Posten, zählt nur der Posten (Betrag = Bankbetrag);
  //  - passt sie zu einem bereits abgehakten Posten, zählt dessen Zahlung (Stand/nachStand);
  //  - gibt es dazu schon die gebuchte Zeile, zählt nur noch diese: seit dem letzten Kontostand
  //    importiert = noch nicht im Stand (einmal abziehen), davor importiert = schon im Stand (nicht erneut);
  //  - gebuchte Umsätze, die nach dem Kontostand datiert und importiert wurden, werden wie Vormerkungen
  //    behandelt (gleiche Posten-/Duplikatprüfung), alte Zeilen aus Nachimporten nie.
  const GENERIC = new Set(['paypal', 'europe', 'gmbh', 'cie', 'sarl', 'the', 'und', 'bei', 'vom', 'ihr', 'einkauf', 'rechnung', 'rate', 'raten', 'zahlung', 'zahlungen', 'lastschrift', 'sepa', 'konto', 'später', 'bezahlen', 'ratenzahlung', 'versicherungsnr', 'deutschland', 'kd', 'nr', 'rg', 'ag', 'kg', 'ohg', 'gesellschaft', 'reduziert', 'volle', 'letzte', 'abbuchung']);
  function bankTokens(s, minLen) {
    const out = new Set();
    String(s == null ? '' : s).toLowerCase().split(/[^\p{L}\p{N}]+/u).forEach(function (t) {
      if (t.length >= minLen && !/^\d+$/.test(t) && !GENERIC.has(t)) out.add(t);
    });
    return out;
  }
  function rowTokens(x) { return bankTokens((x.gegenpartei || '') + ' ' + (x.verwendungszweck || ''), 3); }
  function shareToken(a, b) { for (const t of a) if (b.has(t)) return true; return false; }
  const gleichBetrag = (a, b) => Math.abs(num(a) - num(b)) < 0.005;

  function vorgemerkt(state, today, items, stand, konto) {
    konto = konto || 'sascha';
    const rows = (state.bankumsaetze || []).filter(function (x) { return (x.konto || 'sascha') === konto; });
    const pend = rows.filter(function (x) { return x.buchungsstatus === 'vorgemerkt' && num(x.betrag) < 0; })
      .sort(function (a, b) { return String(a.buchungsdatum).localeCompare(String(b.buchungsdatum)) || String(a.id).localeCompare(String(b.id)); });
    const booked = rows.filter(function (x) { return x.buchungsstatus !== 'vorgemerkt'; });
    const standTs = stand ? new Date(stand.erfasst_am).getTime() : null;
    const used = new Set();
    const res = { liste: [], summe: 0, zusaetzlich: 0, imPosten: 0, abgedeckt: 0, schonGebucht: 0, spaeterGebucht: 0 };
    const sameDeal = function (b, x, tok) {
      return gleichBetrag(b.betrag, x.betrag) && /^\d{4}-\d{2}-\d{2}/.test(String(b.buchungsdatum)) && /^\d{4}-\d{2}-\d{2}/.test(String(x.buchungsdatum)) &&
        Math.abs(daysBetween(parseISO(x.buchungsdatum), parseISO(b.buchungsdatum))) <= 7 && shareToken(tok, rowTokens(b));
    };
    // Posten passend zu einer Bankzeile suchen (offen zuerst, dann abgehakt).
    const matchPosten = function (betrag, tok) {
      const fits = function (it) {
        if (used.has(it) || (it.p.zahlung === 'bar')) return false;
        return Math.abs(it.betrag - betrag) <= Math.max(1, 0.1 * it.betrag) && shareToken(bankTokens(it.p.name, 3), tok);
      };
      const best = function (list) { return list.filter(fits).sort(function (a, c) { return Math.abs(a.betrag - betrag) - Math.abs(c.betrag - betrag); })[0]; };
      const open = best(items.filter(function (it) { return !it.paid; }));
      return { open: open, paid: open ? null : best(items.filter(function (it) { return it.paid; })) };
    };
    const verbuchen = function (entry, betrag, tok) {
      const m = matchPosten(betrag, tok);
      if (m.open) {
        used.add(m.open); entry.art = 'posten'; entry.item = m.open;
        entry.delta = round2(betrag - m.open.betrag); // Bankbetrag ersetzt den geplanten Betrag
        res.imPosten += betrag; res.zusaetzlich += entry.delta;
      } else if (m.paid) {
        used.add(m.paid); entry.art = 'abgehakt'; entry.item = m.paid; res.abgedeckt += betrag;
      } else {
        res.zusaetzlich += betrag;
      }
      res.liste.push(entry);
    };
    pend.forEach(function (x) {
      const betrag = Math.abs(num(x.betrag));
      const tok = rowTokens(x);
      res.summe += betrag;
      // Zur gebuchten Zeile geworden und schon im Kontostand: nicht erneut abziehen.
      const gb = booked.find(function (b) { return sameDeal(b, x, tok); });
      if (gb && (!standTs || !gb.importiert_am || new Date(gb.importiert_am).getTime() <= standTs)) {
        res.schonGebucht += betrag; res.liste.push({ row: x, betrag: betrag, art: 'gebucht', item: null }); return;
      }
      verbuchen({ row: x, betrag: betrag, art: 'zusaetzlich', item: null }, betrag, tok);
    });
    // Gebuchte Umsätze nach dem Kontostand (später importiert und später datiert) sind noch nicht im Stand.
    // Zählen nur, wenn sie nicht schon als Vormerkung oder Posten erfasst sind.
    if (standTs) {
      const standTag = new Date(standTs).toISOString().slice(0, 10);
      booked.forEach(function (b) {
        const betrag = Math.abs(num(b.betrag));
        if (!(num(b.betrag) < 0) || !b.importiert_am || new Date(b.importiert_am).getTime() <= standTs || String(b.buchungsdatum).slice(0, 10) <= standTag) return;
        const tok = rowTokens(b);
        if (pend.some(function (x) { return sameDeal(b, x, tok); })) return;
        res.spaeterGebucht += betrag;
        verbuchen({ row: b, betrag: betrag, art: 'spaeter-gebucht', item: null }, betrag, tok);
      });
    }
    ['summe', 'zusaetzlich', 'imPosten', 'abgedeckt', 'schonGebucht', 'spaeterGebucht'].forEach(function (k) { res[k] = round2(res[k]); });
    return res;
  }

  // ---------- Die Lage: Wie viel ist bis zum Ende des Finanzmonats (25.) frei? ----------
  // Gerechnet wird immer bis zum 25., unabhängig davon, wer wann Gehalt bekommt.
  function calcLage(state, today, dispo) {
    dispo = Number(dispo) || 0;
    const cs = periodStart(today);
    const end = addPeriods(cs, 1);
    const alle = state.staende || [];
    const stand = alle.find((x) => (x.konto || 'sascha') === 'sascha') || null;
    const luna = alle.find((x) => x.konto === 'luna') || null;
    const einnahmen = (state.einnahmen || []).filter((e) => incomeValid(e, end));
    const next = einnahmen.length ? { date: end, e: einnahmen.find((e) => iso(incomeDate(e, end.getFullYear(), end.getMonth())) === iso(end)) || null } : null;
    const res = { stand: stand, next: next, days: null, offen: 0, offenListe: [], nachStand: 0, vorgemerkt: null, vorgemerktLuna: null, verfuegbar: null, tagesbudget: null, luecke: null, barOffen: 0, dispo: dispo, spielraum: null, luna: luna, gesamt: null };
    if (!next) return res;
    res.days = Math.max(1, daysBetween(today, end));

    // Unbezahlte Posten mit Termin aus dem Vormonat bleiben offen, solange die App
    // in diesem Monat schon genutzt wurde (sonst wären alte, nie abgehakte Monate Geisterschulden).
    const prev = addPeriods(cs, -1);
    const prevTracked = (state.zahlungen || []).some((z) => z.finanzmonat === iso(prev));
    const quellen = prevTracked ? [prev, cs] : [cs];
    const alleItems = [];
    for (const start of quellen) {
      for (const it of itemsForPeriod(state, start, today)) {
        if (start === cs || it.date || it.paid) alleItems.push(it);
        if (it.paid) continue;
        if (start !== cs && !it.date) continue;
        it.periode = iso(start);
        if (it.p.zahlung === 'bar') { if (start === cs) res.barOffen += it.betrag; continue; }
        res.offen += it.betrag;
        res.offenListe.push(it);
      }
    }
    res.offen = round2(res.offen);
    res.barOffen = round2(res.barOffen);

    // Vormerkungen: nur Abzug im Rechenmodell, keine Zahlung wird abgehakt.
    res.vorgemerkt = vorgemerkt(state, today, alleItems, stand, 'sascha');
    res.vorgemerktLuna = vorgemerkt(state, today, [], luna, 'luna');
    res.vorgemerkt.liste.forEach(function (e) { if (e.art === 'posten') e.item.vorgemerkt = e.row; });

    if (stand) {
      const standTs = new Date(stand.erfasst_am).getTime();
      for (const z of state.zahlungen) {
        if (new Date(z.erfasst_am).getTime() > standTs) {
          const p = state.posten.find((x) => x.id === z.posten_id);
          if (p && p.zahlung === 'konto') res.nachStand += num(z.betrag);
        }
      }
      res.nachStand = round2(res.nachStand);
      res.spielraum = round2(num(stand.betrag) + dispo);
      res.verfuegbar = round2(res.spielraum - res.offen - res.nachStand - res.vorgemerkt.zusaetzlich);
      if (luna) res.gesamt = round2(res.verfuegbar + num(luna.betrag) - res.vorgemerktLuna.summe);
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

  // ---------- Bankumsätze: wiederkehrende Abbuchungen ----------
  // Sammelzahlungsdienste: hier zählt der Händler aus dem Verwendungszweck, nicht "PayPal" selbst.
  function bankPayee(x) {
    const name = String(x.gegenpartei || '').trim();
    if (!name) return '';
    if (/^paypal\b/i.test(name)) {
      // Transaktions-/Rechnungsnummern entfernen, damit gleiche Händler zusammenfallen.
      const z = String(x.verwendungszweck || '').replace(/\d{4,}/g, ' ').replace(/[^\p{L}\p{N}& .-]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim();
      return z && !/^(paypal|pp|ihr einkauf bei)?$/i.test(z) ? 'PayPal · ' + z : 'PayPal';
    }
    return name;
  }
  function recurringCandidates(rows) {
    const grouped = {};
    (rows || []).forEach(function (x) {
      const betrag = Number(x.betrag);
      const datum = String(x.buchungsdatum || '');
      if (x.buchungsstatus === 'vorgemerkt' || !(betrag < 0) || !/^\d{4}-\d{2}/.test(datum)) return;
      const name = bankPayee(x);
      if (!name) return;
      const key = name.toLocaleLowerCase('de-DE');
      const g = grouped[key] || (grouped[key] = { name: name, months: {}, count: 0, sum: 0 });
      g.count++; g.sum = round2(g.sum + Math.abs(betrag)); g.months[datum.slice(0, 7)] = true;
    });
    return Object.keys(grouped).map(function (k) { const g = grouped[k]; g.monthCount = Object.keys(g.months).length; return g; })
      .filter(function (g) { return g.monthCount >= 2; })
      .sort(function (a, b) { return b.monthCount - a.monthCount || b.count - a.count || a.name.localeCompare(b.name, 'de'); });
  }

  // ---------- Wochenbudgets: Woche läuft Montag bis Sonntag ----------
  function weekStart(d) {
    const wd = (d.getDay() + 6) % 7; // Montag = 0
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd);
  }
  function wochenStand(state, today) {
    const start = weekStart(today);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    const from = iso(start), to = iso(end);
    const budgets = (state.wbudgets || []).filter((b) => b.aktiv !== false)
      .sort((a, b) => num(a.sortierung) - num(b.sortierung) || String(a.name).localeCompare(String(b.name), 'de'));
    let total = 0, spentTotal = 0;
    const list = budgets.map((b) => {
      const ausgaben = (state.wausgaben || [])
        .filter((x) => x.budget_id === b.id && String(x.datum).slice(0, 10) >= from && String(x.datum).slice(0, 10) < to)
        .sort((a, c) => String(c.datum).localeCompare(String(a.datum)) || String(c.erfasst_am).localeCompare(String(a.erfasst_am)));
      const spent = round2(ausgaben.reduce((v, x) => v + num(x.betrag), 0));
      total += num(b.betrag); spentTotal += spent;
      return { b: b, ausgaben: ausgaben, spent: spent, rest: round2(num(b.betrag) - spent) };
    });
    return { start: start, end: new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1), list: list, total: round2(total), spent: round2(spentTotal), rest: round2(total - spentTotal) };
  }

  const api = {
    weekStart, wochenStand,
    installmentRows, iso, parseISO, daysBetween, parseBetrag, periodStart, addPeriods, occurrence, itemsForPeriod,
    nextIncome, incomeInPeriod, calcLage, monatSummary, vorschau, nextRecurrence, round2, vorgemerkt, bankPayee, recurringCandidates
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : this);
