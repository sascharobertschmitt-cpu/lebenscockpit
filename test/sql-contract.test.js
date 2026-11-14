// Static SQL contract checks. These do NOT replace isolated PostgreSQL integration tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const task = fs.readFileSync(path.join(root, 'sql/task_completion_atomic.sql'), 'utf8');
const finance = fs.readFileSync(path.join(root, 'sql/account_reconciliation_atomic.sql'), 'utf8');
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
console.log('SQL draft contract checks passed (not a database test)');
