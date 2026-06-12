// Dependency-free PNG icon generator for The Light-Bringer.
// Renders a warm gold flame-point glowing on deep indigo — the stolen flame.
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const NIGHT = [0x0b, 0x0d, 0x1a];
const NIGHT2 = [0x14, 0x12, 0x2a];
const GOLD = [0xe8, 0xb3, 0x4b];
const GOLD_BRIGHT = [0xff, 0xd8, 0x7a];
const CORE = [0xff, 0xf2, 0xcf];

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
  const cy = size * 0.54;
  // Effective drawing radius shrinks for maskable padding.
  const R = (size / 2) * (1 - pad);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;

      // Background: subtle vertical indigo gradient.
      let col = mix(NIGHT2, NIGHT, y / size);

      // Flame is an elongated radial glow (taller than wide) -> teardrop feel.
      const dx = (x - cx) / R;
      const dy = (y - cy) / R;
      // squash horizontally + pull the tip upward to suggest a flame.
      // smooth sigmoid taper -> narrower above center, no hard seam
      const taper = 1 + 0.4 / (1 + Math.exp(dy * 7));
      const fd = Math.sqrt((dx * taper) ** 2 / 0.42 + (dy * 1.05) ** 2);

      // Outer halo
      const halo = smooth(1.05, 0.0, fd) ** 1.4;
      col = mix(col, GOLD, halo * 0.92);
      // Inner body
      const body = smooth(0.62, 0.0, fd);
      col = mix(col, GOLD_BRIGHT, body * 0.95);
      // Hot core
      const core = smooth(0.26, 0.0, fd);
      col = mix(col, CORE, core);

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
  // 10,11,12 = compression, filter, interlace = 0

  // raw scanlines with filter byte 0
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

writeFileSync(out("icon-192.png"), encodePNG(192, renderIcon(192)));
writeFileSync(out("icon-512.png"), encodePNG(512, renderIcon(512)));
writeFileSync(out("maskable-512.png"), encodePNG(512, renderIcon(512, 0.18)));
writeFileSync(out("icon-180.png"), encodePNG(180, renderIcon(180))); // apple-touch
console.log("icons written");
