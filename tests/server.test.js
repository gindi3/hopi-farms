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
  assert.equal(cantAfford.data.error, 'You need 60 $CROP for 3 Pico packs.');
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
  assert.match(r.data.error, /You need 800 \$CROP/);
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

test('economy saved before new fields existed still loads, keeping its custom values', async () => {
  const { withDefaults, validateEconomy, DEFAULT_ECONOMY } = await import('../js/economy.js');
  const old = structuredClone(DEFAULT_ECONOMY);
  delete old.farmCost;
  old.firstHarvestGems = 7;
  assert.ok(validateEconomy(old).length > 0);             // missing field on its own
  const filled = withDefaults(old);
  assert.deepEqual(validateEconomy(filled), []);
  assert.equal(filled.firstHarvestGems, 7);
  assert.equal(filled.farmCost, DEFAULT_ECONOMY.farmCost);
});

test('admin can edit the docs; everyone reads them; bad edits are refused', async () => {
  const admin = await adminToken();
  const g = await guest();
  const pub = await call('GET', '/api/docs');
  assert.equal(pub.status, 200);
  assert.match(pub.data.docs.prizes[0].value, /\$349/);
  assert.equal((await call('POST', '/api/admin/docs', { token: g.token, body: { docs: pub.data.docs } })).status, 403);

  const docs = structuredClone(pub.data.docs);
  docs.pages.faq = { title: 'Questions', extra: '## More\n'.padEnd(12000, 'x') };   // bigger than the usual body limit
  docs.custom.push({ id: 'x-rules', group: 'Help', title: 'Prize rules', body: 'Top 3 win.' });
  docs.prizes[0].image = 'javascript:alert(1)';
  const refused = await call('POST', '/api/admin/docs', { token: admin, body: { docs } });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /https/);

  docs.prizes[0].image = '';
  const saved = await call('POST', '/api/admin/docs', { token: admin, body: { docs } });
  assert.equal(saved.status, 200);
  const after = (await call('GET', '/api/docs')).data.docs;
  assert.equal(after.pages.faq.title, 'Questions');
  assert.equal(after.custom[0].title, 'Prize rules');
});

test('docs Markdown escapes HTML and only links to safe places', async () => {
  const { renderMarkdown } = await import('../js/docs-content.js');
  const html = renderMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1)) **b**');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('<b>b</b>'));
});

// A signed-up player holding `gems`. Returns { token, id }.
async function richPlayer(admin, gems) {
  const g = await guest();
  const username = `p_${Math.floor(Math.random() * 1e9)}`;
  await call('POST', '/api/register', { token: g.token, body: { username, password: 'playerpass1' } });
  const id = server.store.userByName(username).id;
  await call('POST', '/api/admin/player/adjust', { token: admin, body: { id, gems } });
  return { token: g.token, id };
}
const gemsOf = async (p) => (await call('GET', '/api/me', { token: p.token })).data.state.gems;

test('auction: bids hold gems, outbid players get theirs back, the top bid wins', async () => {
  const admin = await adminToken();
  const a = await richPlayer(admin, 100), b = await richPlayer(admin, 100);
  const startA = await gemsOf(a), startB = await gemsOf(b);
  const made = await call('POST', '/api/admin/events', { token: admin, body: { kind: 'auction', title: 'Card', startBid: 10, minStep: 5, endsAt: Date.now() + 3600e3 } });
  assert.equal(made.status, 200);
  const id = made.data.event.id;

  const g = await guest();
  assert.equal((await call('POST', '/api/events/bid', { token: g.token, body: { id, amount: 10 } })).status, 400);   // guests can't bid
  assert.match((await call('POST', '/api/events/bid', { token: a.token, body: { id, amount: 9 } })).data.error, /at least 10/);

  assert.equal((await call('POST', '/api/events/bid', { token: a.token, body: { id, amount: 10 } })).status, 200);
  assert.equal(await gemsOf(a), startA - 10);
  assert.match((await call('POST', '/api/events/bid', { token: b.token, body: { id, amount: 12 } })).data.error, /at least 15/);
  assert.equal((await call('POST', '/api/events/bid', { token: b.token, body: { id, amount: 20 } })).status, 200);
  assert.equal(await gemsOf(a), startA);            // outbid: refunded
  assert.equal(await gemsOf(b), startB - 20);
  assert.equal((await call('POST', '/api/events/bid', { token: b.token, body: { id, amount: 30 } })).status, 200);
  assert.equal(await gemsOf(b), startB - 30);       // raising your own bid only takes the difference
  assert.match((await call('POST', '/api/events/bid', { token: a.token, body: { id, amount: 1000 } })).data.error, /only have/);

  const ended = await call('POST', '/api/admin/events/end', { token: admin, body: { id } });
  assert.equal(ended.data.event.status, 'ended');
  assert.equal(ended.data.event.winners[0].userId, b.id);
  assert.equal(await gemsOf(b), startB - 30);       // winner's gems are spent
  const pub = (await call('GET', '/api/events', { token: b.token })).data.events.find(e => e.id === id);
  assert.equal(pub.winners[0].you, true);
  assert.equal((await call('POST', '/api/events/bid', { token: a.token, body: { id, amount: 100 } })).status, 400);
});

test('auction: a late bid pushes the end back so nobody can snipe', async () => {
  const admin = await adminToken();
  const a = await richPlayer(admin, 50);
  const made = await call('POST', '/api/admin/events', { token: admin, body: { kind: 'auction', title: 'Snipe', startBid: 1, minStep: 1, endsAt: Date.now() + 70e3 } });
  const r = await call('POST', '/api/events/bid', { token: a.token, body: { id: made.data.event.id, amount: 1 } });
  assert.ok(r.data.event.endsAt >= Date.now() + 115e3);
});

test('lottery: tickets cost gems, limits hold, the draw picks distinct ticket holders', async () => {
  const admin = await adminToken();
  const players = [await richPlayer(admin, 100), await richPlayer(admin, 100), await richPlayer(admin, 100)];
  const made = await call('POST', '/api/admin/events', { token: admin, body: { kind: 'lottery', title: 'Raffle', ticketPrice: 5, maxTickets: 4, winnersCount: 2, endsAt: Date.now() + 3600e3 } });
  const id = made.data.event.id;
  const before = await gemsOf(players[0]);
  const r = await call('POST', '/api/events/enter', { token: players[0].token, body: { id, count: 3 } });
  assert.equal(r.data.event.myTickets, 3);
  assert.equal(await gemsOf(players[0]), before - 15);
  assert.match((await call('POST', '/api/events/enter', { token: players[0].token, body: { id, count: 2 } })).data.error, /at most 4/);
  await call('POST', '/api/events/enter', { token: players[1].token, body: { id, count: 1 } });
  await call('POST', '/api/events/enter', { token: players[2].token, body: { id, count: 2 } });

  const ended = (await call('POST', '/api/admin/events/end', { token: admin, body: { id } })).data.event;
  assert.equal(ended.winners.length, 2);
  assert.notEqual(ended.winners[0].userId, ended.winners[1].userId);
  assert.ok(ended.winners.every(w => players.some(p => p.id === w.userId)));
  assert.equal(await gemsOf(players[0]), before - 15);   // tickets are spent either way
});

test('cancelling refunds every gem; scheduled events settle on their own', async () => {
  const admin = await adminToken();
  const a = await richPlayer(admin, 100), b = await richPlayer(admin, 100);
  const startA = await gemsOf(a), startB = await gemsOf(b);
  const lot = (await call('POST', '/api/admin/events', { token: admin, body: { kind: 'lottery', title: 'L', ticketPrice: 7, winnersCount: 1, endsAt: Date.now() + 3600e3 } })).data.event.id;
  const auc = (await call('POST', '/api/admin/events', { token: admin, body: { kind: 'auction', title: 'A', startBid: 3, minStep: 1, endsAt: Date.now() + 3600e3 } })).data.event.id;
  await call('POST', '/api/events/enter', { token: a.token, body: { id: lot, count: 2 } });
  await call('POST', '/api/events/bid', { token: b.token, body: { id: auc, amount: 9 } });
  assert.equal((await call('POST', '/api/admin/events/cancel', { token: admin, body: { id: lot } })).data.refunded, 14);
  assert.equal((await call('POST', '/api/admin/events/cancel', { token: admin, body: { id: auc } })).data.refunded, 9);
  assert.equal(await gemsOf(a), startA);
  assert.equal(await gemsOf(b), startB);

  // Ends on its own once its time passes.
  const soon = (await call('POST', '/api/admin/events', { token: admin, body: { kind: 'lottery', title: 'Soon', ticketPrice: 1, winnersCount: 1, endsAt: Date.now() + 61e3 } })).data.event.id;
  await call('POST', '/api/events/enter', { token: a.token, body: { id: soon, count: 1 } });
  server.events.settleDue(Date.now() + 62e3);
  const all = (await call('GET', '/api/admin/events', { token: admin })).data.events;
  const ev = all.find(e => e.id === soon);
  assert.equal(ev.status, 'ended');
  assert.equal(ev.winners[0].userId, a.id);
  assert.equal((await call('POST', '/api/admin/events', { token: admin, body: { kind: 'lottery', title: 'x', ticketPrice: 1, winnersCount: 1, endsAt: Date.now() + 3600e3, image: 'http://x' } })).status, 400);
});
