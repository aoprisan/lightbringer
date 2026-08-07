// Dependency-free PNG art generator for The Burning Vigil (the primary game):
// six ESTABLISHING SCENES (art/city-<id>.png, 640×360) for the cities that
// never received painted art — the Ember Foundry, the Pale Bastion, and the
// four Edge-Lands descents — shown at the top of the picker card (LevelDef.art).
//
// Same approach as tools/gen-ww-art.mjs's scene section: every image is a
// scalar field sampled with supersampling, painter's-algorithm composited in
// straight RGB, then written through the shared zero-dep PNG encoder.
// Deterministic: all jitter goes through mulberry32 with fixed per-image seeds.
//
// The palette is the Vigil's world: a city taught that light burns — deep
// blacks against flame-orange, ember-gold, and the Bastion's cold ward-pale.
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
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const inCapsule = (px, py, ax, ay, bx, by, hw) => segDist(px, py, ax, ay, bx, by) <= hw;

const W = 640, H = 360, ASPECT = W / H;

// Shared flame hues (pentagram.html's gold family).
const FLAME = hex("#ffb45a"), FLAME_HOT = hex("#fff2c8"), EMBER = hex("#e07a3a");
const GOLD = hex("#ffcf7a");

// A dead, clawing tree (the werewolf generator's fen tree, re-grown for the
// Emberwood's burnt briars): a leaning trunk splitting into tapering limbs.
function inBurntTree(px, py, bx, by, h, w) {
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
  if (inCapsule(px, py, bx, by, topX, topY, w * 0.07)) return true;
  if (arc(topX, topY, bx - w * 0.28, by - h * 0.72, bx - w * 0.42, by - h * 0.88, w * 0.045, w * 0.012)) return true;
  if (arc(topX, topY, bx + w * 0.30, by - h * 0.66, bx + w * 0.48, by - h * 0.80, w * 0.045, w * 0.012)) return true;
  if (arc(topX, topY, bx + w * 0.05, by - h * 0.80, bx - w * 0.10, by - h * 1.00, w * 0.040, w * 0.010)) return true;
  if (arc(bx - w * 0.20, by - h * 0.66, bx - w * 0.38, by - h * 0.70, bx - w * 0.52, by - h * 0.64, w * 0.020, w * 0.008)) return true;
  if (arc(bx + w * 0.22, by - h * 0.60, bx + w * 0.40, by - h * 0.58, bx + w * 0.54, by - h * 0.50, w * 0.020, w * 0.008)) return true;
  return false;
}

// A tapered ward-obelisk standing at `base`, `h` tall (silhouette hit test).
function inObelisk(x, y, ox, base, h, hw) {
  if (y < base - h || y > base) return false;
  const t = (base - y) / h; // 0 at foot, 1 at tip
  return Math.abs(x - ox) < hw * (1 - t * 0.72);
}

// ---------- the six cities ----------

// THE EMBER FOUNDRY — molten light welling from the deep moulds: white-hot
// channels winding through a black industrial skyline, embers on the updraft.
function sceneFoundry() {
  const rnd = mulberry32(701);
  const rp = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  // the skyline: [x, halfWidth, topY], some wearing a chimney
  const blocks = [];
  for (let i = 0; i < 9; i++) {
    blocks.push([0.03 + i * 0.115 + rnd() * 0.03, 0.038 + rnd() * 0.022, 0.40 + rnd() * 0.13, rnd() > 0.5]);
  }
  const embers = [];
  for (let i = 0; i < 40; i++) embers.push([rnd(), rnd() * 0.9, 0.3 + rnd() * 0.7]);
  const ch1 = (x) => 0.735 + 0.05 * Math.sin(x * 5.2 + rp[0]) + 0.02 * Math.sin(x * 11 + rp[1]);
  const ch2 = (x) => 0.875 + 0.038 * Math.sin(x * 4.1 + rp[2]);
  const SKY_T = hex("#0b0705"), SKY_B = hex("#2c130a"), HORIZ = hex("#5a2410");
  const SIL = hex("#060302");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.60, y));
    col = mix(col, HORIZ, smooth(0.58, 0.38, y) * 0.6);
    // smoke banks lit from below
    const sm = Math.sin(y * 20 + Math.sin(xa * 2.2) * 2 + rp[0]);
    if (y < 0.4 && sm > 0.6) col = mix(col, hex("#1c0c06"), (sm - 0.6) * 1.4);
    // the skyline in silhouette
    let solid = false;
    if (y > 0.545 + 0.012 * Math.sin(x * 6 + rp[1])) solid = true; // the dark ground
    for (const [bx, hw, top, chim] of blocks) {
      if (Math.abs(x - bx) < hw && y > top && y < 0.60) solid = true;
      if (chim && Math.abs(x - (bx + hw * 0.5)) < 0.008 && y > top - 0.075 && y < top + 0.02) solid = true;
    }
    if (solid) col = SIL;
    // chimney mouths breathing ember light
    for (const [bx, hw, top, chim] of blocks) {
      if (!chim) continue;
      const md = Math.hypot((x - (bx + hw * 0.5)) * ASPECT, (y - (top - 0.075)) * ASPECT);
      col = mix(col, EMBER, smooth(0.02, 0, md) * 0.6);
    }
    // THE POUR — a molten fall from the tap-house down into the first channel
    const pourX = 0.455 + 0.006 * Math.sin(y * 30 + rp[2]);
    const pd = Math.abs(x - pourX);
    if (y > 0.50 && y < ch1(x) + 0.01) {
      col = mix(col, EMBER, smooth(0.035, 0.004, pd) * 0.7);
      col = mix(col, FLAME_HOT, smooth(0.007, 0, pd) * 0.95);
    }
    // the two molten channels winding through the moulds
    for (const [ch, wCore, wGlow] of [[ch1, 0.010, 0.075], [ch2, 0.014, 0.09]]) {
      const d = Math.abs(y - ch(x));
      col = mix(col, EMBER, smooth(wGlow, wCore, d) * 0.75);
      col = mix(col, FLAME, smooth(wCore * 1.8, wCore * 0.5, d) * 0.9);
      col = mix(col, FLAME_HOT, smooth(wCore * 0.7, 0, d));
    }
    // the deep wells, brimming white
    for (const [wx, wy, wr] of [[0.235, 0.805, 0.05], [0.71, 0.925, 0.06]]) {
      const wd = Math.hypot((x - wx) * ASPECT, (y - wy) * ASPECT * 1.6);
      col = mix(col, EMBER, smooth(wr * 3.2, wr, wd) * 0.6);
      col = mix(col, FLAME_HOT, smooth(wr, 0, wd));
    }
    // embers on the updraft
    for (const [ex, ey, br] of embers) {
      const tw = smooth(0.0045, 0, Math.hypot((ex - x) * ASPECT, ey - y));
      if (tw > 0) col = mix(col, FLAME, tw * br * 0.85);
    }
    return col;
  };
}

// THE PALE BASTION — ward-stone obelisks ringing a fortress city, all of it
// cold: wan moonlight, white streets, and the five stones faintly burning.
function sceneBastion() {
  const rnd = mulberry32(702);
  const stars = [];
  for (let i = 0; i < 24; i++) stars.push([rnd(), rnd() * 0.5, 0.3 + rnd() * 0.6]);
  const rp = [rnd() * 6.28, rnd() * 6.28];
  // the ring of ward-stones before the walls: [x, base, height, halfWidth]
  const obelisks = [[0.10, 0.86, 0.30, 0.020], [0.30, 0.80, 0.22, 0.015], [0.50, 0.775, 0.19, 0.013],
    [0.70, 0.80, 0.23, 0.015], [0.90, 0.87, 0.31, 0.021]];
  const SKY_T = hex("#0a1018"), SKY_B = hex("#223042"), HORIZ = hex("#31445e");
  const SIL = hex("#070b12"), PALE = hex("#cfd8ea"), PALE_HOT = hex("#eef4ff");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.72, y));
    col = mix(col, HORIZ, smooth(0.70, 0.48, y) * 0.45);
    for (const [sx, sy, br] of stars) {
      const tw = smooth(0.005, 0, Math.hypot((sx - x) * ASPECT, sy - y));
      if (tw > 0) col = mix(col, PALE_HOT, tw * br * 0.9);
    }
    // a wan moon, high and small — the cold the Bastion answers to
    const md = Math.hypot(xa - 0.30, y - 0.16);
    col = mix(col, PALE, smooth(0.13, 0.04, md) * 0.25);
    col = mix(col, PALE_HOT, smooth(0.042, 0.036, md));
    // the fortress: rampart, gate, and the keep over all
    let solid = false;
    const wallT = 0.60 + 0.008 * Math.sin(x * 9 + rp[0]);
    if (y > wallT + 0.03 || (y > wallT && Math.sin(x * 110 + rp[1]) > -0.35)) solid = true; // crenellated rampart
    if (Math.abs(x - 0.50) < 0.052 && y > 0.415) solid = true;                    // the keep
    if (inTri(x, y, 0.435, 0.418, 0.565, 0.418, 0.50, 0.355)) solid = true;       // its roof
    for (const tx of [0.26, 0.74]) {                                              // flanking towers
      if (Math.abs(x - tx) < 0.032 && y > 0.50) solid = true;
      if (inTri(x, y, tx - 0.042, 0.503, tx + 0.042, 0.503, tx, 0.455)) solid = true;
    }
    if (solid) col = SIL;
    // the gate, a cold light within
    const gd = Math.hypot((x - 0.50) * ASPECT, (y - 0.685) * ASPECT * 0.6);
    col = mix(col, PALE, smooth(0.055, 0.005, gd) * 0.55);
    // keep windows, ward-pale
    for (const [wx2, wy2] of [[0.487, 0.47], [0.513, 0.47], [0.50, 0.545]]) {
      const wd = Math.hypot((x - wx2) * ASPECT, (y - wy2) * ASPECT);
      col = mix(col, PALE_HOT, smooth(0.010, 0, wd) * 0.85);
    }
    // ground mist about the stones' feet
    col = mix(col, mix(HORIZ, PALE, 0.3), smooth(0.06, 0, Math.abs(y - 0.80 + 0.02 * Math.sin(x * 7 + rp[0]))) * 0.35);
    // the five ward-stones, pale bodies over the dark ground
    for (const [ox, base, h, hw] of obelisks) {
      if (inObelisk(x, y, ox, base, h, hw)) {
        col = mix(PALE, hex("#8a98b2"), smooth(base - h, base, y));
      }
      // each tip burning cold
      const td = Math.hypot((x - ox) * ASPECT, (y - (base - h)) * ASPECT);
      col = mix(col, PALE_HOT, smooth(0.05, 0, td) * 0.5);
      col = mix(col, PALE_HOT, smooth(0.012, 0, td));
    }
    return col;
  };
}

// THE EMBERWOOD — the wood the fire took and the dark kept: black clawing
// trunks and barrows over ground that still burns in cracks and dapples.
function sceneEmberwood() {
  const rnd = mulberry32(703);
  const rp = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const embers = [];
  for (let i = 0; i < 34; i++) embers.push([rnd(), rnd(), 0.3 + rnd() * 0.7]);
  const spots = [];
  for (let i = 0; i < 9; i++) spots.push([rnd(), 0.70 + rnd() * 0.26, 0.02 + rnd() * 0.035]);
  const backTrees = [[0.10, 0.24], [0.30, 0.30], [0.52, 0.26], [0.72, 0.32], [0.92, 0.25]];
  const GROUND = 0.66;
  const SKY_T = hex("#120806"), SKY_B = hex("#301410"), HORIZ = hex("#502016");
  const SIL = hex("#070302");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.64, y));
    col = mix(col, HORIZ, smooth(0.62, 0.42, y) * 0.55);
    // smoke drifting through the canopy line
    const sm = Math.sin(y * 24 + Math.sin(xa * 2.6) * 2 + rp[0]);
    if (y < 0.5 && sm > 0.65) col = mix(col, hex("#1e0d08"), (sm - 0.65) * 1.5);
    // the ridge of the burnt wood
    const ry = GROUND + 0.025 * Math.sin(x * 4.4 + rp[1]);
    let solid = y > ry;
    // the standing dead, clawing at the smoke
    for (const [tx, th] of backTrees) {
      const ty = GROUND + 0.025 * Math.sin(tx * 4.4 + rp[1]) + 0.01;
      if (inBurntTree(xa, y, tx * ASPECT, ty, th, 0.16)) solid = true;
    }
    // two great briars framing the foreground
    if (inBurntTree(xa, y, 0.045 * ASPECT, 1.02, 0.55, 0.30)) solid = true;
    if (inBurntTree(xa, y, 0.97 * ASPECT, 1.04, 0.50, 0.28)) solid = true;
    // the barrows, low and dark among the trunks
    for (const [bx, br2] of [[0.38, 0.085], [0.60, 0.065], [0.80, 0.075]]) {
      const by = GROUND + 0.025 * Math.sin(bx * 4.4 + rp[1]) + 0.035;
      if (inEllipse(xa, y, bx * ASPECT, by, br2, br2 * 0.42)) solid = true;
    }
    if (solid) col = SIL;
    // the cinder-ground: veins and dapples of living fire in the black
    if (y > ry - 0.01) {
      const vein1 = Math.abs(y - (0.78 + 0.03 * Math.sin(x * 7.5 + rp[2]) + 0.015 * Math.sin(x * 17 + rp[0])));
      const vein2 = Math.abs(y - (0.90 + 0.025 * Math.sin(x * 5.8 + rp[1])));
      let g = smooth(0.02, 0.002, vein1) * 0.95 + smooth(0.024, 0.003, vein2) * 0.85;
      for (const [sx2, sy2, sr] of spots) {
        g = Math.max(g, smooth(sr, sr * 0.15, Math.hypot((x - sx2) * ASPECT, (y - sy2) * ASPECT)) * 0.9);
      }
      const flicker = 0.8 + 0.2 * Math.sin(x * 60 + y * 90 + rp[0]);
      col = mix(col, EMBER, Math.min(1, g) * flicker);
      col = mix(col, FLAME_HOT, smooth(0.9, 1.4, g) * 0.5);
    }
    // a barrow-door ember-light, deep in the middle mound
    col = mix(col, GOLD, smooth(0.016, 0, Math.hypot((x - 0.60) * ASPECT, (y - 0.695) * ASPECT)) * 0.7);
    // embers rising on the heat
    for (const [ex, ey, br] of embers) {
      const tw = smooth(0.004, 0, Math.hypot((ex - x) * ASPECT, ey - y));
      if (tw > 0) col = mix(col, FLAME, tw * br * 0.8);
    }
    return col;
  };
}

// THE MISTMARKET — a market quarter sunk in mire and fog: stall-rows and old
// statues in the drift, lanterns burning warm holes in the grey.
function sceneMistmarket() {
  const rnd = mulberry32(704);
  const rp = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  // stalls: [x, halfWidth, height]; lanterns: [x, y]
  const stalls = [[0.15, 0.052, 0.075], [0.31, 0.045, 0.06], [0.63, 0.05, 0.07], [0.80, 0.042, 0.06]];
  const lanterns = [[0.235, 0.585], [0.475, 0.615], [0.715, 0.60]];
  const MIRE = 0.70;
  const SKY_T = hex("#0d1114"), SKY_B = hex("#2a3236"), HORIZ = hex("#3e4a4c");
  const SIL = hex("#080a0b");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.70, y));
    col = mix(col, HORIZ, smooth(0.68, 0.46, y) * 0.5);
    // the drowned market's far roofline, half-eaten by fog
    const fry = 0.55 + 0.02 * Math.sin(x * 5 + rp[0]);
    if (y > fry) col = mix(col, hex("#161c1e"), smooth(fry, fry + 0.015, y) * 0.85);
    // the stalls and statues on the causeway line
    let solid = false;
    stalls.forEach(([sx2, hw, sh]) => {
      const base = 0.665;
      if (Math.abs(x - sx2) < hw && y > base - sh && y < base + 0.04) solid = true;
      if (inTri(x, y, sx2 - hw * 1.35, base - sh, sx2 + hw * 1.35, base - sh, sx2, base - sh - 0.045)) solid = true;
      // an awning post at each end
      if (Math.abs(x - (sx2 - hw * 1.2)) < 0.004 && y > base - sh && y < base + 0.045) solid = true;
      if (Math.abs(x - (sx2 + hw * 1.2)) < 0.004 && y > base - sh && y < base + 0.045) solid = true;
    });
    // two market statues, robed and staring, higher than the stalls
    for (const [mx2, ms] of [[0.475, 1.0], [0.92, 0.85]]) {
      const base = 0.675;
      if (Math.abs(x - mx2) < 0.028 * ms && y > base - 0.022 * ms && y < base + 0.04) solid = true; // plinth
      if (inCapsule(xa, y, mx2 * ASPECT, base - 0.03 * ms, mx2 * ASPECT, base - 0.135 * ms, 0.028 * ms)) solid = true; // the robe
      if (inEllipse(xa, y, mx2 * ASPECT, base - 0.155 * ms, 0.020 * ms, 0.023 * ms)) solid = true; // the head
    }
    // lantern posts
    for (const [lx] of lanterns) {
      if (Math.abs(x - lx) < 0.0035 && y > 0.585 && y < 0.71) solid = true;
    }
    if (solid) col = SIL;
    // the mire: still black water threaded with scum, mirroring the lanterns
    if (y > MIRE) {
      const depth = smooth(MIRE, 1, y);
      let w = mix(hex("#131b1a"), hex("#070b0a"), depth);
      const scum = Math.sin(y * 90 + Math.sin(xa * 8) * 2 + rp[1]);
      if (scum > 0.8) w = mix(w, hex("#25302c"), (scum - 0.8) * 1.8);
      col = mix(col, w, smooth(MIRE, MIRE + 0.014, y));
      for (const [lx, ly] of lanterns) { // the warm lanes the lanterns lay on the water
        const lane = smooth(0.035, 0.004, Math.abs(x - lx)) * smooth(0.22, 0.0, y - (2 * MIRE - ly) + 0.06);
        col = mix(col, GOLD, lane * 0.28 * (1 - depth * 0.5));
      }
    }
    // the lanterns themselves — warm holes burned in the grey
    for (const [lx, ly] of lanterns) {
      const ld = Math.hypot((x - lx) * ASPECT, (y - ly) * ASPECT);
      col = mix(col, EMBER, smooth(0.075, 0.008, ld) * 0.5);
      col = mix(col, GOLD, smooth(0.013, 0, ld));
    }
    // and the fog over everything, in two deep drifts
    const m1 = smooth(0.11, 0, Math.abs(y - 0.62 + 0.03 * Math.sin(x * 5.5 + rp[2])));
    const m2 = smooth(0.08, 0, Math.abs(y - 0.80 + 0.025 * Math.sin(x * 8 + rp[1])));
    col = mix(col, hex("#96a4a8"), Math.min(0.6, m1 * 0.36 + m2 * 0.42));
    return col;
  };
}

// WINDWARD HEIGHTS — the terrace above the fog: broken pillars, streaming
// wind, steaming vents, and the hallowed tiles' faint gold underfoot.
function sceneWindward() {
  const rnd = mulberry32(705);
  const stars = [];
  for (let i = 0; i < 16; i++) stars.push([rnd(), rnd() * 0.45, 0.25 + rnd() * 0.5]);
  const rp = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  // the colonnade: [x, height, lean] — two still standing, the rest stumps
  const pillars = [[0.11, 0.215, 1], [0.235, 0.085, -1], [0.365, 0.185, 1], [0.475, 0.06, 1], [0.60, 0.125, -1]];
  const EDGE = 0.715; // where the terrace breaks off into the sky
  const terrY = (x) => 0.615 + 0.012 * Math.sin(x * 6.5 + rp[0]);
  const SKY_T = hex("#141e2a"), SKY_B = hex("#3a4a5a"), HORIZ = hex("#566a7c");
  const SIL = hex("#0a0e13");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.75, y));
    col = mix(col, HORIZ, smooth(0.72, 0.5, y) * 0.5);
    for (const [sx, sy, br] of stars) {
      const tw = smooth(0.0045, 0, Math.hypot((sx - x) * ASPECT, sy - y));
      if (tw > 0) col = mix(col, hex("#e6eef6"), tw * br * 0.8);
    }
    // the wind, written across the whole sky
    const wv = Math.sin((y * 30 + Math.sin(xa * 2.0) * 2.4 + rp[1]));
    if (y < 0.62 && wv > 0.74) col = mix(col, hex("#8298ac"), (wv - 0.74) * 2.2 * (0.62 - y));
    // the fog country far below, beyond the terrace's broken edge
    if (x > EDGE) {
      const vy = 0.82 + 0.02 * Math.sin(x * 7 + rp[2]);
      col = mix(col, hex("#9aa8b4"), smooth(0.09, 0, Math.abs(y - vy)) * 0.55); // the sea of fog
      if (y > vy + 0.05) col = mix(col, hex("#1c2630"), smooth(vy + 0.05, 1, y) * 0.8);
    }
    // the terrace itself
    let solid = false;
    if (x <= EDGE && y > terrY(x)) solid = true;
    if (x > EDGE && x < EDGE + 0.02 && y > terrY(EDGE)) solid = true; // the sheer cliff face
    // the broken colonnade
    for (const [px2, ph, lean] of pillars) {
      const base = terrY(px2) + 0.02;
      const cx2 = px2 + (base - y) * 0.03 * lean;
      if (y > base - ph && y < base && Math.abs(x - cx2) < 0.016) {
        // a jagged broken crown
        if (y > base - ph + 0.012 + 0.008 * Math.sin(x * 260 + rp[0])) solid = true;
      }
      if (inEllipse(xa, y, (px2 + 0.035) * ASPECT, base - 0.008, 0.022, 0.012)) solid = true; // a fallen drum
    }
    if (solid) col = SIL;
    // the hallowed tiles, faint gold seams in the terrace floor
    if (x < EDGE && y > terrY(x) + 0.02) {
      for (const [hx, hy2, hr] of [[0.20, 0.76, 0.07], [0.46, 0.82, 0.09], [0.64, 0.74, 0.055]]) {
        const hd = Math.hypot((x - hx) * ASPECT, (y - hy2) * ASPECT * 2.2);
        col = mix(col, GOLD, smooth(hr, hr * 0.1, hd) * 0.28);
        const seam = Math.max(Math.abs(Math.sin(x * 90 + rp[1])), Math.abs(Math.sin(y * 90 + rp[2])));
        if (hd < hr) col = mix(col, GOLD, smooth(0.985, 1, seam) * 0.5);
      }
    }
    // the vents, steaming hard sideways in the gale
    for (const [vx2, vs] of [[0.30, 1.0], [0.55, 0.8]]) {
      const vy2 = terrY(vx2) + 0.03;
      const vd = Math.hypot((x - vx2) * ASPECT, (y - vy2) * ASPECT);
      col = mix(col, EMBER, smooth(0.022, 0.004, vd) * 0.5);
      if (y < vy2) {
        const rise = vy2 - y;
        const w2 = (0.012 + rise * 0.22) * vs;
        const off = rise * 0.9 + Math.sin(rise * 16 + rp[0] + vx2 * 20) * 0.015; // torn east by the wind
        const sd = Math.abs(x - vx2 - off) / w2;
        if (sd < 1) col = mix(col, hex("#cdd6e2"), (1 - sd) * 0.30 * smooth(0.30, 0.02, rise) * vs);
      }
    }
    return col;
  };
}

// THE LAST VIGIL — the culmination: the final hold in silhouette beneath a
// burning pentagram, every window awake, the whole sky an inscription.
function sceneLastVigil() {
  const rnd = mulberry32(706);
  const rp = [rnd() * 6.28, rnd() * 6.28];
  const embers = [];
  for (let i = 0; i < 30; i++) embers.push([rnd(), rnd() * 0.95, 0.3 + rnd() * 0.7]);
  // THE SIGN: a five-point star inscribed in its ring, high over the hold
  const CX = 0.5 * ASPECT, CY = 0.275, R = 0.185;
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    pts.push([CX + R * Math.cos(a), CY + R * Math.sin(a)]);
  }
  const edges = pts.map((_, i) => [pts[i], pts[(i + 2) % 5]]);
  const windows = [[0.335, 0.660], [0.415, 0.585], [0.50, 0.545], [0.585, 0.59], [0.655, 0.665], [0.50, 0.625]];
  const SKY_T = hex("#0a0508"), SKY_B = hex("#241016"), HORIZ = hex("#44201c");
  const SIL = hex("#060304");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.66, y));
    col = mix(col, HORIZ, smooth(0.66, 0.44, y) * 0.5);
    // the pentagram, burning in the sky
    let sd = Math.abs(Math.hypot(xa - CX, y - CY) - R * 1.13); // the ring
    for (const [[ax, ay], [bx, by]] of edges) sd = Math.min(sd, segDist(xa, y, ax, ay, bx, by));
    col = mix(col, EMBER, smooth(0.075, 0.012, sd) * 0.55);
    col = mix(col, FLAME, smooth(0.016, 0.004, sd) * 0.9);
    col = mix(col, FLAME_HOT, smooth(0.005, 0, sd));
    // each point of the star, flaring
    for (const [px2, py2] of pts) {
      col = mix(col, FLAME_HOT, smooth(0.03, 0, Math.hypot(xa - px2, y - py2)) * 0.8);
    }
    // the last hold: rampart, towers, keep, and its own ward-spikes
    let solid = false;
    const wallT = 0.655 + 0.008 * Math.sin(x * 8 + rp[0]);
    if (y > wallT + 0.028 || (y > wallT && Math.sin(x * 120 + rp[1]) > -0.35)) solid = true;
    if (Math.abs(x - 0.50) < 0.048 && y > 0.505) solid = true;                     // the keep
    if (inTri(x, y, 0.44, 0.508, 0.56, 0.508, 0.50, 0.445)) solid = true;
    for (const tx of [0.36, 0.64]) {
      if (Math.abs(x - tx) < 0.026 && y > 0.555) solid = true;
      if (inTri(x, y, tx - 0.035, 0.558, tx + 0.035, 0.558, tx, 0.515)) solid = true;
    }
    for (const ox of [0.20, 0.80]) {                                               // ward-obelisk spikes
      const t = Math.max(0, (0.72 - y) / 0.155);
      if (y > 0.565 && y < 0.72 && Math.abs(x - ox) < 0.013 * (1 - t * 0.7)) solid = true;
    }
    if (solid) col = SIL;
    // every window awake — the hold answering the sign
    for (const [wx2, wy2] of windows) {
      const wd = Math.hypot((x - wx2) * ASPECT, (y - wy2) * ASPECT);
      col = mix(col, GOLD, smooth(0.011, 0, wd) * 0.95);
      col = mix(col, EMBER, smooth(0.035, 0, wd) * 0.25);
    }
    // twin bonfires at the gate causeway
    for (const bx of [0.285, 0.715]) {
      const bd = Math.hypot((x - bx) * ASPECT, (y - 0.755) * ASPECT);
      col = mix(col, EMBER, smooth(0.075, 0.01, bd) * 0.55);
      col = mix(col, FLAME_HOT, smooth(0.012, 0, bd) * 0.95);
    }
    // the obelisk tips answering in cold pale — the enemy's wards, still up
    for (const ox of [0.20, 0.80]) {
      const td = Math.hypot((x - ox) * ASPECT, (y - 0.565) * ASPECT);
      col = mix(col, hex("#cfe0ff"), smooth(0.025, 0, td) * 0.7);
    }
    // low mist on the field before the walls
    col = mix(col, hex("#5a4038"), smooth(0.05, 0, Math.abs(y - 0.86 + 0.02 * Math.sin(x * 6 + rp[0]))) * 0.3);
    // embers adrift under the burning sign
    for (const [ex, ey, br] of embers) {
      const tw = smooth(0.004, 0, Math.hypot((ex - x) * ASPECT, ey - y));
      if (tw > 0) col = mix(col, FLAME, tw * br * 0.8);
    }
    return col;
  };
}

const SCENES = [
  ["foundry", sceneFoundry],
  ["bastion", sceneBastion],
  ["emberwood", sceneEmberwood],
  ["mistmarket", sceneMistmarket],
  ["windward", sceneWindward],
  ["last-vigil", sceneLastVigil],
];

// ---------- render + vignette ----------
function renderScene(build) {
  const sample = build();
  const buf = Buffer.alloc(W * H * 4);
  const SS = 2, VIG = hex("#040204");
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS) / W, uy = (y + (sy + 0.5) / SS) / H;
          let c = sample(ux, uy);
          const vd = Math.hypot((ux - 0.5) * 1.6, (uy - 0.5) * 1.15);
          c = mix(c, VIG, smooth(0.62, 1.02, vd) * 0.5);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, i = (y * W + x) * 4;
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
for (const [id, build] of SCENES) {
  writeFileSync(out(`city-${id}.png`), encodePNG(W, H, renderScene(build)));
  console.log(`art/city-${id}.png`);
}
console.log("vigil city art written");
