// Pixel-art backgrounds drawn in code at 400×240: the Farm and the Valley map. Interactive
// things (plots, the farmer, zone signs) are DOM elements placed on top at the positions
// exported here, in scene pixels.

export const SCENE_W = 400;
export const SCENE_H = 240;

const INK = '#3a2214';   // soft dark brown for hard edges (fences, lamps)
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

// Scenes are laid out in 400×240 scene units but painted at S render pixels per unit, so
// textures, shading and outlines are finer than the layout grid.
const S = 2;

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = hex(a), B = hex(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const shade = (c) => mix(c, '#24140a', 0.55);   // soft outline tint for a colour

function painter(canvas, seed) {
  canvas.width = SCENE_W * S;
  canvas.height = SCENE_H * S;
  const ctx = canvas.getContext('2d');
  const rnd = rngFrom(seed);
  const o = 1 / S;               // one render pixel, in scene units
  const P = {
    rnd,
    o,
    pick: (arr) => arr[Math.floor(rnd() * arr.length)],
    // One render pixel at render coordinates.
    dot(X, Y, c) { ctx.fillStyle = c; ctx.fillRect(X, Y, 1, 1); },
    // One scene unit (S×S render pixels).
    px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x * S), Math.round(y * S), S, S); },
    rect(x, y, w, h, c) {
      ctx.fillStyle = c;
      ctx.fillRect(Math.round(x * S), Math.round(y * S), Math.max(1, Math.round(w * S)), Math.max(1, Math.round(h * S)));
    },
    // Fill every render pixel inside a scene-unit rectangle using pick(X, Y) for its colour.
    texture(x, y, w, h, pickColor) {
      const X0 = Math.round(x * S), Y0 = Math.round(y * S), X1 = Math.round((x + w) * S), Y1 = Math.round((y + h) * S);
      for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) P.dot(X, Y, pickColor(X, Y));
    },
    // Shaded ellipse with a one-render-pixel outline tinted from its shadow colour.
    blob(cx, cy, rx, ry, [base, shadow, hi], outline) {
      const line = outline === null ? null : (outline || shade(shadow));
      const mid = mix(base, shadow, 0.5);
      const X0 = Math.floor((cx - rx - 1) * S), X1 = Math.ceil((cx + rx + 1) * S);
      const Y0 = Math.floor((cy - ry - 1) * S), Y1 = Math.ceil((cy + ry + 1) * S);
      for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
        const u = (X + 0.5) / S, v = (Y + 0.5) / S;
        const dx = (u - cx) / rx, dy = (v - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const t = dx * 0.5 + dy;
          P.dot(X, Y, t > 0.6 ? shadow : t > 0.3 ? mid : t < -0.62 ? hi : base);
        } else if (line) {
          const ox = (u - cx) / (rx + o), oy = (v - cy) / (ry + o);
          if (ox * ox + oy * oy <= 1) P.dot(X, Y, line);
        }
      }
    },
    box(x, y, w, h, [base, shadow, hi], outline) {
      P.rect(x - o, y - o, w + 2 * o, h + 2 * o, outline || shade(shadow));
      P.rect(x, y, w, h, base);
      P.rect(x, y, w, o * 2, hi);
      P.rect(x, y + h - o * 2, w, o * 2, shadow);
      P.rect(x + w - o * 2, y, o * 2, h, shadow);
    },
    grass() {
      // Low-frequency patches so the lawn isn't uniform noise.
      const patch = [];
      for (let j = 0; j <= SCENE_H / 12 + 1; j++) { patch[j] = []; for (let i = 0; i <= SCENE_W / 12 + 1; i++) patch[j][i] = rnd(); }
      P.texture(0, 0, SCENE_W, SCENE_H, (X, Y) => {
        const p = patch[Math.floor(Y / S / 12)][Math.floor(X / S / 12)];
        const r = rnd() * 0.85 + p * 0.15;
        return r < 0.62 ? GRASS[0] : r < 0.78 ? GRASS[1] : r < 0.93 ? GRASS[2] : GRASS[3];
      });
      for (let i = 0; i < 1400; i++) {
        const X = Math.floor(rnd() * SCENE_W * S), Y = Math.floor(rnd() * SCENE_H * S);
        const dark = rnd() < 0.6;
        const a = dark ? TUFT[0] : TUFT[1];
        P.dot(X, Y, a); P.dot(X - 1, Y - 1, a); P.dot(X + 1, Y - 1, a); P.dot(X, Y - 2, a);
        if (!dark) P.dot(X, Y - 1, '#a8dc78');
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
        const col = P.pick(['#ffffff', '#fff2b0', '#f58aa8', '#ffffff', '#c8d8ff']);
        const X = Math.round(x * S), Y = Math.round(y * S);
        for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, 0], [1, 0], [0, -1], [0, 1]]) P.dot(X + dx, Y + dy, col);
        P.dot(X, Y, '#f2c94c'); P.dot(X + 1, Y + 3, TUFT[0]);
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
      P.rect(x - o, y - o, w + 2 * o, h + 2 * o, shade(WALL[1]));
      const X0 = Math.round(x * S), Y0 = Math.round(y * S);
      P.texture(x, y, w, h, (X, Y) => {
        const lx = X - X0, ly = Y - Y0;
        const row = Math.floor(ly / 6);
        const mortar = ly % 6 === 5 || (lx + (row % 2) * 6) % 12 === 0;
        if (mortar) return WALL[1];
        if (ly % 6 === 0) return WALL[2];            // lit top edge of each brick
        return rnd() < 0.9 ? WALL[0] : mix(WALL[0], WALL[1], 0.4);
      });
      if (w > h) {
        P.rect(x, y, w, 2, '#b4643e');
        P.rect(x, y, w, o, '#d88a5a');
        for (let gx = 0; gx < w; gx += 6) { P.rect(x + gx, y - 2, 3, 2, '#b4643e'); P.rect(x + gx, y - 2, 3, o, '#d88a5a'); }
      }
    },
    tower(x, y) {
      P.stoneWall(x - 6, y - 8, 12, 18);
      for (let i = 0; i < 12; i += 4) P.rect(x - 6 + i, y - 11, 2, 3, WALL[1]);
      P.rect(x - 1, y - 2, 2, 4, INK);
    },
    path(points, r) {
      for (let i = 0; i < points.length - 1 || (points.length === 1 && i === 0); i++) {
        const [x0, y0] = points[i], [x1, y1] = points[Math.min(i + 1, points.length - 1)];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
        for (let k = 0; k <= n; k++) {
          const cx = (x0 + (x1 - x0) * k / n) * S, cy = (y0 + (y1 - y0) * k / n) * S, R = r * S;
          for (let Y = Math.floor(cy - R); Y <= cy + R; Y++) for (let X = Math.floor(cx - R); X <= cx + R; X++) {
            const d = Math.hypot(X + 0.5 - cx, Y + 0.5 - cy);
            if (d > R) continue;
            const rr = rnd();
            P.dot(X, Y, d > R - 1.2 && rr < 0.5 ? DIRT[1] : rr < 0.72 ? DIRT[0] : rr < 0.88 ? DIRT[1] : DIRT[2]);
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
    P.texture(f.x + 3, f.y + 3, f.w - 6, f.h - 6, () => {
      const r = rnd();
      return r < 0.7 ? SOIL[0] : r < 0.85 ? SOIL[1] : r < 0.96 ? SOIL[2] : SOIL[3];
    });
    rect(f.x + 3, f.y + 3, f.w - 6, 2, SOIL[3]);
    const iw = f.w - 16;
    for (let c = 0; c < COLS; c++) {
      const cx = (f.x + 8 + (c + 0.5) * iw / COLS) * S;
      const top = (f.y + 12) * S, bottom = (f.y + f.h - 10) * S;
      for (let Y = top; Y < bottom; Y++) {
        // Rounded ends: narrower near the top and bottom of each furrow.
        const edge = Math.min(Y - top, bottom - 1 - Y);
        const half = 16 - Math.max(0, 6 - edge) * 0.9;
        for (let X = Math.round(cx - half); X < Math.round(cx + half); X++) {
          const r = rnd();
          P.dot(X, Y, X < cx - half + 2 ? FURROW[1] : r < 0.8 ? FURROW[0] : pick(FURROW));
        }
        P.dot(Math.round(cx - half) - 1, Y, SOIL[2]);   // lit ridge on the left
        P.dot(Math.round(cx + half), Y, SOIL[3]);       // shadowed ridge on the right
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
  P.texture(18, 156, 130, 68, (X, Y) => {
    const row = Math.floor(Y / 12);
    const mortar = Y % 12 === 0 || (X + (row % 2) * 10) % 20 === 0;
    if (mortar) return '#86827a';
    if (Y % 12 === 1) return '#c6c2b8';                // lit top edge of each tile
    return rnd() < 0.9 ? '#aaa69c' : '#b8b4aa';
  });

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
