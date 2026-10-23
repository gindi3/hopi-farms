// The Hopi Farms docs (/docs): one page per topic, picked by the URL hash. Every number is
// read from the game's own rules, and from the server's live economy when there is one, so
// the docs stay right when prices or odds change from the admin dashboard.

import {
  GAME_NAME, RARITIES, RARITY, TIERS, TIER, CROPS, HARVEST_GEMS, ECON, MAX_LEVEL, MAX_FARMS,
  LEVEL_COSTS, BASE_PLOTS, MAX_PLOTS, STARTER, CHESTS, ITEMS, RECIPES, BREW_ODDS_BY,
} from './data.js';
import * as G from './game.js';
import { applyEconomy } from './economy.js';
import { spriteImg } from './sprites.js';
import { DOCS_GROUPS, DOCS_PAGES, withDocDefaults, pageText, renderMarkdown, renderInline } from './docs-content.js';

const API = (window.HOPI_API || '').replace(/\/$/, '');
let crop = null;   // { enabled, mint, treasury } from the server
let docs = withDocDefaults(null);   // admin-edited text (see docs-content.js)

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: d });
const pct = (x, d = 2) => `${(x * 100).toFixed(d).replace(/\.?0+$/, '')}%`;
const icon = (key, size = 24) => spriteImg(key, size);
const cropIcon = (c, size = 24) => spriteImg(`crop:${c.id}`, size, '', c.name);
const rarityTag = (r) => `<span class="tag r-${r}">${RARITY[r].label}</span>`;
const hours = (h) => (h === 1 ? '1 hour' : `${h} hours`);
const totalLevelCost = () => LEVEL_COSTS.reduce((a, b) => a + b, 0);

const table = (head, rows, cls = '') => `
  <div class="table-wrap"><table class="${cls}">
    <thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
const hint = (text, kind = 'info') => `<div class="hint ${kind}">${text}</div>`;

// --- Placeholders ---------------------------------------------------------------
// What {{name}} turns into in the page text (see DOCS_TOKENS in docs-content.js). Computed when
// a page renders, from the live economy, so the numbers are always current.

const plural = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
const INLINE = {
  starterCrop: () => fmt(STARTER.coins),
  starterSeeds: () => fmt(Object.values(STARTER.seeds).reduce((a, b) => a + b, 0)),
  basePlots: () => fmt(BASE_PLOTS), maxPlots: () => fmt(MAX_PLOTS), maxFarms: () => fmt(MAX_FARMS),
  farmCost: () => fmt(ECON.farmCost), maxLevel: () => fmt(MAX_LEVEL), levelTotal: () => fmt(totalLevelCost()),
  baseRtp: () => pct(ECON.baseRtp), maxRtp: () => pct(G.rtp(MAX_LEVEL)), levelBonus: () => pct(ECON.harvestBonusPerLevel),
  firstHarvestGems: () => fmt(ECON.firstHarvestGems), skipCost: () => plural(ECON.skipGemsPerHour, 'gem'),
  cropCount: () => fmt(CROPS.length), tierCount: () => fmt(TIERS.length),
  commonMult: () => fmt(RARITY.common.mult), legendaryMult: () => fmt(RARITY.legendary.mult),
  harvestXp: () => TIERS.map(t => `${TIER[t].label} ${TIER[t].xpHarvest}`).join(', '),
};

const BLOCK = {
  nextCards: () => `<div class="cards">${['game-loop', 'seed-packs', 'leaderboard', 'crop-token'].filter(id => PAGE[id])
    .map(id => `<a class="card" href="#${id}">${icon(PAGE[id].icon, 32)}<span>${esc(PAGE[id].title)}</span></a>`).join('')}</div>`,
  officialLinks: () => table(['', 'Link'], [
    ['Game', '<a href="/">hopifarms.fun</a>'],
    ['Docs', '<a href="#introduction">hopifarms.fun/docs</a>'],
    ['$CROP contract', crop?.mint ? `<code class="addr">${esc(crop.mint)}</code>` : '<span class="muted">Shown here once deposits are on</span>'],
    ['$CROP on pump.fun', crop?.mint ? `<a href="https://pump.fun/coin/${esc(crop.mint)}" target="_blank" rel="noopener noreferrer">pump.fun/coin/${esc(crop.mint.slice(0, 6))}…</a>` : '<span class="muted">Coming soon</span>'],
    ['Game wallet (deposits)', crop?.treasury ? `<code class="addr">${esc(crop.treasury)}</code>` : '<span class="muted">Coming soon</span>'],
  ]),
  spendTable: () => table(['Spend on', 'Cost'], [
    [`${icon('pack_feeble', 20)} Seed packs`, TIERS.map(t => `${TIER[t].label} ${fmt(TIER[t].cost)}`).join(' · ')],
    [`${icon('chest_gold', 20)} Valley levels`, `${fmt(LEVEL_COSTS[0])} to ${fmt(LEVEL_COSTS[LEVEL_COSTS.length - 1])} each, ${fmt(totalLevelCost())} for all ${MAX_LEVEL}`],
    [`${icon('bush', 20)} New farms`, `${fmt(ECON.farmCost)} each`],
  ]),
  packTiers: () => table(['Pack', 'Cost', 'XP to open', 'XP on harvest'], TIERS.map(t => [
    `${icon(`pack_${t}`, 24)} ${TIER[t].label}`, `${fmt(TIER[t].cost)} $CROP`, fmt(TIER[t].xpOpen), fmt(TIER[t].xpHarvest),
  ])),
  rarityOdds: () => table(['Rarity', 'Chance', 'Grow time', 'Payout'], RARITIES.map(r => [
    rarityTag(r), pct(RARITY[r].chance), hours(RARITY[r].hours), `${fmt(RARITY[r].mult)}× the pack cost`,
  ])),
  cropTables: () => TIERS.map(t => `
    <h2 id="tier-${t}">${icon(`pack_${t}`, 28)} ${TIER[t].label} crops</h2>
    ${table(['Crop', 'Rarity', 'Grows in', 'Pays (Lv 0)', `Pays (Lv ${MAX_LEVEL})`, 'Gems'],
      CROPS.filter(c => c.tier === t).map(c => [
        `<span class="crop">${cropIcon(c)} ${esc(c.name)}</span>`, rarityTag(c.rarity), hours(RARITY[c.rarity].hours),
        `${fmt(G.cropPayout(c.id, 0))} $CROP`, `${fmt(G.cropPayout(c.id, MAX_LEVEL))} $CROP`,
        HARVEST_GEMS[c.rarity]?.[t] ? `${icon('gem', 16)} ${HARVEST_GEMS[c.rarity][t]}` : '<span class="muted">–</span>',
      ]))}`).join(''),
  gemSources: () => table(['Source', 'Gems'], [
    ['Harvest an Epic crop', TIERS.map(t => `${TIER[t].label} ${HARVEST_GEMS.epic[t]}`).join(' · ')],
    ['Harvest a Legendary crop', TIERS.map(t => `${TIER[t].label} ${HARVEST_GEMS.legendary[t]}`).join(' · ')],
    ['First harvest of each crop', `+${ECON.firstHarvestGems}`],
    ['Level up your valley', `${ECON.levelUpGemsPerLevel} × the new level (Lv 1 = ${ECON.levelUpGemsPerLevel}, Lv ${MAX_LEVEL} = ${ECON.levelUpGemsPerLevel * MAX_LEVEL})`],
    ['Daily chest', CHESTS.map(c => `${c.label} ${c.gems[0]}–${c.gems[1]}`).join(' · ')],
  ]),
  levelTable: () => table(['Level', 'Cost', 'Total spent', 'Plots', 'RTP', 'Gems on reaching it', 'Chest'],
    Array.from({ length: MAX_LEVEL + 1 }, (_, lv) => {
      const spent = LEVEL_COSTS.slice(0, lv).reduce((a, b) => a + b, 0);
      return [lv, lv ? `${fmt(LEVEL_COSTS[lv - 1])} $CROP` : '<span class="muted">start</span>', fmt(spent), G.plotCount(lv), pct(G.rtp(lv)),
        lv ? `${icon('gem', 16)} ${ECON.levelUpGemsPerLevel * lv}` : '<span class="muted">–</span>', `${icon(`chest_${G.chestFor(lv).id}`, 20)} ${G.chestFor(lv).label}`];
    }), 'compact'),
  chestTable: () => table(['Chest', 'From level', 'Gems', 'Produce from'], CHESTS.map(c => [
    `${icon(`chest_${c.id}`, 24)} ${c.label}`, c.minLevel, `${c.gems[0]}–${c.gems[1]}`, TIER[c.produceTier].label,
  ])),
  chestLoot: () => {
    const kinds = [...new Set(CHESTS.flatMap(c => c.loot.map(([k]) => k)))];
    const label = (k) => k === 'produce' ? '1 random produce'
      : k.startsWith('seed:') ? `${icon(`pack_${k.slice(5)}`, 18)} ${TIER[k.slice(5)].label} seed pack`
      : `${icon(k, 18)} ${ITEMS[k].name}`;
    return table(['Item', ...CHESTS.map(c => `${icon(`chest_${c.id}`, 20)} ${c.label}`)], kinds.map(k => [
      label(k), ...CHESTS.map(c => { const e = c.loot.find(([x]) => x === k); return e ? pct(e[1], 1) : '<span class="muted">–</span>'; }),
    ]), 'compact');
  },
  potionEffects: () => table(['Potion', 'Lesser', 'Standard', 'Advanced'], ['elixir', 'pesticide', 'fertilizer'].map(k => [
    `${icon(k, 22)} ${RECIPES[k].name}`, ...[1, 2, 3].map(g => ITEMS[g === 1 ? k : `${k}${g}`].desc),
  ])),
  recipes: () => table(['Potion', 'Recipe', 'Brew', 'Brewing XP'], Object.entries(RECIPES).flatMap(([k, r]) => r.options.map((o, i) => [
    i ? '' : `${icon(k, 22)} ${r.name}`,
    `${o.count} × ${[].concat(o.rarity).map(x => RARITY[x].label).join(' or ')} ${TIER[o.tier].label} produce`,
    BREW_ODDS_BY[o.odds || 'standard'].name, i ? '' : fmt(r.xp),
  ]))),
  brewOdds: () => table(['Brew', 'Disaster', 'Lesser', 'Standard', 'Advanced'], Object.values(BREW_ODDS_BY).map(b => [
    b.name, ...[0, 1, 2, 3].map(g => pct(b.odds.find(o => o.grade === g)?.chance || 0, 1)),
  ])),
  xpTable: () => table(['Action', 'XP'], [
    ['Open a seed pack', TIERS.map(t => `${TIER[t].label} ${TIER[t].xpOpen}`).join(' · ')],
    ['Harvest a crop', TIERS.map(t => `${TIER[t].label} ${TIER[t].xpHarvest}`).join(' · ')],
    ['Brew a potion', Object.values(RECIPES).map(r => `${r.name} ${fmt(r.xp)}`).join(' · ')],
  ]),
  prizes: () => `${docs.prizes.length ? `<p>Top farmers win real prizes, like ${docs.prizes.length === 1 ? 'this one' : 'these'}:</p>
    ${docs.prizes.map(p => `
    <div class="prize">
      <div class="prize-art" aria-hidden="true">${p.image ? `<img src="${esc(p.image)}" alt="">` : icon('chest_gold', 48)}</div>
      <div>
        <b>${esc(p.name)}</b>
        ${p.detail ? `<p>${esc(p.detail)}</p>` : ''}
        ${p.value ? `<p class="value">${esc(p.value)}</p>` : ''}
      </div>
    </div>`).join('')}` : '<p>Prizes for top farmers will be announced soon.</p>'}
    ${docs.prizeNote ? hint(esc(docs.prizeNote)) : ''}`,
  gameWallet: () => (crop?.treasury ? `<p>Game wallet: <code class="addr">${esc(crop.treasury)}</code></p>` : ''),
};

// Unknown names return null, so a typo shows up as typed instead of vanishing.
const token = (name, block) => (block ? BLOCK[name]?.() : INLINE[name]?.() ?? BLOCK[name]?.()) ?? null;

// The built-in pages with the admin's edits applied, plus the admin's own pages, in section order.
let PAGES = [], PAGE = {};
function buildPages() {
  const edited = DOCS_PAGES.map(p => pageText(p.id, docs));
  const custom = docs.custom.map(c => ({ id: c.id, group: c.group, title: c.title, icon: 'flowerpot', lead: '', body: c.body }));
  const all = [...edited, ...custom].filter(p => !p.hidden);
  PAGES = DOCS_GROUPS.flatMap(g => all.filter(p => p.group === g));
  PAGE = Object.fromEntries(PAGES.map(p => [p.id, p]));
}
buildPages();

// --- Layout ------------------------------------------------------------------

function renderSidebar(current) {
  const groups = [...new Set(PAGES.map(p => p.group))];
  $('#sidebar').innerHTML = groups.map(g => `
    <div class="group"><h4>${g}</h4>
      ${PAGES.filter(p => p.group === g).map(p => `<a href="#${p.id}" class="${p.id === current ? 'active' : ''}"${p.id === current ? ' aria-current="page"' : ''}>${icon(p.icon, 20)}<span>${esc(p.title)}</span></a>`).join('')}
    </div>`).join('');
}

function render() {
  const id = PAGE[location.hash.slice(1)] ? location.hash.slice(1) : 'introduction';
  const page = PAGE[id];
  const i = PAGES.indexOf(page);
  const prev = PAGES[i - 1], next = PAGES[i + 1];
  document.title = `${page.title} | ${GAME_NAME} Docs`;
  renderSidebar(id);
  $('#content').innerHTML = `
    <p class="crumb">${page.group}</p>
    <h1>${icon(page.icon, 40)} ${esc(page.title)}</h1>
    ${page.lead ? `<p class="lead">${renderInline(page.lead, token)}</p>` : ''}
    ${renderMarkdown(page.body, token)}
    <nav class="pager">
      ${prev ? `<a class="prev" href="#${prev.id}"><small>Previous</small>${esc(prev.title)}</a>` : '<span></span>'}
      ${next ? `<a class="next" href="#${next.id}"><small>Next</small>${esc(next.title)}</a>` : '<span></span>'}
    </nav>`;
  const heads = [...$('#content').querySelectorAll('h2[id]')];
  $('#toc').innerHTML = heads.length > 1 ? `<h4>On this page</h4>${heads.map(h => `<a href="#${id}" data-to="${h.id}">${h.textContent.trim()}</a>`).join('')}` : '';
  setMenu(false);
  window.scrollTo(0, 0);
}

function setMenu(open) {
  document.body.classList.toggle('menu-open', open);
  $('#menu').setAttribute('aria-expanded', String(open));
}

$('#menu').addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
// "On this page" links scroll within the page instead of changing the hash.
$('#toc').addEventListener('click', (e) => {
  const a = e.target.closest('[data-to]');
  if (!a) return;
  e.preventDefault();
  document.getElementById(a.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
window.addEventListener('hashchange', render);

// Use the live economy when the docs are served by the game server.
async function boot() {
  if (API) {
    const get = (path) => fetch(`${API}${path}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [econ, text] = await Promise.all([get('/economy'), get('/docs')]);
    if (econ) {
      applyEconomy(econ.economy);
      crop = econ.crop?.enabled ? econ.crop : null;
    }
    if (text) docs = withDocDefaults(text.docs);
  }
  buildPages();
  render();
}
boot();
