// Dependency-free PNG art generator for The Watcher at the Threshold (the
// Lovecraftian spinoff): four ESTABLISHING SCENES (art/place-<id>.png, 640×360),
// one moody 16:9 vista per place, shown at the top of the picker card.
//
// Same approach as tools/gen-ww-art.mjs's scene section: every image is a
// scalar field sampled with supersampling, painter's-algorithm composited in
// straight RGB, then written through the shared zero-dep PNG encoder.
// Deterministic: all jitter goes through mulberry32 with fixed per-image seeds.
//
// The palette leans on eldritch.html's UI hues — cold abyssal greens, ice-cyan
// (#7ad8ff), unwholesome violet (#c08aff) — against blacks and drowned greys.
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
// A rectangle tilted by `ang` about its centre (evaluate in aspect-true space).
const inRot = (px, py, cx, cy, hw, hh, ang) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  const dx = px - cx, dy = py - cy;
  return Math.abs(dx * c + dy * s) <= hw && Math.abs(-dx * s + dy * c) <= hh;
};

const W = 640, H = 360, ASPECT = W / H;

// A New-England gambrel silhouette: walls under a two-pitch roof — steep at the
// eaves, shallow to the ridge — the shape every Lovecraft town wears.
function inGambrel(px, py, cx, base, hw, wallH, roofH) {
  const wallT = base - wallH;
  if (Math.abs(px - cx) <= hw && py >= wallT && py <= base) return true;
  const lower = roofH * 0.55, peakY = wallT - roofH;
  if (py >= wallT - lower && py < wallT) {
    const t = (wallT - py) / lower;
    if (Math.abs(px - cx) <= hw * (1.14 - 0.52 * t)) return true; // steep lower pitch
  } else if (py >= peakY && py < wallT - lower) {
    const t = (wallT - lower - py) / (roofH - lower || 1e-9);
    if (Math.abs(px - cx) <= hw * (0.62 - 0.52 * t)) return true; // shallow upper pitch
  }
  return false;
}

// ---------- the four places ----------

// INNSMOUTH — the shunned port at dusk: sagging gambrel waterfront, a rotten
// wharf on pilings, grey harbour water, and the green light off the reef.
function sceneInnsmouth() {
  const rnd = mulberry32(501);
  const stars = [];
  for (let i = 0; i < 10; i++) stars.push([rnd(), rnd() * 0.35, 0.25 + rnd() * 0.45]);
  const rp = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  // the waterfront row: [x, halfWidth, wallH, roofH] — heights sag unevenly
  const houses = [
    [0.06, 0.052, 0.075, 0.088], [0.165, 0.042, 0.115, 0.075], [0.262, 0.056, 0.085, 0.098],
    [0.368, 0.046, 0.135, 0.082], [0.462, 0.038, 0.095, 0.070], [0.548, 0.050, 0.072, 0.092],
  ];
  const winLit = houses.map(() => rnd() > 0.5);
  const pilings = [[0.60, 0.075], [0.67, 0.06], [0.745, 0.08], [0.82, 0.055], [0.895, 0.07]];
  const QUAY = 0.615;
  const SKY_T = hex("#0a1216"), SKY_B = hex("#26403a"), HORIZ = hex("#33544a");
  const SIL = hex("#04090a");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.72, y));
    col = mix(col, HORIZ, smooth(0.70, 0.50, y) * 0.5);
    for (const [sx, sy, br] of stars) {
      const tw = smooth(0.005, 0, Math.hypot((sx - x) * ASPECT, sy - y));
      if (tw > 0) col = mix(col, hex("#cfe0da"), tw * br);
    }
    // the last of a drowned sunset, low over the open sea
    col = mix(col, hex("#5a7a62"), smooth(0.55, 0.06, Math.hypot(xa - 1.30, y - 0.60)) * 0.38);
    // the far headland
    const hy = 0.555 + 0.02 * Math.sin(x * 4.2 + rp[0]);
    if (y > hy && y < QUAY + 0.01) col = mix(col, hex("#10221e"), smooth(hy, hy + 0.012, y) * 0.9);
    // the harbour
    if (y > QUAY) {
      const depth = smooth(QUAY, 1, y);
      let w = mix(hex("#0e201e"), hex("#050c0c"), depth);
      // the green fire off Devil Reef, burning under the swell
      w = mix(w, hex("#2fa878"), smooth(0.30, 0.03, Math.hypot(xa - 1.16, (y - 0.72) * 2.3)) * 0.55);
      const rip = Math.sin(y * 150 + Math.sin(xa * 9) * 2 + rp[1]);
      if (rip > 0.72) w = mix(w, hex("#3a6a5c"), (rip - 0.72) * 1.1 * (1 - depth * 0.6));
      col = mix(col, w, smooth(QUAY, QUAY + 0.015, y));
    }
    // fog lying along the waterline
    const fog1 = smooth(0.075, 0, Math.abs(y - (QUAY - 0.02) + 0.02 * Math.sin(x * 7 + rp[2])));
    // the town: sagging gambrel roofs shoulder to shoulder down the shore
    let solid = false, window = 0;
    houses.forEach(([cx, hw, wh, rh], i) => {
      const base = QUAY + 0.006;
      if (inGambrel(x, y, cx, base, hw, wh, rh)) solid = true;
      if (Math.abs(x - (cx + hw * 0.45)) < 0.0075 && y > base - wh - rh - 0.035 && y < base - wh) solid = true;
      if (winLit[i]) {
        const wd = Math.hypot((x - (cx - hw * 0.3)) * ASPECT, (y - (base - wh * 0.45)) * ASPECT);
        window = Math.max(window, smooth(0.015, 0, wd));
      }
    });
    // the wharf: a rotten deck out over the water on leaning pilings
    if (y > 0.700 && y < 0.722 && x > 0.565 && x < 0.965) solid = true;
    for (const [px2, len] of pilings) {
      if (Math.abs(x - px2 - (y - 0.72) * 0.06) < 0.006 && y > 0.715 && y < 0.72 + len) solid = true;
    }
    if (solid) col = SIL;
    // sickly green-lit panes paint OVER the silhouette
    if (window > 0) col = mix(col, hex("#b8e6c8"), Math.min(1, window * 1.2));
    col = mix(col, mix(HORIZ, hex("#9ab8aa"), 0.4), fog1 * 0.45);
    return col;
  };
}

// DUNWICH — decayed hill-country: dark rounded domes, the stone-crowned summit,
// a whippoorwill dusk with wheeling birds, one gambrel farmhouse gone to seed.
function sceneDunwich() {
  const rnd = mulberry32(502);
  const rp = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const birds = [];
  for (let i = 0; i < 6; i++) birds.push([0.15 + rnd() * 0.55, 0.10 + rnd() * 0.22, 0.008 + rnd() * 0.007]);
  const crown = [-0.16, -0.09, -0.02, 0.05, 0.12]; // standing stones along the dome's crest
  const SKY_T = hex("#0e1812"), SKY_B = hex("#2e3c26"), HORIZ = hex("#4a5232");
  const SIL = hex("#050904");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.70, y));
    col = mix(col, HORIZ, smooth(0.66, 0.42, y) * 0.5);
    // the whippoorwills, wheeling black against the dusk
    for (const [bx, by, bs] of birds) {
      const bxa = bx * ASPECT;
      if (inCapsule(xa, y, bxa - bs, by, bxa, by + bs * 0.55, bs * 0.16)) col = SIL;
      if (inCapsule(xa, y, bxa + bs, by, bxa, by + bs * 0.55, bs * 0.16)) col = SIL;
    }
    // the far range
    const fry = 0.52 + 0.03 * Math.sin(x * 3.6 + rp[0]);
    if (y > fry) col = mix(col, hex("#1a2416"), smooth(fry, fry + 0.015, y));
    // the sentinel dome — the summit with its crown of standing stones
    const DX = 0.63, domeTop = 0.40;
    const domed = inEllipse(xa, y, DX * ASPECT, 1.06, 0.58, 1.06 - domeTop);
    for (const off of crown) {
      const sx = DX + off;
      // stone bases ride the dome's curve
      const t = (sx - DX) / 0.326;
      const by = domeTop + (1.06 - domeTop) * (1 - Math.sqrt(Math.max(0, 1 - t * t))) + 0.002;
      const h = 0.055, hw = 0.009;
      if (Math.abs(x - sx) < hw * (1 - ((by - y) / h) * 0.45) && y > by - h && y < by + 0.01) {
        if (y > by - h) col = SIL;
      }
    }
    if (domed) col = mix(col, hex("#101a0c"), 0.95);
    // the near hill rolling under the farmhouse
    const nhy = 0.74 + 0.04 * Math.sin(x * 2.6 + rp[1]) + 0.02 * Math.sin(x * 7.1 + rp[2]);
    let solid = false, window = 0;
    if (y > nhy) solid = true;
    // the farmhouse, gambrel and going dark
    const fx = 0.20;
    if (inGambrel(x, y, fx, 0.76, 0.062, 0.095, 0.085)) solid = true;
    if (Math.abs(x - (fx - 0.02)) < 0.008 && y > 0.55 && y < 0.64) solid = true; // chimney
    const wd = Math.hypot((x - (fx + 0.025)) * ASPECT, (y - 0.715) * ASPECT);
    window = Math.max(window, smooth(0.013, 0, wd));
    // a dead orchard row on the near slope
    for (const tx of [0.42, 0.52, 0.86, 0.94]) {
      const ty = 0.74 + 0.04 * Math.sin(tx * 2.6 + rp[1]) + 0.02 * Math.sin(tx * 7.1 + rp[2]);
      if (inCapsule(x, y, tx, ty + 0.01, tx + 0.008, ty - 0.055, 0.004)) solid = true;
      if (inCapsule(x, y, tx + 0.006, ty - 0.045, tx + 0.028, ty - 0.075, 0.0028)) solid = true;
      if (inCapsule(x, y, tx + 0.004, ty - 0.05, tx - 0.02, ty - 0.082, 0.0028)) solid = true;
    }
    if (solid) col = SIL;
    if (window > 0) col = mix(col, hex("#d8c88a"), Math.min(1, window) * 0.85);
    // fog pooling in the hollow between the hills
    const fog = smooth(0.08, 0, Math.abs(y - 0.66 + 0.025 * Math.sin(x * 6 + rp[2])));
    col = mix(col, hex("#6a7a5e"), fog * 0.4);
    return col;
  };
}

// KINGSPORT — terrible high houses climbing the cliff into the sky, sea-fog
// below, and the one strange light burning in the highest house.
function sceneKingsport() {
  const rnd = mulberry32(503);
  const stars = [];
  for (let i = 0; i < 22; i++) stars.push([rnd(), rnd() * 0.55, 0.3 + rnd() * 0.6]);
  const rp = [rnd() * 6.28, rnd() * 6.28];
  // houses stepping up the hill: [x, halfWidth, wallH]
  const houses = [
    [0.10, 0.034, 0.075], [0.20, 0.028, 0.105], [0.30, 0.036, 0.09], [0.40, 0.030, 0.12],
    [0.51, 0.033, 0.10], [0.62, 0.028, 0.13], [0.72, 0.034, 0.11], [0.82, 0.028, 0.14],
  ];
  const winLit = houses.map(() => rnd() > 0.62);
  const hillY = (x) => 0.88 - 0.52 * smooth(0.0, 1.0, x) + 0.022 * Math.sin(x * 5.2 + rp[0]);
  const SKY_T = hex("#081020"), SKY_B = hex("#1c2c34"), HORIZ = hex("#2c4448");
  const SIL = hex("#040808");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.75, y));
    col = mix(col, HORIZ, smooth(0.72, 0.5, y) * 0.4);
    for (const [sx, sy, br] of stars) {
      const tw = smooth(0.005, 0, Math.hypot((sx - x) * ASPECT, sy - y));
      if (tw > 0) col = mix(col, hex("#e6f6ff"), tw * br * 0.9);
    }
    // THE strange high light — haloed, wrong, and violet-pale
    const hlx = 0.895, hly = hillY(0.895) - 0.205;
    col = mix(col, hex("#c08aff"), smooth(0.14, 0.01, Math.hypot((x - hlx) * ASPECT, hly - y)) * 0.35);
    // the hill the town climbs
    let solid = false, window = 0;
    const hy = hillY(x);
    if (y > hy) solid = true;
    // the houses, gable over gable up the slope
    houses.forEach(([cx, hw, wh], i) => {
      const base = hillY(cx) + 0.012;
      const wallT = base - wh;
      if (Math.abs(x - cx) <= hw && y >= wallT && y <= base) solid = true;
      if (inTri(x, y, cx - hw * 1.28, wallT, cx + hw * 1.28, wallT, cx, wallT - 0.062)) solid = true;
      if (Math.abs(x - (cx + hw * 0.4)) < 0.006 && y > wallT - 0.095 && y < wallT) solid = true; // chimney
      if (winLit[i]) {
        const wd = Math.hypot((x - cx) * ASPECT, (y - (base - wh * 0.5)) * ASPECT);
        window = Math.max(window, smooth(0.012, 0, wd) * 0.7);
      }
    });
    // the highest house of all, wearing the light
    {
      const base = hillY(0.90) + 0.01, wallT = base - 0.165;
      if (Math.abs(x - 0.90) <= 0.031 && y >= wallT && y <= base) solid = true;
      if (inTri(x, y, 0.90 - 0.041, wallT, 0.90 + 0.041, wallT, 0.90, wallT - 0.07)) solid = true;
      const wd = Math.hypot((x - hlx) * ASPECT, (y - hly) * ASPECT);
      window = Math.max(window, smooth(0.018, 0, wd) * 1.3);
    }
    if (solid) col = SIL;
    if (window > 0) col = mix(col, hex("#e6d8ff"), Math.min(1, window));
    // the sea-fog, rolling up from the harbour below the town
    const fog1 = smooth(0.11, 0, Math.abs(y - 0.86 + 0.03 * Math.sin(x * 5 + rp[1])));
    const fog2 = smooth(0.07, 0, Math.abs(y - 0.70 + 0.02 * Math.sin(x * 8 + rp[0]))) * smooth(0.55, 0.1, x);
    col = mix(col, hex("#8a9aa8"), Math.min(0.62, fog1 * 0.55 + fog2 * 0.4));
    return col;
  };
}

// R'LYEH — the drowned city risen: black slabs at wrong angles over a
// phosphorescent sea, and the dreamer's shadow vast behind them.
function sceneRlyeh() {
  const rnd = mulberry32(504);
  const rp = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const motes = [];
  for (let i = 0; i < 26; i++) motes.push([rnd(), rnd(), 0.3 + rnd() * 0.6]);
  // the slabs: [x, cy, halfW, halfH, tilt] — none of the angles agree
  const slabs = [
    [0.14, 0.545, 0.026, 0.155, 0.20], [0.30, 0.475, 0.042, 0.235, -0.13],
    [0.52, 0.415, 0.048, 0.300, 0.06], [0.70, 0.485, 0.036, 0.220, -0.24],
    [0.86, 0.560, 0.028, 0.140, 0.30],
    [0.42, 0.275, 0.118, 0.020, 0.11], // a lintel lying wrong across the sky
  ];
  const SEA = 0.635;
  const SKY_T = hex("#030a06"), SKY_B = hex("#12301e"), PHOS = hex("#38b284");
  const SIL = hex("#010302");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.72, y));
    // a sick green dawn that is not a dawn, low behind the city
    col = mix(col, hex("#2a7a52"), smooth(0.52, 0.02, Math.hypot((x - 0.52) * ASPECT * 0.7, (y - 0.60) * 1.5)) * 0.6);
    // the dreamer — a mountain that walks, dim behind the slabs
    const CX = 0.52 * ASPECT;
    let dreamer = inEllipse(xa, y, CX, 0.52, 0.21, 0.24) || inEllipse(xa, y, CX, 0.335, 0.088, 0.082);
    // wings, half-spread against the green
    if (inTri(xa, y, CX - 0.10, 0.46, CX - 0.44, 0.175, CX - 0.16, 0.60)) dreamer = true;
    if (inTri(xa, y, CX + 0.10, 0.46, CX + 0.42, 0.20, CX + 0.16, 0.60)) dreamer = true;
    // the face's hanging feelers
    for (const [ox, len] of [[-0.055, 0.115], [-0.02, 0.15], [0.02, 0.14], [0.055, 0.105]]) {
      if (inCapsule(xa, y, CX + ox, 0.38, CX + ox * 1.7, 0.38 + len, 0.011)) dreamer = true;
    }
    if (dreamer && y < SEA) col = mix(col, hex("#08140c"), 0.92);
    // twin embers where the eyes would be
    col = mix(col, hex("#7ad8a0"), smooth(0.018, 0, Math.hypot(xa - (CX - 0.032), y - 0.325)) * 0.8);
    col = mix(col, hex("#7ad8a0"), smooth(0.018, 0, Math.hypot(xa - (CX + 0.032), y - 0.325)) * 0.8);
    // the slabs — greater blacks against the black, rimmed in phosphor
    let slab = false, rim = 0;
    for (const [sx2, sy2, hw, hh, ang] of slabs) {
      const cx2 = sx2 * ASPECT;
      if (inRot(xa, y, cx2, sy2, hw, hh, ang)) slab = true;
      if (inRot(xa, y, cx2, sy2, hw + 0.006, hh + 0.006, ang)) rim = Math.max(rim, 0.5);
    }
    if (rim > 0 && !slab) col = mix(col, PHOS, rim * 0.8);
    if (slab) col = SIL;
    // the phosphorescent sea
    if (y > SEA) {
      const depth = smooth(SEA, 1, y);
      let w = mix(hex("#061810"), hex("#020806"), depth);
      const glowLanes = Math.sin(xa * 22 + Math.sin(y * 40 + rp[0]) * 2.2 + rp[1]);
      w = mix(w, PHOS, Math.max(0, glowLanes - 0.55) * 0.9 * (1 - depth * 0.55));
      w = mix(w, PHOS, smooth(0.30, 0.02, Math.abs(y - SEA - 0.012)) * 0.35); // the burning waterline
      // dark wakes below each slab
      for (const [sx2, , hw] of slabs) {
        if (Math.abs(x - sx2) < hw * 1.1) w = mix(w, SIL, 0.6 * (1 - depth));
      }
      col = mix(col, w, smooth(SEA, SEA + 0.012, y));
    }
    // spores adrift
    for (const [mx2, my2, br] of motes) {
      const tw = smooth(0.004, 0, Math.hypot((mx2 - x) * ASPECT, my2 - y));
      if (tw > 0) col = mix(col, hex("#9ae6c0"), tw * br * 0.7);
    }
    return col;
  };
}

const SCENES = [
  ["innsmouth", sceneInnsmouth],
  ["dunwich", sceneDunwich],
  ["kingsport", sceneKingsport],
  ["rlyeh", sceneRlyeh],
];

// ---------- render + vignette ----------
function renderScene(build) {
  const sample = build();
  const buf = Buffer.alloc(W * H * 4);
  const SS = 2, VIG = hex("#020504");
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
  writeFileSync(out(`place-${id}.png`), encodePNG(W, H, renderScene(build)));
  console.log(`art/place-${id}.png`);
}
console.log("eldritch art written");
