// Game rules for Hopi Farms. Pure functions over a plain state object, with no DOM access,
// so they run in tests. `now` is passed in (ms) and `rng` returns [0, 1).

import {
  RARITIES, RARITY, TIER, CROPS, CROP, HARVEST_GEMS, FIRST_HARVEST_GEMS,
  BASE_RTP, RTP_PER_LEVEL, RTP_CAP, MAX_LEVEL, LEVEL_COSTS, BASE_PLOTS, MAX_PLOTS,
  LEVEL_UP_GEMS_PER_LEVEL, STARTER, CHESTS, ELIXIR_HOURS, HOUR_MS,
} from './data.js';

export const SAVE_VERSION = 1;

export function newGame(name = 'Farmer') {
  return {
    version: SAVE_VERSION,
    name,
    coins: STARTER.coins,
    gems: 0,
    xp: 0,
    level: 0,
    seeds: { ...STARTER.seeds },
    packs: {},          // unopened packs by tier
    produce: {},        // harvested crop counts by crop id
    items: {},          // consumables by item id
    harvested: {},      // crop ids harvested at least once (for first-harvest gems)
    plots: Array.from({ length: MAX_PLOTS }, () => null),
    lastChestDay: null,
    stats: { packsOpened: 0, harvests: 0, coinsSpent: 0, coinsEarned: 0 },
  };
}

// --- Economy -----------------------------------------------------------------

export function rtp(level) {
  return Math.min(BASE_RTP + RTP_PER_LEVEL * level, RTP_CAP);
}

export function cropPayout(cropId, level) {
  const crop = CROP[cropId];
  const raw = TIER[crop.tier].cost * RARITY[crop.rarity].mult * (rtp(level) / BASE_RTP);
  return round2(raw);
}

export function expectedReturn(level) {
  return RARITIES.reduce((sum, r) => sum + RARITY[r].chance * RARITY[r].mult, 0) * (rtp(level) / BASE_RTP);
}

export function plotCount(level) {
  return Math.min(BASE_PLOTS + Math.floor(level / 2), MAX_PLOTS);
}

export function levelUnlockingPlot(index) {
  if (index < BASE_PLOTS) return 0;
  return (index - BASE_PLOTS + 1) * 2;
}

export function nextLevelCost(level) {
  return level >= MAX_LEVEL ? null : LEVEL_COSTS[level];
}

export function chestFor(level) {
  return [...CHESTS].reverse().find(c => level >= c.minLevel);
}

// --- Actions -----------------------------------------------------------------
// Each action mutates `state` and returns a result object, or throws GameError.

export class GameError extends Error {}

export function buyPack(state, tier) {
  const cost = TIER[tier].cost;
  if (state.coins < cost) throw new GameError(`Not enough coins for a ${TIER[tier].label} pack.`);
  state.coins = round2(state.coins - cost);
  state.stats.coinsSpent = round2(state.stats.coinsSpent + cost);
  state.packs[tier] = (state.packs[tier] || 0) + 1;
  return { tier };
}

export function openPack(state, tier, rng = Math.random) {
  if (!state.packs[tier]) throw new GameError('No pack of that tier to open.');
  state.packs[tier] -= 1;
  const rarity = rollRarity(rng);
  const pool = CROPS.filter(c => c.tier === tier && c.rarity === rarity);
  const crop = pool[Math.floor(rng() * pool.length)];
  addCount(state.seeds, crop.id, 1);
  state.xp += TIER[tier].xpOpen;
  state.stats.packsOpened += 1;
  return { cropId: crop.id, rarity };
}

export function rollRarity(rng = Math.random) {
  let r = rng();
  for (const key of RARITIES) {
    r -= RARITY[key].chance;
    if (r < 0) return key;
  }
  return RARITIES[RARITIES.length - 1];
}

// `speed` > 1 shortens grow time (dev/testing only).
export function plant(state, plotIndex, cropId, now, speed = 1) {
  assertOpenPlot(state, plotIndex);
  if (state.plots[plotIndex]) throw new GameError('That plot is already planted.');
  if (!state.seeds[cropId]) throw new GameError('You have no seed of that crop.');
  addCount(state.seeds, cropId, -1);
  const hours = RARITY[CROP[cropId].rarity].hours;
  state.plots[plotIndex] = { cropId, plantedAt: now, readyAt: now + (hours * HOUR_MS) / speed };
  return { cropId };
}

export function plotProgress(plot, now) {
  if (!plot) return null;
  const total = plot.readyAt - plot.plantedAt;
  const done = Math.min(Math.max(now - plot.plantedAt, 0), total);
  const ratio = total > 0 ? done / total : 1;
  // Five growth stages: 0–3 while growing, 4 when ready.
  const stage = ratio >= 1 ? 4 : Math.min(3, Math.floor(ratio * 4));
  return { ratio, stage, ready: ratio >= 1, msLeft: Math.max(plot.readyAt - now, 0) };
}

export function harvest(state, plotIndex, now) {
  assertOpenPlot(state, plotIndex);
  const plot = state.plots[plotIndex];
  if (!plot) throw new GameError('Nothing is planted there.');
  if (!plotProgress(plot, now).ready) throw new GameError('That crop is still growing.');
  const crop = CROP[plot.cropId];
  const coins = cropPayout(crop.id, state.level);
  let gems = HARVEST_GEMS[crop.rarity]?.[crop.tier] || 0;
  const firstTime = !state.harvested[crop.id];
  if (firstTime) {
    state.harvested[crop.id] = true;
    gems += FIRST_HARVEST_GEMS;
  }
  const xp = TIER[crop.tier].xpHarvest;
  state.coins = round2(state.coins + coins);
  state.stats.coinsEarned = round2(state.stats.coinsEarned + coins);
  state.gems += gems;
  state.xp += xp;
  state.stats.harvests += 1;
  addCount(state.produce, crop.id, 1);
  state.plots[plotIndex] = null;
  return { cropId: crop.id, coins, gems, xp, firstTime };
}

export function finishNowCost(plot, now) {
  const { msLeft } = plotProgress(plot, now);
  return Math.ceil(msLeft / HOUR_MS);
}

export function finishNow(state, plotIndex, now) {
  const plot = state.plots[plotIndex];
  if (!plot) throw new GameError('Nothing is planted there.');
  const cost = finishNowCost(plot, now);
  if (cost === 0) throw new GameError('That crop is already ready.');
  if (state.gems < cost) throw new GameError(`You need ${cost} gems to finish this crop.`);
  state.gems -= cost;
  plot.readyAt = now;
  return { cost };
}

export function useElixir(state, plotIndex, now) {
  const plot = state.plots[plotIndex];
  if (!plot) throw new GameError('Nothing is planted there.');
  if (plotProgress(plot, now).ready) throw new GameError('That crop is already ready.');
  if (!state.items.elixir) throw new GameError('You have no Growth Elixir.');
  addCount(state.items, 'elixir', -1);
  plot.readyAt = Math.max(now, plot.readyAt - ELIXIR_HOURS * HOUR_MS);
  return {};
}

export function levelUp(state) {
  const cost = nextLevelCost(state.level);
  if (cost === null) throw new GameError('Your valley is at max level.');
  if (state.coins < cost) throw new GameError(`You need ${cost} coins for the next level.`);
  state.coins = round2(state.coins - cost);
  state.stats.coinsSpent = round2(state.stats.coinsSpent + cost);
  state.level += 1;
  const gems = LEVEL_UP_GEMS_PER_LEVEL * state.level;
  state.gems += gems;
  return { level: state.level, gems };
}

export function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function canClaimChest(state, now) {
  return state.lastChestDay !== dayKey(now);
}

export function claimChest(state, now, rng = Math.random) {
  if (!canClaimChest(state, now)) throw new GameError('You already opened today’s chest.');
  const chest = chestFor(state.level);
  const [lo, hi] = chest.gems;
  const gems = lo + Math.floor(rng() * (hi - lo + 1));
  state.gems += gems;
  state.lastChestDay = dayKey(now);

  let r = rng();
  let drop = chest.loot[chest.loot.length - 1][0];
  for (const [kind, chance] of chest.loot) {
    r -= chance;
    if (r < 0) { drop = kind; break; }
  }

  const result = { chest: chest.id, gems, drop };
  if (drop === 'produce') {
    const pool = CROPS.filter(c => c.tier === chest.produceTier);
    const crop = pool[Math.floor(rng() * pool.length)];
    addCount(state.produce, crop.id, 1);
    result.cropId = crop.id;
  } else if (drop.startsWith('seed:')) {
    const tier = drop.slice(5);
    state.packs[tier] = (state.packs[tier] || 0) + 1;
    result.tier = tier;
  } else {
    addCount(state.items, drop, 1);
    result.item = drop;
  }
  return result;
}

// --- Save / load -------------------------------------------------------------

export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(json) {
  const data = JSON.parse(json);
  if (!data || data.version !== SAVE_VERSION) return null;
  const fresh = newGame(data.name);
  const state = { ...fresh, ...data, stats: { ...fresh.stats, ...data.stats } };
  if (!Array.isArray(state.plots) || state.plots.length !== MAX_PLOTS) {
    state.plots = Array.from({ length: MAX_PLOTS }, (_, i) => data.plots?.[i] ?? null);
  }
  return state;
}

// --- Helpers -----------------------------------------------------------------

function assertOpenPlot(state, index) {
  if (index < 0 || index >= MAX_PLOTS) throw new GameError('No such plot.');
  if (index >= plotCount(state.level)) {
    throw new GameError(`This plot unlocks at level ${levelUnlockingPlot(index)}.`);
  }
}

function addCount(bag, key, n) {
  bag[key] = (bag[key] || 0) + n;
  if (bag[key] <= 0) delete bag[key];
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}
