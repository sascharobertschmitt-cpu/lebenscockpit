#!/usr/bin/env node
// Server-only receipt export. Never bundle this file into the frontend.
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and BACKUP_OUTPUT_DIR.
// Exports only bucket 'belege'; caller must encrypt the output before storing it.
import { exportReceipts } from './belege-backup-lib.mjs';

const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dest = process.env.BACKUP_OUTPUT_DIR;
if (!base || !/^https:\/\/[a-z0-9.-]+$/i.test(base) || !key || !dest) {
  console.error('Required: SUPABASE_URL (https), SUPABASE_SERVICE_ROLE_KEY, BACKUP_OUTPUT_DIR');
  process.exit(2);
}
try {
  const manifest = await exportReceipts({ base, key, dest });
  console.log(`Receipt export complete: ${manifest.files.length} objects`);
} catch (error) {
  // Message only: never print request headers or the key.
  console.error('Receipt export failed: ' + error.message);
  process.exit(1);
}
