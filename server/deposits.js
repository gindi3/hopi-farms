// $CROP deposits: a player links their wallet by signing a message, then any $CROP they send
// from it to the treasury is added 1:1 to their in-game $CROP balance. The server only reads
// the chain and holds no private keys. Which chain (Solana or Robinhood Chain) and the env
// settings are described in chains.js.

import { randomBytes } from 'node:crypto';
import * as G from '../js/game.js';
import { linkMessage } from './solana.js';
import { chainConfig, chainOps } from './chains.js';
import { dayOf } from './admin.js';

const CHALLENGE_MS = 10 * 60e3;

export const depositConfig = chainConfig;

export function createDeposits({ store, ok, bad, loadFarm, log, config, rpc: rpcOverride, pollMs = 30e3 }) {
  const chain = chainOps(config, rpcOverride, store);
  const { rpc } = chain;
  // A wallet linked on another chain (before a switch) doesn't count: the player links again.
  const walletOf = (userId) => { const w = store.walletOf(userId); return w && chain.isAddress(w) ? w : null; };
  const challenges = new Map();      // userId → { wallet, message, expires }
  const status = { lastScan: null, lastError: null, scanning: false };

  // Add `amount` $CROP to a player's in-game balance (1:1). Call inside store.tx.
  function creditFarm(userId, amount, now) {
    const coins = G.round2(amount);
    const state = loadFarm(userId);
    state.coins = G.round2(state.coins + coins);
    state.stats.cropDeposited = G.round2((state.stats.cropDeposited || 0) + amount);
    store.putFarm(userId, state, now);
    store.bumpStats(dayOf(now), { crop_in: amount, deposit_coins: coins, deposits: 1 });
    return coins;
  }

  function record(dep) {
    const now = Date.now();
    store.tx(() => {
      if (store.hasDeposit(dep.signature)) return;
      if (dep.ignored || !(dep.amount > 0)) {
        store.addDeposit({ ...dep, wallet: dep.from, coins: 0, userId: null, status: 'ignored', notedAt: now });
        return;
      }
      const user = dep.from ? store.userByWallet(chain.normalize(dep.from)) : null;
      if (!user) {
        store.addDeposit({ ...dep, wallet: dep.from, coins: 0, userId: null, status: 'unmatched', notedAt: now });
        log.info?.(`Unmatched deposit ${dep.amount} $CROP from ${dep.from || 'unknown'} (${dep.signature})`);
        return;
      }
      const coins = creditFarm(user.id, dep.amount, now);
      store.addDeposit({ ...dep, wallet: dep.from, coins, userId: user.id, status: 'credited', notedAt: now });
      log.info?.(`Credited ${coins} $CROP to ${user.username} (${dep.signature})`);
    });
  }

  async function scan() {
    if (!config.enabled || status.scanning) return 0;
    status.scanning = true;
    try {
      const n = await chain.scan({ seen: store.hasDeposit, record });
      status.lastScan = Date.now();
      status.lastError = null;
      return n;
    } catch (e) {
      status.lastError = String(e.message || e);
      log.error?.('Deposit scan failed:', status.lastError);
      return 0;
    } finally {
      status.scanning = false;
    }
  }

  let timer = null;
  function start() {
    if (!config.enabled || timer) return;
    scan();
    timer = setInterval(scan, pollMs);
    timer.unref();
  }
  function stop() { clearInterval(timer); timer = null; }

  const publicInfo = () => ({
    enabled: config.enabled,
    mint: config.enabled ? config.mint : null,
    treasury: config.enabled ? config.treasury : null,
    ...chain.links,
  });

  const routes = {
    'GET /api/wallet': (req, { userId }) => ok({
      ...publicInfo(),
      wallet: walletOf(userId),
      canLink: Boolean(store.userById(userId)?.username),
      deposits: store.depositsOf(userId),
    }),

    // Step 1 of linking: get a message for the wallet to sign.
    'POST /api/wallet/challenge': (req, { userId, body }) => {
      if (!config.enabled) return bad('Deposits are not open yet.');
      const user = store.userById(userId);
      if (!user?.username) return bad('Save your farm with a username before linking a wallet.');
      const wallet = chain.normalize(body?.wallet);
      if (!chain.isAddress(wallet)) return bad(`That isn't a ${chain.links.chainName} wallet address.`);
      if (wallet === config.treasury) return bad("That's the game's treasury wallet.");
      const owner = store.userByWallet(wallet);
      if (owner && owner.id !== userId) return bad('That wallet is already linked to another farm.');
      const message = linkMessage({ wallet, username: user.username, nonce: randomBytes(8).toString('hex') });
      challenges.set(userId, { wallet, message, expires: Date.now() + CHALLENGE_MS });
      return ok({ message });
    },

    // Step 2: send the wallet's signature of that message.
    'POST /api/wallet/link': (req, { userId, body }) => {
      const c = challenges.get(userId);
      if (!c || c.expires < Date.now()) return bad('That request expired. Try linking again.');
      if (!chain.verify(c.wallet, c.message, String(body?.signature || ''))) return bad("The signature doesn't match that wallet.");
      const owner = store.userByWallet(c.wallet);
      if (owner && owner.id !== userId) return bad('That wallet is already linked to another farm.');
      challenges.delete(userId);
      store.setWallet(userId, c.wallet);
      return ok({ wallet: c.wallet });
    },
  };

  const adminRoutes = {
    'GET /api/admin/deposits': () => {
      const totals = Object.fromEntries(store.depositTotals().map(t => [t.status, t]));
      return ok({
        ...publicInfo(),
        rpc: config.rpcUrl.replace(/([?&](api-)?key=)[^&]+/i, '$1…'),
        status,
        totals,
        recent: store.recentDeposits(100),
      });
    },

    // Credit an unmatched deposit (e.g. sent from an exchange) to a player by username.
    'POST /api/admin/deposits/assign': (req, { userId, body }) => {
      const dep = store.depositBySig(String(body?.signature || ''));
      if (!dep || dep.status !== 'unmatched') return bad('That deposit is not waiting to be assigned.');
      const user = store.userByName(String(body?.username || ''));
      if (!user) return bad('No account with that username.');
      const now = Date.now();
      const coins = store.tx(() => {
        const c = creditFarm(user.id, dep.amount, now);
        store.assignDeposit(dep.signature, user.id, c);
        return c;
      });
      store.addLog(store.userById(userId)?.username || `#${userId}`, 'assign deposit',
        { signature: dep.signature, to: user.username, crop: dep.amount, coins, reason: String(body?.reason || '').slice(0, 200) }, now);
      return ok({ coins });
    },

    'POST /api/admin/deposits/scan': async () => {
      if (!config.enabled) return bad('Deposits are off: set HOPI_CROP_MINT and HOPI_TREASURY on the server.');
      const found = await scan();
      return ok({ found, status });
    },
  };

  return { routes, adminRoutes, start, stop, scan, record, publicInfo, rpc, chain, walletOf };
}
