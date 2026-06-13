// The Burning Vigil — an action-combat spinoff of The Light-Bringer.
//
// Same world, same art, same gloom — but the contemplative night becomes an
// Archero-style descent: you walk a flame-hero through one of the very cities
// the parent game generates, and instead of shooting you STAND STILL to inscribe
// a burning pentagram on the ground that scorches every shade in its ring. Move
// to dodge; stop to fight. A city holds a finite host of shades — clear them all
// and the city is cleansed. Presses and shrines are solid: you weave the swarm
// around them. Dark dwellings caught in the sigil's ring kindle alight, mending
// the hero a little — relighting the city is a vigil kept alongside the killing.
//
// This file is deliberately self-contained (no import/export, like app.ts, so
// tsc emits a plain classic script). It copies the minimal slice of app.ts it
// needs — the world size, the city generator, the LevelDef cities, the sprite
// system, and the camera/joystick shell — rather than importing (app.ts exposes
// nothing). The simulation is pure and headless (PgState in, mutation out); the
// render pass only reads it. The same split that lets smoke-test.mjs drive the
// parent lets pentagram-test.mjs drive this. Sections below:
//   Types -> Tuning -> Cities -> Arena generation -> Combat sim -> Sprites ->
//   Render -> Game shell -> SW + test seam.

// ---------- Types ----------

type NodeKind = "dwelling" | "conduit" | "press" | "shrine" | "keeper";
type Phase = "fight" | "won" | "lost";

// The battlefield is dressed from a city's nodes. Combat only needs each one's
// place and kind (which sprite, and whether it's a shade spawn-point). A dark
// dwelling can `lit` once the sigil's ring catches it.
interface ArenaNode { x: number; y: number; kind: NodeKind; lit?: boolean }

// A line segment strung between two posts. Fences are low walls (they block the
// hero and shades, capsule-collision); pathways are open lanes (the hero runs
// swift along them). Both are pure geometry, woven from node positions at build.
interface Segment { x1: number; y1: number; x2: number; y2: number }

interface Hero {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  hurt: number; // remaining i-frame ms after a shade's touch (0 = vulnerable)
}

interface Shade {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  dead: boolean;
  wakeAt: number; // ms into the run before this shade rises and gives chase
}

interface Penta {
  charge: number; // 0..1 — how fully the sigil is inscribed (ramps while still)
  angle: number;  // current rotation, degrees (cosmetic)
}

interface PgState {
  level: LevelDef;
  scenery: ArenaNode[];
  solids: ArenaNode[];   // scenery the hero/shades can't pass (presses, shrines)
  fences: Segment[];     // low walls the hero/shades must weave around
  pathways: Segment[];   // open lanes the hero runs swift along
  hero: Hero;
  shades: Shade[];
  penta: Penta;
  pulseAcc: number; // ms accumulated toward the next damage pulse
  elapsed: number;  // ms since the descent began (clear time + wake timing)
  kills: number;
  total: number;        // the finite host: clear them all to win
  dwellingsTotal: number; // dark dwellings the city began with
  litCount: number;     // how many the sigil has kindled (secondary objective)
  phase: Phase;
}

interface Move { x: number; y: number } // normalized input vector, -1..1 each

// ---------- Tuning ----------
// The design surface. Balance changes should be constant changes here, the same
// ethos as app.ts's tuning block.

const W = 1000;
const H = 1400;

// The hero.
const HERO_SPEED = 260;          // travel, world units per second (reused from app)
const HERO_RADIUS = 16;
const HERO_HP = 100;
const HERO_STILL_MAXSPEED = 40;  // must be slower than this (units/s) to inscribe
const HERO_IFRAMES_MS = 700;     // grace after a touch, no further damage
const HERO_KNOCKBACK = 64;       // units the hero is shoved back by a shade's blow

// The pentagram — the weapon. Stand still and it inscribes; the fuller the
// charge, the harder each pulse bites. Move and it fades.
const PENTA_CHARGE_MS = 360;     // time stationary to fully inscribe (and to fade)
const PENTA_RADIUS = 165;        // the sigil's reach
const PENTA_PULSE_MS = 320;      // ms between damage pulses ("fire rate")
const PENTA_DMG = 22;            // damage per pulse at full charge (scales w/ charge)
const PENTA_SPIN = 0.05;         // degrees of rotation per ms (cosmetic)

// The shades (the city's watch, risen against you — drawn as Keepers).
const SHADE_HP = 44;
const SHADE_SPEED = 108;         // chase speed, units per second (slower than hero)
const SHADE_RADIUS = 18;
const SHADE_CONTACT_DMG = 10;    // hero HP lost per touch (gated by i-frames)
const SHADE_SEP = 34;            // shades push apart within this range, so they swarm
const SHADE_PER_KEEPER = 3;      // how many shades each keeper-post raises
const SHADE_WAKE_STAGGER = 700;  // ms between successive waves rising from a post

// Obstacles — the city's built structures stand solid; the hero and shades must
// weave around them. Only presses and shrines block; dwellings/conduits are
// passable (you light the former). Radii are roughly the sprite's footprint.
const OBSTACLE_KINDS = new Set<NodeKind>(["press", "shrine"]);
const OBSTACLE_RADIUS: Partial<Record<NodeKind, number>> = { press: 24, shrine: 20 };

// Fences — low walls strung between neighbouring posts. They block movement (a
// capsule: the segment plus this half-thickness) for both the hero and the
// shades, but NOT the pentagram's flame, which burns straight through. The hero
// weaves them as cover to break a swarm's contact.
const FENCE_HALF = 8;            // half-thickness of a fence wall (collision)

// Pathways — open lanes the flame-hero runs swift along (the cleared streets).
// Travelling within this half-width of a pathway grants a speed boost, rewarding
// the streets for kiting the host. Shades ignore them — only the hero is quick.
const PATHWAY_HALF = 30;         // half-width of a pathway lane
const PATHWAY_BOOST = 1.4;       // hero speed multiplier while on a pathway

// Dwellings — a dark one caught in the charged sigil kindles alight, mending the
// hero. Relighting the city is a vigil kept alongside the killing (not a win gate).
const DWELLING_HEAL = 8;         // hero HP restored per dwelling kindled (clamped)

const PG_LEGACY_KEY = "pentagram.legacy.v1";

// ---------- Cities (levels) ----------
// The same hand-tuned cities the parent game offers, trimmed to just the
// generation dials the arena needs: how many places, how dense, how many
// conduits/presses/shrines (scenery flavour), and how many keeper-posts (each
// raises a wave of shades). The economy/weather/quarter dials are dropped — a
// descent has no flame to spend and no dawn to reach.
interface LevelDef {
  id: string;
  name: string;
  epigraph: string;
  art?: string;        // optional establishing image (art/city-*.jpg); silent-fail
  nodeCount: number;
  minDist: number;
  conduitFrac: number;
  pressCount: number;
  shrineCount: number;
  keeperCount: number; // keeper-posts — each raises SHADE_PER_KEEPER shades
  keeperSpacing: number;
  fenceCount: number;  // low walls woven between neighbouring posts (cover)
  pathwayCount: number; // open lanes the hero runs swift along
}

const LEVELS: LevelDef[] = [
  {
    id: "old-city",
    name: "The Old City",
    epigraph: "Where you first stole the flame. The watch is even — a fair first descent.",
    art: "art/city-old.jpg",
    nodeCount: 124, minDist: 70,
    conduitFrac: 0.16, pressCount: 4, shrineCount: 5,
    keeperCount: 6, keeperSpacing: 360,
    fenceCount: 8, pathwayCount: 6,
  },
  {
    id: "ashfold",
    name: "Ashfold",
    epigraph: "Dry tinder that remembers fire. The watch is many and quick to rise.",
    art: "art/city-ashfold.jpg",
    nodeCount: 130, minDist: 64,
    conduitFrac: 0.26, pressCount: 6, shrineCount: 3,
    keeperCount: 7, keeperSpacing: 320,
    fenceCount: 6, pathwayCount: 9,
  },
  {
    id: "drowned",
    name: "The Drowned Quarter",
    epigraph: "The water took the low streets. Few shades here — but they wake patient and far.",
    art: "art/city-drowned.jpg",
    nodeCount: 104, minDist: 86,
    conduitFrac: 0.10, pressCount: 2, shrineCount: 6,
    keeperCount: 4, keeperSpacing: 420,
    fenceCount: 11, pathwayCount: 3,
  },
  {
    id: "glassworks",
    name: "The Glassworks",
    epigraph: "Everything here is bright and breaks. The watch is thick and tightly packed.",
    art: "art/city-glassworks.jpg",
    nodeCount: 134, minDist: 66,
    conduitFrac: 0.14, pressCount: 3, shrineCount: 8,
    keeperCount: 9, keeperSpacing: 270,
    fenceCount: 13, pathwayCount: 5,
  },
  {
    id: "vesper",
    name: "Vesper Row",
    epigraph: "The watch is thickest where the faithful sleep. The hardest descent.",
    art: "art/city-vesper.jpg",
    nodeCount: 124, minDist: 70,
    conduitFrac: 0.08, pressCount: 3, shrineCount: 4,
    keeperCount: 11, keeperSpacing: 250,
    fenceCount: 9, pathwayCount: 4,
  },
];

function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

// ---------- Arena generation ----------
// The same Poisson-disc-ish placement + kind assignment as app.ts's
// generateCity, trimmed to return plain {x,y,kind} nodes (no edges/adjacency —
// combat never spreads light along streets). Each city reads the same as it does
// in the parent game; the keeper nodes become the shade spawn-points.

function generateCity(level: LevelDef): ArenaNode[] {
  const nodes: ArenaNode[] = [];
  let guard = 0;
  while (nodes.length < level.nodeCount && guard++ < 20000) {
    const x = 60 + Math.random() * (W - 120);
    const y = 60 + Math.random() * (H - 120);
    if (nodes.every((n) => (n.x - x) ** 2 + (n.y - y) ** 2 > level.minDist ** 2)) {
      nodes.push({ x, y, kind: "dwelling" });
    }
  }

  const shuffled = [...nodes].sort(() => Math.random() - 0.5);
  const nConduit = Math.floor(nodes.length * level.conduitFrac);
  shuffled.slice(0, nConduit).forEach((n) => (n.kind = "conduit"));
  shuffled.slice(nConduit, nConduit + level.pressCount).forEach((n) => (n.kind = "press"));
  shuffled.slice(-level.shrineCount).forEach((n) => (n.kind = "shrine"));

  const keepers: ArenaNode[] = [];
  for (const n of shuffled) {
    if (n.kind !== "dwelling") continue;
    if (keepers.every((k) => (k.x - n.x) ** 2 + (k.y - n.y) ** 2 > level.keeperSpacing ** 2)) {
      n.kind = "keeper";
      keepers.push(n);
      if (keepers.length >= level.keeperCount) break;
    }
  }
  return nodes;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Closest point on segment AB to P, and the distance to it. The workhorse for
// both fence collision (capsule = segment + radius) and "is the hero on a
// pathway?" (distance to the lane's centre line).
function closestOnSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { x: number; y: number; d: number } {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  const x = ax + dx * t, y = ay + dy * t;
  return { x, y, d: Math.hypot(px - x, py - y) };
}

// String `count` line segments between pairs of nodes whose gap falls in
// [lo, hi], hugging each anchor's nearest in-band neighbour so the segment runs
// along the street grid. Fences want short gaps (walls between neighbours);
// pathways want longer gaps (lanes across a quarter). Keeper-posts are skipped
// so spawns stay clear. Pure geometry — it only reads the placed nodes.
function weaveSegments(
  nodes: ArenaNode[], count: number, lo: number, hi: number,
): Segment[] {
  const segs: Segment[] = [];
  const pool = nodes.filter((n) => n.kind !== "keeper");
  if (pool.length < 2) return segs;
  let guard = 0;
  while (segs.length < count && guard++ < count * 40) {
    const a = pool[Math.floor(Math.random() * pool.length)];
    let best: ArenaNode | null = null, bestD = Infinity;
    for (const b of pool) {
      if (b === a) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d >= lo && d <= hi && d < bestD) { bestD = d; best = b; }
    }
    if (best) segs.push({ x1: a.x, y1: a.y, x2: best.x, y2: best.y });
  }
  return segs;
}

// Push a moving body (hero or shade) out of any blocking terrain it has
// overlapped — solid scenery (circle-vs-circle) and fences (circle-vs-segment) —
// then back inside the world bounds. Shove along the normal so a body slides
// along an edge rather than stopping dead.
function pushOut(s: PgState, x: number, y: number, radius: number): { x: number; y: number } {
  for (const n of s.solids) {
    const rr = radius + (OBSTACLE_RADIUS[n.kind] || 0);
    let dx = x - n.x, dy = y - n.y;
    let d = Math.hypot(dx, dy);
    if (d >= rr) continue;
    if (d === 0) { dx = 1; dy = 0; d = 1; } // degenerate: dead-centre, pick a direction
    x = n.x + (dx / d) * rr;
    y = n.y + (dy / d) * rr;
  }
  for (const f of s.fences) {
    const rr = radius + FENCE_HALF;
    const c = closestOnSegment(x, y, f.x1, f.y1, f.x2, f.y2);
    if (c.d >= rr) continue;
    let dx = x - c.x, dy = y - c.y, d = c.d;
    if (d === 0) { // dead on the line: shove perpendicular to the fence
      const fx = f.x2 - f.x1, fy = f.y2 - f.y1, fl = Math.hypot(fx, fy) || 1;
      dx = -fy / fl; dy = fx / fl; d = 1;
    }
    x = c.x + (dx / d) * rr;
    y = c.y + (dy / d) * rr;
  }
  return { x: clamp(x, radius, W - radius), y: clamp(y, radius, H - radius) };
}

// Build a fresh descent: dress the city, drop the hero at its heart, and raise a
// finite host of shades from each keeper-post in staggered waves.
function buildArena(level: LevelDef): PgState {
  const scenery = generateCity(level);
  // Fences hug close neighbours (short walls); pathways span quarters (long lanes).
  const fences = weaveSegments(scenery, level.fenceCount, level.minDist * 0.9, level.minDist * 2.0);
  const pathways = weaveSegments(scenery, level.pathwayCount, level.minDist * 3, level.minDist * 5);
  const hero: Hero = {
    x: W / 2, y: H / 2, vx: 0, vy: 0, hp: HERO_HP, maxHp: HERO_HP, hurt: 0,
  };
  const shades: Shade[] = [];
  const posts = scenery.filter((n) => n.kind === "keeper");
  for (const post of posts) {
    for (let j = 0; j < SHADE_PER_KEEPER; j++) {
      const a = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 44;
      shades.push({
        x: clamp(post.x + Math.cos(a) * r, SHADE_RADIUS, W - SHADE_RADIUS),
        y: clamp(post.y + Math.sin(a) * r, SHADE_RADIUS, H - SHADE_RADIUS),
        vx: 0, vy: 0, hp: SHADE_HP, maxHp: SHADE_HP, dead: false,
        wakeAt: j * SHADE_WAKE_STAGGER, // wave j rises after j staggers
      });
    }
  }
  return {
    level, scenery,
    solids: scenery.filter((n) => OBSTACLE_KINDS.has(n.kind)),
    fences, pathways,
    hero, shades,
    penta: { charge: 0, angle: 0 },
    pulseAcc: 0, elapsed: 0, kills: 0, total: shades.length,
    dwellingsTotal: scenery.filter((n) => n.kind === "dwelling").length,
    litCount: 0,
    phase: "fight",
  };
}

const freshPg = buildArena; // alias, mirrors app.ts freshGame naming

// ---------- Combat simulation (pure, headless-testable) ----------

function aliveShades(s: PgState): number {
  let n = 0;
  for (const e of s.shades) if (!e.dead) n++;
  return n;
}

function clearedPct(s: PgState): number {
  return s.total ? s.kills / s.total : 1;
}

// Risen shades chase the hero, separating from one another so a crowd swarms
// instead of stacking into one point.
function stepShades(s: PgState, dt: number): void {
  const h = s.hero;
  for (const e of s.shades) {
    if (e.dead || s.elapsed < e.wakeAt) continue;
    let sx = h.x - e.x, sy = h.y - e.y;
    const d = Math.hypot(sx, sy) || 1;
    sx /= d; sy /= d;
    for (const o of s.shades) {
      if (o === e || o.dead || s.elapsed < o.wakeAt) continue;
      const ox = e.x - o.x, oy = e.y - o.y;
      const od = Math.hypot(ox, oy);
      if (od > 0 && od < SHADE_SEP) { sx += (ox / od) * 0.7; sy += (oy / od) * 0.7; }
    }
    const m = Math.hypot(sx, sy) || 1;
    e.vx = (sx / m) * SHADE_SPEED;
    e.vy = (sy / m) * SHADE_SPEED;
    const p = pushOut(s, e.x + (e.vx * dt) / 1000, e.y + (e.vy * dt) / 1000, SHADE_RADIUS);
    e.x = p.x; e.y = p.y;
  }
}

// The pentagram pulses on its own clock: every PENTA_PULSE_MS it burns every
// risen shade within its ring for PENTA_DMG scaled by how fully it is inscribed,
// and kindles any dark dwelling the ring has caught (mending the hero a little).
function stepPentagram(s: PgState, dt: number): void {
  s.pulseAcc += dt;
  while (s.pulseAcc >= PENTA_PULSE_MS) {
    s.pulseAcc -= PENTA_PULSE_MS;
    if (s.penta.charge <= 0) continue;
    const r2 = PENTA_RADIUS ** 2;
    const dmg = PENTA_DMG * s.penta.charge;
    for (const e of s.shades) {
      if (e.dead || s.elapsed < e.wakeAt) continue;
      if ((e.x - s.hero.x) ** 2 + (e.y - s.hero.y) ** 2 <= r2) {
        e.hp -= dmg;
        if (e.hp <= 0) { e.dead = true; s.kills++; }
      }
    }
    for (const n of s.scenery) {
      if (n.kind !== "dwelling" || n.lit) continue;
      if ((n.x - s.hero.x) ** 2 + (n.y - s.hero.y) ** 2 <= r2) {
        n.lit = true;
        s.litCount++;
        s.hero.hp = Math.min(s.hero.maxHp, s.hero.hp + DWELLING_HEAL);
      }
    }
  }
}

// One slice of combat time, analogous to app.ts's stepCity: integrate the hero
// from the input vector, inscribe-or-fade the sigil, move the shades, pulse the
// pentagram, resolve contact, and check the terminal states.
function stepCombat(s: PgState, dt: number, move: Move): void {
  if (s.phase !== "fight") return;
  s.elapsed += dt;
  const h = s.hero;

  // Travelling along a cleared pathway runs the hero swift; off it, normal pace.
  const onPath = s.pathways.some(
    (p) => closestOnSegment(h.x, h.y, p.x1, p.y1, p.x2, p.y2).d <= PATHWAY_HALF,
  );
  const speed = HERO_SPEED * (onPath ? PATHWAY_BOOST : 1);
  h.vx = move.x * speed;
  h.vy = move.y * speed;
  {
    const p = pushOut(s, h.x + (h.vx * dt) / 1000, h.y + (h.vy * dt) / 1000, HERO_RADIUS);
    h.x = p.x; h.y = p.y;
  }
  if (h.hurt > 0) h.hurt = Math.max(0, h.hurt - dt);

  // Stand still and the sigil inscribes itself; move and it fades.
  if (Math.hypot(h.vx, h.vy) < HERO_STILL_MAXSPEED) {
    s.penta.charge = Math.min(1, s.penta.charge + dt / PENTA_CHARGE_MS);
  } else {
    s.penta.charge = Math.max(0, s.penta.charge - dt / PENTA_CHARGE_MS);
  }
  s.penta.angle = (s.penta.angle + dt * PENTA_SPIN) % 360;

  stepShades(s, dt);
  stepPentagram(s, dt);

  // Contact: a risen shade on the hero, outside i-frames, bites and is shoved off.
  if (h.hurt <= 0) {
    const reach = (HERO_RADIUS + SHADE_RADIUS) ** 2;
    for (const e of s.shades) {
      if (e.dead || s.elapsed < e.wakeAt) continue;
      if ((e.x - h.x) ** 2 + (e.y - h.y) ** 2 <= reach) {
        h.hp -= SHADE_CONTACT_DMG;
        h.hurt = HERO_IFRAMES_MS;
        const dx = h.x - e.x, dy = h.y - e.y;
        const d = Math.hypot(dx, dy) || 1;
        const p = pushOut(s, h.x + (dx / d) * HERO_KNOCKBACK, h.y + (dy / d) * HERO_KNOCKBACK, HERO_RADIUS);
        h.x = p.x; h.y = p.y;
        break; // one blow per slice; i-frames cover the rest of the swarm
      }
    }
  }

  if (h.hp <= 0) { h.hp = 0; s.phase = "lost"; }
  else if (s.shades.every((e) => e.dead)) { s.phase = "won"; }
}

// ---------- Sprites (reused from app.ts) ----------

const svgNS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const LOW_FX = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

// The base sprites this spinoff draws. Scenery uses the dark dwelling/conduit/
// press/shrine art; the hero is the player-lantern; the shades are the Keepers.
const SPRITE_NAMES = [
  "ground", "dwelling-dark", "dwelling-lit", "conduit", "press", "shrine",
  "keeper-node", "keeper-patrol", "player-lantern",
] as const;

// Which sprites a city may re-skin (art/<cityId>/<name>.png) — the built world.
const CITY_SPRITES = new Set<string>([
  "ground", "dwelling-dark", "dwelling-lit", "conduit", "press", "shrine",
]);

const sprites = new Set<string>();
const probedCities = new Set<string>();

function loadSprites(onChange: () => void): void {
  if (typeof Image === "undefined") return; // headless harness
  for (const name of SPRITE_NAMES) {
    const img = new Image();
    img.onload = () => { sprites.add(name); onChange(); };
    img.src = `art/${name}.png`;
  }
}

function loadCitySprites(cityId: string, onChange: () => void): void {
  if (typeof Image === "undefined" || probedCities.has(cityId)) return;
  probedCities.add(cityId);
  for (const name of CITY_SPRITES) {
    const img = new Image();
    img.onload = () => { sprites.add(`${cityId}/${name}`); onChange(); };
    img.src = `art/${cityId}/${name}.png`;
  }
}

function spriteFor(level: LevelDef, name: string): string | null {
  if (CITY_SPRITES.has(name)) {
    const ck = `${level.id}/${name}`;
    if (sprites.has(ck)) return ck;
  }
  return sprites.has(name) ? name : null;
}

function spriteImage(
  key: string, x: number, y: number, size: number, opacity: number,
): SVGImageElement {
  return el("image", {
    href: `art/${key}.png`,
    x: x - size / 2, y: y - size / 2, width: size, height: size,
    opacity, mask: "url(#spriteFade)",
  });
}

// ---------- Render (reads PgState; wholesale rebuild each frame) ----------

// Built once: filters/gradients + the camera group. Adds the infernal #penta
// palette on top of the parent game's warm/cold/glow defs.
function scaffold(svg: SVGSVGElement): SVGGElement {
  svg.innerHTML = "";
  const defs = el("defs", {});
  defs.innerHTML = `
    <filter id="glow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="3.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="bloom" x="-200%" y="-200%" width="500%" height="500%">
      <feGaussianBlur stdDeviation="11"/>
    </filter>
    <radialGradient id="haloAwake">
      <stop offset="0%" stop-color="#fff3d2" stop-opacity="1"/>
      <stop offset="28%" stop-color="#ffd87a" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ffd87a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="penta">
      <stop offset="0%" stop-color="#ffd9a0" stop-opacity="0.35"/>
      <stop offset="48%" stop-color="#ff6a3c" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ff3a1c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="spriteFadeGrad">
      <stop offset="0%" stop-color="#fff"/>
      <stop offset="58%" stop-color="#fff"/>
      <stop offset="98%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <mask id="spriteFade" maskContentUnits="objectBoundingBox">
      <circle cx="0.5" cy="0.5" r="0.5" fill="url(#spriteFadeGrad)"/>
    </mask>
    <pattern id="groundPat" patternUnits="userSpaceOnUse" width="512" height="512">
      <image href="art/ground.png" width="512" height="512"/>
    </pattern>`;
  svg.appendChild(defs);
  const cam = el("g", {});
  svg.appendChild(cam);
  return cam;
}

// The {5/2} star polygon inscribed in a circle of radius r, rotated by rotDeg.
function pentagramPath(cx: number, cy: number, r: number, rotDeg: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + rotDeg + i * 72) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const order = [0, 2, 4, 1, 3];
  let d = "";
  order.forEach((idx, i) => {
    d += `${i === 0 ? "M" : "L"}${pts[idx][0].toFixed(1)} ${pts[idx][1].toFixed(1)} `;
  });
  return d + "Z";
}

const SCENERY_SPRITE: Record<NodeKind, string> = {
  dwelling: "dwelling-dark", conduit: "conduit", press: "press",
  shrine: "shrine", keeper: "keeper-node",
};
const SCENERY_SIZE: Record<NodeKind, number> = {
  dwelling: 46, conduit: 40, press: 56, shrine: 50, keeper: 0,
};

function render(s: PgState, layer: SVGGElement): void {
  layer.innerHTML = "";

  // Ground — the city's tiled floor (or solid gloom if the art isn't loaded).
  const hasGround = sprites.has("ground");
  layer.appendChild(el("rect", {
    x: 0, y: 0, width: W, height: H,
    fill: hasGround ? "url(#groundPat)" : "#0a0c16", opacity: hasGround ? 0.5 : 1,
  }));

  // Pathways — open lanes drawn on the ground beneath the built world: a pale
  // worn road with a faint warm centre line, so the swift routes read at a glance.
  for (const p of s.pathways) {
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#2a2a1c", "stroke-width": PATHWAY_HALF * 2,
      "stroke-linecap": "round", opacity: 0.45,
    }));
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#6a5a30", "stroke-width": 3,
      "stroke-linecap": "round", "stroke-dasharray": "10 14", opacity: 0.4,
    }));
  }

  // Scenery — the built world, drawn dark for the Diablo gloom. Keeper-posts are
  // spawn-points, not scenery, so they aren't drawn here. Solid structures (press,
  // shrine) draw full-opacity with a faint ring so they read as blockers; a lit
  // dwelling glows with a warm halo.
  for (const n of s.scenery) {
    if (n.kind === "keeper") continue;
    const solid = OBSTACLE_KINDS.has(n.kind);
    if (n.kind === "dwelling" && n.lit) {
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: 30, fill: "url(#haloAwake)", opacity: 0.7 }));
    }
    const spriteName = n.kind === "dwelling" && n.lit ? "dwelling-lit" : SCENERY_SPRITE[n.kind];
    const key = spriteFor(s.level, spriteName);
    if (key) {
      layer.appendChild(spriteImage(key, n.x, n.y, SCENERY_SIZE[n.kind], solid ? 1 : 0.5));
    } else {
      layer.appendChild(el("rect", {
        x: n.x - 8, y: n.y - 8, width: 16, height: 16, rx: 2,
        fill: n.lit ? "#3a2a14" : "#161a2c",
        stroke: solid ? "#3a3050" : n.lit ? "#ffd87a" : "#222842",
        "stroke-width": 1, opacity: solid ? 0.95 : 0.7,
      }));
    }
    if (solid) {
      layer.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: (OBSTACLE_RADIUS[n.kind] || 0),
        fill: "none", stroke: "#3a3050", "stroke-width": 1.5, opacity: 0.4,
      }));
    }
  }

  // Fences — low walls strung between posts, drawn over the ground/scenery as a
  // stout dark bar with a lighter top edge so they read as solid blockers.
  for (const f of s.fences) {
    layer.appendChild(el("line", {
      x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
      stroke: "#15101f", "stroke-width": FENCE_HALF * 2,
      "stroke-linecap": "round", opacity: 0.92,
    }));
    layer.appendChild(el("line", {
      x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
      stroke: "#4a3f63", "stroke-width": 2.5,
      "stroke-linecap": "round", opacity: 0.7,
    }));
  }

  // The pentagram — the only procedural art. Scales and brightens with charge,
  // turns slowly, and burns through a soft glow.
  const h = s.hero;
  if (s.penta.charge > 0) {
    const r = PENTA_RADIUS * (0.7 + 0.3 * s.penta.charge);
    const op = 0.25 + 0.65 * s.penta.charge;
    layer.appendChild(el("circle", { cx: h.x, cy: h.y, r, fill: "url(#penta)", opacity: op * 0.6 }));
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r, fill: "none", stroke: "#ff6a3c", "stroke-width": 2,
      opacity: op, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
    layer.appendChild(el("path", {
      d: pentagramPath(h.x, h.y, r * 0.92, s.penta.angle),
      fill: "none", stroke: "#ffd87a", "stroke-width": 2.6, "stroke-linejoin": "round",
      opacity: op, filter: "url(#glow)",
    }));
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: r * 0.92, fill: "none", stroke: "#ff8a4c",
      "stroke-width": 1, opacity: op * 0.7,
    }));
  }

  // Shades — Keepers risen. Risen ones draw full; not-yet-woken lurk faint.
  const shadeKey = sprites.has("keeper-patrol")
    ? "keeper-patrol" : sprites.has("keeper-node") ? "keeper-node" : null;
  for (const e of s.shades) {
    if (e.dead) continue;
    const op = s.elapsed >= e.wakeAt ? 1 : 0.3;
    if (shadeKey) {
      layer.appendChild(spriteImage(shadeKey, e.x, e.y, 44, op));
    } else {
      const q = SHADE_RADIUS * 1.4;
      layer.appendChild(el("rect", {
        x: e.x - q / 2, y: e.y - q / 2, width: q, height: q,
        transform: `rotate(45 ${e.x} ${e.y})`,
        fill: "#1b2740", stroke: "#9fc4e8", "stroke-width": 2, opacity: op,
      }));
    }
    if (op === 1 && e.hp < e.maxHp) {
      const bw = 30, frac = Math.max(0, e.hp / e.maxHp);
      const by = e.y - SHADE_RADIUS - 11;
      layer.appendChild(el("rect", { x: e.x - bw / 2, y: by, width: bw, height: 3, fill: "#2a0c0c", opacity: 0.85 }));
      layer.appendChild(el("rect", { x: e.x - bw / 2, y: by, width: bw * frac, height: 3, fill: "#ff6a3c", opacity: 0.95 }));
    }
  }

  // The hero, drawn last over everything (copied from app.ts's avatar block).
  layer.appendChild(el("circle", { cx: h.x, cy: h.y, r: 30, fill: "url(#haloAwake)", opacity: 0.9 }));
  if (sprites.has("player-lantern")) {
    layer.appendChild(spriteImage("player-lantern", h.x, h.y, 46, 1));
  } else {
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: HERO_RADIUS, fill: "#fff3d2",
      stroke: "#ffe9b0", "stroke-width": 2, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: HERO_RADIUS, fill: "#fff3d2", stroke: "#ffe9b0", "stroke-width": 2,
    }));
  }
  if (h.hurt > 0) {
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: HERO_RADIUS + 6, fill: "none",
      stroke: "#ff6b6b", "stroke-width": 2.5, opacity: 0.8,
    }));
  }
}

// ---------- Legacy (cross-run record, in its own key) ----------

interface PgLegacy {
  runs: number; clears: number; best: Record<string, number>;
  dwellingsLit: number; // lifetime dwellings kindled across all descents
}

function emptyPgLegacy(): PgLegacy { return { runs: 0, clears: 0, best: {}, dwellingsLit: 0 }; }

function loadPgLegacy(): PgLegacy {
  try {
    const raw = localStorage.getItem(PG_LEGACY_KEY);
    if (!raw) return emptyPgLegacy();
    const l = JSON.parse(raw) as Partial<PgLegacy>;
    return {
      runs: l.runs || 0, clears: l.clears || 0, best: l.best || {},
      dwellingsLit: l.dwellingsLit || 0,
    };
  } catch { return emptyPgLegacy(); }
}

function savePgLegacy(l: PgLegacy): void {
  try { localStorage.setItem(PG_LEGACY_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

function recordClear(level: LevelDef, ms: number, lit = 0): PgLegacy {
  const l = loadPgLegacy();
  l.runs++; l.clears++;
  l.dwellingsLit += lit;
  if (!l.best[level.id] || ms < l.best[level.id]) l.best[level.id] = ms;
  savePgLegacy(l);
  return l;
}

function recordDeath(lit = 0): PgLegacy {
  const l = loadPgLegacy();
  l.runs++;
  l.dwellingsLit += lit;
  savePgLegacy(l);
  return l;
}

// ---------- Game shell ----------

function byId(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing element #${id}`);
  return e;
}

function fmtTime(ms: number): string {
  return (ms / 1000).toFixed(1) + "s";
}

function start(): void {
  const svg = byId("city") as unknown as SVGSVGElement;
  const overlay = byId("overlay");
  const ovTitle = byId("ov-title");
  const ovBody = byId("ov-body");
  const ovBtn = byId("ov-btn") as HTMLButtonElement;
  const ovBtn2 = byId("ov-btn2") as HTMLButtonElement;
  const hpFill = byId("hp");
  const foesEl = byId("foes");
  const lightsEl = byId("lights");
  const cityEl = byId("cityname");
  const toastEl = byId("toast");
  const stickEl = byId("stick");
  const stickKnob = byId("stick-knob");

  const layer = scaffold(svg);
  let s: PgState | null = null;

  // ----- Camera: follows the hero; pinch / wheel zoom. -----
  const cam = { x: 0, y: 0, k: 1 };
  let minK = 0.4, maxK = 2.4;
  function applyCam(): void {
    layer.setAttribute("transform", `translate(${cam.x} ${cam.y}) scale(${cam.k})`);
  }
  function clampCam(): void {
    const vw = svg.clientWidth, vh = svg.clientHeight;
    cam.k = Math.min(maxK, Math.max(minK, cam.k));
    const mw = W * cam.k, mh = H * cam.k;
    cam.x = mw <= vw ? (vw - mw) / 2 : Math.min(0, Math.max(vw - mw, cam.x));
    cam.y = mh <= vh ? (vh - mh) / 2 : Math.min(0, Math.max(vh - mh, cam.y));
  }
  function setupZoom(): void {
    const vw = svg.clientWidth, vh = svg.clientHeight, m = Math.min(vw, vh);
    minK = m / 1000;          // zoomed out: most of the city visible
    maxK = Math.max(1.6, m / 320);
    cam.k = Math.min(maxK, Math.max(minK, m / 640)); // ~640 world units across
  }
  function centerCam(wx: number, wy: number): void {
    const vw = svg.clientWidth, vh = svg.clientHeight;
    cam.x = vw / 2 - wx * cam.k;
    cam.y = vh / 2 - wy * cam.k;
    clampCam();
    applyCam();
  }

  // ----- Input: a floating joystick (touch) + WASD/arrows (desktop). -----
  const STICK_MAX = 60;
  const move: Move = { x: 0, y: 0 };
  const keys = new Set<string>();
  const pointers = new Map<number, { x: number; y: number }>();
  let stick: { id: number; ox: number; oy: number } | null = null;
  let pinch: { d: number; k: number } | null = null;

  function showStick(sx: number, sy: number): void {
    stickEl.style.left = sx + "px";
    stickEl.style.top = sy + "px";
    stickEl.style.display = "block";
    stickKnob.style.transform = "translate(-50%, -50%)";
  }
  function moveKnob(dx: number, dy: number): void {
    const mag = Math.hypot(dx, dy);
    const r = mag ? Math.min(STICK_MAX, mag) / mag : 0;
    stickKnob.style.transform = `translate(calc(-50% + ${dx * r}px), calc(-50% + ${dy * r}px))`;
  }
  function hideStick(): void { stickEl.style.display = "none"; }

  svg.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      move.x = 0; move.y = 0;
      showStick(e.clientX, e.clientY);
    } else {
      stick = null;
      hideStick();
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, k: cam.k };
      }
    }
  });
  svg.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1 && stick && stick.id === e.pointerId) {
      const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
      const mag = Math.hypot(dx, dy);
      const r = mag ? Math.min(1, mag / STICK_MAX) : 0;
      move.x = mag ? (dx / mag) * r : 0;
      move.y = mag ? (dy / mag) * r : 0;
      moveKnob(dx, dy);
    }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      cam.k = Math.min(maxK, Math.max(minK, pinch.k * (d / pinch.d)));
      if (s) centerCam(s.hero.x, s.hero.y); else { clampCam(); applyCam(); }
    }
  });
  function endPointer(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (stick && stick.id === e.pointerId) {
      stick = null; move.x = 0; move.y = 0; hideStick();
    }
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.k = Math.min(maxK, Math.max(minK, cam.k * Math.exp(-e.deltaY * 0.0015)));
    if (s) centerCam(s.hero.x, s.hero.y); else { clampCam(); applyCam(); }
  }, { passive: false });

  const MOVE_KEYS = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (MOVE_KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
  });
  window.addEventListener("keyup", (e) => { keys.delete(e.key.toLowerCase()); });
  window.addEventListener("blur", () => keys.clear());
  window.addEventListener("resize", () => {
    setupZoom();
    if (s) centerCam(s.hero.x, s.hero.y); else { clampCam(); applyCam(); }
  });

  // ----- Repaint -----
  let pendingFrame = false;
  function repaint(): void {
    if (pendingFrame) return;
    pendingFrame = true;
    requestAnimationFrame(() => { pendingFrame = false; if (s) render(s, layer); });
  }
  loadSprites(repaint);

  function hud(): void {
    if (!s) return;
    hpFill.style.width = Math.max(0, (s.hero.hp / s.hero.maxHp) * 100) + "%";
    foesEl.textContent = `${aliveShades(s)} / ${s.total} shades`;
    lightsEl.textContent = `${s.litCount} / ${s.dwellingsTotal} lit`;
    cityEl.textContent = s.level.name;
  }

  // ----- Overlays -----
  function showOverlay(
    title: string, body: string,
    btnText: string, onBtn: () => void,
    btn2Text?: string, onBtn2?: () => void,
  ): void {
    ovTitle.textContent = title;
    ovBody.innerHTML = body;
    ovBtn.textContent = btnText;
    ovBtn.style.display = "";
    ovBtn.onclick = onBtn;
    if (btn2Text && onBtn2) {
      ovBtn2.textContent = btn2Text;
      ovBtn2.style.display = "";
      ovBtn2.onclick = onBtn2;
    } else {
      ovBtn2.style.display = "none";
    }
    overlay.classList.remove("hidden");
  }
  function hideOverlay(): void { overlay.classList.add("hidden"); }

  function showToast(text: string): void {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    window.setTimeout(() => toastEl.classList.remove("show"), 3200);
  }

  // ----- The descent loop -----
  let lastFrame = 0;
  let running = false;
  function pgFrame(now: number): void {
    if (!running || !s) return;
    if (!lastFrame) lastFrame = now;
    let dt = now - lastFrame; lastFrame = now;
    if (dt > 100) dt = 100; // a backgrounded tab must not lurch the fight forward

    if (!stick) {
      let mx = 0, my = 0;
      if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
      if (keys.has("d") || keys.has("arrowright")) mx += 1;
      if (keys.has("w") || keys.has("arrowup")) my -= 1;
      if (keys.has("s") || keys.has("arrowdown")) my += 1;
      const m = Math.hypot(mx, my);
      move.x = m ? mx / m : 0;
      move.y = m ? my / m : 0;
    }

    stepCombat(s, dt, move);
    centerCam(s.hero.x, s.hero.y);
    render(s, layer);
    hud();

    if (s.phase === "won") { running = false; onWin(); return; }
    if (s.phase === "lost") { running = false; onLost(); return; }
    requestAnimationFrame(pgFrame);
  }

  function startCity(level: LevelDef): void {
    s = buildArena(level);
    loadCitySprites(level.id, repaint);
    hideOverlay();
    setupZoom();
    centerCam(s.hero.x, s.hero.y);
    hud();
    showToast("Stand still to inscribe the pentagram. Move to dodge — weave around presses, shrines and fences, run the pathways to kite the swarm, and light the dark dwellings.");
    running = true; lastFrame = 0;
    requestAnimationFrame(pgFrame);
  }

  function onWin(): void {
    if (!s) return;
    const ms = s.elapsed;
    const lit = s.litCount, total = s.dwellingsTotal;
    const l = recordClear(s.level, ms, lit);
    const best = l.best[s.level.id];
    const relit = lit >= total && total > 0
      ? `You relit every dwelling — <em>${total}</em>. The city is whole again.`
      : `You relit <em>${lit}</em> of ${total} dwellings.`;
    showOverlay(
      "The city is cleansed",
      `Every shade in <em>${s.level.name}</em> is undone — ${s.total} of them, ` +
      `in <em>${fmtTime(ms)}</em>.<br><br>` +
      `${relit}<br><br>` +
      (best === ms ? `<em>A new best for this city.</em>` : `Best here: ${fmtTime(best)}.`),
      "Descend again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function onLost(): void {
    if (!s) return;
    recordDeath(s.litCount);
    showOverlay(
      "You fell",
      `The watch of <em>${s.level.name}</em> pulled you down with ` +
      `<em>${aliveShades(s)}</em> shades still standing.<br><br>` +
      `You had relit <em>${s.litCount}</em> of ${s.dwellingsTotal} dwellings.<br><br>` +
      `<em>The dark is patient. Descend again.</em>`,
      "Try again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function showPicker(): void {
    s = null; running = false;
    const l = loadPgLegacy();
    let html =
      `<p class="lede">Choose a city to descend into. Stand still to inscribe a ` +
      `pentagram that burns the shades around you; move to dodge their touch and ` +
      `weave around the solid presses, shrines and fences. Run the pathways to outpace ` +
      `the swarm, and catch a dark dwelling in the ring to light it and mend yourself. ` +
      `Clear every shade and the city is cleansed.</p><div class="cities">`;
    for (const lv of LEVELS) {
      const done = l.best[lv.id];
      const mark = done ? ` <span class="legacy-new">cleansed ${fmtTime(done)}</span>` : "";
      html +=
        `<button class="city" data-id="${lv.id}">` +
        `<span class="city-name">${lv.name}${mark}</span>` +
        `<span class="city-line">${lv.epigraph}</span></button>`;
    }
    html += `</div>`;
    if (l.runs > 0) {
      html +=
        `<div class="legacy"><div class="legacy-head">Your descents</div><dl>` +
        `<div><dt>Descents</dt><dd>${l.runs}</dd></div>` +
        `<div><dt>Cities cleansed</dt><dd>${l.clears}</dd></div>` +
        `<div><dt>Dwellings relit</dt><dd>${l.dwellingsLit}</dd></div></dl></div>`;
    }
    showOverlay("The Burning Vigil", html, "", () => {});
    ovBtn.style.display = "none";
    ovBtn2.style.display = "none";
    overlay.querySelectorAll<HTMLButtonElement>(".city").forEach((b) => {
      b.onclick = () => {
        const lv = levelById(b.dataset.id || "");
        if (lv) startCity(lv);
      };
    });
  }

  byId("reset").addEventListener("click", () => showPicker());

  setupZoom();
  clampCam();
  applyCam();
  showPicker();
}

// ---------- Service worker registration (offline play) ----------
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((reg) => { reg.update().catch(() => {}); })
      .catch(() => {});
  });
}

// ---------- Test seam ----------
// Mirrors app.ts: a headless harness sets __PG_TEST__ and reads the sim off
// __pg instead of the shell ever starting.
const testGlobal = globalThis as unknown as {
  __PG_TEST__?: boolean;
  __pg?: Record<string, unknown>;
};
if (typeof globalThis !== "undefined" && testGlobal.__PG_TEST__) {
  testGlobal.__pg = {
    generateCity, buildArena, freshPg, stepCombat, stepShades, stepPentagram,
    aliveShades, clearedPct, LEVELS, levelById,
    weaveSegments, closestOnSegment,
    loadPgLegacy, recordClear, recordDeath, emptyPgLegacy,
    K: {
      W, H, HERO_HP, HERO_RADIUS, HERO_STILL_MAXSPEED, HERO_IFRAMES_MS, HERO_SPEED,
      PENTA_RADIUS, PENTA_PULSE_MS, PENTA_DMG, PENTA_CHARGE_MS,
      SHADE_HP, SHADE_RADIUS, SHADE_CONTACT_DMG, SHADE_PER_KEEPER, SHADE_WAKE_STAGGER,
      OBSTACLE_RADIUS, DWELLING_HEAL, FENCE_HALF, PATHWAY_HALF, PATHWAY_BOOST,
    },
  };
} else {
  start();
}

// This trailing export makes pentagram.ts a *module* (its top-level names are
// module-scoped), so it can be compiled in the same project as app.ts — which is
// a classic global script — without their identically-named declarations (W, el,
// render, start, LEVELS, …) colliding in the global scope. The page loads it with
// <script type="module">; the test loads it via dynamic import().
export {};
