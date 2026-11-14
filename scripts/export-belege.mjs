#!/usr/bin/env node
// Server-only receipt export. Never bundle this file into the frontend.
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and BACKUP_OUTPUT_DIR.
// Exports only bucket 'belege'; caller must encrypt the output before storing it.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dest = process.env.BACKUP_OUTPUT_DIR;
if (!base || !/^https:\/\/[a-z0-9.-]+$/i.test(base) || !key || !dest) {
  console.error('Required: SUPABASE_URL (https), SUPABASE_SERVICE_ROLE_KEY, BACKUP_OUTPUT_DIR');
  process.exit(2);
}
const out = resolve(dest);
const files = join(out, 'files');
await mkdir(files, { recursive: true, mode: 0o700 });
const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function request(path, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { ...headers, ...init.headers } });
  if (!response.ok) throw new Error(`Storage API HTTP ${response.status} at ${path.split('?')[0]}`);
  return response;
}
const manifest = { bucket: 'belege', exported_at: new Date().toISOString(), files: [] };
let offset = 0;
const seen = new Set();
while (true) {
  const response = await request('/storage/v1/object/list/belege', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
  });
  const page = await response.json();
  if (!Array.isArray(page)) throw new Error('Unexpected Storage list response');
  for (const item of page) {
    const name = item.name;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(name))
      throw new Error('Unexpected receipt object name; aborting export');
    if (seen.has(name)) throw new Error('Duplicate Storage object in pagination');
    seen.add(name);
    const fileResponse = await request('/storage/v1/object/authenticated/belege/' + encodeURIComponent(name));
    const bytes = Buffer.from(await fileResponse.arrayBuffer());
    await writeFile(join(files, name), bytes, { flag: 'wx', mode: 0o600 });
    manifest.files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  if (page.length < 100) break;
  offset += page.length;
}
manifest.files.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Receipt export complete: ${manifest.files.length} objects`);
