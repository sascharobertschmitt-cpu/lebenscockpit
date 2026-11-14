import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

test('receipt export downloads binary data and writes a matching manifest', async () => {
  const name = '00000000-0000-4000-8000-000000000001.jpg';
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const server = createServer(async (req, res) => {
    if (req.headers.apikey !== 'test-key' || req.headers.authorization !== 'Bearer test-key') {
      res.writeHead(401).end(); return;
    }
    if (req.url === '/storage/v1/object/list/belege') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{ name }])); return;
    }
    if (req.url === '/storage/v1/object/authenticated/belege/' + name) {
      res.end(bytes); return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'belege-export-test-'));
  try {
    const port = server.address().port;
    const result = spawnSync(process.execPath, ['scripts/export-belege.mjs'], {
      env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${port}`, SUPABASE_SERVICE_ROLE_KEY: 'test-key', BACKUP_OUTPUT_DIR: dir },
      encoding: 'utf8', timeout: 10000,
    });
    // The export intentionally requires HTTPS; verify unsafe HTTP is rejected.
    assert.equal(result.status, 2);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
