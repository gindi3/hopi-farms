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
import { DOCS_GROUPS, withDocDefaults, renderMarkdown } from './docs-content.js';

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
const link = (id, text) => `<a href="#${id}">${text}</a>`;

// --- Pages -------------------------------------------------------------------

const BUILT_IN = [
  { group: 'Getting Started', id: 'introduction', title: 'Introduction', icon: 'farmer', render: () => `
    <p class="lead">${GAME_NAME} is a pixel-art farming game on Solana. Open seed packs, grow crops on your farm and harvest them for $CROP.</p>
    <h2 id="what">What is ${GAME_NAME}?</h2>
    <p>You run a little valley. Seed packs from the Market hold a random crop. Plant it, wait for it to grow, then harvest it for $CROP. Rarer crops pay more and some also pay gems.</p>
    <p>Level up your valley to open more plots and raise every harvest's payout. Each day you get a free treasure chest. Brew potions from your produce to grow faster and harvest more.</p>
    <h2 id="start">Getting started</h2>
    <ol>
      <li>Open <a href="/">hopifarms.fun</a> and create an account, or look around as a guest first.</li>
      <li>Every new farm starts with <b>${fmt(STARTER.coins)} $CROP</b> and ${Object.values(STARTER.seeds).reduce((a, b) => a + b, 0)} Feeble seeds. Plant them from the welcome screen.</li>
      <li>Come back when they're grown and harvest. Then spin some seed packs at the Market.</li>
    </ol>
    ${hint(`Playing as a guest? Your farm lives in that browser only. Create an account from your profile to keep it and play on any device. You need an account to deposit or withdraw $CROP.`)}
    <h2 id="read-next">Where to next</h2>
    <div class="cards">
      ${['game-loop', 'seed-packs', 'leaderboard', 'crop-token'].filter(id => PAGE[id]).map(id => { const p = PAGE[id]; return `<a class="card" href="#${id}">${icon(p.icon, 32)}<span>${p.title}</span></a>`; }).join('')}
    </div>` },

  { group: 'Getting Started', id: 'game-loop', title: 'Game Loop', icon: 'stage:3', render: () => `
    <p class="lead">The whole game in one loop: buy seeds, grow, harvest, grow your valley.</p>
    <div class="loop">
      ${[['pack_basic', 'Buy seed packs', 'Spend $CROP at the Market. Each pack rolls one random crop.'],
         ['stage:1', 'Plant', `Put seeds in your empty plots. You start with ${BASE_PLOTS} plots.`],
         ['stage:3', 'Grow', 'Crops take 3 to 24 hours depending on rarity. Gems or a Growth Elixir speed them up.'],
         ['coin', 'Harvest', 'Get $CROP, XP, produce and sometimes gems.'],
         ['chest_wooden', 'Level up', 'Spend $CROP in the House for more plots, higher payouts and better chests.']]
        .map(([k, t, d], i) => `<div class="step"><span class="num">${i + 1}</span>${icon(k, 40)}<div><b>${t}</b><p>${d}</p></div></div>`).join('')}
    </div>
    <h2 id="side">On the side</h2>
    <ul>
      <li><b>Daily chest:</b> one free chest per farm each UTC day. See ${link('chests', 'Treasure Chests')}.</li>
      <li><b>Potions:</b> turn produce into Growth Elixirs, Pesticide and Fertilizer. See ${link('potions', 'Potions Master')}.</li>
      <li><b>More farms:</b> open up to ${MAX_FARMS} farms on one account. See ${link('farms', 'Farms')}.</li>
      <li><b>Leaderboard:</b> ranked by XP, with real prizes for top farmers. See ${link('leaderboard', 'Leaderboard &amp; Prizes')}.</li>
    </ul>` },

  { group: 'Getting Started', id: 'official-links', title: 'Official Links', icon: 'flowerpot', render: () => `
    <p class="lead">Only trust these links. The team will never DM you first or ask for your seed phrase.</p>
    ${table(['', 'Link'], [
      ['Game', '<a href="/">hopifarms.fun</a>'],
      ['Docs', '<a href="#introduction">hopifarms.fun/docs</a>'],
      ['$CROP contract', crop?.mint ? `<code class="addr">${esc(crop.mint)}</code>` : '<span class="muted">Shown here once deposits are on</span>'],
      ['$CROP on pump.fun', crop?.mint ? `<a href="https://pump.fun/coin/${esc(crop.mint)}" target="_blank" rel="noopener noreferrer">pump.fun/coin/${esc(crop.mint.slice(0, 6))}…</a>` : '<span class="muted">Coming soon</span>'],
      ['Game wallet (deposits)', crop?.treasury ? `<code class="addr">${esc(crop.treasury)}</code>` : '<span class="muted">Coming soon</span>'],
    ])}
    ${hint('Always check the contract address matches before you buy or send $CROP.', 'warn')}` },

  { group: 'The Game', id: 'crop-token', title: '$CROP', icon: 'coin', render: () => `
    <p class="lead">$CROP is the main currency of ${GAME_NAME}: a Solana token, and the balance you spend and earn in the game.</p>
    <h2 id="uses">What you use it for</h2>
    ${table(['Spend on', 'Cost'], [
      [`${icon('pack_feeble', 20)} Seed packs`, TIERS.map(t => `${TIER[t].label} ${fmt(TIER[t].cost)}`).join(' · ')],
      [`${icon('chest_gold', 20)} Valley levels`, `${fmt(LEVEL_COSTS[0])} to ${fmt(LEVEL_COSTS[LEVEL_COSTS.length - 1])} each, ${fmt(totalLevelCost())} for all ${MAX_LEVEL}`],
      [`${icon('bush', 20)} New farms`, `${fmt(ECON.farmCost)} each`],
    ])}
    <h2 id="earn">How you earn it</h2>
    <ul>
      <li>Harvesting crops. See ${link('crops', 'Crops & Rarities')} for every payout.</li>
      <li>The ${fmt(STARTER.coins)} $CROP every new farm starts with.</li>
      <li>Depositing $CROP from your Solana wallet: <b>1 $CROP in = 1 $CROP in the game</b>. See ${link('deposits', 'Deposits')}.</li>
    </ul>
    <h2 id="out">Taking it out</h2>
    <p>You can ask for $CROP to be sent back to your linked wallet once a day. See ${link('withdrawals', 'Withdrawals')}.</p>
    ${hint('$CROP is a game currency, not an investment. Only deposit what you are happy to play with.', 'warn')}` },

  { group: 'The Game', id: 'seed-packs', title: 'Seed Packs', icon: 'pack_basic', render: () => `
    <p class="lead">Every crop starts as a seed pack from the Market. Each pack rolls one random crop of its tier.</p>
    <h2 id="tiers">Pack tiers</h2>
    ${table(['Pack', 'Cost', 'XP to open', 'XP on harvest'], TIERS.map(t => [
      `${icon(`pack_${t}`, 24)} ${TIER[t].label}`, `${fmt(TIER[t].cost)} $CROP`, fmt(TIER[t].xpOpen), fmt(TIER[t].xpHarvest),
    ]))}
    <p>Buy 1, 3, or any number up to 9 at once. Bigger packs cost more but pay more, so every tier has the same return. See ${link('levels', 'Levels & RTP')}.</p>
    <h2 id="odds">Drop rates</h2>
    <p>The odds are the same for every tier. First the pack rolls a rarity, then it picks one crop of that rarity at random.</p>
    ${table(['Rarity', 'Chance', 'Grow time', 'Payout'], RARITIES.map(r => [
      rarityTag(r), pct(RARITY[r].chance), hours(RARITY[r].hours), `${fmt(RARITY[r].mult)}× the pack cost`,
    ]))}
    ${hint('Every pull is rolled on the server with a secure random number generator. Nothing is staged: the spinning reel is only for show, and the result was decided when you bought the pack.')}` },

  { group: 'The Game', id: 'crops', title: 'Crops & Rarities', icon: 'crop:grapes', render: () => `
    <p class="lead">There are ${CROPS.length} crops across ${TIERS.length} tiers. What a crop pays depends on its tier, its rarity and your valley level.</p>
    <p>Payouts below are for level 0 and the max level, ${MAX_LEVEL}. Each level adds ${pct(ECON.harvestBonusPerLevel)} to every harvest.</p>
    ${TIERS.map(t => `
      <h2 id="tier-${t}">${icon(`pack_${t}`, 28)} ${TIER[t].label} crops</h2>
      ${table(['Crop', 'Rarity', 'Grows in', `Pays (Lv 0)`, `Pays (Lv ${MAX_LEVEL})`, 'Gems'],
        CROPS.filter(c => c.tier === t).map(c => [
          `<span class="crop">${cropIcon(c)} ${esc(c.name)}</span>`, rarityTag(c.rarity), hours(RARITY[c.rarity].hours),
          `${fmt(G.cropPayout(c.id, 0))} $CROP`, `${fmt(G.cropPayout(c.id, MAX_LEVEL))} $CROP`,
          HARVEST_GEMS[c.rarity]?.[t] ? `${icon('gem', 16)} ${HARVEST_GEMS[c.rarity][t]}` : '<span class="muted">–</span>',
        ]))}`).join('')}
    ${hint(`The first time you harvest each crop you also get <b>+${ECON.firstHarvestGems} gems</b>. Collect all ${CROPS.length}!`)}` },

  { group: 'The Game', id: 'farming', title: 'Planting & Harvesting', icon: 'stage:2', render: () => `
    <p class="lead">Plant seeds in empty plots, wait, then harvest.</p>
    <h2 id="plant">Planting</h2>
    <ul>
      <li>Tap an empty plot to plant, or use <b>Plant all</b> to fill every empty plot with your best seeds first.</li>
      <li>A farm has ${BASE_PLOTS} plots to start, and each valley level opens one more, up to ${MAX_PLOTS}.</li>
    </ul>
    <h2 id="harvest">Harvesting</h2>
    <p>A grown crop gives you:</p>
    <ul>
      <li><b>$CROP</b>: see ${link('crops', 'Crops & Rarities')}.</li>
      <li><b>XP</b>: by pack tier, ${TIERS.map(t => `${TIER[t].label} ${TIER[t].xpHarvest}`).join(', ')}.</li>
      <li><b>1 produce</b>, kept in your Backpack for brewing potions.</li>
      <li><b>Gems</b> from Epic and Legendary crops, and from your first harvest of each crop.</li>
    </ul>
    <p><b>Harvest all</b> collects every grown crop on all of your farms at once.</p>
    <h2 id="finish">Finish now</h2>
    <p>Don't want to wait? Spend <b>${fmt(ECON.skipGemsPerHour)} gem${ECON.skipGemsPerHour === 1 ? '' : 's'} per hour left</b> (rounded up) to finish a crop right away. A Growth Elixir also cuts hours off. See ${link('potions', 'Potions Master')}.</p>` },

  { group: 'The Game', id: 'gems', title: 'Gems', icon: 'gem', render: () => `
    <p class="lead">Gems are the earn-only currency. They can't be bought, sold or withdrawn.</p>
    <h2 id="earn">How to earn gems</h2>
    ${table(['Source', 'Gems'], [
      ['Harvest an Epic crop', TIERS.map(t => `${TIER[t].label} ${HARVEST_GEMS.epic[t]}`).join(' · ')],
      ['Harvest a Legendary crop', TIERS.map(t => `${TIER[t].label} ${HARVEST_GEMS.legendary[t]}`).join(' · ')],
      ['First harvest of each crop', `+${ECON.firstHarvestGems}`],
      ['Level up your valley', `${ECON.levelUpGemsPerLevel} × the new level (Lv 1 = ${ECON.levelUpGemsPerLevel}, Lv ${MAX_LEVEL} = ${ECON.levelUpGemsPerLevel * MAX_LEVEL})`],
      ['Daily chest', CHESTS.map(c => `${c.label} ${c.gems[0]}–${c.gems[1]}`).join(' · ')],
    ])}
    <h2 id="spend">How to spend gems</h2>
    <p>Use gems to <b>Finish now</b> on a growing crop: ${fmt(ECON.skipGemsPerHour)} gem${ECON.skipGemsPerHour === 1 ? '' : 's'} per hour left.</p>
    ${hint('Gems have no cash value and stay in the game.', 'warn')}` },

  { group: 'The Game', id: 'levels', title: 'Levels & RTP', icon: 'xp', render: () => `
    <p class="lead">Level up your valley in the House. Every level opens one more plot and raises every harvest's payout.</p>
    <h2 id="rtp">What is RTP?</h2>
    <p>RTP (return to player) is the average share of a pack's cost that comes back as $CROP when you harvest it, over many packs. At level 0 it's <b>${pct(ECON.baseRtp)}</b>. Each level adds ${pct(ECON.harvestBonusPerLevel)} to every payout, up to <b>${pct(G.rtp(MAX_LEVEL))}</b> at level ${MAX_LEVEL}.</p>
    <p>RTP is an average. Any one pack can pay a lot less (a Common pays ${fmt(RARITY.common.mult)}×) or a lot more (a Legendary pays ${fmt(RARITY.legendary.mult)}×).</p>
    <h2 id="table">Level table</h2>
    ${table(['Level', 'Cost', 'Total spent', 'Plots', 'RTP', 'Gems on reaching it', 'Chest'],
      Array.from({ length: MAX_LEVEL + 1 }, (_, lv) => {
        const spent = LEVEL_COSTS.slice(0, lv).reduce((a, b) => a + b, 0);
        return [lv, lv ? `${fmt(LEVEL_COSTS[lv - 1])} $CROP` : '<span class="muted">start</span>', fmt(spent), G.plotCount(lv), pct(G.rtp(lv)),
          lv ? `${icon('gem', 16)} ${ECON.levelUpGemsPerLevel * lv}` : '<span class="muted">–</span>', `${icon(`chest_${G.chestFor(lv).id}`, 20)} ${G.chestFor(lv).label}`];
      }), 'compact')}
    ${hint(`Levelling up also refreshes your daily chest, so you can open the next one straight away. You don't need XP to level up: only $CROP.`)}` },

  { group: 'The Game', id: 'chests', title: 'Treasure Chests', icon: 'chest_gold', render: () => `
    <p class="lead">Every farm gets one free chest per day. Open it from your farm.</p>
    <p>Chests reset at <b>00:00 UTC</b>. Levelling up refreshes the chest too. Your chest gets better as your valley levels up.</p>
    ${table(['Chest', 'From level', 'Gems', 'Produce from'], CHESTS.map(c => [
      `${icon(`chest_${c.id}`, 24)} ${c.label}`, c.minLevel, `${c.gems[0]}–${c.gems[1]}`, TIER[c.produceTier].label,
    ]))}
    <h2 id="loot">Loot tables</h2>
    <p>Each chest gives its gems plus one item rolled from its table.</p>
    ${(() => {
      const kinds = [...new Set(CHESTS.flatMap(c => c.loot.map(([k]) => k)))];
      const label = (k) => k === 'produce' ? '1 random produce'
        : k.startsWith('seed:') ? `${icon(`pack_${k.slice(5)}`, 18)} ${TIER[k.slice(5)].label} seed pack`
        : `${icon(k, 18)} ${ITEMS[k].name}`;
      return table(['Item', ...CHESTS.map(c => `${icon(`chest_${c.id}`, 20)} ${c.label}`)], kinds.map(k => [
        label(k), ...CHESTS.map(c => { const e = c.loot.find(([x]) => x === k); return e ? pct(e[1], 1) : '<span class="muted">–</span>'; }),
      ]), 'compact');
    })()}` },

  { group: 'The Game', id: 'potions', title: 'Potions Master', icon: 'elixir', render: () => `
    <p class="lead">Turn spare produce into potions at the Potions Master, then use them on growing crops.</p>
    <h2 id="effects">Potions</h2>
    ${table(['Potion', 'Lesser', 'Standard', 'Advanced'], ['elixir', 'pesticide', 'fertilizer'].map(k => [
      `${icon(k, 22)} ${RECIPES[k].name}`, ...[1, 2, 3].map(g => ITEMS[g === 1 ? k : `${k}${g}`].desc),
    ]))}
    <p>Use a potion from a growing crop's panel. A crop can take several Growth Elixirs, but only one Pesticide and one Fertilizer.</p>
    <h2 id="recipes">Recipes</h2>
    <p>Each potion has several recipes. Pick one, and that produce is used up.</p>
    ${table(['Potion', 'Recipe', 'Brew', 'Brewing XP'], Object.entries(RECIPES).flatMap(([k, r]) => r.options.map((o, i) => [
      i ? '' : `${icon(k, 22)} ${r.name}`,
      `${o.count} × ${[].concat(o.rarity).map(x => RARITY[x].label).join(' or ')} ${TIER[o.tier].label} produce`,
      BREW_ODDS_BY[o.odds || 'standard'].name, i ? '' : fmt(r.xp),
    ])))}
    <h2 id="odds">Brew odds</h2>
    <p>The grade you get is rolled when you brew. A Disaster fizzles and the produce is lost. Premium produce brews better.</p>
    ${table(['Brew', 'Disaster', 'Lesser', 'Standard', 'Advanced'], Object.values(BREW_ODDS_BY).map(b => [
      b.name, ...[0, 1, 2, 3].map(g => pct(b.odds.find(o => o.grade === g)?.chance || 0, 1)),
    ]))}
    ${hint('Lesser potions also drop from Bronze, Silver and Gold chests.')}` },

  { group: 'The Game', id: 'farms', title: 'Farms', icon: 'bush', render: () => `
    <p class="lead">Run up to ${MAX_FARMS} farms on one account.</p>
    <ul>
      <li>Each farm after your first costs <b>${fmt(ECON.farmCost)} $CROP</b>, and comes with the usual ${fmt(STARTER.coins)} $CROP and starter seeds.</li>
      <li>Each farm has its <b>own plots, valley level and daily chest</b>.</li>
      <li>Your <b>$CROP, gems, XP and Backpack are shared</b> across all your farms.</li>
      <li>Switch between farms with the tabs on the Farm screen. Harvest all collects from every farm.</li>
    </ul>` },

  { group: 'The Game', id: 'leaderboard', title: 'Leaderboard & Prizes', icon: 'xp', render: () => `
    <p class="lead">Climb the leaderboard and win real prizes.</p>
    <h2 id="ranking">How you're ranked</h2>
    <p>The leaderboard ranks farmers by <b>XP</b>. You earn XP by opening seed packs, harvesting crops and brewing potions:</p>
    ${table(['Action', 'XP'], [
      ['Open a seed pack', TIERS.map(t => `${TIER[t].label} ${TIER[t].xpOpen}`).join(' · ')],
      ['Harvest a crop', TIERS.map(t => `${TIER[t].label} ${TIER[t].xpHarvest}`).join(' · ')],
      ['Brew a potion', Object.values(RECIPES).map(r => `${r.name} ${fmt(r.xp)}`).join(' · ')],
    ])}
    <p>Fertilizer adds up to +8% XP on a harvest.</p>
    <h2 id="prizes">Prizes</h2>
    ${docs.prizes.length ? `<p>Top farmers win real prizes, like ${docs.prizes.length === 1 ? 'this one' : 'these'}:</p>
    ${docs.prizes.map(p => `
    <div class="prize">
      <div class="prize-art" aria-hidden="true">${p.image ? `<img src="${esc(p.image)}" alt="">` : icon('chest_gold', 48)}</div>
      <div>
        <b>${esc(p.name)}</b>
        ${p.detail ? `<p>${esc(p.detail)}</p>` : ''}
        ${p.value ? `<p class="value">${esc(p.value)}</p>` : ''}
      </div>
    </div>`).join('')}` : '<p>Prizes for top farmers will be announced soon.</p>'}
    ${docs.prizeNote ? hint(esc(docs.prizeNote)) : ''}` },

  { group: 'The Game', id: 'locations', title: 'The Valley', icon: 'chest_wooden', render: () => `
    <p class="lead">Tap a place on the Valley map, or use the tabs, to visit it.</p>
    ${table(['Place', 'What you do there'], [
      [`${icon('stage:3', 22)} Farm`, 'Plant, harvest, use potions, and open your daily chest.'],
      [`${icon('pack_basic', 22)} Marketplace`, 'Buy and open seed packs, and check the drop tables.'],
      [`${icon('chest_wooden', 22)} House`, 'Level up your valley.'],
      [`${icon('elixir', 22)} Potions`, 'Brew potions from your produce.'],
      [`${icon('fertilizer', 22)} Backpack`, 'Your seeds, produce and potions.'],
      [`${icon('ledger', 22)} My History`, 'Everything you have spent and earned, pack by pack.'],
      [`${icon('coin', 22)} Withdraw`, 'Request $CROP back to your wallet.'],
      [`${icon('xp', 22)} Leaders`, 'The top farmers by XP, who win prizes.'],
    ])}` },

  { group: 'Wallet', id: 'deposits', title: 'Deposits', icon: 'pack_premium', render: () => `
    <p class="lead">Add $CROP from your Solana wallet to play with. 1 $CROP sent = 1 $CROP in the game.</p>
    <ol>
      <li><b>Create an account.</b> Guests can't deposit.</li>
      <li><b>Link your wallet.</b> Press <b>Deposit $CROP</b> in the top right, then <b>Link wallet</b>. Phantom or Solflare asks you to sign a message. That's free and sends nothing.</li>
      <li><b>Send $CROP from that linked wallet</b> to the game wallet shown on the deposit screen.</li>
      <li>It shows up in your farm about a minute after Solana confirms it.</li>
    </ol>
    ${crop?.treasury ? `<p>Game wallet: <code class="addr">${esc(crop.treasury)}</code></p>` : ''}
    ${hint('Only send from the wallet you linked. The game finds your deposit by the wallet it came from. If you sent from another wallet by mistake, reach out to the team.', 'warn')}
    ${hint('Only send $CROP. Other tokens and SOL sent to the game wallet are not credited.', 'warn')}` },

  { group: 'Wallet', id: 'withdrawals', title: 'Withdrawals', icon: 'coin', render: () => `
    <p class="lead">Ask for $CROP to be sent back to your linked wallet from the Withdraw page.</p>
    <h2 id="rules">The rules</h2>
    <ul>
      <li>You need an account and a linked wallet.</li>
      <li><b>One request per day.</b> The day resets at 00:00 UTC.</li>
      <li>The amount leaves your game balance as soon as you request it.</li>
      <li>The team reviews requests and sends them to your linked wallet by hand. You'll see the transaction on the Withdraw page once it's sent.</li>
      <li>Changed your mind? Cancel a pending request and the $CROP goes straight back. A declined request is refunded too, and doesn't use up your day.</li>
    </ul>
    ${hint('Only $CROP can be withdrawn. Gems, seeds, produce and potions stay in the game.')}` },

  { group: 'Help', id: 'fairness', title: 'Fairness', icon: 'lock', render: () => `
    <p class="lead">How the randomness works.</p>
    <ul>
      <li>Seed packs, chests, brews and Fertilizer bonuses are all rolled on the game server, never in your browser.</li>
      <li>The server uses Node's secure random number generator (<code>crypto.randomInt</code>).</li>
      <li>Every roll is independent. There's no pity timer, no streaks and no planted near-misses.</li>
      <li>The odds on these pages and in the Market are the odds the server uses, read from the same settings.</li>
    </ul>
    <p>Your <b>My History</b> page shows every pack you've opened, what you spent and what you got back.</p>` },

  { group: 'Help', id: 'faq', title: 'FAQ', icon: 'ledger', render: () => `
    ${[
      ['Do I need a wallet to play?', 'No. You can play with the starter $CROP without one. You only need a wallet to deposit or withdraw.'],
      ['Can I buy gems?', 'No. Gems are earn-only.'],
      ['Why did my chest not reset?', 'Chests reset at 00:00 UTC, which may not be your midnight. Levelling up also refreshes it.'],
      ['My deposit has not arrived.', 'Give it a few minutes, and make sure you sent $CROP from your linked wallet. If it still hasn\'t shown up, reach out to the team with the transaction link.'],
      ['Can I play on my phone?', 'Yes. Sign in on any device to play the same farm.'],
      ['What happens to a guest farm?', 'It stays in that browser. Guest farms that were never played are cleared after a day. Create an account to keep yours.'],
      ['Is $CROP an investment?', 'No. It\'s the game\'s currency. Only deposit what you\'re happy to play with.'],
    ].map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}` },
];

// The built-in pages with the admin's edits applied (titles, intros, hidden pages, extra
// text), plus the admin's own pages, in section order.
let PAGES = BUILT_IN, PAGE = {};
function buildPages() {
  const edited = BUILT_IN.map(p => {
    const e = docs.pages[p.id] || {};
    return { ...p, title: e.title?.trim() || p.title, lead: e.lead?.trim() || '', extra: e.extra || '', hidden: Boolean(e.hidden) && p.id !== 'introduction' };
  });
  const custom = docs.custom.map(c => ({ id: c.id, group: c.group, title: c.title, icon: 'flowerpot', render: () => renderMarkdown(c.body) }));
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
      ${PAGES.filter(p => p.group === g).map(p => `<a href="#${p.id}" class="${p.id === current ? 'active' : ''}"${p.id === current ? ' aria-current="page"' : ''}>${icon(p.icon, 20)}<span>${p.title}</span></a>`).join('')}
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
    <h1>${icon(page.icon, 40)} ${page.title}</h1>
    ${page.render()}
    ${page.extra ? `<div class="extra">${renderMarkdown(page.extra)}</div>` : ''}
    <nav class="pager">
      ${prev ? `<a class="prev" href="#${prev.id}"><small>Previous</small>${prev.title}</a>` : '<span></span>'}
      ${next ? `<a class="next" href="#${next.id}"><small>Next</small>${next.title}</a>` : '<span></span>'}
    </nav>`;
  if (page.lead) {
    const lead = $('#content .lead');
    if (lead) lead.textContent = page.lead;
    else $('#content h1').insertAdjacentHTML('afterend', `<p class="lead">${esc(page.lead)}</p>`);
  }
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
