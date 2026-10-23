// SQLite storage for accounts, sessions and farms (Node's built-in node:sqlite).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY,
      username   TEXT UNIQUE COLLATE NOCASE,   -- null while the player is a guest
      pass_hash  TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL
    );

    -- The farm itself is one JSON document; name/level/xp are copied out for the leaderboard.
    CREATE TABLE IF NOT EXISTS farms (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state      TEXT NOT NULL,
      name       TEXT NOT NULL,
      level      INTEGER NOT NULL,
      xp         INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS farms_xp ON farms (xp DESC);

    -- Saved settings, e.g. the economy the admin dashboard edits.
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Running daily totals for the dashboard (pulls, coins in/out, new players, ...).
    CREATE TABLE IF NOT EXISTS daily_stats (
      day   TEXT NOT NULL,
      key   TEXT NOT NULL,
      value REAL NOT NULL,
      PRIMARY KEY (day, key)
    );

    -- Every change made from the admin dashboard.
    CREATE TABLE IF NOT EXISTS admin_log (
      id         INTEGER PRIMARY KEY,
      at         INTEGER NOT NULL,
      admin      TEXT NOT NULL,
      action     TEXT NOT NULL,
      details    TEXT NOT NULL
    );
  `);
  // Added after launch: the admin flag on accounts.
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');

  const q = {
    insertUser: db.prepare('INSERT INTO users (created_at) VALUES (?)'),
    userById: db.prepare('SELECT id, username, pass_hash FROM users WHERE id = ?'),
    userByName: db.prepare('SELECT id, username, pass_hash FROM users WHERE username = ?'),
    setCredentials: db.prepare('UPDATE users SET username = ?, pass_hash = ? WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)'),
    sessionUser: db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?'),
    touchSession: db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    getFarm: db.prepare('SELECT state FROM farms WHERE user_id = ?'),
    putFarm: db.prepare(`
      INSERT INTO farms (user_id, state, name, level, xp, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET state = excluded.state, name = excluded.name,
        level = excluded.level, xp = excluded.xp, updated_at = excluded.updated_at`),
    top: db.prepare('SELECT user_id, name, level, xp FROM farms ORDER BY xp DESC, user_id ASC LIMIT ?'),
    rankOf: db.prepare('SELECT COUNT(*) AS ahead FROM farms WHERE xp > ?'),
    farmCount: db.prepare('SELECT COUNT(*) AS n FROM farms'),
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    putSetting: db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'),
    bumpStat: db.prepare(`INSERT INTO daily_stats (day, key, value) VALUES (?, ?, ?)
      ON CONFLICT (day, key) DO UPDATE SET value = value + excluded.value`),
    statsSince: db.prepare('SELECT day, key, value FROM daily_stats WHERE day >= ? ORDER BY day'),
    statTotals: db.prepare('SELECT key, SUM(value) AS value FROM daily_stats GROUP BY key'),
    setAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE username = ?'),
    isAdmin: db.prepare('SELECT is_admin FROM users WHERE id = ?'),
    allFarms: db.prepare(`SELECT f.user_id, f.state, f.updated_at, u.username, u.created_at, u.is_admin
      FROM farms f JOIN users u ON u.id = f.user_id`),
    farmRow: db.prepare(`SELECT f.user_id, f.state, f.updated_at, u.username, u.created_at, u.is_admin
      FROM farms f JOIN users u ON u.id = f.user_id WHERE f.user_id = ?`),
    addLog: db.prepare('INSERT INTO admin_log (at, admin, action, details) VALUES (?, ?, ?, ?)'),
    recentLog: db.prepare('SELECT at, admin, action, details FROM admin_log ORDER BY id DESC LIMIT ?'),
  };

  return {
    db,
    createUser(now) {
      return Number(q.insertUser.run(now).lastInsertRowid);
    },
    userById: (id) => q.userById.get(id),
    userByName: (name) => q.userByName.get(name),
    setCredentials: (id, username, passHash) => q.setCredentials.run(username, passHash, id),
    createSession(tokenHash, userId, now) { q.insertSession.run(tokenHash, userId, now, now); },
    sessionUser(tokenHash, now) {
      const row = q.sessionUser.get(tokenHash);
      if (!row) return null;
      q.touchSession.run(now, tokenHash);
      return row.user_id;
    },
    deleteSession: (tokenHash) => q.deleteSession.run(tokenHash),
    getFarm(userId) {
      const row = q.getFarm.get(userId);
      return row ? row.state : null;
    },
    putFarm(userId, state, now) {
      q.putFarm.run(userId, JSON.stringify(state), state.name, state.level, state.xp, now);
    },
    leaderboard(limit) {
      return q.top.all(limit);
    },
    rankOf(xp) {
      return q.rankOf.get(xp).ahead + 1;
    },
    farmCount: () => q.farmCount.get().n,
    getSetting(key) {
      const row = q.getSetting.get(key);
      return row ? JSON.parse(row.value) : null;
    },
    putSetting: (key, value) => q.putSetting.run(key, JSON.stringify(value)),
    // Add amounts to today's running totals, e.g. { 'pulls:pico': 3, coins_out: 60 }.
    bumpStats(day, amounts) {
      for (const [key, value] of Object.entries(amounts)) if (value) q.bumpStat.run(day, key, value);
    },
    statsSince: (day) => q.statsSince.all(day),
    statTotals: () => Object.fromEntries(q.statTotals.all().map(r => [r.key, r.value])),
    setAdmin: (username, on) => q.setAdmin.run(on ? 1 : 0, username).changes,
    isAdmin: (userId) => Boolean(q.isAdmin.get(userId)?.is_admin),
    allFarms: () => q.allFarms.all(),
    farmRow: (userId) => q.farmRow.get(userId),
    addLog: (admin, action, details, now) => q.addLog.run(now, admin, action, JSON.stringify(details)),
    recentLog: (limit) => q.recentLog.all(limit).map(r => ({ ...r, details: JSON.parse(r.details) })),
    close: () => db.close(),
  };
}
