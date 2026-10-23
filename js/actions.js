// Every change to a farm goes through applyAction, both in the browser (local mode) and on
// the server (online mode). Actions are plain JSON so they can be sent over the network.
// ctx: { now, rng, speed }.

import * as G from './game.js';
import { CROP } from './data.js';

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

    case 'openPack':
      return G.openPack(state, tierOf(action), rng);

    case 'buyOpen': {
      const tier = tierOf(action);
      G.buyPack(state, tier);
      return G.openPack(state, tier, rng);
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
      return G.harvest(state, plot, now);

    case 'harvestAll': {
      let n = 0, coins = 0, gems = 0;
      state.plots.forEach((p, i) => {
        if (p && G.plotProgress(p, now).ready) {
          const r = G.harvest(state, i, now);
          n++; coins += r.coins; gems += r.gems;
        }
      });
      return { n, coins: G.round2(coins), gems };
    }

    case 'finishNow':
      return G.finishNow(state, plot, now);

    case 'useElixir': {
      const r = G.useElixir(state, plot, now);
      const p = state.plots[plot];
      p.effects = [...(p.effects || []), 'elixir'];
      return r;
    }

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

    case 'seenIntro':
      state.seenIntro = true;
      return {};

    // Start the farm over, keeping the name.
    case 'reset': {
      const fresh = G.newGame(state.name);
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, fresh);
      return {};
    }

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

function tierOf(action) {
  if (!TIER_ORDER.includes(action.tier)) throw new G.GameError('Unknown pack.');
  return action.tier;
}

