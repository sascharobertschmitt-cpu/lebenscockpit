#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/verify-belege-export.mjs DIRECTORY'); process.exit(2); }
const root = resolve(dir);
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (manifest.bucket !== 'belege' || !Array.isArray(manifest.files)) throw new Error('Invalid manifest');
const actual = (await readdir(join(root, 'files'))).sort();
const expected = [];
for (const entry of manifest.files) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(entry.name))
    throw new Error('Unsafe filename');
  const bytes = await readFile(join(root, 'files', entry.name));
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
    throw new Error('Corrupt object: ' + entry.name);
  expected.push(entry.name);
}
expected.sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Manifest/file mismatch');
console.log(`Verified ${expected.length} receipt objects`);
