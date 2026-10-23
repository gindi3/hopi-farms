// Admin API for the dev dashboard (/admin). Every route here requires an account with the
// admin flag (set with: node server/admin-cli.js grant <username>).

import * as G from '../js/game.js';
import { RARITIES, TIER, RARITY, MAX_LEVEL, CROP } from '../js/data.js';
import {
  snapshotEconomy, applyEconomy, validateEconomy, baseRtpOf, DEFAULT_ECONOMY,
} from '../js/economy.js';
import { cleanName } from '../js/actions.js';

const DAY_MS = 86400e3;
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

// What one action did, as amounts for today's running totals.
export function actionStats(action, before, after, result) {
  const st = { [`actions:${action.type}`]: 1 };
  const dc = G.round2(after.coins - before.coins);
  if (dc > 0) st.coins_in = dc; else if (dc < 0) st.coins_out = -dc;
  const dg = after.gems - before.gems;
  if (dg > 0) st.gems_in = dg; else if (dg < 0) st.gems_out = -dg;
  if (result?.results) {
    for (const r of result.results) {
      st[`pulls:${action.tier}`] = (st[`pulls:${action.tier}`] || 0) + 1;
      st[`rarity:${r.rarity}`] = (st[`rarity:${r.rarity}`] || 0) + 1;
    }
    if (action.type === 'buyOpen') st.pack_spend = dc < 0 ? -dc : 0;
  }
  if (action.type === 'harvest') { st.harvests = 1; st.harvest_coins = result.coins; }
  if (action.type === 'harvestAll') { st.harvests = result.n; st.harvest_coins = result.coins; }
  if (action.type === 'levelUp') { st.levelups = 1; st.level_spend = -dc; }
  if (action.type === 'claimChest') st.chests = 1;
  return st;
}

function summarize(row, now) {
  const s = JSON.parse(row.state);
  return {
    id: row.user_id,
    name: s.name,
    username: row.username,
    admin: Boolean(row.is_admin),
    level: s.level,
    xp: s.xp,
    coins: s.coins,
    gems: s.gems,
    packsOpened: s.stats?.packsOpened || 0,
    harvests: s.stats?.harvests || 0,
    coinsSpent: s.stats?.coinsSpent || 0,
    coinsEarned: s.stats?.coinsEarned || 0,
    planted: s.plots.filter(Boolean).length,
    createdAt: row.created_at,
    lastActive: row.updated_at,
    idleDays: Math.floor((now - row.updated_at) / DAY_MS),
  };
}

// Returns route handlers keyed like 'GET /api/admin/overview'.
export function adminRoutes({ store, ok, bad, loadFarm, onEconomyChange }) {
  const adminName = (userId) => store.userById(userId)?.username || `#${userId}`;

  return {
    'GET /api/admin/me': (req, { userId }) => ok({ username: adminName(userId) }),

    'GET /api/admin/overview': () => {
      const now = Date.now();
      const farms = store.allFarms().map(r => summarize(r, now));
      const sum = (k) => G.round2(farms.reduce((a, f) => a + (f[k] || 0), 0));
      const levels = Array.from({ length: MAX_LEVEL + 1 }, () => 0);
      for (const f of farms) levels[f.level] = (levels[f.level] || 0) + 1;
      const totals = store.statTotals();
      const today = store.statsSince(dayOf(now)).reduce((a, r) => ({ ...a, [r.key]: r.value }), {});
      const cfg = snapshotEconomy();
      return ok({
        players: {
          total: farms.length,
          registered: farms.filter(f => f.username).length,
          active24h: farms.filter(f => now - f.lastActive < DAY_MS).length,
          active7d: farms.filter(f => now - f.lastActive < 7 * DAY_MS).length,
          newToday: today.new_players || 0,
          broke: farms.filter(f => f.coins < TIER.feeble.cost && !f.planted).length,
        },
        supply: { coins: sum('coins'), gems: sum('gems'), xp: sum('xp') },
        lifetime: {
          packsOpened: sum('packsOpened'),
          harvests: sum('harvests'),
          coinsSpent: sum('coinsSpent'),
          coinsEarned: sum('coinsEarned'),
        },
        // Since stats logging began (all players): what packs actually returned.
        realized: {
          packSpend: G.round2(totals.pack_spend || 0),
          harvestCoins: G.round2(totals.harvest_coins || 0),
          pulls: Object.fromEntries(RARITIES.map(r => [r, totals[`rarity:${r}`] || 0])),
        },
        theory: {
          baseRtp: baseRtpOf(cfg),
          rtpByLevel: Array.from({ length: MAX_LEVEL + 1 }, (_, l) => G.rtp(l)),
          chances: Object.fromEntries(RARITIES.map(r => [r, RARITY[r].chance])),
        },
        levels,
        today,
      });
    },

    'GET /api/admin/stats': (req, { url }) => {
      const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30));
      const now = Date.now();
      const start = dayOf(now - (days - 1) * DAY_MS);
      const byDay = {};
      for (let i = days - 1; i >= 0; i--) byDay[dayOf(now - i * DAY_MS)] = {};
      for (const r of store.statsSince(start)) if (byDay[r.day]) byDay[r.day][r.key] = r.value;
      return ok({ days: Object.entries(byDay).map(([day, v]) => ({ day, ...v })) });
    },

    'GET /api/admin/players': (req, { url }) => {
      const now = Date.now();
      const q = String(url.searchParams.get('q') || '').toLowerCase().trim();
      const sort = url.searchParams.get('sort') || 'recent';
      const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
      let rows = store.allFarms().map(r => summarize(r, now));
      if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || (r.username || '').toLowerCase().includes(q) || String(r.id) === q);
      const sorters = {
        recent: (a, b) => b.lastActive - a.lastActive,
        xp: (a, b) => b.xp - a.xp,
        coins: (a, b) => b.coins - a.coins,
        gems: (a, b) => b.gems - a.gems,
        level: (a, b) => b.level - a.level || b.xp - a.xp,
        newest: (a, b) => b.createdAt - a.createdAt,
      };
      rows.sort(sorters[sort] || sorters.recent);
      const size = 50;
      return ok({ total: rows.length, page, size, rows: rows.slice(page * size, page * size + size) });
    },

    'GET /api/admin/player': (req, { url }) => {
      const id = Number(url.searchParams.get('id'));
      const row = Number.isInteger(id) ? store.farmRow(id) : null;
      if (!row) return bad('No such player.', 404);
      const state = JSON.parse(row.state);
      const now = Date.now();
      return ok({
        player: summarize(row, now),
        state: {
          seeds: state.seeds, packs: state.packs, produce: state.produce, items: state.items,
          stats: state.stats, lastChestDay: state.lastChestDay,
          plots: state.plots.map((p, i) => p && {
            plot: i, crop: CROP[p.cropId]?.name || p.cropId, rarity: CROP[p.cropId]?.rarity,
            ready: G.plotProgress(p, now).ready, msLeft: G.plotProgress(p, now).msLeft,
          }).filter(Boolean),
        },
      });
    },

    // Give or take coins/gems, or rename (for offensive names). Amounts are deltas.
    'POST /api/admin/player/adjust': (req, { userId, body }) => {
      const id = Number(body?.id);
      if (!Number.isInteger(id) || !store.farmRow(id)) return bad('No such player.', 404);
      const coins = Number(body.coins || 0), gems = Number(body.gems || 0);
      if (!Number.isFinite(coins) || !Number.isInteger(gems) || Math.abs(coins) > 1e9 || Math.abs(gems) > 1e9) {
        return bad('Coins must be a number and gems a whole number.');
      }
      const state = loadFarm(id);
      const before = { coins: state.coins, gems: state.gems, name: state.name };
      state.coins = Math.max(0, G.round2(state.coins + coins));
      state.gems = Math.max(0, state.gems + gems);
      if (body.name !== undefined && body.name !== '') {
        const name = cleanName(body.name);
        if (!name) return bad('That name is empty after cleaning.');
        state.name = name;
      }
      const now = Date.now();
      store.putFarm(id, state, now);
      const change = { player: id, coins: G.round2(state.coins - before.coins), gems: state.gems - before.gems };
      if (state.name !== before.name) Object.assign(change, { from: before.name, to: state.name });
      if (body.reason) change.reason = String(body.reason).slice(0, 200);
      store.addLog(adminName(userId), 'adjust player', change, now);
      store.bumpStats(dayOf(now), { admin_coins: change.coins, admin_gems: change.gems });
      return ok({ player: summarize(store.farmRow(id), now) });
    },

    'GET /api/admin/economy': () => ok({ economy: snapshotEconomy(), defaults: DEFAULT_ECONOMY }),

    // Check a config without saving it (the dashboard's live preview).
    'POST /api/admin/economy/check': (req, { body }) => {
      const errors = validateEconomy(body?.economy);
      return ok({ errors, baseRtp: errors.length ? null : baseRtpOf(body.economy) });
    },

    'POST /api/admin/economy': (req, { userId, body }) => {
      const next = body?.economy;
      const errors = validateEconomy(next);
      if (errors.length) return bad(errors.join(' '));
      const prev = snapshotEconomy();
      applyEconomy(next);
      store.putSetting('economy', next);
      store.addLog(adminName(userId), 'change economy', diffEconomy(prev, next), Date.now());
      onEconomyChange();
      return ok({ economy: snapshotEconomy() });
    },

    'POST /api/admin/economy/reset': (req, { userId }) => {
      const prev = snapshotEconomy();
      applyEconomy(DEFAULT_ECONOMY);
      store.putSetting('economy', DEFAULT_ECONOMY);
      store.addLog(adminName(userId), 'reset economy', diffEconomy(prev, DEFAULT_ECONOMY), Date.now());
      onEconomyChange();
      return ok({ economy: snapshotEconomy() });
    },

    'GET /api/admin/log': () => ok({ log: store.recentLog(100) }),
  };
}

// List of "path: old → new" strings for the admin log.
function diffEconomy(a, b, path = '') {
  const out = [];
  if (typeof a !== 'object' || a === null) {
    if (a !== b) out.push(`${path}: ${a} → ${b}`);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b || {})])) {
    out.push(...diffEconomy(a[k], b?.[k], path ? `${path}.${k}` : k));
  }
  return out;
}

