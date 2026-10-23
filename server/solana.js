// Solana support for one-way $CROP deposits. The server never holds a private key: it only
// verifies wallet signatures (to link a player's wallet) and reads the chain to find $CROP
// sent to the treasury.

import { createPublicKey, verify } from 'node:crypto';

// --- Base58 (Solana addresses and signatures) --------------------------------------

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));

export function base58Decode(str) {
  if (typeof str !== 'string') throw new Error('not base58');
  let zeros = 0;
  while (zeros < str.length && str[zeros] === '1') zeros++;
  const bytes = [];                       // little-endian while building
  for (let k = zeros; k < str.length; k++) {
    let carry = INDEX[str[k]];
    if (carry === undefined) throw new Error('bad base58');
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  return Buffer.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

export function base58Encode(buf) {
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros++;
  const digits = [];                      // little-endian base-58 digits
  for (let k = zeros; k < buf.length; k++) {
    let carry = buf[k];
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return '1'.repeat(zeros) + digits.reverse().map(d => ALPHABET[d]).join('');
}

export function isAddress(str) {
  try { return base58Decode(str).length === 32; } catch { return false; }
}

// --- Wallet signatures --------------------------------------------------------------

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// True if `signature` (bytes) is the wallet's ed25519 signature of `message` (a string).
export function verifyWalletSignature(wallet, message, signature) {
  try {
    const raw = base58Decode(wallet);
    if (raw.length !== 32 || signature.length !== 64) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message, 'utf8'), key, signature);
  } catch {
    return false;
  }
}

export function linkMessage({ wallet, username, nonce }) {
  return `Hopi Farms: link this wallet to my farm.\n\nWallet: ${wallet}\nAccount: ${username}\nCode: ${nonce}\n\nSigning is free and does not send any tokens.`;
}

// --- RPC -----------------------------------------------------------------------------

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

// What a confirmed transaction did to the treasury's $CROP balance: the amount received
// and the wallet it came from (the one owner whose $CROP balance went down), if clear.
export function parseDeposit(tx, { mint, treasury }) {
  if (!tx || tx.meta?.err) return null;
  const sum = (list) => {
    const byOwner = {};
    for (const b of list || []) {
      if (b.mint !== mint || !b.owner) continue;
      byOwner[b.owner] = (byOwner[b.owner] || 0n) + BigInt(b.uiTokenAmount.amount);
    }
    return byOwner;
  };
  const pre = sum(tx.meta.preTokenBalances), post = sum(tx.meta.postTokenBalances);
  const decimals = [...(tx.meta.postTokenBalances || []), ...(tx.meta.preTokenBalances || [])]
    .find(b => b.mint === mint)?.uiTokenAmount.decimals ?? 0;
  const owners = new Set([...Object.keys(pre), ...Object.keys(post)]);
  const delta = (o) => (post[o] || 0n) - (pre[o] || 0n);
  const received = delta(treasury);
  if (received <= 0n) return null;
  const senders = [...owners].filter(o => o !== treasury && delta(o) < 0n);
  return {
    raw: received.toString(),
    amount: Number(received) / 10 ** decimals,
    from: senders.length === 1 ? senders[0] : null,
  };
}

// One pass over new treasury transfers. `seen(sig)` says if a signature was already handled;
// `record(dep)` stores and credits a new one. Returns how many new deposits were found.
export async function scanDeposits({ rpc, mint, treasury, seen, record, limit = 100, maxPerScan = 1000 }) {
  const accounts = await rpc('getTokenAccountsByOwner', [treasury, { mint }, { encoding: 'jsonParsed', commitment: 'finalized' }]);
  let found = 0;
  for (const { pubkey } of accounts?.value || []) {
    // Page back from the newest until we reach signatures we've already handled (or the cap).
    const fresh = [];
    let before;
    for (;;) {
      const page = await rpc('getSignaturesForAddress', [pubkey, { limit, before, commitment: 'finalized' }]) || [];
      const stopAt = page.findIndex(s => seen(s.signature));
      fresh.push(...(stopAt === -1 ? page : page.slice(0, stopAt)));
      if (stopAt !== -1 || page.length < limit || fresh.length >= maxPerScan) break;
      before = page[page.length - 1].signature;
    }
    // Oldest first, so credits land in the order they were sent.
    for (const s of fresh.reverse()) {
      if (s.err || seen(s.signature)) continue;
      const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
      const dep = parseDeposit(tx, { mint, treasury });
      record({ signature: s.signature, slot: s.slot, time: (s.blockTime || 0) * 1000, ...(dep || { raw: '0', amount: 0, from: null, ignored: true }) });
      if (dep) found++;
    }
  }
  return found;
}

// How much of `mint` moved from `from` to `to` in a confirmed transaction (UI units), or
// null if the transaction failed or doesn't move that token between them.
export function parseTransfer(tx, { mint, from, to }) {
  if (!tx || tx.meta?.err) return null;
  const owned = (list, owner) => (list || [])
    .filter(b => b.mint === mint && b.owner === owner)
    .reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
  const decimals = [...(tx.meta.postTokenBalances || []), ...(tx.meta.preTokenBalances || [])]
    .find(b => b.mint === mint)?.uiTokenAmount.decimals ?? 0;
  const sent = owned(tx.meta.preTokenBalances, from) - owned(tx.meta.postTokenBalances, from);
  const received = owned(tx.meta.postTokenBalances, to) - owned(tx.meta.preTokenBalances, to);
  if (sent <= 0n || received <= 0n) return null;
  return { sent: Number(sent) / 10 ** decimals, received: Number(received) / 10 ** decimals };
}
