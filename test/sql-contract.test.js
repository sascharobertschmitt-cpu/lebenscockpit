// Static SQL contract checks. These do NOT replace isolated PostgreSQL integration tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const task = fs.readFileSync(path.join(root, 'supabase/migrations/20261114200000_task_completion_atomic.sql'), 'utf8');
const finance = fs.readFileSync(path.join(root, 'supabase/migrations/20261114200100_account_reconciliation_idempotent.sql'), 'utf8');
for (const [name, sql] of [['task', task], ['finance', finance]]) {
  assert.match(sql, /SECURITY INVOKER/i, name + ' must respect caller permissions');
  assert.match(sql, /SET search_path = ''/i, name + ' must fix search_path');
  assert.match(sql, /GRANT EXECUTE .* TO authenticated/i, name + ' must limit execution');
  assert.match(sql, /REVOKE ALL .* FROM PUBLIC, anon/i, name + ' must revoke public access');
}
assert.match(task, /FOR UPDATE/i);
assert.match(task, /vorgaenger_id = p_task_id/i);
assert.match(task, /Successor was changed or has descendants/i);
for (const recurrence of ['taeglich', 'woechentlich', 'monatlich', 'jaehrlich']) {
  assert.ok(task.includes("'" + recurrence + "'"));
}
assert.match(finance, /jsonb_typeof\(p_zahlungen\)/i);
assert.match(finance, /ON CONFLICT \(posten_id,finanzmonat\)/i);
assert.match(finance, /Payment amount changed/i);
assert.match(finance, /auth\.uid\(\) IS NULL/i);
assert.match(finance, /auth\.jwt\(\)->>'email'/i);
assert.match(finance, /Incomplete payment/i);

// Migrationshistorie: eindeutige, aufsteigende Versionen, die hinter der letzten in Produktion angewendeten liegen
// (sonst verweigert `supabase db push` die Datei oder ueberschreibt eine bestehende Version).
const dir = path.join(root, 'supabase/migrations');
const PROD_LAST_APPLIED = '20261114163857'; // Stand 14.11.2026, supabase_migrations.schema_migrations
const PROD_APPLIED = new Set(['20261113163928', '20261113165216', '20261113192402', '20261114163857']);
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const versions = files.map((f) => { const m = f.match(/^(\d{14})_[a-z0-9_]+\.sql$/); assert.ok(m, 'Dateiname ungueltig: ' + f); return m[1]; });
assert.equal(new Set(versions).size, versions.length, 'doppelte Migrationsversion');
for (const v of versions) assert.ok(PROD_APPLIED.has(v) || v > PROD_LAST_APPLIED, 'Migration ' + v + ' liegt vor der letzten angewendeten Version ' + PROD_LAST_APPLIED);
for (const f of files.filter((x) => !PROD_APPLIED.has(x.slice(0, 14)))) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\$\$[\s\S]*?\$\$/g, '$$$$'); // Funktionskoerper ausblenden
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|SCHEMA)\b|\bTRUNCATE\s+(TABLE\s+)?public\./i, f + ' enthaelt destruktives DDL');
  if (!/_belege_storage\.sql$/.test(f)) assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE)\b/im, f + ' veraendert Daten'); // einzige Ausnahme: Bucket-Anlage
}
const down = fs.readdirSync(path.join(root, 'supabase/rollback')).map((f) => f.slice(0, 14));
for (const v of versions.filter((x) => !PROD_APPLIED.has(x))) assert.ok(down.includes(v), 'Rollback-Skript fehlt fuer ' + v);
const sec = fs.readFileSync(path.join(dir, '20261114200200_revoke_truncate_from_api_roles.sql'), 'utf8');
assert.match(sec, /REVOKE UPDATE, DELETE ON public\.bankumsaetze FROM authenticated/i);
assert.match(sec, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon/i);
assert.match(fs.readFileSync(path.join(dir, '20261114200300_protect_payment_history.sql'), 'utf8'), /ON DELETE RESTRICT/i);
// Wocheneinkauf: RLS, privater Bucket, keine oeffentlichen Rechte
const ek = fs.readFileSync(path.join(dir, '20261115100000_einkauf_limits_und_einkaeufe.sql'), 'utf8');
assert.match(ek, /ALTER TABLE public\.einkauf_limits ENABLE ROW LEVEL SECURITY/i);
assert.match(ek, /ALTER TABLE public\.einkaeufe ENABLE ROW LEVEL SECURITY/i);
assert.match(ek, /REVOKE ALL ON public\.einkauf_limits, public\.einkaeufe FROM PUBLIC, anon/i);
assert.match(ek, /ON DELETE RESTRICT/i);
const bel = fs.readFileSync(path.join(dir, '20261115100100_belege_storage.sql'), 'utf8');
assert.match(bel, /VALUES \('belege', 'belege', false,/i, 'Bucket muss privat sein');
assert.doesNotMatch(bel, /public\s*=\s*true|TO anon|TO public/i, 'Bucket darf nicht oeffentlich sein');
assert.doesNotMatch(bel, /FOR UPDATE/i, 'Belege sind unveraenderlich');
assert.match(bel, /ist_mitglied/i);
const eg = fs.readFileSync(path.join(dir, '20261115100200_beleg_eingang.sql'), 'utf8');
assert.match(eg, /ALTER TABLE public\.beleg_eingang ENABLE ROW LEVEL SECURITY/i);
assert.match(eg, /SECURITY INVOKER/i); assert.match(eg, /SET search_path = ''/i);
assert.match(eg, /REVOKE ALL ON FUNCTION public\.beleg_zuordnen.* FROM PUBLIC, anon/i);
assert.match(eg, /GRANT EXECUTE ON FUNCTION public\.beleg_zuordnen.* TO authenticated/i);
assert.match(eg, /FOR UPDATE/i, 'Zuordnen muss die Eingangszeile sperren (parallele Aufrufe)');
assert.match(eg, /beleg_pfad = id::text \|\| '\.jpg'/i, 'Pfad immer <id>.jpg');
console.log('SQL contract checks passed (static, not a database test)');
