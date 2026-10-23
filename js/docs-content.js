// The docs text (/docs), as Markdown, plus what the admin dashboard can change: each page's
// title, intro and body, hidden pages, the prize list and extra pages. Live numbers go in as
// {{placeholders}} (see DOCS_TOKENS), which the docs page fills from the current economy, so
// edited text never shows stale prices or odds. Also a validator (the server refuses anything
// else) and a small, safe Markdown renderer.

export const DOCS_LIMITS = { title: 60, lead: 400, text: 20000, prizes: 20, custom: 30, field: 200 };
export const DOCS_GROUPS = ['Getting Started', 'The Game', 'Wallet', 'Help'];

// Placeholders the page text can use. Block ones go on a line of their own.
export const DOCS_TOKENS = {
  inline: {
    starterCrop: '$CROP a new farm starts with', starterSeeds: 'starter seeds per farm', basePlots: 'plots a farm starts with',
    maxPlots: 'most plots a farm can have', maxFarms: 'most farms per account', farmCost: 'price of each extra farm',
    maxLevel: 'top valley level', levelTotal: '$CROP to reach the top level', baseRtp: 'RTP at level 0', maxRtp: 'RTP at the top level',
    levelBonus: 'payout added per level', firstHarvestGems: 'gems for a first harvest', skipCost: 'gem cost per hour skipped',
    cropCount: 'number of crops', tierCount: 'number of pack tiers', commonMult: 'Common payout ×', legendaryMult: 'Legendary payout ×',
    harvestXp: 'harvest XP by tier',
  },
  block: {
    nextCards: 'links to four pages', officialLinks: 'official links table', spendTable: 'what $CROP buys',
    packTiers: 'pack prices and XP', rarityOdds: 'drop rates', cropTables: 'every crop and its payout', gemSources: 'ways to earn gems',
    levelTable: 'the 15 levels', chestTable: 'chest tiers', chestLoot: 'chest loot odds', potionEffects: 'potion effects',
    recipes: 'potion recipes', brewOdds: 'brew odds', xpTable: 'XP per action', prizes: 'the prize list', gameWallet: 'the deposit wallet',
  },
};

// The built-in pages and their default text.
const page = (id, group, title, icon, lead, body) => ({ id, group, title, icon, lead, body: body.trim() });
export const DOCS_PAGES = [
  page('introduction', 'Getting Started', 'Introduction', 'farmer',
    'Hopi Farms is a pixel-art farming game on Solana. Open seed packs, grow crops on your farm and harvest them for $CROP.', `
## What is Hopi Farms?
You run a little valley. Seed packs from the Market hold a random crop. Plant it, wait for it to grow, then harvest it for $CROP. Rarer crops pay more and some also pay gems.

Level up your valley to open more plots and raise every harvest's payout. Each day you get a free treasure chest. Brew potions from your produce to grow faster and harvest more.

## Getting started
1. Open [hopifarms.fun](/) and create an account, or look around as a guest first.
2. Every new farm starts with **{{starterCrop}} $CROP** and {{starterSeeds}} Feeble seeds. Plant them from the welcome screen.
3. Come back when they're grown and harvest. Then spin some seed packs at the Market.

> Playing as a guest? Your farm lives in that browser only. Create an account from your profile to keep it and play on any device. You need an account to deposit or withdraw $CROP.

## Where to next
{{nextCards}}`),

  page('game-loop', 'Getting Started', 'Game Loop', 'stage:3',
    'The whole game in one loop: buy seeds, grow, harvest, grow your valley.', `
## The loop
1. **Buy seed packs.** Spend $CROP at the Market. Each pack rolls one random crop.
2. **Plant.** Put seeds in your empty plots. You start with {{basePlots}} plots.
3. **Grow.** Crops take 3 to 24 hours depending on rarity. Gems or a Growth Elixir speed them up.
4. **Harvest.** Get $CROP, XP, produce and sometimes gems.
5. **Level up.** Spend $CROP in the House for more plots, higher payouts and better chests.

## On the side
- **Daily chest:** one free chest per farm each UTC day. See [Treasure Chests](#chests).
- **Potions:** turn produce into Growth Elixirs, Pesticide and Fertilizer. See [Potions Master](#potions).
- **More farms:** open up to {{maxFarms}} farms on one account. See [Farms](#farms).
- **Leaderboard:** ranked by XP, with real prizes for top farmers. See [Leaderboard & Prizes](#leaderboard).
- **Auction & Lottery:** spend gems on prizes. See [Auction & Lottery](#auction-lottery).`),

  page('official-links', 'Getting Started', 'Official Links', 'flowerpot',
    'Only trust these links. The team will never DM you first or ask for your seed phrase.', `
{{officialLinks}}

>! Always check the contract address matches before you buy or send $CROP.`),

  page('crop-token', 'The Game', '$CROP', 'coin',
    '$CROP is the main currency of Hopi Farms: a Solana token, and the balance you spend and earn in the game.', `
## What you use it for
{{spendTable}}

## How you earn it
- Harvesting crops. See [Crops & Rarities](#crops) for every payout.
- The {{starterCrop}} $CROP every new farm starts with.
- Depositing $CROP from your Solana wallet: **1 $CROP in = 1 $CROP in the game**. See [Deposits](#deposits).

## Taking it out
You can ask for $CROP to be sent back to your linked wallet once a day. See [Withdrawals](#withdrawals).

>! $CROP is a game currency, not an investment. Only deposit what you are happy to play with.`),

  page('seed-packs', 'The Game', 'Seed Packs', 'pack_basic',
    'Every crop starts as a seed pack from the Market. Each pack rolls one random crop of its tier.', `
## Pack tiers
{{packTiers}}

Buy 1, 3, or any number up to 9 at once. Bigger packs cost more but pay more, so every tier has the same return. See [Levels & RTP](#levels).

## Drop rates
The odds are the same for every tier. First the pack rolls a rarity, then it picks one crop of that rarity at random.

{{rarityOdds}}

> Every pull is rolled on the server with a secure random number generator. Nothing is staged: the spinning reel is only for show, and the result was decided when you bought the pack.`),

  page('crops', 'The Game', 'Crops & Rarities', 'crop:grapes',
    'There are {{cropCount}} crops across {{tierCount}} tiers. What a crop pays depends on its tier, its rarity and your valley level.', `
Payouts below are for level 0 and the max level, {{maxLevel}}. Each level adds {{levelBonus}} to every harvest.

{{cropTables}}

> The first time you harvest each crop you also get **+{{firstHarvestGems}} gems**. Collect all {{cropCount}}!`),

  page('farming', 'The Game', 'Planting & Harvesting', 'stage:2',
    'Plant seeds in empty plots, wait, then harvest.', `
## Planting
- Tap an empty plot to plant, or use **Plant all** to fill every empty plot with your best seeds first.
- A farm has {{basePlots}} plots to start, and each valley level opens one more, up to {{maxPlots}}.

## Harvesting
A grown crop gives you:
- **$CROP**: see [Crops & Rarities](#crops).
- **XP**: by pack tier, {{harvestXp}}.
- **1 produce**, kept in your Backpack for brewing potions.
- **Gems** from Epic and Legendary crops, and from your first harvest of each crop.

**Harvest all** collects every grown crop on all of your farms at once.

## Finish now
Don't want to wait? Spend **{{skipCost}} per hour left** (rounded up) to finish a crop right away. A Growth Elixir also cuts hours off. See [Potions Master](#potions).`),

  page('gems', 'The Game', 'Gems', 'gem',
    "Gems are the earn-only currency. They can't be bought, sold or withdrawn.", `
## How to earn gems
{{gemSources}}

## How to spend gems
- **Finish now** on a growing crop: {{skipCost}} per hour left.
- Bid in the **Auction** or buy **Lottery** tickets for prizes. See [Auction & Lottery](#auction-lottery).

>! Gems have no cash value and stay in the game.`),

  page('levels', 'The Game', 'Levels & RTP', 'xp',
    "Level up your valley in the House. Every level opens one more plot and raises every harvest's payout.", `
## What is RTP?
RTP (return to player) is the average share of a pack's cost that comes back as $CROP when you harvest it, over many packs. At level 0 it's **{{baseRtp}}**. Each level adds {{levelBonus}} to every payout, up to **{{maxRtp}}** at level {{maxLevel}}.

RTP is an average. Any one pack can pay a lot less (a Common pays {{commonMult}}×) or a lot more (a Legendary pays {{legendaryMult}}×).

## Level table
{{levelTable}}

> Levelling up also refreshes your daily chest, so you can open the next one straight away. You don't need XP to level up: only $CROP.`),

  page('chests', 'The Game', 'Treasure Chests', 'chest_gold',
    'Every farm gets one free chest per day. Open it from your farm.', `
Chests reset at **00:00 UTC**. Levelling up refreshes the chest too. Your chest gets better as your valley levels up.

{{chestTable}}

## Loot tables
Each chest gives its gems plus one item rolled from its table.

{{chestLoot}}`),

  page('potions', 'The Game', 'Potions Master', 'elixir',
    'Turn spare produce into potions at the Potions Master, then use them on growing crops.', `
## Potions
{{potionEffects}}

Use a potion from a growing crop's panel. A crop can take several Growth Elixirs, but only one Pesticide and one Fertilizer.

## Recipes
Each potion has several recipes. Pick one, and that produce is used up.

{{recipes}}

## Brew odds
The grade you get is rolled when you brew. A Disaster fizzles and the produce is lost. Premium produce brews better.

{{brewOdds}}

> Lesser potions also drop from Bronze, Silver and Gold chests.`),

  page('farms', 'The Game', 'Farms', 'bush',
    'Run up to {{maxFarms}} farms on one account.', `
- Each farm after your first costs **{{farmCost}} $CROP**, and comes with the usual {{starterCrop}} $CROP and starter seeds.
- Each farm has its **own plots, valley level and daily chest**.
- Your **$CROP, gems, XP and Backpack are shared** across all your farms.
- Switch between farms with the tabs on the Farm screen. Harvest all collects from every farm.`),

  page('leaderboard', 'The Game', 'Leaderboard & Prizes', 'xp',
    'Climb the leaderboard and win real prizes.', `
## How you're ranked
The leaderboard ranks farmers by **XP**. You earn XP by opening seed packs, harvesting crops and brewing potions:

{{xpTable}}

Fertilizer adds up to +8% XP on a harvest. Open the leaderboard from the **Leaderboard** button at the top of the game.

## Prizes
{{prizes}}`),

  page('auction-lottery', 'The Game', 'Auction & Lottery', 'gavel',
    'Spend your gems on prizes in the Auction and Lottery tabs.', `
> You need an account to bid or buy tickets, so we know who to send the prize to.

## Auction
- Each auction has a starting bid and a minimum raise, both in gems.
- Your bid is **held** from your gems while you're the top bidder. If someone outbids you, it comes straight back.
- Raising your own bid only takes the difference.
- The top bid when the timer runs out wins, and those gems are spent.
- **No sniping:** a bid in the last 2 minutes pushes the end back to 2 minutes from then.

## Lottery
- Buy tickets with gems. Every ticket is one equal chance.
- Some lotteries limit how many tickets one player can hold.
- When the timer ends, the server draws the winners with a secure random number generator. Each player can win only once per lottery.
- Tickets are spent whether you win or not.

## After you win
Winners show on the tab for everyone to see. The team gets in touch to deliver your prize. If an auction or lottery is ever cancelled, every gem put into it is refunded.`),

  page('locations', 'The Game', 'The Valley', 'chest_wooden',
    'Tap a place on the Valley map, or use the tabs, to visit it.', `
- **Farm:** plant, harvest, use potions, and open your daily chest.
- **Marketplace:** buy and open seed packs, and check the drop tables.
- **House:** level up your valley.
- **Potions:** brew potions from your produce.
- **Backpack:** your seeds, produce and potions.
- **My History:** everything you have spent and earned, pack by pack.
- **Withdraw:** request $CROP back to your wallet.
- **Auction:** bid gems on prizes.
- **Lottery:** buy tickets with gems for a chance at prizes.

At the top of the screen: **Docs** opens these pages, and **Leaderboard** shows the top farmers by XP.`),

  page('deposits', 'Wallet', 'Deposits', 'pack_premium',
    'Add $CROP from your Solana wallet to play with. 1 $CROP sent = 1 $CROP in the game.', `
1. **Create an account.** Guests can't deposit.
2. **Link your wallet.** Press **Deposit $CROP** in the top right, then **Link wallet**. Phantom or Solflare asks you to sign a message. That's free and sends nothing.
3. **Send $CROP from that linked wallet** to the game wallet shown on the deposit screen.
4. It shows up in your farm about a minute after Solana confirms it.

{{gameWallet}}

>! Only send from the wallet you linked. The game finds your deposit by the wallet it came from. If you sent from another wallet by mistake, reach out to the team.

>! Only send $CROP. Other tokens and SOL sent to the game wallet are not credited.`),

  page('withdrawals', 'Wallet', 'Withdrawals', 'coin',
    'Ask for $CROP to be sent back to your linked wallet from the Withdraw page.', `
## The rules
- You need an account and a linked wallet.
- **One request per day.** The day resets at 00:00 UTC.
- The amount leaves your game balance as soon as you request it.
- The team reviews requests and sends them to your linked wallet by hand. You'll see the transaction on the Withdraw page once it's sent.
- Changed your mind? Cancel a pending request and the $CROP goes straight back. A declined request is refunded too, and doesn't use up your day.

> Only $CROP can be withdrawn. Gems, seeds, produce and potions stay in the game.`),

  page('fairness', 'Help', 'Fairness', 'lock',
    'How the randomness works.', `
- Seed packs, chests, brews, lottery draws and Fertilizer bonuses are all rolled on the game server, never in your browser.
- The server uses Node's secure random number generator (\`crypto.randomInt\`).
- Every roll is independent. There's no pity timer, no streaks and no planted near-misses.
- The odds on these pages and in the Market are the odds the server uses, read from the same settings.

Your **My History** page shows every pack you've opened, what you spent and what you got back.`),

  page('faq', 'Help', 'FAQ', 'ledger', '', `
?? Do I need a wallet to play?
No. You can play with the starter $CROP without one. You only need a wallet to deposit or withdraw.

?? Can I buy gems?
No. Gems are earn-only.

?? Why did my chest not reset?
Chests reset at 00:00 UTC, which may not be your midnight. Levelling up also refreshes it.

?? My deposit has not arrived.
Give it a few minutes, and make sure you sent $CROP from your linked wallet. If it still hasn't shown up, reach out to the team with the transaction link.

?? Can I play on my phone?
Yes. Sign in on any device to play the same farm.

?? What happens to a guest farm?
It stays in that browser. Guest farms that were never played are cleared after a day. Create an account to keep yours.

?? Is $CROP an investment?
No. It's the game's currency. Only deposit what you're happy to play with.`),
];
export const DOCS_PAGE = Object.fromEntries(DOCS_PAGES.map(p => [p.id, p]));

export const DEFAULT_DOCS = {
  // Per built-in page id: { title, lead, body, hidden }. Only what differs from the default is kept.
  pages: {},
  prizes: [
    { name: '2023 Paldea Evolved Baxcalibur #210', detail: 'Illustration Rare · PSA 10 Gem Mint', value: 'Fair market value: $349', image: '' },
  ],
  prizeNote: 'Prize rounds, winner counts and dates are announced on our official channels. Check them for the current prize.',
  // Extra pages: { id, group, title, body }.
  custom: [],
};

export function withDocDefaults(d) {
  return { ...structuredClone(DEFAULT_DOCS), ...(d && typeof d === 'object' ? d : {}) };
}

// A built-in page with its edits applied. Older saves kept added text in `extra`.
export function pageText(id, docs) {
  const base = DOCS_PAGE[id];
  const e = docs?.pages?.[id] || {};
  let body = e.body ?? base.body;
  if (e.extra && e.body === undefined) body += `\n\n${e.extra}`;
  return { ...base, title: e.title || base.title, lead: e.lead ?? base.lead, body, hidden: Boolean(e.hidden) && id !== 'introduction' };
}

const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const optStr = (v, max) => v === undefined || isStr(v, max);
const okUrl = (u) => u === '' || /^https:\/\/[^\s"'<>]+$/.test(u);

// List of problems, empty when the docs content is fine to save.
export function validateDocs(d) {
  const L = DOCS_LIMITS;
  const errors = [];
  if (!d || typeof d !== 'object') return ['Docs content is missing.'];
  if (!d.pages || typeof d.pages !== 'object' || Array.isArray(d.pages)) errors.push('Pages must be an object.');
  else {
    const ids = Object.keys(d.pages);
    if (ids.length > 50) errors.push('Too many pages.');
    for (const id of ids) {
      const p = d.pages[id];
      if (!/^[a-z0-9-]{1,40}$/.test(id) || !p || typeof p !== 'object') { errors.push(`Bad page "${id}".`); continue; }
      if (!optStr(p.title, L.title)) errors.push(`${id}: title is too long (max ${L.title}).`);
      if (!optStr(p.lead, L.lead)) errors.push(`${id}: intro is too long (max ${L.lead}).`);
      if (!optStr(p.body, L.text)) errors.push(`${id}: text is too long (max ${L.text}).`);
      if (!optStr(p.extra, L.text)) errors.push(`${id}: extra text is too long (max ${L.text}).`);
      if (p.hidden !== undefined && typeof p.hidden !== 'boolean') errors.push(`${id}: hidden must be true or false.`);
    }
  }
  if (!Array.isArray(d.prizes) || d.prizes.length > L.prizes) errors.push(`Prizes must be a list of at most ${L.prizes}.`);
  else d.prizes.forEach((p, i) => {
    if (!p || !isStr(p.name, L.field) || !p.name.trim()) errors.push(`Prize ${i + 1} needs a name.`);
    else if (!isStr(p.detail ?? '', L.field) || !isStr(p.value ?? '', L.field)) errors.push(`Prize ${i + 1}: text is too long.`);
    else if (!okUrl(p.image ?? '')) errors.push(`Prize ${i + 1}: the image must be an https:// link.`);
  });
  if (!isStr(d.prizeNote ?? '', L.lead)) errors.push(`The prize note is too long (max ${L.lead}).`);
  if (!Array.isArray(d.custom) || d.custom.length > L.custom) errors.push(`Custom pages must be a list of at most ${L.custom}.`);
  else {
    const seen = new Set();
    d.custom.forEach((p, i) => {
      if (!p || !/^x-[a-z0-9-]{1,40}$/.test(p.id) || seen.has(p.id)) errors.push(`Custom page ${i + 1} has a bad or repeated id.`);
      else seen.add(p.id);
      if (!p || !isStr(p.title, L.title) || !p.title.trim()) errors.push(`Custom page ${i + 1} needs a title.`);
      if (!p || !DOCS_GROUPS.includes(p.group)) errors.push(`Custom page ${i + 1}: pick a section.`);
      if (!p || typeof p.body !== 'string') errors.push(`Custom page ${i + 1} needs some text.`);
      else if (p.body.length > L.text) errors.push(`Custom page ${i + 1}: text is too long (max ${L.text}).`);
    });
  }
  return errors;
}

// --- Markdown ------------------------------------------------------------------
// Supports: ## and ### headings, paragraphs, - and 1. lists, > tip boxes, >! warning boxes,
// ?? FAQ questions (the lines after are the answer), **bold**, *italic*, `code`,
// [links](https://…), ![images](https://…) and {{placeholders}}. Text is escaped first,
// so no raw HTML gets through; placeholders are filled by `token(name, block)`, which
// returns HTML (or null for an unknown name, which is then shown as typed).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const safeHref = (u) => /^(https?:\/\/|\/|#)/.test(u) ? u : '#';
const TOKEN = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

export function renderInline(text, token = () => null) {
  return esc(text)
    .replace(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g, (_, alt, src) => `<img class="md-img" src="${src}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
      const h = safeHref(href);
      const ext = /^https?:/.test(h) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${h}"${ext}>${t}</a>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(TOKEN, (m, name) => token(name, false) ?? m);
}

export function renderMarkdown(src, token = () => null) {
  const inline = (t) => renderInline(t, token);
  const out = [];
  let para = [], list = null, faq = null;
  const flush = () => {
    if (faq) out.push(`<details><summary>${inline(faq.q)}</summary>${faq.a.length ? `<p>${inline(faq.a.join(' '))}</p>` : ''}</details>`);
    faq = null;
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of String(src || '').split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!line) { flush(); continue; }
    if ((m = /^\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}$/.exec(line)) && token(m[1], true) != null) {
      flush();
      out.push(token(m[1], true));
    } else if ((m = /^\?\?\s+(.*)$/.exec(line))) {
      flush();
      faq = { q: m[1], a: [] };
    } else if (faq) {
      faq.a.push(line);
    } else if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) {
      flush();
      const tag = m[1].length === 2 ? 'h2' : 'h3';
      out.push(`<${tag}${tag === 'h2' ? ` id="${slug(m[2]) || 'section'}"` : ''}>${inline(m[2])}</${tag}>`);
    } else if ((m = /^>(!?)\s?(.*)$/.exec(line))) {
      flush();
      out.push(`<div class="hint${m[1] ? ' warn' : ''}">${inline(m[2])}</div>`);
    } else if ((m = /^(-|\*|\d+\.)\s+(.*)$/.exec(line))) {
      const tag = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (para.length || (list && list.tag !== tag)) flush();
      list = list || { tag, items: [] };
      list.items.push(m[2]);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('\n');
}
