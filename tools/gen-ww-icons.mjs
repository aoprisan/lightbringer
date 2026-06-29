// Dependency-free PNG icon generator for The Moon's Hunger (the werewolf spinoff).
// Renders a pale full moon raked by three blood-red claw-slashes on a night sky —
// the curse made an emblem. Same zero-dep PNG path as tools/gen-icons.mjs.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const NIGHT = [0x08, 0x0b, 0x14];
const NIGHT2 = [0x16, 0x1c, 0x30];
const MOON = [0xe2, 0xe7, 0xf4];
const MOON_BRIGHT = [0xff, 0xff, 0xff];
const MOON_SHADE = [0xa8, 0xb2, 0xcc];
const BLOOD = [0xc8, 0x33, 0x44];
const BLOOD_BRIGHT = [0xff, 0x6a, 0x7a];

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Render one RGBA pixel buffer. `pad` is the safe-zone inset fraction (maskable).
function renderIcon(size, pad = 0) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size * 0.46;
  const R = (size / 2) * (1 - pad);
  const moonR = R * 0.6;

  // A few craters (unit-circle offsets within the moon, with radii).
  const craters = [
    [-0.28, -0.18, 0.16], [0.22, -0.3, 0.1], [0.12, 0.26, 0.18],
    [-0.36, 0.22, 0.09], [0.34, 0.12, 0.08],
  ];
  // Three claw-slashes, raked diagonally. Each: offset along the perpendicular axis
  // (v), half-width, and the span/taper along the slash (u).
  const A = (-32 * Math.PI) / 180;
  const cosA = Math.cos(A), sinA = Math.sin(A);
  const slashes = [
    [-0.34 * moonR, 0.05 * moonR, 0.95 * moonR],
    [0.0 * moonR, 0.06 * moonR, 1.05 * moonR],
    [0.34 * moonR, 0.05 * moonR, 0.95 * moonR],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let col = mix(NIGHT2, NIGHT, y / size);

      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);

      // Soft halo around the moon.
      const halo = smooth(moonR * 2.0, moonR, d);
      col = mix(col, MOON_SHADE, halo * 0.22);

      // The moon body, with limb shading darker toward the edge.
      const body = smooth(moonR, moonR - 2, d);
      if (body > 0) {
        const limb = 1 - smooth(moonR * 0.2, moonR, d) * 0.4;
        let m = mix(MOON, MOON_BRIGHT, smooth(moonR * 0.7, 0, d) * 0.6);
        m = mix(MOON_SHADE, m, limb);
        // Craters — gentle darker dimples.
        for (const [ux, uy, ur] of craters) {
          const cdx = dx - ux * moonR, cdy = dy - uy * moonR;
          const cd = Math.hypot(cdx, cdy) / (ur * moonR);
          if (cd < 1) m = mix(m, MOON_SHADE, (1 - cd) * 0.5);
        }
        col = mix(col, m, body);
      }

      // The claw-slashes — red gashes raked across the moon and a touch beyond.
      const u = dx * cosA - dy * sinA;
      const v = dx * sinA + dy * cosA;
      let gash = 0;
      for (const [off, hw, span] of slashes) {
        const band = 1 - smooth(hw, hw * 2.4, Math.abs(v - off)); // across the slash
        const along = smooth(span, span * 0.7, Math.abs(u));      // taper to the ends
        gash = Math.max(gash, band * along);
      }
      if (gash > 0) {
        const inMoon = smooth(moonR * 1.08, moonR * 0.96, d); // brighter over the moon
        const g = gash * (0.45 + 0.55 * inMoon);
        col = mix(col, BLOOD, g);
        col = mix(col, BLOOD_BRIGHT, g * gash * 0.7);
      }

      buf[i] = clamp(col[0]);
      buf[i + 1] = clamp(col[1]);
      buf[i + 2] = clamp(col[2]);
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
