// Dependency-free PNG icon generator for The Moon's Hunger (the werewolf spinoff).
// Renders the curse as an emblem: a glowing full moon over a misty ridge, with a
// black wolf sitting in silhouette and howling, flanked by pines — three faint
// blood claw-slashes rake the moon. Anti-aliased by supersampling. Same zero-dep
// PNG path as tools/gen-icons.mjs.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const NIGHT = [0x06, 0x09, 0x12];     // deep sky (bottom)
const NIGHT2 = [0x1a, 0x22, 0x3c];    // sky toward the top
const HORIZON = [0x2a, 0x32, 0x50];   // faint glow at the horizon behind the ridge
const MOON = [0xe6, 0xea, 0xf6];
const MOON_BRIGHT = [0xff, 0xff, 0xff];
const MOON_SHADE = [0xa8, 0xb2, 0xcc];
const HALO = [0xcf, 0xda, 0xf0];
const BLOOD = [0xc8, 0x33, 0x44];
const BLOOD_BRIGHT = [0xff, 0x6a, 0x7a];
const SIL = [0x05, 0x07, 0x0d];       // foreground silhouette (wolf, pines, ridge)

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---- silhouette geometry helpers (work in unit space: 0..1 across the icon) ----
const inEllipse = (px, py, ex, ey, rx, ry) => ((px - ex) / rx) ** 2 + ((py - ey) / ry) ** 2 <= 1;
const inTri = (px, py, ax, ay, bx, by, cx, cy) => {
  const d = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
  const s = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / d;
  const t = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / d;
  return s >= 0 && t >= 0 && s + t <= 1;
};
// A capsule: distance from segment AB <= half-width.
const inCapsule = (px, py, ax, ay, bx, by, hw) => {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy) <= hw;
};

// A sitting wolf, facing left, head raised in a howl. All coords are unit fractions.
function inWolf(px, py) {
  // hindquarters (the seated rump, at the back/right) and the rounded back
  if (inEllipse(px, py, 0.655, 0.735, 0.135, 0.150)) return true;
  // tail, sweeping down behind the rump
  if (inCapsule(px, py, 0.74, 0.70, 0.84, 0.82, 0.045)) return true;
  if (inEllipse(px, py, 0.83, 0.82, 0.05, 0.045)) return true;
  // torso / back, sloping up to the shoulder
  if (inCapsule(px, py, 0.63, 0.69, 0.475, 0.605, 0.085)) return true;
  // chest and the seated front legs
  if (inEllipse(px, py, 0.47, 0.665, 0.085, 0.115)) return true;
  if (inCapsule(px, py, 0.455, 0.64, 0.445, 0.855, 0.045)) return true;
  // neck rising to the head
  if (inCapsule(px, py, 0.475, 0.60, 0.410, 0.460, 0.058)) return true;
  // head
  if (inEllipse(px, py, 0.410, 0.450, 0.062, 0.058)) return true;
  // muzzle, lifted up in the howl (a clean tapering snout, nose to the moon)
  if (inTri(px, py, 0.392, 0.488, 0.452, 0.452, 0.335, 0.318)) return true;
  if (inCapsule(px, py, 0.360, 0.360, 0.335, 0.318, 0.020)) return true;
  // a single ear, swept back behind the crown
  if (inTri(px, py, 0.432, 0.435, 0.478, 0.452, 0.470, 0.372)) return true;
  return false;
}

// A simple conifer (stacked triangles + trunk), centred at (bx) with base at (by).
function inPine(px, py, bx, by, h, w) {
  const tx = bx, trunkTop = by - h * 0.12;
  if (inCapsule(px, py, tx, trunkTop, tx, by, w * 0.07)) return true; // trunk
  // three tapering tiers
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

// deterministic star field — a few twinkles in the upper sky
const STARS = [
  [0.16, 0.12, 0.9], [0.30, 0.20, 0.6], [0.78, 0.14, 0.85], [0.86, 0.28, 0.55],
  [0.10, 0.34, 0.5], [0.66, 0.10, 0.7], [0.50, 0.07, 0.6], [0.90, 0.46, 0.45],
  [0.22, 0.48, 0.4], [0.08, 0.20, 0.55],
];

// Render one RGBA pixel buffer. `pad` is the safe-zone inset fraction (maskable).
function renderIcon(size, pad = 0) {
  const buf = Buffer.alloc(size * size * 4);
  const inset = pad * size;            // shrink the whole scene into the safe zone
  const span = size - inset * 2;
  const SS = 3;                        // supersampling factor (antialiasing)

  // moon, in icon pixels
  const cx = inset + span * 0.5;
  const cy = inset + span * 0.40;
  const moonR = span * 0.27;
  const ridgeY = inset + span * 0.80;  // where the misty ground begins

  const A = (-30 * Math.PI) / 180;     // claw-slash rake
  const cosA = Math.cos(A), sinA = Math.sin(A);
  const moonR1 = moonR;
  const craters = [
    [-0.30, -0.20, 0.16], [0.24, -0.30, 0.10], [0.14, 0.26, 0.18],
    [-0.34, 0.24, 0.09], [0.36, 0.10, 0.08],
  ];
  const slashes = [
    [-0.36 * moonR1, 0.028 * moonR1, 0.86 * moonR1],
    [0.0 * moonR1, 0.034 * moonR1, 0.96 * moonR1],
    [0.36 * moonR1, 0.028 * moonR1, 0.86 * moonR1],
  ];

  // Per-(sub)sample colour at icon-pixel (x,y).
  const sample = (x, y) => {
    const fy = (y - inset) / span; // 0..1 within the scene
    // sky gradient, with a faint warm-cool glow lifting toward the horizon/ridge
    let col = mix(NIGHT2, NIGHT, smooth(0, 0.82, fy));
    col = mix(col, HORIZON, smooth(0.82, 0.55, fy) * 0.5);

    // stars (only above the moon glow / horizon)
    for (const [sx, sy, br] of STARS) {
      const px = inset + span * sx, py = inset + span * sy;
      const sd = Math.hypot(x - px, y - py);
      const tw = smooth(span * 0.012, 0, sd);
      if (tw > 0) col = mix(col, MOON_BRIGHT, tw * br);
    }

    const dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);

    // soft halo around the moon
    const halo = smooth(moonR * 2.1, moonR, d);
    col = mix(col, HALO, halo * 0.26);

    // moon body, limb-shaded, with craters
    const body = smooth(moonR, moonR - size * 0.012, d);
    if (body > 0) {
      const limb = 1 - smooth(moonR * 0.2, moonR, d) * 0.42;
      let m = mix(MOON, MOON_BRIGHT, smooth(moonR * 0.7, 0, d) * 0.6);
      m = mix(MOON_SHADE, m, limb);
      for (const [ux, uy, ur] of craters) {
        const cd = Math.hypot(dx - ux * moonR, dy - uy * moonR) / (ur * moonR);
        if (cd < 1) m = mix(m, MOON_SHADE, (1 - cd) * 0.5);
      }
      col = mix(col, m, body);
    }

    // claw-slashes raked across the moon (faint, menacing)
    const u = dx * cosA - dy * sinA;
    const v = dx * sinA + dy * cosA;
    let gash = 0;
    for (const [off, hw, spanS] of slashes) {
      const band = 1 - smooth(hw, hw * 2.0, Math.abs(v - off));
      const along = smooth(spanS, spanS * 0.72, Math.abs(u));
      gash = Math.max(gash, band * along);
    }
    if (gash > 0) {
      const inMoon = smooth(moonR * 1.04, moonR * 0.94, d); // keep the blood mostly on the moon
      const g = gash * (0.06 + 0.74 * inMoon);
      col = mix(col, BLOOD, g * 0.85);
      col = mix(col, BLOOD_BRIGHT, g * gash * 0.55);
    }

    // misty ground band rising from the ridge (cool haze)
    if (y > ridgeY - span * 0.10) {
      const haze = smooth(ridgeY - span * 0.10, ridgeY + span * 0.04, y) * 0.5;
      col = mix(col, HORIZON, haze);
    }

    // foreground silhouettes — pines, ridge, and the howling wolf
    const ux2 = (x - inset) / span, uy2 = (y - inset) / span;
    let solid = false;
    // ground ridge: a gentle hill the wolf sits on
    const hill = 0.80 + 0.03 * Math.cos((ux2 - 0.5) * Math.PI * 1.6);
    if (uy2 >= hill) solid = true;
    if (inPine(ux2, uy2, 0.14, 0.84, 0.42, 0.20)) solid = true;
    if (inPine(ux2, uy2, 0.27, 0.86, 0.30, 0.15)) solid = true;
    if (inPine(ux2, uy2, 0.88, 0.84, 0.40, 0.20)) solid = true;
    if (inWolf(ux2, uy2)) solid = true;
    if (solid) col = SIL;

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

writeFileSync(out("werewolf-icon-192.png"), encodePNG(192, renderIcon(192)));
writeFileSync(out("werewolf-icon-512.png"), encodePNG(512, renderIcon(512)));
writeFileSync(out("werewolf-maskable-512.png"), encodePNG(512, renderIcon(512, 0.18)));
writeFileSync(out("werewolf-icon-180.png"), encodePNG(180, renderIcon(180))); // apple-touch
console.log("werewolf icons written");
