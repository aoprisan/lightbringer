// Dependency-free PNG art generator for The Iron Rain (the WW2 bomber spinoff):
// four ESTABLISHING SCENES (art/theatre-<id>.png, 640×360), one leaden 16:9
// vista per raid theatre, shown at the top of the picker card.
//
// Same approach as tools/gen-ww-art.mjs's scene section: every image is a
// scalar field sampled with supersampling, painter's-algorithm composited in
// straight RGB, then written through the shared zero-dep PNG encoder. The
// searchlight wedge and flak-bloom techniques come from tools/gen-bomber-icons.mjs.
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
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const inCapsule = (px, py, ax, ay, bx, by, hw) => segDist(px, py, ax, ay, bx, by) <= hw;

const W = 640, H = 360, ASPECT = W / H;

// Shared war-sky hues.
const BEAM = hex("#bed4e4");     // searchlight steel
const TRACER = hex("#ffb84d");   // tracer amber
const TRACER_HOT = hex("#fff3d8");
const PUFF = hex("#3a3f46");     // flak iron-grey
const SIL = hex("#040608");      // silhouette black

// A searchlight — a wedge from a ground anchor toward a sky point, bright at
// its core, opening and fading as it climbs (tools/gen-bomber-icons.mjs).
function beamGlow(px, py, ax, ay, tx, ty, hw) {
  const d = segDist(px, py, ax, ay, tx, ty);
  const along = Math.hypot(px - ax, py - ay) / Math.hypot(tx - ax, ty - ay);
  const spread = hw * (0.35 + along * 1.2);
  return smooth(spread, spread * 0.25, d) * smooth(1.25, 0.15, along);
}

// A flak burst hanging in the sky: iron bloom around a dying amber heart.
function flakBloom(col, xa, y, fx, fy, fr) {
  const fd = Math.hypot(xa - fx, y - fy);
  const t = smooth(fr, fr * 0.2, fd);
  if (t <= 0) return col;
  col = mix(col, PUFF, t * 0.8);
  return mix(col, TRACER, smooth(fr * 0.3, 0, fd) * 0.4);
}

// A lattice radar/wireless mast: two splayed legs, a spine, crossbars, aerial.
function inMast(x, y, mx, base, h) {
  const top = base - h;
  if (inTri(x, y, mx - h * 0.10, base, mx + h * 0.10, base, mx, top) &&
      !inTri(x, y, mx - h * 0.072, base, mx + h * 0.072, base, mx, top - h * 0.06)) return true;
  if (Math.abs(x - mx) < 0.0022 && y > top && y < base) return true;
  for (let i = 1; i <= 4; i++) {
    const cy = base - (h * i) / 4.6;
    const hw2 = h * 0.10 * (1 - i / 5.4);
    if (Math.abs(y - cy) < 0.0035 && Math.abs(x - mx) < hw2) return true;
  }
  if (Math.abs(y - top) < 0.003 && Math.abs(x - mx) < h * 0.09) return true; // the aerial bar
  return false;
}

// A barrage balloon aloft: fat silver-dark body, three tail fins, one cable.
function inBalloon(xa, y, bx, by, s) {
  if (inEllipse(xa, y, bx, by, 0.062 * s, 0.026 * s)) return true;
  for (const [ox, oy] of [[0.052, -0.014], [0.058, 0.008], [0.046, 0.02]]) {
    if (inTri(xa, y, bx + ox * s * 0.55, by + oy * s * 0.3, bx + ox * s + 0.02 * s, by + oy * s,
      bx + ox * s * 0.62, by + oy * s * 0.85)) return true;
  }
  return false;
}

// A heavy bomber in profile, nose west: fuselage, wing stub, tail fin.
function inBomberSide(xa, y, bx, by, s) {
  if (inCapsule(xa, y, bx - 0.055 * s, by, bx + 0.048 * s, by, 0.0085 * s)) return true;
  if (inTri(xa, y, bx - 0.018 * s, by - 0.002 * s, bx + 0.022 * s, by - 0.002 * s, bx + 0.005 * s, by + 0.018 * s)) return true;
  if (inTri(xa, y, bx + 0.030 * s, by - 0.024 * s, bx + 0.048 * s, by, bx + 0.026 * s, by)) return true;
  return false;
}

// ---------- the four theatres ----------

// THE CHANNEL COAST — dusk on the grey water's edge: radar masts and coastal
// batteries on the headland, searchlights feeling out over the sea.
function sceneChannel() {
  const rnd = mulberry32(601);
  const stars = [];
  for (let i = 0; i < 12; i++) stars.push([rnd(), rnd() * 0.3, 0.25 + rnd() * 0.4]);
  const rp = [rnd() * 6.28, rnd() * 6.28];
  const SEA = 0.565;
  const SKY_T = hex("#10141c"), SKY_B = hex("#3a3830"), HORIZ = hex("#4c4434");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.62, y));
    col = mix(col, HORIZ, smooth(0.60, 0.42, y) * 0.55);
    for (const [sx, sy, br] of stars) {
      const tw = smooth(0.005, 0, Math.hypot((sx - x) * ASPECT, sy - y));
      if (tw > 0) col = mix(col, hex("#dce6f0"), tw * br);
    }
    // long grey cloud shears
    const cl = Math.sin(y * 34 + Math.sin(xa * 1.8) * 2 + rp[0]);
    if (y < 0.45 && cl > 0.72) col = mix(col, hex("#2c3038"), (cl - 0.72) * 1.6 * (0.45 - y));
    // the searchlights, out over the water
    const b1 = beamGlow(xa, y, 0.42 * ASPECT, 0.80, 1.18, 0.10, 0.045);
    const b2 = beamGlow(xa, y, 0.52 * ASPECT, 0.82, 1.62, 0.16, 0.040);
    col = mix(col, BEAM, b1 * 0.42 + b2 * 0.38);
    // the sea
    if (y > SEA) {
      const depth = smooth(SEA, 1, y);
      let w = mix(hex("#242e36"), hex("#10161c"), depth);
      const glint = Math.sin(y * 130 + Math.sin(xa * 7) * 2.4 + rp[1]);
      if (glint > 0.8) w = mix(w, hex("#4c5a64"), (glint - 0.8) * 2 * (1 - depth * 0.7));
      col = mix(col, w, smooth(SEA, SEA + 0.012, y));
    }
    // the headland: a dark coastal shelf running out from the left
    const hy = 0.74 + 0.03 * Math.sin(x * 3.4 + rp[0]) + 0.14 * smooth(0.6, 1.0, x);
    let solid = y > hy;
    // radar masts against the dusk
    if (inMast(x, y, 0.14, 0.755, 0.30)) solid = true;
    if (inMast(x, y, 0.245, 0.760, 0.24)) solid = true;
    // the batteries: low casemate humps, barrels lifted seaward
    for (const [gx, gs] of [[0.55, 1.0], [0.68, 0.85]]) {
      const gy = 0.74 + 0.03 * Math.sin(gx * 3.4 + rp[0]) + 0.14 * smooth(0.6, 1.0, gx) + 0.01;
      if (inEllipse(xa, y, gx * ASPECT, gy, 0.062 * gs, 0.030 * gs)) solid = true;
      if (inCapsule(xa, y, gx * ASPECT, gy - 0.02 * gs, gx * ASPECT + 0.075 * gs, gy - 0.055 * gs, 0.006 * gs)) solid = true;
    }
    if (solid) col = SIL;
    // a blockhouse lamp on the headland
    col = mix(col, TRACER, smooth(0.012, 0, Math.hypot((x - 0.335) * ASPECT, (y - 0.775) * ASPECT)) * 0.8);
    // haze along the sea-line
    col = mix(col, hex("#6a6e6a"), smooth(0.05, 0, Math.abs(y - SEA)) * 0.25);
    return col;
  };
}

// THE MARSHALLING YARDS — night rails converging on the dark: silver sidings,
// black sheds, amber signals, a searchlight and waking flak.
function sceneYards() {
  const rnd = mulberry32(602);
  const stars = [];
  for (let i = 0; i < 14; i++) stars.push([rnd(), rnd() * 0.4, 0.2 + rnd() * 0.4]);
  const rp = [rnd() * 6.28];
  const VP = [0.47, 0.50]; // the vanishing point all sidings run to
  const railsB = [-0.34, -0.25, -0.17, -0.10, 0.10, 0.17, 0.60, 0.68, 0.94, 1.02]; // bottom-edge x
  const signals = [[0.575, 0.60], [0.325, 0.66], [0.645, 0.72]];
  const SKY_T = hex("#06080e"), SKY_B = hex("#1e2026"), HORIZ = hex("#2e2c26");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.55, y));
    col = mix(col, HORIZ, smooth(0.52, 0.40, y) * 0.5);
    for (const [sx, sy, br] of stars) {
      const tw = smooth(0.004, 0, Math.hypot((sx - x) * ASPECT, sy - y));
      if (tw > 0) col = mix(col, hex("#c8d2e0"), tw * br);
    }
    // one searchlight up from beyond the sheds, and the flak waking around it
    const b1 = beamGlow(xa, y, 0.86 * ASPECT, 0.55, 0.42, -0.08, 0.042);
    col = mix(col, BEAM, b1 * 0.45);
    col = flakBloom(col, xa, y, 0.52, 0.16, 0.052);
    col = flakBloom(col, xa, y, 0.70, 0.28, 0.040);
    // the ground plane
    if (y > VP[1]) col = mix(col, hex("#131009"), smooth(VP[1], VP[1] + 0.02, y) * 0.92);
    // the rails, catching what light there is
    if (y > VP[1] + 0.008) {
      const t = (y - VP[1]) / (1 - VP[1]);
      let rail = 0;
      for (const bx of railsB) {
        const rx = VP[0] + (bx - VP[0]) * t;
        const w2 = 0.0012 + t * 0.0042;
        rail = Math.max(rail, smooth(w2, w2 * 0.3, Math.abs(x - rx)));
      }
      col = mix(col, hex("#aab4c0"), rail * (0.30 + 0.68 * t));
    }
    // the sheds flanking the yard throat
    let solid = false;
    if (x > 0.02 && x < 0.30 && y > 0.435 && y < 0.565) solid = true;
    if (inTri(x, y, 0.01, 0.437, 0.31, 0.437, 0.16, 0.392)) solid = true;
    if (x > 0.74 && x < 0.985 && y > 0.45 && y < 0.545) solid = true;
    if (inTri(x, y, 0.73, 0.452, 0.995, 0.452, 0.86, 0.412)) solid = true;
    // a water tower over the far throat
    if (Math.abs(x - 0.665) < 0.006 && y > 0.40 && y < 0.51) solid = true;
    if (inEllipse(xa, y, 0.665 * ASPECT, 0.395, 0.03, 0.022)) solid = true;
    // a signal gantry across the near tracks
    if (Math.abs(y - 0.60) < 0.004 && x > 0.30 && x < 0.62) solid = true;
    if (Math.abs(x - 0.315) < 0.004 && y > 0.60 && y < 0.72) solid = true;
    if (Math.abs(x - 0.605) < 0.004 && y > 0.60 && y < 0.70) solid = true;
    if (solid) col = SIL;
    // amber signal lamps burning over the sidings
    for (const [lx, ly] of signals) {
      col = mix(col, TRACER, smooth(0.010, 0, Math.hypot((x - lx) * ASPECT, (y - ly) * ASPECT)) * 0.9);
      col = mix(col, TRACER, smooth(0.035, 0, Math.hypot((x - lx) * ASPECT, (y - ly) * ASPECT)) * 0.18);
    }
    // shed skylight slits, dimly lit from the work inside
    if (x > 0.05 && x < 0.27 && Math.abs(y - 0.475) < 0.006 && Math.sin(x * 160 + rp[0]) > 0.2) {
      col = mix(col, hex("#b08a4a"), 0.5);
    }
    // ground haze rolling off the yard
    col = mix(col, hex("#3c3a34"), smooth(0.06, 0, Math.abs(y - 0.56 + 0.015 * Math.sin(x * 8 + rp[0]))) * 0.3);
    return col;
  };
}

// THE U-BOAT PENS — a harbour poured in concrete: the massive pens squatting on
// a leaden sea, balloons riding thick on their cables overhead.
function sceneParens() {
  const rnd = mulberry32(603);
  const rp = [rnd() * 6.28, rnd() * 6.28];
  const balloons = [[0.22, 0.165, 1.0], [0.52, 0.10, 0.85], [0.80, 0.20, 1.1]];
  const SEA = 0.665;
  const ROOF = 0.435, BASE = 0.695; // the pens' slab
  const SKY_T = hex("#171d25"), SKY_B = hex("#3c4650"), HORIZ = hex("#4a545c");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.66, y));
    col = mix(col, HORIZ, smooth(0.64, 0.46, y) * 0.5);
    // unbroken overcast, banded
    const cl = Math.sin(y * 26 + Math.sin(xa * 1.5) * 1.8 + rp[0]);
    if (y < 0.42 && cl > 0.62) col = mix(col, hex("#262e38"), (cl - 0.62) * 1.4 * (0.42 - y) * 2.2);
    // one weary searchlight over the harbour mouth
    col = mix(col, BEAM, beamGlow(xa, y, 0.06 * ASPECT, 0.72, 0.66, 0.02, 0.038) * 0.3);
    // the sea
    if (y > SEA) {
      const depth = smooth(SEA, 1, y);
      let w = mix(hex("#222c34"), hex("#0e141a"), depth);
      const swell = Math.sin(y * 110 + Math.sin(xa * 6) * 2 + rp[1]);
      if (swell > 0.78) w = mix(w, hex("#46525c"), (swell - 0.78) * 1.6 * (1 - depth * 0.7));
      col = mix(col, w, smooth(SEA, SEA + 0.012, y));
    }
    // the pens: one brutal slab, bay after bay swallowing the water
    let solid = false, bay = false;
    if (x > 0.14 && x < 0.88 && y > ROOF && y < BASE) {
      solid = true;
      for (let i = 0; i < 5; i++) {
        const bx = 0.205 + i * 0.135;
        const arch = y > 0.545 || inEllipse(xa, y, bx * ASPECT, 0.545, 0.075, 0.045);
        if (Math.abs(x - bx) < 0.0435 && arch && y < BASE - 0.005) bay = bay || arch && Math.abs(x - bx) < 0.0435 && y > 0.50;
      }
    }
    if (solid) {
      // poured concrete, weather-streaked, darker toward the water
      let c = mix(hex("#3e444a"), hex("#262c30"), smooth(ROOF, BASE, y));
      const streak = Math.sin(x * 210 + rp[0]);
      if (streak > 0.6) c = mix(c, hex("#1e2428"), (streak - 0.6) * 0.8);
      if (Math.abs(y - ROOF) < 0.008) c = mix(c, hex("#5a646c"), 0.7); // the roof edge catching the sky
      col = c;
      if (bay) col = mix(hex("#0a0e12"), hex("#04060a"), smooth(0.50, BASE, y)); // the black bays
    }
    // a gantry crane on the roof
    if (Math.abs(x - 0.815) < 0.005 && y > 0.335 && y < ROOF) col = SIL;
    if (Math.abs(y - 0.34) < 0.0045 && x > 0.755 && x < 0.895) col = SIL;
    if (Math.abs(x - 0.758) < 0.004 && y > 0.34 && y < ROOF) col = SIL;
    // the balloons, riding their cables above the harbour
    for (const [bx, by, bs] of balloons) {
      const bxa = bx * ASPECT;
      if (inCapsule(xa, y, bxa, by + 0.02, bxa + 0.012, ROOF + 0.02, 0.0012)) col = mix(col, hex("#1a2026"), 0.8);
      if (inBalloon(xa, y, bxa, by, bs)) {
        // silver doped fabric catching the sky-light from below
        col = mix(hex("#39424c"), hex("#5e6a76"), smooth(by + 0.022 * bs, by - 0.022 * bs, y));
      }
    }
    // harbour haze against the concrete
    col = mix(col, hex("#59626a"), smooth(0.07, 0, Math.abs(y - SEA + 0.02 * Math.sin(x * 6 + rp[1]))) * 0.28);
    return col;
  };
}

// THE RUHR VALLEY — the flak alley: furnace country aglow under a leaden sky,
// chimneys smoking, searchlight cones crossing, and one bomber high in it.
function sceneRuhr() {
  const rnd = mulberry32(604);
  const rp = [rnd() * 6.28, rnd() * 6.28];
  const flak = [];
  for (let i = 0; i < 6; i++) flak.push([0.1 + rnd() * 0.8, 0.08 + rnd() * 0.3, 0.03 + rnd() * 0.03]);
  // the works along the valley floor: [x, stack height]
  const stacks = [[0.10, 0.16], [0.175, 0.11], [0.34, 0.19], [0.455, 0.13], [0.62, 0.17], [0.71, 0.10], [0.88, 0.145]];
  const GROUND = 0.635;
  const SKY_T = hex("#0b0d12"), SKY_B = hex("#2c2220"), HORIZ = hex("#54301a");
  return (x, y) => {
    const xa = x * ASPECT;
    let col = mix(SKY_T, SKY_B, smooth(0, 0.62, y));
    // the valley's furnace-glow bleeding up into the overcast
    col = mix(col, HORIZ, smooth(0.62, 0.40, y) * 0.7);
    col = mix(col, hex("#8a4418"), smooth(0.30, 0.02, Math.hypot((x - 0.38) * ASPECT * 0.8, (y - GROUND) * 1.8)) * 0.5);
    col = mix(col, hex("#8a4418"), smooth(0.26, 0.02, Math.hypot((x - 0.76) * ASPECT * 0.8, (y - GROUND) * 1.8)) * 0.4);
    // the searchlight cones, crossing the whole sky
    const beams = [
      beamGlow(xa, y, 0.06 * ASPECT, 0.68, 0.72, -0.10, 0.05),
      beamGlow(xa, y, 0.40 * ASPECT, 0.66, 1.46, -0.06, 0.045),
      beamGlow(xa, y, 0.72 * ASPECT, 0.67, 0.36, -0.04, 0.042),
      beamGlow(xa, y, 0.95 * ASPECT, 0.70, 1.10, -0.12, 0.05),
    ];
    col = mix(col, BEAM, Math.min(0.6, beams[0] * 0.4 + beams[1] * 0.38 + beams[2] * 0.36 + beams[3] * 0.4));
    // the flak, blooming all down the alley
    for (const [fx, fy, fr] of flak) col = flakBloom(col, xa, y, fx * ASPECT, fy, fr);
    // the bomber, high and alone in the cones
    const caught = inBomberSide(xa, y, 0.44 * ASPECT, 0.155, 1.0);
    if (caught) col = mix(SIL, BEAM, Math.min(0.35, (beams[1] + beams[3]) * 0.5));
    // smoke columns leaning east off the stacks
    for (const [sx2, sh] of stacks) {
      const top = GROUND - sh;
      if (y < top) {
        const rise = top - y;
        const w2 = 0.012 + rise * 0.16;
        const off = rise * 0.35 + Math.sin(rise * 14 + sx2 * 30 + rp[0]) * 0.012;
        const sd = Math.abs(x - sx2 - off) / w2;
        if (sd < 1) col = mix(col, hex("#16130f"), (1 - sd) * 0.5 * smooth(0.4, 0.05, rise));
      }
    }
    // the valley works in silhouette: sheds, gasometers, and the stacks
    let solid = false;
    const gy = GROUND + 0.02 * Math.sin(x * 5 + rp[1]);
    if (y > gy) solid = true;
    if (x > 0.055 && x < 0.24 && y > GROUND - 0.05) solid = true;                 // long shed west
    if (inEllipse(xa, y, 0.30 * ASPECT, GROUND, 0.062, 0.062)) solid = true;      // gasometer dome
    if (x > 0.56 && x < 0.77 && y > GROUND - 0.04) solid = true;                  // works east
    if (inTri(x, y, 0.775, GROUND, 0.845, GROUND, 0.81, GROUND - 0.085)) solid = true; // slag cone
    for (const [sx2, sh] of stacks) {
      if (Math.abs(x - sx2) < 0.0085 && y > GROUND - sh && y < GROUND + 0.01) solid = true;
    }
    if (solid) col = SIL;
    // furnace mouths burning through the black
    for (const [mx2, mr] of [[0.115, 0.016], [0.38, 0.02], [0.60, 0.014], [0.745, 0.018]]) {
      const md = Math.hypot((x - mx2) * ASPECT, (y - (GROUND + 0.035)) * ASPECT);
      col = mix(col, hex("#ff9a3a"), smooth(mr * 2.6, 0, md) * 0.5);
      col = mix(col, hex("#ffd9a0"), smooth(mr, 0, md) * 0.9);
    }
    // stack-mouth embers
    for (const [sx2, sh] of stacks) {
      const md = Math.hypot((x - sx2) * ASPECT, (y - (GROUND - sh)) * ASPECT);
      col = mix(col, hex("#e0562a"), smooth(0.012, 0, md) * 0.55);
    }
    return col;
  };
}

const SCENES = [
  ["channel", sceneChannel],
  ["yards", sceneYards],
  ["pens", sceneParens],
  ["ruhr", sceneRuhr],
];

// ---------- render + vignette ----------
function renderScene(build) {
  const sample = build();
  const buf = Buffer.alloc(W * H * 4);
  const SS = 2, VIG = hex("#030406");
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
  writeFileSync(out(`theatre-${id}.png`), encodePNG(W, H, renderScene(build)));
  console.log(`art/theatre-${id}.png`);
}
console.log("bomber art written");
