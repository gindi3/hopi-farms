// Ethereum-style chain support (Robinhood Chain, where $CROP launches on Abyss) for $CROP
// deposits and withdrawal checks, with no dependencies: Keccak-256, secp256k1 signature
// recovery for wallet linking (personal_sign), and ERC-20 Transfer logs over JSON-RPC.
// The server only reads the chain; it never holds a private key.

// --- Keccak-256 (the original Keccak padding Ethereum uses, not SHA3-256) -------------------

const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An, 0x8000000080008000n,
  0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
  0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// Rotation for lane x + 5y.
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK);

function keccakF(A) {
  const C = new Array(5), B = new Array(25);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= d;
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
    }
    for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) {
      A[x + y] = B[x + y] ^ (~B[((x + 1) % 5) + y] & MASK & B[((x + 2) % 5) + y]);
    }
    A[0] ^= RC[round];
  }
}

export function keccak256(input) {
  const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  const rate = 136;
  const padded = Buffer.alloc(Math.ceil((data.length + 1) / rate) * rate);
  data.copy(padded);
  padded[data.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) A[i] ^= padded.readBigUInt64LE(off + i * 8);
    keccakF(A);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i], i * 8);
  return out;
}

// --- secp256k1 ------------------------------------------------------------------------------

const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
export const G = [
  0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n,
  0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n,
];
const mod = (a, m = P) => ((a % m) + m) % m;
function powMod(b, e, m) {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
const inv = (a, m = P) => powMod(a, m - 2n, m);

// Points in Jacobian coordinates [X, Y, Z]; null is the point at infinity.
function jDouble(p) {
  if (!p || p[1] === 0n) return null;
  const [X, Y, Z] = p;
  const S = mod(4n * X * Y * Y), M = mod(3n * X * X);
  const X3 = mod(M * M - 2n * S);
  return [X3, mod(M * (S - X3) - 8n * Y ** 4n), mod(2n * Y * Z)];
}
function jAdd(p, q) {
  if (!p) return q;
  if (!q) return p;
  const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
  const Z1Z1 = mod(Z1 * Z1), Z2Z2 = mod(Z2 * Z2);
  const U1 = mod(X1 * Z2Z2), U2 = mod(X2 * Z1Z1);
  const S1 = mod(Y1 * Z2 * Z2Z2), S2 = mod(Y2 * Z1 * Z1Z1);
  if (U1 === U2) return S1 === S2 ? jDouble(p) : null;
  const H = mod(U2 - U1), R = mod(S2 - S1);
  const HH = mod(H * H), HHH = mod(H * HH), V = mod(U1 * HH);
  const X3 = mod(R * R - HHH - 2n * V);
  return [X3, mod(R * (V - X3) - S1 * HHH), mod(H * Z1 * Z2)];
}
function jMul(k, [x, y]) {
  let r = null, a = [x, y, 1n];
  for (k = mod(k, N); k > 0n; k >>= 1n) { if (k & 1n) r = jAdd(r, a); a = jDouble(a); }
  return r;
}
function toAffine(p) {
  if (!p) return null;
  const zi = inv(p[2]);
  return [mod(p[0] * zi * zi), mod(p[1] * zi * zi * zi)];
}
export const mulG = (k) => toAffine(jMul(k, G));

const hex32 = (n) => n.toString(16).padStart(64, '0');
export const addressOf = ([x, y]) => `0x${keccak256(Buffer.from(hex32(x) + hex32(y), 'hex')).subarray(12).toString('hex')}`;

// Public key that made signature (r, s, v) of a 32-byte hash, or null.
export function recoverPoint(hash, r, s, v) {
  if (r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const x = r;
  const y2 = mod(x ** 3n + 7n);
  let y = powMod(y2, (P + 1n) / 4n, P);
  if (mod(y * y) !== y2) return null;
  if ((y & 1n) !== BigInt(v & 1)) y = P - y;
  const e = BigInt(`0x${Buffer.from(hash).toString('hex')}`);
  const ri = inv(r, N);
  const u1 = mod(-e * ri, N), u2 = mod(s * ri, N);
  return toAffine(jAdd(jMul(u1, G), jMul(u2, [x, y])));
}

// --- Wallets --------------------------------------------------------------------------------

export const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
export const normalize = (a) => String(a || '').trim().toLowerCase();

// The hash personal_sign (MetaMask and friends) signs for a text message.
export function personalHash(message) {
  const body = Buffer.from(message, 'utf8');
  return keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`, 'utf8'), body]));
}

// True if `signature` (0x + 130 hex) is `wallet`'s personal_sign of `message`.
export function verifyWalletSignature(wallet, message, signature) {
  try {
    const m = /^0x([0-9a-fA-F]{64})([0-9a-fA-F]{64})([0-9a-fA-F]{2})$/.exec(String(signature).trim());
    if (!m || !isAddress(wallet)) return false;
    let v = parseInt(m[3], 16);
    if (v >= 27) v -= 27;
    if (v !== 0 && v !== 1) return false;
    const q = recoverPoint(personalHash(message), BigInt(`0x${m[1]}`), BigInt(`0x${m[2]}`), v);
    return Boolean(q) && addressOf(q) === normalize(wallet);
  } catch {
    return false;
  }
}

// --- RPC and ERC-20 transfers ---------------------------------------------------------------

export const TRANSFER_TOPIC = `0x${keccak256('Transfer(address,address,uint256)').toString('hex')}`;
const topicOf = (addr) => `0x${normalize(addr).slice(2).padStart(64, '0')}`;
const addrFromTopic = (t) => `0x${String(t).slice(-40).toLowerCase()}`;
const toNum = (raw, decimals) => Number(raw) / 10 ** decimals;

export function rpcClient(url) {
  let id = 0;
  return async function rpc(method, params) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`RPC ${method}: ${data.error.message}`);
    return data.result;
  };
}

export async function tokenDecimals(rpc, token) {
  const out = await rpc('eth_call', [{ to: token, data: '0x313ce567' }, 'latest']);
  return Number(BigInt(out));
}

// One pass over new Transfer logs into the treasury, from the saved block cursor up to
// `confirmations` blocks behind the tip. `seen(id)` says if a log was already handled,
// `record(dep)` stores and credits a new one; `cursor` is { get(), set(block) }.
export async function scanDeposits({ rpc, token, treasury, seen, record, cursor, decimals, confirmations = 20, chunk = 10000, maxChunks = 20, startBack = 200000 }) {
  const tip = Number(BigInt(await rpc('eth_blockNumber', [])));
  const safeTip = tip - confirmations;
  let from = cursor.get();
  if (from === null || from === undefined) from = Math.max(0, safeTip - startBack);
  let found = 0;
  const times = new Map();
  for (let i = 0; i < maxChunks && from <= safeTip; i++) {
    const to = Math.min(from + chunk - 1, safeTip);
    const logs = await rpc('eth_getLogs', [{
      address: token, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`,
      topics: [TRANSFER_TOPIC, null, topicOf(treasury)],
    }]) || [];
    for (const log of logs) {
      if (log.removed) continue;
      const id = `${log.transactionHash}:${Number(BigInt(log.logIndex))}`;
      if (seen(id)) continue;
      const block = Number(BigInt(log.blockNumber));
      if (!times.has(block)) {
        const b = await rpc('eth_getBlockByNumber', [log.blockNumber, false]);
        times.set(block, b ? Number(BigInt(b.timestamp)) * 1000 : Date.now());
      }
      const raw = BigInt(log.data === '0x' ? 0 : log.data);
      record({ signature: id, slot: block, time: times.get(block), raw: raw.toString(), amount: toNum(raw, decimals), from: addrFromTopic(log.topics[1]) });
      found++;
    }
    cursor.set(to + 1);
    from = to + 1;
  }
  return found;
}

// How much of `token` a mined transaction moved from `from` to `to`, or null if it failed,
// isn't mined yet, or doesn't move that token between them.
export function parseTransfer(receipt, { token, from, to, decimals }) {
  if (!receipt || receipt.status !== '0x1') return null;
  let raw = 0n;
  for (const log of receipt.logs || []) {
    if (normalize(log.address) !== normalize(token) || log.topics?.[0] !== TRANSFER_TOPIC) continue;
    if (addrFromTopic(log.topics[1]) !== normalize(from) || addrFromTopic(log.topics[2]) !== normalize(to)) continue;
    raw += BigInt(log.data === '0x' ? 0 : log.data);
  }
  return raw > 0n ? { sent: toNum(raw, decimals), received: toNum(raw, decimals) } : null;
}
