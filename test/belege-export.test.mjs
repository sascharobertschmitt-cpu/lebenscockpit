import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { exportReceipts, verifyReceiptExport, PAGE_SIZE } from '../scripts/belege-backup-lib.mjs';

const uuidName = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}.jpg`;
const jpeg = i => Buffer.from([0xff, 0xd8, i & 0xff, (i >> 8) & 0xff, 0xff, 0xd9]);

// Minimal fake of the Supabase Storage API. objects: [{ name, bytes, size? }]
async function withStorage(objects, fn, { failDownload } = {}) {
  const lists = [];
  const server = createServer((req, res) => {
    if (req.headers.apikey !== 'test-key' || req.headers.authorization !== 'Bearer test-key') {
      res.writeHead(401).end(); return;
    }
    if (req.method === 'POST' && req.url === '/storage/v1/object/list/belege') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        const { limit, offset, prefix } = JSON.parse(body);
        lists.push({ limit, offset, prefix });
        const page = objects.slice(offset, offset + limit)
          .map(o => ({ name: o.name, id: 'x', metadata: { size: o.size ?? o.bytes?.length } }));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(page));
      });
      return;
    }
    const prefix = '/storage/v1/object/authenticated/belege/';
    if (req.method === 'GET' && req.url.startsWith(prefix)) {
      const obj = objects.find(o => o.name === decodeURIComponent(req.url.slice(prefix.length)));
      if (!obj || failDownload === obj.name) { res.writeHead(failDownload ? 500 : 404).end(); return; }
      res.end(obj.bytes); return;
    }
    res.writeHead(404).end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const dir = await mkdtemp(join(tmpdir(), 'belege-export-test-'));
  try {
    await fn({ base: `http://127.0.0.1:${server.address().port}`, dir, lists });
  } finally {
    await new Promise(r => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
}

test('CLI rejects insecure HTTP endpoints before touching the output directory', async () => {
  await withStorage([], async ({ base, dir }) => {
    const result = spawnSync(process.execPath, ['scripts/export-belege.mjs'], {
      env: { ...process.env, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'test-key', BACKUP_OUTPUT_DIR: dir },
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /https/);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('CLI requires all configuration variables', () => {
  const env = { ...process.env };
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const result = spawnSync(process.execPath, ['scripts/export-belege.mjs'], {
    env: { ...env, SUPABASE_URL: 'https://example.supabase.co', BACKUP_OUTPUT_DIR: tmpdir() },
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 2);
});

test('export downloads original bytes, writes a matching manifest and passes the verifier', async () => {
  const objects = [2, 1].map(i => ({ name: uuidName(i), bytes: jpeg(i) }));
  await withStorage(objects, async ({ base, dir }) => {
    const manifest = await exportReceipts({ base, key: 'test-key', dest: dir });
    assert.equal(manifest.bucket, 'belege');
    assert.deepEqual(manifest.files.map(f => f.name), [uuidName(1), uuidName(2)]);
    for (const o of objects) {
      const onDisk = await readFile(join(dir, 'files', o.name));
      assert.deepEqual(onDisk, o.bytes);
      const entry = manifest.files.find(f => f.name === o.name);
      assert.equal(entry.bytes, o.bytes.length);
      assert.equal(entry.sha256, createHash('sha256').update(o.bytes).digest('hex'));
    }
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')), manifest);
    assert.equal(await verifyReceiptExport(dir), 2);
  });
});

test('export pages through more than one list page without gaps', async () => {
  const objects = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ name: uuidName(i), bytes: jpeg(i) }));
  await withStorage(objects, async ({ base, dir, lists }) => {
    const manifest = await exportReceipts({ base, key: 'test-key', dest: dir });
    assert.equal(manifest.files.length, PAGE_SIZE + 5);
    assert.deepEqual(lists.map(l => l.offset), [0, PAGE_SIZE]);
    assert.equal(await verifyReceiptExport(dir), PAGE_SIZE + 5);
  });
});

test('export of an empty bucket yields a verifiable empty manifest', async () => {
  await withStorage([], async ({ base, dir }) => {
    const manifest = await exportReceipts({ base, key: 'test-key', dest: dir });
    assert.deepEqual(manifest.files, []);
    assert.equal(await verifyReceiptExport(dir), 0);
  });
});

test('export aborts on unexpected object names (folders, traversal, other formats)', async () => {
  for (const name of ['some-folder', '../evil.jpg', uuidName(1).toUpperCase(), uuidName(1).replace('.jpg', '.png')]) {
    await withStorage([{ name, bytes: jpeg(1) }], async ({ base, dir }) => {
      await assert.rejects(exportReceipts({ base, key: 'test-key', dest: dir }), /Unexpected receipt object name/);
    });
  }
});

test('export aborts when downloaded size differs from listed size', async () => {
  await withStorage([{ name: uuidName(1), bytes: jpeg(1), size: 999 }], async ({ base, dir }) => {
    await assert.rejects(exportReceipts({ base, key: 'test-key', dest: dir }), /Size mismatch/);
  });
});

test('export aborts on Storage API errors and with a wrong key', async () => {
  await withStorage([{ name: uuidName(1), bytes: jpeg(1) }], async ({ base, dir }) => {
    await assert.rejects(exportReceipts({ base, key: 'test-key', dest: dir }), /HTTP 500/);
  }, { failDownload: uuidName(1) });
  await withStorage([], async ({ base, dir }) => {
    await assert.rejects(exportReceipts({ base, key: 'wrong-key', dest: dir }), /HTTP 401/);
  });
});

test('export refuses to overwrite an existing export', async () => {
  await withStorage([{ name: uuidName(1), bytes: jpeg(1) }], async ({ base, dir }) => {
    await exportReceipts({ base, key: 'test-key', dest: dir });
    await assert.rejects(exportReceipts({ base, key: 'test-key', dest: dir }), /EEXIST/);
  });
});
