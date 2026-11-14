import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

test('receipt backup verifier accepts valid bytes and rejects tampering', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'belege-verify-'));
  const name = '00000000-0000-4000-8000-000000000001.jpg';
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  try {
    await mkdir(join(dir, 'files'));
    await writeFile(join(dir, 'files', name), bytes);
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({
      bucket: 'belege', files: [{ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]
    }));
    const run = () => spawnSync(process.execPath, ['scripts/verify-belege-export.mjs', dir], { encoding: 'utf8' });
    const initial = run();
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    await writeFile(join(dir, 'files', name), Buffer.from('tampered'));
    assert.notEqual(run().status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
