// $CROP on Robinhood Chain (the Abyss launch): wallet linking with personal_sign, deposits
// from ERC-20 Transfer logs, and withdrawal checks from transaction receipts.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { createServer } from '../server/index.js';
import { keccak256, mulG, addressOf, personalHash, verifyWalletSignature, TRANSFER_TOPIC } from '../server/evm.js';

// --- A test wallet that signs like MetaMask's personal_sign -------------------------------

const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const big = (buf) => BigInt(`0x${Buffer.from(buf).toString('hex')}`);
const modN = (a) => ((a % N) + N) % N;
const invN = (a) => { let r = 1n, b = modN(a), e = N - 2n; while (e) { if (e & 1n) r = r * b % N; b = b * b % N; e >>= 1n; } return r; };

function wallet() {
  const d = modN(big(randomBytes(32))) || 1n;
  const address = addressOf(mulG(d));
  return {
    address,
    sign(message) {
      const z = big(personalHash(message));
      for (;;) {
        const k = modN(big(randomBytes(32)));
        if (!k) continue;
        const [x, y] = mulG(k);
        const r = modN(x), s = modN(invN(k) * (z + r * d));
        if (!r || !s) continue;
        const v = 27 + Number(y & 1n);
        return `0x${r.toString(16).padStart(64, '0')}${s.toString(16).padStart(64, '0')}${v.toString(16)}`;
      }
    },
  };
}

const TOKEN = wallet().address;
const TREASURY = wallet().address;
const pad = (a) => `0x${a.slice(2).padStart(64, '0')}`;
const units = (n) => `0x${(BigInt(Math.round(n * 1e6)) * 10n ** 12n).toString(16)}`;   // 18 decimals

// --- A fake Robinhood Chain node --------------------------------------------------------------

let tip = 1000;
const logs = [];
const receipts = {};
function transfer(from, to, amount, { token = TOKEN } = {}) {
  tip += 5;
  const hash = `0x${randomBytes(32).toString('hex')}`;
  const log = { address: token, topics: [TRANSFER_TOPIC, pad(from), pad(to)], data: units(amount), blockNumber: `0x${tip.toString(16)}`, transactionHash: hash, logIndex: '0x0' };
  logs.push(log);
  receipts[hash] = { status: '0x1', blockNumber: log.blockNumber, logs: [log] };
  tip += 30;   // let it pass the confirmation depth
  return hash;
}

async function rpc(method, params) {
  if (method === 'eth_blockNumber') return `0x${tip.toString(16)}`;
  if (method === 'eth_call') return `0x${(18).toString(16).padStart(64, '0')}`;
  if (method === 'eth_getBlockByNumber') return { timestamp: '0x6553f100' };
  if (method === 'eth_getTransactionReceipt') return receipts[params[0]] || null;
  if (method === 'eth_getLogs') {
    const { address, fromBlock, toBlock, topics } = params[0];
    return logs.filter(l => l.address === address && parseInt(l.blockNumber, 16) >= parseInt(fromBlock, 16)
      && parseInt(l.blockNumber, 16) <= parseInt(toBlock, 16) && l.topics[2] === topics[2]);
  }
  throw new Error(`unexpected ${method}`);
}

let server, base;
before(async () => {
  server = createServer({
    dbFile: ':memory:', rateLimits: false, log: { error() {}, info() {} },
    deposits: { config: { chain: 'robinhood', mint: TOKEN, treasury: TREASURY, rpcUrl: 'fake', enabled: true, confirmations: 20, startBlock: 0 }, rpc, autoStart: false },
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
async function link(token, w, wallet = w.address) {
  const c = await call('POST', '/api/wallet/challenge', { token, body: { wallet } });
  assert.equal(c.status, 200, c.data.error);
  return call('POST', '/api/wallet/link', { token, body: { signature: w.sign(c.data.message) } });
}
const coins = async (token) => (await call('GET', '/api/me', { token })).data.state.coins;

// --- Tests ------------------------------------------------------------------------------------

test('Keccak-256 and signature recovery match Ethereum', () => {
  assert.equal(keccak256('').toString('hex'), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(addressOf(mulG(1n)), '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  // ethers.js documentation example: signMessage('hello world') with key 0x0123…0123.
  assert.ok(verifyWalletSignature('0x14791697260E4c9A71f18484C9f997B308e59325', 'hello world',
    '0xddd0a7290af9526056b4e35a077b9a11b513aa0028ec6c9880948544508f3c63265e99e47ad31bb2cab9646c504576b3abc6939a1710afc08cbf3034d73214b81c'));
  assert.ok(!verifyWalletSignature('0x14791697260E4c9A71f18484C9f997B308e59325', 'hello world!',
    '0xddd0a7290af9526056b4e35a077b9a11b513aa0028ec6c9880948544508f3c63265e99e47ad31bb2cab9646c504576b3abc6939a1710afc08cbf3034d73214b81c'));
});

test('the game reports Robinhood Chain links', async () => {
  const crop = (await call('GET', '/api/economy')).data.crop;
  assert.equal(crop.chain, 'robinhood');
  assert.equal(crop.chainId, 4663);
  assert.match(crop.buyUrl, /abyss\.trading/);
  assert.match(crop.txUrl, /blockscout/);
});

test('linking needs the wallet\'s own signature; addresses are matched case-insensitively', async () => {
  const t = await player('evm_alice');
  const w = wallet(), other = wallet();
  assert.equal((await call('POST', '/api/wallet/challenge', { token: t, body: { wallet: 'So1anaAddressxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' } })).status, 400);
  const forged = await call('POST', '/api/wallet/challenge', { token: t, body: { wallet: w.address } });
  const bad = await call('POST', '/api/wallet/link', { token: t, body: { signature: other.sign(forged.data.message) } });
  assert.equal(bad.status, 400);
  const good = await link(t, w, w.address.toUpperCase().replace('0X', '0x'));   // checksummed / mixed case is fine
  assert.equal(good.status, 200, good.data.error);
  assert.equal(good.data.wallet, w.address);
});

test('a $CROP transfer from a linked wallet is credited 1:1, exactly once', async () => {
  const t = await player('evm_bob');
  const w = wallet();
  await link(t, w);
  const before = await coins(t);
  transfer(w.address, TREASURY, 250.5);
  transfer(w.address, wallet().address, 999);                  // not to the treasury
  transfer(w.address, TREASURY, 77, { token: wallet().address });   // a different token
  await server.deposits.scan();
  await server.deposits.scan();
  assert.equal(await coins(t), before + 250.5);
  const mine = (await call('GET', '/api/wallet', { token: t })).data.deposits;
  assert.equal(mine.length, 1);
});

test('withdrawals are checked against the transaction receipt', async () => {
  const t = await player('evm_carol');
  const w = wallet();
  await link(t, w);
  transfer(w.address, TREASURY, 100);
  await server.deposits.scan();
  const req = await call('POST', '/api/withdrawals', { token: t, body: { amount: 40 } });
  assert.equal(req.status, 200, req.data.error);

  const g = (await call('POST', '/api/guest')).data;
  await call('POST', '/api/register', { token: g.token, body: { username: 'evm_admin', password: 'adminpass1' } });
  server.store.setAdmin('evm_admin', true);
  const admin = g.token;
  const sent = (hash) => call('POST', '/api/admin/withdrawals/sent', { token: admin, body: { id: req.data.id, signature: hash } });

  assert.match((await sent('0x1234')).data.error, /transaction hash/);
  assert.match((await sent(`0x${'ab'.repeat(32)}`)).data.error, /not found/);
  assert.match((await sent(transfer(TREASURY, wallet().address, 40))).data.error, /doesn't send/);   // wrong wallet
  assert.match((await sent(transfer(TREASURY, w.address, 10))).data.error, /less than/);
  const ok = await sent(transfer(TREASURY, w.address, 40));
  assert.equal(ok.status, 200, ok.data.error);
});
