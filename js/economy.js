// The editable part of the economy as one plain JSON object, so it can be saved by the
// server, sent to every client, and changed from the admin dashboard. applyEconomy writes
// a validated config into the shared objects in data.js that the game rules read.

import {
  RARITIES, RARITY, TIERS, TIER, ECON, LEVEL_COSTS, HARVEST_GEMS, STARTER, CHESTS, MAX_LEVEL,
} from './data.js';

export function snapshotEconomy() {
  return {
    packCost: Object.fromEntries(TIERS.map(t => [t, TIER[t].cost])),
    rarity: Object.fromEntries(RARITIES.map(r => [r, {
      chance: RARITY[r].chance, mult: RARITY[r].mult, hours: RARITY[r].hours,
    }])),
    harvestBonusPerLevel: ECON.harvestBonusPerLevel,
    rtpCap: ECON.rtpCap,
    levelCosts: [...LEVEL_COSTS],
    harvestGems: {
      epic: { ...HARVEST_GEMS.epic },
      legendary: { ...HARVEST_GEMS.legendary },
    },
    firstHarvestGems: ECON.firstHarvestGems,
    levelUpGemsPerLevel: ECON.levelUpGemsPerLevel,
    starterCoins: STARTER.coins,
    farmCost: ECON.farmCost,
    chestGems: Object.fromEntries(CHESTS.map(c => [c.id, [...c.gems]])),
  };
}

// The values the game shipped with, captured before anything is changed.
export const DEFAULT_ECONOMY = snapshotEconomy();

// Settings saved by an older version may lack newer fields: fill those from the defaults.
export function withDefaults(cfg) {
  return cfg && typeof cfg === 'object' ? { ...DEFAULT_ECONOMY, ...cfg } : DEFAULT_ECONOMY;
}

// Base RTP implied by the odds and payouts: the expected return of one pack at level 0.
export function baseRtpOf(cfg) {
  return RARITIES.reduce((sum, r) => sum + cfg.rarity[r].chance * cfg.rarity[r].mult, 0);
}

// Returns a list of human-readable problems; empty means the config is safe to apply.
export function validateEconomy(cfg) {
  const errors = [];
  const num = (v, label, { min = 0, max = Infinity, int = false } = {}) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return errors.push(`${label} must be a number.`);
    if (int && !Number.isInteger(v)) return errors.push(`${label} must be a whole number.`);
    if (v < min || v > max) errors.push(`${label} must be between ${min} and ${max}.`);
  };
  if (!cfg || typeof cfg !== 'object') return ['Missing economy settings.'];

  for (const t of TIERS) num(cfg.packCost?.[t], `${TIER[t].label} pack price`, { min: 0.01, max: 1e6 });
  let chanceSum = 0;
  for (const r of RARITIES) {
    const x = cfg.rarity?.[r];
    const label = RARITY[r].label;
    if (!x) { errors.push(`${label} settings are missing.`); continue; }
    num(x.chance, `${label} chance`, { min: 0, max: 1 });
    num(x.mult, `${label} payout`, { min: 0, max: 100 });
    num(x.hours, `${label} grow time`, { min: 0.01, max: 24 * 14 });
    chanceSum += Number(x.chance) || 0;
  }
  if (Math.abs(chanceSum - 1) > 1e-6) errors.push(`Drop chances must add up to 100% (they add up to ${(chanceSum * 100).toFixed(4)}%).`);
  num(cfg.harvestBonusPerLevel, 'Harvest bonus per level', { min: 0, max: 0.1 });
  num(cfg.rtpCap, 'RTP cap', { min: 0.01, max: 2 });
  if (!Array.isArray(cfg.levelCosts) || cfg.levelCosts.length !== MAX_LEVEL) {
    errors.push(`Level costs need exactly ${MAX_LEVEL} entries.`);
  } else {
    cfg.levelCosts.forEach((c, i) => num(c, `Level ${i + 1} cost`, { min: 0, max: 1e9 }));
  }
  for (const r of ['epic', 'legendary']) {
    for (const t of TIERS) num(cfg.harvestGems?.[r]?.[t], `${RARITY[r].label} ${TIER[t].label} gem reward`, { min: 0, max: 1e6, int: true });
  }
  num(cfg.firstHarvestGems, 'First-harvest gems', { min: 0, max: 1e6, int: true });
  num(cfg.levelUpGemsPerLevel, 'Level-up gems per level', { min: 0, max: 1e6, int: true });
  num(cfg.starterCoins, 'Starter $CROP', { min: 0, max: 1e9 });
  num(cfg.farmCost, 'New farm price', { min: 0, max: 1e9 });
  for (const c of CHESTS) {
    const g = cfg.chestGems?.[c.id];
    if (!Array.isArray(g) || g.length !== 2) { errors.push(`${c.label} chest gems need a min and max.`); continue; }
    num(g[0], `${c.label} chest min gems`, { min: 0, max: 1e6, int: true });
    num(g[1], `${c.label} chest max gems`, { min: 0, max: 1e6, int: true });
    if (g[0] > g[1]) errors.push(`${c.label} chest min gems can't be above the max.`);
  }
  return errors;
}

// Write a config into the live game objects. Throws if it doesn't validate.
export function applyEconomy(cfg) {
  const errors = validateEconomy(cfg);
  if (errors.length) throw new Error(errors.join(' '));
  for (const t of TIERS) TIER[t].cost = cfg.packCost[t];
  for (const r of RARITIES) Object.assign(RARITY[r], cfg.rarity[r]);
  ECON.baseRtp = baseRtpOf(cfg);
  ECON.harvestBonusPerLevel = cfg.harvestBonusPerLevel;
  ECON.rtpCap = cfg.rtpCap;
  LEVEL_COSTS.splice(0, LEVEL_COSTS.length, ...cfg.levelCosts);
  Object.assign(HARVEST_GEMS.epic, cfg.harvestGems.epic);
  Object.assign(HARVEST_GEMS.legendary, cfg.harvestGems.legendary);
  ECON.firstHarvestGems = cfg.firstHarvestGems;
  ECON.levelUpGemsPerLevel = cfg.levelUpGemsPerLevel;
  STARTER.coins = cfg.starterCoins;
  ECON.farmCost = cfg.farmCost;
  for (const c of CHESTS) c.gems = [...cfg.chestGems[c.id]];
}

// Short fingerprint so clients can tell when the economy changed.
export function economyVersion(cfg) {
  const json = JSON.stringify(cfg);
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) h = Math.imul(h ^ json.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}
