// Copy the live database to a dated backup file and delete old backups.
//
//   node server/backup.js [db file] [backup dir] [days to keep]
//
// Uses SQLite's VACUUM INTO, which makes a consistent copy while the server keeps running.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const dbFile = process.argv[2] || process.env.HOPI_DB || 'data/hopi.db';
const dir = process.argv[3] || process.env.HOPI_BACKUP_DIR || 'data/backups';
const keepDays = Number(process.argv[4] || process.env.HOPI_BACKUP_DAYS || 14);

mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const out = join(dir, `hopi-${stamp}.db`);

const db = new DatabaseSync(dbFile, { readOnly: true });
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();
console.log(`Backed up ${dbFile} → ${out}`);

const cutoff = Date.now() - keepDays * 86400e3;
for (const name of readdirSync(dir)) {
  if (!/^hopi-.*\.db$/.test(name)) continue;
  const file = join(dir, name);
  if (statSync(file).mtimeMs < cutoff) {
    unlinkSync(file);
    console.log(`Removed old backup ${name}`);
  }
}
