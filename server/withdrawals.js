// Withdrawal requests: a player asks the dev to send $CROP back to their linked wallet.
// The server never sends anything (it holds no keys). The amount is held from the
// player's balance when requested; the dev sends it from the treasury by hand and marks
// the request sent with the transaction signature, which is checked on chain. Declined or
// cancelled requests are refunded. One request per player per UTC day.

import * as G from '../js/game.js';
import { base58Decode, parseTransfer } from './solana.js';
import { dayOf } from './admin.js';

const MIN_AMOUNT = 1;

export function createWithdrawals({ store, ok, bad, loadFarm, config, rpc }) {
  const adminName = (userId) => store.userById(userId)?.username || `#${userId}`;

  function info(userId, now) {
    const user = store.userById(userId);
    const wallet = store.walletOf(userId);
    const usedToday = store.requestedOnDay(userId, G.dayKey(now)) > 0;
    return {
      enabled: config.enabled,
      account: Boolean(user?.username),
      wallet,
      min: MIN_AMOUNT,
      canRequest: config.enabled && Boolean(user?.username) && Boolean(wallet) && !usedToday,
      usedToday,
      nextAt: usedToday ? now + G.msToNextDay(now) : null,
      requests: store.withdrawalsOf(userId),
    };
  }

  // Move `amount` in or out of a player's in-game balance. Call inside store.tx.
  function adjustBalance(userId, delta, now, field) {
    const state = loadFarm(userId);
    state.coins = G.round2(state.coins + delta);
    if (field) state.stats[field] = G.round2((state.stats[field] || 0) + Math.abs(delta));
    store.putFarm(userId, state, now);
    return state;
  }

  const routes = {
    'GET /api/withdrawals': (req, { userId }) => ok(info(userId, Date.now())),

    'POST /api/withdrawals': (req, { userId, body }) => {
      const now = Date.now();
      const i = info(userId, now);
      if (!i.enabled) return bad('Withdrawals are not open.');
      if (!i.account) return bad('Save your farm with a username first.');
      if (!i.wallet) return bad('Link your Solana wallet first. $CROP is only sent to your linked wallet.');
      if (i.usedToday) return bad('You can request one withdrawal per day. Try again after midnight UTC.');
      const amount = G.round2(Number(body?.amount));
      if (!Number.isFinite(amount) || amount < MIN_AMOUNT) return bad(`Withdraw at least ${MIN_AMOUNT} $CROP.`);
      try {
        const id = store.tx(() => {
          const state = loadFarm(userId);
          if (state.coins < amount) throw new G.GameError(`You only have ${G.round2(state.coins)} $CROP.`);
          adjustBalance(userId, -amount, now, 'withdrawHeld');
          return store.addWithdrawal(userId, i.wallet, amount, G.dayKey(now), now);
        });
        store.bumpStats(dayOf(now), { withdraw_requests: 1, withdraw_requested: amount });
        return ok({ id, ...info(userId, now), state: loadFarm(userId) });
      } catch (e) {
        if (e instanceof G.GameError) return bad(e.message);
        throw e;
      }
    },

    'POST /api/withdrawals/cancel': (req, { userId, body }) => {
      const w = store.withdrawalById(Number(body?.id));
      if (!w || w.user_id !== userId) return bad('No such request.');
      if (w.status !== 'pending') return bad('Only pending requests can be cancelled.');
      const now = Date.now();
      store.tx(() => {
        store.decideWithdrawal(w.id, 'cancelled', now, null, null, 'Cancelled by the player');
        adjustBalance(userId, w.amount, now);
      });
      return ok({ ...info(userId, now), state: loadFarm(userId) });
    },
  };

  const adminRoutes = {
    'GET /api/admin/withdrawals': () => ok({
      enabled: config.enabled,
      treasury: config.treasury || null,
      totals: Object.fromEntries(store.withdrawalTotals().map(t => [t.status, t])),
      requests: store.allWithdrawals(200),
    }),

    // Mark sent after paying from the treasury; the signature must show that payment.
    'POST /api/admin/withdrawals/sent': async (req, { userId, body }) => {
      const w = store.withdrawalById(Number(body?.id));
      if (!w || w.status !== 'pending') return bad('That request is not pending.');
      const signature = String(body?.signature || '').trim();
      try { if (base58Decode(signature).length !== 64) throw new Error(); } catch { return bad("That isn't a Solana transaction signature."); }
      let tx;
      try {
        tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 }]);
      } catch (e) {
        return bad(`Couldn't look up that transaction: ${e.message}`);
      }
      if (!tx) return bad('That transaction was not found (or not finalized yet). Wait a minute and try again.');
      const moved = parseTransfer(tx, { mint: config.mint, from: config.treasury, to: w.wallet });
      if (!moved) return bad("That transaction doesn't send $CROP from the treasury to this player's wallet.");
      if (moved.received + 1e-6 < w.amount) return bad(`That transaction sent ${moved.received} $CROP, less than the ${w.amount} requested.`);
      const now = Date.now();
      try {
        store.tx(() => {
          if (!store.decideWithdrawal(w.id, 'sent', now, adminName(userId), signature, null)) throw new Error('changed');
          const state = loadFarm(w.user_id);
          state.stats.cropWithdrawn = G.round2((state.stats.cropWithdrawn || 0) + w.amount);
          state.stats.withdrawHeld = G.round2(Math.max(0, (state.stats.withdrawHeld || 0) - w.amount));
          store.putFarm(w.user_id, state, now);
        });
      } catch (e) {
        if (/UNIQUE/.test(String(e.message))) return bad('That transaction was already used for another withdrawal.');
        if (e.message === 'changed') return bad('That request is not pending any more.');
        throw e;
      }
      store.bumpStats(dayOf(now), { withdraw_sent: w.amount });
      store.addLog(adminName(userId), 'withdrawal sent', { id: w.id, to: w.wallet, crop: w.amount, signature }, now);
      return ok({ received: moved.received });
    },

    'POST /api/admin/withdrawals/decline': (req, { userId, body }) => {
      const w = store.withdrawalById(Number(body?.id));
      if (!w || w.status !== 'pending') return bad('That request is not pending.');
      const reason = String(body?.reason || '').trim().slice(0, 200) || 'Declined';
      const now = Date.now();
      store.tx(() => {
        store.decideWithdrawal(w.id, 'declined', now, adminName(userId), null, reason);
        const state = adjustBalance(w.user_id, w.amount, now);
        state.stats.withdrawHeld = G.round2(Math.max(0, (state.stats.withdrawHeld || 0) - w.amount));
        store.putFarm(w.user_id, state, now);
      });
      store.addLog(adminName(userId), 'withdrawal declined', { id: w.id, crop: w.amount, reason }, now);
      return ok({});
    },
  };

  return { routes, adminRoutes };
}
