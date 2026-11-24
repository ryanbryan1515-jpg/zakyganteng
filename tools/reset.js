/**
 * Deletes the local SQLite database so the next server start re-seeds clean data.
 * Usage: npm run reset
 */
const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
for (const file of ['pizzaky.db', 'pizzaky.db-wal', 'pizzaky.db-shm']) {
  const target = path.join(dataDir, file);
  if (fs.existsSync(target)) {
    fs.rmSync(target);
    console.log('Removed', target);
  }
}
console.log('Database direset. Jalankan `npm start` untuk membuat ulang data awal (admin/admin + produk contoh).');
