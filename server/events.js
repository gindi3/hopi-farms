// Auctions and lotteries, paid in gems. The dev lists a prize from the dashboard; players bid
// on auctions or buy lottery tickets with gems, and the server settles each one when it ends.
//
// Auction: a bid is held from the bidder's gems right away. When someone outbids them, the
//   held gems go back. The top bid when time runs out wins (those gems are spent). A bid in
//   the last 2 minutes pushes the end back to 2 minutes from then, so nobody can snipe.
// Lottery: tickets cost gems and are spent when bought. At the end the server draws the
//   winners, each ticket an equal chance, one prize per player, with crypto.randomInt.
// Cancelling either one refunds every gem that went into it.

import { randomInt } from 'node:crypto';
import * as G from '../js/game.js';

export const SNIPE_MS = 2 * 60e3;
const MAX_TICKETS_PER_BUY = 1000;
const MAX_GEMS = 10_000_000;

export function createEvents({ store, ok, bad, loadFarm, log = console }) {
  const db = store.raw;
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY,
      kind          TEXT NOT NULL,              -- 'auction' | 'lottery'
      title         TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      image         TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'live', -- live | ended | cancelled
      starts_at     INTEGER NOT NULL,
      ends_at       INTEGER NOT NULL,
      created_at    INTEGER NOT NULL,
      created_by    TEXT,
      start_bid     INTEGER,                    -- auction
      min_step      INTEGER,                    -- auction
      ticket_price  INTEGER,                    -- lottery
      max_tickets   INTEGER,                    -- lottery: per player, 0 = no limit
      winners_count INTEGER,                    -- lottery
      winners       TEXT,                       -- JSON [{ userId, name, tickets? , amount? }]
      settled_at    INTEGER,
      delivered     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bids (
      id        INTEGER PRIMARY KEY,
      event_id  INTEGER NOT NULL REFERENCES events(id),
      user_id   INTEGER NOT NULL REFERENCES users(id),
      amount    INTEGER NOT NULL,
      at        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bids_event ON bids (event_id, amount DESC);
    CREATE TABLE IF NOT EXISTS tickets (
      event_id  INTEGER NOT NULL REFERENCES events(id),
      user_id   INTEGER NOT NULL REFERENCES users(id),
      count     INTEGER NOT NULL,
      PRIMARY KEY (event_id, user_id)
    );
  `);
  const q = {
    insert: db.prepare(`INSERT INTO events (kind, title, description, image, starts_at, ends_at, created_at, created_by,
      start_bid, min_step, ticket_price, max_tickets, winners_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    byId: db.prepare('SELECT * FROM events WHERE id = ?'),
    visible: db.prepare(`SELECT * FROM events WHERE status = 'live' OR (status = 'ended' AND settled_at > ?) ORDER BY status = 'live' DESC, ends_at ASC`),
    all: db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 100'),
    due: db.prepare(`SELECT * FROM events WHERE status = 'live' AND ends_at <= ?`),
    setEnd: db.prepare('UPDATE events SET ends_at = ? WHERE id = ?'),
    settle: db.prepare('UPDATE events SET status = ?, winners = ?, settled_at = ? WHERE id = ?'),
    delivered: db.prepare('UPDATE events SET delivered = ? WHERE id = ?'),
    topBid: db.prepare(`SELECT b.*, u.username FROM bids b JOIN users u ON u.id = b.user_id WHERE event_id = ? ORDER BY amount DESC, id ASC LIMIT 1`),
    recentBids: db.prepare(`SELECT b.amount, b.at, u.username FROM bids b JOIN users u ON u.id = b.user_id WHERE event_id = ? ORDER BY b.id DESC LIMIT ?`),
    bidCount: db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS people FROM bids WHERE event_id = ?'),
    addBid: db.prepare('INSERT INTO bids (event_id, user_id, amount, at) VALUES (?, ?, ?, ?)'),
    ticketsOf: db.prepare('SELECT count FROM tickets WHERE event_id = ? AND user_id = ?'),
    ticketTotals: db.prepare('SELECT COALESCE(SUM(count), 0) AS total, COUNT(*) AS people FROM tickets WHERE event_id = ?'),
    allTickets: db.prepare(`SELECT t.user_id, t.count, u.username FROM tickets t JOIN users u ON u.id = t.user_id WHERE event_id = ? ORDER BY t.user_id`),
    addTickets: db.prepare(`INSERT INTO tickets (event_id, user_id, count) VALUES (?, ?, ?)
      ON CONFLICT (event_id, user_id) DO UPDATE SET count = count + excluded.count`),
  };

  // Add or take gems from one player. Call inside store.tx.
  function adjustGems(userId, delta, now, field) {
    const state = loadFarm(userId);
    if (state.gems + delta < 0) throw new G.GameError(`You only have ${state.gems} gems.`);
    state.gems += delta;
    if (field) state.stats[field] = (state.stats[field] || 0) + Math.abs(delta);
    store.putFarm(userId, state, now);
    return state;
  }

  // --- Settling ---------------------------------------------------------------

  function settleOne(ev, now) {
    let winners = [];
    if (ev.kind === 'auction') {
      const top = q.topBid.get(ev.id);
      if (top) winners = [{ userId: top.user_id, name: top.username, amount: top.amount }];
    } else {
      // Draw without replacement: each ticket is one chance, and a winner's tickets leave the pool.
      const pool = q.allTickets.all(ev.id);
      while (winners.length < ev.winners_count && pool.length) {
        const total = pool.reduce((a, t) => a + t.count, 0);
        let r = randomInt(0, total);
        const i = pool.findIndex(t => (r -= t.count) < 0);
        const [w] = pool.splice(i, 1);
        winners.push({ userId: w.user_id, name: w.username, tickets: w.count });
      }
    }
    q.settle.run('ended', JSON.stringify(winners), now, ev.id);
    log.info?.(`${ev.kind} #${ev.id} "${ev.title}" ended: ${winners.map(w => w.name).join(', ') || 'no winner'}`);
  }

  function settleDue(now = Date.now()) {
    for (const ev of q.due.all(now)) {
      try { store.tx(() => { const fresh = q.byId.get(ev.id); if (fresh.status === 'live') settleOne(fresh, now); }); } catch (e) { log.error(e); }
    }
  }
  const timer = setInterval(() => settleDue(), 5000);
  timer.unref?.();

  // --- Views ------------------------------------------------------------------

  function publicView(ev, userId) {
    const out = {
      id: ev.id, kind: ev.kind, title: ev.title, description: ev.description, image: ev.image,
      status: ev.status, startsAt: ev.starts_at, endsAt: ev.ends_at,
      winners: ev.winners ? JSON.parse(ev.winners).map(w => ({ name: w.name, amount: w.amount, tickets: w.tickets, you: w.userId === userId })) : [],
    };
    if (ev.kind === 'auction') {
      const top = q.topBid.get(ev.id);
      const c = q.bidCount.get(ev.id);
      Object.assign(out, {
        startBid: ev.start_bid, minStep: ev.min_step,
        topBid: top ? { amount: top.amount, name: top.username, you: top.user_id === userId } : null,
        minNext: top ? top.amount + ev.min_step : ev.start_bid,
        bids: c.n, bidders: c.people,
        recent: q.recentBids.all(ev.id, 8).map(b => ({ amount: b.amount, at: b.at, name: b.username })),
      });
    } else {
      const t = q.ticketTotals.get(ev.id);
      Object.assign(out, {
        ticketPrice: ev.ticket_price, maxTickets: ev.max_tickets, winnersCount: ev.winners_count,
        totalTickets: t.total, entrants: t.people, myTickets: userId ? (q.ticketsOf.get(ev.id, userId)?.count || 0) : 0,
      });
    }
    return out;
  }

  const list = (userId, now) => q.visible.all(now - 7 * 86400e3).map(ev => publicView(ev, userId));
  const isLive = (ev, now) => ev && ev.status === 'live' && now >= ev.starts_at && now < ev.ends_at;
  const wrap = (fn) => {
    try { return fn(); } catch (e) {
      if (e instanceof G.GameError) return bad(e.message);
      throw e;
    }
  };
  const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  // --- Player routes ------------------------------------------------------------

  const routes = {
    'GET /api/events': (req, { userId }) => {
      const now = Date.now();
      settleDue(now);
      return ok({ events: list(userId, now), now });
    },

    'POST /api/events/bid': (req, { userId, body }) => wrap(() => {
      const now = Date.now();
      if (!store.userById(userId)?.username) return bad('Create an account to bid. Prizes go to account holders.');
      const amount = Number(body?.amount);
      const ev = q.byId.get(Number(body?.id));
      if (!ev || ev.kind !== 'auction') return bad('No such auction.');
      store.tx(() => {
        const fresh = q.byId.get(ev.id);
        if (!isLive(fresh, now)) throw new G.GameError('This auction is not open for bids.');
        const top = q.topBid.get(ev.id);
        const min = top ? top.amount + fresh.min_step : fresh.start_bid;
        if (!intIn(amount, min, MAX_GEMS)) throw new G.GameError(`Bid at least ${min} gems.`);
        if (top && top.user_id === userId) {
          adjustGems(userId, -(amount - top.amount), now, 'gemsBid');      // raising your own bid
        } else {
          adjustGems(userId, -amount, now, 'gemsBid');
          if (top) adjustGems(top.user_id, top.amount, now, 'gemsRefunded');   // outbid: hand theirs back
        }
        q.addBid.run(ev.id, userId, amount, now);
        if (fresh.ends_at - now < SNIPE_MS) q.setEnd.run(now + SNIPE_MS, ev.id);
      });
      return ok({ event: publicView(q.byId.get(ev.id), userId), state: loadFarm(userId) });
    }),

    'POST /api/events/enter': (req, { userId, body }) => wrap(() => {
      const now = Date.now();
      if (!store.userById(userId)?.username) return bad('Create an account to enter. Prizes go to account holders.');
      const count = Number(body?.count);
      const ev = q.byId.get(Number(body?.id));
      if (!ev || ev.kind !== 'lottery') return bad('No such lottery.');
      if (!intIn(count, 1, MAX_TICKETS_PER_BUY)) return bad(`Buy 1 to ${MAX_TICKETS_PER_BUY} tickets at a time.`);
      store.tx(() => {
        const fresh = q.byId.get(ev.id);
        if (!isLive(fresh, now)) throw new G.GameError('This lottery is not open.');
        const have = q.ticketsOf.get(ev.id, userId)?.count || 0;
        if (fresh.max_tickets && have + count > fresh.max_tickets) {
          throw new G.GameError(`You can hold at most ${fresh.max_tickets} tickets${have ? ` (you have ${have})` : ''}.`);
        }
        adjustGems(userId, -count * fresh.ticket_price, now, 'gemsTickets');
        q.addTickets.run(ev.id, userId, count);
      });
      return ok({ event: publicView(q.byId.get(ev.id), userId), state: loadFarm(userId) });
    }),
  };

  // --- Admin routes -------------------------------------------------------------

  const adminName = (userId) => store.userById(userId)?.username || `#${userId}`;
  const adminView = (ev) => ({
    ...publicView(ev, null),
    createdAt: ev.created_at, createdBy: ev.created_by, settledAt: ev.settled_at, delivered: Boolean(ev.delivered),
    winners: ev.winners ? JSON.parse(ev.winners) : [],
    ...(ev.kind === 'lottery' ? { entries: q.allTickets.all(ev.id).map(t => ({ name: t.username, tickets: t.count })) } : {}),
  });

  function validateNew(b, now) {
    const errors = [];
    const title = String(b?.title ?? '').trim();
    if (!title || title.length > 80) errors.push('Give it a title (up to 80 characters).');
    if (String(b?.description ?? '').length > 1000) errors.push('The description is too long (max 1,000).');
    const image = String(b?.image ?? '').trim();
    if (image && !/^https:\/\/[^\s"'<>]+$/.test(image)) errors.push('The picture must be an https:// link.');
    const startsAt = b?.startsAt ? Number(b.startsAt) : now;
    const endsAt = Number(b?.endsAt);
    if (!Number.isFinite(endsAt) || endsAt <= Math.max(now, startsAt) + 60e3) errors.push('The end time must be at least a minute after it starts.');
    if (endsAt - startsAt > 90 * 86400e3) errors.push('It can run for at most 90 days.');
    if (b?.kind === 'auction') {
      if (!intIn(b.startBid, 1, MAX_GEMS)) errors.push('Starting bid must be a whole number of gems, at least 1.');
      if (!intIn(b.minStep, 1, MAX_GEMS)) errors.push('Minimum raise must be a whole number of gems, at least 1.');
    } else if (b?.kind === 'lottery') {
      if (!intIn(b.ticketPrice, 1, MAX_GEMS)) errors.push('Ticket price must be a whole number of gems, at least 1.');
      if (!intIn(b.maxTickets ?? 0, 0, 1e6)) errors.push('Max tickets per player must be 0 (no limit) or more.');
      if (!intIn(b.winnersCount, 1, 100)) errors.push('Winners must be 1 to 100.');
    } else errors.push('Pick auction or lottery.');
    return { errors, title, image, startsAt, endsAt };
  }

  const adminRoutes = {
    'GET /api/admin/events': () => { settleDue(); return ok({ events: q.all.all().map(adminView), now: Date.now() }); },

    'POST /api/admin/events': (req, { userId, body }) => {
      const now = Date.now();
      const { errors, title, image, startsAt, endsAt } = validateNew(body, now);
      if (errors.length) return bad(errors.join(' '));
      const a = body.kind === 'auction';
      const id = Number(q.insert.run(body.kind, title, String(body.description || '').trim(), image, startsAt, endsAt, now, adminName(userId),
        a ? body.startBid : null, a ? body.minStep : null, a ? null : body.ticketPrice, a ? null : (body.maxTickets || 0), a ? null : body.winnersCount).lastInsertRowid);
      store.addLog(adminName(userId), `create ${body.kind}`, [`#${id} ${title}`], now);
      return ok({ event: adminView(q.byId.get(id)) });
    },

    // End early: settle right now with whatever bids or tickets are in.
    'POST /api/admin/events/end': (req, { userId, body }) => wrap(() => {
      const now = Date.now();
      const ev = q.byId.get(Number(body?.id));
      if (!ev || ev.status !== 'live') return bad('Only a live auction or lottery can be ended.');
      store.tx(() => { q.setEnd.run(now, ev.id); settleOne(q.byId.get(ev.id), now); });
      store.addLog(adminName(userId), `end ${ev.kind} early`, [`#${ev.id} ${ev.title}`], now);
      return ok({ event: adminView(q.byId.get(ev.id)) });
    }),

    // Cancel: no winner, and every gem spent on it goes back.
    'POST /api/admin/events/cancel': (req, { userId, body }) => wrap(() => {
      const now = Date.now();
      const ev = q.byId.get(Number(body?.id));
      if (!ev || ev.status !== 'live') return bad('Only a live auction or lottery can be cancelled.');
      let refunded = 0;
      store.tx(() => {
        if (ev.kind === 'auction') {
          const top = q.topBid.get(ev.id);
          if (top) { adjustGems(top.user_id, top.amount, now, 'gemsRefunded'); refunded += top.amount; }
        } else {
          for (const t of q.allTickets.all(ev.id)) {
            const gems = t.count * ev.ticket_price;
            adjustGems(t.user_id, gems, now, 'gemsRefunded');
            refunded += gems;
          }
        }
        q.settle.run('cancelled', '[]', now, ev.id);
      });
      store.addLog(adminName(userId), `cancel ${ev.kind}`, [`#${ev.id} ${ev.title}`, `refunded ${refunded} gems`], now);
      return ok({ event: adminView(q.byId.get(ev.id)), refunded });
    }),

    'POST /api/admin/events/delivered': (req, { userId, body }) => {
      const ev = q.byId.get(Number(body?.id));
      if (!ev || ev.status !== 'ended') return bad('Only an ended auction or lottery can be marked delivered.');
      q.delivered.run(body?.delivered ? 1 : 0, ev.id);
      store.addLog(adminName(userId), body?.delivered ? 'prize delivered' : 'prize not delivered', [`#${ev.id} ${ev.title}`], Date.now());
      return ok({ event: adminView(q.byId.get(ev.id)) });
    },
  };

  return { routes, adminRoutes, settleDue, stop: () => clearInterval(timer) };
}
