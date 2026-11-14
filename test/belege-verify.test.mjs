import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const name = '00000000-0000-4000-8000-000000000001.jpg';
const other = '00000000-0000-4000-8000-000000000002.jpg';
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const entry = (n, b) => ({ name: n, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') });

async function withExport(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'belege-verify-'));
  try {
    await mkdir(join(dir, 'files'));
    for (const [n, b] of Object.entries(files)) await writeFile(join(dir, 'files', n), b);
    const writeManifest = m => writeFile(join(dir, 'manifest.json'), JSON.stringify(m));
    await writeManifest({ bucket: 'belege', files: Object.entries(files).map(([n, b]) => entry(n, b)) });
    const run = () => spawnSync(process.execPath, ['scripts/verify-belege-export.mjs', dir], { encoding: 'utf8' });
    await fn({ dir, run, writeManifest });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('verifier accepts a valid export', async () => {
  await withExport({ [name]: bytes, [other]: Buffer.from('x') }, async ({ run }) => {
    const r = run();
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /Verified 2 receipt objects/);
  });
});

test('verifier rejects tampered bytes', async () => {
  await withExport({ [name]: bytes }, async ({ dir, run }) => {
    await writeFile(join(dir, 'files', name), Buffer.from('tampered'));
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Corrupt object/);
  });
});

test('verifier rejects same-size bit flips (hash, not only size)', async () => {
  await withExport({ [name]: bytes }, async ({ dir, run }) => {
    await writeFile(join(dir, 'files', name), Buffer.from([0xff, 0xd8, 0xff, 0xd8]));
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Corrupt object/);
  });
});

test('verifier rejects missing and extra files', async () => {
  await withExport({ [name]: bytes }, async ({ dir, run }) => {
    await writeFile(join(dir, 'files', other), bytes);
    assert.match(run().stderr, /Manifest\/file mismatch/);
    await unlink(join(dir, 'files', other));
    await unlink(join(dir, 'files', name));
    assert.match(run().stderr, /Manifest\/file mismatch/);
  });
});

test('verifier rejects unsafe names, duplicates and malformed entries', async () => {
  await withExport({ [name]: bytes }, async ({ run, writeManifest }) => {
    for (const bad of ['../manifest.json', 'files/' + name, name.toUpperCase()]) {
      await writeManifest({ bucket: 'belege', files: [{ ...entry(name, bytes), name: bad }] });
      const r = run();
      assert.equal(r.status, 1);
      assert.match(r.stderr, /Unsafe filename/);
    }
    await writeManifest({ bucket: 'belege', files: [entry(name, bytes), entry(name, bytes)] });
    assert.match(run().stderr, /Duplicate manifest entry/);
    await writeManifest({ bucket: 'belege', files: [{ ...entry(name, bytes), sha256: 'abc' }] });
    assert.match(run().stderr, /Invalid manifest entry/);
    await writeManifest({ bucket: 'other', files: [entry(name, bytes)] });
    assert.match(run().stderr, /Invalid manifest/);
  });
});

test('verifier requires a directory argument', () => {
  const r = spawnSync(process.execPath, ['scripts/verify-belege-export.mjs'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});
