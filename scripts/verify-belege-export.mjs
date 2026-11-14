#!/usr/bin/env node
// Verifies a receipt export directory (manifest.json + files/) before encryption.
import { verifyReceiptExport } from './belege-backup-lib.mjs';

const dir = process.argv[2];
if (!dir) { console.error('Usage: node scripts/verify-belege-export.mjs DIRECTORY'); process.exit(2); }
try {
  const count = await verifyReceiptExport(dir);
  console.log(`Verified ${count} receipt objects`);
} catch (error) {
  console.error('Receipt backup verification failed: ' + error.message);
  process.exit(1);
}
