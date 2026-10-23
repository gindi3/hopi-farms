// Hopi Farms UI: renders the screens and wires clicks to the rules in game.js.

import * as G from './game.js';
import {
  GAME_NAME, RARITIES, RARITY, TIERS, TIER, CROP, CROPS, ITEMS, HARVEST_GEMS,
  MAX_LEVEL, MAX_PLOTS, LEVEL_COSTS, ELIXIR_HOURS,
} from './data.js';
import { spriteImg, uiSlice } from './sprites.js';
import {
  SCENE_W, SCENE_H, PLOT_POS, PLOT_SIZE, FARMER_POS, FARMER_SIGN_POS, ZONES, drawFarm, drawValley,
} from './scene.js';

const SAVE_KEY = 'hopi-farms-save';
const params = new URLSearchParams(location.search);
const SPEED = Math.max(1, Number(params.get('speed')) || 1);
const STAGE_NAMES = ['Seeded', 'Sprouting', 'Growing', 'Flowering', 'Ready'];

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const modal = $('#modal');
const modalPanel = $('#modal-panel');
const tooltip = $('#tooltip');

let state = load() || G.newGame();
let tab = 'valley';
let hoverPlot = null;
let livePlot = null; // plot index shown in the crop panel, refreshed each tick

// --- Persistence -------------------------------------------------------------

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? G.deserialize(raw) : null;
  } catch {
    return null;
  }
}

function save() {
  try { localStorage.setItem(SAVE_KEY, G.serialize(state)); } catch { /* storage unavailable */ }
}

// Run a game action; show GameErrors as toasts, save and refresh on success.
function act(fn) {
  try {
    const result = fn();
    save();
    renderHeader();
    return result;
  } catch (e) {
    if (e instanceof G.GameError) { toast(e.message, true); return null; }
    throw e;
  }
}

// --- Formatting --------------------------------------------------------------

const fmt = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const pct = (r) => `${(r * 100).toFixed(2)}%`;
const coin = (n, size = 18) => `<span class="amt">${spriteImg('coin', size)}<b>${fmt(n)}</b></span>`;
const gem = (n, size = 18) => `<span class="amt">${spriteImg('gem', size)}<b>${fmt(n)}</b></span>`;
const rar = (r) => `<span class="rar ${r}">${RARITY[r].label}</span>`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sp = (n) => `${(n / SCENE_W) * 100}%`;
const spY = (n) => `${(n / SCENE_H) * 100}%`;

function fmtTime(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

function msToMidnight() {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.getTime() - Date.now();
}

// --- Header ------------------------------------------------------------------

function renderHeader() {
  $('#farm-name').textContent = state.name;
  $('#coins').textContent = fmt(state.coins);
  $('#gems').textContent = fmt(state.gems);
  $('#level').textContent = state.level;
  $('#rtp').textContent = `RTP ${pct(G.rtp(state.level))}`;
  $('#xp').textContent = fmt(state.xp);
  const ready = readyCount();
  const badge = $('[data-tab="farm"] .badge');
  badge.textContent = ready || '';
  badge.hidden = !ready;
}

function readyCount(now = Date.now()) {
  return state.plots.filter(p => p && G.plotProgress(p, now).ready).length;
}

// --- Scenes ------------------------------------------------------------------

const sceneCache = {};
function sceneCanvas(name, draw) {
  if (!sceneCache[name]) {
    const cv = document.createElement('canvas');
    draw(cv);
    sceneCache[name] = cv.toDataURL();
  }
  return `<img class="px scene-bg" src="${sceneCache[name]}" alt="" draggable="false">`;
}

function renderValley() {
  view.innerHTML = `
    <div class="scene-scroll"><div class="scene">
      ${sceneCanvas('valley', drawValley)}
      ${ZONES.map(z => `
        <button class="zone" data-tab-go="${z.id === 'market' ? 'market' : z.id}" aria-label="${z.label}"
          style="left:${sp(z.x)};top:${spY(z.y)};width:${sp(z.w)};height:${spY(z.h)}"></button>
        <button class="sign zone-sign" data-tab-go="${z.id === 'market' ? 'market' : z.id}"
          style="left:${sp(z.sign.x)};top:${spY(z.sign.y)}">${z.label}</button>`).join('')}
    </div></div>
    <p class="hint">Welcome to your valley. Click a place to visit it.</p>`;
}

// --- Farm --------------------------------------------------------------------

function plotState(i, now) {
  if (i >= G.plotCount(state.level)) return { kind: 'locked' };
  const plot = state.plots[i];
  if (!plot) return { kind: 'empty' };
  const prog = G.plotProgress(plot, now);
  return { kind: prog.ready ? 'ready' : 'growing', plot, prog };
}

function plotHTML(i, now) {
  const s = plotState(i, now);
  const { x, y } = PLOT_POS[i];
  const pos = `style="left:${sp(x - PLOT_SIZE / 2)};top:${spY(y - PLOT_SIZE / 2)};width:${sp(PLOT_SIZE)};height:${spY(PLOT_SIZE)}"`;
  let sig, inner, cls, label;
  if (s.kind === 'locked') {
    sig = 'locked'; cls = 'locked'; label = `Locked plot, level ${G.levelUnlockingPlot(i)}`;
    inner = spriteImg('plot_lock', 48);
  } else if (s.kind === 'empty') {
    sig = 'empty'; cls = 'empty'; label = 'Empty plot';
    inner = spriteImg('plot_sign', 48);
  } else {
    const crop = CROP[s.plot.cropId];
    const gemDot = HARVEST_GEMS[crop.rarity] ? `<span class="gemdot ${crop.rarity}"></span>` : '';
    if (s.kind === 'ready') {
      sig = `ready:${crop.id}`; cls = 'ready'; label = `${crop.name}, ready`;
      inner = `${spriteImg(`crop:${crop.id}`, 48)}${gemDot}`;
    } else {
      const w = Math.floor(s.prog.ratio * 100);
      sig = `grow:${crop.id}:${s.prog.stage}:${w}`; cls = 'growing'; label = `${crop.name}, growing`;
      inner = `${spriteImg(`stage:${s.prog.stage}`, 48)}${gemDot}<span class="bar"><i style="width:${w}%"></i></span>`;
    }
  }
  return `<button class="plot ${cls}" data-plot="${i}" data-sig="${sig}" aria-label="${label}" ${pos}>${inner}</button>`;
}

function renderFarm() {
  const now = Date.now();
  let plots = '';
  for (let i = 0; i < MAX_PLOTS; i++) plots += plotHTML(i, now);
  view.innerHTML = `
    <div class="scene-scroll"><div class="scene">
      ${sceneCanvas('farm', drawFarm)}
      ${plots}
      <div class="sign farmer-sign" style="left:${sp(FARMER_SIGN_POS.x)};top:${spY(FARMER_SIGN_POS.y)}">FARMER</div>
      <div class="farmer" style="left:${sp(FARMER_POS.x - 10)};top:${spY(FARMER_POS.y - 10)};width:${sp(20)}">${spriteImg('farmer', 64, '', 'The farmer')}</div>
    </div></div>
    <div class="farm-actions">
      <button class="btn orange" data-action="harvest-all">Harvest all</button>
      <button class="btn cream" data-action="plant-all">Plant all (<span id="seed-count">${seedTotal()}</span>)</button>
      <span class="hint">Click a sign to plant. Click a growing crop for details.</span>
    </div>`;
}

function seedTotal() {
  return Object.values(state.seeds).reduce((a, b) => a + b, 0);
}

function updatePlots() {
  const now = Date.now();
  view.querySelectorAll('.plot[data-plot]').forEach(el => {
    const i = Number(el.dataset.plot);
    const html = plotHTML(i, now);
    const sig = html.match(/data-sig="([^"]+)"/)[1];
    if (el.dataset.sig === sig) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    el.replaceWith(tpl.content.firstElementChild);
  });
  const count = $('#seed-count');
  if (count) count.textContent = seedTotal();
}

function plotTooltip(i) {
  const s = plotState(i, Date.now());
  if (s.kind === 'locked') return `<b>Locked plot</b><div class="line">Unlocks at valley level ${G.levelUnlockingPlot(i)}</div>`;
  if (s.kind === 'empty') return `<b>Empty plot</b><div class="line">Click to plant a seed</div>`;
  const crop = CROP[s.plot.cropId];
  return `
    <b>${crop.name}</b> ${rar(crop.rarity)}
    <div class="line">${s.prog.ready ? 'Ready to harvest!' : `${STAGE_NAMES[s.prog.stage]} · ${fmtTime(s.prog.msLeft)} left`}</div>
    <div class="line">${coin(G.cropPayout(crop.id, state.level), 14)}${gemsFor(crop) ? gem(gemsFor(crop), 14) : ''}</div>`;
}

const gemsFor = (crop) => HARVEST_GEMS[crop.rarity]?.[crop.tier] || 0;

function clickPlot(i, el) {
  const s = plotState(i, Date.now());
  if (s.kind === 'locked') return toast(`This plot unlocks at level ${G.levelUnlockingPlot(i)}.`);
  if (s.kind === 'empty') return openSeedPicker(i);
  if (s.kind === 'ready') return doHarvest(i, el);
  openCropPanel(i);
}

function doHarvest(i, el) {
  const res = act(() => G.harvest(state, i, Date.now()));
  if (!res) return;
  const rect = el.getBoundingClientRect();
  floatText(`+${fmt(res.coins)} coins`, rect.left + rect.width / 2, rect.top);
  if (res.gems) floatText(`+${res.gems} gems${res.firstTime ? ' (first!)' : ''}`, rect.left + rect.width / 2, rect.top + 20);
  updatePlots();
}

function harvestAll() {
  const now = Date.now();
  let coins = 0, gems = 0, n = 0;
  act(() => {
    state.plots.forEach((p, i) => {
      if (p && G.plotProgress(p, now).ready) {
        const r = G.harvest(state, i, now);
        coins += r.coins; gems += r.gems; n++;
      }
    });
  });
  if (!n) return toast('Nothing is ready yet.');
  toast(`Harvested ${plural(n, 'crop')}: +${fmt(G.round2(coins))} coins${gems ? `, +${gems} gems` : ''}`);
  updatePlots();
}

function firstEmptyPlot() {
  const open = G.plotCount(state.level);
  for (let i = 0; i < open; i++) if (!state.plots[i]) return i;
  return -1;
}

// Seeds sorted best-first: Premium before Feeble, Legendary before Common.
function seedList() {
  return Object.entries(state.seeds)
    .map(([id, n]) => ({ crop: CROP[id], n }))
    .sort((a, b) => TIERS.indexOf(b.crop.tier) - TIERS.indexOf(a.crop.tier) ||
      RARITIES.indexOf(b.crop.rarity) - RARITIES.indexOf(a.crop.rarity));
}

function plantAll() {
  const now = Date.now();
  let n = 0;
  act(() => {
    for (const { crop } of seedList()) {
      while (state.seeds[crop.id]) {
        const i = firstEmptyPlot();
        if (i < 0) return;
        G.plant(state, i, crop.id, now, SPEED);
        n++;
      }
    }
  });
  if (!n) toast(firstEmptyPlot() < 0 ? 'Every open plot is planted.' : 'You have no seeds. Buy a pack at the Market.');
  else { toast(`Planted ${plural(n, 'seed')}.`); closeModal(); }
  if (tab === 'farm') updatePlots(); else setTab('farm');
}

function seedButton(crop, n, action, extra = '') {
  const r = RARITY[crop.rarity];
  return `
    <button class="item slot" data-action="${action}" data-crop="${crop.id}" ${extra}>
      ${spriteImg(`crop:${crop.id}`, 32)}
      <span class="meta"><b>${crop.name}</b><span>${TIER[crop.tier].label} · ${r.label} · ${r.hours}h · ${fmt(G.cropPayout(crop.id, state.level))} coins</span></span>
      <span class="qty">×${n}</span>
    </button>`;
}

function openSeedPicker(i) {
  const seeds = seedList();
  const packs = TIERS.filter(t => state.packs[t]);
  openModal(`
    <h3>Plant a seed</h3>
    ${seeds.length
      ? `<div class="list">${seeds.map(({ crop, n }) => seedButton(crop, n, 'plant', `data-plot="${i}"`)).join('')}</div>`
      : `<p class="empty-note">You have no seeds.${packs.length ? ' Open a pack from your backpack first.' : ' Buy a seed pack at the Market.'}</p>
         <div class="actions"><button class="btn orange" data-action="goto" data-tab="${packs.length ? 'backpack' : 'market'}">${packs.length ? 'Open packs' : 'Go to Market'}</button></div>`}
  `);
}

// The crop panel: portrait, rarity, 5-step growth bar, time left, reward and effects.
function openCropPanel(i) {
  livePlot = i;
  openModal(`<div id="crop-panel"></div>`, 'crop');
  renderCropPanel();
}

function renderCropPanel() {
  const box = $('#crop-panel');
  if (!box || livePlot === null) return;
  const i = livePlot;
  const s = plotState(i, Date.now());
  if (s.kind !== 'growing') {
    closeModal();
    updatePlots();
    return;
  }
  const crop = CROP[s.plot.cropId];
  const cost = G.finishNowCost(s.plot, Date.now());
  const gems = gemsFor(crop);
  const filled = s.prog.stage + 1;
  const effects = s.plot.effects || [];
  box.innerHTML = `
    <div class="cp-head">
      <div class="portrait ${crop.rarity}">${spriteImg(`crop:${crop.id}`, 64)}</div>
      <div>
        <div class="cp-name">${crop.name}</div>
        <div class="cp-rar ${crop.rarity}">${RARITY[crop.rarity].label} Crop</div>
        <div class="cp-tier">${TIER[crop.tier].label} seed</div>
      </div>
    </div>
    <hr>
    <div class="cp-row"><span>Growth Stage</span><span class="cp-stage">${STAGE_NAMES[s.prog.stage]}</span></div>
    <div class="segbar">${[0, 1, 2, 3, 4].map(k => `<i class="${k < filled ? 'on' : ''}"></i>`).join('')}</div>
    <hr>
    <div class="cp-row"><span>Time Left:</span><b>${fmtTime(s.prog.msLeft)}</b></div>
    <div class="cp-row"><span>Total Harvest</span><b>${fmt(G.cropPayout(crop.id, state.level))} coins</b></div>
    ${gems ? `<div class="cp-row small gemline"><span>Gem bonus</span><b>+${gems} gems</b></div>` : ''}
    <div class="cp-row small"><span>Valley bonus</span><b>RTP ${pct(G.rtp(state.level))}</b></div>
    <hr>
    <div class="cp-effect">${effects.length ? effects.map(e => ITEMS[e]?.name || e).join(', ') + ' applied' : 'No Active Effect'}</div>
    <div class="actions">
      <button class="btn gem" data-action="finish" data-plot="${i}" ${state.gems < cost ? 'disabled' : ''}>Finish now ${spriteImg('gem', 16)} ${cost}</button>
      ${state.items.elixir ? `<button class="btn cream" data-action="elixir" data-plot="${i}">${spriteImg('elixir', 16)} Elixir −${ELIXIR_HOURS}h (${state.items.elixir})</button>` : ''}
    </div>`;
}

// --- Market ------------------------------------------------------------------

function renderMarket() {
  const level = state.level;
  const scale = G.rtp(level) / 0.9556;
  view.innerHTML = `
    <h2 class="section-title">Seed Vendor</h2>
    <div class="cards">
      ${TIERS.map(t => {
        const cost = TIER[t].cost;
        const owned = state.packs[t] || 0;
        return `
          <div class="card">
            <div class="row">${spriteImg(`pack_${t}`, 56)}<div><h4>${TIER[t].label} Seeds</h4><div class="muted">Crops pay ${fmt(G.round2(cost * 0.5 * scale))}–${fmt(G.round2(cost * 5.4 * scale))}</div></div></div>
            <div class="row">${coin(cost)} <span class="muted">per pack</span></div>
            <div class="actions">
              <button class="btn orange" data-action="buy-open" data-tier="${t}" ${state.coins < cost ? 'disabled' : ''}>Buy &amp; spin</button>
              ${owned ? `<button class="btn cream" data-action="open" data-tier="${t}">Spin (${owned})</button>` : ''}
            </div>
          </div>`;
      }).join('')}
      <div class="card wide">
        <h4>Drop odds</h4>
        <div class="muted">Every pack uses the same odds. Your RTP at level ${level} is <b>${pct(G.rtp(level))}</b> (max 99.00% at level ${MAX_LEVEL}).</div>
        <table class="odds">
          <thead><tr><th>Rarity</th><th class="num">Chance</th><th class="num">Grow</th><th class="num">Return</th><th>Crops</th></tr></thead>
          <tbody>
            ${RARITIES.map(r => `
              <tr>
                <td>${rar(r)}</td>
                <td class="num">${(RARITY[r].chance * 100).toFixed(2)}%</td>
                <td class="num">${RARITY[r].hours}h</td>
                <td class="num">${(RARITY[r].mult * scale).toFixed(3)}×</td>
                <td><div class="row tight">${CROPS.filter(c => c.rarity === r).map(c => `<span title="${c.name}">${spriteImg(`crop:${c.id}`, 22)}</span>`).join('')}</div></td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="muted">Epic and Legendary harvests also pay gems. So does the first harvest of each crop.</div>
      </div>
    </div>`;
}

// --- Gacha reel --------------------------------------------------------------

const CELL = 76;           // reel cell width incl. gap, px
const REEL_LEN = 46;
const WIN_INDEX = 40;
const SPIN_MS = 4200;
let spin = null;           // { tier, res, timer }

function fakeRoll(tier) {
  const rarity = G.rollRarity();
  const pool = CROPS.filter(c => c.tier === tier && c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

function revealPack(tier, buyFirst) {
  const res = act(() => {
    if (buyFirst) G.buyPack(state, tier);
    return G.openPack(state, tier);
  });
  if (!res) return;
  const winner = CROP[res.cropId];
  const cells = Array.from({ length: REEL_LEN }, (_, k) => (k === WIN_INDEX ? winner : fakeRoll(tier)));
  // Tease: put a Legendary or Epic right next to the winner when it isn't one.
  if (RARITIES.indexOf(res.rarity) < 3) {
    const tease = CROPS.find(c => c.tier === tier && c.rarity === (Math.random() < 0.3 ? 'legendary' : 'epic'));
    cells[WIN_INDEX + (Math.random() < 0.5 ? 1 : -1)] = tease;
  }
  openModal(`
    <div class="gacha">
      <h3>${TIER[tier].label} Seed Pack</h3>
      <div class="reel-window" id="reel-window">
        <div class="reel" id="reel">${cells.map((c, k) => `
          <div class="cell ${c.rarity}" data-k="${k}">${spriteImg(`crop:${c.id}`, 48)}</div>`).join('')}
        </div>
        <div class="reel-marker"></div>
      </div>
      <div id="gacha-result" class="gacha-result"><button class="btn cream small" data-action="skip-spin">Skip</button></div>
    </div>`, 'wide');
  spin = { tier, res };
  const win = $('#reel-window');
  const reel = $('#reel');
  const jitter = (Math.random() - 0.5) * (CELL * 0.6);
  const target = WIN_INDEX * CELL + CELL / 2 - win.clientWidth / 2 + jitter;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    reel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.08,.72,.16,1)`;
    reel.style.transform = `translateX(${-target}px)`;
  }));
  spin.timer = setTimeout(finishSpin, SPIN_MS + 80);
}

function finishSpin() {
  if (!spin) return;
  clearTimeout(spin.timer);
  const { tier, res } = spin;
  spin = null;
  const reel = $('#reel');
  if (!reel) return;
  const win = $('#reel-window');
  reel.style.transition = 'none';
  reel.style.transform = `translateX(${-(WIN_INDEX * CELL + CELL / 2 - win.clientWidth / 2)}px)`;
  reel.querySelector(`[data-k="${WIN_INDEX}"]`).classList.add('win');
  const crop = CROP[res.cropId];
  const gems = gemsFor(crop);
  const again = state.packs[tier]
    ? `<button class="btn cream" data-action="open" data-tier="${tier}">Spin next (${state.packs[tier]})</button>`
    : `<button class="btn cream" data-action="buy-open" data-tier="${tier}" ${state.coins < TIER[tier].cost ? 'disabled' : ''}>Spin again · ${fmt(TIER[tier].cost)}</button>`;
  $('#gacha-result').innerHTML = `
    <div class="won ${res.rarity}">
      <div class="won-name">${crop.name}</div>
      <div>${rar(res.rarity)}</div>
      <div class="stats">
        <span>Pays ${coin(G.cropPayout(crop.id, state.level), 16)}${gems ? ` + ${gem(gems, 16)}` : ''}</span>
        <span>Grows in ${RARITY[res.rarity].hours}h</span>
      </div>
      <div class="actions">
        <button class="btn orange" data-action="plant-first" data-crop="${crop.id}">Plant now</button>
        ${again}
        <button class="btn cream" data-action="close">Close</button>
      </div>
    </div>`;
}

// --- House -------------------------------------------------------------------

function renderHouse() {
  const lv = state.level;
  const cost = G.nextLevelCost(lv);
  const chest = G.chestFor(lv);
  const canChest = G.canClaimChest(state, Date.now());
  let total = 0;
  const rows = LEVEL_COSTS.map((c, idx) => {
    const L = idx + 1;
    total += c;
    const unlocks = [];
    if (L % 2 === 0 && L <= 30) unlocks.push('+1 plot');
    if (L === 10) unlocks.push('Bronze chest');
    if (L === 20) unlocks.push('Silver chest');
    if (L === 30) unlocks.push('Gold chest');
    if (L === MAX_LEVEL) unlocks.push('RTP cap');
    const cls = L <= lv ? 'done' : L === lv + 1 ? 'current' : '';
    return `<tr class="${cls}"><td>${L}</td><td class="num">${fmt(c)}</td><td class="num">${fmt(total)}</td><td class="num">${pct(G.rtp(L))}</td><td class="num">${G.plotCount(L)}</td><td>${unlocks.join(', ') || '—'}</td></tr>`;
  }).join('');
  const s = state.stats;
  view.innerHTML = `
    <h2 class="section-title">House</h2>
    <div class="cards">
      <div class="card">
        <div class="row">${spriteImg('farmer', 56)}<div><h4>Gardener</h4><div class="muted">Bribe the Gardener to grow your valley.</div></div></div>
        ${cost === null ? `<p><b>Your valley is at max level (${MAX_LEVEL}).</b></p>` : `
          <table class="odds">
            <tr><th></th><th class="num">Now</th><th class="num">Next</th></tr>
            <tr><td>Level</td><td class="num">${lv}</td><td class="num">${lv + 1}</td></tr>
            <tr><td>RTP</td><td class="num">${pct(G.rtp(lv))}</td><td class="num">${pct(G.rtp(lv + 1))}</td></tr>
            <tr><td>Plots</td><td class="num">${G.plotCount(lv)}</td><td class="num">${G.plotCount(lv + 1)}</td></tr>
          </table>
          <div class="segbar long"><i class="on" style="flex:${Math.min(1, state.coins / cost)}"></i><i style="flex:${Math.max(0, 1 - state.coins / cost)}"></i></div>
          <div class="muted">Level-up reward: ${gem(10 * (lv + 1), 14)}</div>
          <div class="actions"><button class="btn orange" data-action="level-up" ${state.coins < cost ? 'disabled' : ''}>Level up ${spriteImg('coin', 16)} ${fmt(cost)}</button></div>`}
      </div>
      <div class="card">
        <div class="row">${spriteImg(`chest_${chest.id}`, 56)}<div><h4>${chest.label} Chest</h4><div class="muted">One free chest per day</div></div></div>
        <div class="muted">Contains ${chest.gems[0]}–${chest.gems[1]} gems, plus one roll for produce, a seed pack or a potion.</div>
        <div class="actions">${canChest
          ? `<button class="btn orange" data-action="chest">Open chest</button>`
          : `<button class="btn cream" disabled>Next chest in <span id="chest-timer">${fmtTime(msToMidnight())}</span></button>`}</div>
      </div>
      <div class="card">
        <h4>Farm stats</h4>
        <table class="odds">
          <tr><td>Packs opened</td><td class="num">${fmt(s.packsOpened)}</td></tr>
          <tr><td>Harvests</td><td class="num">${fmt(s.harvests)}</td></tr>
          <tr><td>Coins spent</td><td class="num">${fmt(s.coinsSpent)}</td></tr>
          <tr><td>Coins earned</td><td class="num">${fmt(s.coinsEarned)}</td></tr>
        </table>
      </div>
      <div class="card wide">
        <h4>Valley levels</h4>
        <div class="levels">
          <table class="odds">
            <thead><tr><th>Lv</th><th class="num">Cost</th><th class="num">Total</th><th class="num">RTP</th><th class="num">Plots</th><th>Unlocks</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

function openChest() {
  const res = act(() => G.claimChest(state, Date.now()));
  if (!res) return;
  let prize;
  if (res.drop === 'produce') prize = `${spriteImg(`crop:${res.cropId}`, 32)} 1 ${CROP[res.cropId].name} (produce)`;
  else if (res.tier) prize = `${spriteImg(`pack_${res.tier}`, 32)} A ${TIER[res.tier].label} seed pack!`;
  else prize = `${spriteImg(res.item, 32)} ${ITEMS[res.item].name}`;
  openModal(`
    <div class="reveal">
      <div class="stage pop">${spriteImg(`chest_${res.chest}`, 128)}</div>
      <h4>Chest opened!</h4>
      <div class="stats">${gem(res.gems)}</div>
      <div class="row">${prize}</div>
      <div class="actions">
        ${res.tier ? `<button class="btn orange" data-action="open" data-tier="${res.tier}">Spin pack</button>` : ''}
        <button class="btn cream" data-action="close">Close</button>
      </div>
    </div>`);
  if (tab === 'house') renderHouse();
}

// --- Backpack ----------------------------------------------------------------

function renderBackpack() {
  const packs = TIERS.filter(t => state.packs[t]);
  const seeds = seedList();
  const produce = Object.entries(state.produce).sort((a, b) => b[1] - a[1]);
  const items = Object.entries(state.items);
  view.innerHTML = `
    <h2 class="section-title">Backpack</h2>
    <div class="cards">
      <div class="card wide">
        <h4>Seed packs</h4>
        ${packs.length ? `<div class="list">${packs.map(t => `
          <button class="item slot" data-action="open" data-tier="${t}">
            ${spriteImg(`pack_${t}`, 32)}<span class="meta"><b>${TIER[t].label} pack</b><span>Click to spin</span></span><span class="qty">×${state.packs[t]}</span>
          </button>`).join('')}</div>` : '<p class="empty-note">No unopened packs.</p>'}
      </div>
      <div class="card wide">
        <h4>Seeds</h4>
        ${seeds.length ? `<div class="list">${seeds.map(({ crop, n }) => seedButton(crop, n, 'plant-first')).join('')}</div>
          <div class="muted">Click a seed to plant it in the first empty plot.</div>` : '<p class="empty-note">No seeds. Buy packs at the Market.</p>'}
      </div>
      <div class="card wide">
        <h4>Produce</h4>
        ${produce.length ? `<div class="list">${produce.map(([id, n]) => `
          <div class="item slot">${spriteImg(`crop:${id}`, 32)}<span class="meta"><b>${CROP[id].name}</b><span>${TIER[CROP[id].tier].label} · ${RARITY[CROP[id].rarity].label}</span></span><span class="qty">×${n}</span></div>`).join('')}</div>
          <div class="muted">Produce will be used by the Potions Master (coming soon).</div>` : '<p class="empty-note">Harvest crops to collect produce.</p>'}
      </div>
      <div class="card wide">
        <h4>Items</h4>
        ${items.length ? `<div class="list">${items.map(([id, n]) => `
          <div class="item slot">${spriteImg(id, 32)}<span class="meta"><b>${ITEMS[id].name}</b><span>${ITEMS[id].desc}</span></span><span class="qty">×${n}</span></div>`).join('')}</div>` : '<p class="empty-note">Daily chests can drop potions.</p>'}
      </div>
      <div class="card wide">
        <div class="actions left"><button class="btn cream" data-action="reset">Reset farm</button></div>
      </div>
    </div>`;
}

// --- Modal, toasts, floating text -------------------------------------------

function openModal(html, variant = '') {
  if (spin) { clearTimeout(spin.timer); spin = null; }
  modalPanel.className = `panel ${variant}`;
  modalPanel.innerHTML = `<button class="close" data-action="close" aria-label="Close">×</button>${html}`;
  modal.hidden = false;
}

function closeModal() {
  if (spin) finishSpin();
  modal.hidden = true;
  modalPanel.innerHTML = '';
  livePlot = null;
}

function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function floatText(text, x, y) {
  const el = document.createElement('div');
  el.className = 'float';
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// --- Routing and events ------------------------------------------------------

const RENDER = { valley: renderValley, farm: renderFarm, market: renderMarket, house: renderHouse, backpack: renderBackpack };

function setTab(name) {
  tab = name;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  hideTooltip();
  RENDER[name]();
}

function refresh() {
  renderHeader();
  if (tab === 'farm') updatePlots(); else RENDER[tab]();
}

function plantFirst(cropId) {
  const i = firstEmptyPlot();
  if (i < 0) return toast('Every open plot is planted.', true);
  if (act(() => G.plant(state, i, cropId, Date.now(), SPEED))) {
    toast(`Planted ${CROP[cropId].name}.`);
    closeModal();
    refresh();
  }
}

let pressTarget = null;
document.addEventListener('pointerdown', (e) => { pressTarget = e.target; });

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tabs button, [data-tab-go]');
  if (tabBtn) return setTab(tabBtn.dataset.tab || tabBtn.dataset.tabGo);

  // Close on backdrop only when the press also started there, so the click that opened
  // the modal can't land on the new backdrop and close it.
  if (e.target === modal) {
    if (pressTarget === modal) closeModal();
    return;
  }

  const el = e.target.closest('[data-action], [data-plot]');
  if (!el) return;
  const { action, plot, tier, crop } = el.dataset;

  if (!action && plot !== undefined) return clickPlot(Number(plot), el);

  switch (action) {
    case 'close': return closeModal();
    case 'goto': closeModal(); return setTab(el.dataset.tab);
    case 'rename': {
      const name = prompt('Name your farm', state.name);
      if (name && name.trim()) { state.name = name.trim().slice(0, 18); save(); renderHeader(); }
      return;
    }
    case 'plant':
      if (act(() => G.plant(state, Number(plot), crop, Date.now(), SPEED))) { closeModal(); refresh(); }
      return;
    case 'plant-first': return plantFirst(crop);
    case 'plant-all': return plantAll();
    case 'harvest-all': return harvestAll();
    case 'finish':
      if (act(() => G.finishNow(state, Number(plot), Date.now()))) { toast('Crop finished!'); closeModal(); refresh(); }
      return;
    case 'elixir':
      if (act(() => {
        G.useElixir(state, Number(plot), Date.now());
        const p = state.plots[Number(plot)];
        p.effects = [...(p.effects || []), 'elixir'];
      }) !== null) { toast(`Growth Elixir used: −${ELIXIR_HOURS}h.`); renderCropPanel(); refresh(); }
      return;
    case 'buy-open': revealPack(tier, true); return refresh();
    case 'open': revealPack(tier, false); return refresh();
    case 'skip-spin': return finishSpin();
    case 'level-up': {
      const r = act(() => G.levelUp(state));
      if (r) { toast(`Valley level ${r.level}! +${r.gems} gems`); refresh(); }
      return;
    }
    case 'chest': return openChest();
    case 'reset':
      if (confirm('Reset your farm? This deletes all progress.')) {
        state = G.newGame(state.name);
        save();
        setTab('valley');
        renderHeader();
        showIntro();
      }
      return;
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

view.addEventListener('mouseover', (e) => {
  const el = e.target.closest('.plot[data-plot]');
  if (!el) return;
  hoverPlot = Number(el.dataset.plot);
  tooltip.innerHTML = plotTooltip(hoverPlot);
  tooltip.hidden = false;
});
view.addEventListener('mouseout', (e) => {
  const to = e.relatedTarget && e.relatedTarget.closest?.('.plot[data-plot]');
  if (!to) hideTooltip();
});
view.addEventListener('mousemove', (e) => {
  if (tooltip.hidden) return;
  const pad = 14;
  const w = tooltip.offsetWidth, h = tooltip.offsetHeight;
  tooltip.style.left = `${Math.min(e.clientX + pad, innerWidth - w - 8)}px`;
  tooltip.style.top = `${Math.min(e.clientY + pad, innerHeight - h - 8)}px`;
});

function hideTooltip() {
  hoverPlot = null;
  tooltip.hidden = true;
}

function tick() {
  if (tab === 'farm') {
    updatePlots();
    if (hoverPlot !== null) tooltip.innerHTML = plotTooltip(hoverPlot);
  }
  if (livePlot !== null) renderCropPanel();
  const timer = $('#chest-timer');
  if (timer) {
    if (G.canClaimChest(state, Date.now())) renderHouse();
    else timer.textContent = fmtTime(msToMidnight());
  }
  renderHeader();
}

function showIntro() {
  if (state.seenIntro) return;
  state.seenIntro = true;
  save();
  openModal(`
    <h3>Welcome to ${GAME_NAME}!</h3>
    <div class="reveal">
      ${spriteImg('farmer', 96)}
      <p>Here are ${fmt(state.coins)} coins and a few Feeble seeds to get started.</p>
      <p class="muted">Plant seeds, wait for them to grow, and harvest them for coins. Spin seed packs at the Market. Rarer crops pay more and some pay gems. Level up your valley in the House for more plots and better returns.</p>
      <div class="actions"><button class="btn orange" data-action="plant-all">Plant my seeds</button></div>
    </div>`);
}

// --- Boot --------------------------------------------------------------------

const root = document.documentElement.style;
for (const kind of ['panel', 'slot', 'wood', 'blue', 'orange', 'cream', 'gem', 'pill', 'sign']) {
  root.setProperty(`--ui-${kind}`, `url(${uiSlice(kind)})`);
}
$('#avatar').innerHTML = spriteImg('farmer', 40);
$('#ico-coin').innerHTML = spriteImg('coin', 24);
$('#ico-gem').innerHTML = spriteImg('gem', 24);
$('#ico-xp').innerHTML = spriteImg('xp', 24);
document.querySelectorAll('.tabs [data-icon]').forEach(b => { b.insertAdjacentHTML('afterbegin', spriteImg(b.dataset.icon, 28)); });
if (SPEED > 1) {
  const dev = $('#dev');
  dev.hidden = false;
  dev.textContent = `Dev speed ×${SPEED}`;
}
document.title = GAME_NAME;
renderHeader();
setTab('valley');
showIntro();
setInterval(tick, 1000);
