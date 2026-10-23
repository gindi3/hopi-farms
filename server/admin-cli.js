// Manage dashboard admins from the server's shell.
//
//   node server/admin-cli.js grant <username>    # make an account an admin
//   node server/admin-cli.js revoke <username>
//   node server/admin-cli.js list
//
// The account must already exist (sign up in the game first). Uses HOPI_DB, like the server.

import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = openDb(process.env.HOPI_DB || join(ROOT, 'data', 'hopi.db'));
const [cmd, username] = process.argv.slice(2);

if ((cmd === 'grant' || cmd === 'revoke') && username) {
  const changed = store.setAdmin(username, cmd === 'grant');
  if (!changed) {
    console.error(`No account named "${username}". Sign up in the game first (click your name → Save your farm).`);
    process.exit(1);
  }
  console.log(cmd === 'grant' ? `${username} is now an admin. Open /admin while signed in.` : `${username} is no longer an admin.`);
} else if (cmd === 'list') {
  const rows = store.db.prepare('SELECT username FROM users WHERE is_admin = 1 ORDER BY username').all();
  console.log(rows.length ? rows.map(r => r.username).join('\n') : 'No admins yet.');
} else {
  console.log('Usage: node server/admin-cli.js grant|revoke <username>  |  list');
  process.exit(1);
}
store.close();
