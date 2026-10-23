// Hopi Farms UI: renders the screens and wires clicks to the rules in game.js.

import * as G from './game.js';
import {
  GAME_NAME, RARITIES, RARITY, TIERS, TIER, CROP, CROPS, ITEMS, HARVEST_GEMS,
  MAX_LEVEL, MAX_PLOTS, LEVEL_COSTS, ELIXIR_HOURS, ECON, CHESTS,
} from './data.js';
import { applyAction, firstEmptyPlot, seedsBestFirst, MAX_BATCH } from './actions.js';
import { applyEconomy } from './economy.js';
import { spriteImg, uiSlice } from './sprites.js';
import {
  SCENE_W, SCENE_H, PLOT_POS, PLOT_SIZE, FARMER_POS, FARMER_SIGN_POS, ZONES, drawFarm, drawValley,
} from './scene.js';

const SAVE_KEY = 'hopi-farms-save';
const TOKEN_KEY = 'hopi-farms-token';
const params = new URLSearchParams(location.search);
// ?speed=N shortens grow times for testing; it only works on a local dev server. In online
// mode the server decides grow speed instead.
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const SPEED = IS_LOCAL ? Math.max(1, Number(params.get('speed')) || 1) : 1;
const STAGE_NAMES = ['Seeded', 'Sprouting', 'Growing', 'Flowering', 'Ready'];

// Online mode: config.js points at the server, which owns the farm. Local mode: the farm
// lives in this browser's storage and the rules run here.
const API = typeof window.HOPI_API === 'string' ? window.HOPI_API.replace(/\/$/, '') : '';
const ONLINE = Boolean(API);

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const modal = $('#modal');
const modalPanel = $('#modal-panel');
const tooltip = $('#tooltip');

let state = ONLINE ? G.newGame() : (load() || G.newGame());
let user = null;       // { username, guest } in online mode
let clockOffset = 0;   // server time minus local time, so timers match the server
let tab = 'valley';
let hoverPlot = null;
let livePlot = null; // plot index shown in the crop panel, refreshed each tick

const now = () => Date.now() + clockOffset;

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

function storedToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function storeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

// --- Server --------------------------------------------------------------------

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = storedToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Can't reach the farm server. Check your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong.', res.status);
  return data;
}

// The server loads this file from /v/<build>/js/main.js. If it later reports a different
// build, a deploy happened while this tab was open: reload once to pick up the new code.
const CLIENT_BUILD = (/\/v\/([0-9a-f]+)\//.exec(import.meta.url) || [])[1] || null;
function checkBuild(build) {
  if (!CLIENT_BUILD || !build || build === CLIENT_BUILD) return;
  try {
    if (sessionStorage.getItem('hopi-reloaded-for') === build) return;   // never loop
    sessionStorage.setItem('hopi-reloaded-for', build);
  } catch { /* storage unavailable: reload anyway */ }
  location.reload();
}

// The server owns prices and odds. When a reply carries a new economy version, fetch the
// settings, apply them, and redraw so every number on screen matches the server.
let econ = null;
async function syncEconomy(version) {
  const data = await api('GET', '/economy');
  applyEconomy(data.economy);
  econ = version || data.econ;
}
function checkEconomy(version) {
  if (!version || version === econ || econ === null) return;
  econ = version;
  syncEconomy(version).then(() => { if (!spin) refresh(); }).catch(() => { econ = null; });
}

// Take the farm (and clock) from a server response.
function adopt(data) {
  checkBuild(data.build);
  checkEconomy(data.econ);
  if (data.state) state = data.state;
  if (data.user) user = data.user;
  if (typeof data.now === 'number') clockOffset = data.now - Date.now();
}

// Resume the saved session, or start a guest farm.
async function connect() {
  await syncEconomy();
  if (storedToken()) {
    try {
      adopt(await api('GET', '/me'));
      return;
    } catch (e) {
      if (e.status !== 401) throw e;
      storeToken(null);
    }
  }
  const data = await api('POST', '/guest');
  storeToken(data.token);
  adopt(data);
}

// Run a game action, locally or on the server. Actions run one at a time, in click order.
// Returns the action's result, or null after showing the error.
let queue = Promise.resolve();
function dispatch(action) {
  const run = async () => {
    try {
      let result;
      if (ONLINE) {
        const data = await api('POST', '/action', action);
        adopt(data);
        result = data.result;
      } else {
        result = applyAction(state, action, { now: now(), speed: SPEED });
        save();
      }
      renderHeader();
      return result;
    } catch (e) {
      if (e instanceof G.GameError || e instanceof ApiError) {
        toast(e.message, true);
        if (e.status === 401) openProfile();
        return null;
      }
      throw e;
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
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

function readyCount(t = now()) {
  return state.plots.filter(p => p && G.plotProgress(p, t).ready).length;
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

function plotState(i, t) {
  if (G.levelUnlockingPlot(i) === null) return { kind: 'never' };
  if (i >= G.plotCount(state.level)) return { kind: 'locked' };
  const plot = state.plots[i];
  if (!plot) return { kind: 'empty' };
  const prog = G.plotProgress(plot, t);
  return { kind: prog.ready ? 'ready' : 'growing', plot, prog };
}

function plotHTML(i, t) {
  const s = plotState(i, t);
  const { x, y } = PLOT_POS[i];
  const pos = `style="left:${sp(x - PLOT_SIZE / 2)};top:${spY(y - PLOT_SIZE / 2)};width:${sp(PLOT_SIZE)};height:${spY(PLOT_SIZE)}"`;
  let sig, inner, cls, label;
  // Spots that never open stay as bare furrow (kept in the DOM so updates line up).
  if (s.kind === 'never') return `<button class="plot never" data-plot="${i}" data-sig="never" tabindex="-1" aria-hidden="true" ${pos}></button>`;
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
  const t = now();
  let plots = '';
  for (let i = 0; i < MAX_PLOTS; i++) plots += plotHTML(i, t);
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
  const t = now();
  view.querySelectorAll('.plot[data-plot]').forEach(el => {
    const i = Number(el.dataset.plot);
    const html = plotHTML(i, t);
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
  const s = plotState(i, now());
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
  const s = plotState(i, now());
  if (s.kind === 'locked') return toast(`This plot unlocks at level ${G.levelUnlockingPlot(i)}.`);
  if (s.kind === 'empty') return openSeedPicker(i);
  if (s.kind === 'ready') return doHarvest(i, el);
  openCropPanel(i);
}

async function doHarvest(i, el) {
  const rect = el.getBoundingClientRect();
  const res = await dispatch({ type: 'harvest', plot: i });
  if (!res) return;
  floatText(`+${fmt(res.coins)} $CROP`, rect.left + rect.width / 2, rect.top);
  if (res.gems) floatText(`+${res.gems} gems${res.firstTime ? ' (first!)' : ''}`, rect.left + rect.width / 2, rect.top + 20);
  updatePlots();
}

async function harvestAll() {
  const res = await dispatch({ type: 'harvestAll' });
  if (!res) return;
  if (!res.n) return toast('Nothing is ready yet.');
  toast(`Harvested ${plural(res.n, 'crop')}: +${fmt(res.coins)} $CROP${res.gems ? `, +${res.gems} gems` : ''}`);
  updatePlots();
}

// Seeds sorted best-first: Premium before Feeble, Legendary before Common.
function seedList() {
  return seedsBestFirst(state).map(id => ({ crop: CROP[id], n: state.seeds[id] }));
}

async function plantAll() {
  const res = await dispatch({ type: 'plantAll' });
  if (!res) return;
  if (!res.n) toast(firstEmptyPlot(state) < 0 ? 'Every open plot is planted.' : 'You have no seeds. Buy a pack at the Market.');
  else { toast(`Planted ${plural(res.n, 'seed')}.`); closeModal(); }
  if (tab === 'farm') updatePlots(); else setTab('farm');
}

function seedButton(crop, n, action, extra = '') {
  const r = RARITY[crop.rarity];
  return `
    <button class="item slot" data-action="${action}" data-crop="${crop.id}" ${extra}>
      ${spriteImg(`crop:${crop.id}`, 32)}
      <span class="meta"><b>${crop.name}</b><span>${TIER[crop.tier].label} · ${r.label} · ${r.hours}h · ${fmt(G.cropPayout(crop.id, state.level))} $CROP</span></span>
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
  const s = plotState(i, now());
  if (s.kind !== 'growing') {
    closeModal();
    updatePlots();
    return;
  }
  const crop = CROP[s.plot.cropId];
  const cost = G.finishNowCost(s.plot, now());
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
    <div class="cp-row"><span>Total Harvest</span><b>${fmt(G.cropPayout(crop.id, state.level))} $CROP</b></div>
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
  const scale = G.rtp(level) / ECON.baseRtp;
  view.innerHTML = `
    <h2 class="section-title">Seed Vendor</h2>
    <div class="cards">
      ${TIERS.map(t => {
        const cost = TIER[t].cost;
        const owned = state.packs[t] || 0;
        const q = buyQty[t] || 1;
        const custom = q !== 1 && q !== 3;
        return `
          <div class="card" data-card="${t}">
            <div class="row">${spriteImg(`pack_${t}`, 56)}<div><h4>${TIER[t].label} Seeds</h4><div class="muted">Crops pay ${fmt(G.round2(cost * 0.5 * scale))}–${fmt(G.round2(cost * 5.4 * scale))}</div></div></div>
            <div class="row">${coin(cost)} <span class="muted">per pack</span></div>
            <div class="qty-row">
              <button class="btn small ${q === 1 ? 'blue' : 'cream'}" data-action="qty" data-tier="${t}" data-n="1">1×</button>
              <button class="btn small ${q === 3 ? 'blue' : 'cream'}" data-action="qty" data-tier="${t}" data-n="3">3×</button>
              <label class="qty-custom ${custom ? 'on' : ''}">Custom<input type="number" inputmode="numeric" min="1" max="${MAX_BATCH}" data-qty-input="${t}" value="${custom ? q : ''}" placeholder="1–${MAX_BATCH}"></label>
            </div>
            <div class="actions">
              ${buyButton(t)}
              ${owned ? `<button class="btn cream" data-action="open" data-tier="${t}">Open ${Math.min(owned, q)} (${owned} owned)</button>` : ''}
            </div>
          </div>`;
      }).join('')}
      <div class="card wide">
        <h4>Drop odds</h4>
        <div class="muted">Every pack uses the same odds. Your RTP at level ${level} is <b>${pct(G.rtp(level))}</b> (${pct(G.rtp(MAX_LEVEL))} at level ${MAX_LEVEL}).</div>
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

// --- Seed gacha ----------------------------------------------------------------
// One slot per seed. Each reel scrolls top to bottom and the slots stop one after another.
// Every crop on a reel is an honest random roll from the same odds as the real pull.

const buyQty = {};          // chosen batch size per tier on the Market screen
const REEL_LEN = 30;
const WIN_INDEX = 26;
const SPIN_MS = 2600;       // first slot; each later slot stops STAGGER_MS after it
const STAGGER_MS = 260;
let spin = null;            // { tier, count, results, timers, landed, cell }

function buyButton(t) {
  const q = buyQty[t] || 1;
  const total = TIER[t].cost * q;
  return `<button class="btn orange" data-action="buy-open" data-tier="${t}" data-buy="${t}" ${state.coins < total ? 'disabled' : ''}>Buy ${q} · ${spriteImg('coin', 16)} ${fmt(total)}</button>`;
}

function setQty(tier, n) {
  buyQty[tier] = Math.max(1, Math.min(MAX_BATCH, Math.round(n) || 1));
}

function fakeRoll(tier) {
  const rarity = G.rollRarity();
  const pool = CROPS.filter(c => c.tier === tier && c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

async function revealPack(tier, buyFirst) {
  const wanted = buyQty[tier] || 1;
  const count = buyFirst ? wanted : Math.min(wanted, state.packs[tier] || 0);
  if (count < 1) return toast('You have no packs of that kind.', true);
  const res = await dispatch({ type: buyFirst ? 'buyOpen' : 'openPack', tier, count });
  if (!res) return;
  const results = res.results;
  const cell = results.length > 6 ? 68 : results.length > 3 ? 84 : 112;   // smaller slots for big batches
  const slots = results.map((r, i) => {
    const cells = Array.from({ length: REEL_LEN }, (_, k) => (k === WIN_INDEX ? CROP[r.cropId] : fakeRoll(tier)));
    return `
      <div class="slot">
        <div class="slot-window">
          <div class="reel spinning" id="reel-${i}">${[...cells].reverse().map((c, k) => `
            <div class="cell ${c.rarity}" data-k="${REEL_LEN - 1 - k}">${spriteImg(`crop:${c.id}`, cell > 100 ? 64 : 32)}</div>`).join('')}
          </div>
        </div>
        <div class="slot-label" id="slot-label-${i}">Rolling</div>
      </div>`;
  }).join('');
  openModal(`
    <div class="gacha" style="--cell:${cell}px">
      <div class="gacha-title">SEED GACHA</div>
      <div class="gacha-box">
        <div class="gacha-tier">${results.length} × ${TIER[tier].label} pack${results.length === 1 ? '' : 's'}</div>
        <div class="slots n${Math.min(results.length, 3)}">${slots}</div>
      </div>
      <div id="gacha-result" class="gacha-result"></div>
      <div class="actions gacha-actions" id="gacha-actions">
        <button class="btn cream big" data-action="close">Back</button>
        <button class="btn orange big" data-action="skip-spin">Skip</button>
      </div>
    </div>`, 'gacha-panel');
  spin = { tier, results, timers: [], landed: 0, cell };
  const startY = -(REEL_LEN - 1) * cell;
  results.forEach((_, i) => {
    const reel = $(`#reel-${i}`);
    reel.style.transform = `translateY(${startY}px)`;
    const ms = SPIN_MS + i * STAGGER_MS;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      reel.style.transition = `transform ${ms}ms cubic-bezier(.12,.7,.18,1)`;
      reel.style.transform = `translateY(${startY + WIN_INDEX * cell}px)`;
    }));
    spin.timers.push(setTimeout(() => landSlot(i), ms + 60));
  });
}

function landSlot(i) {
  if (!spin) return;
  const reel = $(`#reel-${i}`);
  if (!reel || !reel.classList.contains('spinning')) return;
  reel.style.transition = 'none';
  reel.style.transform = `translateY(${-(REEL_LEN - 1 - WIN_INDEX) * spin.cell}px)`;
  reel.classList.remove('spinning');
  reel.querySelector(`[data-k="${WIN_INDEX}"]`).classList.add('win');
  const r = spin.results[i];
  const label = $(`#slot-label-${i}`);
  label.textContent = RARITY[r.rarity].label;
  label.className = `slot-label ${r.rarity}`;
  if (++spin.landed === spin.results.length) showGachaResult();
}

// Skip: stop every reel now.
function finishSpin() {
  if (!spin) return;
  spin.timers.forEach(clearTimeout);
  spin.results.forEach((_, i) => landSlot(i));
}

function showGachaResult() {
  const { tier, results } = spin;
  spin = null;
  const total = G.round2(results.reduce((sum, r) => sum + G.cropPayout(r.cropId, state.level), 0));
  const gems = results.reduce((sum, r) => sum + gemsFor(CROP[r.cropId]), 0);
  const q = buyQty[tier] || 1;
  const owned = state.packs[tier] || 0;
  const again = owned
    ? `<button class="btn orange big" data-action="open" data-tier="${tier}">Open ${Math.min(owned, q)} more</button>`
    : `<button class="btn orange big" data-action="buy-open" data-tier="${tier}" ${state.coins < TIER[tier].cost * q ? 'disabled' : ''}>Buy Again · ${fmt(TIER[tier].cost * q)}</button>`;
  const names = results.length === 1
    ? `<div class="won-name ${results[0].rarity}">${CROP[results[0].cropId].name}</div>
       <div class="stats"><span>Grows in ${RARITY[results[0].rarity].hours}h</span></div>`
    : `<div class="won-list">${results.map(r => `<span class="won-chip ${r.rarity}">${spriteImg(`crop:${r.cropId}`, 32)}${CROP[r.cropId].name}</span>`).join('')}</div>`;
  $('#gacha-result').innerHTML = `
    <div class="won">
      ${names}
      <div class="stats"><span>${results.length === 1 ? 'Pays' : 'Together they pay'} ${coin(total, 16)}${gems ? ` + ${gem(gems, 16)}` : ''}</span></div>
    </div>`;
  $('#gacha-actions').innerHTML = `
    <button class="btn cream big" data-action="close">Back</button>
    <button class="btn cream big" data-action="plant-all">Plant ${results.length === 1 ? 'it' : 'all'}</button>
    ${again}`;
}

// --- House -------------------------------------------------------------------

function renderHouse() {
  const lv = state.level;
  const cost = G.nextLevelCost(lv);
  const chest = G.chestFor(lv);
  const canChest = G.canClaimChest(state, now());
  let total = 0;
  const rows = LEVEL_COSTS.map((c, idx) => {
    const L = idx + 1;
    total += c;
    const unlocks = [];
    if (G.plotCount(L) > G.plotCount(L - 1)) unlocks.push('+1 plot');
    const chest = CHESTS.find(c => c.minLevel === L && L > 0);
    if (chest) unlocks.push(`${chest.label} chest`);
    if (L === MAX_LEVEL) unlocks.push('Max harvest bonus');
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
          <div class="muted">Level-up reward: ${gem(ECON.levelUpGemsPerLevel * (lv + 1), 14)}</div>
          <div class="actions"><button class="btn orange" data-action="level-up" ${state.coins < cost ? 'disabled' : ''}>Level up ${spriteImg('coin', 16)} ${fmt(cost)}</button></div>`}
      </div>
      <div class="card">
        <div class="row">${spriteImg(`chest_${chest.id}`, 56)}<div><h4>${chest.label} Chest</h4><div class="muted">One free chest per day</div></div></div>
        <div class="muted">Contains ${chest.gems[0]}–${chest.gems[1]} gems, plus one roll for produce, a seed pack or a potion.</div>
        <div class="actions">${canChest
          ? `<button class="btn orange" data-action="chest">Open chest</button>`
          : `<button class="btn cream" disabled>Next chest in <span id="chest-timer">${fmtTime(msToMidnight())}</span></button>`}</div>
      </div>
      ${ONLINE ? `<div class="card" id="crop-card"><h4>$CROP deposits</h4><p class="muted">Loading…</p></div>` : ''}
      <div class="card">
        <h4>Farm stats</h4>
        <table class="odds">
          <tr><td>Packs opened</td><td class="num">${fmt(s.packsOpened)}</td></tr>
          <tr><td>Harvests</td><td class="num">${fmt(s.harvests)}</td></tr>
          <tr><td>$CROP spent</td><td class="num">${fmt(s.coinsSpent)}</td></tr>
          <tr><td>$CROP earned</td><td class="num">${fmt(s.coinsEarned)}</td></tr>
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
  renderCropCard();
}

// --- $CROP deposits (one way: $CROP in, coins out; nothing is ever withdrawn) ---------

const shortAddr = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');

function solanaWallet() {
  return window.phantom?.solana || window.solflare || window.solana || null;
}

async function renderCropCard() {
  const box = $('#crop-card');
  if (!box) return;
  let w;
  try { w = await api('GET', '/wallet'); } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    box.innerHTML = `<h4>$CROP deposits</h4><p class="muted">${esc(e.message)}</p>`;
    return;
  }
  if (!$('#crop-card')) return;
  let bodyHtml;
  if (!w.enabled) {
    bodyHtml = `<p class="muted">Deposits open soon. You'll be able to send $CROP from your Solana wallet to play with.</p>`;
  } else if (!w.canLink) {
    bodyHtml = `<p class="muted">Save your farm with a username first, then link your Solana wallet to deposit $CROP.</p>
      <div class="actions"><button class="btn orange" data-action="profile">Save my farm</button></div>`;
  } else if (!w.wallet) {
    bodyHtml = `<p class="muted">Link your Solana wallet (Phantom or Solflare) to deposit $CROP. Linking only asks you to sign a message: it's free and sends nothing.</p>
      <div class="actions"><button class="btn orange" data-action="link-wallet">Link wallet</button></div>`;
  } else {
    const list = w.deposits.length
      ? `<table class="odds"><tbody>${w.deposits.map(d => `<tr><td>${new Date(d.time).toLocaleDateString()}</td><td class="num">${fmt(d.amount)} $CROP</td><td class="num">${d.status === 'credited' ? 'added' : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No deposits yet.</p>';
    bodyHtml = `
      <div class="muted">Linked wallet: <b>${esc(shortAddr(w.wallet))}</b></div>
      <p class="muted" style="margin:0">Send $CROP <b>from your linked wallet</b> to the game wallet below. It shows up in your farm about a minute after Solana confirms the transfer. Deposits are one way: $CROP can't be withdrawn.</p>
      <div class="copy-row"><code class="addr">${esc(w.treasury)}</code><button class="btn cream small" data-action="copy" data-copy="${esc(w.treasury)}">Copy</button></div>
      <div class="muted">Token: <code class="addr small">${esc(w.mint)}</code></div>
      ${list}
      <div class="actions"><button class="btn cream small" data-action="link-wallet">Change wallet</button></div>`;
  }
  box.innerHTML = `<div class="row">${spriteImg('coin', 40)}<div><h4>Deposit $CROP</h4><div class="muted">Your balance: ${fmt(state.coins)} $CROP</div></div></div>${bodyHtml}`;
}

async function linkWallet() {
  const provider = solanaWallet();
  if (!provider) return toast('No Solana wallet found. Install Phantom or Solflare, then reload.', true);
  try {
    const res = await provider.connect();
    const address = (res?.publicKey || provider.publicKey).toString();
    const { message } = await api('POST', '/wallet/challenge', { wallet: address });
    const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
    const bytes = signed?.signature || signed;
    const signature = btoa(String.fromCharCode(...bytes));
    await api('POST', '/wallet/link', { signature });
    toast(`Wallet ${shortAddr(address)} linked.`);
    renderCropCard();
  } catch (e) {
    toast(e instanceof ApiError ? e.message : 'Wallet linking was cancelled.', true);
  }
}

async function openChest() {
  const res = await dispatch({ type: 'claimChest' });
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
    </div>`;
}

// --- Modal, toasts, floating text -------------------------------------------

function openModal(html, variant = '') {
  if (spin) { spin.timers.forEach(clearTimeout); spin = null; }
  modalPanel.className = `panel ${variant}`;
  modalPanel.innerHTML = `<button class="close" data-action="close" aria-label="Close">×</button>${html}`;
  modal.hidden = false;
}

function closeModal() {
  if (spin) { spin.timers.forEach(clearTimeout); spin = null; }
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

const RENDER = { valley: renderValley, farm: renderFarm, market: renderMarket, house: renderHouse, backpack: renderBackpack, leaders: renderLeaders };

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

async function plantFirst(cropId) {
  if (await dispatch({ type: 'plantFirst', cropId })) {
    toast(`Planted ${CROP[cropId].name}.`);
    closeModal();
    refresh();
  }
}

// --- Profile: name, account, sign in/out ---------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function openProfile(mode = 'main') {
  const nameForm = `
    <form class="form" data-form="rename">
      <label>Farm name<input name="name" maxlength="18" value="${esc(state.name)}" autocomplete="off"></label>
      <button class="btn cream" type="submit">Save name</button>
    </form>`;
  let account;
  if (!ONLINE) {
    account = `<p class="muted">This site saves your farm in this browser only. Accounts and the leaderboard need the Hopi Farms server.</p>`;
  } else if (mode === 'login') {
    account = `
      <form class="form" data-form="login">
        <h4>Sign in</h4>
        <label>Username<input name="username" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="muted">Signing in switches to that account's farm. ${user?.guest ? 'Save this guest farm first if you want to keep it.' : ''}</p>
        <div class="actions left"><button class="btn orange" type="submit">Sign in</button><button class="btn cream" type="button" data-action="profile">Back</button></div>
      </form>`;
  } else if (user?.guest) {
    account = `
      <form class="form" data-form="register">
        <h4>Save your farm</h4>
        <p class="muted">You're playing as a guest. Pick a username and password to keep this farm and play it on other devices.</p>
        <label>Username<input name="username" autocomplete="username" pattern="[A-Za-z0-9_]{3,20}" title="3–20 letters, numbers or underscores" required></label>
        <label>Password<input name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <div class="actions left"><button class="btn orange" type="submit">Save farm</button><button class="btn cream" type="button" data-action="profile-login">I have an account</button></div>
      </form>`;
  } else {
    account = `
      <h4>Account</h4>
      <p>Signed in as <b>${esc(user?.username || '')}</b>.</p>
      <div class="actions left"><button class="btn cream" data-action="logout">Sign out</button></div>`;
  }
  openModal(`<h3>Your farm</h3>${nameForm}<hr class="rule">${account}`);
}

async function submitForm(form) {
  const data = Object.fromEntries(new FormData(form));
  const kind = form.dataset.form;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    if (kind === 'rename') {
      if (await dispatch({ type: 'rename', name: data.name })) { toast('Name saved.'); closeModal(); }
    } else if (kind === 'register') {
      adopt(await api('POST', '/register', data));
      toast(`Farm saved as ${user.username}.`);
      closeModal();
    } else if (kind === 'login') {
      const res = await api('POST', '/login', data);
      storeToken(res.token);
      adopt(res);
      toast(`Welcome back, ${user.username}!`);
      closeModal();
      setTab(tab);
    }
  } catch (e) {
    if (e instanceof ApiError) toast(e.message, true);
    else throw e;
  } finally {
    button.disabled = false;
    renderHeader();
  }
}

async function logout() {
  if (!confirm('Sign out? You can sign back in with your username and password.')) return;
  await api('POST', '/logout').catch(() => {});
  storeToken(null);
  closeModal();
  await boot();
}

// --- Leaderboard ---------------------------------------------------------------

async function renderLeaders() {
  view.innerHTML = `<h2 class="section-title">Leaderboard</h2><div class="cards"><div class="card wide" id="leaders"><p class="muted">Loading…</p></div></div>`;
  const box = $('#leaders');
  if (!ONLINE) {
    box.innerHTML = `<h4>Top farmers</h4><p class="muted">The leaderboard needs the Hopi Farms server. On this site your farm is saved in this browser only.</p>`;
    return;
  }
  try {
    const data = await api('GET', '/leaderboard');
    if (tab !== 'leaders') return;
    const youInTop = data.top.some(r => r.you);
    box.innerHTML = `
      <h4>Top farmers by XP</h4>
      <div class="muted">${plural(data.players, 'farm')} in the valley</div>
      <table class="odds leaders">
        <thead><tr><th class="num">#</th><th>Farm</th><th class="num">Level</th><th class="num">XP</th></tr></thead>
        <tbody>
          ${data.top.map(r => `<tr class="${r.you ? 'you' : ''}"><td class="num">${r.rank}</td><td>${esc(r.name)}${r.you ? ' (you)' : ''}</td><td class="num">${r.level}</td><td class="num">${fmt(r.xp)}</td></tr>`).join('')}
          ${data.you && !youInTop ? `<tr class="you gap"><td class="num">${data.you.rank}</td><td>${esc(data.you.name)} (you)</td><td class="num">${data.you.level}</td><td class="num">${fmt(data.you.xp)}</td></tr>` : ''}
        </tbody>
      </table>`;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    box.innerHTML = `<h4>Top farmers</h4><p class="muted">${esc(e.message)}</p>`;
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
    case 'rename':
    case 'profile': return openProfile();
    case 'profile-login': return openProfile('login');
    case 'logout': return logout();
    case 'plant':
      return dispatch({ type: 'plant', plot: Number(plot), cropId: crop }).then(r => { if (r) { closeModal(); refresh(); } });
    case 'plant-first': return plantFirst(crop);
    case 'plant-all': return plantAll();
    case 'harvest-all': return harvestAll();
    case 'finish':
      return dispatch({ type: 'finishNow', plot: Number(plot) }).then(r => { if (r) { toast('Crop finished!'); closeModal(); refresh(); } });
    case 'elixir':
      return dispatch({ type: 'useElixir', plot: Number(plot) }).then(r => {
        if (r) { toast(`Growth Elixir used: −${ELIXIR_HOURS}h.`); renderCropPanel(); refresh(); }
      });
    case 'buy-open': return revealPack(tier, true).then(refresh);
    case 'open': return revealPack(tier, false).then(refresh);
    case 'skip-spin': return finishSpin();
    case 'qty':
      setQty(tier, Number(el.dataset.n));
      return renderMarket();
    case 'level-up':
      return dispatch({ type: 'levelUp' }).then(r => { if (r) { toast(`Valley level ${r.level}! +${r.gems} gems`); refresh(); } });
    case 'chest': return openChest();
    case 'link-wallet': return linkWallet();
    case 'copy':
      navigator.clipboard?.writeText(el.dataset.copy).then(() => toast('Address copied.'), () => toast('Copy failed: select the address instead.', true));
      return;
  }
});

// Custom batch size on the Market: update the buy button as you type, without re-rendering.
document.addEventListener('input', (e) => {
  const input = e.target.closest('[data-qty-input]');
  if (!input) return;
  const tier = input.dataset.qtyInput;
  const n = Number(input.value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH) return;
  setQty(tier, n);
  const card = input.closest('[data-card]');
  card.querySelector('[data-buy]').outerHTML = buyButton(tier);
  card.querySelectorAll('[data-action="qty"]').forEach(b => {
    b.classList.toggle('blue', Number(b.dataset.n) === n);
    b.classList.toggle('cream', Number(b.dataset.n) !== n);
  });
  input.closest('.qty-custom').classList.add('on');
});
document.addEventListener('change', (e) => {
  const input = e.target.closest('[data-qty-input]');
  if (input && input.value !== '') { setQty(input.dataset.qtyInput, Number(input.value)); renderMarket(); }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  submitForm(form);
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

// In online mode, re-read the farm every 30s so deposits and admin changes show up.
let lastSync = Date.now();
function syncFarm() {
  if (!ONLINE || document.hidden || spin || Date.now() - lastSync < 30e3) return;
  lastSync = Date.now();
  api('GET', '/me').then((data) => {
    const before = state.coins;
    adopt(data);
    if (state.coins > before + 0.001) toast(`+${fmt(G.round2(state.coins - before))} $CROP arrived.`);
    refresh();
  }).catch(() => {});
}

function tick() {
  syncFarm();
  if (tab === 'farm') {
    updatePlots();
    if (hoverPlot !== null) tooltip.innerHTML = plotTooltip(hoverPlot);
  }
  if (livePlot !== null) renderCropPanel();
  const timer = $('#chest-timer');
  if (timer) {
    if (G.canClaimChest(state, now())) renderHouse();
    else timer.textContent = fmtTime(msToMidnight());
  }
  renderHeader();
}

function showIntro() {
  if (state.seenIntro) return;
  dispatch({ type: 'seenIntro' });
  openModal(`
    <h3>Welcome to ${GAME_NAME}!</h3>
    <div class="reveal">
      <img class="px intro-logo" src="brand/logo-transparent.svg" width="136" height="168" alt="The Hopi Farms farmer" draggable="false">
      <p>Here are ${fmt(state.coins)} $CROP and a few Feeble seeds to get started.</p>
      <p class="muted">Plant seeds, wait for them to grow, and harvest them for $CROP. Spin seed packs at the Market. Rarer crops pay more and some pay gems. Level up your valley in the House for more plots and better returns.</p>
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
if (SPEED > 1 && !ONLINE) {
  const dev = $('#dev');
  dev.hidden = false;
  dev.textContent = `Dev speed ×${SPEED}`;
}
document.title = GAME_NAME;

async function boot() {
  if (ONLINE) {
    view.innerHTML = `<p class="hint">Connecting to the valley…</p>`;
    try {
      await connect();
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      view.innerHTML = `
        <div class="cards"><div class="card wide">
          <h4>Can't reach the farm</h4>
          <p class="muted">${esc(e.message)}</p>
          <div class="actions left"><button class="btn orange" data-action="retry">Try again</button></div>
        </div></div>`;
      return;
    }
  }
  renderHeader();
  setTab('valley');
  showIntro();
}

document.addEventListener('click', (e) => { if (e.target.closest('[data-action="retry"]')) boot(); });
boot();
setInterval(tick, 1000);
