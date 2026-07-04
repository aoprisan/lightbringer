// Dependency-free PNG icon generator for The Watcher at the Threshold (the
// Lovecraftian spinoff). Renders the watch as an emblem: a glowing Elder Sign —
// a five-pointed star traced in pale witch-light with an unblinking eye at its
// heart — over an abyssal deep, with tentacles rising in silhouette from the
// threshold below. Anti-aliased by supersampling. Same zero-dep PNG path as
// tools/gen-icons.mjs / tools/gen-ww-icons.mjs.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const DEEP = [0x02, 0x05, 0x0a];      // the abyss (bottom)
const DEEP2 = [0x0a, 0x16, 0x24];     // the deep toward the top
const HAZE = [0x14, 0x2c, 0x3a];      // drowned green-blue haze near the threshold
const SIGN = [0x7a, 0xd8, 0xff];      // the traced line (the shell's theme colour)
const SIGN_BRIGHT = [0xe8, 0xfb, 0xff];
const IRIS = [0x9f, 0xff, 0xc8];      // the eye's sickly pale green
const PUPIL = [0x01, 0x03, 0x06];
const SIL = [0x01, 0x03, 0x07];       // foreground silhouette (tentacles, threshold)

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

// The five points of the Sign's star (unit space), apex up, and the pentagram's
// five strands (each point joined to the second-next — the sigil the Watcher traces).
const STAR_CX = 0.5, STAR_CY = 0.44, STAR_R = 0.30;
const PTS = [];
for (let k = 0; k < 5; k++) {
  const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
  PTS.push([STAR_CX + Math.cos(a) * STAR_R, STAR_CY + Math.sin(a) * STAR_R]);
}
const STRANDS = [];
for (let k = 0; k < 5; k++) STRANDS.push([PTS[k], PTS[(k + 2) % 5]]);

// Distance to the whole traced Sign — the closest of its five strands.
function signDist(px, py) {
  let d = Infinity;
  for (const [[ax, ay], [bx, by]] of STRANDS) d = Math.min(d, segDist(px, py, ax, ay, bx, by));
  return d;
}

// A tentacle: a chain of capsules tapering upward from the threshold, with a
// gentle S-curve. bx = base x, top = how high the tip reaches, sway bends it.
function inTentacle(px, py, bx, top, sway, w) {
  let x0 = bx, y0 = 1.0;
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const t1 = (i + 1) / segs;
    const x1 = bx + Math.sin(t1 * Math.PI * 1.6) * sway * t1;
    const y1 = 1.0 - (1.0 - top) * t1;
    const hw = w * (1 - t1 * 0.82);
    if (inCapsule(px, py, x0, y0, x1, y1, hw)) return true;
    x0 = x1; y0 = y1;
  }
  return false;
}

// deterministic drowned "stars" — motes adrift in the upper dark
const MOTES = [
  [0.12, 0.10, 0.7], [0.30, 0.05, 0.5], [0.72, 0.07, 0.75], [0.88, 0.18, 0.5],
  [0.08, 0.30, 0.45], [0.93, 0.38, 0.4], [0.55, 0.04, 0.55], [0.20, 0.20, 0.4],
];

// Render one RGBA pixel buffer. `pad` is the safe-zone inset fraction (maskable).
function renderIcon(size, pad = 0) {
  const buf = Buffer.alloc(size * size * 4);
  const inset = pad * size;
  const span = size - inset * 2;
  const SS = 3;

  const lineHW = 0.021;               // the traced strand's half-width (unit space)
  const eyeRx = 0.105, eyeRy = 0.058; // the eye at the Sign's heart

  const sample = (x, y) => {
    const ux = (x - inset) / span, uy = (y - inset) / span; // 0..1 scene space
    // the deep: darker downward, a drowned haze rising from the threshold
    let col = mix(DEEP2, DEEP, smooth(0.05, 0.9, uy));
    col = mix(col, HAZE, smooth(0.98, 0.72, uy) * 0.45);

    // adrift motes
    for (const [mx, my, br] of MOTES) {
      const md = Math.hypot(ux - mx, uy - my);
      const tw = smooth(0.012, 0, md);
      if (tw > 0) col = mix(col, SIGN_BRIGHT, tw * br);
    }

    // the traced Sign: a wide soft glow, then the strand itself, bright at core
    const d = signDist(ux, uy);
    const glow = smooth(lineHW * 5.2, lineHW * 0.8, d);
    if (glow > 0) col = mix(col, SIGN, glow * 0.35);
    const line = smooth(lineHW, lineHW * 0.45, d);
    if (line > 0) {
      col = mix(col, SIGN, line * 0.95);
      col = mix(col, SIGN_BRIGHT, smooth(lineHW * 0.5, 0, d) * 0.8);
    }

    // the eye at the heart: a pale iris in an almond lid, slit pupil, unblinking
    const ex = (ux - STAR_CX) / eyeRx, ey = (uy - STAR_CY) / eyeRy;
    const er = Math.hypot(ex, ey);
    if (er < 1.35) {
      const lid = smooth(1.0, 0.88, er);
      if (lid > 0) {
        let m = mix(IRIS, SIGN_BRIGHT, smooth(0.75, 0.1, er) * 0.5);
        // the slit pupil — a soft-edged vertical ellipse
        const pd = Math.hypot(ex / 0.24, ey / 0.8);
        m = mix(m, PUPIL, smooth(1.0, 0.72, pd));
        col = mix(col, m, lid);
      } else {
        col = mix(col, SIGN, smooth(1.35, 1.0, er) * 0.25); // faint rim-light
      }
    }

    // the threshold: a dark sill across the bottom, tentacles rising before the Sign
    let solid = false;
    const sill = 0.90 + 0.02 * Math.cos((ux - 0.5) * Math.PI * 2.2);
    if (uy >= sill) solid = true;
    if (inTentacle(ux, uy, 0.16, 0.58, 0.10, 0.052)) solid = true;
    if (inTentacle(ux, uy, 0.84, 0.52, -0.11, 0.055)) solid = true;
    if (inTentacle(ux, uy, 0.30, 0.74, -0.07, 0.042)) solid = true;
    if (inTentacle(ux, uy, 0.70, 0.78, 0.06, 0.040)) solid = true;
    if (solid) {
      // the Sign's light catches a tentacle's edge, so the dark reads as shape
      const rim = smooth(lineHW * 6, lineHW * 1.5, d) * 0.22;
      col = mix(SIL, SIGN, rim);
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

writeFileSync(out("eldritch-icon-192.png"), encodePNG(192, renderIcon(192)));
writeFileSync(out("eldritch-icon-512.png"), encodePNG(512, renderIcon(512)));
writeFileSync(out("eldritch-maskable-512.png"), encodePNG(512, renderIcon(512, 0.18)));
writeFileSync(out("eldritch-icon-180.png"), encodePNG(180, renderIcon(180))); // apple-touch
console.log("eldritch icons written");
