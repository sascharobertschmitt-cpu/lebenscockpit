// Run with: node test/belege-static.test.js
// Static regression checks, not a substitute for database/browser integration tests.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root,p),'utf8');
const meta = read('sql/belege/01_metadaten.sql');
const bucket = read('sql/belege/02_bucket.sql');
const policies = read('sql/belege/03_storage_policies.sql');
const app = read('app.js');
assert.match(meta,/enable row level security/i);
assert.match(meta,/private\.ist_mitglied\(\)/);
assert.match(meta,/hochgeladen_von\s*=\s*\(select auth\.uid\(\)\)/);
assert.match(meta,/on delete set null/);
assert.match(bucket,/false,10485760/);
assert.match(policies,/for insert to authenticated/i);
assert.match(policies,/for select to authenticated/i);
assert.doesNotMatch(policies,/for delete|for update|alter table storage\.objects owner/i);
assert.match(policies,/exists\s*\(\s*select 1 from public\.belege/i);
assert.match(app,/data-form="beleg-upload"/);
assert.match(app,/createSignedUrl\(path, 60\)/);
assert.match(app,/upsert: false/);
console.log('Belege static regression checks passed (not an integration test).');
