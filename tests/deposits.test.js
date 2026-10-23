import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';

import { createServer } from '../server/index.js';
import { base58Encode, parseDeposit } from '../server/solana.js';

// A fresh Solana keypair: base58 address plus a signer for messages.
function wallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = base58Encode(publicKey.export({ format: 'der', type: 'spki' }).subarray(12));
  return { address, sign: (msg) => sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('base64') };
}

const MINT = wallet().address;
const TREASURY = wallet().address;
const ATA = wallet().address;

// A fake RPC node: transfers are pushed into `chain` and served newest first.
const chain = [];
function transfer(from, amount, { failed = false } = {}) {
  const raw = BigInt(Math.round(amount * 1e6));
  const sig = `sig${chain.length}${'x'.repeat(60)}`;
  chain.push({
    signature: sig,
    slot: 1000 + chain.length,
    blockTime: 1_700_000_000 + chain.length,
    err: null,
    tx: {
      meta: {
        err: failed ? { InstructionError: [0, 'Custom'] } : null,
        preTokenBalances: [
          { mint: MINT, owner: from, uiTokenAmount: { amount: String(raw * 10n), decimals: 6 } },
          { mint: MINT, owner: TREASURY, uiTokenAmount: { amount: '0', decimals: 6 } },
        ],
        postTokenBalances: [
          { mint: MINT, owner: from, uiTokenAmount: { amount: String(raw * 9n), decimals: 6 } },
          { mint: MINT, owner: TREASURY, uiTokenAmount: { amount: String(raw), decimals: 6 } },
        ],
      },
    },
  });
  return sig;
}
async function rpc(method, params) {
  if (method === 'getTokenAccountsByOwner') return { value: [{ pubkey: ATA }] };
  if (method === 'getSignaturesForAddress') {
    const { limit, before } = params[1];
    const newest = [...chain].reverse();
    const start = before ? newest.findIndex(s => s.signature === before) + 1 : 0;
    return newest.slice(start, start + limit).map(({ signature, slot, blockTime, err }) => ({ signature, slot, blockTime, err }));
  }
  if (method === 'getTransaction') return chain.find(s => s.signature === params[0])?.tx;
  throw new Error(`unexpected ${method}`);
}

let server, base;
before(async () => {
  server = createServer({
    dbFile: ':memory:', rateLimits: false, log: { error() {}, info() {} },
    deposits: { config: { mint: MINT, treasury: TREASURY, rpcUrl: 'fake', enabled: true }, rpc, autoStart: false },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

async function player(name) {
  const g = (await call('POST', '/api/guest')).data;
  await call('POST', '/api/register', { token: g.token, body: { username: name, password: 'password123' } });
  return g.token;
}

async function link(token, w) {
  const c = await call('POST', '/api/wallet/challenge', { token, body: { wallet: w.address } });
  assert.equal(c.status, 200, c.data.error);
  return call('POST', '/api/wallet/link', { token, body: { signature: w.sign(c.data.message) } });
}

const coins = async (token) => (await call('GET', '/api/me', { token })).data.state.coins;

test('guests cannot link a wallet', async () => {
  const g = (await call('POST', '/api/guest')).data;
  const r = await call('POST', '/api/wallet/challenge', { token: g.token, body: { wallet: wallet().address } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /username/);
});

test('linking needs a real signature from that wallet', async () => {
  const token = await player('linker');
  const w = wallet(), other = wallet();
  const c = await call('POST', '/api/wallet/challenge', { token, body: { wallet: w.address } });
  const forged = await call('POST', '/api/wallet/link', { token, body: { signature: other.sign(c.data.message) } });
  assert.equal(forged.status, 400);
  const good = await link(token, w);
  assert.equal(good.status, 200);
  assert.equal((await call('GET', '/api/wallet', { token })).data.wallet, w.address);
  // The same wallet can't be linked to a second farm.
  const token2 = await player('linker2');
  const dup = await call('POST', '/api/wallet/challenge', { token: token2, body: { wallet: w.address } });
  assert.match(dup.data.error, /already linked/);
});

test('a deposit from a linked wallet becomes coins, exactly once', async () => {
  const token = await player('depositor');
  const w = wallet();
  await link(token, w);
  const start = await coins(token);
  transfer(w.address, 250);
  assert.equal(await server.deposits.scan(), 1);
  assert.equal(await coins(token), start + 250);
  assert.equal(await server.deposits.scan(), 0);           // nothing new: no double credit
  assert.equal(await coins(token), start + 250);
  const mine = (await call('GET', '/api/wallet', { token })).data.deposits;
  assert.equal(mine[0].amount, 250);
  assert.equal(mine[0].status, 'credited');
});

test('failed transfers are ignored', async () => {
  const token = await player('failer');
  const w = wallet();
  await link(token, w);
  const start = await coins(token);
  transfer(w.address, 99, { failed: true });
  await server.deposits.scan();
  assert.equal(await coins(token), start);
});

test('unknown senders wait for an admin, who can assign them', async () => {
  const stranger = wallet();
  const sig = transfer(stranger.address, 40);
  await server.deposits.scan();
  const adminTok = await player('boss');
  server.store.setAdmin('boss', true);
  const list = await call('GET', '/api/admin/deposits', { token: adminTok });
  const row = list.data.recent.find(d => d.signature === sig);
  assert.equal(row.status, 'unmatched');

  const token = await player('claimant');
  const start = await coins(token);
  const r = await call('POST', '/api/admin/deposits/assign', { token: adminTok, body: { signature: sig, username: 'claimant', reason: 'sent from exchange' } });
  assert.equal(r.status, 200);
  assert.equal(await coins(token), start + 40);
  const again = await call('POST', '/api/admin/deposits/assign', { token: adminTok, body: { signature: sig, username: 'claimant' } });
  assert.equal(again.status, 400);                          // can't assign twice
});

test('deposits are credited 1:1 as in-game $CROP, including fractions', async () => {
  const token = await player('onetoone');
  const w = wallet();
  await link(token, w);
  const start = await coins(token);
  transfer(w.address, 12.5);
  await server.deposits.scan();
  assert.equal(await coins(token), start + 12.5);
});

test('a scan pages back through many new transfers', async () => {
  const token = await player('bulk');
  const w = wallet();
  await link(token, w);
  const start = await coins(token);
  for (let i = 0; i < 230; i++) transfer(w.address, 1);
  assert.equal(await server.deposits.scan(), 230);
  assert.equal(await coins(token), start + 230);
});

test('parseDeposit ignores transfers that do not reach the treasury', () => {
  const tx = { meta: { err: null, preTokenBalances: [], postTokenBalances: [{ mint: MINT, owner: 'someone', uiTokenAmount: { amount: '5', decimals: 0 } }] } };
  assert.equal(parseDeposit(tx, { mint: MINT, treasury: TREASURY }), null);
});
