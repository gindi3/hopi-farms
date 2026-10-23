// Hopi Farms server: serves the game files and an API that owns every farm.
// The browser sends actions; the server applies them with game.js rules, its own clock and
// its own randomness, so a player can't hand it a doctored save.
//
//   node server/index.js            # http://localhost:5180
//   PORT=8080 HOPI_DB=/var/lib/hopi/hopi.db node server/index.js
//
// Env: PORT, HOST, HOPI_DB, HOPI_DEV_SPEED (testing only), HOPI_ALLOWED_ORIGINS (comma list
// for CORS, e.g. https://gindi3.github.io), HOPI_TRUST_PROXY=1 (behind nginx).

import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as G from '../js/game.js';
import { applyAction } from '../js/actions.js';
import { openDb } from './db.js';
import { adminRoutes, actionStats, dayOf } from './admin.js';
import { createDeposits, depositConfig } from './deposits.js';
import { applyEconomy, snapshotEconomy, economyVersion, DEFAULT_ECONOMY, withDefaults } from '../js/economy.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIRS = new Set(['css', 'js', 'brand']);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
// Cloudflare injects its Web Analytics beacon from static.cloudflareinsights.com and the
// beacon reports to cloudflareinsights.com.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-ancestors 'none'",
].join('; ');
const MAX_BODY = 8 * 1024;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

// A fingerprint of the game's files. The page loads its code from /v/<build>/…, so every
// deploy gets fresh URLs and no browser or CDN cache can serve stale code.
export function computeBuild(root = ROOT) {
  const hash = createHash('sha256');
  const files = ['index.html', 'admin.html'];
  for (const dir of STATIC_DIRS) {
    for (const name of readdirSync(join(root, dir)).sort()) files.push(`${dir}/${name}`);
  }
  for (const f of files) hash.update(f).update(readFileSync(join(root, f)));
  return hash.digest('hex').slice(0, 12);
}
const VERSIONED = /^\/v\/([0-9a-f]{6,40})(\/.*)$/;

export function createServer({
  dbFile = ':memory:',
  devSpeed = 1,
  allowedOrigins = [],
  trustProxy = false,
  rateLimits = true,      // tests turn this off
  deposits: depositOpts = {},   // { config, rpc, pollMs } for tests; defaults read the env
  log = console,
} = {}) {
  const store = openDb(dbFile);
  const build = computeBuild();

  // The economy is shared module state: start from the saved one (or the defaults).
  try {
    applyEconomy(withDefaults(store.getSetting('economy')));
  } catch (e) {
    log.error('Saved economy is invalid; using defaults.', e);
    applyEconomy(DEFAULT_ECONOMY);
  }
  let econ = economyVersion(snapshotEconomy());
  const limits = rateLimits ? new RateLimiter() : { hit: () => true };
  const rng = () => randomInt(0, 2 ** 47) / 2 ** 47;

  // --- Auth helpers ----------------------------------------------------------

  const hashToken = (token) => createHash('sha256').update(token).digest('hex');

  function newSession(userId) {
    const token = randomBytes(32).toString('base64url');
    store.createSession(hashToken(token), userId, Date.now());
    return token;
  }

  function sessionUserId(req) {
    const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(req.headers.authorization || '');
    return m ? store.sessionUser(hashToken(m[1]), Date.now()) : null;
  }

  function loadFarm(userId) {
    const json = store.getFarm(userId);
    return (json && G.deserialize(json)) || G.newGame();
  }

  function userInfo(userId) {
    const u = store.userById(userId);
    return { username: u?.username ?? null, guest: !u?.username };
  }

  // Behind Cloudflare (tunnel or proxy) the visitor's IP arrives in a header. Only trust it
  // when the server is reachable through that proxy alone (HOPI_TRUST_PROXY=1, bound to 127.0.0.1).
  function clientIp(req) {
    if (trustProxy) {
      const cf = String(req.headers['cf-connecting-ip'] || '').trim();
      if (cf) return cf;
      const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  // --- Routes ----------------------------------------------------------------

  const routes = {
    'POST /api/guest': (req) => {
      if (!limits.hit(`guest:${clientIp(req)}`, 20, 3600e3)) return tooMany();
      const now = Date.now();
      const userId = store.createUser(now);
      const state = G.newGame();
      store.putFarm(userId, state, now);
      store.bumpStats(dayOf(now), { new_players: 1 });
      return ok({ token: newSession(userId), user: userInfo(userId), state, now });
    },

    'GET /api/me': (req, { userId }) => ok({ user: userInfo(userId), state: loadFarm(userId), now: Date.now() }),

    'POST /api/action': (req, { userId, body }) => {
      if (!limits.hit(`act:${userId}`, 40, 1000)) return tooMany();
      if (!body || typeof body.type !== 'string') return bad('Missing action.');
      const state = loadFarm(userId);
      const now = Date.now();
      try {
        const before = { coins: state.coins, gems: state.gems };
        const result = applyAction(state, body, { now, rng, speed: devSpeed });
        store.putFarm(userId, state, now);
        store.bumpStats(dayOf(now), actionStats(body, before, state, result));
        return ok({ state, result, now });
      } catch (e) {
        if (e instanceof G.GameError) return bad(e.message);
        throw e;
      }
    },

    'POST /api/register': (req, { userId, body }) => {
      if (!limits.hit(`auth:${clientIp(req)}`, 20, 900e3)) return tooMany();
      const user = store.userById(userId);
      if (user.username) return bad('This farm already has an account.');
      const username = String(body?.username || '');
      const password = String(body?.password || '');
      if (!USERNAME_RE.test(username)) return bad('Usernames are 3–20 letters, numbers or underscores.');
      if (password.length < 8 || password.length > 200) return bad('Passwords need at least 8 characters.');
      if (store.userByName(username)) return bad('That username is taken.');
      store.setCredentials(userId, username, hashPassword(password));
      store.bumpStats(dayOf(Date.now()), { registrations: 1 });
      return ok({ user: userInfo(userId) });
    },

    'POST /api/login': (req, { body }) => {
      if (!limits.hit(`auth:${clientIp(req)}`, 20, 900e3)) return tooMany();
      const user = store.userByName(String(body?.username || ''));
      if (!user || !checkPassword(String(body?.password || ''), user.pass_hash)) {
        return bad('Wrong username or password.', 401);
      }
      return ok({ token: newSession(user.id), user: userInfo(user.id), state: loadFarm(user.id), now: Date.now() });
    },

    'POST /api/logout': (req) => {
      const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || '');
      if (m) store.deleteSession(hashToken(m[1]));
      return ok({});
    },

    // Current prices and odds, so every client computes the same numbers as the server.
    // Also says whether $CROP deposits are open, and the token's contract address.
    'GET /api/economy': () => ok({ economy: snapshotEconomy(), crop: deposits.publicInfo() }),

    'GET /api/leaderboard': (req, { userId }) => {
      const rows = store.leaderboard(25);
      const top = rows.map((r, i) => ({ rank: i + 1, name: r.name, level: r.level, xp: r.xp, you: r.user_id === userId }));
      let you = null;
      if (userId) {
        const s = loadFarm(userId);
        you = { rank: store.rankOf(s.xp), xp: s.xp, level: s.level, name: s.name };
      }
      return ok({ top, you, players: store.farmCount() });
    },
  };
  const PUBLIC = new Set(['POST /api/guest', 'POST /api/login', 'POST /api/logout', 'GET /api/leaderboard', 'GET /api/economy']);
  const deposits = createDeposits({
    store, ok, bad, loadFarm, log,
    config: depositOpts.config || depositConfig(),
    rpc: depositOpts.rpc,
    pollMs: depositOpts.pollMs,
  });
  Object.assign(routes, deposits.routes);
  const admin = {
    ...adminRoutes({
      store, ok, bad, loadFarm,
      onEconomyChange: () => { econ = economyVersion(snapshotEconomy()); },
    }),
    ...deposits.adminRoutes,
  };
  if (depositOpts.autoStart !== false) deposits.start();

  // --- HTTP plumbing ---------------------------------------------------------

  const server = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      }
      if (req.method === 'OPTIONS') return send(res, { status: 204 });

      if (url.pathname.startsWith('/api/')) {
        const key = `${req.method} ${url.pathname}`;
        const isAdminRoute = url.pathname.startsWith('/api/admin/');
        const handler = isAdminRoute ? admin[key] : routes[key];
        if (!handler) return send(res, bad('Not found.', 404));
        const userId = sessionUserId(req);
        if (!userId && !PUBLIC.has(key)) return send(res, bad('Please sign in again.', 401));
        if (isAdminRoute && !store.isAdmin(userId)) return send(res, bad('This account is not an admin.', 403));
        const body = req.method === 'POST' ? await readJson(req) : null;
        if (body === INVALID) return send(res, bad('Bad request body.'));
        const out = await handler(req, { userId, body, url });
        if (out.status === 200 && out.json) Object.assign(out.json, { build, econ });
        return send(res, out);
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, bad('Not found.', 404));
      if (url.pathname === '/config.js') {
        return send(res, { status: 200, type: TYPES['.js'], body: "window.HOPI_API = '/api';\n" });
      }
      const v = VERSIONED.exec(url.pathname);
      if (v) {
        const file = await staticFile(v[2]);
        // The current build's files never change, so they can be cached for good.
        if (file.status === 200 && v[1] === build) file.cache = 'public, max-age=31536000, immutable';
        return send(res, file);
      }
      const pages = { '/': 'index.html', '/index.html': 'index.html', '/admin': 'admin.html', '/admin.html': 'admin.html' };
      if (pages[url.pathname]) {
        const page = await staticFile(`/${pages[url.pathname]}`);
        page.body = String(page.body)
          .replace(/(href|src)="((?:css|js|brand)\/[^"]+)"/g, `$1="/v/${build}/$2"`);
        return send(res, page);
      }
      return send(res, await staticFile(url.pathname));
    } catch (e) {
      log.error(e);
      send(res, bad('Something went wrong.', 500));
    }
  });

  // Every new browser gets a guest farm; clear out the ones nobody played after a day.
  const pruneEmptyGuests = () => {
    const n = store.pruneGuests(Date.now() - 24 * 3600e3);
    if (n) log.info?.(`Removed ${n} unplayed guest farm${n === 1 ? '' : 's'}.`);
  };
  pruneEmptyGuests();
  const pruneTimer = setInterval(pruneEmptyGuests, 3600e3);
  pruneTimer.unref();

  server.on('close', () => { clearInterval(pruneTimer); deposits.stop(); store.close(); });
  server.deposits = deposits;   // for tests
  server.store = store;   // for tests and the admin CLI-style setup in tests
  return server;
}

// --- Responses ---------------------------------------------------------------

const ok = (data) => ({ status: 200, json: data });
const bad = (error, status = 400) => ({ status, json: { error } });
const tooMany = () => bad('Slow down a little and try again.', 429);

function send(res, { status, json, type, body, cache = 'no-cache' }) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', CSP);
  if (json !== undefined) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(json));
  } else {
    res.writeHead(status, type ? { 'Content-Type': type, 'Cache-Control': cache } : {});
    res.end(body);
  }
}

const INVALID = Symbol('invalid');

function readJson(req) {
  return new Promise((resolveBody) => {
    let size = 0;
    const chunks = [];
    // Past the limit, keep draining but stop storing, then answer with an error.
    req.on('data', (c) => {
      size += c.length;
      if (size <= MAX_BODY) chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return resolveBody(INVALID);
      if (!chunks.length) return resolveBody({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolveBody(v && typeof v === 'object' && !Array.isArray(v) ? v : INVALID);
      } catch {
        resolveBody(INVALID);
      }
    });
    req.on('error', () => resolveBody(INVALID));
  });
}

async function staticFile(pathname) {
  let rel = pathname === '/' ? 'index.html' : normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const top = rel.split(/[/\\]/)[0];
  if (rel !== 'index.html' && rel !== 'admin.html' && !STATIC_DIRS.has(top)) return bad('Not found.', 404);
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT + '/')) return bad('Not found.', 404);
  const type = TYPES[extname(file)];
  if (!type) return bad('Not found.', 404);
  try {
    return { status: 200, type, body: await readFile(file) };
  } catch {
    return bad('Not found.', 404);
  }
}

// --- Passwords ---------------------------------------------------------------

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function checkPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

// --- Rate limiting (fixed window, in memory) ---------------------------------

class RateLimiter {
  constructor() { this.hits = new Map(); }
  hit(key, max, windowMs) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || now - e.start >= windowMs) {
      e = { start: now, n: 0 };
      this.hits.set(key, e);
      if (this.hits.size > 50000) this.prune(now);
    }
    e.n++;
    return e.n <= max;
  }
  prune(now) {
    for (const [k, e] of this.hits) if (now - e.start > 3600e3) this.hits.delete(k);
  }
}

// --- Entry point ---------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5180;
  const host = process.env.HOST || '127.0.0.1';
  const devSpeed = Math.max(1, Number(process.env.HOPI_DEV_SPEED) || 1);
  const server = createServer({
    dbFile: process.env.HOPI_DB || join(ROOT, 'data', 'hopi.db'),
    devSpeed,
    allowedOrigins: (process.env.HOPI_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: process.env.HOPI_TRUST_PROXY === '1',
  });
  server.listen(port, host, () => {
    console.log(`Hopi Farms server on http://${host}:${port}${devSpeed > 1 ? ` (dev speed ×${devSpeed})` : ''}`);
  });
}
