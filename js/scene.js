// Pixel-art backgrounds drawn in code at 400×240: the Farm and the Valley map. Interactive
// things (plots, the farmer, zone signs) are DOM elements placed on top at the positions
// exported here, in scene pixels.

export const SCENE_W = 400;
export const SCENE_H = 240;

const INK = '#2b1d14';
const GRASS = ['#6cae4a', '#62a243', '#78ba52', '#5a9a3e'];
const TUFT = ['#4e8a36', '#8cc85e'];
const SOIL = ['#c08654', '#b67c4a', '#ca9260', '#a8703f'];
const FURROW = ['#a06a3c', '#96603a', '#aa7444'];
const WOOD = ['#b8804a', '#7e5230', '#dca46a'];
const STONE = ['#a8a49a', '#7e7a72', '#cac6bc'];
const WALL = ['#b4b0a6', '#8a867e', '#d2cec4'];
const LEAVES = ['#4f9a3e', '#356e2c', '#7cc05a'];
const DARK_LEAVES = ['#3f8434', '#285a24', '#5fa646'];
const PINE = ['#2f7a48', '#1e5434', '#4a9a60'];
const AUTUMN = ['#e0a040', '#a8701e', '#f5c870'];
const WATER = ['#4a8ad8', '#2a5aa8', '#8ac4f5'];
const DIRT = ['#e8b47a', '#d49c62', '#f5cc96'];

// --- Farm layout -------------------------------------------------------------

export const FIELDS = [
  { x: 10, y: 38, w: 172, h: 128 },
  { x: 218, y: 38, w: 172, h: 128 },
];
const COLS = 5, ROWS = 3;

export const PLOT_SIZE = 24;
export const PLOT_POS = FIELDS.flatMap(f => {
  const ix = f.x + 8, iy = f.y + 10, iw = f.w - 16, ih = f.h - 18;
  const out = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    out.push({ x: ix + (c + 0.5) * iw / COLS, y: iy + (r + 0.5) * ih / ROWS });
  }
  return out;
});

export const FARMER_POS = { x: 200, y: 70 };
export const FARMER_SIGN_POS = { x: 200, y: 44 };

// --- Valley layout -----------------------------------------------------------

export const ZONES = [
  { id: 'house',  label: 'HOUSE',       x: 18,  y: 62,  w: 128, h: 82, sign: { x: 70,  y: 58 } },
  { id: 'market', label: 'MARKETPLACE', x: 16,  y: 152, w: 134, h: 72, sign: { x: 84,  y: 148 } },
  { id: 'farm',   label: 'FARM',        x: 248, y: 66,  w: 132, h: 86, sign: { x: 314, y: 62 } },
];

// --- Painter -----------------------------------------------------------------

function rngFrom(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function painter(canvas, seed) {
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d');
  const rnd = rngFrom(seed);
  const P = {
    rnd,
    pick: (arr) => arr[Math.floor(rnd() * arr.length)],
    px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); },
    rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
    // Shaded, outlined ellipse.
    blob(cx, cy, rx, ry, [base, shadow, hi], outline = INK) {
      for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
        for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) {
            const s = dx * 0.5 + dy;
            P.px(x, y, s > 0.45 ? shadow : s < -0.55 ? hi : base);
          } else if (outline) {
            const ox = (x + 0.5 - cx) / (rx + 1), oy = (y + 0.5 - cy) / (ry + 1);
            if (ox * ox + oy * oy <= 1) P.px(x, y, outline);
          }
        }
      }
    },
    box(x, y, w, h, [base, shadow, hi], outline = INK) {
      P.rect(x - 1, y - 1, w + 2, h + 2, outline);
      P.rect(x, y, w, h, base);
      P.rect(x, y, w, 1, hi);
      P.rect(x, y + h - 1, w, 1, shadow);
      P.rect(x + w - 1, y, 1, h, shadow);
    },
    grass() {
      for (let y = 0; y < SCENE_H; y++) for (let x = 0; x < SCENE_W; x++) {
        const r = rnd();
        P.px(x, y, r < 0.72 ? GRASS[0] : r < 0.86 ? GRASS[1] : r < 0.96 ? GRASS[2] : GRASS[3]);
      }
      for (let i = 0; i < 520; i++) {
        const x = rnd() * SCENE_W, y = rnd() * SCENE_H;
        P.px(x, y, TUFT[0]); P.px(x - 1, y - 1, TUFT[0]); P.px(x + 1, y - 1, TUFT[0]); P.px(x, y - 1, TUFT[1]);
      }
    },
    cobbles(x0, y0, w, h, density) {
      for (let y = y0; y < y0 + h; y += 5) for (let x = x0; x < x0 + w; x += 6) {
        if (rnd() > density) continue;
        P.blob(x + rnd() * 3, y + rnd() * 2, 2 + rnd() * 1.6, 1.4 + rnd() * 1, STONE, '#5e5a52');
      }
    },
    tree(x, y, s, leaves = LEAVES, dark = DARK_LEAVES) {
      P.rect(x - 2, y + s * 0.6, 5, s * 0.7, '#6b4424');
      P.rect(x - 3, y + s * 0.6, 1, s * 0.7, INK); P.rect(x + 3, y + s * 0.6, 1, s * 0.7, INK);
      P.blob(x - s * 0.45, y + s * 0.15, s * 0.55, s * 0.5, dark);
      P.blob(x + s * 0.45, y + s * 0.15, s * 0.55, s * 0.5, dark);
      P.blob(x, y - s * 0.2, s * 0.7, s * 0.6, leaves);
    },
    pine(x, y, s) {
      P.rect(x - 1, y + s * 0.5, 3, s * 0.4, '#6b4424');
      P.blob(x, y + s * 0.25, s * 0.5, s * 0.38, PINE);
      P.blob(x, y - s * 0.1, s * 0.38, s * 0.32, PINE);
      P.blob(x, y - s * 0.4, s * 0.24, s * 0.22, PINE);
    },
    bush(x, y, s) {
      P.blob(x - s * 0.5, y, s * 0.6, s * 0.5, DARK_LEAVES);
      P.blob(x + s * 0.5, y, s * 0.6, s * 0.5, DARK_LEAVES);
      P.blob(x, y - s * 0.25, s * 0.75, s * 0.6, LEAVES);
    },
    lamp(x, y) {
      P.rect(x, y, 3, 14, INK); P.rect(x + 1, y, 1, 14, '#3a4a7a');
      P.rect(x - 2, y - 6, 7, 7, INK); P.rect(x - 1, y - 5, 5, 5, '#fff2b0'); P.rect(x - 1, y - 5, 5, 1, '#3a4a7a');
    },
    crate(x, y) {
      P.rect(x - 1, y - 1, 14, 13, INK);
      P.rect(x, y, 12, 11, WOOD[0]);
      P.rect(x, y, 12, 1, WOOD[2]); P.rect(x, y + 5, 12, 1, WOOD[1]); P.rect(x + 11, y, 1, 11, WOOD[1]);
      P.rect(x + 3, y + 1, 1, 9, WOOD[1]); P.rect(x + 8, y + 1, 1, 9, WOOD[1]);
    },
    barrel(x, y) {
      P.blob(x, y, 5, 6, ['#a86a3a', '#6b4424', '#d09058']);
      P.rect(x - 5, y - 2, 10, 1, '#5e5a52'); P.rect(x - 5, y + 2, 10, 1, '#5e5a52');
    },
    flowers(n, avoid) {
      for (let i = 0; i < n; i++) {
        const x = rnd() * SCENE_W, y = rnd() * SCENE_H;
        if (avoid(x, y)) continue;
        const col = P.pick(['#ffffff', '#fff2b0', '#f58aa8', '#ffffff']);
        P.px(x, y, col); P.px(x - 1, y, col); P.px(x + 1, y, col); P.px(x, y - 1, col); P.px(x, y, '#f2c94c');
      }
    },
    woodFence(x, y, w, h, gaps = []) {
      const inGap = (gx) => gaps.some(([a, b]) => gx >= a && gx < b);
      for (let gx = x; gx < x + w; gx++) {
        if (inGap(gx)) continue;
        P.px(gx, y - 1, INK); P.px(gx, y, WOOD[2]); P.px(gx, y + 1, WOOD[0]); P.px(gx, y + 2, INK);
        P.px(gx, y + h - 1, INK); P.px(gx, y + h, WOOD[2]); P.px(gx, y + h + 1, WOOD[0]); P.px(gx, y + h + 2, INK);
      }
      for (let gy = y; gy < y + h; gy++) {
        P.px(x - 1, gy, INK); P.px(x, gy, WOOD[0]); P.px(x + 1, gy, INK);
        P.px(x + w - 2, gy, INK); P.px(x + w - 1, gy, WOOD[0]); P.px(x + w, gy, INK);
      }
      for (let gx = x; gx < x + w; gx += 10) {
        if (inGap(gx)) continue;
        P.rect(gx - 1, y - 3, 4, 6, INK); P.rect(gx, y - 2, 2, 4, WOOD[0]);
      }
    },
    // A cottage seen from above-front: roof on top, front wall with a door below.
    cottage(x, y, w, h, roof) {
      const rh = Math.round(h * 0.55);
      P.box(x, y + rh, w, h - rh, ['#e8d4ac', '#b8a070', '#f7ead0']);
      P.rect(x + Math.floor(w / 2) - 2, y + h - 6, 4, 6, '#6b4424');
      P.rect(x + 2, y + rh + 2, 3, 3, '#5a8ad8');
      if (w > 18) P.rect(x + w - 5, y + rh + 2, 3, 3, '#5a8ad8');
      P.box(x - 2, y, w + 4, rh, roof);
      for (let i = 2; i < rh - 1; i += 2) P.rect(x - 1, y + i, w + 2, 1, roof[1]);
      P.rect(x - 2, y + 1, w + 4, 1, roof[2]);
    },
    stoneWall(x, y, w, h) {
      P.rect(x - 1, y - 1, w + 2, h + 2, INK);
      for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) {
        const mortar = gy % 3 === 2 || (gx + (Math.floor(gy / 3) % 2) * 3) % 6 === 0;
        P.px(x + gx, y + gy, mortar ? WALL[1] : (rnd() < 0.85 ? WALL[0] : WALL[2]));
      }
      if (w > h) {
        P.rect(x, y, w, 2, '#a85a3a');
        for (let gx = 0; gx < w; gx += 6) P.rect(x + gx, y - 2, 3, 2, '#a85a3a');
      }
    },
    tower(x, y) {
      P.stoneWall(x - 6, y - 8, 12, 18);
      for (let i = 0; i < 12; i += 4) P.rect(x - 6 + i, y - 11, 2, 3, WALL[1]);
      P.rect(x - 1, y - 2, 2, 4, INK);
    },
    path(points, r) {
      for (let i = 0; i < points.length - 1; i++) {
        const [x0, y0] = points[i], [x1, y1] = points[i + 1];
        const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        for (let k = 0; k <= n; k++) {
          const cx = x0 + (x1 - x0) * k / n, cy = y0 + (y1 - y0) * k / n;
          for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
            if (x * x + y * y > r * r) continue;
            const rr = rnd();
            P.px(cx + x, cy + y, rr < 0.75 ? DIRT[0] : rr < 0.9 ? DIRT[1] : DIRT[2]);
          }
        }
      }
    },
  };
  return P;
}

// --- Farm --------------------------------------------------------------------

export function drawFarm(canvas) {
  const P = painter(canvas, 7);
  const { rnd, px, rect, pick } = P;
  P.grass();
  P.cobbles(188, 40, 24, 200, 0.8);
  P.cobbles(0, 184, SCENE_W, 22, 0.62);
  P.cobbles(150, 172, 100, 12, 0.5);

  for (const f of FIELDS) {
    for (let y = f.y + 3; y < f.y + f.h - 3; y++) for (let x = f.x + 3; x < f.x + f.w - 3; x++) {
      const r = rnd();
      px(x, y, r < 0.7 ? SOIL[0] : r < 0.85 ? SOIL[1] : r < 0.96 ? SOIL[2] : SOIL[3]);
    }
    rect(f.x + 3, f.y + 3, f.w - 6, 2, SOIL[3]);
    const iw = f.w - 16;
    for (let c = 0; c < COLS; c++) {
      const cx = f.x + 8 + (c + 0.5) * iw / COLS;
      for (let y = f.y + 12; y < f.y + f.h - 10; y++) {
        const half = (y < f.y + 16 || y > f.y + f.h - 14) ? 6 : 8;
        for (let x = Math.round(cx - half); x < Math.round(cx + half); x++) {
          px(x, y, rnd() < 0.8 ? FURROW[0] : pick(FURROW));
        }
        px(cx - half - 1, y, SOIL[2]);
      }
    }
    farmFence(P, f);
  }

  // Well at the top of the path.
  rect(186, 2, 28, 4, INK); rect(187, 3, 26, 2, '#c85a3a');
  rect(191, 6, 2, 14, WOOD[1]); rect(207, 6, 2, 14, WOOD[1]);
  P.blob(200, 26, 11, 7, STONE);
  P.blob(200, 24, 7, 3.6, WATER, '#5e5a52');
  rect(199, 6, 2, 12, '#8a6a3a');
  rect(197, 18, 6, 4, WOOD[0]); rect(197, 18, 6, 1, INK);
  P.barrel(186, 44);

  P.tree(14, 8, 22); P.tree(388, 10, 24); P.tree(130, 4, 14); P.tree(282, 2, 12);
  P.bush(70, 18, 10); P.bush(330, 22, 9); P.bush(168, 22, 7); P.bush(236, 24, 7);
  P.tree(18, 222, 22); P.tree(382, 218, 24); P.bush(320, 228, 10); P.bush(96, 230, 9);
  P.lamp(182, 166); P.lamp(216, 166);

  P.crate(30, 170); P.crate(46, 170); P.crate(118, 170);
  P.crate(268, 170); P.crate(338, 170); P.crate(354, 170);
  const veg = (x, y, col) => P.blob(x, y, 2, 1.5, [col, INK, '#fff6c0'], null);
  veg(124, 170, '#e04a3a'); veg(128, 169, '#f08a2a'); veg(344, 170, '#8fd16a'); veg(360, 169, '#f2d34a');
  P.barrel(80, 176); P.barrel(304, 176);
  rect(236, 168, 22, 4, INK); rect(237, 169, 20, 2, WOOD[2]);
  rect(236, 173, 22, 4, INK); rect(237, 174, 20, 2, WOOD[0]);
  rect(238, 177, 2, 4, INK); rect(254, 177, 2, 4, INK);

  P.flowers(70, (x, y) =>
    FIELDS.some(f => x > f.x - 3 && x < f.x + f.w + 3 && y > f.y - 3 && y < f.y + f.h + 3) ||
    (x > 184 && x < 216) || (y > 180 && y < 208));
  for (const [x, y] of [[150, 214], [262, 226], [58, 206], [228, 30]]) mushroom(P, x, y);
}

function farmFence(P, f) {
  const { rect } = P;
  const rail = (x, y, w) => {
    rect(x, y, w, 3, WOOD[0]); rect(x, y, w, 1, WOOD[2]); rect(x, y + 2, w, 1, WOOD[1]);
    rect(x, y - 1, w, 1, INK); rect(x, y + 3, w, 1, INK);
  };
  const vrail = (x, y, h) => {
    rect(x, y, 3, h, WOOD[0]); rect(x, y, 1, h, WOOD[2]); rect(x + 2, y, 1, h, WOOD[1]);
    rect(x - 1, y, 1, h, INK); rect(x + 3, y, 1, h, INK);
  };
  const post = (x, y) => {
    rect(x - 1, y - 1, 6, 9, INK);
    rect(x, y, 4, 7, WOOD[0]); rect(x, y, 4, 1, WOOD[2]); rect(x + 3, y + 1, 1, 6, WOOD[1]);
  };
  rail(f.x, f.y + 2, f.w);
  rail(f.x, f.y + f.h - 4, f.w);
  vrail(f.x + 1, f.y + 2, f.h - 4);
  vrail(f.x + f.w - 4, f.y + 2, f.h - 4);
  for (let x = f.x; x <= f.x + f.w - 4; x += 14) { post(x, f.y - 1); post(x, f.y + f.h - 7); }
  for (let y = f.y + 13; y < f.y + f.h - 8; y += 14) { post(f.x, y); post(f.x + f.w - 4, y); }
  post(f.x + f.w - 4, f.y - 1); post(f.x + f.w - 4, f.y + f.h - 7);
}

function mushroom(P, x, y) {
  P.rect(x - 3, y - 3, 7, 3, INK); P.rect(x - 2, y - 2, 5, 2, '#d8402e'); P.px(x - 1, y - 2, '#ffffff');
  P.rect(x - 1, y, 3, 3, INK); P.px(x, y, '#f5e6c8'); P.px(x, y + 1, '#f5e6c8');
}

// --- Valley ------------------------------------------------------------------

export function drawValley(canvas) {
  const P = painter(canvas, 21);
  const { rnd, rect, px } = P;
  P.grass();

  // Paths first so everything else sits on top: house → plaza → farm, and plaza → south gate.
  P.path([[40, 128], [80, 132], [130, 132], [178, 134]], 4);
  P.path([[222, 136], [260, 144], [300, 150], [350, 150]], 4);
  P.path([[200, 152], [200, 200], [200, 240]], 4);
  for (let a = 0; a < Math.PI * 2; a += 0.02) P.path([[200 + Math.cos(a) * 20, 132 + Math.sin(a) * 16]], 3);

  // Market floor: stone tiles.
  for (let y = 156; y < 224; y++) for (let x = 18; x < 148; x++) {
    const mortar = y % 6 === 0 || (x + (Math.floor(y / 6) % 2) * 5) % 10 === 0;
    px(x, y, mortar ? '#8a867e' : (rnd() < 0.9 ? '#aaa69c' : '#bcb8ae'));
  }

  // Fountain on the plaza.
  P.box(190, 124, 20, 16, STONE);
  P.box(193, 127, 14, 10, WATER, '#5e5a52');
  rect(199, 128, 2, 4, '#c8f0ff');

  // House yard: fence, cottage, pond, small fruit trees, well.
  P.woodFence(24, 72, 92, 56, [[60, 76]]);
  P.cottage(34, 84, 22, 20, ['#d07a4a', '#8e4a2a', '#f0a070']);
  P.blob(84, 104, 10, 5, WATER, '#3a6a3a');
  for (const [x, y] of [[100, 86], [30, 116], [108, 118]]) {
    P.blob(x, y, 4, 4, DARK_LEAVES);
    px(x - 1, y - 1, '#e04a3a'); px(x + 2, y + 1, '#e04a3a');
  }
  P.blob(72, 80, 4, 3, STONE); P.blob(72, 79, 2, 1.4, WATER, null);
  P.lamp(44, 136);

  // Buildings along the north side of the plaza.
  P.cottage(124, 98, 16, 14, ['#c88a52', '#7e5230', '#e8b480']);
  P.cottage(150, 92, 16, 20, ['#5a7ad0', '#34508e', '#8aa8f0']);
  for (const [x, y] of [[176, 104], [184, 108], [172, 112]]) P.blob(x, y, 3, 2, ['#c88a52', '#7e5230', '#e8b480']);
  P.lamp(138, 120);
  P.tree(224, 94, 14);
  P.cottage(228, 104, 16, 14, ['#c88a52', '#7e5230', '#e8b480']);
  P.lamp(234, 124); P.lamp(262, 126);

  // Farm: two fenced fields with planted rows and a small shed.
  for (const fx of [256, 318]) {
    P.woodFence(fx, 82, 54, 50, [[fx + 22, fx + 32]]);
    for (let r = 0; r < 5; r++) {
      const x = fx + 6 + r * 9;
      rect(x, 88, 6, 38, SOIL[1]);
      rect(x, 88, 6, 1, SOIL[3]);
      for (let y = 91; y < 124; y += 5) px(x + 2 + (r % 2), y, ['#8fd16a', '#e04a3a', '#f2d34a'][(r + y) % 3]);
    }
    rect(fx + 2, 84, 50, 4, SOIL[0]);
  }
  P.cottage(312, 70, 12, 10, ['#5a7ad0', '#34508e', '#8aa8f0']);
  P.cottage(352, 148, 18, 14, ['#d85a3a', '#983a22', '#f08a6a']);

  // Market: hall, stalls with striped awnings.
  P.cottage(22, 164, 34, 44, ['#7a7aa8', '#4e4e7a', '#a4a4d0']);
  P.box(60, 168, 4, 30, STONE);
  P.tree(66, 186, 10);
  const stall = (x, y, a, b) => {
    P.box(x, y + 6, 18, 8, WOOD);
    for (let i = 0; i < 18; i += 3) rect(x + i, y, 3, 6, (i / 3) % 2 ? a : b);
    rect(x - 1, y - 1, 20, 1, INK); rect(x - 1, y + 6, 20, 1, INK);
    px(x + 4, y + 8, '#e04a3a'); px(x + 9, y + 8, '#8fd16a'); px(x + 13, y + 8, '#f2d34a');
  };
  stall(86, 164, '#5ab4f0', '#e8f4ff');
  stall(116, 164, '#8fd16a', '#f0ffe0');
  stall(86, 196, '#8fd16a', '#f0ffe0');
  stall(116, 196, '#f0863a', '#fff0e0');

  // Houses and trees in the south-east.
  P.cottage(252, 176, 18, 12, ['#b05ab0', '#743a74', '#d890d8']);
  P.cottage(270, 204, 18, 12, ['#c88a52', '#7e5230', '#e8b480']);
  P.cottage(300, 204, 18, 12, ['#5a9ad8', '#34609e', '#8ac4f5']);
  P.cottage(330, 204, 18, 12, ['#c88a52', '#7e5230', '#e8b480']);
  for (const [x, y, s] of [[232, 176, 12], [296, 178, 12], [356, 184, 12], [228, 206, 12], [372, 206, 10], [320, 170, 10]]) P.tree(x, y, s);

  // Walls: outer ring with towers, a divider between house and market, and the south gate.
  P.stoneWall(12, 54, 376, 6);
  P.stoneWall(12, 226, 182, 6); P.stoneWall(206, 226, 182, 6);
  P.stoneWall(12, 54, 6, 178); P.stoneWall(382, 54, 6, 178);
  P.stoneWall(12, 146, 140, 6); P.stoneWall(146, 146, 6, 86);
  for (const [x, y] of [[15, 56], [110, 56], [200, 56], [290, 56], [385, 56], [15, 148], [149, 148], [15, 228], [190, 228], [210, 228], [385, 228], [385, 148]]) P.tower(x, y);

  // Forest north of the wall, plus a few trees outside the sides.
  const northTrees = [];
  for (let i = 0; i < 46; i++) northTrees.push([8 + rnd() * 384, 6 + rnd() * 38, 9 + rnd() * 5, rnd()]);
  northTrees.sort((a, b) => a[1] - b[1]);
  for (const [x, y, s, kind] of northTrees) {
    if (kind < 0.12) P.tree(x, y, s, AUTUMN, ['#c88a30', '#8a5a14', '#e8b050']);
    else if (kind < 0.45) P.pine(x, y, s * 1.2);
    else P.tree(x, y, s);
  }
  for (const [x, y] of [[4, 90], [396, 120], [4, 190], [396, 200]]) P.pine(x, y, 14);
  P.flowers(90, (x, y) => y < 50 || (x < 150 && y > 150) || (Math.abs(x - 200) < 26 && Math.abs(y - 132) < 22));
  for (const [x, y] of [[170, 210], [120, 236], [240, 60]]) mushroom(P, x, y);
}
