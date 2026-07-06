// Dependency-free PNG icon generator for The Iron Rain (the WW2 bomber spinoff).
// Renders the raid as an emblem: a heavy bomber's top-down silhouette caught in
// two crossing searchlight beams over a dusk-dark country, flak puffs blooming
// around it and tracer motes adrift. Anti-aliased by supersampling. Same
// zero-dep PNG path as tools/gen-icons.mjs / gen-eld-icons.mjs / gen-ww-icons.mjs.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const SKY_LO = [0x05, 0x08, 0x0c];    // the night sky (top)
const SKY_HI = [0x2a, 0x1c, 0x10];    // the burning dusk toward the horizon
const HORIZON = [0x3a, 0x24, 0x10];   // the fires along the ground line
const BEAM = [0xbe, 0xd4, 0xe4];      // searchlight steel
const TRACER = [0xff, 0xb8, 0x4d];    // tracer amber (the shell's theme colour)
const TRACER_HOT = [0xff, 0xf3, 0xd8];
const PUFF = [0x3a, 0x3f, 0x46];      // flak iron-grey
const SIL = [0x03, 0x05, 0x08];       // the bomber's silhouette

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Distance from point P to segment AB (unit space).
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
const inCapsule = (px, py, ax, ay, bx, by, hw) => segDist(px, py, ax, ay, bx, by) <= hw;

// The bomber's top-down silhouette (unit space, nose up at ~(0.5, 0.24)):
// fuselage + broad straight wing + tailplane, four engine nacelles on the wing.
const NOSE = [0.5, 0.22], TAIL = [0.5, 0.8];
const WING_Y = 0.46, TAIL_Y = 0.73;
function inBomber(px, py) {
  if (inCapsule(px, py, NOSE[0], NOSE[1], TAIL[0], TAIL[1], 0.036)) return true;      // fuselage
  if (inCapsule(px, py, 0.15, WING_Y + 0.02, 0.85, WING_Y + 0.02, 0.012)) return true; // wing trailing edge
  if (inCapsule(px, py, 0.17, WING_Y, 0.83, WING_Y, 0.042)) return true;               // main wing
  if (inCapsule(px, py, 0.36, TAIL_Y, 0.64, TAIL_Y, 0.024)) return true;               // tailplane
  for (const ex of [0.31, 0.41, 0.59, 0.69]) {                                          // nacelles
    if (inCapsule(px, py, ex, WING_Y - 0.035, ex, WING_Y + 0.045, 0.021)) return true;
  }
  return false;
}

// A searchlight beam — a wedge from a ground anchor toward a sky point, bright
// at its core and fading with distance from the axis and from the anchor.
function beamGlow(px, py, ax, ay, tx, ty, hw) {
  const d = segDist(px, py, ax, ay, tx, ty);
  const along = Math.hypot(px - ax, py - ay) / Math.hypot(tx - ax, ty - ay);
  const spread = hw * (0.35 + along * 1.2); // the beam opens as it climbs
  return smooth(spread, spread * 0.25, d) * smooth(1.25, 0.15, along);
}

// Flak puffs — soft iron blooms hanging around the bomber's line.
const PUFFS = [
  [0.2, 0.3, 0.055], [0.79, 0.24, 0.045], [0.72, 0.6, 0.06],
  [0.26, 0.66, 0.05], [0.62, 0.14, 0.04],
];

// Tracer motes adrift — deterministic amber sparks climbing from the ground.
const MOTES = [
  [0.12, 0.52, 0.8], [0.3, 0.78, 0.6], [0.88, 0.44, 0.75], [0.68, 0.86, 0.55],
  [0.08, 0.86, 0.5], [0.93, 0.7, 0.6], [0.44, 0.9, 0.5], [0.56, 0.06, 0.45],
];

// Render one RGBA pixel buffer. `pad` is the safe-zone inset fraction (maskable).
function renderIcon(size, pad = 0) {
  const buf = Buffer.alloc(size * size * 4);
  const inset = pad * size;
  const span = size - inset * 2;
  const SS = 3;

  const sample = (x, y) => {
    const ux = (x - inset) / span, uy = (y - inset) / span; // 0..1 scene space
    // the sky: night above, dusk fires toward the horizon line
    let col = mix(SKY_LO, SKY_HI, smooth(0.15, 0.98, uy));
    col = mix(col, HORIZON, smooth(0.99, 0.9, uy) * 0.7);

    // two crossing searchlight beams from the ground
    const b1 = beamGlow(ux, uy, 0.1, 1.02, 0.62, 0.28, 0.05);
    const b2 = beamGlow(ux, uy, 0.92, 1.02, 0.38, 0.3, 0.045);
    if (b1 > 0) col = mix(col, BEAM, b1 * 0.5);
    if (b2 > 0) col = mix(col, BEAM, b2 * 0.45);

    // flak puffs
    for (const [fx, fy, fr] of PUFFS) {
      const fd = Math.hypot(ux - fx, uy - fy);
      const t = smooth(fr, fr * 0.2, fd);
      if (t > 0) {
        col = mix(col, PUFF, t * 0.8);
        col = mix(col, TRACER, smooth(fr * 0.3, 0, fd) * 0.35); // a hot heart
      }
    }

    // tracer motes
    for (const [mx, my, br] of MOTES) {
      const md = Math.hypot(ux - mx, uy - my);
      const tw = smooth(0.012, 0, md);
      if (tw > 0) col = mix(col, TRACER_HOT, tw * br);
    }

    // the bomber, black against the beams — its edges rimmed where a beam catches it
    if (inBomber(ux, uy)) {
      const rim = Math.min(0.4, (b1 + b2) * 0.55);
      col = mix(SIL, BEAM, rim);
      // the amber roundel on the fuselage heart
      const rd = Math.hypot(ux - 0.5, uy - 0.52);
      col = mix(col, TRACER, smooth(0.02, 0.008, rd) * 0.9);
    }

    return col;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      buf[i] = clamp(r / n);
      buf[i + 1] = clamp(g / n);
      buf[i + 2] = clamp(b / n);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

function encodePNG(size, rgba) {
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
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
const out = (name) => new URL("../icons/" + name, import.meta.url);

writeFileSync(out("bomber-icon-192.png"), encodePNG(192, renderIcon(192)));
writeFileSync(out("bomber-icon-512.png"), encodePNG(512, renderIcon(512)));
writeFileSync(out("bomber-maskable-512.png"), encodePNG(512, renderIcon(512, 0.18)));
writeFileSync(out("bomber-icon-180.png"), encodePNG(180, renderIcon(180))); // apple-touch
console.log("bomber icons written");
