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
  `);

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
    close: () => db.close(),
  };
}
