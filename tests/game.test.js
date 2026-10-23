import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RARITIES, RARITY, CROPS, TIERS, MAX_LEVEL, CHESTS, HOUR_MS } from '../js/data.js';
import * as G from '../js/game.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('drop table sums to 1 and base RTP matches the docs', () => {
  near(RARITIES.reduce((s, r) => s + RARITY[r].chance, 0), 1);
  near(G.expectedReturn(0), 0.9556, 1e-4);
});

test('each level adds +0.25% to harvests: 99.14% RTP at level 15', () => {
  near(G.rtp(0), 0.9556);
  near(G.rtp(1), 0.9556 * 1.0025);
  near(G.rtp(15), 0.9556 * 1.0375);
  near(G.expectedReturn(15), 0.99144, 1e-5);
  assert.equal(MAX_LEVEL, 15);
  for (let l = 0; l <= MAX_LEVEL; l++) assert.ok(G.expectedReturn(l) < 1, `level ${l} stays below break-even`);
});

test('every tier has a crop for every rarity', () => {
  for (const t of TIERS) for (const r of RARITIES) {
    assert.ok(CROPS.some(c => c.tier === t && c.rarity === r), `${t}/${r}`);
  }
});

test('chest loot tables sum to 1', () => {
  for (const c of CHESTS) near(c.loot.reduce((s, [, p]) => s + p, 0), 1, 1e-9);
});

test('plots: 15 at level 0, +1 every level, all 30 open at level 15', () => {
  assert.equal(G.plotCount(0), 15);
  assert.equal(G.plotCount(1), 16);
  assert.equal(G.plotCount(7), 22);
  assert.equal(G.plotCount(15), 30);
  assert.equal(G.levelUnlockingPlot(14), 0);
  assert.equal(G.levelUnlockingPlot(15), 1);
  assert.equal(G.levelUnlockingPlot(29), 15);
});

test('level costs total 7,550 over 15 levels', () => {
  let total = 0;
  for (let l = 0; l < MAX_LEVEL; l++) total += G.nextLevelCost(l);
  assert.equal(total, 7550);
  assert.equal(G.nextLevelCost(MAX_LEVEL), null);
});

test('buy, open, plant, grow and harvest a pack', () => {
  const s = G.newGame('Test');
  G.buyPack(s, 'pico');
  assert.equal(s.coins, 80);
  const { cropId } = G.openPack(s, 'pico', () => 0); // rng 0 → common → Potato
  assert.equal(cropId, 'potato');
  G.plant(s, 0, 'potato', 0);
  assert.throws(() => G.harvest(s, 0, HOUR_MS), G.GameError);
  assert.equal(G.plotProgress(s.plots[0], 1.5 * HOUR_MS).stage, 2);
  const res = G.harvest(s, 0, 3 * HOUR_MS);
  assert.equal(res.coins, 10);
  assert.equal(res.gems, 2); // first-harvest bonus only
  assert.equal(s.coins, 90);
  assert.equal(s.produce.potato, 1);
});

test('level bonus scales payouts', () => {
  assert.equal(G.cropPayout('potato', 0), 10);
  assert.equal(G.cropPayout('potato', 15), 10.38);
});

test('locked plots reject planting', () => {
  const s = G.newGame();
  assert.throws(() => G.plant(s, 15, 'f_potato', 0), /unlocks at level 1/);
});

test('finish now costs 1 gem per hour left, rounded up', () => {
  const s = G.newGame();
  s.gems = 10;
  G.plant(s, 0, 'f_potato', 0);
  assert.equal(G.finishNowCost(s.plots[0], 0.5 * HOUR_MS), 3);
  G.finishNow(s, 0, 0.5 * HOUR_MS);
  assert.equal(s.gems, 7);
  assert.ok(G.plotProgress(s.plots[0], 0.5 * HOUR_MS).ready);
});

test('level up pays gems and spends coins', () => {
  const s = G.newGame();
  const r = G.levelUp(s);   // starts with 100 coins; level 1 costs 100
  assert.deepEqual(r, { level: 1, gems: 10, chestRefreshed: false });
  assert.equal(s.coins, 0);
  s.coins = 124;
  assert.throws(() => G.levelUp(s), G.GameError);   // level 2 costs 125
});

test('chest is once per day', () => {
  const s = G.newGame();
  const day = new Date(2026, 9, 23, 10).getTime();
  G.claimChest(s, day, () => 0);
  assert.throws(() => G.claimChest(s, day + HOUR_MS), G.GameError);
  assert.doesNotThrow(() => G.claimChest(s, day + 24 * HOUR_MS, () => 0.5));
});

test('save round-trips', () => {
  const s = G.newGame('Rt');
  G.plant(s, 3, 'f_potato', 123);
  const back = G.deserialize(G.serialize(s));
  assert.deepEqual(back, s);
});

test('simulated RTP over many packs is near 95.56%', () => {
  let seed = 42;
  const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const s = G.newGame();
  s.coins = 1e9;
  let paid = 0, got = 0;
  for (let i = 0; i < 200000; i++) {
    G.buyPack(s, 'basic'); paid += 100;
    const { cropId } = G.openPack(s, 'basic', rng);
    got += G.cropPayout(cropId, 0);
  }
  near(got / paid, 0.9556, 0.01);
});

test('leveling up refreshes the daily chest', () => {
  const s = G.newGame();
  const day = new Date(2026, 9, 23, 10).getTime();
  G.claimChest(s, day, () => 0);
  assert.equal(G.canClaimChest(s, day), false);
  const r = G.levelUp(s);
  assert.equal(r.chestRefreshed, true);
  assert.equal(G.canClaimChest(s, day), true);
});

test('brewing burns produce and rolls a grade; disasters waste it', () => {
  const s = G.newGame();
  s.produce = { radish: 5, onion: 3 };
  // rng 0.5 → Lesser (after the 10% disaster band)
  const ok = G.craft(s, 'elixir', 0, () => 0.5);
  assert.deepEqual(ok, { recipe: 'elixir', grade: 1, item: 'elixir', xp: 75 });
  assert.equal(s.produce.radish, 3);
  assert.equal(s.items.elixir, 1);
  const bad = G.craft(s, 'elixir', 0, () => 0.05);       // disaster
  assert.equal(bad.grade, 0);
  assert.equal(s.produce.radish, 1);
  assert.throws(() => G.craft(s, 'elixir', 0, () => 0.5), /need 2 Legendary Pico/);
  const adv = G.craft(s, 'fertilizer', 0, () => 0.99, s.produce.radish = 2);   // top 1.5% → Advanced
  assert.equal(adv.item, 'fertilizer3');
  assert.throws(() => G.craft(s, 'nope', 0), /Unknown recipe/);
});

test('potions: elixir speeds growth; pesticide and fertilizer pay off at harvest', () => {
  const s = G.newGame();
  s.items = { elixir2: 1, pesticide3: 1, fertilizer3: 1 };
  G.plant(s, 0, 'f_lettuce', 0);                         // 4h crop
  G.useItem(s, 0, 'elixir2', 0);                          // −6h → ready now
  assert.ok(G.plotProgress(s.plots[0], 0).ready);
  assert.throws(() => G.useItem(s, 0, 'pesticide3', 0), /already ready/);

  s.seeds = { f_cabbage: 1 };
  G.plant(s, 1, 'f_cabbage', 0);                          // 8h crop
  G.useItem(s, 1, 'pesticide3', 0);
  G.useItem(s, 1, 'fertilizer3', 0);
  s.items.pesticide = 1;
  assert.throws(() => G.useItem(s, 1, 'pesticide', 0), /already has Pesticide/);
  const r = G.harvest(s, 1, 8 * 3600e3, () => 0);         // fertilizer's extra produce roll hits
  assert.equal(r.produce, 1 + 3 + 1);
  assert.equal(s.produce.f_cabbage, 5);
  assert.equal(r.xp, Math.round(1 * 1.08));
  assert.equal(r.coins, G.cropPayout('f_cabbage', 0));    // never extra $CROP
});

test('history counters: pulls per crop, spend per tier, payouts per crop', () => {
  const s = G.newGame();
  G.buyPack(s, 'pico');
  G.openPack(s, 'pico', () => 0);                         // potato
  G.plant(s, 0, 'potato', 0);
  G.harvest(s, 0, 3 * 3600e3);
  assert.equal(s.stats.pulls.potato, 1);
  assert.equal(s.stats.spentByTier.pico, 20);
  assert.equal(s.stats.harvestedBy.potato, 10);
  assert.equal(s.stats.harvestCoins, 10);
});

test('the chest day is a UTC day and resets at midnight UTC', () => {
  const lateUtc = Date.UTC(2026, 9, 23, 23, 30);
  assert.equal(G.dayKey(lateUtc), '2026-10-23');
  assert.equal(G.dayKey(lateUtc + 31 * 60e3), '2026-10-24');
  assert.equal(G.msToNextDay(lateUtc), 30 * 60e3);
});

test('multiple farms: open, switch, separate plots/levels/chests, shared balance', () => {
  const s = G.newGame();
  s.coins = 2000;
  G.plant(s, 0, 'f_potato', 0);
  G.levelUp(s);                                   // Farm 1 → level 1 (100)
  const day = Date.UTC(2026, 9, 23, 10);
  G.claimChest(s, day, () => 0);
  const r = G.openFarm(s);                        // −500 +100 starter
  assert.deepEqual(r, { index: 1, cost: 500, starter: 100, farms: 2 });
  assert.equal(s.coins, 2000 - 100 - 500 + 100);
  assert.equal(s.activeFarm, 1);
  assert.equal(s.level, 0);                        // new farm starts fresh
  assert.equal(s.plots.filter(Boolean).length, 0);
  assert.ok(G.canClaimChest(s, day));             // its own daily chest
  G.switchFarm(s, 0);
  assert.equal(s.level, 1);
  assert.equal(s.plots[0].cropId, 'f_potato');    // Farm 1's crop is still there
  assert.equal(G.canClaimChest(s, day), false);
  assert.equal(G.maxLevel(s), 1);
  const list = G.farmList(s);
  assert.equal(list.length, 2);
  assert.equal(list[1].level, 0);
});

test('farms are capped at 30 and need enough $CROP', () => {
  const s = G.newGame();
  s.coins = 0;
  assert.throws(() => G.openFarm(s), /need 500/);
  s.coins = 1e7;
  for (let i = 1; i < 30; i++) G.openFarm(s);
  assert.equal(s.farms.length, 30);
  assert.equal(G.nextFarmCost(s), null);
  assert.throws(() => G.openFarm(s), /30 farms/);
  assert.throws(() => G.switchFarm(s, 30), /No such farm/);
});

test('a save from before multiple farms loads as Farm 1', () => {
  const old = G.newGame('Oldie');
  delete old.farms; delete old.activeFarm;
  old.level = 4;
  old.plots[2] = { cropId: 'potato', plantedAt: 0, readyAt: 1 };
  const back = G.deserialize(JSON.stringify(old));
  assert.equal(back.farms.length, 1);
  assert.equal(back.farms[0].name, 'Farm 1');
  assert.equal(back.level, 4);
  assert.equal(back.plots[2].cropId, 'potato');
  const round = G.deserialize(G.serialize(back));
  assert.deepEqual(round, back);
});

test('finish now cost follows the gems-per-hour setting', async () => {
  const { ECON } = await import('../js/data.js');
  const s = G.newGame();
  G.plant(s, 0, 'f_potato', 0);                       // 3h crop
  assert.equal(G.finishNowCost(s.plots[0], 0.5 * 3600e3), 3);
  ECON.skipGemsPerHour = 25;
  try {
    assert.equal(G.finishNowCost(s.plots[0], 0.5 * 3600e3), 75);
  } finally {
    ECON.skipGemsPerHour = 1;
  }
});
