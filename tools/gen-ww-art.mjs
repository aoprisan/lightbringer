// Dependency-free PNG art generator for The Moon's Hunger (the werewolf spinoff).
// Two families of output, both fully procedural (no fonts, no source images):
//
//  1. GAMEPLAY SPRITES (art/<name>.png, 128×128, transparent) — the base sprite
//     set werewolf.ts already probes via loadSprites/spriteFor: the built world
//     (stone, cottage, cairn ×3 states, moonwell), the hero's two forms
//     (wolf-human, wolf-beast — the beast authored facing EAST; render spins it
//     to the wolf's heading), and the five roles of the watch (villager, hound,
//     knight, huntsman, friar).
//
//  2. ESTABLISHING SCENES (art/village-<id>.png, 640×360) — one moody 16:9
//     night-scape per campaign village, shown at the top of the picker card
//     (LevelDef.art). Each shares one scene grammar (sky → moon → ridges → mist
//     → village silhouettes → foreground) themed per village.
//
// Everything is a scalar field sampled with supersampling (the same approach as
// tools/gen-ww-icons.mjs), painter's-algorithm composited in straight RGBA.
// Deterministic: all jitter goes through mulberry32 with fixed per-image seeds.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// ---------- tiny math / color ----------
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- geometry (unit space) ----------
const inEllipse = (px, py, ex, ey, rx, ry) => ((px - ex) / rx) ** 2 + ((py - ey) / ry) ** 2 <= 1;
const inTri = (px, py, ax, ay, bx, by, cx, cy) => {
  const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  const s = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / d;
  const t = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / d;
  return s >= 0 && t >= 0 && s + t <= 1;
};
const inCapsule = (px, py, ax, ay, bx, by, hw) => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= hw;
};
const inRRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) <= r;
};
const inRing = (px, py, cx, cy, r, hw) => Math.abs(Math.hypot(px - cx, py - cy) - r) <= hw;

// ---------- sprite shape stack ----------
// A sprite is an ordered list of shapes composited src-over onto transparency.
// `hit(px,py)` returns coverage 0..1 (hard shapes return 0/1; glows are soft);
// `color` is [r,g,b] or (px,py)=>[r,g,b]; `alpha` scales the shape's coverage.
const S = (hit, color, alpha = 1) => ({ hit, color, alpha });
const ell = (cx, cy, rx, ry, color, a) => S((x, y) => (inEllipse(x, y, cx, cy, rx, ry) ? 1 : 0), color, a);
const cap = (ax, ay, bx, by, hw, color, a) => S((x, y) => (inCapsule(x, y, ax, ay, bx, by, hw) ? 1 : 0), color, a);
const tri = (ax, ay, bx, by, cx, cy, color, a) => S((x, y) => (inTri(x, y, ax, ay, bx, by, cx, cy) ? 1 : 0), color, a);
const rrect = (cx, cy, hw, hh, r, color, a) => S((x, y) => (inRRect(x, y, cx, cy, hw, hh, r) ? 1 : 0), color, a);
const ring = (cx, cy, r, hw, color, a) => S((x, y) => (inRing(x, y, cx, cy, r, hw) ? 1 : 0), color, a);
// A soft radial glow: full `peak` alpha at the centre, feathered to nothing at r.
const glow = (cx, cy, r, color, peak) =>
  S((x, y) => smooth(r, r * 0.12, Math.hypot(x - cx, y - cy)) * peak, color, 1);
// A vertical two-stop gradient fill for any shape's color.
const vgrad = (c1, c2, y0, y1) => (_, y) => mix(c1, c2, smooth(y0, y1, y));

function renderSprite(size, shapes) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = (x + (sx + 0.5) / SS) / size, py = (y + (sy + 0.5) / SS) / size;
          // painter's algorithm, src-over
          let cr = 0, cg = 0, cb = 0, ca = 0;
          for (const sh of shapes) {
            const cov = sh.hit(px, py) * sh.alpha;
            if (cov <= 0) continue;
            const col = typeof sh.color === "function" ? sh.color(px, py) : sh.color;
            cr = col[0] * cov + cr * (1 - cov);
            cg = col[1] * cov + cg * (1 - cov);
            cb = col[2] * cov + cb * (1 - cov);
            ca = cov + ca * (1 - cov);
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = SS * SS, i = (y * size + x) * 4;
      buf[i] = clamp(r / n); buf[i + 1] = clamp(g / n); buf[i + 2] = clamp(b / n);
      buf[i + 3] = clamp((a / n) * 255);
    }
  }
  return buf;
}

// ---------- the shared palette (matches werewolf.ts's render hues) ----------
const OUT = hex("#12151c");        // dark outline
const STONE_D = hex("#3a3f48"), STONE_L = hex("#565f6a"), STONE_RIM = hex("#8a96a6");
const TIMBER = hex("#4a3829"), TIMBER_L = hex("#7a5e42"), THATCH = hex("#5e4830"), THATCH_L = hex("#6e563a");
const WINDOW = hex("#ffcf7a");
const WATER_D = hex("#1a2438"), WATER_RIM = hex("#7e98d0"), MOONLIGHT = hex("#cfe0ff");
const BLOOD = hex("#e0566a"), BLOOD_L = hex("#ffd6dc");
const WARD = hex("#6a4fb0"), WARD_L = hex("#cdc2ee");
const COAT = hex("#241f26"), COAT_RIDGE = hex("#4a4054"), COAT_RIM = hex("#7a708a");
const EYE = hex("#ffe04a");
const SKIN = hex("#c9b696"), MAN = hex("#b9a98e"), CLOAK = hex("#7a6a4a"), CLOAK_D = hex("#5a4e36");
const VILLAGER = hex("#9a8a6a"), VILLAGER_D = hex("#6a5c42");
const HOUND = hex("#7a6a4a"), HOUND_D = hex("#54462e");
const STEEL = hex("#8a909a"), STEEL_L = hex("#b8c0cc"), STEEL_D = hex("#565c66");
const GREEN = hex("#6a8a5a"), GREEN_D = hex("#46603a");
const ROBE = hex("#b0a890"), ROBE_D = hex("#847c66");
const GOLD = hex("#ffd06a");

// ---------- gameplay sprites ----------
// Every figure sits centred, sized to survive spriteFade's radial mask (content
// inside ~0.76 of the canvas). Ground shadows anchor the bodies to the field.
const shadow = (cy = 0.80, rx = 0.30, ry = 0.07) => ell(0.5, cy, rx, ry, OUT, 0.35);

function spriteStone() {
  // A standing stone: a tapered monolith, moon-silvered up its left edge, with
  // carved grooves and a rubble footing.
  const body = vgrad(STONE_L, STONE_D, 0.2, 0.85);
  return [
    shadow(0.84, 0.26, 0.06),
    // monolith (tapered: triangle shoulders over a rounded shaft)
    rrect(0.5, 0.55, 0.13, 0.30, 0.05, OUT),
    tri(0.37, 0.34, 0.63, 0.34, 0.5, 0.16, OUT),
    rrect(0.5, 0.55, 0.105, 0.275, 0.04, body),
    tri(0.40, 0.35, 0.60, 0.35, 0.5, 0.19, body),
    // the moonlit rim, up the left flank and over the crown
    cap(0.415, 0.72, 0.43, 0.30, 0.014, STONE_RIM, 0.9),
    cap(0.43, 0.30, 0.50, 0.21, 0.013, STONE_RIM, 0.9),
    // carved grooves
    cap(0.50, 0.42, 0.545, 0.50, 0.008, OUT, 0.55),
    cap(0.47, 0.56, 0.53, 0.62, 0.008, OUT, 0.55),
    cap(0.52, 0.68, 0.47, 0.74, 0.008, OUT, 0.55),
    // rubble at the foot
    ell(0.36, 0.82, 0.055, 0.035, STONE_D), ell(0.63, 0.83, 0.05, 0.03, STONE_D),
    ell(0.36, 0.815, 0.04, 0.02, STONE_L, 0.6), ell(0.63, 0.825, 0.035, 0.018, STONE_L, 0.6),
  ];
}

function spriteCottage() {
  // A thatched cottage, frontal: timber walls, deep thatch, one amber window
  // burning against the night. Reads as broad as it blocks.
  return [
    shadow(0.82, 0.36, 0.06),
    // walls
    rrect(0.5, 0.62, 0.30, 0.17, 0.02, OUT),
    rrect(0.5, 0.62, 0.28, 0.15, 0.015, vgrad(TIMBER_L, TIMBER, 0.5, 0.78)),
    // timber studs
    cap(0.36, 0.50, 0.36, 0.76, 0.008, TIMBER_L, 0.7),
    cap(0.64, 0.50, 0.64, 0.76, 0.008, TIMBER_L, 0.7),
    // thatch: a deep overhung roof, combed with darker strokes, snow-silver ridge
    tri(0.12, 0.52, 0.88, 0.52, 0.5, 0.16, OUT),
    tri(0.16, 0.50, 0.84, 0.50, 0.5, 0.19, vgrad(THATCH_L, THATCH, 0.2, 0.5)),
    cap(0.34, 0.42, 0.28, 0.49, 0.008, OUT, 0.4),
    cap(0.50, 0.30, 0.44, 0.49, 0.008, OUT, 0.4),
    cap(0.62, 0.38, 0.68, 0.49, 0.008, OUT, 0.4),
    cap(0.5, 0.185, 0.5, 0.20, 0.012, STONE_RIM, 0.8), // moonlit ridge cap
    // door
    rrect(0.60, 0.68, 0.055, 0.085, 0.02, OUT, 0.85),
    // the burning window (glow first, pane over it)
    glow(0.42, 0.64, 0.14, WINDOW, 0.55),
    rrect(0.42, 0.64, 0.045, 0.055, 0.008, WINDOW),
    cap(0.42, 0.59, 0.42, 0.69, 0.006, TIMBER, 0.9),
    cap(0.38, 0.64, 0.46, 0.64, 0.006, TIMBER, 0.9),
  ];
}

// The cairn's stone pile, shared by its three states.
function cairnStones(rimColor, rimA) {
  return [
    shadow(0.78, 0.27, 0.06),
    // three courses of rounded stones
    ell(0.36, 0.72, 0.105, 0.075, OUT), ell(0.62, 0.72, 0.115, 0.075, OUT),
    ell(0.36, 0.72, 0.09, 0.06, vgrad(STONE_L, STONE_D, 0.62, 0.8)),
    ell(0.62, 0.72, 0.10, 0.06, vgrad(STONE_L, STONE_D, 0.62, 0.8)),
    ell(0.43, 0.60, 0.10, 0.07, OUT), ell(0.60, 0.61, 0.09, 0.065, OUT),
    ell(0.43, 0.60, 0.085, 0.055, vgrad(STONE_L, STONE_D, 0.5, 0.68)),
    ell(0.60, 0.61, 0.075, 0.05, vgrad(STONE_L, STONE_D, 0.5, 0.68)),
    ell(0.51, 0.48, 0.095, 0.07, OUT),
    ell(0.51, 0.48, 0.08, 0.055, vgrad(STONE_RIM, STONE_D, 0.38, 0.56)),
    // the capstone's rim-light
    cap(0.445, 0.455, 0.56, 0.44, 0.011, rimColor, rimA),
  ];
}

function spriteCairn() {
  // A dark cairn — an unclaimed den: cold stones under a faint moon rim.
  return cairnStones(STONE_RIM, 0.85);
}

function spriteCairnMarked() {
  // A MARKED cairn — the wolf's den: the pile lit from within by the blood-moon
  // sigil, a red halo breathing over the stones. The mark is the game's own
  // maw-sigil in miniature: a double ring raked by THREE claw-slashes.
  return [
    glow(0.5, 0.58, 0.34, BLOOD, 0.5),
    ...cairnStones(BLOOD_L, 0.95),
    glow(0.5, 0.33, 0.17, BLOOD, 0.55),
    ring(0.5, 0.33, 0.105, 0.008, hex("#a82838")),
    ring(0.5, 0.33, 0.063, 0.006, hex("#a82838"), 0.85),
    cap(0.435, 0.265, 0.545, 0.345, 0.007, BLOOD_L),
    cap(0.42, 0.305, 0.53, 0.385, 0.007, BLOOD_L),
    cap(0.455, 0.35, 0.565, 0.415, 0.007, BLOOD_L),
  ];
}

function spriteCairnCleansed() {
  // A CLEANSED cairn — the hunters' scar: the pile ringed by a pale ward that
  // bars re-marking until it fades.
  return [
    ...cairnStones(WARD_L, 0.8),
    ring(0.5, 0.62, 0.30, 0.008, WARD, 0.75),
    ring(0.5, 0.62, 0.30, 0.02, WARD, 0.25),
    glow(0.5, 0.50, 0.2, WARD_L, 0.18),
  ];
}

function spriteMoonwell() {
  // A moonwell: a stone-rimmed pool where the moon always reaches — dark water
  // holding a full white reflection, ripples spreading from it.
  const rippleHit = (r) => (x, y) => {
    const d = Math.hypot((x - 0.5) / 1.0, (y - 0.54) / 0.82);
    return Math.abs(d - r) < 0.012 ? 1 : 0;
  };
  return [
    glow(0.5, 0.52, 0.46, MOONLIGHT, 0.22),
    // outer stone rim (slightly squashed for a hint of top-down)
    S((x, y) => (inEllipse(x, y, 0.5, 0.54, 0.34, 0.29) ? 1 : 0), OUT),
    S((x, y) => (inEllipse(x, y, 0.5, 0.53, 0.315, 0.265) ? 1 : 0), vgrad(STONE_RIM, STONE_D, 0.3, 0.78)),
    // the water
    S((x, y) => (inEllipse(x, y, 0.5, 0.54, 0.26, 0.21) ? 1 : 0), vgrad(WATER_D, hex("#0c1220"), 0.35, 0.75)),
    S(rippleHit(0.16), WATER_RIM, 0.5),
    S(rippleHit(0.22), WATER_RIM, 0.3),
    // the moon's reflection, bright and unwavering
    glow(0.5, 0.50, 0.15, MOONLIGHT, 0.85),
    ell(0.5, 0.50, 0.065, 0.055, hex("#eef4ff")),
  ];
}

function spriteWolfHuman() {
  // The man — a hooded traveller the village does not yet fear: heavy cloak,
  // shadowed hood, and the first amber of the curse behind the eyes.
  return [
    shadow(0.82, 0.22, 0.055),
    // cloak: a broad hem sweeping up to the shoulders
    tri(0.28, 0.80, 0.72, 0.80, 0.5, 0.38, OUT),
    ell(0.5, 0.78, 0.225, 0.06, OUT),
    tri(0.31, 0.78, 0.69, 0.78, 0.5, 0.40, vgrad(CLOAK, CLOAK_D, 0.42, 0.78)),
    ell(0.5, 0.77, 0.19, 0.045, CLOAK_D),
    // chest opening
    tri(0.44, 0.52, 0.56, 0.52, 0.5, 0.70, MAN),
    // hood
    ell(0.5, 0.36, 0.155, 0.165, OUT),
    ell(0.5, 0.36, 0.135, 0.145, vgrad(hex("#8a7a58"), CLOAK, 0.24, 0.48)),
    // the face in shadow, chin catching the moon
    ell(0.5, 0.395, 0.085, 0.095, hex("#241d16")),
    ell(0.5, 0.445, 0.055, 0.04, SKIN, 0.85),
    // amber pinpricks — the curse waking
    ell(0.465, 0.385, 0.014, 0.016, EYE), ell(0.535, 0.385, 0.014, 0.016, EYE),
    glow(0.5, 0.385, 0.075, EYE, 0.22),
    // a moonlit rim down the cloak's left edge
    cap(0.345, 0.72, 0.44, 0.44, 0.010, STONE_RIM, 0.55),
  ];
}

function spriteWolfBeast() {
  // The beast at a full run, FACING EAST (render rotates it to the heading):
  // hunched coat, streaming tail west, wedge muzzle east, pricked ears, amber
  // eye — the pale spine-ridge and rim keeping it legible on dark ground.
  return [
    shadow(0.70, 0.34, 0.06),
    // tail streaming behind (left)
    cap(0.20, 0.52, 0.06, 0.40, 0.035, OUT),
    cap(0.21, 0.52, 0.08, 0.41, 0.026, COAT),
    // hind and fore legs, mid-stride
    cap(0.30, 0.58, 0.22, 0.74, 0.028, OUT), cap(0.30, 0.58, 0.23, 0.73, 0.02, COAT),
    cap(0.62, 0.58, 0.72, 0.73, 0.028, OUT), cap(0.62, 0.58, 0.71, 0.72, 0.02, COAT),
    cap(0.38, 0.60, 0.36, 0.76, 0.026, OUT), cap(0.38, 0.60, 0.365, 0.75, 0.018, hex("#1a161c")),
    cap(0.56, 0.60, 0.52, 0.75, 0.026, OUT), cap(0.56, 0.60, 0.53, 0.74, 0.018, hex("#1a161c")),
    // the body: a long low lunge
    ell(0.45, 0.52, 0.265, 0.135, OUT),
    ell(0.45, 0.52, 0.245, 0.115, vgrad(COAT_RIDGE, COAT, 0.40, 0.62)),
    // shoulders and head driving east
    ell(0.66, 0.46, 0.115, 0.10, OUT),
    ell(0.66, 0.46, 0.10, 0.085, COAT),
    // muzzle wedge past the leading edge
    tri(0.72, 0.385, 0.90, 0.46, 0.72, 0.52, OUT),
    tri(0.725, 0.40, 0.875, 0.46, 0.725, 0.505, COAT),
    ell(0.875, 0.455, 0.018, 0.016, OUT), // nose
    // jaw, slightly parted, a blood fleck
    tri(0.73, 0.50, 0.85, 0.50, 0.74, 0.56, COAT),
    cap(0.80, 0.505, 0.845, 0.49, 0.006, BLOOD, 0.85),
    // ears pricked back
    tri(0.60, 0.375, 0.665, 0.395, 0.615, 0.30, OUT), tri(0.61, 0.38, 0.655, 0.395, 0.62, 0.315, COAT),
    tri(0.66, 0.375, 0.72, 0.40, 0.685, 0.305, OUT), tri(0.665, 0.38, 0.71, 0.40, 0.687, 0.32, COAT),
    // the pale spine ridge, nape to rump
    cap(0.26, 0.475, 0.60, 0.43, 0.016, COAT_RIDGE, 0.9),
    cap(0.26, 0.475, 0.60, 0.43, 0.007, COAT_RIM, 0.6),
    // rim light along the back
    cap(0.24, 0.44, 0.62, 0.40, 0.006, COAT_RIM, 0.8),
    // the amber eye
    ell(0.70, 0.43, 0.017, 0.015, EYE),
    glow(0.70, 0.43, 0.05, EYE, 0.3),
  ];
}

function spriteVillager() {
  // A villager of the watch: rough tunic, thrown-back coif, a hayfork clutched
  // two-handed — brave enough only in numbers.
  return [
    shadow(0.82, 0.20, 0.05),
    // the hayfork, angled across the body
    cap(0.66, 0.24, 0.56, 0.78, 0.012, OUT),
    cap(0.655, 0.25, 0.555, 0.77, 0.007, TIMBER_L),
    cap(0.615, 0.205, 0.71, 0.245, 0.008, STEEL_L), // head bar
    cap(0.625, 0.21, 0.605, 0.13, 0.006, STEEL_L),
    cap(0.66, 0.22, 0.655, 0.135, 0.006, STEEL_L),
    cap(0.695, 0.235, 0.70, 0.15, 0.006, STEEL_L),
    // body: tunic over hose
    tri(0.34, 0.80, 0.66, 0.80, 0.5, 0.42, OUT),
    tri(0.365, 0.78, 0.635, 0.78, 0.5, 0.44, vgrad(VILLAGER, VILLAGER_D, 0.5, 0.78)),
    cap(0.42, 0.62, 0.58, 0.62, 0.012, VILLAGER_D), // belt
    // arms crossing to the haft
    cap(0.44, 0.55, 0.585, 0.48, 0.026, OUT), cap(0.44, 0.55, 0.58, 0.485, 0.018, VILLAGER),
    ell(0.585, 0.475, 0.026, 0.026, SKIN),
    // head in a loose coif
    ell(0.5, 0.335, 0.105, 0.115, OUT),
    ell(0.5, 0.34, 0.09, 0.10, SKIN),
    ell(0.5, 0.295, 0.095, 0.06, VILLAGER_D), // coif brim
    ell(0.5, 0.265, 0.075, 0.045, VILLAGER),
    // simple shadowed eyes
    ell(0.468, 0.345, 0.011, 0.013, OUT, 0.8), ell(0.532, 0.345, 0.011, 0.013, OUT, 0.8),
  ];
}

function spriteHound() {
  // The hound — lean, low, and fast, FACING EAST like the beast: a coursing dog
  // stretched flat out, all legs and muzzle.
  return [
    shadow(0.68, 0.30, 0.05),
    // whip tail
    cap(0.18, 0.47, 0.06, 0.38, 0.014, OUT), cap(0.18, 0.47, 0.075, 0.39, 0.008, HOUND),
    // legs at full stretch
    cap(0.30, 0.55, 0.18, 0.68, 0.02, OUT), cap(0.30, 0.55, 0.19, 0.67, 0.013, HOUND_D),
    cap(0.62, 0.55, 0.76, 0.66, 0.02, OUT), cap(0.62, 0.55, 0.75, 0.65, 0.013, HOUND_D),
    cap(0.36, 0.56, 0.30, 0.70, 0.018, OUT), cap(0.36, 0.56, 0.31, 0.69, 0.012, HOUND),
    cap(0.58, 0.56, 0.64, 0.70, 0.018, OUT), cap(0.58, 0.56, 0.63, 0.69, 0.012, HOUND),
    // the long lean body, tucked waist
    ell(0.44, 0.50, 0.235, 0.095, OUT),
    ell(0.44, 0.50, 0.215, 0.078, vgrad(HOUND, HOUND_D, 0.42, 0.58)),
    ell(0.52, 0.52, 0.10, 0.055, HOUND_D, 0.6), // tucked flank shading
    // neck and narrow head driving east
    cap(0.60, 0.46, 0.72, 0.42, 0.05, OUT), cap(0.60, 0.46, 0.71, 0.425, 0.04, HOUND),
    tri(0.72, 0.375, 0.88, 0.43, 0.72, 0.475, OUT),
    tri(0.725, 0.39, 0.855, 0.43, 0.725, 0.465, HOUND),
    ell(0.855, 0.428, 0.014, 0.013, OUT), // nose
    // a flying ear
    tri(0.68, 0.38, 0.74, 0.40, 0.665, 0.31, OUT), tri(0.685, 0.385, 0.73, 0.40, 0.677, 0.325, HOUND_D),
    // eye
    ell(0.735, 0.415, 0.012, 0.011, EYE, 0.9),
  ];
}

function spriteKnight() {
  // A knight of the watch: great helm, mail and plate, a kite shield blazoned
  // with the hunters' cross — the wall the horde must break.
  return [
    shadow(0.83, 0.23, 0.055),
    // the kite shield, held across the left side
    tri(0.295, 0.44, 0.50, 0.44, 0.40, 0.76, OUT),
    ell(0.398, 0.455, 0.103, 0.05, OUT),
    tri(0.315, 0.455, 0.48, 0.455, 0.40, 0.73, vgrad(hex("#6a4048"), hex("#4a2c34"), 0.46, 0.72)),
    ell(0.398, 0.465, 0.082, 0.038, hex("#6a4048")),
    cap(0.398, 0.47, 0.398, 0.65, 0.012, ROBE, 0.9), // the pale cross
    cap(0.345, 0.52, 0.45, 0.52, 0.012, ROBE, 0.9),
    // body: surcoat over mail
    tri(0.36, 0.80, 0.68, 0.80, 0.52, 0.40, OUT),
    tri(0.385, 0.78, 0.655, 0.78, 0.52, 0.42, vgrad(STEEL, STEEL_D, 0.46, 0.78)),
    cap(0.44, 0.60, 0.62, 0.60, 0.012, STEEL_D), // belt
    // sword arm at the right, blade down
    cap(0.60, 0.52, 0.66, 0.62, 0.026, OUT), cap(0.60, 0.52, 0.655, 0.615, 0.018, STEEL),
    cap(0.665, 0.63, 0.685, 0.80, 0.012, OUT), cap(0.665, 0.635, 0.682, 0.79, 0.007, STEEL_L),
    cap(0.635, 0.635, 0.70, 0.62, 0.008, STEEL_D), // crossguard
    // pauldrons
    ell(0.41, 0.45, 0.06, 0.045, OUT), ell(0.41, 0.45, 0.048, 0.035, STEEL_L),
    ell(0.63, 0.45, 0.06, 0.045, OUT), ell(0.63, 0.45, 0.048, 0.035, STEEL_L),
    // the great helm: flat-topped, slit dark
    rrect(0.52, 0.32, 0.095, 0.105, 0.03, OUT),
    rrect(0.52, 0.32, 0.078, 0.088, 0.024, vgrad(STEEL_L, STEEL, 0.24, 0.40)),
    cap(0.455, 0.315, 0.585, 0.315, 0.010, OUT, 0.9), // eye slit
    cap(0.52, 0.335, 0.52, 0.40, 0.006, OUT, 0.7),    // breath cross
    // moon on the helm crown
    cap(0.462, 0.245, 0.578, 0.245, 0.006, STEEL_L, 0.9),
  ];
}

function spriteHuntsman() {
  // The huntsman — the silver-bolt arm of the watch: hooded in green, a bent
  // bow drawn across the body and a quiver at the hip.
  const bowHit = (x, y) => {
    // an arc: distance from a circle centred left of the figure
    const d = Math.hypot(x - 0.30, y - 0.47);
    return Math.abs(d - 0.30) < 0.013 && x > 0.30 && y > 0.17 && y < 0.78 ? 1 : 0;
  };
  return [
    shadow(0.82, 0.20, 0.05),
    // body: green cloak
    tri(0.35, 0.80, 0.67, 0.80, 0.51, 0.40, OUT),
    tri(0.375, 0.78, 0.645, 0.78, 0.51, 0.42, vgrad(GREEN, GREEN_D, 0.46, 0.78)),
    cap(0.44, 0.61, 0.60, 0.61, 0.011, GREEN_D), // belt
    // quiver at the hip, bolts fletched silver
    cap(0.60, 0.62, 0.66, 0.76, 0.028, OUT), cap(0.60, 0.625, 0.655, 0.755, 0.021, TIMBER),
    cap(0.585, 0.60, 0.615, 0.545, 0.006, STEEL_L), cap(0.615, 0.61, 0.65, 0.555, 0.006, STEEL_L),
    // the bow: stave, string, and a nocked silver bolt
    S(bowHit, OUT),
    S((x, y) => {
      const d = Math.hypot(x - 0.30, y - 0.47);
      return Math.abs(d - 0.30) < 0.008 && x > 0.31 && y > 0.185 && y < 0.765 ? 1 : 0;
    }, TIMBER_L),
    cap(0.475, 0.212, 0.475, 0.728, 0.004, STONE_RIM, 0.9), // string
    cap(0.32, 0.47, 0.56, 0.47, 0.006, STEEL_L),            // the bolt
    tri(0.30, 0.47, 0.345, 0.452, 0.345, 0.488, STEEL_L),   // its silver head
    // drawing arm
    cap(0.46, 0.52, 0.545, 0.47, 0.024, OUT), cap(0.46, 0.52, 0.54, 0.475, 0.016, GREEN),
    ell(0.545, 0.468, 0.024, 0.024, SKIN),
    // deep hood, face shadowed
    ell(0.51, 0.335, 0.11, 0.115, OUT),
    ell(0.51, 0.335, 0.093, 0.098, vgrad(GREEN, GREEN_D, 0.24, 0.44)),
    ell(0.51, 0.36, 0.062, 0.062, hex("#1c1812")),
    ell(0.51, 0.395, 0.04, 0.028, SKIN, 0.8), // chin
    tri(0.42, 0.30, 0.60, 0.30, 0.51, 0.20, GREEN_D), // hood peak
  ];
}

function spriteFriar() {
  // The friar — the anti-werewolf: pale habit, tonsured crown, and the raised
  // relic-cross whose consecration bleeds the fury thin.
  return [
    shadow(0.82, 0.21, 0.05),
    // the habit: a wide A sweeping to the hem
    tri(0.31, 0.80, 0.69, 0.80, 0.5, 0.38, OUT),
    tri(0.335, 0.78, 0.665, 0.78, 0.5, 0.40, vgrad(ROBE, ROBE_D, 0.44, 0.78)),
    // cowl folds
    cap(0.46, 0.50, 0.42, 0.74, 0.007, ROBE_D, 0.7),
    cap(0.54, 0.50, 0.58, 0.74, 0.007, ROBE_D, 0.7),
    cap(0.40, 0.60, 0.60, 0.60, 0.014, hex("#6a604a")), // the rope girdle
    ell(0.60, 0.615, 0.016, 0.02, hex("#6a604a")),      // its knot
    // the raised arm and the relic-cross, held high and alight
    cap(0.575, 0.50, 0.665, 0.345, 0.026, OUT), cap(0.575, 0.50, 0.66, 0.35, 0.018, ROBE),
    ell(0.665, 0.34, 0.024, 0.024, SKIN),
    glow(0.685, 0.235, 0.13, GOLD, 0.5),
    cap(0.685, 0.175, 0.685, 0.30, 0.010, GOLD),
    cap(0.647, 0.215, 0.723, 0.215, 0.010, GOLD),
    // head: tonsure — a shaved crown ringed with hair
    ell(0.48, 0.335, 0.10, 0.108, OUT),
    ell(0.48, 0.34, 0.085, 0.093, SKIN),
    S((x, y) => (inEllipse(x, y, 0.48, 0.305, 0.088, 0.052) && !inEllipse(x, y, 0.48, 0.30, 0.055, 0.032) ? 1 : 0),
      hex("#5a4c3a")),
    // calm shut eyes (the chant, mid-consecration)
    cap(0.447, 0.35, 0.468, 0.35, 0.005, OUT, 0.85),
    cap(0.492, 0.35, 0.513, 0.35, 0.005, OUT, 0.85),
  ];
}

const SPRITES = {
  "stone": spriteStone,
  "cottage": spriteCottage,
  "cairn": spriteCairn,
  "cairn-marked": spriteCairnMarked,
  "cairn-cleansed": spriteCairnCleansed,
  "moonwell": spriteMoonwell,
  "wolf-human": spriteWolfHuman,
  "wolf-beast": spriteWolfBeast,
  "villager": spriteVillager,
  "hound": spriteHound,
  "knight": spriteKnight,
  "huntsman": spriteHuntsman,
  "friar": spriteFriar,
};

// ---------- establishing scenes (art/village-<id>.png, 640×360) ----------
// One scene grammar for all eight: a sky, THE moon, layered ridges, drifting
// mist, the village's silhouettes, weather. Every knob lives on a theme object;
// the seeded RNG fixes the jitter so regeneration is byte-stable.

// The howling wolf and pine silhouettes, shared with tools/gen-ww-icons.mjs.
function inWolfU(px, py) {
  if (inEllipse(px, py, 0.655, 0.735, 0.135, 0.150)) return true;
  if (inCapsule(px, py, 0.74, 0.70, 0.84, 0.82, 0.045)) return true;
  if (inEllipse(px, py, 0.83, 0.82, 0.05, 0.045)) return true;
  if (inCapsule(px, py, 0.63, 0.69, 0.475, 0.605, 0.085)) return true;
  if (inEllipse(px, py, 0.47, 0.665, 0.085, 0.115)) return true;
  if (inCapsule(px, py, 0.455, 0.64, 0.445, 0.855, 0.045)) return true;
  if (inCapsule(px, py, 0.475, 0.60, 0.410, 0.460, 0.058)) return true;
  if (inEllipse(px, py, 0.410, 0.450, 0.062, 0.058)) return true;
  if (inTri(px, py, 0.392, 0.488, 0.452, 0.452, 0.335, 0.318)) return true;
  if (inCapsule(px, py, 0.360, 0.360, 0.335, 0.318, 0.020)) return true;
  if (inTri(px, py, 0.432, 0.435, 0.478, 0.452, 0.470, 0.372)) return true;
  return false;
}
const inWolfAt = (px, py, wx, wy, s) => inWolfU((px - wx) / s + 0.5, (py - wy) / s + 0.6);
function inPine(px, py, bx, by, h, w) {
  if (inCapsule(px, py, bx, by - h * 0.12, bx, by, w * 0.07)) return true;
  const tiers = [
    [by - h * 0.10, w * 0.50, by - h * 0.55],
    [by - h * 0.40, w * 0.40, by - h * 0.78],
    [by - h * 0.66, w * 0.28, by - h * 1.0],
  ];
  for (const [baseY, halfW, apexY] of tiers) {
    if (inTri(px, py, bx - halfW, baseY, bx + halfW, baseY, bx, apexY)) return true;
  }
  return false;
}
// A dead fen tree: a leaning trunk splitting into gnarled, tapering limbs —
// each limb a quadratic arc sampled as capsule links whose width thins to a
// twig, so the silhouette reads instantly as drowned-country timber.
function inFenTree(px, py, bx, by, h, w) {
  const arc = (x0, y0, mx, my, x1, y1, w0, w1) => {
    let ax = x0, ay = y0;
    for (let t = 1; t <= 5; t++) {
      const u = t / 5, v = 1 - u;
      const qx = v * v * x0 + 2 * v * u * mx + u * u * x1;
      const qy = v * v * y0 + 2 * v * u * my + u * u * y1;
      if (inCapsule(px, py, ax, ay, qx, qy, w0 + (w1 - w0) * u)) return true;
      ax = qx; ay = qy;
    }
    return false;
  };
  const topX = bx + w * 0.05, topY = by - h * 0.42;
  if (inCapsule(px, py, bx, by, topX, topY, w * 0.07)) return true; // trunk
  // three main limbs clawing at the sky
  if (arc(topX, topY, bx - w * 0.28, by - h * 0.72, bx - w * 0.42, by - h * 0.88, w * 0.045, w * 0.012)) return true;
  if (arc(topX, topY, bx + w * 0.30, by - h * 0.66, bx + w * 0.48, by - h * 0.80, w * 0.045, w * 0.012)) return true;
  if (arc(topX, topY, bx + w * 0.05, by - h * 0.80, bx - w * 0.10, by - h * 1.00, w * 0.040, w * 0.010)) return true;
  // two low twigs
  if (arc(bx - w * 0.20, by - h * 0.66, bx - w * 0.38, by - h * 0.70, bx - w * 0.52, by - h * 0.64, w * 0.020, w * 0.008)) return true;
  if (arc(bx + w * 0.22, by - h * 0.60, bx + w * 0.40, by - h * 0.58, bx + w * 0.54, by - h * 0.50, w * 0.020, w * 0.008)) return true;
  return false;
}

// A village theme. Colors are [r,g,b]; positions are unit fractions of the
// 16:9 frame (x aspect-corrected where circles must stay round).
const SCENES = [];
SCENES.push(
  {
    id: "thornwick", seed: 101,
    skyTop: hex("#141b2e"), skyBot: hex("#2a3450"), horizon: hex("#3a4666"),
    moon: { x: 0.70, y: 0.26, r: 0.115, tint: hex("#e6eaf6") },
    ridge: hex("#232c42"), front: hex("#0b0e16"), groundSnow: true,
    cottages: [0.18, 0.34, 0.55, 0.80], pines: [[0.06, 0.34, 0.16], [0.93, 0.30, 0.14]],
    mist: 0.45, snowfall: true, stars: 0.8,
  },
  {
    id: "greymoor", seed: 102,
    skyTop: hex("#181f26"), skyBot: hex("#33403e"), horizon: hex("#46564e"),
    moon: { x: 0.28, y: 0.24, r: 0.10, tint: hex("#dfe6e2") },
    ridge: hex("#252e2c"), front: hex("#0a0d0c"),
    stones: [0.22, 0.38, 0.63], cottages: [0.50], pines: [],
    wolf: { x: 0.82, y: 0.60, s: 0.36 }, // the beast howling on the moor's ridge
    mist: 0.8, stars: 0.35,
  },
  {
    id: "hollowby", seed: 103,
    skyTop: hex("#131a30"), skyBot: hex("#2c3654"), horizon: hex("#414f74"),
    moon: { x: 0.80, y: 0.22, r: 0.105, tint: hex("#e6eaf6") },
    ridge: hex("#20283e"), front: hex("#0a0d14"),
    abbey: 0.36, wall: true, cottages: [0.14, 0.58, 0.72, 0.88], pines: [],
    mist: 0.35, stars: 0.7,
  },
  {
    id: "wulfmere", seed: 104,
    skyTop: hex("#0c1020"), skyBot: hex("#1d2438"), horizon: hex("#2c3650"),
    moon: { x: 0.50, y: 0.20, r: 0.135, tint: hex("#eef2ff") },
    ridge: hex("#161c2c"), front: hex("#070910"), water: 0.655,
    willows: [[0.12, 0.30], [0.86, 0.32]], cottages: [0.30, 0.66], pines: [],
    mist: 0.6, stars: 0.9,
  },
  {
    id: "ashthorn", seed: 105,
    skyTop: hex("#170f12"), skyBot: hex("#38222a"), horizon: hex("#5a3030"),
    moon: { x: 0.24, y: 0.24, r: 0.095, tint: hex("#e8d8ce") },
    ridge: hex("#251a1e"), front: hex("#0c0709"),
    pyres: [0.30, 0.55, 0.82], cottages: [0.44, 0.68], pines: [[0.08, 0.26, 0.12]],
    burnt: true, mist: 0.3, embers: true, stars: 0.25,
  },
  {
    id: "mirefen", seed: 106,
    skyTop: hex("#0e1512"), skyBot: hex("#20302a"), horizon: hex("#31463c"),
    moon: { x: 0.64, y: 0.26, r: 0.11, tint: hex("#d8e4d8"), drowned: true },
    ridge: hex("#17211c"), front: hex("#080c0a"), water: 0.67,
    willows: [[0.20, 0.30], [0.55, 0.24], [0.90, 0.28]], cottages: [0.38], pines: [],
    wisps: [0.28, 0.62, 0.80], mist: 0.7, stars: 0.4,
  },
  {
    id: "galehead", seed: 107,
    skyTop: hex("#1a2230"), skyBot: hex("#39485c"), horizon: hex("#54687e"),
    moon: { x: 0.76, y: 0.28, r: 0.10, tint: hex("#e6eef6") },
    ridge: hex("#242f3e"), front: hex("#0b0f14"), sea: true,
    steams: [0.26, 0.48, 0.66], stones: [0.38, 0.58], cottages: [0.16], pines: [],
    windstreaks: true, mist: 0.25, stars: 0.5,
  },
  {
    id: "direhollow", seed: 108,
    skyTop: hex("#160e14"), skyBot: hex("#2c1a26"), horizon: hex("#48283a"),
    moon: { x: 0.50, y: 0.24, r: 0.145, tint: hex("#f0d8d2"), blood: true },
    ridge: hex("#1e141c"), front: hex("#090509"),
    pineWall: true, cottages: [0.24, 0.42, 0.62, 0.80], pines: [],
    mist: 0.5, stars: 0.6,
  },
);

const SCENE_W = 640, SCENE_H = 360, ASPECT = SCENE_W / SCENE_H;

function renderScene(theme) {
  const rnd = mulberry32(theme.seed);
  // seeded furniture: stars, ridge phases, snowfall/ember flecks, window jitter
  const stars = [];
  const starN = Math.round(26 * (theme.stars ?? 0.6));
  for (let i = 0; i < starN; i++) stars.push([rnd(), rnd() * 0.5, 0.3 + rnd() * 0.7]);
  const rp = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const flecks = [];
  if (theme.snowfall || theme.embers) {
    for (let i = 0; i < 70; i++) flecks.push([rnd(), rnd(), 0.4 + rnd() * 0.6]);
  }
  const winLit = (theme.cottages ?? []).map(() => rnd() > 0.25);

  // ridge lines: y as a fn of x (unit), back higher than front
  const backRidgeY = (x) => 0.60 + 0.045 * Math.sin(x * 5.1 + rp[0]) + 0.03 * Math.sin(x * 11.7 + rp[1]);
  const frontHillY = (x) => 0.78 + 0.035 * Math.sin(x * 3.3 + rp[2]) + 0.02 * Math.sin(x * 8.9 + rp[3]);

  const mx = theme.moon.x * ASPECT, my = theme.moon.y, mr = theme.moon.r;
  const waterY = theme.water ?? (theme.sea ? 0.70 : null);

  const sample = (x, y) => {
    const xa = x * ASPECT; // aspect-corrected for anything round
    // ---- sky ----
    let col = mix(theme.skyTop, theme.skyBot, smooth(0.0, 0.75, y));
    col = mix(col, theme.horizon, smooth(0.72, 0.52, y) * 0.45);
    // stars
    for (const [sx, sy, br] of stars) {
      const sd = Math.hypot((sx - x) * ASPECT, sy - y);
      const tw = smooth(0.006, 0, sd);
      if (tw > 0) col = mix(col, hex("#ffffff"), tw * br * 0.85);
    }
    // wind streaks (galehead): long pale shears across the upper sky
    if (theme.windstreaks) {
      const wv = Math.sin((y * 26 + Math.sin(xa * 2.2) * 1.6 + rp[1]) * 1.0);
      if (y < 0.5 && wv > 0.82) col = mix(col, theme.horizon, (wv - 0.82) * 2.2 * (0.5 - y));
    }
    // ---- the moon ----
    const md = Math.hypot(xa - mx, y - my);
    const tint = theme.moon.tint;
    const haloC = theme.moon.blood ? hex("#c86a6a") : tint;
    col = mix(col, haloC, smooth(mr * 2.3, mr, md) * (theme.moon.drowned ? 0.16 : 0.26));
    const body = smooth(mr, mr * 0.965, md);
    if (body > 0) {
      let m = mix(tint, hex("#ffffff"), smooth(mr * 0.7, 0, md) * 0.5);
      if (theme.moon.blood) m = mix(m, hex("#d86a5a"), 0.45);
      // craters
      for (const [ux, uy, ur] of [[-0.3, -0.2, 0.16], [0.24, -0.3, 0.1], [0.14, 0.26, 0.18], [-0.32, 0.26, 0.09]]) {
        const cd = Math.hypot(xa - mx - ux * mr, y - my - uy * mr) / (ur * mr);
        if (cd < 1) m = mix(m, mix(tint, theme.skyTop, 0.35), (1 - cd) * 0.4);
      }
      col = mix(col, m, body * (theme.moon.drowned ? 0.75 : 1));
    }
    // ---- back ridge ----
    const bry = backRidgeY(x);
    if (y > bry) col = mix(col, theme.ridge, smooth(bry, bry + 0.012, y));
    // standing stones on the back ridge (greymoor / galehead)
    for (const sx of theme.stones ?? []) {
      const by = backRidgeY(sx) + 0.005;
      const hw = 0.011, h = 0.085;
      if (x > sx - hw && x < sx + hw && y > by - h && y < by) {
        const taper = (by - y) / h;
        if (Math.abs(x - sx) < hw * (1 - taper * 0.45)) col = theme.ridge;
      }
    }
    // ---- water (fen / mere / sea): mirror-dark with the moon's path ----
    if (waterY != null && y > waterY) {
      const depth = smooth(waterY, 1, y);
      let w = mix(mix(theme.skyBot, hex("#05070c"), 0.55), hex("#03040a"), depth);
      // the moonlight lane, rippled
      const lane = smooth(mr * 1.6, mr * 0.2, Math.abs(xa - mx) + Math.abs(Math.sin(y * 90 + rp[0]) * 0.012));
      w = mix(w, theme.moon.tint, lane * 0.30 * (1 - depth * 0.5));
      col = mix(col, w, smooth(waterY, waterY + 0.02, y));
    }
    // ---- mist: two soft banks lying along the ridge line ----
    const mistA = theme.mist ?? 0.4;
    if (mistA > 0) {
      const m1 = smooth(0.10, 0.0, Math.abs(y - (bry + 0.10) + 0.03 * Math.sin(x * 7 + rp[2])));
      const m2 = smooth(0.07, 0.0, Math.abs(y - 0.82 + 0.025 * Math.sin(x * 9 + rp[3])));
      col = mix(col, mix(theme.horizon, hex("#c8d2e0"), 0.4), (m1 * 0.5 + m2 * 0.35) * mistA);
    }
    // ---- middle ground: the village silhouettes on the front hill ----
    // The bare hill and the things standing on it are tracked separately so a
    // snow-bound village can wear a pale ground under dark silhouettes.
    const fy = frontHillY(x);
    const onGround = y > fy;
    let solid = onGround && !theme.groundSnow;
    // cottages: body + roof + (maybe) one lit window each
    let window = 0;
    (theme.cottages ?? []).forEach((cx, i) => {
      const by = frontHillY(cx) + 0.01;
      const hw = 0.045, wallT = by - 0.075, apex = by - 0.145;
      if (x > cx - hw && x < cx + hw && y > wallT && y < by) solid = true;
      if (inTri(x, y, cx - hw * 1.3, wallT, cx + hw * 1.3, wallT, cx, apex)) solid = true;
      if (winLit[i]) {
        const wd = Math.hypot((x - (cx + hw * 0.35)) * ASPECT, (y - (by - 0.038)) * ASPECT);
        window = Math.max(window, smooth(0.028, 0.0, wd));
      }
    });
    // the abbey (hollowby): tower + spire + bell-light, and a town wall
    if (theme.abbey != null) {
      const axc = theme.abbey, by = frontHillY(axc) + 0.01;
      if (x > axc - 0.026 && x < axc + 0.026 && y > by - 0.30 && y < by) solid = true;
      if (inTri(x, y, axc - 0.034, by - 0.30, axc + 0.034, by - 0.30, axc, by - 0.40)) solid = true;
      const bd = Math.hypot((x - axc) * ASPECT, (y - (by - 0.255)) * ASPECT);
      window = Math.max(window, smooth(0.02, 0.0, bd) * 0.9);
      if (theme.wall && y > fy - 0.045 && y < fy - 0.01 && Math.sin(x * 120 + rp[0]) > -0.6) solid = true; // crenellated wall
    }
    // dead fen trees — evaluated aspect-corrected so the limbs keep their reach
    for (const [wx2, wh] of theme.willows ?? []) {
      if (inFenTree(xa, y, wx2 * ASPECT, frontHillY(wx2) + 0.012, wh, 0.22)) solid = true;
    }
    // pines
    for (const [pxx, ph, pw] of theme.pines ?? []) {
      if (inPine(x, y, pxx, frontHillY(pxx) + 0.01, ph, pw)) solid = true;
    }
    // a pine wall behind everything (direhollow)
    if (theme.pineWall) {
      for (let i = 0; i < 11; i++) {
        const pxx = 0.02 + i * 0.098 + (i % 3) * 0.012;
        if (inPine(x, y, pxx, backRidgeY(pxx) + 0.10, 0.24 + (i % 4) * 0.03, 0.10)) solid = true;
      }
    }
    // the howling wolf on its ridge — aspect-corrected so it keeps the icon's proportions
    if (theme.wolf && inWolfAt(xa, y, theme.wolf.x * ASPECT, theme.wolf.y, theme.wolf.s)) solid = true;

    // pyres (ashthorn): pole + flame + glow, burning through the silhouette
    let flame = 0, flameGlow = 0;
    for (const pxx of theme.pyres ?? []) {
      const by = frontHillY(pxx) + 0.008;
      if (x > pxx - 0.006 && x < pxx + 0.006 && y > by - 0.06 && y < by) solid = true;
      const fx = (x - pxx) * ASPECT, fyy = y - (by - 0.105);
      const teardrop = Math.hypot(fx / 0.020, fyy / (0.048 - fx * fx * 260));
      if (Number.isFinite(teardrop) && teardrop < 1) flame = Math.max(flame, 1 - teardrop * 0.5);
      flameGlow = Math.max(flameGlow, smooth(0.16, 0.02, Math.hypot(fx, fyy)));
    }
    // geyser steam (galehead): pale columns widening upward
    for (const sxx of theme.steams ?? []) {
      const by = frontHillY(sxx);
      if (y < by) {
        const w2 = 0.014 + (by - y) * 0.10;
        const off = Math.sin((by - y) * 18 + rp[1] + sxx * 20) * 0.012;
        const sd = Math.abs(x - sxx - off) / w2;
        if (sd < 1) col = mix(col, hex("#cdd6e2"), (1 - sd) * 0.22 * smooth(0.34, 0.02, by - y));
      }
    }
    if (theme.groundSnow && onGround && !solid) {
      // moon-blued snowfield, darkening toward the frame's foot
      col = mix(hex("#c2ccde"), hex("#6a7690"), smooth(fy, 1.0, y));
    }
    if (solid) col = theme.front;
    // burning and lit accents paint OVER the silhouettes
    if (flameGlow > 0) col = mix(col, hex("#e07a3a"), flameGlow * 0.45);
    if (flame > 0) col = mix(col, mix(hex("#ffb45a"), hex("#fff2c8"), flame), Math.min(1, flame * 1.4));
    if (window > 0) col = mix(col, WINDOW, Math.min(1, window * 1.2));
    // marsh wisps (mirefen): pale green corpse-candles over the water
    for (const wxx of theme.wisps ?? []) {
      const wd = Math.hypot((x - wxx) * ASPECT, (y - ((waterY ?? 0.8) + 0.05)) * ASPECT);
      col = mix(col, hex("#b8e6c8"), smooth(0.035, 0.0, wd) * 0.7);
    }
    // weather flecks: snow (cold) or rising embers (ashthorn)
    for (const [fxx, fyy2, br] of flecks) {
      const fd = Math.hypot((x - fxx) * ASPECT, y - fyy2);
      const tw = smooth(0.004, 0, fd);
      if (tw > 0) col = mix(col, theme.embers ? hex("#ffb45a") : hex("#eef2fa"), tw * br * (theme.embers ? 0.8 : 0.7));
    }
    // vignette
    const vd = Math.hypot((x - 0.5) * 1.6, (y - 0.5) * 1.15);
    col = mix(col, hex("#04060a"), smooth(0.62, 1.02, vd) * 0.5);
    return col;
  };

  const buf = Buffer.alloc(SCENE_W * SCENE_H * 4);
  const SS = 2;
  for (let y = 0; y < SCENE_H; y++) {
    for (let x = 0; x < SCENE_W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample((x + (sx + 0.5) / SS) / SCENE_W, (y + (sy + 0.5) / SS) / SCENE_H);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, i = (y * SCENE_W + x) * 4;
      buf[i] = clamp(r / n); buf[i + 1] = clamp(g / n); buf[i + 2] = clamp(b / n);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

// ---------- PNG encoding (same zero-dep path as the icon generators) ----------
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- write everything ----------
mkdirSync(new URL("../art/", import.meta.url), { recursive: true });
const out = (name) => new URL("../art/" + name, import.meta.url);

const SPRITE_SIZE = 128;
for (const [name, build] of Object.entries(SPRITES)) {
  writeFileSync(out(`${name}.png`), encodePNG(SPRITE_SIZE, SPRITE_SIZE, renderSprite(SPRITE_SIZE, build())));
  console.log(`art/${name}.png`);
}
for (const theme of SCENES) {
  writeFileSync(out(`village-${theme.id}.png`), encodePNG(SCENE_W, SCENE_H, renderScene(theme)));
  console.log(`art/village-${theme.id}.png`);
}
console.log("werewolf art written");
