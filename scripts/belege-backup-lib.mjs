// Server-only helpers for the receipt photo backup. Never bundle into the frontend.
// Shared by scripts/export-belege.mjs and scripts/verify-belege-export.mjs so that
// exporter and verifier cannot drift apart on the accepted object name format.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Matches the storage policy and beleg_pfad constraint: flat "<uuid>.jpg".
export const RECEIPT_OBJECT_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
export const PAGE_SIZE = 100;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Exports every object of bucket 'belege' into dest/files plus dest/manifest.json.
// Transport security (HTTPS only) is enforced by the CLI wrapper, not here, so the
// logic can be tested against a loopback HTTP server.
export async function exportReceipts({ base, key, dest, timeoutMs = 60000 }) {
  base = base.replace(/\/$/, '');
  const out = resolve(dest);
  const files = join(out, 'files');
  await mkdir(files, { recursive: true, mode: 0o700 });
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function request(path, init = {}) {
    const response = await fetch(base + path, {
      ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Storage API HTTP ${response.status} at ${path.split('?')[0]}`);
    return response;
  }
  const manifest = { bucket: 'belege', exported_at: new Date().toISOString(), files: [] };
  const seen = new Set();
  for (let offset = 0; ; ) {
    const response = await request('/storage/v1/object/list/belege', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: PAGE_SIZE, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Unexpected Storage list response');
    for (const item of page) {
      const name = item?.name;
      // Folders, placeholders or foreign names mean the bucket layout is not what the
      // backup expects; abort loudly instead of silently skipping data.
      if (typeof name !== 'string' || !RECEIPT_OBJECT_NAME.test(name))
        throw new Error('Unexpected receipt object name; aborting export');
      if (seen.has(name)) throw new Error('Duplicate Storage object in pagination');
      seen.add(name);
      const fileResponse = await request('/storage/v1/object/authenticated/belege/' + encodeURIComponent(name));
      const bytes = Buffer.from(await fileResponse.arrayBuffer());
      const listedSize = item.metadata?.size;
      if (typeof listedSize === 'number' && listedSize !== bytes.length)
        throw new Error('Size mismatch for ' + name + ' (download incomplete?)');
      await writeFile(join(files, name), bytes, { flag: 'wx', mode: 0o600 });
      manifest.files.push({ name, bytes: bytes.length, sha256: sha256(bytes) });
    }
    if (page.length < PAGE_SIZE) break;
    offset += page.length;
  }
  manifest.files.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return manifest;
}

// Verifies that dir/files contains exactly the objects listed in dir/manifest.json
// with matching size and SHA-256. Throws on any deviation; returns the object count.
export async function verifyReceiptExport(dir) {
  const root = resolve(dir);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
  if (manifest?.bucket !== 'belege' || !Array.isArray(manifest.files)) throw new Error('Invalid manifest');
  const actual = (await readdir(join(root, 'files'))).sort();
  const expected = [];
  for (const entry of manifest.files) {
    if (typeof entry?.name !== 'string' || !RECEIPT_OBJECT_NAME.test(entry.name)) throw new Error('Unsafe filename');
    if (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || typeof entry.sha256 !== 'string' || !SHA256_HEX.test(entry.sha256))
      throw new Error('Invalid manifest entry: ' + entry.name);
    if (expected.includes(entry.name)) throw new Error('Duplicate manifest entry: ' + entry.name);
    expected.push(entry.name);
  }
  expected.sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Manifest/file mismatch');
  for (const entry of manifest.files) {
    const bytes = await readFile(join(root, 'files', entry.name));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error('Corrupt object: ' + entry.name);
  }
  return expected.length;
}
