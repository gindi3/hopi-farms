# Crypto Valleys: Game Breakdown (for building our own version)

Sources: Legion's livestream "NEW FARMING GAME ON BLAST Crypto Valley" (54 min, early 2024), the
community "Seed Packs" chart (by Severus, updated 3 Apr '24), a farm-screen screenshot, and the
official docs at docs.cryptovalleys.io (drop rates, grow times, NPCs, chests, crafting).

> Build it with our own name, our own pixel art, and our own numbers. The mechanics below are fair
> game to copy. The original's art, logo and name aren't.
>
> **Scope change:** our version drops the original's Locked YIELD and the Bank (staking). Harvests
> pay a single spendable currency. The Sage existed only to unlock locked tokens, so it's gone too.
> We add a second, scarce currency, **gems**, that the original doesn't have (see §5).

---

## 1. What the game is

It's a pixel-art idle farming game with two currencies: **coins** (everyday, from harvests) and
**gems** (scarce, from lucky harvests, chests and leaderboards). The core loop is:

```
buy a seed pack → reveal a RANDOM crop → plant on a plot → wait (3–24h)
     ↑                                                          ↓
     └──────── spend coins ←── harvest: coins + XP + produce (+ gems on Epic/Legendary)
```

Packs return **95.56%** of their cost on average (RTP). Each Valley level adds 0.10%, and the hard
cap is **99.0%**, reached at level 35. Coins always drain slowly, so the house edge never drops
below 1%. The fun is in the variance, the progression and the free seeds from chests (see §4).

---

## 2. Screens / locations

| Location | Building / NPC | What it does |
|---|---|---|
| **Farm** | Farmer | Grid of plots. Click plot → pick seed → Plant. Hovering a plot shows its growth stage, time left and reward. |
| **Marketplace** | Seed Vendor | Sells seed packs (4 tiers). Purchase and reveal are separate steps, and the contents go to the inventory. |
| | Market (P2P) | Players list any asset at their own price. A **5% fee on purchase is burnt**. |
| | Leaderboard | Weekly tasks (refer friends, earn XP, etc.). Top players get rewards, including seeds. |
| **Tavern** | Potions Master | Burn produce to craft consumables (see §7). |
| **House** | Gardener | Pay coins to level up the Valley (see §6). |
| | Daily Chest | Claim one chest per day. Its tier depends on Valley level (see §8). |
| | Referrals | Sponsors get **1% cashback** on everything their referrals spend. |
| | Inventory | Seeds, produce, consumables, chests. |

### Farm screen layout (screenshot)
- Top-left: player name plate, settings and backpack buttons.
- Two balance pills: **coins** and **gems**. (In the original, the second pill was locked tokens.)
- The left fenced field is a 5×3 grid of open plots. The right field is a 5×3 grid of **locked plots**
  (padlock signs) that open as you level up.
- Each plot is a small sign. Crops go through **5 growth stages** before they're ready to harvest.
- The farmer NPC stands on a stone path between the two fields.
- Left edge: a vertical nav of signs (House, Farm, Market, Valley). Bottom-right: an XP counter.
- Style: top-down 16-bit look, warm brown and green palette, wooden UI panels with thick outlines.

---

## 3. Seed packs (the heart of the game)

There are 4 pack tiers. Each pack gives one random crop from that tier. Rarity uses the **same drop
table for every tier**:

| Rarity | Drop chance | Grow time | Return (× pack cost) |
|---|---|---|---|
| Common | 27.88% | 3h | 0.50× |
| Uncommon | 43.76% | 4h | 0.90× |
| Rare | 21.42% | 8h | 1.20× |
| Epic | 6.16% | 12h | 2.00× |
| Legendary | 0.78% | 24h | 5.40× |

**Expected values per pack** (base, before level bonus):
- Return: **0.9556×** cost (95.56% RTP), a 4.4% loss on average.
- Average grow time: about **5.2 hours**.
- Most likely outcome: Uncommon (44%), a 10% loss.

### Pack tiers and crop roster

| Rarity | Feeble (cost 1) | Pico (cost 20) | Basic (cost 100) | Premium (cost 800) |
|---|---|---|---|---|
| Common | F. Potato 0.5 | Potato 10 | Wheat / Tomato / Carrot / Corn 50 | Banana / Mango / Avocado 400 |
| Uncommon | F. Lettuce 0.9 | Lettuce 18 | Pumpkin / Chili / Parsnip 90 | Pineapple / Blueberry / Artichoke 720 |
| Rare | F. Cabbage 1.2 | Cabbage 24 | Celery / Broccoli 120 | Papaya / Fig 960 |
| Epic | F. Onion 2 | Onion 40 | Cauliflower / Berry 200 | Lichi / Lavender 1600 |
| Legendary | F. Radish 5.4 | Radish 108 | Grapes 540 | Dragon Fruit 4400 |

Within a rarity, crops are cosmetic. They pay the same and differ only in produce type (which
matters for crafting). The tiers differ only in **stake size**. Since plots are limited,
higher-tier packs earn more per plot.

**Reveal:** buying a pack and revealing it are separate actions. The reveal is the main thrill, so
it deserves a pack-opening animation. (The original's 8-minute open window was a chain-randomness
limit we don't need.)

---

## 4. RTP and the 99.0% cap

```
RTP = min(95.56% + 0.10% × Valley level, 99.0%)
```

| Level | 0 | 1 | 5 | 10 | 15 | 20 | 25 | 30 | 34 | 35 |
|---|---|---|---|---|---|---|---|---|---|---|
| RTP | 95.56% | 95.66% | 96.06% | 96.56% | 97.06% | 97.56% | 98.06% | 98.56% | 98.96% | **99.00%** |

- The level bonus adds percentage points: every crop's payout is scaled by `RTP / 95.56%`. For
  example, at level 35 a Potato pays 10 × 99.0 / 95.56 = 10.36.
- Level 35 would compute to 99.06%, so the cap clips it to 99.0%.
- **The cap covers every coin boost combined.** Nothing (consumables, characters, events) may push
  expected coin return above 99.0%. That's why the Fertilizer and Characters below boost produce and
  XP instead of coins, and why the gem option is a same-rarity swap instead of a reroll (§5).
- The original's level bonus was much bigger (+0.25% per level in multiplier terms), plus locked
  rewards on top. Ours is a much tighter economy.

### Coin faucets (needed, since RTP < 100%)
With every pack losing a little, coins have to enter the game from somewhere besides harvests:
- A **starter grant** (e.g. 100 coins) plus a starter bundle of Feeble seeds.
- **Free seeds from the Daily Chest.** A free seed has no cost, so its harvest is pure gain. This is
  the main faucet.
- **Weekly leaderboard prizes.**

Tune the faucets so an active player's balance grows slowly through free seeds, while spending on
packs drains it slowly.

---

## 5. Gems (premium currency)

Coins are the economy and gems are the treat. Gems should feel rare, buy **time and convenience**,
and never convert back into coins. That way they can't break the pack math in §3–4.

### Earning gems

| Source | Gems |
|---|---|
| Harvest an Epic crop | 1 (Feeble/Pico), 2 (Basic), 5 (Premium) |
| Harvest a Legendary crop | 5 (Feeble/Pico), 10 (Basic), 25 (Premium) |
| Daily Chest | Wooden 1–2 · Bronze 2–4 · Silver 4–8 · Gold 8–15 |
| Valley level-up | 10 × new level |
| Weekly leaderboard | Top 10: 50–250 |
| First-time milestones (first harvest of each crop) | 2 each |

The harvest drop only scales a little with tier, so cheap packs still feel worth rolling.

### Spending gems

| Sink | Cost | Notes |
|---|---|---|
| Finish a crop now | 1 gem per hour left (rounded up) | The main sink. A Legendary costs up to 24 gems. |
| Swap a crop | 5 gems | Once per pack. Swap for another crop of the **same rarity** (e.g. Wheat → Corn). Changes the produce type for crafting, not the coin payout. |
| Gem plots | 50 / 100 / 200 | Up to 3 extra plots on top of level unlocks. |
| Skip the chest cooldown | 10 gems | Once per day, for a second Daily Chest. |
| Cosmetics | 20–200 | Scarecrows, fences, farmer outfits, plot signs. |

### Guardrails
- **Earn-only.** Gems can't be bought with real money, so no gem sink is ever pay-to-win.
- **No gems → coins.** Gems also can't buy Valley levels, so levels stay a coin sink.
- **No full rerolls.** A full re-roll on the drop table would let players redraw every Common and
  Uncommon, which works out to about **110.7% RTP** and breaks the 99.0% cap. That's why the gem
  option is a same-rarity swap.
- **Gems aren't tradeable** on the P2P market, at least for the MVP.
- Watch the earn/spend ratio. Working it out from the table, an active player earns roughly:
  - **Early** (15 plots of Pico, Wooden chest): about 0.1 gems per harvest × about 60 harvests a day,
    plus the chest, so about **7 gems a day**.
  - **Level 10** (about 25 plots of Basic, Silver chest): about 0.2 gems per harvest × about 100, plus
    the chest, so about **25 gems a day**.

  That's enough to rush a few crops, not the whole farm. Recheck these numbers once grow-time
  boosts exist.

---

## 6. Progression

**Valley level (Gardener)** is bought with coins. Players start at level 0 (95.56% RTP, 15 plots).
Max level is **35**. Every level gives **+0.10% RTP** and **10 × the new level in gems**.

Levels 1–15 keep the original's costs. From level 16 on, each level costs 250 more than the last.
Even levels up to 30 add a plot, which fills the 15 locked plots on the farm screen.

| Level | Cost | Total | RTP | Plots | Unlocks |
|---|---|---|---|---|---|
| 1 | 100 | 100 | 95.66% | 15 | — |
| 2 | 125 | 225 | 95.76% | 16 | +1 plot |
| 3 | 150 | 375 | 95.86% | 16 | — |
| 4 | 175 | 550 | 95.96% | 17 | +1 plot |
| 5 | 250 | 800 | 96.06% | 17 | Referrals |
| 6 | 300 | 1,100 | 96.16% | 18 | +1 plot |
| 7 | 350 | 1,450 | 96.26% | 18 | — |
| 8 | 400 | 1,850 | 96.36% | 19 | +1 plot |
| 9 | 450 | 2,300 | 96.46% | 19 | — |
| 10 | 600 | 2,900 | 96.56% | 20 | +1 plot, Bronze chest |
| 11 | 700 | 3,600 | 96.66% | 20 | — |
| 12 | 800 | 4,400 | 96.76% | 21 | +1 plot |
| 13 | 900 | 5,300 | 96.86% | 21 | — |
| 14 | 1,000 | 6,300 | 96.96% | 22 | +1 plot |
| 15 | 1,250 | 7,550 | 97.06% | 22 | — |
| 16 | 1,500 | 9,050 | 97.16% | 23 | +1 plot |
| 17 | 1,750 | 10,800 | 97.26% | 23 | — |
| 18 | 2,000 | 12,800 | 97.36% | 24 | +1 plot |
| 19 | 2,250 | 15,050 | 97.46% | 24 | — |
| 20 | 2,500 | 17,550 | 97.56% | 25 | +1 plot, Silver chest |
| 21 | 2,750 | 20,300 | 97.66% | 25 | — |
| 22 | 3,000 | 23,300 | 97.76% | 26 | +1 plot |
| 23 | 3,250 | 26,550 | 97.86% | 26 | — |
| 24 | 3,500 | 30,050 | 97.96% | 27 | +1 plot |
| 25 | 3,750 | 33,800 | 98.06% | 27 | — |
| 26 | 4,000 | 37,800 | 98.16% | 28 | +1 plot |
| 27 | 4,250 | 42,050 | 98.26% | 28 | — |
| 28 | 4,500 | 46,550 | 98.36% | 29 | +1 plot |
| 29 | 4,750 | 51,300 | 98.46% | 29 | — |
| 30 | 5,000 | 56,300 | 98.56% | 30 | +1 plot, Gold chest |
| 31 | 5,250 | 61,550 | 98.66% | 30 | — |
| 32 | 5,500 | 67,050 | 98.76% | 30 | — |
| 33 | 5,750 | 72,800 | 98.86% | 30 | — |
| 34 | 6,000 | 78,800 | 98.96% | 30 | — |
| 35 | 6,250 | 85,050 | 99.00% | 30 | RTP cap |

(Gem plots from §5 can add up to 3 more, for a maximum of 33.)

**Levels never pay for themselves in RTP.** At level 35, a player's whole 85k-coin investment buys
3.44 extra points of RTP, which still leaves them below break-even. What levels really buy is plots,
chest tiers and status. That's fine, as long as players see levels as progression, not an
investment.

The cost curve for levels 16–35 and the plot schedule are my proposal. Adjust as needed.

**Farmer XP** comes from opening packs, harvesting, buying on the P2P market and crafting potions
(+75 / +250 / +2,000). It gates future content.

**Characters** can be equipped for small bonuses to produce, XP or gem drops (not coins, because of
the RTP cap).

---

## 7. Crafting (Potions Master)

Burn produce to get a consumable. Every craft rolls an outcome:

| Outcome | Chance |
|---|---|
| Disaster (produce lost) | 10% |
| Lesser consumable | 82.5% |
| Standard consumable | 6% |
| Advanced consumable | 1.5% |

| Consumable | Recipe | Lesser / Standard / Advanced effect |
|---|---|---|
| Growth Elixir | 2 Legendary or 8 Epic **Pico** crops | −3h / −6h / −12h grow time |
| Pesticide | 2 Legendary or 4 Epic **Basic** crops | +1 / +2 / +3 (extra produce, presumably) |
| Fertilizer | 2 Legendary or 4 Epic **Pico** crops | +4% / +6% / +8% **XP and produce** (the original gave +% coins, which would break the RTP cap) |

## 8. Daily chests

Every chest also contains gems (see §5) on top of its loot roll:

| Drop | Wooden (Lv 0–9) | Bronze (Lv 10–19) | Silver (Lv 20–29) | Gold (Lv 30–35) |
|---|---|---|---|---|
| Gems (always) | 1–2 | 2–4 | 4–8 | 8–15 |
| Produce | 90% Pico | 53.3% Pico | 50% Basic | 50% Premium |
| Growth Elixir | — | 2% | 4% | 6% |
| Pesticide | — | 2% | 4% | 8% |
| Fertilizer | — | — | 0.5% | 2% |
| Feeble seed | 9.8% | 40% | 30% | 9.9% |
| Pico seed | 0.2% | 2.5% | 9.5% | 15% |
| Basic seed | — | 0.2% | 2% | 4% |
| Premium seed | — | — | — | 0.1% |

## 9. Coin sinks and fees

| Flow | Rate |
|---|---|
| Seed pack spend | Fully burnt (no staking cut) |
| P2P market purchase | 5% burnt |
| Referral cashback | 1% to the sponsor |
| Valley upgrades | Burnt |

---

## 10. Recommended scope for our version

**MVP**
1. Farm grid (15 open plots, plus 15 that unlock by level). Each plot shows 5 growth stages and a
   hover tooltip with the timer and reward.
2. Vendor with 4 pack tiers, the drop table above and a reveal animation.
3. Coin and gem balances.
4. Gem earning (Epic/Legendary harvests, level-ups, chests) and the "finish now" sink.
5. Valley levels 0–35: cost curve, +0.10% RTP per level (capped at 99.0%), extra plots.
6. Inventory: seeds and produce. XP counter.
7. Daily chest by level tier.

**Phase 2**
8. The other gem sinks: crop swap, gem plots, extra chest, cosmetics.
9. Potions Master crafting with the 3 consumables.
10. Weekly leaderboard tasks (with gem prizes).
11. P2P market with a burn fee.

**Open decisions**
- Coin faucet sizes (starter grant, chest seeds) from §4.
- If this ships on Frontporch, use the site's existing gems instead of a separate in-game gem.
- Real token vs. play currency. A real-money random seed pack is legally a loot box or gambling
  mechanic. A play currency (or an existing site currency) avoids that.
- Name, art direction and crop roster (we can keep real crops, just draw our own sprites).
