// Hopi Farms admin dashboard. Talks to /api/admin/* with the same sign-in as the game.

import { RARITIES, RARITY, TIERS, TIER, MAX_LEVEL, CHESTS } from './data.js';
import { validateEconomy, baseRtpOf } from './economy.js';

const TOKEN_KEY = 'hopi-farms-token';
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const tip = $('#tip');

let tab = 'overview';
let saved = null;        // economy as saved on the server
let draft = null;        // economy being edited
let defaults = null;
let playerQuery = { q: '', sort: 'recent', page: 0 };
let selectedPlayer = null;

// --- Helpers ---------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const pct = (r, d = 2) => `${(r * 100).toFixed(d)}%`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const ago = (t) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };

class ApiError extends Error { constructor(m, s) { super(m); this.status = s; } }
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Can't reach the server.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong.', res.status);
  return data;
}

function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function showError(e) {
  if (!(e instanceof ApiError)) throw e;
  if (e.status === 401 || e.status === 403) return renderSignIn(e.status === 403 ? e.message : '');
  view.innerHTML = `<div class="card"><h3>Couldn't load this page</h3><p>${esc(e.message)}</p></div>`;
}

// --- Charts (inline SVG with hover tooltips) ---------------------------------------

const W = 640;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= v);
}

// Flat at the baseline, 4px rounded at the data end.
function barPath(x, y, w, h) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Bar chart. rows: [{ label, values: [..] }], series: [{ name, color }].
function barChart({ rows, series, height = 220, yFmt = (v) => fmt(v, 0), tipFmt = yFmt, xEvery = 1 }) {
  const pad = { l: 46, r: 8, t: 10, b: 26 };
  const ih = height - pad.t - pad.b, iw = W - pad.l - pad.r;
  const all = rows.flatMap(r => r.values);
  // Whole-number data (counts) gets at least 0–4 so the axis never shows repeated rounded labels.
  const max = all.every(Number.isInteger) ? Math.max(4, niceMax(Math.max(0, ...all))) : niceMax(Math.max(0, ...all));
  const band = iw / Math.max(1, rows.length);
  const groupW = Math.max(2, band * 0.72);
  const gap = 2;
  const barW = Math.max(1, (groupW - gap * (series.length - 1)) / series.length);
  const y = (v) => pad.t + ih - (v / max) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, yy = y(v);
    g += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/>`;
    g += `<text class="axis" x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${yFmt(v)}</text>`;
  }
  rows.forEach((r, i) => {
    const x0 = pad.l + i * band;
    g += `<rect class="hit" data-i="${i}" x="${x0}" y="${pad.t}" width="${band}" height="${ih}"/>`;
    g += `<rect class="hover-band" x="${x0}" y="${pad.t}" width="${band}" height="${ih}"/>`;
    r.values.forEach((v, s) => {
      const bx = x0 + (band - groupW) / 2 + s * (barW + gap);
      g += `<path d="${barPath(bx, y(v), barW, pad.t + ih - y(v))}" fill="${series[s].color}" pointer-events="none"/>`;
    });
    if (i % xEvery === 0) g += `<text class="axis" x="${x0 + band / 2}" y="${height - 8}" text-anchor="middle">${esc(r.short ?? r.label)}</text>`;
  });
  const legend = series.length > 1
    ? `<div class="legend">${series.map(s => `<span><span class="key" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}</div>` : '';
  const id = `c${Math.random().toString(36).slice(2, 8)}`;
  chartTips[id] = (i) => `<b>${esc(rows[i].label)}</b>${series.map((s, k) => `<div class="r"><span><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span><span>${tipFmt(rows[i].values[k])}</span></div>`).join('')}`;
  return `${legend}<svg class="chart" data-chart="${id}" viewBox="0 0 ${W} ${height}" role="img">${g}</svg>`;
}

// Line chart for one series over x = 0..n-1, with an optional dashed reference line.
function lineChart({ values, height = 220, yMin, yMax, yFmt, xLabel, refValue, refName, name, color }) {
  const pad = { l: 52, r: 10, t: 10, b: 30 };
  const ih = height - pad.t - pad.b, iw = W - pad.l - pad.r;
  const n = values.length;
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => pad.t + ih - ((v - yMin) / (yMax - yMin)) * ih;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = yMin + ((yMax - yMin) / 4) * i, yy = y(v);
    g += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/><text class="axis" x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${yFmt(v)}</text>`;
  }
  for (let i = 0; i < n; i += 5) g += `<text class="axis" x="${x(i)}" y="${height - 12}" text-anchor="middle">${i}</text>`;
  g += `<text class="axis-title" x="${W - pad.r}" y="${height - 1}" text-anchor="end">${esc(xLabel)}</text>`;
  if (refValue !== undefined) g += `<line class="ref" x1="${pad.l}" x2="${W - pad.r}" y1="${y(refValue)}" y2="${y(refValue)}"/>`;
  g += `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" points="${values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
  const step = iw / Math.max(1, n - 1);
  values.forEach((v, i) => {
    g += `<rect class="hit" data-i="${i}" x="${x(i) - step / 2}" y="${pad.t}" width="${step}" height="${ih}"/>`;
    g += `<rect class="hover-band" x="${x(i) - 0.5}" y="${pad.t}" width="1" height="${ih}" style="fill:var(--muted)"/>`;
  });
  const id = `c${Math.random().toString(36).slice(2, 8)}`;
  chartTips[id] = (i) => `<b>${esc(xLabel)} ${i}</b><div class="r"><span>${esc(name)}</span><span>${yFmt(values[i], true)}</span></div>`;
  const legend = refValue !== undefined
    ? `<div class="legend"><span><span class="key" style="background:${color}"></span>${esc(name)}</span><span><span class="key dash"></span>${esc(refName)}</span></div>` : '';
  return `${legend}<svg class="chart" data-chart="${id}" viewBox="0 0 ${W} ${height}" role="img">${g}</svg>`;
}

// Horizontal bars for the actual share, with a tick for the expected share.
function compareChart({ rows }) {
  const rowH = 30, height = rows.length * rowH + 24, padL = 92, padR = 56;
  const iw = W - padL - padR;
  const max = niceMax(Math.max(...rows.flatMap(r => [r.actual, r.expected]), 0.01));
  const x = (v) => padL + (v / max) * iw;
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g += `<line class="grid-line" x1="${x(v)}" x2="${x(v)}" y1="4" y2="${height - 20}"/><text class="axis" x="${x(v)}" y="${height - 6}" text-anchor="middle">${pct(v, 0)}</text>`;
  }
  rows.forEach((r, i) => {
    const y0 = 6 + i * rowH;
    const w = x(r.actual) - padL;
    g += `<text class="axis" x="${padL - 8}" y="${y0 + 15}" text-anchor="end" style="fill:var(--text-2)">${esc(r.label)}</text>`;
    if (w > 0) {
      const rr = Math.min(4, w);
      g += `<path d="M${padL},${y0 + 3}H${padL + w - rr}Q${padL + w},${y0 + 3} ${padL + w},${y0 + 3 + rr}V${y0 + 19 - rr}Q${padL + w},${y0 + 19} ${padL + w - rr},${y0 + 19}H${padL}Z" fill="var(--series-1)"/>`;
    }
    g += `<line x1="${x(r.expected)}" x2="${x(r.expected)}" y1="${y0}" y2="${y0 + 22}" stroke="var(--text)" stroke-width="2"/>`;
    g += `<text class="axis" x="${W - padR + 6}" y="${y0 + 15}" style="fill:var(--text-2)">${pct(r.actual, 1)}</text>`;
    g += `<rect class="hit" data-i="${i}" x="0" y="${y0 - 2}" width="${W}" height="${rowH}"/>`;
  });
  const id = `c${Math.random().toString(36).slice(2, 8)}`;
  chartTips[id] = (i) => `<b>${esc(rows[i].label)}</b><div class="r"><span>Actual</span><span>${pct(rows[i].actual, 2)} (${fmt(rows[i].n, 0)})</span></div><div class="r"><span>Expected</span><span>${pct(rows[i].expected, 2)}</span></div>`;
  return `<div class="legend"><span><span class="key" style="background:var(--series-1)"></span>Actual share of pulls</span><span><span class="key tick"></span>Expected (drop odds)</span></div>
    <svg class="chart" data-chart="${id}" viewBox="0 0 ${W} ${height}" role="img">${g}</svg>`;
}

const chartTips = {};
document.addEventListener('mousemove', (e) => {
  const hit = e.target.closest?.('.chart .hit');
  document.querySelectorAll('.hover-band.on').forEach(b => b.classList.remove('on'));
  if (!hit) { tip.hidden = true; return; }
  const svg = hit.closest('svg');
  const fn = chartTips[svg.dataset.chart];
  if (!fn) return;
  hit.nextElementSibling?.classList?.contains('hover-band') && hit.nextElementSibling.classList.add('on');
  tip.innerHTML = fn(Number(hit.dataset.i));
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(e.clientX + 14, innerWidth - w - 8)}px`;
  tip.style.top = `${Math.min(e.clientY + 14, innerHeight - h - 8)}px`;
});

function tableView(head, rows) {
  return `<details class="table-view"><summary>Show as table</summary><div class="table-wrap"><table>
    <thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></details>`;
}

// --- Sign in -------------------------------------------------------------------------

function renderSignIn(message = '') {
  $('#tabs').hidden = true;
  $('#who').innerHTML = '';
  view.innerHTML = `
    <form class="card signin" id="signin">
      <h2>Admin sign in</h2>
      <p class="muted">Use your Hopi Farms account. It needs admin access (granted on the server with <code>node server/admin-cli.js grant &lt;username&gt;</code>).</p>
      ${message ? `<p class="bad">${esc(message)}</p>` : ''}
      <div class="field"><label for="u">Username</label><input id="u" name="username" autocomplete="username" required></div>
      <div class="field"><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn primary" type="submit">Sign in</button>
    </form>`;
  $('#signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = await api('POST', '/login', Object.fromEntries(new FormData(e.target)));
      try { localStorage.setItem(TOKEN_KEY, data.token); } catch { /* storage blocked */ }
      boot();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      renderSignIn(err.message);
    }
  });
}

// --- Overview --------------------------------------------------------------------------

async function renderOverview() {
  const [o, s] = await Promise.all([api('GET', '/admin/overview'), api('GET', '/admin/stats?days=30')]);
  const realizedRtp = o.realized.packSpend ? o.realized.harvestCoins / o.realized.packSpend : null;
  const totalPulls = RARITIES.reduce((a, r) => a + o.realized.pulls[r], 0);
  const days = s.days;
  const short = (d) => d.day.slice(5);
  const tile = (label, value, sub = '', cls = '') => `<div class="card tile"><div class="label">${label}</div><div class="value ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  const edgeCls = realizedRtp === null ? '' : realizedRtp > 1 ? 'bad' : '';
  view.innerHTML = `
    <div class="section-head"><div><h2>Overview</h2><div class="muted">Live from the game database. Daily charts start from when stats logging was turned on.</div></div>
      <button class="btn" data-refresh>Refresh</button></div>
    <div class="grid tiles">
      ${tile('Players', fmt(o.players.total, 0), `${fmt(o.players.registered, 0)} with accounts · ${fmt(o.players.total - o.players.registered, 0)} guests · ${fmt(o.players.neverPlayed, 0)} visitors never played`)}
      ${tile('Active today', fmt(o.players.active24h, 0), `${fmt(o.players.active7d, 0)} in the last 7 days`)}
      ${tile('New today', fmt(o.players.newToday, 0), `${fmt(o.today.registrations || 0, 0)} saved an account`)}
      ${tile('Coins held', fmt(o.supply.coins, 0), `${fmt(o.supply.gems, 0)} gems held`)}
      ${tile('Pack RTP (actual)', realizedRtp === null ? '—' : pct(realizedRtp), `target ${pct(o.theory.baseRtp)} at level 0 · ${fmt(totalPulls, 0)} pulls`, edgeCls)}
      ${tile('Out of coins', fmt(o.players.broke, 0), 'can\'t afford a Feeble pack and nothing planted', o.players.broke ? 'warn' : '')}
    </div>
    <div class="grid two">
      <div class="card"><h3>Packs opened per day</h3>
        ${barChart({ rows: days.map(d => ({ label: d.day, short: short(d), values: [TIERS.reduce((a, t) => a + (d[`pulls:${t}`] || 0), 0)] })), series: [{ name: 'Packs', color: 'var(--series-1)' }], xEvery: 5 })}
        ${tableView(['Day', ...TIERS.map(t => TIER[t].label)], days.map(d => [d.day, ...TIERS.map(t => d[`pulls:${t}`] || 0)]))}
      </div>
      <div class="card"><h3>Coins in and out per day</h3>
        ${barChart({ rows: days.map(d => ({ label: d.day, short: short(d), values: [d.coins_in || 0, d.coins_out || 0] })), series: [{ name: 'Paid to players', color: 'var(--series-1)' }, { name: 'Spent by players', color: 'var(--series-2)' }], xEvery: 5 })}
        ${tableView(['Day', 'Paid to players', 'Spent by players', 'Pack spend', 'Harvest payouts'], days.map(d => [d.day, fmt(d.coins_in), fmt(d.coins_out), fmt(d.pack_spend), fmt(d.harvest_coins)]))}
      </div>
      <div class="card"><h3>Rarity of pulls vs. the odds</h3>
        ${totalPulls ? compareChart({ rows: RARITIES.map(r => ({ label: RARITY[r].label, actual: o.realized.pulls[r] / totalPulls, expected: o.theory.chances[r], n: o.realized.pulls[r] })) }) : '<p class="muted">No pulls logged yet.</p>'}
      </div>
      <div class="card"><h3>Players by valley level</h3>
        ${barChart({ rows: o.levels.map((n, l) => ({ label: `Level ${l}`, short: String(l), values: [n] })), series: [{ name: 'Players', color: 'var(--series-1)' }], xEvery: 5 })}
      </div>
    </div>`;
}

// --- Economy (theory) -------------------------------------------------------------------

async function renderEconomy() {
  const [e, o] = await Promise.all([api('GET', '/admin/economy'), api('GET', '/admin/overview')]);
  const cfg = e.economy;
  const base = baseRtpOf(cfg);
  const rtpAt = (l) => Math.min(base * (1 + cfg.harvestBonusPerLevel * l), cfg.rtpCap);
  const rtps = Array.from({ length: MAX_LEVEL + 1 }, (_, l) => rtpAt(l));
  const capLevel = rtps.findIndex(r => r >= cfg.rtpCap);
  const avgHours = RARITIES.reduce((a, r) => a + cfg.rarity[r].chance * cfg.rarity[r].hours, 0);
  const lo = Math.floor(Math.min(...rtps, 1) * 100 - 1) / 100, hi = Math.ceil(Math.max(...rtps, cfg.rtpCap, 1) * 100 + 0.5) / 100;
  view.innerHTML = `
    <div class="section-head"><div><h2>Economy</h2><div class="muted">What the current settings mean. Change them on the Pricing tab.</div></div></div>
    <div class="grid tiles">
      <div class="card tile"><div class="label">Base RTP (level 0)</div><div class="value">${pct(base)}</div><div class="sub">house edge ${pct(1 - base)}</div></div>
      <div class="card tile"><div class="label">Max RTP</div><div class="value">${pct(rtps[MAX_LEVEL])}</div><div class="sub">${capLevel >= 0 ? `cap reached at level ${capLevel}` : 'cap not reached'}</div></div>
      <div class="card tile"><div class="label">Average grow time</div><div class="value">${avgHours.toFixed(1)}h</div><div class="sub">per seed, weighted by odds</div></div>
      <div class="card tile"><div class="label">Cost to max level</div><div class="value">${fmt(cfg.levelCosts.reduce((a, b) => a + b, 0), 0)}</div><div class="sub">coins for all ${MAX_LEVEL} levels</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h3>Expected return by valley level</h3>
        ${lineChart({ values: rtps, yMin: lo, yMax: hi, yFmt: (v, exact) => pct(v, exact ? 2 : 1), xLabel: 'Level', refValue: 1, refName: 'Break-even', name: 'RTP', color: 'var(--series-1)' })}
        ${tableView(['Level', 'RTP'], rtps.map((r, l) => [l, pct(r)]))}
      </div>
      <div class="card"><h3>Expected coins back per pack</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Pack</th><th class="num">Price</th><th class="num">Back at Lv 0</th><th class="num">Back at Lv ${MAX_LEVEL}</th><th class="num">Edge per pack</th></tr></thead>
          <tbody>${TIERS.map(t => {
            const c = cfg.packCost[t];
            return `<tr><td>${TIER[t].label}</td><td class="num">${fmt(c)}</td><td class="num">${fmt(c * rtps[0])}</td><td class="num">${fmt(c * rtps[MAX_LEVEL])}</td><td class="num">${fmt(c * (1 - rtps[0]))}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
        <h3 style="margin-top:16px">Payout per crop at level 0</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Rarity</th><th class="num">Chance</th><th class="num">Grow</th>${TIERS.map(t => `<th class="num">${TIER[t].label}</th>`).join('')}</tr></thead>
          <tbody>${RARITIES.map(r => `<tr><td><span class="dot" style="background:var(--c-${r})"></span>${RARITY[r].label}</td><td class="num">${pct(cfg.rarity[r].chance)}</td><td class="num">${cfg.rarity[r].hours}h</td>${TIERS.map(t => `<td class="num">${fmt(cfg.packCost[t] * cfg.rarity[r].mult)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="card"><h3>Actual results so far</h3>
        <dl class="kv">
          <dt>Spent on packs</dt><dd>${fmt(o.realized.packSpend)} coins</dd>
          <dt>Paid out by harvests</dt><dd>${fmt(o.realized.harvestCoins)} coins</dd>
          <dt>Actual pack RTP</dt><dd>${o.realized.packSpend ? pct(o.realized.harvestCoins / o.realized.packSpend) : '—'}</dd>
          <dt>Lifetime spent (all)</dt><dd>${fmt(o.lifetime.coinsSpent)} coins (packs and levels)</dd>
          <dt>Lifetime earned</dt><dd>${fmt(o.lifetime.coinsEarned)} coins</dd>
        </dl>
        <p class="note">Harvest payouts lag pack spending by the grow time, so the actual RTP runs low while crops are still growing and settles over a few days. It also includes valley-level bonuses.</p>
      </div>
    </div>`;
}

// --- Pricing editor --------------------------------------------------------------------

async function renderPricing() {
  if (!draft) {
    const e = await api('GET', '/admin/economy');
    saved = e.economy; defaults = e.defaults; draft = clone(saved);
  }
  const inp = (path, value, { step = 'any', min = 0, max, pctScale = false, w } = {}) => {
    const shown = pctScale ? +(value * 100).toFixed(6) : value;
    const orig = getPath(saved, path);
    const changed = Math.abs((pctScale ? orig * 100 : orig) - shown) > 1e-9;
    return `<input type="number" data-path="${path}" ${pctScale ? 'data-pct="1"' : ''} step="${step}" min="${min}" ${max !== undefined ? `max="${max}"` : ''} value="${shown}" class="${changed ? 'changed' : ''}" ${w ? `style="width:${w}"` : ''}>`;
  };
  const chanceSum = RARITIES.reduce((a, r) => a + draft.rarity[r].chance, 0);
  view.innerHTML = `
    <div class="section-head"><div><h2>Pricing</h2><div class="muted">Changes apply to every player as soon as you save, including crops already planted (they pay at harvest time). Open games refresh on their own.</div></div>
      <div class="row">
        <button class="btn" data-pricing="revert">Discard changes</button>
        <button class="btn danger" data-pricing="defaults">Reset to defaults</button>
        <button class="btn primary" data-pricing="save">Save &amp; apply</button>
      </div></div>
    <div class="pricing">
      <div class="grid">
        <div class="card"><h3>Seed pack prices (coins)</h3>
          <div class="form-grid">${TIERS.map(t => `<div class="field"><label>${TIER[t].label}</label>${inp(`packCost.${t}`, draft.packCost[t], { min: 0.01 })}</div>`).join('')}</div>
        </div>
        <div class="card"><h3>Drop odds, payouts and grow times</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Rarity</th><th>Chance (%)</th><th>Payout (× pack price)</th><th>Grow time (hours)</th></tr></thead>
            <tbody>${RARITIES.map(r => `<tr>
              <td><span class="dot" style="background:var(--c-${r})"></span>${RARITY[r].label}</td>
              <td>${inp(`rarity.${r}.chance`, draft.rarity[r].chance, { pctScale: true, max: 100, w: '110px' })}</td>
              <td>${inp(`rarity.${r}.mult`, draft.rarity[r].mult, { w: '110px' })}</td>
              <td>${inp(`rarity.${r}.hours`, draft.rarity[r].hours, { min: 0.01, w: '110px' })}</td></tr>`).join('')}
            </tbody>
          </table></div>
          <p class="muted" style="margin:8px 0 0">Chances add up to <b class="${Math.abs(chanceSum - 1) > 1e-6 ? 'bad' : 'good'}">${(chanceSum * 100).toFixed(4)}%</b> (must be exactly 100%).</p>
        </div>
        <div class="card"><h3>Return to player</h3>
          <div class="form-grid">
            <div class="field"><label>Harvest bonus per level (%)</label>${inp('harvestBonusPerLevel', draft.harvestBonusPerLevel, { pctScale: true, max: 10 })}</div>
            <div class="field"><label>RTP cap (%)</label>${inp('rtpCap', draft.rtpCap, { pctScale: true, max: 200 })}</div>
            <div class="field"><label>Starter coins</label>${inp('starterCoins', draft.starterCoins)}</div>
          </div>
          <p class="note" style="margin-top:10px">Base RTP isn't set directly: it's the expected payout of the odds above (sum of chance × payout).</p>
        </div>
        <div class="card"><h3>Gems</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Harvest reward</th>${TIERS.map(t => `<th>${TIER[t].label}</th>`).join('')}</tr></thead>
            <tbody>${['epic', 'legendary'].map(r => `<tr><td>${RARITY[r].label}</td>${TIERS.map(t => `<td>${inp(`harvestGems.${r}.${t}`, draft.harvestGems[r][t], { step: 1, w: '80px' })}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
          <div class="form-grid" style="margin-top:10px">
            <div class="field"><label>First harvest of a crop</label>${inp('firstHarvestGems', draft.firstHarvestGems, { step: 1 })}</div>
            <div class="field"><label>Level-up (× new level)</label>${inp('levelUpGemsPerLevel', draft.levelUpGemsPerLevel, { step: 1 })}</div>
          </div>
          <h3 style="margin-top:14px">Daily chest gems (min – max)</h3>
          <div class="form-grid">${CHESTS.map(c => `<div class="field"><label>${c.label} (Lv ${c.minLevel}+)</label><div class="row" style="flex-wrap:nowrap">${inp(`chestGems.${c.id}.0`, draft.chestGems[c.id][0], { step: 1, w: '64px' })}–${inp(`chestGems.${c.id}.1`, draft.chestGems[c.id][1], { step: 1, w: '64px' })}</div></div>`).join('')}</div>
        </div>
        <div class="card"><h3>Valley level costs (coins to reach each level)</h3>
          <div class="levels-grid">${draft.levelCosts.map((c, i) => `<div class="field"><label>Level ${i + 1}</label>${inp(`levelCosts.${i}`, c)}</div>`).join('')}</div>
        </div>
      </div>
      <div class="card preview" id="preview"></div>
    </div>`;
  renderPreview();
}

function getPath(o, path) {
  return path.split('.').reduce((a, k) => a?.[k], o);
}
function setPath(o, path, v) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((a, k) => a[k], o);
  target[last] = v;
}

function renderPreview() {
  const box = $('#preview');
  if (!box) return;
  const errors = validateEconomy(draft);
  const changes = countChanges(saved, draft);
  if (errors.length) {
    box.innerHTML = `<h3>Preview</h3><p class="bad">Fix these before saving:</p><ul class="errors">${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`;
    return;
  }
  const base = baseRtpOf(draft), baseNow = baseRtpOf(saved);
  const rtp = (cfg, b, l) => Math.min(b * (1 + cfg.harvestBonusPerLevel * l), cfg.rtpCap);
  const delta = (a, b) => {
    const d = (a - b) * 100;
    return Math.abs(d) < 1e-9 ? '' : ` <span class="${d > 0 ? 'warn' : 'good'}">(${d > 0 ? '+' : ''}${d.toFixed(2)} pts)</span>`;
  };
  const avgHours = RARITIES.reduce((a, r) => a + draft.rarity[r].chance * draft.rarity[r].hours, 0);
  box.innerHTML = `
    <h3>Preview</h3>
    <div class="lab">Base RTP (level 0)</div>
    <div class="big ${base > 1 ? 'bad' : ''}">${pct(base)}</div>
    <div class="muted">${base > 1 ? 'Players profit on average at level 0.' : `House edge ${pct(1 - base)}`}${delta(base, baseNow)}</div>
    <dl class="kv" style="margin-top:12px">
      <dt>RTP at level 5</dt><dd>${pct(rtp(draft, base, 5))}${delta(rtp(draft, base, 5), rtp(saved, baseNow, 5))}</dd>
      <dt>RTP at level 10</dt><dd>${pct(rtp(draft, base, 10))}${delta(rtp(draft, base, 10), rtp(saved, baseNow, 10))}</dd>
      <dt>RTP at level ${MAX_LEVEL}</dt><dd>${pct(rtp(draft, base, MAX_LEVEL))}${delta(rtp(draft, base, MAX_LEVEL), rtp(saved, baseNow, MAX_LEVEL))}</dd>
      <dt>Average grow time</dt><dd>${avgHours.toFixed(2)}h</dd>
      ${TIERS.map(t => `<dt>${TIER[t].label}: back per pack</dt><dd>${fmt(draft.packCost[t] * base)} of ${fmt(draft.packCost[t])}</dd>`).join('')}
    </dl>
    <p class="muted" style="margin-top:12px">${changes ? `${changes} unsaved change${changes === 1 ? '' : 's'} (highlighted).` : 'No unsaved changes.'}</p>`;
}

function countChanges(a, b) {
  if (typeof a !== 'object' || a === null) return Math.abs(a - b) > 1e-9 ? 1 : 0;
  return Object.keys(a).reduce((n, k) => n + countChanges(a[k], b[k]), 0);
}

document.addEventListener('input', (e) => {
  const el = e.target.closest('#view input[data-path]');
  if (!el || !draft) return;
  const raw = Number(el.value);
  const v = el.dataset.pct ? raw / 100 : raw;
  el.classList.toggle('invalid', el.value === '' || !Number.isFinite(raw));
  if (el.value === '' || !Number.isFinite(raw)) return;
  setPath(draft, el.dataset.path, Math.round(v * 1e9) / 1e9);
  el.classList.toggle('changed', Math.abs(getPath(saved, el.dataset.path) - getPath(draft, el.dataset.path)) > 1e-9);
  if (el.dataset.path.startsWith('rarity.') && el.dataset.path.endsWith('.chance')) {
    const sum = RARITIES.reduce((a, r) => a + draft.rarity[r].chance, 0);
    const b = view.querySelector('.pricing p.muted b');
    if (b) { b.textContent = `${(sum * 100).toFixed(4)}%`; b.className = Math.abs(sum - 1) > 1e-6 ? 'bad' : 'good'; }
  }
  renderPreview();
});

async function pricingAction(kind) {
  if (kind === 'revert') { draft = clone(saved); return renderPricing(); }
  if (kind === 'defaults') {
    if (!confirm('Reset every price, odd and reward to the original defaults? This applies to all players right away.')) return;
    const r = await api('POST', '/admin/economy/reset');
    saved = r.economy; draft = clone(saved);
    toast('Economy reset to defaults.');
    return renderPricing();
  }
  if (kind === 'save') {
    const errors = validateEconomy(draft);
    if (errors.length) return toast(errors[0], true);
    const n = countChanges(saved, draft);
    if (!n) return toast('Nothing to save.');
    if (!confirm(`Apply ${n} change${n === 1 ? '' : 's'} to every player now?`)) return;
    const r = await api('POST', '/admin/economy', { economy: draft });
    saved = r.economy; draft = clone(saved);
    toast('Saved. Players get the new prices right away.');
    return renderPricing();
  }
}

// --- Players -----------------------------------------------------------------------------

async function renderPlayers() {
  const { q, sort, page } = playerQuery;
  const data = await api('GET', `/admin/players?q=${encodeURIComponent(q)}&sort=${sort}&page=${page}`);
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  view.innerHTML = `
    <div class="section-head"><div><h2>Players</h2><div class="muted">${fmt(data.total, 0)} farm${data.total === 1 ? '' : 's'}${q ? ` matching “${esc(q)}”` : ''}</div></div>
      <form class="row" id="player-search">
        <input type="search" name="q" placeholder="Search name, username or id" value="${esc(q)}" style="width:240px">
        <select name="sort">${[['recent', 'Last active'], ['xp', 'Most XP'], ['coins', 'Most coins'], ['gems', 'Most gems'], ['level', 'Highest level'], ['newest', 'Newest']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn" type="submit">Search</button>
      </form></div>
    <div class="split">
      <div class="card" style="padding:0"><div class="table-wrap"><table>
        <thead><tr><th>Farm</th><th>Account</th><th class="num">Lv</th><th class="num">XP</th><th class="num">Coins</th><th class="num">Gems</th><th class="num">Packs</th><th class="num">Harvests</th><th>Last active</th></tr></thead>
        <tbody>${data.rows.map(r => `<tr class="click ${r.id === selectedPlayer ? 'sel' : ''}" data-player="${r.id}">
          <td>${esc(r.name)}</td><td>${r.username ? esc(r.username) : '<span class="muted">guest</span>'} ${r.admin ? '<span class="pill admin">admin</span>' : ''}</td>
          <td class="num">${r.level}</td><td class="num">${fmt(r.xp, 0)}</td><td class="num">${fmt(r.coins)}</td><td class="num">${fmt(r.gems, 0)}</td>
          <td class="num">${fmt(r.packsOpened, 0)}</td><td class="num">${fmt(r.harvests, 0)}</td><td>${ago(r.lastActive)}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">No players found.</td></tr>'}
        </tbody></table></div>
        <div class="row" style="padding:10px 14px;justify-content:space-between">
          <span class="muted">Page ${page + 1} of ${pages}</span>
          <span class="row"><button class="btn" data-page="-1" ${page === 0 ? 'disabled' : ''}>Previous</button><button class="btn" data-page="1" ${page + 1 >= pages ? 'disabled' : ''}>Next</button></span>
        </div>
      </div>
      <div class="card" id="player-detail"><p class="muted">Select a player to see their farm.</p></div>
    </div>`;
  $('#player-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    playerQuery = { q: f.q, sort: f.sort, page: 0 };
    run(renderPlayers);
  });
  if (selectedPlayer) run(() => renderPlayerDetail(selectedPlayer));
}

async function renderPlayerDetail(id) {
  const box = $('#player-detail');
  if (!box) return;
  const { player: p, state: s } = await api('GET', `/admin/player?id=${id}`);
  const list = (o) => Object.entries(o || {}).map(([k, v]) => `${esc(k)} ×${v}`).join(', ') || '<span class="muted">none</span>';
  box.innerHTML = `
    <h2>${esc(p.name)}</h2>
    <div class="muted">${p.username ? `@${esc(p.username)}` : 'Guest'} · id ${p.id} · joined ${new Date(p.createdAt).toLocaleDateString()} · active ${ago(p.lastActive)}</div>
    <dl class="kv" style="margin:12px 0">
      <dt>Level / XP</dt><dd>${p.level} / ${fmt(p.xp, 0)}</dd>
      <dt>Coins</dt><dd>${fmt(p.coins)}</dd>
      <dt>Gems</dt><dd>${fmt(p.gems, 0)}</dd>
      <dt>Spent / earned</dt><dd>${fmt(p.coinsSpent)} / ${fmt(p.coinsEarned)}</dd>
      <dt>Packs / harvests</dt><dd>${fmt(p.packsOpened, 0)} / ${fmt(p.harvests, 0)}</dd>
      <dt>Planted</dt><dd>${s.plots.length ? s.plots.map(x => `${esc(x.crop)}${x.ready ? ' (ready)' : ''}`).join(', ') : '<span class="muted">nothing</span>'}</dd>
      <dt>Seeds</dt><dd>${list(s.seeds)}</dd>
      <dt>Unopened packs</dt><dd>${list(s.packs)}</dd>
      <dt>Items</dt><dd>${list(s.items)}</dd>
    </dl>
    <form id="adjust" class="grid" style="gap:10px">
      <h3>Adjust</h3>
      <div class="form-grid">
        <div class="field"><label>Coins (+/−)</label><input type="number" name="coins" step="any" value="0"></div>
        <div class="field"><label>Gems (+/−)</label><input type="number" name="gems" step="1" value="0"></div>
      </div>
      <div class="field"><label>Rename farm (optional)</label><input type="text" name="name" maxlength="18" placeholder="${esc(p.name)}"></div>
      <div class="field"><label>Reason (for the log)</label><input type="text" name="reason" maxlength="200" placeholder="e.g. refund for bug"></div>
      <button class="btn primary" type="submit">Apply</button>
    </form>`;
  $('#adjust').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { id: p.id, coins: Number(f.coins || 0), gems: Number(f.gems || 0), name: f.name.trim(), reason: f.reason };
    if (!body.coins && !body.gems && !body.name) return toast('Nothing to change.', true);
    if (!confirm(`Apply to ${p.name}: ${body.coins ? `${body.coins > 0 ? '+' : ''}${body.coins} coins ` : ''}${body.gems ? `${body.gems > 0 ? '+' : ''}${body.gems} gems ` : ''}${body.name ? `rename to "${body.name}"` : ''}?`)) return;
    try {
      await api('POST', '/admin/player/adjust', body);
      toast('Player updated.');
      run(renderPlayers);
    } catch (err) { if (err instanceof ApiError) toast(err.message, true); else throw err; }
  });
}

// --- Leaderboard & log ---------------------------------------------------------------------

async function renderLeaders() {
  const d = await api('GET', '/leaderboard');
  view.innerHTML = `
    <div class="section-head"><div><h2>Leaderboard</h2><div class="muted">Top 25 by XP, as players see it · ${fmt(d.players, 0)} farms total</div></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th class="num">#</th><th>Farm</th><th class="num">Level</th><th class="num">XP</th></tr></thead>
      <tbody>${d.top.map(r => `<tr><td class="num">${r.rank}</td><td>${esc(r.name)}</td><td class="num">${r.level}</td><td class="num">${fmt(r.xp, 0)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No players yet.</td></tr>'}</tbody>
    </table></div></div>`;
}

async function renderLog() {
  const { log } = await api('GET', '/admin/log');
  view.innerHTML = `
    <div class="section-head"><div><h2>Admin log</h2><div class="muted">The last 100 changes made from this dashboard.</div></div></div>
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Details</th></tr></thead>
      <tbody>${log.map(l => `<tr><td>${new Date(l.at).toLocaleString()}</td><td>${esc(l.admin)}</td><td>${esc(l.action)}</td>
        <td style="white-space:normal" class="mono">${Array.isArray(l.details) ? (l.details.map(esc).join('<br>') || '<span class="muted">no changes</span>') : esc(Object.entries(l.details).map(([k, v]) => `${k}: ${v}`).join(', '))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nothing yet.</td></tr>'}</tbody>
    </table></div></div>`;
}

// --- Routing ---------------------------------------------------------------------------------

const RENDER = { overview: renderOverview, economy: renderEconomy, pricing: renderPricing, players: renderPlayers, leaders: renderLeaders, log: renderLog };

async function run(fn) {
  try { await fn(); } catch (e) { showError(e); }
}

function setTab(name) {
  if (tab === 'pricing' && name !== 'pricing' && draft && countChanges(saved, draft) && !confirm('You have unsaved pricing changes. Leave without saving?')) return;
  if (name !== 'pricing') draft = null;
  tab = name;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  view.innerHTML = '<p class="muted">Loading…</p>';
  run(RENDER[name]);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('#tabs button');
  if (t) return setTab(t.dataset.tab);
  if (e.target.closest('[data-refresh]')) return run(RENDER[tab]);
  const pa = e.target.closest('[data-pricing]');
  if (pa) return run(() => pricingAction(pa.dataset.pricing));
  const pg = e.target.closest('[data-page]');
  if (pg) { playerQuery.page += Number(pg.dataset.page); return run(renderPlayers); }
  const row = e.target.closest('[data-player]');
  if (row) {
    selectedPlayer = Number(row.dataset.player);
    document.querySelectorAll('[data-player]').forEach(r => r.classList.toggle('sel', r === row));
    return run(() => renderPlayerDetail(selectedPlayer));
  }
  if (e.target.closest('[data-signout]')) {
    api('POST', '/logout').catch(() => {});
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
    renderSignIn();
  }
});

addEventListener('beforeunload', (e) => {
  if (tab === 'pricing' && draft && saved && countChanges(saved, draft)) e.preventDefault();
});

async function boot() {
  if (!token()) return renderSignIn();
  try {
    const me = await api('GET', '/admin/me');
    $('#tabs').hidden = false;
    $('#who').innerHTML = `Signed in as <b>${esc(me.username)}</b> <button class="btn" data-signout>Sign out</button>`;
    setTab(tab);
  } catch (e) {
    showError(e);
  }
}

boot();
