"""Draw the Hopi Farms pixel-art logo (the farmer) and icon as crisp SVGs.

    python3 brand/make_logo.py      # writes brand/logo.svg, brand/icon.svg, brand/logo-sign.svg

Everything is drawn on a small pixel grid (one cell = one art pixel) and exported as
merged <rect> runs, so it stays sharp at any size.
"""
from pathlib import Path

OUT = Path(__file__).parent

INK = '#4a2a17'        # outline
CREAM = '#fff4dc'      # lettering
CREAM_SHADE = '#f0d6a6'
SHADOW = '#2b1709'
WOOD = '#c88a52'
WOOD_HI = '#f0bc7c'
WOOD_LO = '#9a6236'
WOOD_GRAIN = '#ad7040'
POST = '#8a5530'
LEAF = '#6cbf4a'
LEAF_HI = '#a6e07a'
LEAF_LO = '#3e8a2e'
STEM = '#4f9a3e'
SOIL = '#8a5a32'
SOIL_HI = '#b07a4a'

# 5×7 pixel letters (I is 3 wide).
FONT = {
    'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'I': ['111', '010', '010', '010', '010', '010', '111'],
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
}


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.px = {}

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[(x, y)] = c

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, c)

    def get(self, x, y):
        return self.px.get((x, y))

    def svg(self, scale, title):
        rows = []
        for y in range(self.h):
            x = 0
            while x < self.w:
                c = self.px.get((x, y))
                if c is None:
                    x += 1
                    continue
                run = 1
                while self.px.get((x + run, y)) == c:
                    run += 1
                rows.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="{c}"/>')
                x += run
        body = '\n  '.join(rows)
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" '
                f'width="{self.w * scale}" height="{self.h * scale}" shape-rendering="crispEdges" '
                f'role="img" aria-label="{title}">\n  <title>{title}</title>\n  {body}\n</svg>\n')


def text_mask(word, size):
    """Cells covered by `word` at `size` cells per font pixel, plus its width and height."""
    cells, x = set(), 0
    for ch in word:
        glyph = FONT[ch]
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == '1':
                    for dy in range(size):
                        for dx in range(size):
                            cells.add((x + gx * size + dx, gy * size + dy))
        x += (len(glyph[0]) + 1) * size + 1     # +1 keeps outlines of neighbours apart
    return cells, x - size - 1, 7 * size


def draw_text(cv, word, size, ox, oy):
    cells, _, h = text_mask(word, size)
    cells = {(x + ox, y + oy) for x, y in cells}
    # Drop shadow, then outline, then the letters with a shaded lower half.
    for x, y in cells:
        cv.set(x + 1, y + 2, SHADOW)
    for x, y in cells:
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, -1), (-1, 1), (1, 1)]:
            if (x + dx, y + dy) not in cells:
                cv.set(x + dx, y + dy, INK)
    for x, y in cells:
        cv.set(x, y, CREAM_SHADE if y - oy >= h * 0.6 else CREAM)


def leaf(cv, cx, cy, rx, ry):
    """An outlined, shaded oval leaf."""
    pts = set()
    for y in range(cy - ry - 1, cy + ry + 2):
        for x in range(cx - rx - 1, cx + rx + 2):
            if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.05:
                pts.add((x, y))
    for x, y in pts:
        for dx, dy in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            if (x + dx, y + dy) not in pts:
                cv.set(x + dx, y + dy, INK)
    for x, y in pts:
        if (x, y - 1) not in pts:
            cv.set(x, y, LEAF_HI)
        elif (x, y + 1) not in pts:
            cv.set(x, y, LEAF_LO)
        else:
            cv.set(x, y, LEAF)
    # Midrib.
    for x in range(cx - rx + 2, cx + rx - 1):
        cv.set(x, cy, LEAF_LO)


def sprout(cv, cx, base_y):
    """A two-leaf sprout whose stem ends at base_y (the top edge of the sign)."""
    stem_top = base_y - 6
    leaf(cv, cx - 5, stem_top - 1, 4, 2)
    leaf(cv, cx + 5, stem_top - 3, 4, 2)
    for y in range(stem_top - 2, base_y + 1):
        cv.set(cx - 1, y, INK)
        cv.set(cx, y, STEM)
        cv.set(cx + 1, y, INK)
    cv.set(cx, stem_top - 3, INK)


def logo():
    hopi, hw, hh = text_mask('HOPI', 2)
    farms, fw, fh = text_mask('FARMS', 1)
    pad_x, pad_top, gap, pad_bot = 5, 5, 4, 5
    bw = max(hw, fw) + pad_x * 2 + 2
    bh = pad_top + hh + gap + fh + pad_bot + 2
    top = 14                                   # room for the sprout
    W, H = bw + 4, top + bh + 8                # +posts
    cv = Canvas(W, H)
    bx, by = 2, top

    # Posts behind the board.
    for px_ in (bx + 7, bx + bw - 10):
        cv.rect(px_ - 1, by + bh - 2, 5, H - (by + bh - 2), INK)
        cv.rect(px_, by + bh - 2, 3, H - (by + bh - 2) - 1, POST)
        cv.rect(px_, by + bh - 2, 1, H - (by + bh - 2) - 1, WOOD_LO)
    # Board: outline with cut corners, rim highlight/shade, planks with grain.
    cv.rect(bx + 1, by, bw - 2, bh, INK)
    cv.rect(bx, by + 1, bw, bh - 2, INK)
    cv.rect(bx + 1, by + 1, bw - 2, bh - 2, WOOD)
    cv.rect(bx + 2, by + 1, bw - 4, 1, WOOD_HI)
    cv.rect(bx + 1, by + 2, 1, bh - 4, WOOD_HI)
    cv.rect(bx + 2, by + bh - 2, bw - 4, 1, WOOD_LO)
    cv.rect(bx + bw - 2, by + 2, 1, bh - 4, WOOD_LO)
    plank_ys = [by + 1 + round((bh - 2) * k / 3) for k in (1, 2)]
    for y in plank_ys:
        cv.rect(bx + 2, y, bw - 4, 1, WOOD_LO)
    for i, (gx, gy, gl) in enumerate([(9, 4, 6), (30, 7, 8), (17, 15, 5), (40, 18, 7), (6, 24, 6), (26, 27, 9)]):
        if by + gy < by + bh - 3 and bx + gx + gl < bx + bw - 3:
            cv.rect(bx + gx, by + gy, gl, 1, WOOD_GRAIN)
    # Nails.
    for nx, ny in [(bx + 4, by + 4), (bx + bw - 5, by + 4), (bx + 4, by + bh - 5), (bx + bw - 5, by + bh - 5)]:
        cv.set(nx, ny, '#5e3a1e')
        cv.set(nx, ny - 1, WOOD_HI)

    # Lettering, centred.
    draw_text(cv, 'HOPI', 2, bx + (bw - hw) // 2, by + pad_top + 1)
    draw_text(cv, 'FARMS', 1, bx + (bw - fw) // 2, by + pad_top + 1 + hh + gap)

    # Sprout growing from the top edge, a little left of centre.
    sprout(cv, bx + bw // 2 - 12, by - 1)
    return cv


def icon():
    """16×16 app icon: a sprout in a soil mound on a rounded green tile."""
    cv = Canvas(16, 16)
    tile = '#78ba52'
    for y in range(16):
        for x in range(16):
            corner = (x in (0, 15) and y in (0, 1, 14, 15)) or (y in (0, 15) and x in (1, 14))
            if not corner:
                cv.set(x, y, tile)
    cv.rect(1, 0, 14, 1, INK); cv.rect(1, 15, 14, 1, INK)
    cv.rect(0, 2, 1, 12, INK); cv.rect(15, 2, 1, 12, INK)
    for x, y in [(1, 1), (14, 1), (1, 14), (14, 14)]:
        cv.set(x, y, INK)
    cv.rect(2, 1, 12, 1, '#a6e07a')
    # Soil mound.
    for x, y in [(4, 12), (5, 11), (6, 11), (7, 11), (8, 11), (9, 11), (10, 11), (11, 12)]:
        cv.set(x, y, INK)
    cv.rect(5, 12, 6, 2, SOIL)
    cv.rect(6, 12, 3, 1, SOIL_HI)
    cv.rect(4, 13, 1, 1, INK); cv.rect(11, 13, 1, 1, INK); cv.rect(4, 14, 8, 1, INK)
    # Stem and leaves.
    cv.rect(7, 7, 1, 5, STEM)
    for x, y in [(3, 5), (4, 4), (5, 4), (6, 5), (4, 6), (5, 6), (6, 6)]:
        cv.set(x, y, LEAF)
    cv.set(4, 5, LEAF_HI); cv.set(5, 5, LEAF_HI)
    for x, y in [(8, 4), (9, 3), (10, 3), (11, 4), (9, 5), (10, 5), (11, 5), (8, 5)]:
        cv.set(x, y, LEAF)
    cv.set(9, 4, LEAF_HI); cv.set(10, 4, LEAF_HI)
    cv.set(7, 6, LEAF_LO); cv.set(6, 7, LEAF_LO); cv.set(8, 6, LEAF_LO)
    for x, y in [(2, 5), (3, 4), (4, 3), (5, 3), (6, 4), (7, 5), (3, 6), (4, 7), (5, 7), (6, 7),
                 (8, 3), (9, 2), (10, 2), (11, 3), (12, 4), (12, 5), (11, 6), (10, 6), (9, 6)]:
        if cv.get(x, y) == tile:
            cv.set(x, y, INK)
    return cv



# --- The farmer --------------------------------------------------------------------

SKIN = ('#f2c393', '#d0956a', '#ffe0bd')
STRAW = ('#e8c25a', '#b98c2e', '#f8e39a')
BAND = ('#d8503a', '#a0321f', '#f2826a')
SHIRT = ('#d85a3a', '#a63a22', '#f08a6a')
DENIM = ('#4a6ad8', '#2f4596', '#7d9af2')
BOOT = ('#7a4e2c', '#4e301a', '#a87048')
HAIR = ('#8a5a32', '#5e3a1e', '#b07a4a')


def mix(a, b, t):
    A = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    B = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(A, B))


def layer(cv, test, colors):
    """Fill cells passing test(x, y) with a light top/left rim and a shaded bottom/right."""
    base, shadow, hi = colors
    pts = {(x, y) for y in range(cv.h) for x in range(cv.w) if test(x + 0.5, y + 0.5)}
    for x, y in pts:
        if (x, y + 1) not in pts or (x + 1, y) not in pts:
            c = shadow
        elif (x, y - 1) not in pts or (x - 1, y) not in pts:
            c = hi
        else:
            c = base
        cv.set(x, y, c)
    return pts


def ell(cx, cy, rx, ry):
    return lambda x, y: ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1


def box(x0, y0, x1, y1):
    return lambda x, y: x0 <= x < x1 + 1 and y0 <= y < y1 + 1


def outline(cv):
    """One-cell outline tinted from the neighbouring colour."""
    src = dict(cv.px)
    for y in range(cv.h):
        for x in range(cv.w):
            if (x, y) in src:
                continue
            for dx, dy in [(0, -1), (-1, 0), (1, 0), (0, 1)]:
                nb = src.get((x + dx, y + dy))
                if nb:
                    cv.set(x, y, mix(nb, '#24120a', 0.72))
                    break


def farmer_canvas():
    cv = Canvas(34, 42)
    # Boots and legs.
    layer(cv, box(10, 37, 15, 39), BOOT)
    layer(cv, box(18, 37, 23, 39), BOOT)
    layer(cv, box(11, 32, 15, 37), DENIM)
    layer(cv, box(18, 32, 22, 37), DENIM)
    # Arms (sleeves) and hands.
    layer(cv, box(6, 22, 8, 29), SHIRT)
    layer(cv, box(25, 22, 27, 29), SHIRT)
    layer(cv, ell(7.5, 31, 1.9, 1.8), SKIN)
    layer(cv, ell(26.5, 31, 1.9, 1.8), SKIN)
    # Shirt, then overalls over it.
    layer(cv, box(8, 21, 25, 31), SHIRT)
    layer(cv, box(11, 26, 22, 33), DENIM)
    layer(cv, box(12, 23, 21, 27), DENIM)
    for x in (11, 22):
        for y in range(21, 24):
            cv.set(x, y, DENIM[0])
    cv.rect(14, 29, 6, 2, DENIM[1])                 # front pocket
    cv.rect(14, 29, 6, 1, DENIM[2])
    for x, y in [(13, 24), (20, 24)]:               # buttons
        cv.set(x, y, '#f2c94c'); cv.set(x, y + 1, '#b88a1c')
    # Head: ears, face, hair tufts.
    layer(cv, ell(9.6, 15.8, 1.4, 1.8), SKIN)
    layer(cv, ell(24.4, 15.8, 1.4, 1.8), SKIN)
    layer(cv, ell(17, 15.6, 7.2, 6.2), SKIN)
    layer(cv, box(10, 11, 12, 13), HAIR)
    layer(cv, box(22, 11, 24, 13), HAIR)
    # Face details.
    for x, y in [(13, 14), (14, 14), (13, 15), (14, 15), (19, 14), (20, 14), (19, 15), (20, 15)]:
        cv.set(x, y, '#3a2416')
    cv.set(13, 14, '#ffffff'); cv.set(19, 14, '#ffffff')    # eye shine
    for x, y in [(11, 17), (12, 17), (21, 17), (22, 17)]:
        cv.set(x, y, '#f08a8a')                              # cheeks
    cv.set(17, 16, SKIN[1]); cv.set(17, 17, SKIN[1])        # nose
    for x, y in [(14, 18), (15, 19), (16, 19), (17, 19), (18, 19), (19, 18)]:
        cv.set(x, y, '#7a3a26')                              # smile
    # Straw hat: crown, red band, wide brim, weave.
    crown = layer(cv, lambda x, y: ell(17, 7.2, 6.4, 5.2)(x, y) and y < 10.5, STRAW)
    layer(cv, box(11, 9, 22, 10), BAND)
    brim = layer(cv, ell(17, 11.4, 15.5, 2.6), STRAW)
    for x, y in crown | brim:
        if (x + 2 * y) % 5 == 0 and cv.get(x, y) == STRAW[0]:
            cv.set(x, y, mix(STRAW[0], STRAW[1], 0.45))
    layer(cv, box(11, 9, 22, 10), BAND)
    outline(cv)
    return cv


def farmer_logo():
    return farmer_canvas()


def farmer_icon():
    """32×32 icon: the farmer's head and shoulders on a rounded green tile."""
    f = farmer_canvas()
    cv = Canvas(32, 32)
    tile, edge = '#78ba52', INK
    for y in range(32):
        for x in range(32):
            ex, ey = min(x, 31 - x), min(y, 31 - y)
            if ex + ey <= 2:
                continue
            cv.set(x, y, edge if ex == 0 or ey == 0 or ex + ey == 3 else tile)
    cv.rect(2, 1, 28, 1, '#a6e07a')
    # Paste the farmer from row 1 down (cropped at the tile's bottom edge).
    inside = {xy for xy, c in cv.px.items() if c != edge}
    for (x, y), c in f.px.items():
        X, Y = x - 1, y + 1
        if (X, Y) in inside:            # stay within the tile's border
            cv.set(X, Y, c)
    return cv

if __name__ == '__main__':
    lg = farmer_logo()
    (OUT / 'logo.svg').write_text(lg.svg(12, 'Hopi Farms'))
    (OUT / 'icon.svg').write_text(farmer_icon().svg(16, 'Hopi Farms'))
    # The earlier sign logo, kept as an alternate.
    (OUT / 'logo-sign.svg').write_text(logo().svg(8, 'Hopi Farms'))
    print(f'farmer logo {lg.w}×{lg.h} cells, icon 32×32 cells → {OUT}')
