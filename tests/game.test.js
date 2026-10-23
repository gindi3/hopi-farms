import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RARITIES, RARITY, CROPS, TIERS, MAX_LEVEL, CHESTS, HOUR_MS } from '../js/data.js';
import * as G from '../js/game.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('drop table sums to 1 and base RTP matches the docs', () => {
  near(RARITIES.reduce((s, r) => s + RARITY[r].chance, 0), 1);
  near(G.expectedReturn(0), 0.9556, 1e-4);
});

test('RTP adds 0.10% per level and caps at 99.0% at level 35', () => {
  near(G.rtp(0), 0.9556);
  near(G.rtp(10), 0.9656);
  near(G.rtp(34), 0.9896);
  near(G.rtp(35), 0.99);
  near(G.expectedReturn(35), 0.99, 1e-4);
  for (let l = 0; l <= MAX_LEVEL; l++) assert.ok(G.expectedReturn(l) <= 0.99 + 1e-9);
});

test('every tier has a crop for every rarity', () => {
  for (const t of TIERS) for (const r of RARITIES) {
    assert.ok(CROPS.some(c => c.tier === t && c.rarity === r), `${t}/${r}`);
  }
});

test('chest loot tables sum to 1', () => {
  for (const c of CHESTS) near(c.loot.reduce((s, [, p]) => s + p, 0), 1, 1e-9);
});

test('plots: 15 at level 0, +1 per even level, 30 by level 30', () => {
  assert.equal(G.plotCount(0), 15);
  assert.equal(G.plotCount(1), 15);
  assert.equal(G.plotCount(2), 16);
  assert.equal(G.plotCount(30), 30);
  assert.equal(G.plotCount(35), 30);
  assert.equal(G.levelUnlockingPlot(15), 2);
  assert.equal(G.levelUnlockingPlot(29), 30);
});

test('level costs total 85,050', () => {
  let total = 0;
  for (let l = 0; l < MAX_LEVEL; l++) total += G.nextLevelCost(l);
  assert.equal(total, 85050);
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
  assert.equal(G.cropPayout('potato', 35), 10.36);
});

test('locked plots reject planting', () => {
  const s = G.newGame();
  assert.throws(() => G.plant(s, 15, 'f_potato', 0), /unlocks at level 2/);
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
  const r = G.levelUp(s);
  assert.deepEqual(r, { level: 1, gems: 10 });
  assert.equal(s.coins, 0);
  assert.throws(() => G.levelUp(s), G.GameError);
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
