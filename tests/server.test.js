import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createServer } from '../server/index.js';

let server, base;

before(async () => {
  server = createServer({ dbFile: ':memory:', devSpeed: 3600 * 1000, rateLimits: false, log: { error() {}, info() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

async function call(method, path, { token, body, raw } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
}

const guest = async () => (await call('POST', '/api/guest')).data;

test('guest gets a fresh farm and a token', async () => {
  const g = await guest();
  assert.ok(g.token.length > 20);
  assert.equal(g.state.coins, 100);
  assert.equal(g.user.guest, true);
  const me = await call('GET', '/api/me', { token: g.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.state.coins, 100);
});

test('actions change the saved farm; the server keeps the result', async () => {
  const g = await guest();
  const r = await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'pico' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.state.coins, 80);
  const cropId = r.data.result.results[0].cropId;
  assert.ok(cropId);
  const me = await call('GET', '/api/me', { token: g.token });
  assert.equal(me.data.state.coins, 80);
  assert.equal(me.data.state.seeds[cropId], 1);
});

test('plant, then harvest using the server clock', async () => {
  const g = await guest();
  const p = await call('POST', '/api/action', { token: g.token, body: { type: 'plantAll' } });
  assert.equal(p.data.result.n, 5);
  await new Promise((r) => setTimeout(r, 30)); // dev speed makes 24h take ~24ms
  const h = await call('POST', '/api/action', { token: g.token, body: { type: 'harvestAll' } });
  assert.equal(h.data.result.n, 5);
  assert.ok(h.data.state.coins > 100);
});

test('the client cannot set its own coins', async () => {
  const g = await guest();
  const r = await call('POST', '/api/action', { token: g.token, body: { type: 'setCoins', coins: 1e9 } });
  assert.equal(r.status, 400);
  const reset = await call('POST', '/api/action', { token: g.token, body: { type: 'reset' } });
  assert.equal(reset.status, 400);
  const r2 = await call('POST', '/api/action', { token: g.token, body: { type: 'rename', name: 'x', coins: 1e9 } });
  assert.equal(r2.data.state.coins, 100);
});

test('buy up to 9 packs at once, all or nothing', async () => {
  const g = await guest();
  const three = await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'pico', count: 3 } });
  assert.equal(three.status, 200);
  assert.equal(three.data.result.results.length, 3);
  assert.equal(three.data.state.coins, 40);
  const tooMany = await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'feeble', count: 10 } });
  assert.equal(tooMany.status, 400);
  const cantAfford = await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'pico', count: 3 } });
  assert.equal(cantAfford.status, 400);
  assert.equal(cantAfford.data.error, 'You need 60 coins for 3 Pico packs.');
  const me = await call('GET', '/api/me', { token: g.token });
  assert.equal(me.data.state.coins, 40); // nothing charged for the refused batch
  const nine = await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'feeble', count: 9 } });
  assert.equal(nine.data.result.results.length, 9);
  assert.equal(nine.data.state.coins, 31);
});

test('game rule errors come back as 400 with a message', async () => {
  const g = await guest();
  const r = await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'premium' } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /You need 800 coins/);
  const bad = await call('POST', '/api/action', { token: g.token, body: { type: 'plant', plot: '1.5', cropId: 'f_potato' } });
  assert.equal(bad.status, 400);
});

test('requests without a valid session are refused', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/action', { token: 'x'.repeat(40), body: { type: 'levelUp' } })).status, 401);
});

test('register a guest, sign in elsewhere, sign out', async () => {
  const g = await guest();
  await call('POST', '/api/action', { token: g.token, body: { type: 'rename', name: 'Sunny Acres' } });
  const reg = await call('POST', '/api/register', { token: g.token, body: { username: 'sunny_1', password: 'hunter22!' } });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.user.username, 'sunny_1');

  const dup = await call('POST', '/api/register', { token: (await guest()).token, body: { username: 'SUNNY_1', password: 'whatever123' } });
  assert.match(dup.data.error, /taken/);

  const wrong = await call('POST', '/api/login', { body: { username: 'sunny_1', password: 'nope-nope' } });
  assert.equal(wrong.status, 401);

  const login = await call('POST', '/api/login', { body: { username: 'sunny_1', password: 'hunter22!' } });
  assert.equal(login.status, 200);
  assert.equal(login.data.state.name, 'Sunny Acres');

  await call('POST', '/api/logout', { token: login.data.token });
  assert.equal((await call('GET', '/api/me', { token: login.data.token })).status, 401);
});

test('names are cleaned of markup', async () => {
  const g = await guest();
  const r = await call('POST', '/api/action', { token: g.token, body: { type: 'rename', name: '<img src=x>Bob' } });
  assert.equal(r.data.state.name, 'img src=xBob');
});

test('leaderboard ranks by XP and marks you', async () => {
  const g = await guest();
  await call('POST', '/api/action', { token: g.token, body: { type: 'rename', name: 'Leader' } });
  for (let i = 0; i < 5; i++) await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'pico' } });
  const lb = await call('GET', '/api/leaderboard', { token: g.token });
  assert.equal(lb.status, 200);
  const mine = lb.data.top.find(r => r.you);
  assert.equal(mine.name, 'Leader');
  assert.equal(mine.rank, lb.data.you.rank);
  const xps = lb.data.top.map(r => r.xp);
  assert.deepEqual(xps, [...xps].sort((a, b) => b - a));
  assert.ok(!('user_id' in lb.data.top[0]));
});

test('static files are served; server code and data are not', async () => {
  assert.equal((await call('GET', '/')).status, 200);
  assert.equal((await call('GET', '/js/game.js')).status, 200);
  assert.match((await call('GET', '/config.js')).data, /HOPI_API = '\/api'/);
  assert.equal((await call('GET', '/server/index.js')).status, 404);
  assert.equal((await call('GET', '/package.json')).status, 404);
  assert.equal((await call('GET', '/js/../server/db.js')).status, 404);
  assert.equal((await call('GET', '/%2e%2e/package.json')).status, 404);
});

test('bad JSON and oversized bodies are rejected', async () => {
  const g = await guest();
  assert.equal((await call('POST', '/api/action', { token: g.token, raw: '{nope' })).status, 400);
  assert.equal((await call('POST', '/api/action', { token: g.token, raw: JSON.stringify({ type: 'rename', name: 'x'.repeat(20000) }) })).status, 400);
});

test('the page loads its code from versioned URLs that match the API build', async () => {
  const page = await call('GET', '/');
  const m = /src="\/v\/([0-9a-f]+)\/js\/main\.js"/.exec(page.data);
  assert.ok(m, 'index.html points at /v/<build>/js/main.js');
  assert.match(page.data, new RegExp(`href="/v/${m[1]}/css/style.css"`));
  const res = await fetch(`${base}/v/${m[1]}/js/game.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /immutable/);
  const g = await guest();
  assert.equal(g.build, m[1]);
  assert.equal((await call('GET', `/v/${m[1]}/server/index.js`)).status, 404);
});

test('a single pull still reports cropId at the top for older pages', async () => {
  const g = await guest();
  const r = await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'feeble' } });
  assert.equal(r.data.result.cropId, r.data.result.results[0].cropId);
  assert.ok(r.data.result.rarity);
});

// --- Admin dashboard API ---------------------------------------------------------------

async function adminToken() {
  const g = await guest();
  const username = `admin_${Math.floor(Math.random() * 1e6)}`;
  await call('POST', '/api/register', { token: g.token, body: { username, password: 'adminpass1' } });
  server.store.setAdmin(username, true);
  return g.token;
}

test('admin routes refuse players who are not admins', async () => {
  const g = await guest();
  assert.equal((await call('GET', '/api/admin/overview', { token: g.token })).status, 403);
  assert.equal((await call('GET', '/api/admin/overview')).status, 401);
  assert.equal((await call('POST', '/api/admin/economy', { token: g.token, body: {} })).status, 403);
});

test('admin overview and stats reflect activity', async () => {
  const admin = await adminToken();
  const g = await guest();
  await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'pico', count: 2 } });
  const o = await call('GET', '/api/admin/overview', { token: admin });
  assert.equal(o.status, 200);
  assert.ok(o.data.players.total >= 2);
  assert.ok(o.data.realized.packSpend >= 40);
  const st = await call('GET', '/api/admin/stats?days=7', { token: admin });
  const today = st.data.days.at(-1);
  assert.ok(today['pulls:pico'] >= 2);
  assert.ok(today.new_players >= 2);
});

test('admin can change prices; everyone gets them; bad configs are refused', async () => {
  const admin = await adminToken();
  const g = await guest();
  const { data } = await call('GET', '/api/admin/economy', { token: admin });
  const econ = data.economy;
  const before = (await call('GET', '/api/me', { token: g.token })).data.econ;

  const bad = structuredClone(econ);
  bad.rarity.common.chance = 0.5;   // chances no longer add up to 100%
  const refused = await call('POST', '/api/admin/economy', { token: admin, body: { economy: bad } });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /add up to 100%/);

  const next = structuredClone(econ);
  next.packCost.pico = 25;
  const saved = await call('POST', '/api/admin/economy', { token: admin, body: { economy: next } });
  assert.equal(saved.status, 200);
  const pub = await call('GET', '/api/economy');
  assert.equal(pub.data.economy.packCost.pico, 25);
  const buy = await call('POST', '/api/action', { token: g.token, body: { type: 'buyOpen', tier: 'pico' } });
  assert.equal(buy.data.state.coins, 75);
  assert.notEqual(buy.data.econ, before);   // clients see a new economy version

  const log = await call('GET', '/api/admin/log', { token: admin });
  assert.ok(log.data.log[0].details.some(d => d.startsWith('packCost.pico: 20 → 25')));

  const reset = await call('POST', '/api/admin/economy/reset', { token: admin });
  assert.equal(reset.data.economy.packCost.pico, 20);
});

test('admin can search players and adjust a farm', async () => {
  const admin = await adminToken();
  const g = await guest();
  await call('POST', '/api/action', { token: g.token, body: { type: 'rename', name: 'Findable Farm' } });
  const found = await call('GET', '/api/admin/players?q=findable', { token: admin });
  assert.equal(found.data.rows.length, 1);
  const id = found.data.rows[0].id;
  const adj = await call('POST', '/api/admin/player/adjust', { token: admin, body: { id, coins: 50, gems: 5, name: 'Renamed', reason: 'test' } });
  assert.equal(adj.status, 200);
  const me = await call('GET', '/api/me', { token: g.token });
  assert.equal(me.data.state.coins, 150);
  assert.equal(me.data.state.gems, 5);
  assert.equal(me.data.state.name, 'Renamed');
  const detail = await call('GET', `/api/admin/player?id=${id}`, { token: admin });
  assert.equal(detail.data.player.name, 'Renamed');
});

test('the admin page is served with versioned code', async () => {
  const page = await call('GET', '/admin');
  assert.equal(page.status, 200);
  assert.match(page.data, /src="\/v\/[0-9a-f]+\/js\/admin\.js"/);
});

test('the leaderboard skips farms that never played', async () => {
  const idle = await guest();
  await call('POST', '/api/action', { token: idle.token, body: { type: 'rename', name: 'Idle Visitor' } });
  const lb = await call('GET', '/api/leaderboard');
  assert.ok(!lb.data.top.some(r => r.name === 'Idle Visitor'));
  assert.ok(lb.data.top.every(r => r.xp > 0));
});

test('unplayed guest farms are removed after a day; played ones and accounts stay', async () => {
  const idle = await guest();
  const played = await guest();
  await call('POST', '/api/action', { token: played.token, body: { type: 'buyOpen', tier: 'feeble' } });
  const before = server.store.allFarms().length;
  assert.equal(server.store.pruneGuests(Date.now() - 24 * 3600e3), 0);   // too new to remove
  const removed = server.store.pruneGuests(Date.now() + 1000);            // pretend a day passed
  assert.ok(removed >= 1);
  assert.equal((await call('GET', '/api/me', { token: idle.token })).status, 401);
  assert.equal((await call('GET', '/api/me', { token: played.token })).status, 200);
  assert.ok(server.store.allFarms().length < before);
  assert.ok(server.store.allFarms().every(f => f.username || JSON.parse(f.state).xp > 0));
});

test('the farmer icon is served and linked from the page', async () => {
  const page = await call('GET', '/');
  const m = /<link rel="icon" type="image\/svg\+xml" href="(\/v\/[0-9a-f]+\/brand\/icon\.svg)">/.exec(page.data);
  assert.ok(m);
  const res = await fetch(base + m[1]);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /svg/);
  assert.equal((await call('GET', '/brand/make_logo.py')).status, 404);
});
