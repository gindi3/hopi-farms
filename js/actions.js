// Every change to a farm goes through applyAction, both in the browser (local mode) and on
// the server (online mode). Actions are plain JSON so they can be sent over the network.
// ctx: { now, rng, speed }.

import * as G from './game.js';
import { CROP, TIER } from './data.js';

export const MAX_BATCH = 9;

export const NAME_MAX = 18;

export function cleanName(name) {
  return String(name ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, NAME_MAX);
}

export function applyAction(state, action, { now, rng = Math.random, speed = 1 }) {
  const plot = Number(action.plot);
  switch (action.type) {
    case 'buyPack':
      return G.buyPack(state, tierOf(action));

    // Open 1–9 owned packs of a tier. Returns { results: [{ cropId, rarity }, ...] }.
    case 'openPack': {
      const tier = tierOf(action), count = countOf(action);
      if ((state.packs[tier] || 0) < count) throw new G.GameError(`You only have ${state.packs[tier] || 0} of those packs.`);
      return withFirst(Array.from({ length: count }, () => G.openPack(state, tier, rng)));
    }

    // Buy and open 1–9 packs at once. Checks the full price first, so a batch is all or nothing.
    case 'buyOpen': {
      const tier = tierOf(action), count = countOf(action);
      const total = TIER[tier].cost * count;
      if (state.coins < total) throw new G.GameError(`You need ${total} $CROP for ${count} ${TIER[tier].label} pack${count === 1 ? '' : 's'}.`);
      const results = [];
      for (let i = 0; i < count; i++) {
        G.buyPack(state, tier);
        results.push(G.openPack(state, tier, rng));
      }
      return withFirst(results);
    }

    case 'plant':
      if (!CROP[action.cropId]) throw new G.GameError('Unknown seed.');
      return G.plant(state, plot, action.cropId, now, speed);

    // Plant the given seed in the first empty open plot.
    case 'plantFirst': {
      if (!CROP[action.cropId]) throw new G.GameError('Unknown seed.');
      const i = firstEmptyPlot(state);
      if (i < 0) throw new G.GameError('Every open plot is planted.');
      return { ...G.plant(state, i, action.cropId, now, speed), plot: i };
    }

    // Fill empty plots with the best seeds first.
    case 'plantAll': {
      let n = 0;
      for (const cropId of seedsBestFirst(state)) {
        while (state.seeds[cropId]) {
          const i = firstEmptyPlot(state);
          if (i < 0) return { n };
          G.plant(state, i, cropId, now, speed);
          n++;
        }
      }
      return { n };
    }

    case 'harvest':
      return G.harvest(state, plot, now, rng);

    // Harvest every ready crop on every farm (each at its own farm's level), then return to
    // the farm the player was on.
    case 'harvestAll': {
      let n = 0, coins = 0, gems = 0, farms = 0;
      const home = state.activeFarm;
      for (let f = 0; f < state.farms.length; f++) {
        G.switchFarm(state, f);
        let here = 0;
        state.plots.forEach((p, i) => {
          if (p && G.plotProgress(p, now).ready) {
            const r = G.harvest(state, i, now, rng);
            n++; here++; coins += r.coins; gems += r.gems;
          }
        });
        if (here) farms++;
      }
      G.switchFarm(state, home);
      return { n, coins: G.round2(coins), gems, farms };
    }

    case 'finishNow':
      return G.finishNow(state, plot, now);

    case 'useElixir':
      return G.useElixir(state, plot, now);

    case 'useItem':
      return G.useItem(state, plot, String(action.item || ''), now);

    case 'craft':
      return G.craft(state, String(action.recipe || ''), Number(action.option), rng);

    case 'levelUp':
      return G.levelUp(state);

    case 'claimChest':
      return G.claimChest(state, now, rng);

    case 'rename': {
      const name = cleanName(action.name);
      if (!name) throw new G.GameError('Pick a name with at least one letter.');
      state.name = name;
      return { name };
    }

    case 'openFarm':
      return G.openFarm(state);

    case 'switchFarm':
      return G.switchFarm(state, Number(action.index));

    case 'seenIntro':
      state.seenIntro = true;
      return {};

    default:
      throw new G.GameError('Unknown action.');
  }
}

export function firstEmptyPlot(state) {
  const open = G.plotCount(state.level);
  for (let i = 0; i < open; i++) if (!state.plots[i]) return i;
  return -1;
}

const TIER_ORDER = ['feeble', 'pico', 'basic', 'premium'];
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

export function seedsBestFirst(state) {
  return Object.keys(state.seeds).sort((a, b) =>
    TIER_ORDER.indexOf(CROP[b].tier) - TIER_ORDER.indexOf(CROP[a].tier) ||
    RARITY_ORDER.indexOf(CROP[b].rarity) - RARITY_ORDER.indexOf(CROP[a].rarity));
}

// Older pages expect a single pull's cropId/rarity at the top level, so keep those too.
function withFirst(results) {
  return { ...results[0], results };
}

function countOf(action) {
  const n = action.count === undefined ? 1 : Number(action.count);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH) throw new G.GameError(`You can buy 1 to ${MAX_BATCH} packs at a time.`);
  return n;
}

function tierOf(action) {
  if (!TIER_ORDER.includes(action.tier)) throw new G.GameError('Unknown pack.');
  return action.tier;
}

