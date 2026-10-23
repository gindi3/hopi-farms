// Game rules for Hopi Farms. Pure functions over a plain state object, with no DOM access,
// so they run in tests. `now` is passed in (ms) and `rng` returns [0, 1).

import {
  RARITIES, RARITY, TIER, CROPS, CROP, HARVEST_GEMS, ECON,
  MAX_LEVEL, LEVEL_COSTS, BASE_PLOTS, MAX_PLOTS, PLOT_LEVELS,
  STARTER, CHESTS, HOUR_MS, ITEMS, RECIPES, BREW_ODDS, itemId, MAX_FARMS,
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
    // Every farm on the account. The active farm's live level/plots/chest are the top-level
    // fields above; its entry here only keeps its name until you switch away from it.
    farms: [emptyFarm('Farm 1')],
    activeFarm: 0,
    stats: { packsOpened: 0, harvests: 0, coinsSpent: 0, coinsEarned: 0, packSpend: 0, levelSpend: 0 },
  };
}

function emptyFarm(name) {
  return { name, level: 0, plots: Array.from({ length: MAX_PLOTS }, () => null), lastChestDay: null };
}

// --- Farms -----------------------------------------------------------------------

// All farms with live values for the active one.
export function farmList(state) {
  return state.farms.map((f, i) => (i === state.activeFarm
    ? { name: f.name, level: state.level, plots: state.plots, lastChestDay: state.lastChestDay }
    : f));
}

export function maxLevel(state) {
  return Math.max(...farmList(state).map(f => f.level));
}

export function switchFarm(state, index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.farms.length) throw new GameError('No such farm.');
  if (index === state.activeFarm) return { index };
  const cur = state.farms[state.activeFarm];
  state.farms[state.activeFarm] = { name: cur.name, level: state.level, plots: state.plots, lastChestDay: state.lastChestDay };
  const next = state.farms[index];
  state.level = next.level;
  state.plots = next.plots;
  state.lastChestDay = next.lastChestDay;
  state.activeFarm = index;
  return { index };
}

export function nextFarmCost(state) {
  return state.farms.length >= MAX_FARMS ? null : ECON.farmCost;
}

// Open another farm (up to MAX_FARMS): costs ECON.farmCost, comes with the starter $CROP and
// seeds like a first farm, and becomes the active farm.
export function openFarm(state) {
  const cost = nextFarmCost(state);
  if (cost === null) throw new GameError(`You already have ${MAX_FARMS} farms, the most allowed.`);
  if (state.coins < cost) throw new GameError(`You need ${cost} $CROP to open a new farm.`);
  state.coins = round2(state.coins - cost + STARTER.coins);
  state.stats.coinsSpent = round2(state.stats.coinsSpent + cost);
  state.stats.farmSpend = round2((state.stats.farmSpend || 0) + cost);
  for (const [id, n] of Object.entries(STARTER.seeds)) addCount(state.seeds, id, n);
  state.farms.push(emptyFarm(`Farm ${state.farms.length + 1}`));
  switchFarm(state, state.farms.length - 1);
  return { index: state.activeFarm, cost, starter: STARTER.coins, farms: state.farms.length };
}

// --- Economy -----------------------------------------------------------------

export function rtp(level) {
  return Math.min(ECON.baseRtp * (1 + ECON.harvestBonusPerLevel * level), ECON.rtpCap);
}

export function cropPayout(cropId, level) {
  const crop = CROP[cropId];
  const raw = TIER[crop.tier].cost * RARITY[crop.rarity].mult * (rtp(level) / ECON.baseRtp);
  return round2(raw);
}

export function expectedReturn(level) {
  return RARITIES.reduce((sum, r) => sum + RARITY[r].chance * RARITY[r].mult, 0) * (rtp(level) / ECON.baseRtp);
}

export function plotCount(level) {
  return BASE_PLOTS + PLOT_LEVELS.filter(l => l <= level).length;
}

// The level that opens plot `index`, or null if it never opens.
export function levelUnlockingPlot(index) {
  if (index < BASE_PLOTS) return 0;
  return PLOT_LEVELS[index - BASE_PLOTS] ?? null;
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
  if (state.coins < cost) throw new GameError(`Not enough $CROP for a ${TIER[tier].label} pack.`);
  state.coins = round2(state.coins - cost);
  state.stats.coinsSpent = round2(state.stats.coinsSpent + cost);
  state.stats.packSpend = round2((state.stats.packSpend || 0) + cost);
  state.stats.spentByTier = state.stats.spentByTier || {};
  state.stats.spentByTier[tier] = round2((state.stats.spentByTier[tier] || 0) + cost);
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
  state.stats.pulls = state.stats.pulls || {};
  addCount(state.stats.pulls, crop.id, 1);
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

export function harvest(state, plotIndex, now, rng = Math.random) {
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
    gems += ECON.firstHarvestGems;
  }
  // Potions on the plot: Pesticide adds produce; Fertilizer boosts XP and may add produce.
  let xp = TIER[crop.tier].xpHarvest;
  let produce = 1;
  for (const id of plot.effects || []) {
    const it = ITEMS[id];
    if (!it) continue;
    if (it.kind === 'pesticide') produce += it.value;
    if (it.kind === 'fertilizer') {
      xp = Math.round(xp * (1 + it.value));
      if (rng() < it.value) produce += 1;
    }
  }
  state.coins = round2(state.coins + coins);
  state.stats.coinsEarned = round2(state.stats.coinsEarned + coins);
  state.stats.harvestCoins = round2((state.stats.harvestCoins || 0) + coins);
  state.stats.harvestedBy = state.stats.harvestedBy || {};
  state.stats.harvestedBy[crop.id] = round2((state.stats.harvestedBy[crop.id] || 0) + coins);
  state.gems += gems;
  state.xp += xp;
  state.stats.harvests += 1;
  addCount(state.produce, crop.id, produce);
  state.plots[plotIndex] = null;
  return { cropId: crop.id, coins, gems, xp, produce, firstTime };
}

// Finish now costs ECON.skipGemsPerHour gems for each hour (or part of one) still to grow.
export function finishNowCost(plot, now) {
  const { msLeft } = plotProgress(plot, now);
  return Math.ceil(msLeft / HOUR_MS) * ECON.skipGemsPerHour;
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

// Apply a potion to a growing crop. Elixirs act at once; Pesticide and Fertilizer are kept
// on the plot and pay off at harvest (one of each kind per crop).
export function useItem(state, plotIndex, id, now) {
  const it = ITEMS[id];
  if (!it) throw new GameError('Unknown item.');
  const plot = state.plots[plotIndex];
  if (!plot) throw new GameError('Nothing is planted there.');
  if (plotProgress(plot, now).ready) throw new GameError('That crop is already ready.');
  if (!state.items[id]) throw new GameError(`You have no ${it.name}.`);
  plot.effects = plot.effects || [];
  if (it.kind !== 'elixir' && plot.effects.some(e => ITEMS[e]?.kind === it.kind)) {
    throw new GameError(`This crop already has ${it.kind === 'pesticide' ? 'Pesticide' : 'Fertilizer'}.`);
  }
  addCount(state.items, id, -1);
  if (it.kind === 'elixir') plot.readyAt = Math.max(now, plot.readyAt - it.value * HOUR_MS);
  plot.effects.push(id);
  return { item: id };
}

export function useElixir(state, plotIndex, now) {
  return useItem(state, plotIndex, 'elixir', now);
}

// Produce that counts for a recipe option: crops of that pack tier and rarity.
export function recipeStock(state, option) {
  return CROPS.filter(c => c.tier === option.tier && c.rarity === option.rarity)
    .reduce((n, c) => n + (state.produce[c.id] || 0), 0);
}

// Brew a potion at the Potions Master. Burns the option's produce, then rolls the grade
// (or a disaster that wastes it). Success also grants the recipe's XP.
export function craft(state, recipeId, optionIndex, rng = Math.random) {
  const recipe = RECIPES[recipeId];
  const option = recipe?.options[optionIndex];
  if (!option) throw new GameError('Unknown recipe.');
  if (recipeStock(state, option) < option.count) throw new GameError(`You need ${option.count} ${RARITY[option.rarity].label} ${TIER[option.tier].label} produce.`);
  let left = option.count;
  // Use the largest stacks first.
  for (const c of CROPS.filter(c => c.tier === option.tier && c.rarity === option.rarity)
    .sort((a, b) => (state.produce[b.id] || 0) - (state.produce[a.id] || 0))) {
    const take = Math.min(left, state.produce[c.id] || 0);
    if (take) addCount(state.produce, c.id, -take);
    left -= take;
    if (!left) break;
  }
  let r = rng(), grade = BREW_ODDS[BREW_ODDS.length - 1].grade;
  for (const o of BREW_ODDS) { r -= o.chance; if (r < 0) { grade = o.grade; break; } }
  state.stats.brews = (state.stats.brews || 0) + 1;
  if (grade === 0) return { recipe: recipeId, grade: 0 };
  const id = itemId(recipeId, grade);
  addCount(state.items, id, 1);
  state.xp += recipe.xp;
  return { recipe: recipeId, grade, item: id, xp: recipe.xp };
}

export function levelUp(state) {
  const cost = nextLevelCost(state.level);
  if (cost === null) throw new GameError('Your valley is at max level.');
  if (state.coins < cost) throw new GameError(`You need ${cost} $CROP for the next level.`);
  state.coins = round2(state.coins - cost);
  state.stats.coinsSpent = round2(state.stats.coinsSpent + cost);
  state.stats.levelSpend = round2((state.stats.levelSpend || 0) + cost);
  state.level += 1;
  const gems = ECON.levelUpGemsPerLevel * state.level;
  state.gems += gems;
  const chestReady = state.lastChestDay !== null;
  state.lastChestDay = null;          // a level-up refreshes the daily chest
  return { level: state.level, gems, chestRefreshed: chestReady };
}

// The chest day is a UTC calendar day, so the server and every player's browser agree on
// when it resets, whatever their time zone.
export function dayKey(now) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

// Milliseconds until the next chest day starts (midnight UTC).
export function msToNextDay(now) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
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
  state.level = Math.min(Math.max(0, state.level | 0), MAX_LEVEL);
  const fitPlots = (plots) => (Array.isArray(plots) && plots.length === MAX_PLOTS
    ? plots : Array.from({ length: MAX_PLOTS }, (_, i) => plots?.[i] ?? null));
  state.plots = fitPlots(data.plots);
  // Saves from before multiple farms: the one farm becomes Farm 1.
  if (!Array.isArray(data.farms) || !data.farms.length) {
    state.farms = [emptyFarm('Farm 1')];
    state.activeFarm = 0;
  } else {
    state.farms = data.farms.map((f, i) => ({ ...emptyFarm(f.name || `Farm ${i + 1}`), ...f, plots: fitPlots(f.plots),
      level: Math.min(Math.max(0, f.level | 0), MAX_LEVEL) }));
    state.activeFarm = Math.min(Math.max(0, data.activeFarm | 0), state.farms.length - 1);
  }
  return state;
}

// --- Helpers -----------------------------------------------------------------

function assertOpenPlot(state, index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_PLOTS) throw new GameError('No such plot.');
  if (index >= plotCount(state.level)) {
    const lv = levelUnlockingPlot(index);
    throw new GameError(lv === null ? 'That plot never opens.' : `This plot unlocks at level ${lv}.`);
  }
}

function addCount(bag, key, n) {
  bag[key] = (bag[key] || 0) + n;
  if (bag[key] <= 0) delete bag[key];
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}
