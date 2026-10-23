// Editable docs content: what the admin dashboard can change on /docs, with its defaults,
// a validator (the server rejects anything else) and a small, safe Markdown renderer.
// Number tables on the docs pages are built from the live economy and aren't editable here.

export const DOCS_LIMITS = { title: 60, lead: 400, text: 20000, prizes: 20, custom: 30, field: 200 };
export const DOCS_GROUPS = ['Getting Started', 'The Game', 'Wallet', 'Help'];

// The built-in pages, for the editor's page picker (keep in step with BUILT_IN in docs.js).
export const DOCS_PAGES = [
  ['introduction', 'Introduction', 'Getting Started'], ['game-loop', 'Game Loop', 'Getting Started'],
  ['official-links', 'Official Links', 'Getting Started'], ['crop-token', '$CROP', 'The Game'],
  ['seed-packs', 'Seed Packs', 'The Game'], ['crops', 'Crops & Rarities', 'The Game'],
  ['farming', 'Planting & Harvesting', 'The Game'], ['gems', 'Gems', 'The Game'],
  ['levels', 'Levels & RTP', 'The Game'], ['chests', 'Treasure Chests', 'The Game'],
  ['potions', 'Potions Master', 'The Game'], ['farms', 'Farms', 'The Game'],
  ['leaderboard', 'Leaderboard & Prizes', 'The Game'], ['auction-lottery', 'Auction & Lottery', 'The Game'], ['locations', 'The Valley', 'The Game'],
  ['deposits', 'Deposits', 'Wallet'], ['withdrawals', 'Withdrawals', 'Wallet'],
  ['fairness', 'Fairness', 'Help'], ['faq', 'FAQ', 'Help'],
].map(([id, title, group]) => ({ id, title, group }));

export const DEFAULT_DOCS = {
  // Per built-in page id: { title, lead, hidden, extra } (all optional).
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
// Supports: ## and ### headings, paragraphs, - and 1. lists, > tip boxes, **bold**,
// *italic*, `code`, [links](https://…) and ![images](https://…). Everything is escaped
// first, so no raw HTML gets through.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const safeHref = (u) => /^(https?:\/\/|\/|#)/.test(u) ? u : '#';

function inline(text) {
  return esc(text)
    .replace(/!\[([^\]]*)\]\((https:\/\/[^)\s]+)\)/g, (_, alt, src) => `<img class="md-img" src="${src}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => {
      const h = safeHref(href);
      const ext = /^https?:/.test(h) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${h}"${ext}>${t}</a>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

export function renderMarkdown(src) {
  const out = [];
  let para = [], list = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of String(src || '').split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!line) { flush(); continue; }
    if ((m = /^(#{2,3})\s+(.*)$/.exec(line))) {
      flush();
      const tag = m[1].length === 2 ? 'h2' : 'h3';
      out.push(`<${tag}${tag === 'h2' ? ` id="${slug(m[2]) || 'section'}"` : ''}>${inline(m[2])}</${tag}>`);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flush();
      out.push(`<div class="hint">${inline(m[1])}</div>`);
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
