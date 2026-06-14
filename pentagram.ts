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
// "boss" is the turn-based finger-traced duel that follows clearing the host.
type Phase = "fight" | "boss" | "won" | "lost";

// A shade lurks (wanders) around its post until the hero comes near, then gives
// chase. Aggro is sticky — once roused it never settles back to wandering.
type ShadeState = "wander" | "chase";

// A pentagram type's signature power. The default sigil has "none".
type PentaPower = "none" | "chain" | "scorch" | "nova";

// One unlockable sigil. A stat lean (multipliers over the base PENTA_* tuning)
// plus one signature power; `cost` is the embers to unlock it (0 = always owned).
interface PentaType {
  id: string; name: string; desc: string; cost: number;
  radiusMul: number; chargeMul: number; pulseMul: number; dmgMul: number;
  power: PentaPower;
  ring: string;  // signature glow/ring hue — each sigil reads at a glance
  star: string;  // the star polygon's stroke hue
}

// A scorched patch of ground the Quick Ember leaves behind — burns shades that
// stand on it until it cools. Live-play terrain, never persisted.
interface Scorch { x: number; y: number; until: number }

// A veil pool — a drifting patch of the old dark. Standing in one doesn't
// inscribe the sigil; it UNRAVELS it (charge bleeds away faster than a normal
// fade), so a still hero must pick clean ground. Woven at build from the city's
// veilCount, drifts on its own and bounces off the world's edge. Live-play
// terrain — never persisted.
interface Veil { x: number; y: number; vx: number; vy: number; r: number }

// An ember mote — a spark a slain shade may leave behind. Walk over it to gather
// it: the sigil snaps to full and a brief surge bites harder. Fades if left.
// Live-play, never persisted.
interface Mote { x: number; y: number; until: number }

// Transient signature effects, drawn then faded — never persisted (no mid-combat
// save anyway). An Arc is the Pyre's chain spark hopping from a kill to a nearby
// shade; a Nova is the Wrath's expanding eruption ring on a full inscription.
interface Arc { x1: number; y1: number; x2: number; y2: number; until: number }
interface Nova { x: number; y: number; r: number; until: number }

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
  state: ShadeState;   // wanders its post until the hero is near, then chases
  wanderAngle: number; // current drift heading, radians
  wanderTimer: number; // ms until it re-rolls a wander heading
  homeX: number; homeY: number; // its keeper-post anchor (the leash centre)
  hit: number;         // s.elapsed time until which it flashes from a fresh blow (0 = none)
  elite?: boolean;     // a champion: more hp, bites harder, and begins veil-shielded
  shielded?: boolean;  // while true it takes no damage — only a FULL-charge pulse breaks it
}

interface Penta {
  charge: number; // 0..1 — how fully the sigil is inscribed (ramps while still)
  angle: number;  // current rotation, degrees (cosmetic)
}

// The Veilwarden — the city's master Keeper, risen for the turn-based duel after
// the host falls. There is no kiting here: the warden's GOETIC SEAL glows over it
// and the carrier TRACES it with a finger to bind and burn it. Each city's warden
// has its own seal (a unique line-glyph, like the seals of the Ars Goetia),
// generated deterministically from the city id — so it rebuilds identically and
// reads as that warden's true name. A clean, complete trace bites deep; a sloppy
// one barely marks it. The warden snuffs on a cadence, draining the carrier's
// flame, so the duel is a race. (A first cut — see the BOSS_* / SEAL_* tuning.)

// A warden's seal — a Goetia-style occult sigil. `spine` is the connected line
// you trace (an open polyline, the glyph's stroke); the rest is decorative
// flourish (containment ring, terminal nodes, a cross-bar) that reads as a seal
// but isn't scored — only the spine is, mirroring how the pentagram's inner
// circle was never part of the trace.
interface Sigil {
  cx: number; cy: number; r: number;       // containment circle, world space
  spine: { x: number; y: number }[];       // the ordered line to trace (scored)
  terminals: { x: number; y: number }[];   // small circles at notable points
  bars: Segment[];                          // short cross-bars (a Goetic ending)
}

interface BossState {
  hp: number; maxHp: number;
  biteAcc: number;      // ms accumulated toward the next snuff (the warden's bite)
  cx: number; cy: number; r: number; // the seal's centre + reach, in world space
  seal: Sigil;          // this warden's unique Goetic seal (the thing you trace)
  lastQuality: number;  // 0..1 of the most recent trace (for the toast/flash)
  flash: number;        // s.elapsed time until which it flares from a fresh trace
}

interface PgState {
  level: LevelDef;
  w: number; h: number;  // this arena's world size (W/H scaled by level.sizeScale)
  scenery: ArenaNode[];
  solids: ArenaNode[];   // scenery the hero/shades can't pass (presses, shrines)
  fences: Segment[];     // low walls the hero/shades must weave around
  pathways: Segment[];   // open lanes the hero runs swift along
  hero: Hero;
  shades: Shade[];
  penta: Penta;
  type: PentaType;       // the equipped sigil (resolved from the legacy at build)
  fxRadius: number;      // effective PENTA_* values = base × the type's muls
  fxCharge: number;
  fxPulse: number;
  fxDmg: number;
  scorch: Scorch[];      // lingering burnt ground (Quick Ember power)
  veils: Veil[];         // drifting dark pools that unravel the sigil if stood in
  motes: Mote[];         // gatherable ember sparks dropped by slain shades
  surgeUntil: number;    // s.elapsed time the gathered-ember damage surge lasts to
  arcs: Arc[];           // fading chain sparks (Pyre power) — purely cosmetic
  novas: Nova[];         // fading eruption rings (Wrath power) — purely cosmetic
  novaFired: boolean;    // has the Wrath's nova fired for this charge-up
  pulseAcc: number; // ms accumulated toward the next damage pulse
  elapsed: number;  // ms since the descent began (clear time)
  kills: number;
  hits: number;         // times a shade has landed a blow (flawless-clear bonus)
  total: number;        // the finite host: clear them all to win
  dwellingsTotal: number; // dark dwellings the city began with
  litCount: number;     // how many the sigil has kindled (secondary objective)
  phase: Phase;
  boss?: BossState;     // the Veilwarden, raised once the host is cleared
}

interface Move { x: number; y: number } // normalized input vector, -1..1 each

// ---------- Tuning ----------
// The design surface. Balance changes should be constant changes here, the same
// ethos as app.ts's tuning block.

// Base arena size. A descent enlarges this by its city's `sizeScale`, so the
// host is spread across a place you sweep rather than a single corridor rush.
const W = 1500;
const H = 2000;

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

// Aggro & wander. A shade lurks near its post until the hero comes within
// AGGRO_RADIUS, then chases — and never settles again (sticky). Until roused it
// drifts on its own, kept near home by the leash, so the city feels inhabited
// rather than rushing you all at once from spawn.
const AGGRO_RADIUS = 360;        // hero within this of a wanderer rouses it to chase
const SHADE_WANDER_SPEED = 38;   // idle drift, units/s (≈1/3 chase speed)
const SHADE_WANDER_RETARGET_MS = 1400; // re-roll a wander heading this often
const SHADE_LEASH = 240;         // a wanderer steers home if it drifts past this
const CLEANUP_AGGRO_FRAC = 0.2;  // once this few remain, all rouse so a clear always ends

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

// Elite shades — one champion may rise at a keeper-post (per the city's
// eliteCount). It carries far more hp, bites harder, and begins veil-SHIELDED:
// while shielded it shrugs off every source, and only a FULL-charge pulse shatters
// the shield. So you can't feather an elite down — you must hold for a full
// inscription. Once broken it fights as any other shade.
const ELITE_HP_MUL = 2.6;        // a champion's hp over a common shade
const ELITE_CONTACT_DMG = 16;    // hero HP lost per elite touch (vs SHADE_CONTACT_DMG)

// Veil pools — drifting patches of the old dark. A still hero standing in one
// doesn't inscribe; the sigil UNRAVELS, charge bleeding away this much faster
// than a normal moving fade. They wander slowly and bounce off the world edge.
const VEIL_RADIUS = 88;          // a pool's reach
const VEIL_DRIFT = 26;           // units/s a pool wanders
const VEIL_DRAIN_MUL = 2.4;      // charge bleeds this much faster while stood in a pool

// Ember motes — a slain shade may leave a gatherable spark. Walk over it and the
// sigil snaps to full and a brief surge multiplies pulse damage. Left alone it fades.
const MOTE_DROP_CHANCE = 0.22;   // fraction of kills that leave a mote
const MOTE_TTL_MS = 6000;        // how long a mote waits to be gathered
const MOTE_RADIUS = 16;          // gather reach (over and above the hero's radius)
const MOTE_SURGE_MS = 2600;      // how long the gathered surge lasts
const MOTE_SURGE_DMG = 1.6;      // pulse-damage multiplier while surging

// Dwellings — a dark one caught in the charged sigil kindles alight, mending the
// hero. Relighting the city is a vigil kept alongside the killing (not a win gate).
const DWELLING_HEAL = 8;         // hero HP restored per dwelling kindled (clamped)

// Scoring — a clear banks a score (and embers, the unlock currency). Tuned for
// relationships, not magnitudes: faster pays, a relit/unscathed city pays, and a
// harder city multiplies it all. These are the design surface for the economy.
const SCORE_PER_SHADE = 100;     // base, per shade in the host
const SCORE_TARGET_PER_SHADE = 1800; // ms per shade you're "expected" to take
const SCORE_SPEED_PER_SEC = 20;  // points per second cleared under that target
const SCORE_DWELLINGS_MAX = 300; // full points for a fully-relit city
const SCORE_SURVIVAL_MAX = 200;  // full points for full HP at the clear
const SCORE_UNTOUCHED = 250;     // flawless bonus (no blow landed all descent)
const SCORE_EMBERS_DIV = 10;     // embers earned = score / this (min 1)

// Pentagram-power tuning (the signature tricks; see PENTA_TYPES).
const CHAIN_RADIUS = 70;         // Pyre: a kill arcs to other shades within this
const CHAIN_FRAC = 0.6;          // …for this fraction of the sigil's damage
const SCORCH_MS = 1400;          // Quick Ember: how long a burnt patch lingers
const SCORCH_DPS = 26;           // …damage per second to shades standing on it
const SCORCH_RADIUS = 60;        // …reach of a burnt patch
const SCORCH_MAX = 6;            // …cap on simultaneous patches
const NOVA_PUSH = 150;           // Wrath: knockback dealt by a full-charge nova
const ARC_MS = 180;              // Pyre: how long a chain spark stays drawn
const NOVA_FX_MS = 320;          // Wrath: how long the eruption ring expands/fades
const SHADE_HIT_MS = 150;        // how long a shade flashes white from a fresh blow

// The Veilwarden duel (per-city boss). When the host falls, the city's master
// Keeper rises and the fight becomes turn-based: a pentagram template glows over
// the warden and the carrier traces it by finger. traceScore (pure geometry)
// rates the stroke 0..1 — accuracy (how close to the star's edges) × coverage
// (did the whole star get drawn) — and a trace deals that fraction of
// BOSS_TRACE_DMG. Meanwhile the warden snuffs every BOSS_BITE_MS for BOSS_BITE_DMG.
// A first cut; balance is provisional. This is the design surface for the duel.
const BOSS_RING_R = 150;         // world radius of the traceable template
const BOSS_HP = 100;             // base warden health (× the city's difficultyMult)
const BOSS_TRACE_DMG = 40;       // damage a perfect (quality 1) trace deals
const BOSS_BITE_MS = 2600;       // the warden snuffs this often…
const BOSS_BITE_DMG = 12;        // …draining this much hero HP each snuff
const TRACE_TOL_FRAC = 0.2;      // how far off the line (× ring r) still scores
const TRACE_MIN_POINTS = 6;      // a stroke shorter than this can't score
const TRACE_FLASH_MS = 260;      // how long the warden flares from a fresh trace
// The warden's seal (Goetia-style glyph) — shape dials. More nodes = a more
// intricate (harder) seal. The seal is the design surface for the duel's feel.
const SEAL_NODES_MIN = 6;        // fewest spine nodes a seal may have
const SEAL_NODES_MAX = 9;        // most spine nodes a seal may have
const SEAL_INNER_FRAC = 0.62;    // inner nodes sit within this fraction of the ring

const PG_LEGACY_KEY = "pentagram.legacy.v1";

// ---------- Pentagram types (unlockable sigils) ----------
// Each leans the base PENTA_* dials and adds one signature power. "The Vigil" is
// the steady starter (cost 0, always owned). The rest cost embers, banked from
// clears. Tune these here — the roster is the design surface for progression.
const PENTA_TYPES: PentaType[] = [
  {
    id: "vigil", name: "The Vigil", cost: 0,
    desc: "The steady sigil you began with. No lean, no trick — even reach, even bite.",
    radiusMul: 1, chargeMul: 1, pulseMul: 1, dmgMul: 1, power: "none",
    ring: "#ff6a3c", star: "#ffd87a", // the original warm flame
  },
  {
    id: "pyre", name: "The Pyre", cost: 120,
    desc: "A wide, hungry ring that bites harder but inscribes slower. A kill arcs to the shades around it.",
    radiusMul: 1.25, chargeMul: 1.3, pulseMul: 1, dmgMul: 1.15, power: "chain",
    ring: "#ff3a1c", star: "#ffb24a", // deep, hungry red
  },
  {
    id: "ember", name: "The Quick Ember", cost: 160,
    desc: "A tight, fast sigil — short reach, rapid pulses — that leaves scorched ground burning behind you.",
    radiusMul: 0.8, chargeMul: 0.7, pulseMul: 0.7, dmgMul: 0.85, power: "scorch",
    ring: "#ffb347", star: "#fff0b0", // bright, quick amber-white
  },
  {
    id: "wrath", name: "The Wrath", cost: 240,
    desc: "When fully inscribed it erupts, hurling the swarm back in a searing nova.",
    radiusMul: 1.05, chargeMul: 1.1, pulseMul: 1.1, dmgMul: 1, power: "nova",
    ring: "#b46cff", star: "#f0d8ff", // searing violet
  },
];

function pentaTypeById(id: string): PentaType {
  return PENTA_TYPES.find((t) => t.id === id) || PENTA_TYPES[0];
}

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
  veilCount?: number;  // drifting dark pools that unravel the sigil (default 0)
  eliteCount?: number; // keeper-posts whose champion rises veil-shielded (default 0)
  sizeScale?: number;  // arena size = W/H × this (default 1); leans the difficulty
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
    fenceCount: 8, pathwayCount: 6, sizeScale: 0.9, // kept fair: no veils/elites
  },
  {
    id: "ashfold",
    name: "Ashfold",
    epigraph: "Dry tinder that remembers fire. The watch is many and quick to rise.",
    art: "art/city-ashfold.jpg",
    nodeCount: 130, minDist: 64,
    conduitFrac: 0.26, pressCount: 6, shrineCount: 3,
    keeperCount: 7, keeperSpacing: 320,
    fenceCount: 6, pathwayCount: 9, veilCount: 2, eliteCount: 2, sizeScale: 1.0,
  },
  {
    id: "drowned",
    name: "The Drowned Quarter",
    epigraph: "The water took the low streets. Few shades here — but they wake patient and far.",
    art: "art/city-drowned.jpg",
    nodeCount: 104, minDist: 86,
    conduitFrac: 0.10, pressCount: 2, shrineCount: 6,
    keeperCount: 4, keeperSpacing: 420,
    fenceCount: 11, pathwayCount: 3, veilCount: 4, eliteCount: 1, sizeScale: 1.15,
  },
  {
    id: "glassworks",
    name: "The Glassworks",
    epigraph: "Everything here is bright and breaks. The watch is thick and tightly packed.",
    art: "art/city-glassworks.jpg",
    nodeCount: 134, minDist: 66,
    conduitFrac: 0.14, pressCount: 3, shrineCount: 8,
    keeperCount: 9, keeperSpacing: 270,
    fenceCount: 13, pathwayCount: 5, veilCount: 2, eliteCount: 3, sizeScale: 1.0,
  },
  {
    id: "vesper",
    name: "Vesper Row",
    epigraph: "The watch is thickest where the faithful sleep. The hardest descent.",
    art: "art/city-vesper.jpg",
    nodeCount: 124, minDist: 70,
    conduitFrac: 0.08, pressCount: 3, shrineCount: 4,
    keeperCount: 11, keeperSpacing: 250,
    fenceCount: 9, pathwayCount: 4, veilCount: 3, eliteCount: 4, sizeScale: 1.1,
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

function generateCity(
  level: LevelDef,
  w = W * (level.sizeScale ?? 1),
  h = H * (level.sizeScale ?? 1),
): ArenaNode[] {
  const nodes: ArenaNode[] = [];
  let guard = 0;
  while (nodes.length < level.nodeCount && guard++ < 20000) {
    const x = 60 + Math.random() * (w - 120);
    const y = 60 + Math.random() * (h - 120);
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

// Scatter `count` drifting veil pools across the arena, each given a random
// heading. The hero's heart-of-the-city spawn is kept clear so a descent never
// begins mired in the dark. Pure: it only reads the world size.
function weaveVeils(w: number, h: number, count: number): Veil[] {
  const veils: Veil[] = [];
  let guard = 0;
  while (veils.length < count && guard++ < count * 40) {
    const x = 80 + Math.random() * (w - 160);
    const y = 80 + Math.random() * (h - 160);
    if ((x - w / 2) ** 2 + (y - h / 2) ** 2 < (VEIL_RADIUS + 140) ** 2) continue;
    const a = Math.random() * Math.PI * 2;
    veils.push({ x, y, vx: Math.cos(a) * VEIL_DRIFT, vy: Math.sin(a) * VEIL_DRIFT, r: VEIL_RADIUS });
  }
  return veils;
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
  return { x: clamp(x, radius, s.w - radius), y: clamp(y, radius, s.h - radius) };
}

// Build a fresh descent: dress the city, drop the hero at its heart, and raise a
// finite host of shades from each keeper-post in staggered waves.
function buildArena(level: LevelDef): PgState {
  const w = Math.round(W * (level.sizeScale ?? 1));
  const h = Math.round(H * (level.sizeScale ?? 1));
  const scenery = generateCity(level, w, h);
  // Fences hug close neighbours (short walls); pathways span quarters (long lanes).
  const fences = weaveSegments(scenery, level.fenceCount, level.minDist * 0.9, level.minDist * 2.0);
  const pathways = weaveSegments(scenery, level.pathwayCount, level.minDist * 3, level.minDist * 5);
  const hero: Hero = {
    x: w / 2, y: h / 2, vx: 0, vy: 0, hp: HERO_HP, maxHp: HERO_HP, hurt: 0,
  };
  const shades: Shade[] = [];
  const posts = scenery.filter((n) => n.kind === "keeper");
  // The first `eliteCount` posts each raise a shielded champion (its first shade).
  const eliteCount = Math.min(level.eliteCount ?? 0, posts.length);
  posts.forEach((post, pi) => {
    for (let j = 0; j < SHADE_PER_KEEPER; j++) {
      const elite = j === 0 && pi < eliteCount;
      const hp = SHADE_HP * (elite ? ELITE_HP_MUL : 1);
      const a = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 44;
      const x = clamp(post.x + Math.cos(a) * r, SHADE_RADIUS, w - SHADE_RADIUS);
      const y = clamp(post.y + Math.sin(a) * r, SHADE_RADIUS, h - SHADE_RADIUS);
      shades.push({
        x, y, vx: 0, vy: 0, hp, maxHp: hp, dead: false,
        state: "wander",
        wanderAngle: Math.random() * Math.PI * 2,
        wanderTimer: Math.random() * SHADE_WANDER_RETARGET_MS,
        homeX: post.x, homeY: post.y, // the leash centre it drifts around
        hit: 0,
        elite, shielded: elite,
      });
    }
  });
  // Resolve the equipped sigil and bake its stat lean into effective constants.
  const type = pentaTypeById(loadPgLegacy().equipped);
  return {
    level, w, h, scenery,
    solids: scenery.filter((n) => OBSTACLE_KINDS.has(n.kind)),
    fences, pathways,
    hero, shades,
    penta: { charge: 0, angle: 0 },
    type,
    fxRadius: PENTA_RADIUS * type.radiusMul,
    fxCharge: PENTA_CHARGE_MS * type.chargeMul,
    fxPulse: PENTA_PULSE_MS * type.pulseMul,
    fxDmg: PENTA_DMG * type.dmgMul,
    scorch: [], veils: weaveVeils(w, h, level.veilCount ?? 0), motes: [], surgeUntil: 0,
    arcs: [], novas: [], novaFired: false,
    pulseAcc: 0, elapsed: 0, kills: 0, hits: 0, total: shades.length,
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

// How much a city multiplies a clear's score. Leans on the difficulty the data
// already encodes — the host size (keeperCount) and the ground to cover
// (sizeScale) — normalized so The Old City sits near 1.0 and Vesper near 1.5.
function difficultyMult(level: LevelDef): number {
  const km = level.keeperCount / 6;       // 1.0 at old-city, ~1.83 at vesper
  const sm = level.sizeScale ?? 1;        // bigger ground = more hunting
  return +(0.6 + 0.4 * km * sm).toFixed(2);
}

interface ScoreBreakdown {
  base: number; speed: number; dwellings: number; survival: number;
  untouched: number; mult: number; total: number; embers: number;
}

// Score a finished descent. Pure — reads only the state, so the harness can
// drive it. Faster pays, a relit and unscathed city pays, and a harder city
// multiplies the lot; embers (the unlock currency) are a tenth of the score.
function scoreRun(s: PgState): ScoreBreakdown {
  const base = s.total * SCORE_PER_SHADE;
  const targetMs = s.total * SCORE_TARGET_PER_SHADE;
  const speed = Math.max(0, Math.round(((targetMs - s.elapsed) / 1000) * SCORE_SPEED_PER_SEC));
  const dwellings = s.dwellingsTotal
    ? Math.round((s.litCount / s.dwellingsTotal) * SCORE_DWELLINGS_MAX) : 0;
  const survival = Math.round((s.hero.hp / s.hero.maxHp) * SCORE_SURVIVAL_MAX);
  const untouched = s.hits === 0 ? SCORE_UNTOUCHED : 0;
  const mult = difficultyMult(s.level);
  const total = Math.round((base + speed + dwellings + survival + untouched) * mult);
  const embers = Math.max(1, Math.round(total / SCORE_EMBERS_DIV));
  return { base, speed, dwellings, survival, untouched, mult, total, embers };
}

// Undo a shade: mark it dead, count the kill, and — by chance — leave a
// gatherable ember mote where it fell. The single kill path, so every source
// (pulse, chain, scorch, nova) drops motes the same way.
function killShade(s: PgState, e: Shade): void {
  e.dead = true;
  s.kills++;
  if (Math.random() < MOTE_DROP_CHANCE) {
    s.motes.push({ x: e.x, y: e.y, until: s.elapsed + MOTE_TTL_MS });
  }
}

// Drift the veil pools and bounce them off the world's edge. Pure motion — the
// pools never block, they only matter where the hero stands still (see stepCombat).
function stepVeils(s: PgState, dt: number): void {
  for (const v of s.veils) {
    v.x += (v.vx * dt) / 1000;
    v.y += (v.vy * dt) / 1000;
    if (v.x < v.r || v.x > s.w - v.r) { v.vx = -v.vx; v.x = clamp(v.x, v.r, s.w - v.r); }
    if (v.y < v.r || v.y > s.h - v.r) { v.vy = -v.vy; v.y = clamp(v.y, v.r, s.h - v.r); }
  }
}

// Is the point inside any veil pool? (Used to decide whether a still hero
// inscribes the sigil or has it unravelled.)
function inVeil(s: PgState, x: number, y: number): boolean {
  return s.veils.some((v) => (x - v.x) ** 2 + (y - v.y) ** 2 <= v.r ** 2);
}

// Gather any ember mote the hero has walked onto: snap the sigil to full and open
// a damage-surge window. Then retire faded (or gathered) motes.
function stepMotes(s: PgState): void {
  if (!s.motes.length) return;
  const h = s.hero;
  const rr = (HERO_RADIUS + MOTE_RADIUS) ** 2;
  for (const m of s.motes) {
    if (m.until <= s.elapsed) continue;
    if ((m.x - h.x) ** 2 + (m.y - h.y) ** 2 <= rr) {
      m.until = 0; // consumed
      s.penta.charge = 1;
      s.surgeUntil = s.elapsed + MOTE_SURGE_MS;
    }
  }
  s.motes = s.motes.filter((m) => m.until > s.elapsed);
}

// Shades wander their post until the hero comes near (sticky aggro), then chase,
// separating from one another so a crowd swarms instead of stacking into a point.
// Once only a handful remain, the rest rouse so a clear always reaches its end.
function stepShades(s: PgState, dt: number): void {
  const h = s.hero;
  const cleanup = aliveShades(s) <= s.total * CLEANUP_AGGRO_FRAC;
  for (const e of s.shades) {
    if (e.dead) continue;

    // Rouse on proximity (or the cleanup sweep). Aggro never settles back.
    if (e.state === "wander") {
      if (cleanup || (h.x - e.x) ** 2 + (h.y - e.y) ** 2 <= AGGRO_RADIUS ** 2) {
        e.state = "chase";
      }
    }

    let dx: number, dy: number, speed: number;
    if (e.state === "chase") {
      dx = h.x - e.x; dy = h.y - e.y;
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      // Separation among fellow chasers, so a crowd packs rather than overlaps.
      for (const o of s.shades) {
        if (o === e || o.dead || o.state !== "chase") continue;
        const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy);
        if (od > 0 && od < SHADE_SEP) { dx += (ox / od) * 0.7; dy += (oy / od) * 0.7; }
      }
      const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
      speed = SHADE_SPEED;
    } else {
      // Wander: drift along the heading, re-rolling on a timer; steer home if the
      // leash is taut so a wanderer never strays far from its post.
      e.wanderTimer -= dt;
      if (e.wanderTimer <= 0) {
        e.wanderAngle += (Math.random() - 0.5) * 1.6;
        e.wanderTimer = SHADE_WANDER_RETARGET_MS * (0.5 + Math.random());
      }
      const lx = e.x - e.homeX, ly = e.y - e.homeY;
      if (lx * lx + ly * ly > SHADE_LEASH ** 2) e.wanderAngle = Math.atan2(-ly, -lx);
      dx = Math.cos(e.wanderAngle); dy = Math.sin(e.wanderAngle);
      speed = SHADE_WANDER_SPEED;
    }
    e.vx = dx * speed; e.vy = dy * speed;
    const p = pushOut(s, e.x + (e.vx * dt) / 1000, e.y + (e.vy * dt) / 1000, SHADE_RADIUS);
    e.x = p.x; e.y = p.y;
  }
}

// The pentagram pulses on its own clock: every PENTA_PULSE_MS it burns every
// risen shade within its ring for PENTA_DMG scaled by how fully it is inscribed,
// and kindles any dark dwelling the ring has caught (mending the hero a little).
function stepPentagram(s: PgState, dt: number): void {
  const hero = s.hero;

  // Scorched ground (Quick Ember): burn shades on a live patch every frame, then
  // retire patches that have cooled. Runs continuously, not just on a pulse.
  // A still-shielded elite shrugs the burn off (only a full pulse breaks it).
  if (s.scorch.length) {
    const sdmg = (SCORCH_DPS * dt) / 1000;
    const sr2 = SCORCH_RADIUS ** 2;
    for (const p of s.scorch) {
      if (p.until <= s.elapsed) continue;
      for (const e of s.shades) {
        if (e.dead || e.shielded) continue;
        if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= sr2) {
          e.hp -= sdmg;
          e.hit = s.elapsed + SHADE_HIT_MS;
          if (e.hp <= 0) killShade(s, e);
        }
      }
    }
    s.scorch = s.scorch.filter((p) => p.until > s.elapsed);
  }

  s.pulseAcc += dt;
  while (s.pulseAcc >= s.fxPulse) {
    s.pulseAcc -= s.fxPulse;
    if (s.penta.charge <= 0) continue;
    const r2 = s.fxRadius ** 2;
    const full = s.penta.charge >= 1; // only a full inscription shatters an elite's shield
    const surge = s.surgeUntil > s.elapsed ? MOTE_SURGE_DMG : 1; // gathered-ember bite
    const dmg = s.fxDmg * s.penta.charge * surge;
    const justKilled: Shade[] = [];
    for (const e of s.shades) {
      if (e.dead) continue;
      if ((e.x - hero.x) ** 2 + (e.y - hero.y) ** 2 <= r2) {
        e.state = "chase"; // a pulse that catches a wanderer rouses it
        if (e.shielded) {
          // Shielded: a partial pulse does nothing; a full one shatters the shield.
          if (full) { e.shielded = false; e.hit = s.elapsed + SHADE_HIT_MS; }
          continue;
        }
        e.hp -= dmg;
        e.hit = s.elapsed + SHADE_HIT_MS;
        if (e.hp <= 0) { killShade(s, e); justKilled.push(e); }
      }
    }
    // Chain (Pyre): each fresh kill arcs once to the shades clustered around it.
    if (s.type.power === "chain" && justKilled.length) {
      const cr2 = CHAIN_RADIUS ** 2, cdmg = dmg * CHAIN_FRAC;
      for (const k of justKilled) {
        for (const e of s.shades) {
          if (e.dead || e.shielded) continue;
          if ((e.x - k.x) ** 2 + (e.y - k.y) ** 2 <= cr2) {
            e.state = "chase";
            e.hp -= cdmg;
            e.hit = s.elapsed + SHADE_HIT_MS;
            s.arcs.push({ x1: k.x, y1: k.y, x2: e.x, y2: e.y, until: s.elapsed + ARC_MS });
            if (e.hp <= 0) killShade(s, e);
          }
        }
      }
    }
    // Scorch (Quick Ember): each pulse stamps the ground under the hero.
    if (s.type.power === "scorch") {
      s.scorch.push({ x: hero.x, y: hero.y, until: s.elapsed + SCORCH_MS });
      if (s.scorch.length > SCORCH_MAX) s.scorch.shift();
    }
    // Dwellings caught in the ring kindle, mending the hero.
    for (const n of s.scenery) {
      if (n.kind !== "dwelling" || n.lit) continue;
      if ((n.x - hero.x) ** 2 + (n.y - hero.y) ** 2 <= r2) {
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

  // Drift the dark pools, then decide the sigil from where the hero now stands.
  stepVeils(s, dt);
  const veiled = inVeil(s, h.x, h.y);

  // Stand still on clean ground and the sigil inscribes itself; move and it fades.
  // Standing in a veil pool UNRAVELS it instead — charge bleeds away fast — so a
  // still hero must pick clear ground. The type's charge lean is baked into fxCharge.
  if (Math.hypot(h.vx, h.vy) < HERO_STILL_MAXSPEED && !veiled) {
    s.penta.charge = Math.min(1, s.penta.charge + dt / s.fxCharge);
  } else if (veiled) {
    s.penta.charge = Math.max(0, s.penta.charge - (VEIL_DRAIN_MUL * dt) / s.fxCharge);
  } else {
    s.penta.charge = Math.max(0, s.penta.charge - dt / s.fxCharge);
  }
  s.penta.angle = (s.penta.angle + dt * PENTA_SPIN) % 360;

  // Gather any ember mote underfoot last, so its snap-to-full and surge land on
  // this frame's pulse rather than the next.
  stepMotes(s);

  stepShades(s, dt);
  stepPentagram(s, dt);

  // Nova (Wrath): the first full inscription erupts, hurling chasers back in a
  // searing ring. It re-arms once the charge has dropped (move, then re-still).
  if (s.type.power === "nova") {
    if (s.penta.charge >= 1 && !s.novaFired) {
      const nr2 = s.fxRadius ** 2;
      for (const e of s.shades) {
        if (e.dead || e.shielded) continue; // a shielded elite rides out the nova
        if ((e.x - h.x) ** 2 + (e.y - h.y) ** 2 <= nr2) {
          e.hp -= s.fxDmg * 2;
          e.hit = s.elapsed + SHADE_HIT_MS;
          if (e.hp <= 0) { killShade(s, e); continue; }
          const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
          const p = pushOut(s, e.x + (dx / d) * NOVA_PUSH, e.y + (dy / d) * NOVA_PUSH, SHADE_RADIUS);
          e.x = p.x; e.y = p.y;
        }
      }
      s.novas.push({ x: h.x, y: h.y, r: s.fxRadius, until: s.elapsed + NOVA_FX_MS });
      s.novaFired = true;
    } else if (s.penta.charge < 0.5) {
      s.novaFired = false;
    }
  }

  // Retire spent cosmetic FX (cheap; only when any are live).
  if (s.arcs.length) s.arcs = s.arcs.filter((a) => a.until > s.elapsed);
  if (s.novas.length) s.novas = s.novas.filter((n) => n.until > s.elapsed);

  // Contact: a shade on the hero, outside i-frames, bites and is shoved off.
  if (h.hurt <= 0) {
    const reach = (HERO_RADIUS + SHADE_RADIUS) ** 2;
    for (const e of s.shades) {
      if (e.dead) continue;
      if ((e.x - h.x) ** 2 + (e.y - h.y) ** 2 <= reach) {
        h.hp -= e.elite ? ELITE_CONTACT_DMG : SHADE_CONTACT_DMG;
        s.hits++;
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
  else if (s.shades.every((e) => e.dead)) { startBoss(s); } // the host falls — the warden rises
}

// ---------- The Veilwarden duel (turn-based, finger-traced) ----------

// The five segments of the {5/2} star inscribed in a circle of radius r, in draw
// order (0→2→4→1→3→0). The single source of the star geometry — both the drawn
// template (pentagramPath) and the trace scorer read it, so they can never drift.
function pentagramSegments(cx: number, cy: number, r: number, rotDeg: number): Segment[] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + rotDeg + i * 72) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const order = [0, 2, 4, 1, 3];
  const segs: Segment[] = [];
  for (let i = 0; i < 5; i++) {
    const a = pts[order[i]], b = pts[order[(i + 1) % 5]];
    segs.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  }
  return segs;
}

// Rate a finger-traced stroke against the star's five segments, 0..1. The risky
// idea, kept pure so the harness can prove it. Two factors, multiplied:
//   accuracy — how close each drawn point sits to the nearest star edge (a stroke
//              that wanders off the lines scores low), and
//   coverage — how much of the star the stroke actually visited (sampling the
//              ideal path and requiring a drawn point near each sample), so you
//              can't pass by scribbling one edge or one corner.
// `tol` is the world-space slack band (the duel passes r × TRACE_TOL_FRAC).
function traceScore(stroke: { x: number; y: number }[], segs: Segment[], tol: number): number {
  if (stroke.length < TRACE_MIN_POINTS || tol <= 0) return 0;
  // Accuracy: mean nearest-edge distance, normalized by the slack band.
  let sum = 0;
  for (const p of stroke) {
    let best = Infinity;
    for (const sg of segs) {
      const d = closestOnSegment(p.x, p.y, sg.x1, sg.y1, sg.x2, sg.y2).d;
      if (d < best) best = d;
    }
    sum += best;
  }
  const acc = clamp(1 - sum / stroke.length / tol, 0, 1);
  // Coverage: sample along every edge; each sample wants a drawn point nearby.
  const tol2 = tol * tol;
  let covered = 0, samples = 0;
  for (const sg of segs) {
    for (let t = 0; t <= 1.0001; t += 0.2) {
      const ix = sg.x1 + (sg.x2 - sg.x1) * t, iy = sg.y1 + (sg.y2 - sg.y1) * t;
      samples++;
      for (const p of stroke) {
        if ((p.x - ix) ** 2 + (p.y - iy) ** 2 <= tol2) { covered++; break; }
      }
    }
  }
  const cov = samples ? covered / samples : 0;
  return +(acc * cov).toFixed(4);
}

// A tiny seeded PRNG (mulberry32) and a string hash, so a warden's seal is a
// pure, deterministic function of the city id — it rebuilds identically every
// time, the way the parent's edges/districts rebuild from saved geometry.
function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build a warden's Goetic seal: a wandering, sometimes self-crossing line-glyph
// inside a containment circle, with small terminal nodes and a cross-bar ending —
// the look of an Ars Goetia spirit's seal, drawn from line segments (no new art).
// `seed` (the city id hash) makes each city's seal unique but stable.
function makeSeal(cx: number, cy: number, r: number, seed: number): Sigil {
  const rnd = mulberry32(seed);
  const n = SEAL_NODES_MIN + Math.floor(rnd() * (SEAL_NODES_MAX - SEAL_NODES_MIN + 1));
  const spine: { x: number; y: number }[] = [];
  let ang = rnd() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    // Wander the angle by a sizeable, sign-flipping step so the line turns sharply
    // and can cross itself — the angular, asymmetric signature of a Goetic seal.
    ang += (0.7 + rnd() * 1.7) * (rnd() < 0.5 ? 1 : -1);
    const onRim = i === 0 || i === n - 1 || rnd() < 0.45;
    const rad = onRim ? r * (0.84 + rnd() * 0.16) : r * (0.18 + rnd() * (SEAL_INNER_FRAC - 0.18));
    spine.push({ x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad });
  }
  // Terminal nodes: small circles at both ends and the glyph's midpoint.
  const terminals = [spine[0], spine[n - 1]];
  if (n > 4) terminals.push(spine[Math.floor(n / 2)]);
  // A cross-bar across the final terminal, perpendicular to the last stroke.
  const a = spine[n - 2], b = spine[n - 1];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len, hb = r * 0.13;
  const bars: Segment[] = [{ x1: b.x - px * hb, y1: b.y - py * hb, x2: b.x + px * hb, y2: b.y + py * hb }];
  return { cx, cy, r, spine, terminals, bars };
}

// The seal's spine as scoreable segments (open polyline) and as an SVG path.
function sealSegments(seal: Sigil): Segment[] {
  const segs: Segment[] = [];
  for (let i = 0; i < seal.spine.length - 1; i++) {
    const a = seal.spine[i], b = seal.spine[i + 1];
    segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return segs;
}
function sealPath(seal: Sigil): string {
  const p = seal.spine;
  let d = `M${p[0].x.toFixed(1)} ${p[0].y.toFixed(1)}`;
  for (let i = 1; i < p.length; i++) d += ` L${p[i].x.toFixed(1)} ${p[i].y.toFixed(1)}`;
  return d;
}

// Raise the warden: a city-scaled health pool and its unique Goetic seal centred
// on the arena's heart. Flips the run into the turn-based duel.
function startBoss(s: PgState): void {
  const hp = Math.round(BOSS_HP * difficultyMult(s.level));
  const cx = s.w / 2, cy = s.h / 2;
  s.boss = {
    hp, maxHp: hp, biteAcc: 0,
    cx, cy, r: BOSS_RING_R,
    seal: makeSeal(cx, cy, BOSS_RING_R, hashSeed(s.level.id)),
    lastQuality: 0, flash: 0,
  };
  s.phase = "boss";
}

// The warden's own clock: it snuffs on a cadence, draining the carrier's flame.
// (The carrier's answer is submitTrace — a finger-traced seal.) Pure sim.
function stepBoss(s: PgState, dt: number): void {
  if (s.phase !== "boss" || !s.boss) return;
  s.elapsed += dt;
  const b = s.boss;
  b.biteAcc += dt;
  while (b.biteAcc >= BOSS_BITE_MS) {
    b.biteAcc -= BOSS_BITE_MS;
    s.hero.hp -= BOSS_BITE_DMG;
  }
  if (s.hero.hp <= 0) { s.hero.hp = 0; s.phase = "lost"; }
}

// Score a completed finger-stroke against the warden's seal and burn it for that
// fraction of a full inscription. Returns the 0..1 quality (for the toast).
function submitTrace(s: PgState, stroke: { x: number; y: number }[]): number {
  if (s.phase !== "boss" || !s.boss) return 0;
  const b = s.boss;
  const segs = sealSegments(b.seal);
  const q = traceScore(stroke, segs, b.r * TRACE_TOL_FRAC);
  b.lastQuality = q;
  b.flash = s.elapsed + TRACE_FLASH_MS;
  b.hp -= q * BOSS_TRACE_DMG;
  if (b.hp <= 0) { b.hp = 0; s.phase = "won"; }
  return q;
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
    <radialGradient id="veil">
      <stop offset="0%" stop-color="#0a0612" stop-opacity="0.85"/>
      <stop offset="60%" stop-color="#160c24" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#160c24" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mote">
      <stop offset="0%" stop-color="#fff6d8" stop-opacity="1"/>
      <stop offset="45%" stop-color="#ffd87a" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#ffd87a" stop-opacity="0"/>
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

// The {5/2} star polygon as an SVG path, built from the shared segment geometry
// so the drawn sigil and the trace scorer can never diverge.
function pentagramPath(cx: number, cy: number, r: number, rotDeg: number): string {
  const segs = pentagramSegments(cx, cy, r, rotDeg);
  let d = `M${segs[0].x1.toFixed(1)} ${segs[0].y1.toFixed(1)} `;
  for (const sg of segs) d += `L${sg.x2.toFixed(1)} ${sg.y2.toFixed(1)} `;
  return d + "Z";
}

const SCENERY_SPRITE: Record<NodeKind, string> = {
  dwelling: "dwelling-dark", conduit: "conduit", press: "press",
  shrine: "shrine", keeper: "keeper-node",
};
const SCENERY_SIZE: Record<NodeKind, number> = {
  dwelling: 46, conduit: 40, press: 56, shrine: 50, keeper: 0,
};

// The carrier's in-progress finger-stroke during the warden duel, in world
// space. The shell appends to it as the finger moves and clears it on release;
// renderBossScene draws it. Module-scoped so both the shell and render share it
// (transient — never persisted, like decoys in the parent).
let bossTrace: { x: number; y: number }[] | null = null;

// The warden duel's scene: the city dimmed to a backdrop, the master Keeper
// risen at its heart under its traceable Goetic seal, the carrier's live stroke,
// the snuff telegraph, and the warden's health.
function renderBossScene(s: PgState, layer: SVGGElement): void {
  const b = s.boss;
  if (!b) return;

  // The city, dimmed — context behind the duel.
  for (const n of s.scenery) {
    if (n.kind === "keeper") continue;
    const spriteName = n.kind === "dwelling" && n.lit ? "dwelling-lit" : SCENERY_SPRITE[n.kind];
    const key = spriteFor(s.level, spriteName);
    if (key) layer.appendChild(spriteImage(key, n.x, n.y, SCENERY_SIZE[n.kind], 0.16));
  }

  const flash = b.flash > s.elapsed ? (b.flash - s.elapsed) / TRACE_FLASH_MS : 0;

  // The warden — the master Keeper, risen large, in a pool of infernal light.
  layer.appendChild(el("circle", { cx: b.cx, cy: b.cy, r: b.r * 0.8, fill: "url(#penta)", opacity: 0.3 + 0.4 * flash }));
  const bossKey = sprites.has("keeper-node") ? "keeper-node" : null;
  if (bossKey) {
    layer.appendChild(spriteImage(bossKey, b.cx, b.cy, 124 * (1 + 0.05 * flash), 1));
  } else {
    const q = 80;
    layer.appendChild(el("rect", {
      x: b.cx - q / 2, y: b.cy - q / 2, width: q, height: q,
      transform: `rotate(45 ${b.cx} ${b.cy})`,
      fill: "#1b2740", stroke: "#9fc4e8", "stroke-width": 3,
    }));
  }

  // The snuff telegraph — a violet ring that fills as the warden's next bite nears.
  const frac = clamp(b.biteAcc / BOSS_BITE_MS, 0, 1);
  const tr = b.r * 1.22, circ = 2 * Math.PI * tr;
  layer.appendChild(el("circle", { cx: b.cx, cy: b.cy, r: tr, fill: "none", stroke: "#3a2150", "stroke-width": 3, opacity: 0.5 }));
  layer.appendChild(el("circle", {
    cx: b.cx, cy: b.cy, r: tr, fill: "none", stroke: "#b46cff", "stroke-width": 3.5,
    "stroke-dasharray": `${circ.toFixed(1)}`, "stroke-dashoffset": `${(circ * (1 - frac)).toFixed(1)}`,
    transform: `rotate(-90 ${b.cx} ${b.cy})`, opacity: 0.85, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
  }));

  // The warden's Goetic seal — the thing you trace. Drawn as a containment
  // double-ring with rim ticks (the occult-seal frame), then the glyph's spine
  // as a dashed glowing line, its terminal nodes, and the cross-bar ending.
  const seal = b.seal;
  // Containment double-circle.
  layer.appendChild(el("circle", { cx: b.cx, cy: b.cy, r: seal.r, fill: "none", stroke: "#ffd87a", "stroke-width": 1.6, opacity: 0.4 }));
  layer.appendChild(el("circle", { cx: b.cx, cy: b.cy, r: seal.r * 0.93, fill: "none", stroke: "#ffd87a", "stroke-width": 0.8, opacity: 0.28 }));
  // Rim ticks — short radial marks around the ring, an occult-seal flourish.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const c = Math.cos(a), sn = Math.sin(a);
    layer.appendChild(el("line", {
      x1: b.cx + c * seal.r * 0.93, y1: b.cy + sn * seal.r * 0.93,
      x2: b.cx + c * seal.r, y2: b.cy + sn * seal.r,
      stroke: "#ffd87a", "stroke-width": 0.8, opacity: 0.3,
    }));
  }
  // The spine — the glyph you draw over (dashed, glowing).
  layer.appendChild(el("path", {
    d: sealPath(seal), fill: "none",
    stroke: "#ffd87a", "stroke-width": 2.6, "stroke-linejoin": "round", "stroke-linecap": "round",
    "stroke-dasharray": "7 8", opacity: 0.6, filter: "url(#glow)",
  }));
  // Cross-bars — the Goetic ending strokes.
  for (const bar of seal.bars) {
    layer.appendChild(el("line", {
      x1: bar.x1, y1: bar.y1, x2: bar.x2, y2: bar.y2,
      stroke: "#ffd87a", "stroke-width": 2.2, "stroke-linecap": "round", opacity: 0.55, filter: "url(#glow)",
    }));
  }
  // Terminal nodes — small circles marking the glyph's notable points.
  for (const t of seal.terminals) {
    layer.appendChild(el("circle", { cx: t.x, cy: t.y, r: 5, fill: "none", stroke: "#ffe9b0", "stroke-width": 1.6, opacity: 0.65 }));
  }

  // The carrier's live finger-stroke, burning along behind the fingertip.
  if (bossTrace && bossTrace.length > 1) {
    let d = `M${bossTrace[0].x.toFixed(1)} ${bossTrace[0].y.toFixed(1)}`;
    for (let i = 1; i < bossTrace.length; i++) d += ` L${bossTrace[i].x.toFixed(1)} ${bossTrace[i].y.toFixed(1)}`;
    layer.appendChild(el("path", {
      d, fill: "none", stroke: "#ff6a3c", "stroke-width": 4.5,
      "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.95,
      filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
  }

  // The warden's health, in world space above it.
  const bw = b.r * 1.7, hpFrac = clamp(b.hp / b.maxHp, 0, 1), by = b.cy - b.r - 26;
  layer.appendChild(el("rect", { x: b.cx - bw / 2, y: by, width: bw, height: 7, fill: "#2a0c0c", opacity: 0.85 }));
  layer.appendChild(el("rect", { x: b.cx - bw / 2, y: by, width: bw * hpFrac, height: 7, fill: "#b46cff", opacity: 0.95 }));
}

function render(s: PgState, layer: SVGGElement): void {
  layer.innerHTML = "";

  // Ground — the city's tiled floor (or solid gloom if the art isn't loaded).
  const hasGround = sprites.has("ground");
  layer.appendChild(el("rect", {
    x: 0, y: 0, width: s.w, height: s.h,
    fill: hasGround ? "url(#groundPat)" : "#0a0c16", opacity: hasGround ? 0.5 : 1,
  }));

  // Once the warden has risen, the duel replaces the field (drawn over the ground).
  if (s.boss) { renderBossScene(s, layer); return; }

  // Veil pools — drifting patches of the old dark on the floor. A still hero
  // standing in one cannot inscribe; the sigil unravels. Drawn low, on the ground.
  for (const v of s.veils) {
    layer.appendChild(el("circle", { cx: v.x, cy: v.y, r: v.r, fill: "url(#veil)" }));
    layer.appendChild(el("circle", {
      cx: v.x, cy: v.y, r: v.r, fill: "none",
      stroke: "#2a1840", "stroke-width": 1.5, "stroke-dasharray": "5 9", opacity: 0.5,
    }));
  }

  // Scorched ground (Quick Ember) — faint embered patches that fade as they cool.
  for (const p of s.scorch) {
    const life = Math.max(0, (p.until - s.elapsed) / SCORCH_MS);
    if (life <= 0) continue;
    layer.appendChild(el("circle", {
      cx: p.x, cy: p.y, r: SCORCH_RADIUS, fill: "url(#penta)", opacity: 0.18 * life,
    }));
    layer.appendChild(el("circle", {
      cx: p.x, cy: p.y, r: SCORCH_RADIUS, fill: "none",
      stroke: s.type.ring, "stroke-width": 1.5, opacity: 0.35 * life,
    }));
  }

  // Chain sparks (Pyre) — a quick bolt drawn from each kill to the shade it
  // arced to, fading over ARC_MS.
  for (const a of s.arcs) {
    const life = Math.max(0, (a.until - s.elapsed) / ARC_MS);
    if (life <= 0) continue;
    layer.appendChild(el("line", {
      x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2,
      stroke: s.type.star, "stroke-width": 2.4, "stroke-linecap": "round",
      opacity: 0.85 * life, filter: "url(#glow)",
    }));
  }

  // Eruption rings (Wrath) — an expanding ring that thins as it fades over
  // NOVA_FX_MS, marking where the swarm was hurled back.
  for (const n of s.novas) {
    const life = Math.max(0, (n.until - s.elapsed) / NOVA_FX_MS);
    if (life <= 0) continue;
    layer.appendChild(el("circle", {
      cx: n.x, cy: n.y, r: n.r * (1.0 + (1 - life) * 0.6),
      fill: "none", stroke: s.type.ring, "stroke-width": 3 + 5 * life,
      opacity: 0.6 * life, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
  }

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

  // Ember motes — bright gatherable sparks a slain shade left behind; walk over
  // one to snap the sigil full and bite harder for a moment. They pulse and fade.
  for (const m of s.motes) {
    const life = Math.max(0, (m.until - s.elapsed) / MOTE_TTL_MS);
    if (life <= 0) continue;
    const pulse = 1 + 0.25 * Math.sin(s.elapsed / 140);
    layer.appendChild(el("circle", {
      cx: m.x, cy: m.y, r: 14 * pulse, fill: "url(#mote)",
      opacity: Math.min(1, 0.4 + life), filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
    layer.appendChild(el("circle", { cx: m.x, cy: m.y, r: 3.2, fill: "#fff6d8" }));
  }

  // The pentagram — the only procedural art. Scales and brightens with charge,
  // turns slowly, and burns through a soft glow.
  const h = s.hero;
  if (s.penta.charge > 0) {
    const r = s.fxRadius * (0.7 + 0.3 * s.penta.charge);
    const op = 0.25 + 0.65 * s.penta.charge;
    layer.appendChild(el("circle", { cx: h.x, cy: h.y, r, fill: "url(#penta)", opacity: op * 0.6 }));
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r, fill: "none", stroke: s.type.ring, "stroke-width": 2,
      opacity: op, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
    layer.appendChild(el("path", {
      d: pentagramPath(h.x, h.y, r * 0.92, s.penta.angle),
      fill: "none", stroke: s.type.star, "stroke-width": 2.6, "stroke-linejoin": "round",
      opacity: op, filter: "url(#glow)",
    }));
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: r * 0.92, fill: "none", stroke: s.type.ring,
      "stroke-width": 1, opacity: op * 0.7,
    }));
  }

  // Shades — Keepers risen. Roused ones draw full; wanderers lurk faint.
  const shadeKey = sprites.has("keeper-patrol")
    ? "keeper-patrol" : sprites.has("keeper-node") ? "keeper-node" : null;
  for (const e of s.shades) {
    if (e.dead) continue;
    const op = e.state === "chase" ? 1 : 0.55;
    // Fresh blow: the shade recoils brighter and a burst flares over it, fading
    // across SHADE_HIT_MS. Each sigil's hit reads in its own colour and shape —
    // Vigil's warm pop, the Pyre's hungry double-flare, the Quick Ember's snappy
    // spark, the Wrath's hollow violet ring — so the bite matches the brand.
    const flash = e.hit > s.elapsed ? Math.max(0, (e.hit - s.elapsed) / SHADE_HIT_MS) : 0;
    const recoil = flash * (s.type.power === "chain" ? 0.26 : s.type.power === "scorch" ? 0.12 : 0.18);
    const sz = (e.elite ? 60 : 44) * (1 + recoil); // champions loom larger; recoil pop on impact
    if (shadeKey) {
      layer.appendChild(spriteImage(shadeKey, e.x, e.y, sz, op));
    } else {
      const q = SHADE_RADIUS * (e.elite ? 2 : 1.4);
      layer.appendChild(el("rect", {
        x: e.x - q / 2, y: e.y - q / 2, width: q, height: q,
        transform: `rotate(45 ${e.x} ${e.y})`,
        fill: "#1b2740", stroke: "#9fc4e8", "stroke-width": 2, opacity: op,
      }));
    }
    // Champions read at a glance: a cold shield-ring while veiled (only a full
    // inscription breaks it), or a faint dark aura once the shield is shattered.
    if (e.elite) {
      if (e.shielded) {
        const sp = 1 + 0.06 * Math.sin(s.elapsed / 180);
        layer.appendChild(el("circle", {
          cx: e.x, cy: e.y, r: (SHADE_RADIUS + 10) * sp, fill: "none",
          stroke: "#8fc0ff", "stroke-width": 3, opacity: 0.8 * op,
          filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
        }));
        layer.appendChild(el("circle", {
          cx: e.x, cy: e.y, r: SHADE_RADIUS + 5, fill: "none",
          stroke: "#cfe4ff", "stroke-width": 1, opacity: 0.5 * op,
        }));
      } else {
        layer.appendChild(el("circle", {
          cx: e.x, cy: e.y, r: SHADE_RADIUS + 6, fill: "none",
          stroke: "#5a2a6a", "stroke-width": 2, opacity: 0.5 * op,
        }));
      }
    }
    if (flash > 0) {
      const grow = 1 - flash; // 0 at impact → 1 as it fades, so the burst expands
      const fx: Record<string, string> = LOW_FX ? {} : { filter: "url(#bloom)" };
      if (s.type.power === "nova") {
        // Wrath: a hollow violet ring erupting outward — echoes its nova.
        layer.appendChild(el("circle", {
          cx: e.x, cy: e.y, r: SHADE_RADIUS * (0.8 + 1.0 * grow),
          fill: "none", stroke: s.type.ring, "stroke-width": 3,
          opacity: 0.8 * flash, ...fx,
        }));
      } else if (s.type.power === "chain") {
        // Pyre: a hungry double-flare — a bright core inside a wider ring.
        layer.appendChild(el("circle", {
          cx: e.x, cy: e.y, r: SHADE_RADIUS * (0.9 + 0.7 * grow),
          fill: "none", stroke: s.type.ring, "stroke-width": 3, opacity: 0.7 * flash, ...fx,
        }));
        layer.appendChild(el("circle", {
          cx: e.x, cy: e.y, r: SHADE_RADIUS * (0.7 + 0.3 * grow),
          fill: s.type.star, opacity: 0.75 * flash, ...fx,
        }));
      } else {
        // Vigil & Quick Ember: a filled burst in the sigil's bright hue. The
        // Ember's is tighter and snappier, the Vigil's a softer warm pop.
        const tight = s.type.power === "scorch";
        layer.appendChild(el("circle", {
          cx: e.x, cy: e.y, r: SHADE_RADIUS * (tight ? 0.7 + 0.35 * grow : 0.9 + 0.5 * grow),
          fill: s.type.star, opacity: (tight ? 0.8 : 0.7) * flash, ...fx,
        }));
      }
    }
    if (e.state === "chase" && e.hp < e.maxHp) {
      const bw = 30, frac = Math.max(0, e.hp / e.maxHp);
      const by = e.y - SHADE_RADIUS - 11;
      layer.appendChild(el("rect", { x: e.x - bw / 2, y: by, width: bw, height: 3, fill: "#2a0c0c", opacity: 0.85 }));
      layer.appendChild(el("rect", { x: e.x - bw / 2, y: by, width: bw * frac, height: 3, fill: "#ff6a3c", opacity: 0.95 }));
    }
  }

  // Surge aura — a bright pulsing ring while a gathered ember boosts the bite.
  if (s.surgeUntil > s.elapsed) {
    const sp = 1 + 0.12 * Math.sin(s.elapsed / 90);
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: (HERO_RADIUS + 12) * sp, fill: "none",
      stroke: s.type.star, "stroke-width": 3, opacity: 0.85,
      filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
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
  embers: number;       // unlock currency, banked from clears
  unlocked: string[];   // sigil ids the carrier owns (always includes "vigil")
  equipped: string;     // the sigil id currently equipped
}

function emptyPgLegacy(): PgLegacy {
  return { runs: 0, clears: 0, best: {}, dwellingsLit: 0, embers: 0, unlocked: ["vigil"], equipped: "vigil" };
}

function loadPgLegacy(): PgLegacy {
  try {
    const raw = localStorage.getItem(PG_LEGACY_KEY);
    if (!raw) return emptyPgLegacy();
    const l = JSON.parse(raw) as Partial<PgLegacy>;
    // New fields default for old saves (no key bump). Validate sigil ids against
    // the roster so a removed/renamed type can never dangle into a crash.
    const owned = new Set<string>(["vigil"]);
    if (Array.isArray(l.unlocked)) {
      for (const id of l.unlocked) if (pentaTypeById(id).id === id) owned.add(id);
    }
    const equipped = l.equipped && owned.has(l.equipped) ? l.equipped : "vigil";
    return {
      runs: l.runs || 0, clears: l.clears || 0, best: l.best || {},
      dwellingsLit: l.dwellingsLit || 0,
      embers: l.embers || 0, unlocked: [...owned], equipped,
    };
  } catch { return emptyPgLegacy(); }
}

function savePgLegacy(l: PgLegacy): void {
  try { localStorage.setItem(PG_LEGACY_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

function recordClear(level: LevelDef, ms: number, lit = 0, embers = 0): PgLegacy {
  const l = loadPgLegacy();
  l.runs++; l.clears++;
  l.dwellingsLit += lit;
  l.embers += embers;
  if (!l.best[level.id] || ms < l.best[level.id]) l.best[level.id] = ms;
  savePgLegacy(l);
  return l;
}

// Buy a sigil if it is owned-less and affordable: deduct its cost and add it to
// the carrier's roster. A no-op (returns the legacy unchanged) otherwise.
function unlockType(id: string): PgLegacy {
  const l = loadPgLegacy();
  const t = pentaTypeById(id);
  if (t.id !== id || l.unlocked.includes(id) || l.embers < t.cost) return l;
  l.embers -= t.cost;
  l.unlocked.push(id);
  savePgLegacy(l);
  return l;
}

// Equip a sigil the carrier owns. A no-op for an unowned id.
function equipType(id: string): PgLegacy {
  const l = loadPgLegacy();
  if (!l.unlocked.includes(id)) return l;
  l.equipped = id;
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
  const sigilEl = byId("sigil");
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
    const aw = s ? s.w : W, ah = s ? s.h : H;
    cam.k = Math.min(maxK, Math.max(minK, cam.k));
    const mw = aw * cam.k, mh = ah * cam.k;
    cam.x = mw <= vw ? (vw - mw) / 2 : Math.min(0, Math.max(vw - mw, cam.x));
    cam.y = mh <= vh ? (vh - mh) / 2 : Math.min(0, Math.max(vh - mh, cam.y));
  }
  function setupZoom(): void {
    const vw = svg.clientWidth, vh = svg.clientHeight, m = Math.min(vw, vh);
    const aw = s ? s.w : W;
    minK = m / aw;            // zoomed out: the whole (enlarged) city fits
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
  // Screen (client) point → world space, inverting the camera transform. Used to
  // map the carrier's finger-trace onto the warden's template during the duel.
  function worldPt(clientX: number, clientY: number): { x: number; y: number } {
    const r = svg.getBoundingClientRect();
    return { x: (clientX - r.left - cam.x) / cam.k, y: (clientY - r.top - cam.y) / cam.k };
  }
  // Lock the camera on the risen warden, framed so the whole template is in view.
  function frameBoss(): void {
    if (!s || !s.boss) return;
    const m = Math.min(svg.clientWidth, svg.clientHeight);
    cam.k = clamp(m / (s.boss.r * 3.4), minK, maxK);
    centerCam(s.boss.cx, s.boss.cy);
  }

  // ----- Input: a floating joystick (touch) + WASD/arrows (desktop). -----
  const STICK_MAX = 60;
  const move: Move = { x: 0, y: 0 };
  const keys = new Set<string>();
  const pointers = new Map<number, { x: number; y: number }>();
  let stick: { id: number; ox: number; oy: number } | null = null;
  let pinch: { d: number; k: number } | null = null;
  let bossPtr: number | null = null; // the pointer id drawing the warden trace

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
    // During the warden duel a touch begins a finger-trace, not the joystick.
    if (s && s.phase === "boss") {
      bossPtr = e.pointerId;
      bossTrace = [worldPt(e.clientX, e.clientY)];
      return;
    }
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
    if (s && s.phase === "boss") {
      if (bossPtr === e.pointerId && bossTrace) bossTrace.push(worldPt(e.clientX, e.clientY));
      return;
    }
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
    // Releasing during the duel submits the finger-trace to the warden.
    if (bossPtr === e.pointerId) {
      if (s && s.phase === "boss" && bossTrace) {
        const q = submitTrace(s, bossTrace);
        showToast(
          q > 0.85 ? "The seal takes — the Veilwarden reels."
          : q > 0.5 ? "A rough seal, but it bites home."
          : q > 0 ? "The line strays from the glyph — barely a mark."
          : "The seal breaks — follow the whole glyph.",
        );
      }
      bossPtr = null; bossTrace = null;
      return;
    }
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
    if (s && s.phase === "boss") return; // the duel locks the camera
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

  const ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
  function hud(): void {
    if (!s) return;
    hpFill.style.width = Math.max(0, (s.hero.hp / s.hero.maxHp) * 100) + "%";
    cityEl.textContent = s.level.name;
    sigilEl.textContent = s.type.name;
    sigilEl.style.color = s.type.star;
    // The duel: show the warden's health where the shade count would be.
    if (s.boss && s.phase === "boss") {
      foesEl.textContent = `Veilwarden ${Math.ceil((s.boss.hp / s.boss.maxHp) * 100)}%`;
      lightsEl.textContent = `${s.litCount} / ${s.dwellingsTotal} lit`;
      return;
    }
    const alive = aliveShades(s);
    let foes = `${alive} / ${s.total} shades`;
    // When only a handful remain, point toward the nearest so the last few of a
    // big map aren't a blind hunt.
    if (alive > 0 && alive <= 3) {
      let best: Shade | null = null, bd = Infinity;
      for (const e of s.shades) {
        if (e.dead) continue;
        const d = (e.x - s.hero.x) ** 2 + (e.y - s.hero.y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        const ang = Math.atan2(best.y - s.hero.y, best.x - s.hero.x);
        foes += ` ${ARROWS[(((Math.round(ang / (Math.PI / 4))) % 8) + 8) % 8]}`;
      }
    }
    foesEl.textContent = foes;
    lightsEl.textContent = `${s.litCount} / ${s.dwellingsTotal} lit`;
    cityEl.textContent = s.level.name;
    sigilEl.textContent = s.type.name;
    sigilEl.style.color = s.type.star;
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

    if (s.phase === "fight") {
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
      // stepCombat may have raised the warden (cast defeats the "fight" narrowing).
      if ((s.phase as Phase) === "boss") onBossRise(); // the host just fell
      else centerCam(s.hero.x, s.hero.y);
    } else if (s.phase === "boss") {
      stepBoss(s, dt);
      frameBoss();
    }

    render(s, layer);
    hud();

    if (s.phase === "won") { running = false; onWin(); return; }
    if (s.phase === "lost") { running = false; onLost(); return; }
    requestAnimationFrame(pgFrame);
  }

  // The host has fallen and the warden risen: drop the joystick, lock the camera
  // on the warden, and tell the carrier how the duel is fought.
  function onBossRise(): void {
    bossTrace = null; bossPtr = null;
    move.x = 0; move.y = 0; stick = null; hideStick();
    frameBoss();
    showToast("The Veilwarden rises. Trace its seal with your finger — follow the glowing glyph end to end; a clean, complete line burns deepest. It snuffs when the violet ring fills; race it down.");
  }

  function startCity(level: LevelDef): void {
    s = buildArena(level);
    loadCitySprites(level.id, repaint);
    hideOverlay();
    setupZoom();
    centerCam(s.hero.x, s.hero.y);
    hud();
    showToast("Stand still to inscribe the pentagram. Move to dodge — weave around presses, shrines and fences, run the pathways to kite the swarm, and light the dark dwellings. Keep out of the drifting veil pools (they unravel the sigil), break a shielded champion with a FULL inscription, and gather the embers the fallen leave to bite harder.");
    running = true; lastFrame = 0;
    requestAnimationFrame(pgFrame);
  }

  function onWin(): void {
    if (!s) return;
    const ms = s.elapsed;
    const lit = s.litCount, total = s.dwellingsTotal;
    const sc = scoreRun(s);
    const l = recordClear(s.level, ms, lit, sc.embers);
    const best = l.best[s.level.id];
    const relit = lit >= total && total > 0
      ? `You relit every dwelling — <em>${total}</em>. The city is whole again.`
      : `You relit <em>${lit}</em> of ${total} dwellings.`;
    const row = (label: string, val: string) =>
      `<div><dt>${label}</dt><dd>${val}</dd></div>`;
    const breakdown =
      `<div class="legacy"><div class="legacy-head">Score</div><dl>` +
      row("Host cleared", `${sc.base}`) +
      row("Speed", `${sc.speed}`) +
      row("Dwellings relit", `${sc.dwellings}`) +
      row("Survival", `${sc.survival}`) +
      (sc.untouched ? row("Untouched", `${sc.untouched}`) : "") +
      row("City difficulty", `×${sc.mult}`) +
      row("<strong>Total</strong>", `<strong>${sc.total}</strong>`) +
      row("Embers earned", `+${sc.embers} <span class="legacy-new">${l.embers} banked</span>`) +
      `</dl></div>`;
    showOverlay(
      "The city is cleansed",
      `Every shade in <em>${s.level.name}</em> is undone — ${s.total} of them — ` +
      `and the Veilwarden broken, in <em>${fmtTime(ms)}</em>.<br><br>` +
      `${relit}<br><br>` +
      (best === ms ? `<em>A new best for this city.</em>` : `Best here: ${fmtTime(best)}.`) +
      breakdown,
      "Descend again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function onLost(): void {
    if (!s) return;
    recordDeath(s.litCount);
    const how = s.boss
      ? `The Veilwarden of <em>${s.level.name}</em> snuffed your flame with ` +
        `<em>${Math.ceil((s.boss.hp / s.boss.maxHp) * 100)}%</em> of it still standing.`
      : `The watch of <em>${s.level.name}</em> pulled you down with ` +
        `<em>${aliveShades(s)}</em> shades still standing.`;
    showOverlay(
      "You fell",
      `${how}<br><br>` +
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

    // Sigils — the unlockable pentagrams. Each clear banks embers; spend them
    // here to own a sigil, then equip it for your next descent.
    html +=
      `<div class="legacy"><div class="legacy-head">` +
      `Sigils <span class="legacy-new">${l.embers} embers</span></div></div>` +
      `<div class="ptypes">`;
    for (const t of PENTA_TYPES) {
      const owned = l.unlocked.includes(t.id);
      const equipped = l.equipped === t.id;
      const afford = l.embers >= t.cost;
      let badge: string, act: string, disabled = false;
      if (equipped) { badge = ` <span class="legacy-new">equipped</span>`; act = ""; disabled = true; }
      else if (owned) { badge = ""; act = "equip"; }
      else if (afford) { badge = ` <span class="legacy-new">${t.cost} embers</span>`; act = "unlock"; }
      else { badge = ` <span class="ptype-cost">${t.cost} embers</span>`; act = ""; disabled = true; }
      const verb = act === "equip" ? "Equip" : act === "unlock" ? "Unlock" : equipped ? "Equipped" : "Locked";
      html +=
        `<button class="ptype${equipped ? " sel" : ""}" data-id="${t.id}" data-act="${act}"${disabled ? " disabled" : ""}>` +
        `<span class="city-name"><span class="ptype-swatch" style="background:${t.star};box-shadow:0 0 6px ${t.ring}"></span>${t.name}${badge}</span>` +
        `<span class="city-line">${t.desc}</span>` +
        `<span class="ptype-verb">${verb}</span></button>`;
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
    overlay.querySelectorAll<HTMLButtonElement>(".ptype").forEach((b) => {
      const id = b.dataset.id || "", act = b.dataset.act || "";
      if (!act) return;
      b.onclick = () => {
        if (act === "unlock") { unlockType(id); equipType(id); }
        else if (act === "equip") equipType(id);
        showPicker(); // re-render so the new ownership/equip state shows
      };
    });
  }

  byId("reset").addEventListener("click", () => showPicker());

  // Force-fresh the app to the newest deployed version. A cache-first service
  // worker keeps serving the offline copy of the shell until its cache retires,
  // so a shipped fix can sit invisible behind a stale cache. This drops every
  // cache and unregisters the worker, then reloads — the next load fetches the
  // current files from the network. The legacy lives in localStorage, untouched;
  // this clears cached *files*, not progress.
  const refreshBtn = byId("refresh");
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.textContent = "Updating…";
    try {
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch { /* best effort — reload regardless */ }
    location.reload();
  });

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
    stepVeils, inVeil, stepMotes, killShade, weaveVeils,
    startBoss, stepBoss, submitTrace, pentagramSegments, traceScore,
    makeSeal, sealSegments, sealPath, hashSeed,
    aliveShades, clearedPct, scoreRun, difficultyMult, LEVELS, levelById,
    weaveSegments, closestOnSegment,
    loadPgLegacy, recordClear, recordDeath, emptyPgLegacy, unlockType, equipType,
    PENTA_TYPES, pentaTypeById,
    K: {
      W, H, HERO_HP, HERO_RADIUS, HERO_STILL_MAXSPEED, HERO_IFRAMES_MS, HERO_SPEED,
      PENTA_RADIUS, PENTA_PULSE_MS, PENTA_DMG, PENTA_CHARGE_MS,
      SHADE_HP, SHADE_RADIUS, SHADE_CONTACT_DMG, SHADE_PER_KEEPER,
      AGGRO_RADIUS, SHADE_WANDER_SPEED, SHADE_LEASH,
      OBSTACLE_RADIUS, DWELLING_HEAL, FENCE_HALF, PATHWAY_HALF, PATHWAY_BOOST,
      SCORCH_RADIUS, SCORCH_MAX,
      ELITE_HP_MUL, ELITE_CONTACT_DMG,
      VEIL_RADIUS, VEIL_DRIFT, VEIL_DRAIN_MUL,
      MOTE_DROP_CHANCE, MOTE_TTL_MS, MOTE_RADIUS, MOTE_SURGE_MS, MOTE_SURGE_DMG,
      BOSS_RING_R, BOSS_HP, BOSS_TRACE_DMG, BOSS_BITE_MS, BOSS_BITE_DMG,
      TRACE_TOL_FRAC, TRACE_MIN_POINTS,
      SEAL_NODES_MIN, SEAL_NODES_MAX, SEAL_INNER_FRAC,
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
