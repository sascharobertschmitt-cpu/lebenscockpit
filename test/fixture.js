// [id, name, betrag, tag, rhythmus, zahlung, ab, bis, status]
const rows = [
  ['creditplus', 'Creditplus', 651.17, 30, 'monatlich', 'konto'],
  ['auto1', 'Autokredit (reduziert)', 86.00, 15, 'monatlich', 'konto', null, '2027-02-28'],
  ['auto2', 'Autokredit (volle Rate)', 171.80, 15, 'monatlich', 'konto', '2027-03-01', null],
  ['anyfin', 'Anyfin', 20.60, 30, 'monatlich', 'konto'],
  ['otto1', 'Otto (Rate 1)', 47.09, 6, 'monatlich', 'konto'],
  ['otto2', 'Otto (Rate 2)', 7.90, 29, 'monatlich', 'konto'],
  ['key', 'Key Academy', 24.24, 15, 'monatlich', 'konto'],
  ['energis', 'Energis', 156.00, null, 'monatlich', 'konto'],
  ['gericht', 'Gericht Luna', 50.00, 15, 'monatlich', 'konto'],
  ['rf1', 'Rundfunk (Sascha)', 30.00, 15, 'monatlich', 'konto'],
  ['rf2', 'Rundfunk (Luna)', 30.00, 15, 'monatlich', 'konto'],
  ['paypal', 'PayPal/Kirstein', 6.47, 6, 'monatlich', 'konto'],
  ['allianz', 'Allianz/CBP', 7.78, 1, 'monatlich', 'konto'],
  ['neo', 'Neodigital', 5.93, 6, 'monatlich', 'konto'],
  ['generali', 'Generali', 7.03, 15, 'monatlich', 'konto'],
  ['dkv', 'DKV', 11.52, 16, 'monatlich', 'konto'],
  ['axa', 'AXA', 46.71, 19, 'monatlich', 'konto'],
  ['wuert', 'Württembergische', 26.34, 15, 'monatlich', 'konto'],
  ['starlink', 'Starlink', 49.00, 1, 'monatlich', 'konto'],
  ['db', 'DB', 63.00, 1, 'monatlich', 'konto'],
  ['ionos', 'IONOS', 2.50, 1, 'monatlich', 'konto'],
  ['otelo', 'Otelo', 24.99, 14, 'monatlich', 'konto'],
  ['congstar', 'Congstar', 10.00, null, 'monatlich', 'konto'],
  ['apple1', 'Apple (0,99 €)', 0.99, 9, 'monatlich', 'konto'],
  ['apple2', 'Apple (2,99 €)', 2.99, 9, 'monatlich', 'konto'],
  ['disney', 'Disney+', 6.99, 16, 'monatlich', 'konto'],
  ['chatgpt', 'ChatGPT', 23.00, 16, 'monatlich', 'konto'],
  ['ps', 'PlayStation', 16.99, 19, 'monatlich', 'konto'],
  ['adobe', 'Adobe (letzte Abbuchung)', 35.69, null, 'einmalig', 'konto'],
  ['kontogeb', 'Kontogebühr', 9.00, 30, 'monatlich', 'konto'],
  ['wohnen_konto', 'Wohnkosten (vom Konto)', 60.00, null, 'monatlich', 'konto'],
  ['wohnen_bar', 'Wohnkosten (bar reserviert)', 240.00, null, 'monatlich', 'bar']
];
const posten = rows.map((r) => ({
  id: r[0], name: r[1], betrag: r[2], tag_im_monat: r[3], rhythmus: r[4], zahlung: r[5],
  gueltig_ab: r[6] || null, gueltig_bis: r[7] || null, faellig_am: null
}));
const einnahmen = [
  { id: 'e1', person: 'Sascha', betrag: 1978, tag_im_monat: 25, aktiv: true },
  { id: 'e2', person: 'Luna', betrag: 1200, tag_im_monat: 10, aktiv: true }
];

module.exports = { posten, einnahmen };
