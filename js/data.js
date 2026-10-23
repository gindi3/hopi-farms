// Economy constants for Hopi Farms. Numbers come from DESIGN.md.

export const GAME_NAME = 'Hopi Farms';

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export const RARITY = {
  common:    { label: 'Common',    chance: 0.2788, hours: 3,  mult: 0.5, color: '#c9c2b2' },
  uncommon:  { label: 'Uncommon',  chance: 0.4376, hours: 4,  mult: 0.9, color: '#8fd16a' },
  rare:      { label: 'Rare',      chance: 0.2142, hours: 8,  mult: 1.2, color: '#5ab4f0' },
  epic:      { label: 'Epic',      chance: 0.0616, hours: 12, mult: 2.0, color: '#d66be0' },
  legendary: { label: 'Legendary', chance: 0.0078, hours: 24, mult: 5.4, color: '#f2c94c' },
};

export const TIERS = ['feeble', 'pico', 'basic', 'premium'];

export const TIER = {
  feeble:  { label: 'Feeble',  cost: 1,   xpOpen: 1,  xpHarvest: 1 },
  pico:    { label: 'Pico',    cost: 20,  xpOpen: 2,  xpHarvest: 4 },
  basic:   { label: 'Basic',   cost: 100, xpOpen: 5,  xpHarvest: 15 },
  premium: { label: 'Premium', cost: 800, xpOpen: 20, xpHarvest: 60 },
};

// Gems paid on harvest, by rarity then tier.
export const HARVEST_GEMS = {
  epic:      { feeble: 1, pico: 1, basic: 2,  premium: 5 },
  legendary: { feeble: 5, pico: 5, basic: 10, premium: 25 },
};

// Crop roster. `shape` and `colors` drive the sprite generator in sprites.js.
export const CROPS = [
  // Feeble
  { id: 'f_potato',  name: 'F. Potato',  tier: 'feeble', rarity: 'common',    shape: 'tuber',  colors: ['#8a6a3d', '#6b4f2a', '#a8875a'] },
  { id: 'f_lettuce', name: 'F. Lettuce', tier: 'feeble', rarity: 'uncommon',  shape: 'leafy',  colors: ['#9bd46a', '#5f9e3a', '#d6f0a8'] },
  { id: 'f_cabbage', name: 'F. Cabbage', tier: 'feeble', rarity: 'rare',      shape: 'head',   colors: ['#8cc46a', '#4f8a35', '#c4e6a0'] },
  { id: 'f_onion',   name: 'F. Onion',   tier: 'feeble', rarity: 'epic',      shape: 'bulb',   colors: ['#c8874a', '#8f5a2a', '#e8b880'] },
  { id: 'f_radish',  name: 'F. Radish',  tier: 'feeble', rarity: 'legendary', shape: 'root',   colors: ['#a3447a', '#6e2a52', '#d87aab'] },
  // Pico
  { id: 'potato',  name: 'Potato',  tier: 'pico', rarity: 'common',    shape: 'tuber', colors: ['#a6774a', '#7a5330', '#c99a6a'] },
  { id: 'lettuce', name: 'Lettuce', tier: 'pico', rarity: 'uncommon',  shape: 'leafy', colors: ['#a8e070', '#62a83c', '#e2f7b8'] },
  { id: 'cabbage', name: 'Cabbage', tier: 'pico', rarity: 'rare',      shape: 'head',  colors: ['#9fd477', '#5a9a3c', '#d4f0ae'] },
  { id: 'onion',   name: 'Onion',   tier: 'pico', rarity: 'epic',      shape: 'bulb',  colors: ['#e0a040', '#a86e22', '#f5d08a'] },
  { id: 'radish',  name: 'Radish',  tier: 'pico', rarity: 'legendary', shape: 'root',  colors: ['#d0406a', '#8e2444', '#f08aa8'] },
  // Basic
  { id: 'wheat',       name: 'Wheat',       tier: 'basic', rarity: 'common',    shape: 'grain',   colors: ['#e8c25a', '#b08a30', '#f7e2a0'] },
  { id: 'tomato',      name: 'Tomato',      tier: 'basic', rarity: 'common',    shape: 'round',   colors: ['#e04a3a', '#a82a22', '#f7907a'] },
  { id: 'carrot',      name: 'Carrot',      tier: 'basic', rarity: 'common',    shape: 'long',    colors: ['#f08a2a', '#b85e16', '#f7b870'] },
  { id: 'corn',        name: 'Corn',        tier: 'basic', rarity: 'common',    shape: 'cob',     colors: ['#f2d34a', '#c0a028', '#fbeea0'] },
  { id: 'pumpkin',     name: 'Pumpkin',     tier: 'basic', rarity: 'uncommon',  shape: 'gourd',   colors: ['#f0862a', '#b55a14', '#f8b870'] },
  { id: 'chili',       name: 'Chili',       tier: 'basic', rarity: 'uncommon',  shape: 'pepper',  colors: ['#d8302a', '#981c18', '#f2786a'] },
  { id: 'parsnip',     name: 'Parsnip',     tier: 'basic', rarity: 'uncommon',  shape: 'long',    colors: ['#ecdcae', '#b8a676', '#fbf3da'] },
  { id: 'celery',      name: 'Celery',      tier: 'basic', rarity: 'rare',      shape: 'stalks',  colors: ['#9ed86e', '#5e9c3a', '#d8f4b4'] },
  { id: 'broccoli',    name: 'Broccoli',    tier: 'basic', rarity: 'rare',      shape: 'floret',  colors: ['#4f9e48', '#2e6a2c', '#86cc72'] },
  { id: 'cauliflower', name: 'Cauliflower', tier: 'basic', rarity: 'epic',      shape: 'floret',  colors: ['#f4efe0', '#c8bfa4', '#ffffff'] },
  { id: 'berry',       name: 'Berry',       tier: 'basic', rarity: 'epic',      shape: 'berries', colors: ['#d83a5a', '#962238', '#f584a0'] },
  { id: 'grapes',      name: 'Grapes',      tier: 'basic', rarity: 'legendary', shape: 'cluster', colors: ['#7a4cc0', '#4e2c86', '#b08ae8'] },
  // Premium
  { id: 'banana',       name: 'Banana',       tier: 'premium', rarity: 'common',    shape: 'banana',    colors: ['#f5d84a', '#c0a020', '#fff2a0'] },
  { id: 'mango',        name: 'Mango',        tier: 'premium', rarity: 'common',    shape: 'round',     colors: ['#f2a23a', '#c06a1e', '#f8d080'] },
  { id: 'avocado',      name: 'Avocado',      tier: 'premium', rarity: 'common',    shape: 'pear',      colors: ['#4e7a2e', '#2e4c1a', '#c8d878'] },
  { id: 'pineapple',    name: 'Pineapple',    tier: 'premium', rarity: 'uncommon',  shape: 'pineapple', colors: ['#e8b83a', '#a87a1e', '#f5dc80'] },
  { id: 'blueberry',    name: 'Blueberry',    tier: 'premium', rarity: 'uncommon',  shape: 'berries',   colors: ['#4a6ad8', '#2a3e96', '#94acf5'] },
  { id: 'artichoke',    name: 'Artichoke',    tier: 'premium', rarity: 'uncommon',  shape: 'head',      colors: ['#88b05a', '#4e7434', '#c4dc96'] },
  { id: 'papaya',       name: 'Papaya',       tier: 'premium', rarity: 'rare',      shape: 'pear',      colors: ['#f29a3a', '#b8641c', '#f8c880'] },
  { id: 'fig',          name: 'Fig',          tier: 'premium', rarity: 'rare',      shape: 'pear',      colors: ['#7a3a6a', '#4e2044', '#b0709e'] },
  { id: 'lychee',       name: 'Lychee',       tier: 'premium', rarity: 'epic',      shape: 'round',     colors: ['#e05a6a', '#a03244', '#f5a0aa'] },
  { id: 'lavender',     name: 'Lavender',     tier: 'premium', rarity: 'epic',      shape: 'flower',    colors: ['#a07ad8', '#6a4aa0', '#d0b8f5'] },
  { id: 'dragon_fruit', name: 'Dragon Fruit', tier: 'premium', rarity: 'legendary', shape: 'dragon',    colors: ['#e83a8a', '#a82060', '#8fd16a'] },
];

export const CROP = Object.fromEntries(CROPS.map(c => [c.id, c]));

// Tunable economy numbers. These, and the TIER costs, RARITY odds/payouts/hours,
// LEVEL_COSTS, HARVEST_GEMS, STARTER coins and CHESTS gem ranges below, can be changed
// at runtime from the admin dashboard (see economy.js); keep them mutable.
//   Each valley level adds harvestBonusPerLevel to every harvest payout, so
//   RTP = min(baseRtp × (1 + harvestBonusPerLevel × level), rtpCap). baseRtp comes from the odds.
//   Defaults: +0.25% per level, +3.75% at level 15 → 95.56% × 1.0375 ≈ 99.14%.
export const ECON = {
  baseRtp: 0.9556,
  harvestBonusPerLevel: 0.0025,
  rtpCap: 1.0,
  firstHarvestGems: 2,
  levelUpGemsPerLevel: 10,
  skipGemsPerHour: 1,       // gems to skip each hour (or part) of growing with Finish now
  farmCost: 500,            // $CROP to open each farm after the first (keep above starter $CROP)
};
export const MAX_LEVEL = 15;
// Farms per account. Each has its own plots, valley level and daily chest; the $CROP
// balance, gems, XP and backpack are shared.
export const MAX_FARMS = 30;

// Cost to go from level (i) to (i + 1); 7,550 in total for all 15 levels.
export const LEVEL_COSTS = [100, 125, 150, 175, 250, 300, 350, 400, 450, 600, 700, 800, 900, 1000, 1250];

export const BASE_PLOTS = 15;
// Levels that open one more plot: every level, so all 30 are open at level 15.
export const PLOT_LEVELS = Array.from({ length: 15 }, (_, i) => i + 1);
// Plot slots in a save and on the farm screen.
export const MAX_PLOTS = 30;

export const STARTER = { coins: 100, seeds: { f_potato: 2, f_lettuce: 2, f_cabbage: 1 } };

// Daily chest tiers, by minimum level. Loot rolls use the original's tables, with
// MVP-only items (Pesticide, Fertilizer) kept in inventory until crafting ships.
export const CHESTS = [
  { id: 'wooden', label: 'Wooden', minLevel: 0,  gems: [1, 2],  produceTier: 'pico',
    loot: [['produce', 0.90], ['seed:feeble', 0.098], ['seed:pico', 0.002]] },
  { id: 'bronze', label: 'Bronze', minLevel: 5,  gems: [2, 4],  produceTier: 'pico',
    loot: [['produce', 0.533], ['elixir', 0.02], ['pesticide', 0.02], ['seed:feeble', 0.40], ['seed:pico', 0.025], ['seed:basic', 0.002]] },
  { id: 'silver', label: 'Silver', minLevel: 10, gems: [4, 8],  produceTier: 'basic',
    loot: [['produce', 0.50], ['elixir', 0.04], ['pesticide', 0.04], ['fertilizer', 0.005], ['seed:feeble', 0.30], ['seed:pico', 0.095], ['seed:basic', 0.02]] },
  { id: 'gold',   label: 'Gold',   minLevel: 15, gems: [8, 15], produceTier: 'premium',
    loot: [['produce', 0.55], ['elixir', 0.06], ['pesticide', 0.08], ['fertilizer', 0.02], ['seed:feeble', 0.099], ['seed:pico', 0.15], ['seed:basic', 0.04], ['seed:premium', 0.001]] },
];

// Potions, in three grades each. Apply them to a growing crop from its panel.
//   elixir: hours cut from the grow time · pesticide: extra produce at harvest ·
//   fertilizer: bonus share of harvest XP and produce (never $CROP, to respect the RTP cap).
// The original ids (elixir, pesticide, fertilizer) are the Lesser grade, which chests drop.
const GRADES = ['Lesser', 'Standard', 'Advanced'];
const potion = (kind, name, values, describe) => Object.fromEntries(values.map((v, i) => [
  i === 0 ? kind : `${kind}${i + 1}`,
  { kind, grade: i + 1, value: v, name: `${GRADES[i]} ${name}`, desc: describe(v) },
]));
export const ITEMS = {
  ...potion('elixir', 'Growth Elixir', [3, 6, 12], (v) => `Cuts ${v}h off a growing crop.`),
  ...potion('pesticide', 'Pesticide', [1, 2, 3], (v) => `+${v} produce when the crop is harvested.`),
  ...potion('fertilizer', 'Fertilizer', [0.04, 0.06, 0.08], (v) => `+${v * 100}% harvest XP and produce.`),
};
export const itemId = (kind, grade) => (grade === 1 ? kind : `${kind}${grade}`);

// Potions Master recipes: pick one option, burn that produce, and roll a brewing outcome.
export const RECIPES = {
  elixir:     { name: 'Growth Elixir', xp: 75,   options: [{ tier: 'pico', rarity: 'legendary', count: 2 }, { tier: 'pico', rarity: 'epic', count: 8 }] },
  pesticide:  { name: 'Pesticide',     xp: 250,  options: [{ tier: 'basic', rarity: 'legendary', count: 2 }, { tier: 'basic', rarity: 'epic', count: 4 }] },
  fertilizer: { name: 'Fertilizer',    xp: 2000, options: [{ tier: 'pico', rarity: 'legendary', count: 2 }, { tier: 'pico', rarity: 'epic', count: 4 }] },
};
// Grade 0 = the brew fizzles and the produce is lost.
export const BREW_ODDS = [
  { grade: 0, label: 'Disaster', chance: 0.10 },
  { grade: 1, label: 'Lesser', chance: 0.825 },
  { grade: 2, label: 'Standard', chance: 0.06 },
  { grade: 3, label: 'Advanced', chance: 0.015 },
];
export const HOUR_MS = 3600 * 1000;
