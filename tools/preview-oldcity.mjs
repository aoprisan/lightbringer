// Dev-only: rasterize the Old City arena buildArena() actually produces, as a
// top-down schematic, so we can eyeball it against the map art. Dependency-free
// PNG (same encoder shape as gen-icons.mjs). Not part of the build or tests.
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

globalThis.__PG_TEST__ = true;
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
await import("../pentagram.js");
const pg = globalThis.__pg;
const K = pg.K;

const s = pg.buildArena(pg.levelById("old-city"));
const SCALE = 0.5;
const W = Math.round(s.w * SCALE), H = Math.round(s.h * SCALE);
const buf = Buffer.alloc(W * H * 4);

const set = (x, y, c, a = 1) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = buf[i] * (1 - a) + c[0] * a;
  buf[i + 1] = buf[i + 1] * (1 - a) + c[1] * a;
  buf[i + 2] = buf[i + 2] * (1 - a) + c[2] * a;
  buf[i + 3] = 255;
};
const fillRect = (cx, cy, hw, hh, c, a = 1) => {
  for (let y = cy - hh; y <= cy + hh; y++)
    for (let x = cx - hw; x <= cx + hw; x++) set(x, y, c, a);
};
const disc = (cx, cy, r, c, a = 1) => {
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r) set(cx + x, cy + y, c, a);
};
const thickLine = (x1, y1, x2, y2, half, c, a = 1) => {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, half, c, a);
  }
};

// Parchment background.
for (let i = 0; i < W * H; i++) { buf[i * 4] = 0xea; buf[i * 4 + 1] = 0xe4; buf[i * 4 + 2] = 0xd4; buf[i * 4 + 3] = 255; }

// Avenues (pathways) — pale street bands.
for (const p of s.pathways)
  thickLine(p.x1 * SCALE, p.y1 * SCALE, p.x2 * SCALE, p.y2 * SCALE, Math.max(2, K.PATHWAY_HALF * SCALE), [0xf6, 0xf2, 0xe6]);

// Buildings — every dwelling/conduit node as a slate block.
for (const n of s.scenery) {
  if (n.kind === "dwelling" || n.kind === "conduit")
    fillRect(Math.round(n.x * SCALE), Math.round(n.y * SCALE), 5, 5, [0x5a, 0x63, 0x72]);
}

// Fences + authored walls — dark lines (walls = the rampart, near the edges).
for (const f of s.fences)
  thickLine(f.x1 * SCALE, f.y1 * SCALE, f.x2 * SCALE, f.y2 * SCALE, Math.max(2, K.FENCE_HALF * SCALE), [0x20, 0x1a, 0x2a]);

// Landmarks.
for (const n of s.scenery) {
  const x = Math.round(n.x * SCALE), y = Math.round(n.y * SCALE);
  if (n.kind === "shrine") { disc(x, y, 9, [0x2a, 0x6f, 0x74]); disc(x, y, 4, [0xcf, 0xe8, 0xe6]); } // wells
  else if (n.kind === "font") disc(x, y, 8, [0x3a, 0x7a, 0xd0]);
  else if (n.kind === "press") disc(x, y, 7, [0x8a, 0x5a, 0x2a]);
  else if (n.kind === "keeper") disc(x, y, 6, [0xc0, 0x33, 0x33]); // enemy spawns
}

// Bonfire — the hero's central spawn.
disc(Math.round(s.hero.x * SCALE), Math.round(s.hero.y * SCALE), 10, [0xff, 0x8a, 0x2a]);
disc(Math.round(s.hero.x * SCALE), Math.round(s.hero.y * SCALE), 5, [0xff, 0xe8, 0xb0]);

// Encode PNG (RGBA, filter 0).
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const stride = W * 4;
const raw = Buffer.alloc((stride + 1) * H);
for (let y = 0; y < H; y++) buf.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(new URL("../oldcity-preview.png", import.meta.url), png);
console.log(`wrote oldcity-preview.png (${W}x${H}); pathways=${s.pathways.length} fences=${s.fences.length} dwellings=${s.scenery.filter(n=>n.kind==='dwelling').length} shrines=${s.scenery.filter(n=>n.kind==='shrine').length} keepers=${s.scenery.filter(n=>n.kind==='keeper').length}`);
