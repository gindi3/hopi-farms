// Hopi Farms admin dashboard. Talks to /api/admin/* with the same sign-in as the game.

import { RARITIES, RARITY, TIERS, TIER, MAX_LEVEL, CHESTS } from './data.js';
import { validateEconomy, baseRtpOf } from './economy.js';
import { DOCS_PAGES, DOCS_GROUPS, DOCS_LIMITS, validateDocs } from './docs-content.js';

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
      ${tile('$CROP held', fmt(o.supply.coins, 0), `${fmt(o.supply.gems, 0)} gems held`)}
      ${tile('Pack RTP (actual)', realizedRtp === null ? '—' : pct(realizedRtp), `target ${pct(o.theory.baseRtp)} at level 0 · ${fmt(totalPulls, 0)} pulls`, edgeCls)}
      ${tile('Out of $CROP', fmt(o.players.broke, 0), 'can\'t afford a Feeble pack and nothing planted', o.players.broke ? 'warn' : '')}
    </div>
    <div class="grid two">
      <div class="card"><h3>Packs opened per day</h3>
        ${barChart({ rows: days.map(d => ({ label: d.day, short: short(d), values: [TIERS.reduce((a, t) => a + (d[`pulls:${t}`] || 0), 0)] })), series: [{ name: 'Packs', color: 'var(--series-1)' }], xEvery: 5 })}
        ${tableView(['Day', ...TIERS.map(t => TIER[t].label)], days.map(d => [d.day, ...TIERS.map(t => d[`pulls:${t}`] || 0)]))}
      </div>
      <div class="card"><h3>$CROP in and out per day</h3>
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
      <div class="card tile"><div class="label">Cost to max level</div><div class="value">${fmt(cfg.levelCosts.reduce((a, b) => a + b, 0), 0)}</div><div class="sub">$CROP for all ${MAX_LEVEL} levels</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h3>Expected return by valley level</h3>
        ${lineChart({ values: rtps, yMin: lo, yMax: hi, yFmt: (v, exact) => pct(v, exact ? 2 : 1), xLabel: 'Level', refValue: 1, refName: 'Break-even', name: 'RTP', color: 'var(--series-1)' })}
        ${tableView(['Level', 'RTP'], rtps.map((r, l) => [l, pct(r)]))}
      </div>
      <div class="card"><h3>Expected $CROP back per pack</h3>
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
          <dt>Spent on packs</dt><dd>${fmt(o.realized.packSpend)} $CROP</dd>
          <dt>Paid out by harvests</dt><dd>${fmt(o.realized.harvestCoins)} $CROP</dd>
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
        <div class="card"><h3>Seed pack prices ($CROP)</h3>
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
            <div class="field"><label>Starter $CROP</label>${inp('starterCoins', draft.starterCoins)}</div>
            <div class="field"><label>New farm price ($CROP, farms 2–30)</label>${inp('farmCost', draft.farmCost)}</div>
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
            <div class="field"><label>Gems per hour skipped (Finish now)</label>${inp('skipGemsPerHour', draft.skipGemsPerHour, { step: 1, min: 1 })}</div>
          </div>
          <h3 style="margin-top:14px">Daily chest gems (min – max)</h3>
          <div class="form-grid">${CHESTS.map(c => `<div class="field"><label>${c.label} (Lv ${c.minLevel}+)</label><div class="row" style="flex-wrap:nowrap">${inp(`chestGems.${c.id}.0`, draft.chestGems[c.id][0], { step: 1, w: '64px' })}–${inp(`chestGems.${c.id}.1`, draft.chestGems[c.id][1], { step: 1, w: '64px' })}</div></div>`).join('')}</div>
        </div>
        <div class="card"><h3>Valley level costs ($CROP to reach each level)</h3>
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
      <dt>Finish now cost</dt><dd>${fmt(draft.skipGemsPerHour, 0)} gem${draft.skipGemsPerHour === 1 ? '' : 's'}/hour · a 24h Legendary: ${fmt(24 * draft.skipGemsPerHour, 0)} gems</dd>
      ${TIERS.map(t => `<dt>${TIER[t].label}: back per pack</dt><dd>${fmt(draft.packCost[t] * base)} of ${fmt(draft.packCost[t])}</dd>`).join('')}
    </dl>
    ${draft.farmCost <= draft.starterCoins ? `<p class="bad" style="margin-top:12px">A new farm costs ${fmt(draft.farmCost)} but gives ${fmt(draft.starterCoins)} starter $CROP, so players can open farms for free $CROP. Set the price above the starter amount.</p>` : ''}
    <p class="muted" style="margin-top:12px">${changes ? `${changes} unsaved change${changes === 1 ? '' : 's'} (highlighted).` : 'No unsaved changes.'}</p>`;
}

function countChanges(a, b) {
  if (typeof a !== 'object' || a === null) return Math.abs(a - b) > 1e-9 ? 1 : 0;
  return Object.keys(a).reduce((n, k) => n + countChanges(a[k], b[k]), 0);
}

document.addEventListener('input', (e) => {
  const doc = e.target.closest('#view [data-doc]');
  const kindSel = e.target.closest('#view [data-ev-kind]');
  if (kindSel) { eventKind = kindSel.value; return run(renderEvents); }
  const dl = e.target.closest('#view [data-ev-delivered]');
  if (dl) return run(async () => { await api('POST', '/admin/events/delivered', { id: Number(dl.dataset.evDelivered), delivered: dl.checked }); toast(dl.checked ? 'Marked delivered.' : 'Marked not delivered.'); });
  const pick = e.target.closest('#view [data-docs-page]');
  if (pick) { docsPage = pick.value; return run(renderDocs); }
  if (doc && docsDraft) return setDoc(doc.dataset.doc, doc.type === 'checkbox' ? doc.checked : doc.value);
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
        <select name="sort">${[['recent', 'Last active'], ['xp', 'Most XP'], ['coins', 'Most $CROP'], ['gems', 'Most gems'], ['level', 'Highest level'], ['newest', 'Newest']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn" type="submit">Search</button>
      </form></div>
    <div class="split">
      <div class="card" style="padding:0"><div class="table-wrap"><table>
        <thead><tr><th>Farm</th><th>Account</th><th class="num">Lv</th><th class="num">Farms</th><th class="num">XP</th><th class="num">$CROP</th><th class="num">Gems</th><th class="num">Packs</th><th class="num">Harvests</th><th>Last active</th></tr></thead>
        <tbody>${data.rows.map(r => `<tr class="click ${r.id === selectedPlayer ? 'sel' : ''}" data-player="${r.id}">
          <td>${esc(r.name)}</td><td>${r.username ? esc(r.username) : '<span class="muted">guest</span>'} ${r.admin ? '<span class="pill admin">admin</span>' : ''}</td>
          <td class="num">${r.level}</td><td class="num">${r.farms}</td><td class="num">${fmt(r.xp, 0)}</td><td class="num">${fmt(r.coins)}</td><td class="num">${fmt(r.gems, 0)}</td>
          <td class="num">${fmt(r.packsOpened, 0)}</td><td class="num">${fmt(r.harvests, 0)}</td><td>${ago(r.lastActive)}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No players found.</td></tr>'}
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
      <dt>Farms / top level / XP</dt><dd>${p.farms} / ${p.level} / ${fmt(p.xp, 0)}</dd>
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
        <div class="field"><label>$CROP (+/−)</label><input type="number" name="coins" step="any" value="0"></div>
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
    if (!confirm(`Apply to ${p.name}: ${body.coins ? `${body.coins > 0 ? '+' : ''}${body.coins} $CROP ` : ''}${body.gems ? `${body.gems > 0 ? '+' : ''}${body.gems} gems ` : ''}${body.name ? `rename to "${body.name}"` : ''}?`)) return;
    try {
      await api('POST', '/admin/player/adjust', body);
      toast('Player updated.');
      run(renderPlayers);
    } catch (err) { if (err instanceof ApiError) toast(err.message, true); else throw err; }
  });
}

// --- $CROP deposits ------------------------------------------------------------------------

async function renderDeposits() {
  const d = await api('GET', '/admin/deposits');
  const t = (k) => d.totals[k] || { n: 0, amount: 0, coins: 0 };
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-6)}` : '—');
  const solscan = (sig) => `https://solscan.io/tx/${encodeURIComponent(sig)}`;
  const statusPill = { credited: '<span class="pill good">credited</span>', unmatched: '<span class="pill warn">needs a player</span>' };
  view.innerHTML = `
    <div class="section-head"><div><h2>$CROP deposits</h2><div class="muted">One way only: $CROP sent to the treasury is added 1:1 to the player's in-game $CROP. Nothing is ever withdrawn, and the server holds no wallet keys.</div></div>
      <button class="btn" data-dep="scan" ${d.enabled ? '' : 'disabled'}>Check the chain now</button></div>
    ${d.enabled ? '' : `<div class="card" style="margin-bottom:14px"><h3>Deposits are off</h3>
      <p>Set these on the server, then restart the game:</p>
      <pre class="mono note">HOPI_CROP_MINT=&lt;the $CROP token mint&gt;
HOPI_TREASURY=&lt;the wallet that receives deposits&gt;
HOPI_SOLANA_RPC=&lt;optional: your RPC URL, e.g. Helius&gt;</pre></div>`}
    <div class="grid tiles">
      <div class="card tile"><div class="label">$CROP received</div><div class="value">${fmt(t('credited').amount + t('unmatched').amount)}</div><div class="sub">${fmt(t('credited').n + t('unmatched').n, 0)} transfers</div></div>
      <div class="card tile"><div class="label">Credited to players</div><div class="value">${fmt(t('credited').coins)}</div><div class="sub">$CROP from ${fmt(t('credited').n, 0)} deposits</div></div>
      <div class="card tile"><div class="label">Waiting for a player</div><div class="value ${t('unmatched').n ? 'warn' : ''}">${fmt(t('unmatched').n, 0)}</div><div class="sub">${fmt(t('unmatched').amount)} $CROP from unlinked wallets</div></div>
      <div class="card tile"><div class="label">Watcher</div><div class="value" style="font-size:18px">${d.enabled ? (d.status.lastError ? '<span class="bad">Error</span>' : '<span class="good">Running</span>') : 'Off'}</div><div class="sub">${d.status.lastScan ? `last checked ${ago(d.status.lastScan)}` : 'not checked yet'}${d.status.lastError ? ` · ${esc(d.status.lastError)}` : ''}</div></div>
    </div>
    <div class="grid">
      <div class="card"><h3>Addresses</h3>
        <dl class="kv">
          <dt>Token mint</dt><dd class="mono">${d.mint ? esc(d.mint) : '<span class="muted">not set</span>'}</dd>
          <dt>Treasury</dt><dd class="mono">${d.treasury ? esc(d.treasury) : '<span class="muted">not set</span>'}</dd>
          <dt>RPC</dt><dd class="mono">${esc(d.rpc)}</dd>
        </dl>
      </div>
    </div>
    <div class="card" style="padding:0;margin-top:14px"><div class="table-wrap"><table>
      <thead><tr><th>When</th><th>From wallet</th><th class="num">$CROP</th><th>Player</th><th>Status</th><th>Transaction</th></tr></thead>
      <tbody>${d.recent.map(r => `<tr>
        <td>${new Date(r.time || r.noted_at).toLocaleString()}</td>
        <td class="mono" title="${esc(r.wallet || '')}">${esc(short(r.wallet))}</td>
        <td class="num">${fmt(r.amount)}</td>
        <td>${r.username ? esc(r.username) : r.status === 'unmatched'
          ? `<form class="row" data-assign="${esc(r.signature)}" style="flex-wrap:nowrap"><input name="username" placeholder="username" style="width:120px" required><button class="btn" type="submit">Credit</button></form>`
          : '—'}</td>
        <td>${statusPill[r.status] || esc(r.status)}</td>
        <td><a class="mono" href="${solscan(r.signature)}" target="_blank" rel="noopener noreferrer">${esc(short(r.signature))}</a></td></tr>`).join('') || '<tr><td colspan="7" class="muted">No deposits yet.</td></tr>'}</tbody>
    </table></div></div>`;
  view.querySelectorAll('form[data-assign]').forEach(f => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = new FormData(f).get('username').trim();
    if (!confirm(`Credit this deposit to ${username}? This can't be undone from the dashboard.`)) return;
    try {
      const r = await api('POST', '/admin/deposits/assign', { signature: f.dataset.assign, username });
      toast(`Credited ${fmt(r.coins)} $CROP to ${username}.`);
      run(renderDeposits);
    } catch (err) { if (err instanceof ApiError) toast(err.message, true); else throw err; }
  }));
}

// --- Withdrawal requests ---------------------------------------------------------------------

async function renderWithdrawals() {
  const d = await api('GET', '/admin/withdrawals');
  const t = (k) => d.totals[k] || { n: 0, amount: 0 };
  const pending = d.requests.filter(r => r.status === 'pending');
  setWithdrawCount(pending.length);
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-6)}` : '—');
  const pill = { pending: '<span class="pill warn">pending</span>', sent: '<span class="pill good">sent</span>', declined: '<span class="pill">declined</span>', cancelled: '<span class="pill">cancelled</span>' };
  view.innerHTML = `
    <div class="section-head"><div><h2>Withdrawal requests</h2>
      <div class="muted">Players ask for $CROP back to their linked wallet. Send it from the treasury${d.treasury ? ` (<span class="mono">${esc(short(d.treasury))}</span>)` : ''} in your wallet app, then paste the transaction ID to mark it sent. The server checks the payment on chain. The amount was taken from the player's balance when they asked; declining refunds it.</div></div>
      <button class="btn" data-refresh>Refresh</button></div>
    <div class="grid tiles">
      <div class="card tile"><div class="label">Waiting</div><div class="value ${t('pending').n ? 'warn' : ''}">${fmt(t('pending').n, 0)}</div><div class="sub">${fmt(t('pending').amount)} $CROP to send</div></div>
      <div class="card tile"><div class="label">Sent</div><div class="value">${fmt(t('sent').amount)}</div><div class="sub">$CROP in ${fmt(t('sent').n, 0)} withdrawals</div></div>
      <div class="card tile"><div class="label">Declined</div><div class="value">${fmt(t('declined').n, 0)}</div><div class="sub">${fmt(t('declined').amount)} $CROP refunded</div></div>
    </div>
    <div class="split">
    <div class="card" style="padding:0"><div class="table-wrap"><table>
      <thead><tr><th>Requested</th><th>Player</th><th class="num">$CROP</th><th>Send to</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${d.requests.map(r => `<tr>
        <td>${new Date(r.requested_at).toLocaleString()}</td>
        <td><button class="link-btn" data-wd-player="${r.user_id}" title="See this player's money and stats">${esc(r.username)}</button></td>
        <td class="num"><b>${fmt(r.amount)}</b></td>
        <td class="mono"><span title="${esc(r.wallet)}">${esc(short(r.wallet))}</span> <button class="btn" data-copy="${esc(r.wallet)}" style="padding:2px 8px">Copy</button></td>
        <td>${pill[r.status] || esc(r.status)}${r.note && r.status !== 'pending' ? ` <span class="muted">${esc(r.note)}</span>` : ''}</td>
        <td>${r.status === 'pending' ? `
          <form class="row" data-wd-sent="${r.id}" style="flex-wrap:nowrap">
            <input name="signature" placeholder="Transaction ID" style="width:200px" required>
            <button class="btn primary" type="submit">Mark as sent</button>
            <button class="btn danger" type="button" data-wd-decline="${r.id}" data-amount="${r.amount}" data-user="${esc(r.username)}">Decline</button>
          </form>` : r.signature ? `<a class="mono" href="https://solscan.io/tx/${encodeURIComponent(r.signature)}" target="_blank" rel="noopener noreferrer">${esc(short(r.signature))}</a>${r.admin ? ` <span class="muted">by ${esc(r.admin)}</span>` : ''}` : (r.admin ? `<span class="muted">by ${esc(r.admin)}</span>` : '')}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No requests yet.</td></tr>'}</tbody>
    </table></div></div>
    <div class="card" id="wd-player"><p class="muted">Click a player's name to see their deposits, withdrawals and play before you pay.</p></div>
    </div>`;
  if (wdPlayer) run(() => renderWdPlayer(wdPlayer));
  view.querySelectorAll('form[data-wd-sent]').forEach(f => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const signature = new FormData(f).get('signature').trim();
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const r = await api('POST', '/admin/withdrawals/sent', { id: Number(f.dataset.wdSent), signature });
      toast(`Verified on chain: ${fmt(r.received)} $CROP sent. Marked as sent.`);
      run(renderWithdrawals);
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Mark as sent';
      if (err instanceof ApiError) toast(err.message, true); else throw err;
    }
  }));
}

// The player panel beside the withdrawal requests.
let wdPlayer = null;
async function renderWdPlayer(id) {
  wdPlayer = id;
  const box = $('#wd-player');
  if (!box) return;
  box.innerHTML = '<p class="muted">Loading…</p>';
  const d = await api('GET', `/admin/withdrawals/player?id=${id}`);
  const { player: p, money: m, play } = d;
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-6)}` : '—');
  const signed = (n) => `<b class="${n > 0 ? 'warn' : n < 0 ? 'good' : ''}">${n > 0 ? '+' : ''}${fmt(n)}</b>`;
  const wdPill = { pending: 'warn', sent: 'good' };
  box.innerHTML = `
    <h2>${esc(p.name)}</h2>
    <div class="muted">@${esc(p.username || 'guest')} · id ${p.id} · joined ${new Date(p.createdAt).toLocaleDateString()} (${ago(p.createdAt)}) · active ${ago(p.lastActive)}</div>
    <div class="muted mono" style="margin-top:4px">Wallet ${p.wallet ? `<a href="https://solscan.io/account/${encodeURIComponent(p.wallet)}" target="_blank" rel="noopener noreferrer" title="${esc(p.wallet)}">${esc(short(p.wallet))}</a>` : 'not linked'}</div>

    <h3 style="margin-top:14px">Money in vs. out</h3>
    <dl class="kv">
      <dt>Deposited</dt><dd>${fmt(m.deposited)} $CROP <span class="muted">(${fmt(m.deposits, 0)} transfers)</span></dd>
      <dt>Withdrawn (sent)</dt><dd>${fmt(m.withdrawn)}</dd>
      <dt>Waiting to send</dt><dd>${fmt(m.pendingOut)}</dd>
      <dt>Balance in game</dt><dd>${fmt(m.balance)}</dd>
      <dt>Ahead of deposits</dt><dd>${signed(m.aheadOfDeposits)}</dd>
    </dl>
    <p class="note" style="margin-top:8px">${m.aheadOfDeposits > 0
      ? `Paying everything out would give this player ${fmt(m.aheadOfDeposits)} $CROP more than they deposited. Of that, ${fmt(m.starter)} is starter $CROP (${p.farms} farm${p.farms === 1 ? '' : 's'})${m.adminCrop ? ` and ${fmt(m.adminCrop)} came from dashboard adjustments` : ''}; the rest is net winnings.`
      : `This player has put in at least as much $CROP as they hold, have pending and have withdrawn.`}</p>

    <h3 style="margin-top:14px">Play</h3>
    <dl class="kv">
      <dt>Packs</dt><dd>${fmt(play.packsOpened, 0)} opened · ${fmt(play.packSpend)} spent</dd>
      <dt>Harvests</dt><dd>${fmt(play.harvests, 0)} · ${fmt(play.harvested)} redeemed</dd>
      <dt>Net from packs</dt><dd>${signed(play.packNet)}</dd>
      <dt>Levels / farms</dt><dd>top level ${p.level} on ${p.farms} farm${p.farms === 1 ? '' : 's'} · ${fmt(play.levelSpend)} on levels · ${fmt(play.farmSpend)} on farms</dd>
      <dt>XP / potions</dt><dd>${fmt(p.xp, 0)} XP · ${fmt(play.brews, 0)} brews</dd>
    </dl>

    ${d.adjustments.length ? `<h3 style="margin-top:14px">Dashboard adjustments</h3>
      <table><tbody>${d.adjustments.map(a => `<tr><td>${new Date(a.at).toLocaleDateString()}</td><td class="num">${a.coins ? `${a.coins > 0 ? '+' : ''}${fmt(a.coins)} $CROP` : ''} ${a.gems ? `${a.gems > 0 ? '+' : ''}${a.gems} gems` : ''}</td><td class="muted">${esc(a.reason || '')} · ${esc(a.admin)}</td></tr>`).join('')}</tbody></table>` : ''}

    <h3 style="margin-top:14px">Withdrawal requests</h3>
    ${d.withdrawals.length ? `<table><tbody>${d.withdrawals.map(w => `<tr><td>${new Date(w.requested_at).toLocaleDateString()}</td><td class="num">${fmt(w.amount)}</td>
      <td><span class="pill ${wdPill[w.status] || ''}">${esc(w.status)}</span></td><td>${w.signature ? `<a class="mono" href="https://solscan.io/tx/${encodeURIComponent(w.signature)}" target="_blank" rel="noopener noreferrer">${esc(short(w.signature))}</a>` : esc(w.note || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None.</p>'}

    <h3 style="margin-top:14px">Deposits</h3>
    ${d.deposits.length ? `<table><tbody>${d.deposits.map(x => `<tr><td>${new Date(x.time).toLocaleDateString()}</td><td class="num">${fmt(x.amount)} $CROP</td>
      <td><a class="mono" href="https://solscan.io/tx/${encodeURIComponent(x.signature)}" target="_blank" rel="noopener noreferrer">${esc(short(x.signature))}</a></td></tr>`).join('')}</tbody></table>` : '<p class="muted">None.</p>'}`;
  document.querySelectorAll('[data-wd-player]').forEach(b => b.closest('tr').classList.toggle('sel', Number(b.dataset.wdPlayer) === id));
}

function setWithdrawCount(n) {
  const el = $('#wd-count');
  if (!el) return;
  el.textContent = n;
  el.hidden = !n;
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

// --- Auctions and lotteries -------------------------------------------------------------

let eventKind = 'auction';
const localInput = (t) => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60e3); return d.toISOString().slice(0, 16); };

async function renderEvents() {
  const r = await api('GET', '/admin/events');
  const a = eventKind === 'auction';
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const row = (e) => {
    const status = e.status === 'live' ? (Date.now() < e.startsAt ? 'scheduled' : 'live') : e.status;
    const stats = e.kind === 'auction'
      ? (e.topBid ? `Top bid <b>${fmt(e.topBid.amount)}</b> gems by ${esc(e.topBid.name)} · ${fmt(e.bids)} bids from ${fmt(e.bidders)} players` : `No bids yet · starts at ${fmt(e.startBid)} gems, +${fmt(e.minStep)} per raise`)
      : `${fmt(e.totalTickets)} tickets from ${fmt(e.entrants)} players · ${fmt(e.ticketPrice)} gems each · ${fmt(e.winnersCount)} winner${e.winnersCount === 1 ? '' : 's'}${e.maxTickets ? ` · max ${fmt(e.maxTickets)} each` : ''}`;
    const gemsIn = e.kind === 'auction' ? (e.topBid?.amount || 0) : e.totalTickets * e.ticketPrice;
    return `<div class="card ev-admin">
      <div class="row" style="justify-content:space-between"><div><span class="pill ${status === 'live' ? 'good' : ''}">${status}</span> <b>${esc(e.title)}</b> <span class="muted">#${e.id} · ${e.kind}</span></div>
        <div class="row">
          ${e.status === 'live' ? `<button class="btn" data-ev="end" data-id="${e.id}">End now</button><button class="btn danger" data-ev="cancel" data-id="${e.id}">Cancel &amp; refund</button>` : ''}
          ${e.status === 'ended' && e.winners.length ? `<label class="check"><input type="checkbox" data-ev-delivered="${e.id}" ${e.delivered ? 'checked' : ''}> Prize delivered</label>` : ''}
        </div></div>
      <div class="muted">${e.status === 'live' ? `${Date.now() < e.startsAt ? `Starts ${new Date(e.startsAt).toLocaleString()} · ` : ''}Ends ${new Date(e.endsAt).toLocaleString()}` : `${e.status === 'ended' ? 'Ended' : 'Cancelled'} ${new Date(e.settledAt).toLocaleString()}`} · ${fmt(gemsIn)} gems in</div>
      <div>${stats}</div>
      ${e.winners.length ? `<div><b>${e.winners.length > 1 ? 'Winners' : 'Winner'}:</b> ${e.winners.map(w => `<b>${esc(w.name)}</b>${w.amount ? ` (${fmt(w.amount)} gems)` : ` (${fmt(w.tickets)} tickets)`}`).join(', ')}</div>` : (e.status === 'ended' ? '<div class="muted">No winner: nobody entered.</div>' : '')}
      ${e.entries?.length ? `<details><summary>${e.entries.length} entr${e.entries.length === 1 ? 'y' : 'ies'}</summary>${tableView(['Player', 'Tickets'], e.entries.map(x => [esc(x.name), fmt(x.tickets)]))}</details>` : ''}
    </div>`;
  };
  view.innerHTML = `
    <div class="section-head"><div><h2>Auctions &amp; Lotteries</h2><div class="muted">Players bid or buy tickets with gems in the game's Auction and Lottery tabs. Winners are picked by the server when time runs out. You deliver the prize yourself, then tick "Prize delivered".</div></div>
      <button class="btn" data-refresh>Refresh</button></div>
    <div class="grid ev-grid">
      <div class="card"><h3>New ${a ? 'auction' : 'lottery'}</h3>
        <form id="ev-form" class="ev-new">
          ${field('Type', `<select name="kind" data-ev-kind><option value="auction" ${a ? 'selected' : ''}>Auction (highest bid wins)</option><option value="lottery" ${a ? '' : 'selected'}>Lottery (random draw)</option></select>`)}
          ${field('Prize title', '<input type="text" name="title" maxlength="80" required placeholder="e.g. 2023 Baxcalibur #210 PSA 10">')}
          ${field('Description (optional)', '<input type="text" name="description" maxlength="1000" placeholder="e.g. Fair market value $349. Shipped to the winner.">')}
          ${field('Picture link (optional)', '<input type="text" name="image" placeholder="https://…">')}
          <div class="form-grid">
            ${field('Starts (blank = now)', '<input type="datetime-local" name="startsAt">')}
            ${field('Ends', `<input type="datetime-local" name="endsAt" required value="${localInput(Date.now() + 7 * 86400e3)}">`)}
          </div>
          <div class="form-grid">${a
            ? field('Starting bid (gems)', '<input type="number" name="startBid" min="1" step="1" value="50" required>') + field('Minimum raise (gems)', '<input type="number" name="minStep" min="1" step="1" value="5" required>')
            : field('Ticket price (gems)', '<input type="number" name="ticketPrice" min="1" step="1" value="5" required>') + field('Max tickets per player (0 = no limit)', '<input type="number" name="maxTickets" min="0" step="1" value="0">') + field('Number of winners', '<input type="number" name="winnersCount" min="1" max="100" step="1" value="1" required>')}
          </div>
          <div class="row"><button class="btn primary" type="submit">Start ${a ? 'auction' : 'lottery'}</button></div>
        </form>
      </div>
      <div class="ev-list">${r.events.map(row).join('') || '<div class="card"><p class="muted">Nothing yet. Start an auction or lottery on the left.</p></div>'}</div>
    </div>`;
}

async function eventAction(kind, id) {
  if (kind === 'end' && !confirm('End it now and pick the winner from what is in so far?')) return;
  if (kind === 'cancel' && !confirm('Cancel it? There is no winner and every gem players put in goes back to them.')) return;
  const r = await api('POST', `/admin/events/${kind}`, { id });
  toast(kind === 'cancel' ? `Cancelled. Refunded ${fmt(r.refunded)} gems.` : 'Ended.');
  await renderEvents();
}

// --- Docs editor ---------------------------------------------------------------------
// Edits the text on /docs: prizes, each page's title / intro / extra text / hidden flag, and
// extra pages. Number tables on the docs are built from the economy, so they aren't here.

let docsSaved = null, docsDraft = null, docsPage = 'introduction';
const docsDirty = () => docsSaved && docsDraft && JSON.stringify(docsSaved) !== JSON.stringify(docsDraft);
const MD_HELP = 'Markdown: ## Heading, **bold**, *italic*, - list, 1. list, > tip box, [link](https://…), ![picture](https://…). A blank line starts a new paragraph.';

async function renderDocs() {
  if (!docsDraft) {
    const r = await api('GET', '/admin/docs');
    docsSaved = r.docs; docsDraft = clone(r.docs);
  }
  const d = docsDraft;
  const page = DOCS_PAGES.find(p => p.id === docsPage) || DOCS_PAGES[0];
  const e = d.pages[page.id] || {};
  const field = (label, html, hint = '') => `<div class="field"><label>${label}</label>${html}${hint ? `<div class="note">${hint}</div>` : ''}</div>`;
  const text = (path, value, ph = '', max = DOCS_LIMITS.field) => `<input type="text" data-doc="${path}" value="${esc(value ?? '')}" placeholder="${esc(ph)}" maxlength="${max}">`;
  const area = (path, value, rows = 6, ph = '') => `<textarea data-doc="${path}" rows="${rows}" maxlength="${DOCS_LIMITS.text}" placeholder="${esc(ph)}">${esc(value ?? '')}</textarea>`;
  view.innerHTML = `
    <div class="section-head"><div><h2>Docs</h2><div class="muted">Edit the text on <a href="/docs" target="_blank" rel="noopener">hopifarms.fun/docs</a>. Prices, odds and other number tables update from Pricing on their own.</div></div>
      <div class="row">
        <button class="btn" data-docs="revert">Discard changes</button>
        <button class="btn primary" data-docs="save">Save &amp; publish</button>
      </div></div>
    <div class="grid docs-editor">
      <div class="card"><h3>Leaderboard prizes</h3>
        ${d.prizes.map((p, i) => `<div class="prize-row">
          ${field('Prize', text(`prizes.${i}.name`, p.name, 'e.g. 2023 Paldea Evolved Baxcalibur #210'))}
          ${field('Details', text(`prizes.${i}.detail`, p.detail, 'e.g. Illustration Rare · PSA 10'))}
          ${field('Value', text(`prizes.${i}.value`, p.value, 'e.g. Fair market value: $349'))}
          ${field('Picture link (optional)', text(`prizes.${i}.image`, p.image, 'https://…'))}
          <button class="btn danger small" data-docs="del-prize" data-i="${i}">Remove</button>
        </div>`).join('') || '<p class="muted">No prizes. The docs will say prizes are coming soon.</p>'}
        <div class="row"><button class="btn" data-docs="add-prize">Add prize</button></div>
        ${field('Note under the prizes', `<textarea data-doc="prizeNote" rows="2" maxlength="${DOCS_LIMITS.lead}">${esc(d.prizeNote)}</textarea>`)}
      </div>
      <div class="card"><h3>Edit a page</h3>
        ${field('Page', `<select data-docs-page>${DOCS_GROUPS.map(g => `<optgroup label="${g}">${DOCS_PAGES.filter(p => p.group === g).map(p => `<option value="${p.id}" ${p.id === page.id ? 'selected' : ''}>${esc(p.title)}${d.pages[p.id] && Object.values(d.pages[p.id]).some(Boolean) ? ' (edited)' : ''}</option>`).join('')}</optgroup>`).join('')}</select>`)}
        ${field('Title', text(`pages.${page.id}.title`, e.title, page.title, DOCS_LIMITS.title), 'Leave blank to keep the built-in title.')}
        ${field('Intro line', `<textarea data-doc="pages.${page.id}.lead" rows="2" maxlength="${DOCS_LIMITS.lead}" placeholder="Leave blank to keep the built-in intro.">${esc(e.lead ?? '')}</textarea>`)}
        ${page.id === 'introduction' ? '' : `<label class="check"><input type="checkbox" data-doc="pages.${page.id}.hidden" ${e.hidden ? 'checked' : ''}> Hide this page</label>`}
        ${field('Extra text at the bottom of the page', area(`pages.${page.id}.extra`, e.extra, 8), MD_HELP)}
        <div class="row"><a class="btn" href="/docs#${page.id}" target="_blank" rel="noopener">View page</a></div>
      </div>
      <div class="card wide"><h3>Your own pages</h3>
        ${d.custom.map((c, i) => `<div class="custom-page">
          <div class="form-grid">
            ${field('Title', text(`custom.${i}.title`, c.title, '', DOCS_LIMITS.title))}
            ${field('Section', `<select data-doc="custom.${i}.group">${DOCS_GROUPS.map(g => `<option ${g === c.group ? 'selected' : ''}>${g}</option>`).join('')}</select>`)}
          </div>
          ${field('Text', area(`custom.${i}.body`, c.body, 10), MD_HELP)}
          <div class="row"><a class="btn" href="/docs#${c.id}" target="_blank" rel="noopener">View page</a><button class="btn danger small" data-docs="del-page" data-i="${i}">Delete page</button></div>
        </div>`).join('') || '<p class="muted">No extra pages yet.</p>'}
        <div class="row"><button class="btn" data-docs="add-page">Add page</button></div>
      </div>
    </div>`;
}

function setDoc(path, value) {
  const keys = path.split('.');
  let o = docsDraft;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  const last = keys[keys.length - 1];
  if (value === '' || value === false) {
    delete o[last];
    // Drop page edits that are now empty, so the draft matches what's saved.
    if (keys[0] === 'pages' && !Object.keys(o).length) delete docsDraft.pages[keys[1]];
  } else o[last] = value;
}

async function docsAction(kind, el) {
  const d = docsDraft;
  if (kind === 'add-prize') d.prizes.push({ name: '', detail: '', value: '', image: '' });
  else if (kind === 'del-prize') d.prizes.splice(Number(el.dataset.i), 1);
  else if (kind === 'add-page') {
    const title = prompt('Title for the new page:', '');
    if (!title?.trim()) return;
    let id = `x-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'page'}`;
    while (d.custom.some(c => c.id === id)) id += '-2';
    d.custom.push({ id, group: 'Help', title: title.trim().slice(0, DOCS_LIMITS.title), body: '' });
  } else if (kind === 'del-page') {
    if (!confirm(`Delete the page "${d.custom[Number(el.dataset.i)].title}"? It goes away when you save.`)) return;
    d.custom.splice(Number(el.dataset.i), 1);
  } else if (kind === 'revert') {
    if (docsDirty() && !confirm('Discard your docs changes?')) return;
    docsDraft = clone(docsSaved);
  } else if (kind === 'save') {
    const errors = validateDocs(d);
    if (errors.length) return toast(errors.join(' '), true);
    const r = await api('POST', '/admin/docs', { docs: d });
    docsSaved = r.docs; docsDraft = clone(r.docs);
    toast('Docs saved. They are live now.');
  }
  await renderDocs();
}

const RENDER = { overview: renderOverview, economy: renderEconomy, pricing: renderPricing, players: renderPlayers, deposits: renderDeposits, withdrawals: renderWithdrawals, leaders: renderLeaders, docs: renderDocs, events: renderEvents, log: renderLog };

async function run(fn) {
  try { await fn(); } catch (e) { showError(e); }
}

function setTab(name) {
  if (tab === 'pricing' && name !== 'pricing' && draft && countChanges(saved, draft) && !confirm('You have unsaved pricing changes. Leave without saving?')) return;
  if (tab === 'docs' && name !== 'docs' && docsDirty() && !confirm('You have unsaved docs changes. Leave without saving?')) return;
  if (name !== 'pricing') draft = null;
  if (name !== 'docs') docsDraft = null;
  tab = name;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  view.innerHTML = '<p class="muted">Loading…</p>';
  run(RENDER[name]);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('#tabs button');
  if (t) return setTab(t.dataset.tab);
  if (e.target.closest('[data-refresh]')) return run(RENDER[tab]);
  if (e.target.closest('[data-dep="scan"]')) {
    return run(async () => {
      const r = await api('POST', '/admin/deposits/scan');
      toast(r.found ? `Found ${r.found} new deposit${r.found === 1 ? '' : 's'}.` : 'No new deposits.');
      await renderDeposits();
    });
  }
  const ev = e.target.closest('[data-ev]');
  if (ev) return run(() => eventAction(ev.dataset.ev, Number(ev.dataset.id)));
  const da = e.target.closest('[data-docs]');
  if (da) return run(() => docsAction(da.dataset.docs, da));
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
  const wp = e.target.closest('[data-wd-player]');
  if (wp) return run(() => renderWdPlayer(Number(wp.dataset.wdPlayer)));
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Wallet address copied.'), () => toast('Copy failed.', true));
    return;
  }
  const dec = e.target.closest('[data-wd-decline]');
  if (dec) {
    const reason = prompt(`Decline ${dec.dataset.user}'s request for ${fmt(Number(dec.dataset.amount))} $CROP? They get it back in their balance. Reason (shown to the player):`, '');
    if (reason === null) return;
    return run(async () => {
      await api('POST', '/admin/withdrawals/decline', { id: Number(dec.dataset.wdDecline), reason });
      toast('Declined and refunded.');
      await renderWithdrawals();
    });
  }
  if (e.target.closest('[data-signout]')) {
    api('POST', '/logout').catch(() => {});
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
    renderSignIn();
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target.closest('#ev-form');
  if (!f) return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(f));
  const int = (v) => (v === undefined || v === '' ? undefined : Number(v));
  const body = {
    kind: d.kind, title: d.title, description: d.description, image: d.image,
    startsAt: d.startsAt ? new Date(d.startsAt).getTime() : undefined, endsAt: new Date(d.endsAt).getTime(),
    startBid: int(d.startBid), minStep: int(d.minStep), ticketPrice: int(d.ticketPrice), maxTickets: int(d.maxTickets), winnersCount: int(d.winnersCount),
  };
  if (!confirm(`Start this ${body.kind} for "${body.title}"? Players can join as soon as it starts.`)) return;
  run(async () => { await api('POST', '/admin/events', body); toast(`${body.kind === 'auction' ? 'Auction' : 'Lottery'} started.`); await renderEvents(); });
});

addEventListener('beforeunload', (e) => {
  if (tab === 'pricing' && draft && saved && countChanges(saved, draft)) e.preventDefault();
  if (tab === 'docs' && docsDirty()) e.preventDefault();
});

async function boot() {
  if (!token()) return renderSignIn();
  try {
    const me = await api('GET', '/admin/me');
    $('#tabs').hidden = false;
    $('#who').innerHTML = `Signed in as <b>${esc(me.username)}</b> <button class="btn" data-signout>Sign out</button>`;
    setTab(tab);
    api('GET', '/admin/withdrawals').then(d => setWithdrawCount(d.requests.filter(r => r.status === 'pending').length)).catch(() => {});
  } catch (e) {
    showError(e);
  }
}

boot();
