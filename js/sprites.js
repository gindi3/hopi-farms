// Original pixel art, drawn in code. Shapes are described on a 16×16 grid but rendered at
// 32×32 (R = 2), so curves are smoother and shading and outlines are one fine pixel wide.
// Outlines take a darkened tint of the colour they border, rather than flat black.

import { CROP } from './data.js';

const G16 = 16;             // design grid that shape coordinates use
const R = 2;                // render pixels per design pixel
const W = G16 * R;          // rendered sprite size
const OUTLINE_DARK = '#2a170d';
const LEAF = ['#6cbf4a', '#3e8a2e', '#a6e07a'];
const SOIL = ['#8a5a32', '#5e3a1e', '#b07a4a'];
const BROWN = '#6b4a22';

// --- Colour helpers ------------------------------------------------------------

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = hex(a), B = hex(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
export const darken = (c, t) => mix(c, OUTLINE_DARK, t);

class Px {
  constructor() { this.c = new Array(W * W).fill(null); }
  in(x, y) { return x >= 0 && y >= 0 && x < W && y < W; }
  // set/line take design-grid coordinates and paint R×R blocks.
  set(x, y, col) {
    for (let dy = 0; dy < R; dy++) for (let dx = 0; dx < R; dx++) {
      const X = x * R + dx, Y = y * R + dy;
      if (this.in(X, Y)) this.c[Y * W + X] = col;
    }
  }
  line(x0, y0, x1, y1, col) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) {
      this.set(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), col);
    }
  }
  // Fill every render pixel whose centre passes `test` (in design coordinates). Shading:
  // a light rim on the top/left, a two-step shadow on the bottom/right.
  layer(test, [base, shadow, hi]) {
    const m = new Set();
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (test((x + 0.5) / R, (y + 0.5) / R)) m.add(y * W + x);
    }
    const has = (x, y) => this.in(x, y) && m.has(y * W + x);
    const mid = mix(base, shadow, 0.5);
    for (const k of m) {
      const x = k % W, y = (k - x) / W;
      let col = base;
      if (!has(x, y + 1) || !has(x + 1, y)) col = shadow;
      else if (!has(x, y + 2) || !has(x + 2, y)) col = mid;
      else if (!has(x, y - 1) || !has(x - 1, y)) col = hi;
      this.c[k] = col;
    }
    return m;
  }
  // Paint `col` over pixels of an existing mask whose design-grid cell passes `test`.
  within(mask, test, col) {
    for (const k of mask) {
      const x = k % W, y = (k - x) / W;
      if (test(Math.floor(x / R), Math.floor(y / R))) this.c[k] = col;
    }
  }
  // One-pixel outline tinted from the neighbouring colour.
  outline() {
    const src = this.c.slice();
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      if (src[y * W + x]) continue;
      for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
        const xx = x + dx, yy = y + dy;
        const nb = this.in(xx, yy) && src[yy * W + xx];
        if (nb) { this.c[y * W + x] = darken(nb, 0.72); break; }
      }
    }
    return this;
  }
  toDataURL() {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = W;
    const ctx = cv.getContext('2d');
    for (let i = 0; i < this.c.length; i++) {
      if (!this.c[i]) continue;
      ctx.fillStyle = this.c[i];
      ctx.fillRect(i % W, Math.floor(i / W), 1, 1);
    }
    return cv.toDataURL();
  }
}

const ell = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const box = (x0, y0, x1, y1) => (x, y) => {
  const i = Math.floor(x), j = Math.floor(y);
  return i >= x0 && i <= x1 && j >= y0 && j <= y1;
};
const any = (...fs) => (x, y) => fs.some(f => f(x, y));
const not = (f) => (x, y) => !f(x, y);
const all = (...fs) => (x, y) => fs.every(f => f(x, y));

// --- Crops -------------------------------------------------------------------

const SHAPES = {
  tuber(p, c) {
    const m = p.layer(ell(8, 9.5, 5.6, 4.2), c);
    p.within(m, (x, y) => (x === 6 && y === 9) || (x === 10 && y === 8) || (x === 9 && y === 11), c[1]);
  },
  leafy(p, c) {
    p.layer(ell(4.8, 9, 3, 4.6), c);
    p.layer(ell(11.2, 9, 3, 4.6), c);
    const m = p.layer(ell(8, 7.5, 3.4, 6), c);
    p.within(m, (x, y) => x === 8 && y > 3 && y < 13, c[1]);
  },
  head(p, c) {
    const m = p.layer(ell(8, 9, 6, 5.5), c);
    p.within(m, (x, y) => (x === 8 && y > 4 && y < 13) || (y === 9 && (x === 5 || x === 11)) ||
      (y === 7 && (x === 6 || x === 10)), c[1]);
  },
  bulb(p, c) {
    p.line(7, 1, 7, 4, LEAF[0]); p.line(9, 0, 9, 4, LEAF[1]);
    p.layer(any(ell(8, 10.5, 4.8, 4.2), (x, y) => y >= 4.5 && y < 8 && Math.abs(x - 8) <= (y - 4.5) * 1.1 + 0.6), c);
    p.set(7, 14, c[1]); p.set(9, 14, c[1]);
  },
  root(p, c) {
    p.layer(ell(6, 3, 2, 2.2), LEAF);
    p.layer(ell(10, 3, 2, 2.2), LEAF);
    p.layer(any(ell(8, 8.5, 4.6, 4.2), box(7, 12, 8, 13)), c);
    p.set(8, 14, c[1]);
  },
  grain(p, c) {
    for (const x of [5, 8, 11]) p.line(x, 7, x, 14, c[1]);
    p.layer(ell(5, 5, 1.7, 3), c);
    p.layer(ell(8, 4, 1.7, 3.5), c);
    p.layer(ell(11, 5, 1.7, 3), c);
  },
  round(p, c) {
    p.layer(ell(8, 9.5, 5.3, 4.8), c);
    p.set(8, 4, BROWN);
    p.layer(ell(10.5, 3.6, 2.2, 1.3), LEAF);
  },
  long(p, c) {
    p.layer(ell(6.2, 3, 1.3, 2.6), LEAF);
    p.layer(ell(9.8, 3, 1.3, 2.6), LEAF);
    const m = p.layer((x, y) => y >= 5 && y <= 14.6 && Math.abs(x - 8) <= (14.6 - y) * 0.36 + 0.5, c);
    p.within(m, (x, y) => (x === 7 && y === 8) || (x === 8 && y === 11), c[1]);
  },
  cob(p, c) {
    const m = p.layer(ell(8, 7.5, 3.3, 6.2), c);
    p.within(m, (x, y) => y % 2 === 0 && x % 2 === 1, c[1]);
    p.layer(ell(5, 11, 2.2, 4), LEAF);
    p.layer(ell(11, 11, 2.2, 4), LEAF);
  },
  gourd(p, c) {
    p.layer(box(7, 3, 8, 5), [BROWN, '#4a3216', '#8a6a3a']);
    p.layer(ell(10.6, 4, 1.8, 1), LEAF);
    const m = p.layer(ell(8, 10, 6.5, 4.6), c);
    p.within(m, (x, y) => (x === 5 || x === 8 || x === 11) && y > 7 && y < 13, c[1]);
  },
  pepper(p, c) {
    p.line(7, 1, 7, 3, LEAF[1]); p.set(8, 1, LEAF[0]);
    p.layer(any(ell(7, 6, 2.7, 2.6), ell(8.2, 9.2, 2.5, 2.6), ell(9.6, 12, 1.8, 2)), c);
  },
  stalks(p, c) {
    p.layer(box(4, 6, 5, 14), c);
    p.layer(box(7, 5, 8, 14), c);
    p.layer(box(10, 6, 11, 14), c);
    p.layer(ell(5, 4, 2, 2), LEAF);
    p.layer(ell(8, 3, 2.3, 2.3), LEAF);
    p.layer(ell(11, 4, 2, 2), LEAF);
  },
  floret(p, c) {
    p.layer(ell(3.5, 11, 2, 3), LEAF);
    p.layer(ell(12.5, 11, 2, 3), LEAF);
    p.layer(box(7, 10, 9, 14), ['#9ed86e', '#5e9c3a', '#d8f4b4']);
    p.layer(any(ell(5, 7, 2.9, 2.9), ell(11, 7, 2.9, 2.9), ell(8, 5, 3.3, 3), ell(8, 8.6, 3, 2.4)), c);
  },
  berries(p, c) {
    p.layer(ell(8, 3, 2.6, 1.3), LEAF);
    for (const [x, y] of [[8, 6.8], [5.4, 10.4], [10.6, 10.4]]) {
      const m = p.layer(ell(x, y, 2.7, 2.7), c);
      p.within(m, (px, py) => px === Math.floor(x) - 1 && py === Math.floor(y) - 1, c[2]);
    }
  },
  cluster(p, c) {
    p.line(8, 1, 8, 3, BROWN); p.set(9, 2, BROWN);
    p.layer(ell(11, 2.4, 2.2, 1.2), LEAF);
    for (const [x, y] of [[4.6, 5.6], [8, 5.6], [11.4, 5.6], [6.3, 8.8], [9.7, 8.8], [8, 12]]) {
      p.layer(ell(x, y, 2, 2), c);
    }
  },
  banana(p, c) {
    p.layer(all(ell(8, 5, 6.4, 8.4), not(ell(8, 2.6, 5.8, 8.2)), (x, y) => y > 5), c);
    p.set(2, 6, BROWN); p.set(13, 6, BROWN);
  },
  pear(p, c) {
    p.line(8, 1, 8, 2, BROWN);
    p.layer(ell(10, 2.5, 1.8, 1), LEAF);
    const m = p.layer(any(ell(8, 6, 3, 3), ell(8, 10.5, 4.8, 4)), c);
    p.within(m, (x, y) => x >= 7 && x <= 8 && y >= 10 && y <= 11, c[1]);
  },
  pineapple(p, c) {
    for (const [x0, y0] of [[8, 0], [6, 1], [10, 1], [4, 3], [12, 3]]) p.line(x0, y0, 8 + Math.sign(x0 - 8), 5, LEAF[0]);
    const m = p.layer(ell(8, 10.5, 4.6, 4.5), c);
    p.within(m, (x, y) => (x + y) % 3 === 0, c[1]);
  },
  flower(p, c) {
    for (const x of [5, 8, 11]) p.line(x, 8, 8, 14, LEAF[1]);
    p.layer(ell(5, 5, 1.4, 3.2), c);
    p.layer(ell(8, 4, 1.4, 3.4), c);
    p.layer(ell(11, 5, 1.4, 3.2), c);
  },
  dragon(p, c) {
    const m = p.layer(ell(8, 9, 5.2, 5.2), c);
    p.within(m, (x, y) => (x === 6 && y === 8) || (x === 10 && y === 10) || (x === 8 && y === 12), c[2]);
    for (const [x, y] of [[3, 6], [13, 6], [5, 3], [11, 3], [8, 2], [3, 12], [13, 12]]) {
      p.set(x, y, LEAF[0]); p.set(x, y + 1, LEAF[1]);
    }
  },
};

function cropPx(id) {
  const crop = CROP[id];
  const p = new Px();
  SHAPES[crop.shape](p, crop.colors);
  return p.outline();
}

// --- Growth stages (0–3; stage 4 shows the crop itself) -----------------------

function stagePx(n) {
  const p = new Px();
  if (n === 3) {
    p.layer(any(ell(8, 7.5, 4.6, 3.6), ell(4.8, 9.6, 2.6, 2), ell(11.2, 9.6, 2.6, 2)), LEAF);
  }
  p.layer(ell(8, 12.5, 4.4, 1.9), SOIL);
  if (n === 0) {
    p.set(8, 11, '#e8d8a0'); p.set(7, 12, SOIL[2]);
  } else if (n === 1) {
    p.line(8, 9, 8, 11, LEAF[1]); p.set(7, 9, LEAF[0]); p.set(9, 8, LEAF[0]);
  } else if (n === 2) {
    p.line(8, 7, 8, 11, LEAF[1]);
    p.layer(ell(5.8, 7.6, 2.2, 1.3), LEAF);
    p.layer(ell(10.2, 6.6, 2.2, 1.3), LEAF);
  }
  return p.outline();
}

// --- Icons -------------------------------------------------------------------

const TIER_BAG = {
  feeble: ['#b8b4a8', '#7e7a6e', '#e2ded2'],
  pico: ['#b07a4a', '#7a5030', '#d8a878'],
  basic: ['#d8883a', '#9e5a1c', '#f5b878'],
  premium: ['#f0c440', '#b08a1c', '#fff0a0'],
};
const CHEST_METAL = {
  wooden: ['#c8a070', '#8a6a40', '#ecd0a0'],
  bronze: ['#cd7f32', '#8e5420', '#efb070'],
  silver: ['#c8d0d8', '#86909c', '#f2f6fa'],
  gold: ['#f2c94c', '#b88a1c', '#fff0a0'],
};

const ICONS = {
  coin(p) {
    p.layer(ell(8, 8, 5.6, 5.6), ['#f2c94c', '#b88a1c', '#fff0a0']);
    p.layer(ell(8, 8, 3, 3), ['#e0b030', '#f7dc70', '#b88a1c']);
  },
  gem(p) {
    const m = p.layer((x, y) => y >= 3 && y <= 13.5 &&
      (y < 7 ? Math.abs(x - 8) <= 5.6 - (7 - y) * 1.1 : Math.abs(x - 8) <= (13.5 - y) * 0.86), ['#5ad8e8', '#2a8aa8', '#c8f7ff']);
    p.within(m, (x, y) => y === 6 || (x === 8 && y > 6 && y < 12), '#c8f7ff');
  },
  lock(p) {
    p.layer(all(ell(8, 6.5, 3.8, 4.2), not(ell(8, 6.5, 2.1, 2.6)), (x, y) => y < 8), ['#a8b0b8', '#6a7078', '#dce2e8']);
    p.layer(box(4, 7, 11, 13), ['#c8a040', '#8a6a20', '#f0d070']);
    p.line(8, 9, 8, 11, '#4a3216');
  },
  xp(p) {
    p.layer((x, y) => {
      const dx = Math.abs(x - 8), dy = Math.abs(y - 8);
      return dx + dy <= 6 && (dx <= 1.4 || dy <= 1.4 || Math.abs(dx - dy) <= 1);
    }, ['#8fd16a', '#4e9a3a', '#d6f7b0']);
  },
  elixir(p) {
    p.layer(box(7, 1, 8, 2), [BROWN, '#4a3216', '#8a6a3a']);
    p.layer(any(ell(8, 10.5, 4.2, 3.7), box(7, 3, 8, 7)), ['#7ad87a', '#3e9a4a', '#c8f7c8']);
  },
  pesticide(p) {
    p.layer(box(7, 2, 9, 4), ['#d84a3a', '#982a22', '#f58a7a']);
    p.layer(box(5, 5, 10, 14), ['#dcdcd2', '#9a9a90', '#ffffff']);
    p.line(6, 9, 9, 9, '#d84a3a');
  },
  fertilizer(p) {
    p.layer(any(box(4, 5, 11, 14), ell(8, 4.5, 3, 1.6)), ['#8a7a4a', '#5e5230', '#b8a878']);
    p.layer(ell(8, 10, 2, 2), LEAF);
  },
  farmer(p) {
    p.layer(box(6, 14, 7, 15), [BROWN, '#4a3216', '#8a6a3a']);
    p.layer(box(9, 14, 10, 15), [BROWN, '#4a3216', '#8a6a3a']);
    p.layer(box(4, 8, 11, 10), ['#d85a3a', '#a03a22', '#f08a6a']);
    p.layer(box(6, 10, 10, 13), ['#4a6ad8', '#2a3e96', '#7a9af0']);
    p.set(6, 8, '#4a6ad8'); p.set(10, 8, '#4a6ad8');
    p.layer(box(6, 4, 10, 7), ['#f0c090', '#c08a5a', '#ffe0b8']);
    p.set(7, 5, '#3a2416'); p.set(9, 5, '#3a2416'); p.set(8, 7, '#c08a5a');
    p.layer(any(ell(8, 3.6, 6.4, 1.5), box(5, 1, 10, 3)), ['#e8c25a', '#b08a30', '#f7e2a0']);
    p.line(5, 3, 10, 3, '#c85a3a');
  },
  bush(p) {
    p.layer(any(ell(8, 9, 6.6, 5), ell(5, 7, 3.5, 3), ell(11, 7, 3.5, 3)), ['#4fa040', '#2e6a2c', '#86cc72']);
  },
  flowerpot(p) {
    p.layer(ell(8, 12, 5, 2.4), ['#5a9a3c', '#2e6a2c', '#86cc72']);
    for (const [x, y, col] of [[5, 10, '#f5f0e8'], [8, 9, '#f2c94c'], [11, 10, '#f5f0e8']]) {
      p.layer(ell(x, y, 1.6, 1.6), [col, '#c8bfa4', '#ffffff']);
    }
  },
};
// Plot markers: a wooden board on a post (empty), and a red-rimmed board with a padlock (locked).
ICONS.plot_sign = (p) => {
  p.layer(box(7, 9, 8, 14), [BROWN, '#4a3216', '#8a6a3a']);
  p.layer(box(2, 3, 13, 9), ['#f3e2c0', '#d8be8e', '#fff6e0']);
};
ICONS.plot_lock = (p) => {
  p.layer(box(7, 10, 8, 14), [BROWN, '#4a3216', '#8a6a3a']);
  p.layer(box(1, 2, 14, 11), ['#a84a32', '#6e2a1c', '#d07050']);
  p.layer(box(3, 4, 12, 9), ['#e8d8b8', '#c8b490', '#fff6e0']);
  p.layer(all(ell(8, 5.4, 2.2, 2.4), not(ell(8, 5.4, 1, 1.3)), (x, y) => y < 6.5), ['#6a7078', '#4a5058', '#a8b0b8']);
  p.layer(box(6, 6, 9, 8), ['#4a4e56', '#2e3238', '#7a808a']);
};
for (const [tier, col] of Object.entries(TIER_BAG)) {
  ICONS[`pack_${tier}`] = (p) => {
    p.layer(any(box(4, 5, 11, 14), ell(8, 4.2, 3.2, 1.8)), col);
    p.line(5, 5, 10, 5, col[1]);
    p.layer(ell(8, 10, 2.4, 2.4), ['#f5eee0', '#c8bfa4', '#ffffff']);
    p.set(8, 10, '#6b4a22');
  };
}
for (const [chest, metal] of Object.entries(CHEST_METAL)) {
  ICONS[`chest_${chest}`] = (p) => {
    p.layer(box(2, 7, 13, 13), ['#9a6a3a', '#6a4422', '#c89060']);
    p.layer(box(2, 3, 13, 6), ['#a8784a', '#6a4422', '#d4a070']);
    p.line(2, 6, 13, 6, metal[1]);
    p.layer(box(2, 3, 3, 13), metal);
    p.layer(box(12, 3, 13, 13), metal);
    p.layer(box(7, 6, 8, 9), metal);
  };
}

// --- Public API --------------------------------------------------------------

const cache = new Map();

export function spriteUrl(key) {
  if (cache.has(key)) return cache.get(key);
  let p;
  if (key.startsWith('crop:')) p = cropPx(key.slice(5));
  else if (key.startsWith('stage:')) p = stagePx(Number(key.slice(6)));
  else if (ICONS[key]) { p = new Px(); ICONS[key](p); p.outline(); }
  else throw new Error(`Unknown sprite ${key}`);
  const url = p.toDataURL();
  cache.set(key, url);
  return url;
}

// 14×14 nine-slice images for pixel UI panels and buttons (slice 5px). `rings` are the colours
// from the outside in; `shade` replaces the inner rings along the bottom edge for a 3D lip.
const EDGE = '#4a2a17';     // soft dark-brown outline, like the sprites'
const UI = {
  panel:  { rings: [EDGE, '#f0bc7c', '#c88a52', '#a06a3a', '#6b4424'], fill: '#f4e3c1' },
  slot:   { rings: [EDGE, '#c8ac7a', '#e8d4ac', '#efdcb6', '#efdcb6'], fill: '#f8ecd2' },
  wood:   { rings: [EDGE, '#f0bc7c', '#c88a52', '#c88a52', '#c88a52'], fill: '#c88a52', shade: '#8a5530' },
  blue:   { rings: [EDGE, '#b8c6f5', '#7484cc', '#7484cc', '#7484cc'], fill: '#7484cc', shade: '#4a5694' },
  orange: { rings: [EDGE, '#ffd894', '#f5a040', '#f5a040', '#f5a040'], fill: '#f5a040', shade: '#c06a1e' },
  cream:  { rings: [EDGE, '#fffaea', '#f4e3c1', '#f4e3c1', '#f4e3c1'], fill: '#f4e3c1', shade: '#cdb07c' },
  gem:    { rings: [EDGE, '#d2f8ff', '#72d4e6', '#72d4e6', '#72d4e6'], fill: '#72d4e6', shade: '#2e8eac' },
  pill:   { rings: [EDGE, '#b8c6f5', '#6676b8', '#4a5694', '#3a447a'], fill: '#f4e3c1' },
  sign:   { rings: [EDGE, '#f5cf98', '#cc9058', '#cc9058', '#8a5530'], fill: '#cc9058' },
};

export function uiSlice(kind) {
  const key = `ui:${kind}`;
  if (cache.has(key)) return cache.get(key);
  const { rings, fill, shade } = UI[kind];
  const n = 14, depth = rings.length;
  const cv = document.createElement('canvas');
  cv.width = n; cv.height = n;
  const ctx = cv.getContext('2d');
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const ex = Math.min(x, n - 1 - x), ey = Math.min(y, n - 1 - y);
    if (ex + ey <= 1) continue;                      // cut three corner pixels
    let col;
    if (ex + ey === 2) col = rings[0];               // outline the rounded corner
    else {
      const d = Math.min(ex, ey);
      col = d < depth ? rings[d] : fill;
      if (shade && d >= 2 && d < depth && n - 1 - y === d && ex >= d) col = shade;
    }
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }
  const url = cv.toDataURL();
  cache.set(key, url);
  return url;
}

// Sprites are 32×32; below that they're scaled down smoothly instead of dropping pixels.
export function spriteImg(key, size = 32, cls = '', alt = '') {
  const smooth = size < W ? ' smooth' : '';
  return `<img class="px${smooth} ${cls}" src="${spriteUrl(key)}" width="${size}" height="${size}" alt="${alt}" draggable="false">`;
}
