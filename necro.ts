// The Necromancer's March — a third action-combat spinoff of The Light-Bringer.
//
// A thematic INVERSION of the parent. Where the lightbringer kindled houses, the
// necromancer DESECRATES graves to raise an army of the dead and overruns a
// village defended by knights. You walk a hooded commander through one of the
// villages this generator lays out; standing near an open grave RAISES skeleton
// minions (paid for with souls). The minions follow you and auto-target the
// nearest knight; the knights defend their posts and fight back against both your
// horde and you. Razing the houses desecrates them and HEALS your horde — the
// inversion of the parent's lit-dwelling vigil. Clear every knight and the
// village is overrun; lose your own HP and you fall.
//
// This file is deliberately self-contained as a TS MODULE (it ends with
// `export {};`) so its top-level names (W, render, start, LEVELS, …) are
// module-scoped and never collide with app.ts (a classic global script) or its
// sibling pentagram.ts. The page loads it with <script type="module">; the test
// loads it via dynamic import(). The simulation is pure and headless (NecroState
// in, mutation out); the render pass only reads it — the same split that lets
// smoke-test.mjs/pentagram-test.mjs drive the others lets necro-test.mjs drive
// this. Sections below:
//   Types -> Tuning -> Villages -> Arena generation -> March sim -> Sprites ->
//   Render -> Game shell -> Legacy -> SW + test seam.

// ---------- Types ----------

// Patrol POSTS are a placement role for the knights (where they muster), NOT a
// node kind — so the kinds are the pure village fabric.
type NodeKind = "house" | "well" | "altar" | "grave";
type Phase = "march" | "won" | "lost";

// A knight guards its post until the necromancer or a minion comes near, then
// engages. A minion follows the necromancer until a knight is in reach, then
// attacks. Aggro is sticky once roused.
type KnightState = "guard" | "engage";
type MinionState = "follow" | "attack";

// The battlefield is dressed from a village's nodes. A house can be `desecrated`
// (razed — the inversion of the parent's `lit`); held long enough it `risen`s into
// a bone-totem ally emitter (inversion of `awoke`). A knight can `reconsecrate` a
// desecrated house (re-bless it), scarring the ground so it can't be razed again
// for a while (inversion of the snuff scar). A grave carries a finite number of
// `raisesLeft` until `graveSpent`; an altar carries a one-shot burst until `spent`.
// All of these are live-play state — never persisted.
interface ArenaNode {
  x: number; y: number; kind: NodeKind;
  desecrated?: boolean; // a house razed by the horde (inversion of dwelling `lit`)
  desecAt?: number;     // s.elapsed when it was razed (ages toward rising)
  risen?: boolean;      // a razed house that held long enough — now a bone-totem
  reconsecrated?: number; // a re-blessed house's scar: s.elapsed it bars re-desecration to
  raisesLeft?: number;  // raises a grave still holds (counts down to graveSpent)
  graveSpent?: boolean; // a grave emptied of its dead
  spent?: boolean;      // an altar whose one-shot blood-burst has fired
}

// A line segment strung between two posts. Barricades are walls (block bodies,
// capsule-collision); causeways are open lanes (the necromancer runs swift along
// them). Both are pure geometry, woven from node positions at build.
interface Segment { x1: number; y1: number; x2: number; y2: number }

// The necromancer — the commander.
interface Hero {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  hurt: number; // remaining i-frame ms after a knight's blow (0 = vulnerable)
  charge: number; // 0..1 — how fully the raising-pentagram is inscribed (ramps while still)
  angle: number;  // the sigil's slow cosmetic spin, in degrees
}

// A raised skeleton minion — the horde. Follows the necromancer until a knight is
// in reach, then closes and swings. Frail individually; lethal as a swarm.
interface Minion {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  dead: boolean;
  state: MinionState;
  targetIdx: number; // index into s.knights of its current quarry (-1 = none)
  attackCd: number;  // ms until it can swing again
  hit: number;       // s.elapsed time until which it flashes from a fresh blow
  bornAt: number;    // s.elapsed it was raised (for the spawn flourish)
}

// A village knight — the watch, inverted. Guards its post (wandering on a leash)
// until a threat (the necromancer OR a minion) comes within aggro, then engages,
// targeting the nearest threat and swinging on a cooldown. Mirror of pentagram's
// Shade, with the role flipped: it fights an army, not a lone hero.
interface Knight {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  dead: boolean;
  state: KnightState;
  wanderAngle: number;
  wanderTimer: number;
  homeX: number; homeY: number; // its post anchor (the leash centre)
  attackCd: number;             // ms until it can swing again
  hit: number;                  // s.elapsed time until which it flashes from a blow
  captain?: boolean;            // a stouter knight: more hp, bites harder
  archer?: boolean;             // reserved (deferred, mirrors the spitter): unused for now
}

// FX, drawn then faded — never persisted. A Raise is the bone-burst ring on a
// raise; a Wisp is a soul mote a slain knight drops, gathered for souls.
interface Raise { x: number; y: number; r: number; until: number }
interface Wisp { x: number; y: number; until: number }

interface NecroState {
  level: LevelDef;
  w: number; h: number;
  scenery: ArenaNode[];
  solids: ArenaNode[];   // scenery the bodies can't pass (wells + altars)
  graves: ArenaNode[];   // cached open graves (the raise sites)
  barricades: Segment[]; // walls the bodies must weave around
  causeways: Segment[];  // open lanes the necromancer runs swift along
  hero: Hero;            // the necromancer
  souls: number;         // the raise resource
  minions: Minion[];
  knights: Knight[];
  wisps: Wisp[];         // gatherable soul motes dropped by slain knights
  raises: Raise[];       // fading bone-burst rings (cosmetic)
  elapsed: number;       // ms since the march began (clear time)
  kills: number;         // knights felled
  hits: number;          // times a knight has landed a blow on the necromancer
  total: number;         // the finite host: defeat them all to win
  housesTotal: number;   // standing houses the village began with
  desecCount: number;    // houses razed right now (secondary objective)
  reconsecrated: number; // houses the watch has re-blessed this march
  raisedTotal: number;   // minions raised across the whole march
  phase: Phase;
}

interface Move { x: number; y: number } // normalized input vector, -1..1 each

// ---------- Tuning ----------
// The design surface. Balance changes should be constant changes here, the same
// ethos as app.ts/pentagram.ts's tuning block.

const W = 1500;
const H = 2000;

// The necromancer.
const HERO_SPEED = 248;          // travel, world units per second
const HERO_RADIUS = 16;
const HERO_HP = 110;
const HERO_IFRAMES_MS = 700;     // grace after a blow, no further damage
const HERO_KNOCKBACK = 60;       // units the necromancer is shoved back by a blow

// Souls — the raise economy. A march begins with SOUL_START; each grave near you,
// off cooldown, with raises left and souls to spend, raises a handful of minions.
// Felling a knight grants souls (and may drop a gatherable soul-wisp).
const SOUL_START = 6;
const RAISE_COST = 2;            // souls per raise pulse from a grave
const RAISE_MIN = 1;             // skeletons raised per pulse (low)
const RAISE_MAX = 3;             // …and high (inclusive)
const GRAVE_REACH = 70;          // necromancer centre within this (+grave radius) raises
const GRAVE_RADIUS = 18;         // a grave's footprint (for the reach test)
const GRAVE_RAISES = 5;          // raise pulses a grave holds before it is spent
const GRAVE_COOLDOWN_MS = 900;   // ms between raise pulses from one grave
const SOUL_PER_KILL = 1;         // souls a felled knight grants directly

// The raising-pentagram — the necromancer's sigil and the gate on every raise.
// Standing still inscribes it (charge ramps to 1); marching lets it fade. The dead
// rise ONLY beneath a sufficiently-inscribed sigil (stepRaise gates on PENTA_RAISE_AT),
// so a raise is a deliberate stand over a grave — not something you do on the run.
// Mirror of the Burning Vigil's stand-still pentagram, inverted from smiting to raising.
const HERO_STILL_MAXSPEED = 40;  // travel slower than this (units/s) to inscribe
const PENTA_CHARGE_MS = 420;     // time stationary to fully inscribe (and to fade)
const PENTA_RAISE_AT = 0.6;      // the sigil raises the dead once at least this inscribed
const PENTA_RADIUS = 64;         // the sigil's drawn reach around the necromancer
const PENTA_SPIN = 0.05;         // degrees of sigil rotation per ms (cosmetic)
const WISP_DROP_CHANCE = 0.5;    // fraction of kills that leave a gatherable wisp
const WISP_SOULS = 1;            // souls a gathered wisp grants
const WISP_TTL_MS = 7000;        // how long a wisp waits to be gathered
const WISP_RADIUS = 18;          // gather reach (over and above the hero's radius)

// The minions (skeletons).
const MINION_HP = 26;
const MINION_SPEED = 150;        // travel, units per second
const MINION_RADIUS = 13;
const MINION_DMG = 11;           // damage per swing to a knight
const MINION_ATTACK_CD = 620;    // ms between a minion's swings
const MINION_ATTACK_REACH = 16;  // a minion within this (+radii) of a knight can swing
const MINION_SEP = 26;           // minions push apart within this, so they swarm
const MINION_FOLLOW_DIST = 64;   // a follower trails the necromancer, stopping at this
const MINION_AGGRO = 340;        // a knight within this of a minion becomes its quarry
const MINION_CAP = 40;           // the most minions that may stand at once

// The knights (the village watch, inverted).
const KNIGHT_HP = 60;
const KNIGHT_SPEED = 120;        // engage speed, units per second
const KNIGHT_RADIUS = 17;
const KNIGHT_DMG = 12;           // damage per swing (to a minion or the necromancer)
const KNIGHT_ATTACK_CD = 720;    // ms between a knight's swings
const KNIGHT_ATTACK_REACH = 18;  // a knight within this (+radii) of a threat can swing
const KNIGHT_SEP = 30;           // knights push apart, so they form a line not a stack
const KNIGHT_PER_POST = 3;       // how many knights each post musters (the host gate)
const AGGRO_RADIUS = 360;        // a threat within this of a guard rouses it to engage
const KNIGHT_WANDER_SPEED = 40;  // idle drift, units/s
const KNIGHT_WANDER_RETARGET_MS = 1500; // re-roll a wander heading this often
const KNIGHT_LEASH = 250;        // a guard steers home if it drifts past this
const CLEANUP_AGGRO_FRAC = 0.2;  // once this few remain, all rouse so a march always ends
const CAPTAIN_HP_MUL = 2.4;      // a captain's hp over a common knight
const CAPTAIN_DMG = 17;          // damage a captain's swing deals (vs KNIGHT_DMG)

// Obstacles — the village's solid structures (wells, altars) block bodies; the
// hero, minions and knights weave around them. Houses and graves are passable
// (you raze the former, raise at the latter). Radii are roughly the footprint.
const OBSTACLE_KINDS = new Set<NodeKind>(["well", "altar"]);
const OBSTACLE_RADIUS: Partial<Record<NodeKind, number>> = { well: 22, altar: 24 };

// Barricades — walls strung between neighbouring posts. They block movement (a
// capsule: the segment plus this half-thickness) for every body, but NOT the
// totem/altar bursts. The necromancer weaves them as cover.
const BARRICADE_HALF = 8;        // half-thickness of a barricade wall (collision)
const BARRICADE_VIS_THICK = 26;  // drawn thickness of the barricade sprite

// Causeways — open lanes the necromancer runs swift along (cleared roads).
const CAUSEWAY_HALF = 30;        // half-width of a causeway lane
const CAUSEWAY_BOOST = 1.4;      // hero speed multiplier while on a causeway

// Houses — razing one desecrates it, HEALING the horde (inversion of the parent's
// lit-dwelling mend). Held long enough a razed house RISES into a bone-totem that
// pulses the watch; a knight can re-bless (reconsecrate) a razed one, scarring the
// ground so it can't be razed again for a while. All live-play, never persisted.
const DESEC_REACH = 22;          // a minion within this (+radii) of a house razes it
const DESEC_HEAL = 8;            // HP mended, distributed across the horde, per raze
const HEAL_CAP = 0.7;            // …but the village can only rally the horde to this frac of maxHp
const HOUSE_RISE_MS = 5200;      // a razed house held this long rises into a totem…
const TOTEM_RADIUS = 96;         // …and then pulses knights within this each frame
const TOTEM_DMG = 9;             // …for this much per second (autonomous, no charge gate)
const RECONSECRATE_REACH = 26;   // a knight within this (+radii) of a razed house re-blesses it
const RECONSECRATE_MS = 6000;    // a re-blessed house scars the ground this long (barring re-razing)
const SCAR_RADIUS = 60;          // the scar's drawn reach (it bars re-razing, not the horde's path)

// Altar — a blood/bone altar, body-blocking, holds a one-shot burst. Stand by it
// and it fires: a wide burst that fells/wounds every knight and razes every house
// in reach, then the altar is spent.
const ALTAR_TRIGGER_REACH = 46;  // necromancer centre within this (+altar radius) fires it
const ALTAR_BURST_R = 200;       // the burst's reach
const ALTAR_BURST_DMG = 60;      // damage dealt to every knight caught

// Scoring — overrunning a village banks a score. Tuned for relationships, not
// magnitudes: faster pays, a razed/unscathed village pays, and a harder village
// multiplies it all. (No embers — perks are deferred in this first playable.)
const SCORE_PER_KNIGHT = 100;        // base, per knight in the host
const SCORE_TARGET_PER_KNIGHT = 1700; // ms per knight you're "expected" to take
const SCORE_SPEED_PER_SEC = 20;      // points per second cleared under that target
const SCORE_HOUSES_MAX = 300;        // full points for a fully-razed village
const SCORE_SURVIVAL_MAX = 200;      // full points for full HP at the overrun
const SCORE_UNTOUCHED = 250;         // flawless bonus (no blow landed all march)

const HIT_FLASH_MS = 150;        // how long a body flashes from a fresh blow
const NECRO_LEGACY_KEY = "necromancer.legacy.v1";

// ---------- Villages (levels) ----------
// Hand-tuned villages, the same generation dials the parent's cities use, trimmed
// and renamed: how many places, how dense, how many wells/altars/graves (the raise
// sites), and how many patrol posts (each musters a wave of knights — the host
// gate). A march has no flame to spend and no dawn to reach.
interface LevelDef {
  id: string;
  name: string;
  epigraph: string;
  art?: string;        // optional establishing image (art/village-*.jpg); silent-fail
  nodeCount: number;
  minDist: number;
  houseFrac: number;   // fraction of placed nodes that stay plain ground (not a house)
  wellCount: number;
  altarCount: number;
  graveCount: number;  // open graves — the raise sites
  postCount: number;   // patrol posts — each musters KNIGHT_PER_POST knights
  postSpacing: number;
  barricadeCount: number; // walls woven between neighbouring posts (cover)
  causewayCount: number;  // open lanes the necromancer runs swift along
  captainCount?: number;  // posts whose lead knight is a stout captain (default 0)
  archerCount?: number;   // reserved (deferred): posts with a ranged knight (default 0)
  sizeScale?: number;     // arena size = W/H × this (default 1); leans the difficulty
}

const LEVELS: LevelDef[] = [
  {
    id: "hollowmere",
    name: "Hollowmere",
    epigraph: "A drowsy lakeside hamlet, its watch thin and its dead shallow-buried. A fair first march.",
    art: "art/village-hollowmere.jpg",
    nodeCount: 112, minDist: 72,
    houseFrac: 0.18, wellCount: 4, altarCount: 2, graveCount: 6,
    postCount: 5, postSpacing: 360,
    barricadeCount: 7, causewayCount: 6, sizeScale: 0.9,
  },
  {
    id: "tithe-barrows",
    name: "The Tithe Barrows",
    epigraph: "Burial mounds heaped over generations. Graves are many here — but so are the knights who keep them.",
    art: "art/village-barrows.jpg",
    nodeCount: 124, minDist: 66,
    houseFrac: 0.22, wellCount: 3, altarCount: 4, graveCount: 9,
    postCount: 7, postSpacing: 320,
    barricadeCount: 6, causewayCount: 9, captainCount: 2, sizeScale: 1.0,
  },
  {
    id: "saint-aubers",
    name: "Saint Auber's Rest",
    epigraph: "A walled chantry-town where the faithful sleep. The watch is thick and the barricades many.",
    art: "art/village-aubers.jpg",
    nodeCount: 118, minDist: 70,
    houseFrac: 0.16, wellCount: 5, altarCount: 3, graveCount: 5,
    postCount: 9, postSpacing: 270,
    barricadeCount: 12, causewayCount: 4, captainCount: 4, sizeScale: 1.1,
  },
  {
    id: "gallows-fen",
    name: "Gallows Fen",
    epigraph: "Marsh and gibbet, far from any lord's help. Few houses, but the dead lie thick and willing.",
    art: "art/village-fen.jpg",
    nodeCount: 104, minDist: 84,
    houseFrac: 0.30, wellCount: 2, altarCount: 5, graveCount: 8,
    postCount: 6, postSpacing: 400,
    barricadeCount: 10, causewayCount: 3, captainCount: 2, sizeScale: 1.15,
  },
];

function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

// ---------- Arena generation ----------
// The same Poisson-disc-ish placement + kind assignment as the parent, trimmed to
// return plain {x,y,kind} nodes (no edges/adjacency — a march never spreads light
// along streets). Most nodes are houses; a houseFrac slice stays plain ground;
// wellCount wells + altarCount altars are scattered; patrol posts are placed with
// spacing; then graves are placed clear of the posts and of each other.

function generateNecroVillage(
  level: LevelDef,
  w = W * (level.sizeScale ?? 1),
  h = H * (level.sizeScale ?? 1),
): { nodes: ArenaNode[]; posts: { x: number; y: number }[] } {
  const nodes: ArenaNode[] = [];
  let guard = 0;
  while (nodes.length < level.nodeCount && guard++ < 20000) {
    const x = 60 + Math.random() * (w - 120);
    const y = 60 + Math.random() * (h - 120);
    if (nodes.every((n) => (n.x - x) ** 2 + (n.y - y) ** 2 > level.minDist ** 2)) {
      nodes.push({ x, y, kind: "house" });
    }
  }

  const shuffled = [...nodes].sort(() => Math.random() - 0.5);
  // A houseFrac slice stays plain ground — modelled as a passable "house" that
  // never desecrates is wrong; instead they become wells removed below? No: keep
  // it simple and faithful — the frac is just left as houses; wells/altars/graves
  // are carved out of the shuffled pool, the rest are houses (standing dwellings).
  const nGround = Math.floor(nodes.length * level.houseFrac);
  // Plain ground: mark a slice as wells-less filler by leaving them houses is not
  // ideal, so we drop them from the desecratable set by turning them into "well"
  // would block movement. Instead, plain ground is simply fewer houses — we carve
  // wells/altars first, then graves, then the rest remain houses. The houseFrac
  // governs how many are pulled aside as non-house scatter (wells stand in for it
  // only via wellCount). To honour houseFrac without inventing a kind, we leave a
  // nGround slice as houses too — they are the village's plain homes. (Kept simple.)
  void nGround;

  let cursor = 0;
  const take = (n: number): ArenaNode[] => {
    const slice = shuffled.slice(cursor, cursor + n);
    cursor += n;
    return slice;
  };
  take(level.wellCount).forEach((n) => (n.kind = "well"));
  take(level.altarCount).forEach((n) => (n.kind = "altar"));

  // Patrol posts — placed on still-house nodes, spaced apart so waves don't stack.
  const posts: { x: number; y: number }[] = [];
  for (const n of shuffled) {
    if (n.kind !== "house") continue;
    if (posts.every((p) => (p.x - n.x) ** 2 + (p.y - n.y) ** 2 > level.postSpacing ** 2)) {
      posts.push({ x: n.x, y: n.y });
      if (posts.length >= level.postCount) break;
    }
  }

  // Graves — placed on still-house nodes, clear of the posts and of each other so
  // a raise site is never atop a muster point.
  const graveSpacing = level.minDist * 1.4;
  const graves: ArenaNode[] = [];
  for (const n of shuffled) {
    if (n.kind !== "house") continue;
    if (posts.some((p) => (p.x - n.x) ** 2 + (p.y - n.y) ** 2 < (level.postSpacing * 0.5) ** 2)) continue;
    if (graves.every((g) => (g.x - n.x) ** 2 + (g.y - n.y) ** 2 > graveSpacing ** 2)) {
      n.kind = "grave";
      n.raisesLeft = GRAVE_RAISES;
      graves.push(n);
      if (graves.length >= level.graveCount) break;
    }
  }

  return { nodes, posts };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Closest point on segment AB to P, and the distance to it. The workhorse for
// both barricade collision (capsule = segment + radius) and "is the hero on a
// causeway?" (distance to the lane's centre line).
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
// along the village grid. Barricades want short gaps (walls between neighbours);
// causeways want longer gaps (lanes across a quarter). Graves are skipped so the
// raise sites stay clear. Pure geometry — it only reads the placed nodes.
function weaveSegments(
  nodes: ArenaNode[], count: number, lo: number, hi: number,
): Segment[] {
  const segs: Segment[] = [];
  const pool = nodes.filter((n) => n.kind !== "grave");
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

// Push a moving body (hero, minion or knight) out of any blocking terrain it has
// overlapped — solid scenery (circle-vs-circle) and barricades (circle-vs-segment)
// — then back inside the world bounds. Shove along the normal so a body slides
// along an edge rather than stopping dead.
function pushOut(s: NecroState, x: number, y: number, radius: number): { x: number; y: number } {
  for (const n of s.solids) {
    const rr = radius + (OBSTACLE_RADIUS[n.kind] || 0);
    let dx = x - n.x, dy = y - n.y;
    let d = Math.hypot(dx, dy);
    if (d >= rr) continue;
    if (d === 0) { dx = 1; dy = 0; d = 1; }
    x = n.x + (dx / d) * rr;
    y = n.y + (dy / d) * rr;
  }
  for (const f of s.barricades) {
    const rr = radius + BARRICADE_HALF;
    const c = closestOnSegment(x, y, f.x1, f.y1, f.x2, f.y2);
    if (c.d >= rr) continue;
    let dx = x - c.x, dy = y - c.y, d = c.d;
    if (d === 0) {
      const fx = f.x2 - f.x1, fy = f.y2 - f.y1, fl = Math.hypot(fx, fy) || 1;
      dx = -fy / fl; dy = fx / fl; d = 1;
    }
    x = c.x + (dx / d) * rr;
    y = c.y + (dy / d) * rr;
  }
  return { x: clamp(x, radius, s.w - radius), y: clamp(y, radius, s.h - radius) };
}

// Build a fresh march: dress the village, drop the necromancer at its heart, and
// muster a finite host of knights from each patrol post.
function buildArena(level: LevelDef): NecroState {
  const w = Math.round(W * (level.sizeScale ?? 1));
  const h = Math.round(H * (level.sizeScale ?? 1));
  const { nodes: scenery, posts } = generateNecroVillage(level, w, h);
  const barricades = weaveSegments(scenery, level.barricadeCount, level.minDist * 0.9, level.minDist * 2.0);
  const causeways = weaveSegments(scenery, level.causewayCount, level.minDist * 3, level.minDist * 5);
  const hero: Hero = {
    x: w / 2, y: h / 2, vx: 0, vy: 0, hp: HERO_HP, maxHp: HERO_HP, hurt: 0,
    charge: 0, angle: 0,
  };
  const knights: Knight[] = [];
  const captainCount = Math.min(level.captainCount ?? 0, posts.length);
  posts.forEach((post, pi) => {
    for (let j = 0; j < KNIGHT_PER_POST; j++) {
      const captain = j === 0 && pi < captainCount;
      const hp = captain ? KNIGHT_HP * CAPTAIN_HP_MUL : KNIGHT_HP;
      const a = Math.random() * Math.PI * 2;
      const r = 18 + Math.random() * 44;
      const x = clamp(post.x + Math.cos(a) * r, KNIGHT_RADIUS, w - KNIGHT_RADIUS);
      const y = clamp(post.y + Math.sin(a) * r, KNIGHT_RADIUS, h - KNIGHT_RADIUS);
      knights.push({
        x, y, vx: 0, vy: 0, hp, maxHp: hp, dead: false,
        state: "guard",
        wanderAngle: Math.random() * Math.PI * 2,
        wanderTimer: Math.random() * KNIGHT_WANDER_RETARGET_MS,
        homeX: post.x, homeY: post.y,
        attackCd: 0, hit: 0,
        captain,
      });
    }
  });
  return {
    level, w, h, scenery,
    solids: scenery.filter((n) => OBSTACLE_KINDS.has(n.kind)),
    graves: scenery.filter((n) => n.kind === "grave"),
    barricades, causeways,
    hero, souls: SOUL_START,
    minions: [], knights,
    wisps: [], raises: [],
    elapsed: 0, kills: 0, hits: 0, total: knights.length,
    housesTotal: scenery.filter((n) => n.kind === "house").length,
    desecCount: 0, reconsecrated: 0, raisedTotal: 0,
    phase: "march",
  };
}

const freshNecro = buildArena; // alias, mirrors app.ts freshGame naming

// ---------- March simulation (pure, headless-testable) ----------

function aliveKnights(s: NecroState): number {
  let n = 0;
  for (const e of s.knights) if (!e.dead) n++;
  return n;
}

function aliveMinions(s: NecroState): number {
  let n = 0;
  for (const m of s.minions) if (!m.dead) n++;
  return n;
}

function clearedPct(s: NecroState): number {
  return s.total ? s.kills / s.total : 1;
}

// The house readout for the HUD: how many houses are razed now, of the village's
// total, with a banner mark for any that have risen into bone-totems.
function houseReadout(s: NecroState): string {
  const risen = s.scenery.reduce((c, n) => c + (n.risen ? 1 : 0), 0);
  const base = `razed ${s.desecCount} / ${s.housesTotal}`;
  return risen ? `${base} · ${risen}⚑` : base;
}

// How much a village multiplies an overrun's score. Leans on the difficulty the
// data already encodes — the host size (postCount) and the ground to cover
// (sizeScale) — normalized so Hollowmere sits near 1.0 and the hardest near 1.5.
function difficultyMult(level: LevelDef): number {
  const pm = level.postCount / 5;     // 1.0 at hollowmere, ~1.8 at saint-aubers
  const sm = level.sizeScale ?? 1;
  return +(0.6 + 0.4 * pm * sm).toFixed(2);
}

interface ScoreBreakdown {
  base: number; speed: number; houses: number; survival: number;
  untouched: number; mult: number; total: number;
}

// Score a finished march. Pure — reads only the state, so the harness can drive
// it. Faster pays, a razed and unscathed village pays, and a harder village
// multiplies the lot.
function scoreRun(s: NecroState): ScoreBreakdown {
  const base = s.total * SCORE_PER_KNIGHT;
  const targetMs = s.total * SCORE_TARGET_PER_KNIGHT;
  const speed = Math.max(0, Math.round(((targetMs - s.elapsed) / 1000) * SCORE_SPEED_PER_SEC));
  const houses = s.housesTotal
    ? Math.round((s.desecCount / s.housesTotal) * SCORE_HOUSES_MAX) : 0;
  const survival = Math.round((s.hero.hp / s.hero.maxHp) * SCORE_SURVIVAL_MAX);
  const untouched = s.hits === 0 ? SCORE_UNTOUCHED : 0;
  const mult = difficultyMult(s.level);
  const total = Math.round((base + speed + houses + survival + untouched) * mult);
  return { base, speed, houses, survival, untouched, mult, total };
}

// Fell a knight: mark it dead, count the kill, grant souls directly, and — by
// chance — leave a gatherable soul-wisp where it fell. The single kill path, so
// every damage source (minion swing, totem pulse, altar burst) feeds souls the
// same way.
function killKnight(s: NecroState, e: Knight): void {
  if (e.dead) return;
  e.dead = true;
  s.kills++;
  s.souls += SOUL_PER_KILL;
  if (Math.random() < WISP_DROP_CHANCE) {
    s.wisps.push({ x: e.x, y: e.y, until: s.elapsed + WISP_TTL_MS });
  }
}

// Raise the dead: only while the raising-pentagram is inscribed (charge ≥ PENTA_RAISE_AT,
// i.e. the necromancer has held still — see stepMarch). Then for each grave he stands
// beside, off cooldown, with raises left and souls to spend and room in the horde,
// deduct souls, decrement
// the grave's raises (→ graveSpent), spawn RAISE_MIN..MAX minions in a burst, and
// push a bone-burst FX. The single raise path. A grave's cooldown rides on its own
// `desecAt`-style field — we reuse `desecAt` as the grave's last-raise time.
function stepRaise(s: NecroState): void {
  const h = s.hero;
  if (h.charge < PENTA_RAISE_AT) return; // the dead rise only beneath an inscribed sigil
  for (const g of s.graves) {
    if (g.graveSpent || !g.raisesLeft || g.raisesLeft <= 0) continue;
    const rr = (GRAVE_REACH + GRAVE_RADIUS) ** 2;
    if ((g.x - h.x) ** 2 + (g.y - h.y) ** 2 > rr) continue;
    // Cooldown: a grave's last-raise time is stored on desecAt (graves never
    // desecrate, so the field is free to reuse — keeps the node shape compact).
    const last = g.desecAt ?? -Infinity;
    if (s.elapsed - last < GRAVE_COOLDOWN_MS) continue;
    if (s.souls < RAISE_COST) continue;
    if (aliveMinions(s) >= MINION_CAP) continue;
    s.souls -= RAISE_COST;
    g.raisesLeft -= 1;
    g.desecAt = s.elapsed;
    if (g.raisesLeft <= 0) g.graveSpent = true;
    const n = RAISE_MIN + Math.floor(Math.random() * (RAISE_MAX - RAISE_MIN + 1));
    for (let i = 0; i < n; i++) {
      if (aliveMinions(s) >= MINION_CAP) break;
      const a = Math.random() * Math.PI * 2;
      const r = MINION_RADIUS + Math.random() * 22;
      const mx = clamp(g.x + Math.cos(a) * r, MINION_RADIUS, s.w - MINION_RADIUS);
      const my = clamp(g.y + Math.sin(a) * r, MINION_RADIUS, s.h - MINION_RADIUS);
      s.minions.push({
        x: mx, y: my, vx: 0, vy: 0,
        hp: MINION_HP, maxHp: MINION_HP, dead: false,
        state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: s.elapsed,
      });
      s.raisedTotal++;
    }
    s.raises.push({ x: g.x, y: g.y, r: 40, until: s.elapsed + 360 });
  }
}

// The nearest live knight to a point within `range` (or globally if `range` is
// Infinity, for the cleanup sweep), as an index into s.knights — or -1.
function nearestKnight(s: NecroState, x: number, y: number, range: number): number {
  let best = -1, bd = range * range;
  for (let i = 0; i < s.knights.length; i++) {
    const e = s.knights[i];
    if (e.dead) continue;
    const d = (e.x - x) ** 2 + (e.y - y) ** 2;
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

// The minions: each picks the nearest live knight in MINION_AGGRO as its quarry
// (or globally once only a handful of knights remain, so a march always ends). With
// a quarry → attack: steer toward it with separation, swing MINION_DMG on cooldown
// (killKnight at ≤0). With none → follow: trail the necromancer, stopping at
// MINION_FOLLOW_DIST so the horde clusters at his heel. pushOut after the move.
function stepMinions(s: NecroState, dt: number): void {
  const h = s.hero;
  const cleanup = aliveKnights(s) > 0 && aliveKnights(s) <= s.total * CLEANUP_AGGRO_FRAC;
  for (const m of s.minions) {
    if (m.dead) continue;
    m.attackCd = Math.max(0, m.attackCd - dt);

    // Pick a quarry: the nearest knight in aggro range (global during cleanup).
    const ti = nearestKnight(s, m.x, m.y, cleanup ? Infinity : MINION_AGGRO);
    m.targetIdx = ti;

    let dx: number, dy: number, speed: number;
    if (ti >= 0) {
      m.state = "attack";
      const target = s.knights[ti];
      dx = target.x - m.x; dy = target.y - m.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Swing if in reach, off cooldown.
      const reach = MINION_RADIUS + KNIGHT_RADIUS + MINION_ATTACK_REACH;
      if (dist <= reach && m.attackCd <= 0) {
        target.hp -= MINION_DMG;
        target.hit = s.elapsed + HIT_FLASH_MS;
        m.attackCd = MINION_ATTACK_CD;
        if (target.hp <= 0) killKnight(s, target);
      }
      dx /= dist; dy /= dist;
      // Separation among fellow minions so the horde packs rather than overlaps.
      for (const o of s.minions) {
        if (o === m || o.dead) continue;
        const ox = m.x - o.x, oy = m.y - o.y, od = Math.hypot(ox, oy);
        if (od > 0 && od < MINION_SEP) { dx += (ox / od) * 0.7; dy += (oy / od) * 0.7; }
      }
      const mm = Math.hypot(dx, dy) || 1; dx /= mm; dy /= mm;
      speed = MINION_SPEED;
    } else {
      m.state = "follow";
      dx = h.x - m.x; dy = h.y - m.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Separation so followers fan out around the necromancer.
      for (const o of s.minions) {
        if (o === m || o.dead) continue;
        const ox = m.x - o.x, oy = m.y - o.y, od = Math.hypot(ox, oy);
        if (od > 0 && od < MINION_SEP) { dx += (ox / od) * 0.6 * dist; dy += (oy / od) * 0.6 * dist; }
      }
      const mm = Math.hypot(dx, dy) || 1;
      dx /= mm; dy /= mm;
      speed = dist > MINION_FOLLOW_DIST ? MINION_SPEED : 0; // hold at the heel
    }
    m.vx = dx * speed; m.vy = dy * speed;
    const p = pushOut(s, m.x + (m.vx * dt) / 1000, m.y + (m.vy * dt) / 1000, MINION_RADIUS);
    m.x = p.x; m.y = p.y;
  }
}

// The nearest live minion to a point, as an index into s.minions — or -1.
function nearestMinion(s: NecroState, x: number, y: number, range: number): number {
  let best = -1, bd = range * range;
  for (let i = 0; i < s.minions.length; i++) {
    const m = s.minions[i];
    if (m.dead) continue;
    const d = (m.x - x) ** 2 + (m.y - y) ** 2;
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

// The knights (the inverted stepShades): each guards its post (wandering on a
// leash) until the necromancer OR any minion comes within AGGRO_RADIUS, then
// engages and never settles. Engaging, it targets the nearest THREAT — the
// necromancer or a minion, whichever is closer — closes, and swings on a cooldown:
// a minion takes a blow (and may die); the necromancer loses HP gated by i-frames
// (hits++, knockback). Once only a handful remain, the rest rouse so a march ends.
function stepKnights(s: NecroState, dt: number): void {
  const h = s.hero;
  const cleanup = aliveKnights(s) <= s.total * CLEANUP_AGGRO_FRAC;
  for (const e of s.knights) {
    if (e.dead) continue;
    e.attackCd = Math.max(0, e.attackCd - dt);

    // Rouse on proximity of any threat (necromancer or minion), or the cleanup
    // sweep. Aggro never settles back to guarding.
    if (e.state === "guard") {
      const heroNear = (h.x - e.x) ** 2 + (h.y - e.y) ** 2 <= AGGRO_RADIUS ** 2;
      const minNear = nearestMinion(s, e.x, e.y, AGGRO_RADIUS) >= 0;
      if (cleanup || heroNear || minNear) e.state = "engage";
    }

    let dx: number, dy: number, speed: number;
    if (e.state === "engage") {
      // Target the nearest threat: the necromancer, or the nearest minion.
      const mi = nearestMinion(s, e.x, e.y, Infinity);
      let tx = h.x, ty = h.y;
      let targetMinion: Minion | null = null;
      const heroD = (h.x - e.x) ** 2 + (h.y - e.y) ** 2;
      if (mi >= 0) {
        const m = s.minions[mi];
        const minD = (m.x - e.x) ** 2 + (m.y - e.y) ** 2;
        if (minD < heroD) { tx = m.x; ty = m.y; targetMinion = m; }
      }
      dx = tx - e.x; dy = ty - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Swing if in reach, off cooldown.
      if (e.attackCd <= 0) {
        const dmg = e.captain ? CAPTAIN_DMG : KNIGHT_DMG;
        if (targetMinion) {
          const reach = KNIGHT_RADIUS + MINION_RADIUS + KNIGHT_ATTACK_REACH;
          if (dist <= reach) {
            targetMinion.hp -= dmg;
            targetMinion.hit = s.elapsed + HIT_FLASH_MS;
            e.attackCd = KNIGHT_ATTACK_CD;
            if (targetMinion.hp <= 0) targetMinion.dead = true;
          }
        } else {
          const reach = KNIGHT_RADIUS + HERO_RADIUS + KNIGHT_ATTACK_REACH;
          if (dist <= reach && h.hurt <= 0) {
            h.hp -= dmg;
            s.hits++;
            h.hurt = HERO_IFRAMES_MS;
            e.attackCd = KNIGHT_ATTACK_CD;
            const kx = h.x - e.x, ky = h.y - e.y, kd = Math.hypot(kx, ky) || 1;
            const p = pushOut(s, h.x + (kx / kd) * HERO_KNOCKBACK, h.y + (ky / kd) * HERO_KNOCKBACK, HERO_RADIUS);
            h.x = p.x; h.y = p.y;
          }
        }
      }
      dx /= dist; dy /= dist;
      // Separation among fellow engagers so they form a line, not a stack.
      for (const o of s.knights) {
        if (o === e || o.dead || o.state !== "engage") continue;
        const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy);
        if (od > 0 && od < KNIGHT_SEP) { dx += (ox / od) * 0.7; dy += (oy / od) * 0.7; }
      }
      const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
      speed = KNIGHT_SPEED;
    } else {
      // Guard: drift along the heading, re-rolling on a timer; steer home if the
      // leash is taut so a guard never strays far from its post.
      e.wanderTimer -= dt;
      if (e.wanderTimer <= 0) {
        e.wanderAngle += (Math.random() - 0.5) * 1.6;
        e.wanderTimer = KNIGHT_WANDER_RETARGET_MS * (0.5 + Math.random());
      }
      const lx = e.x - e.homeX, ly = e.y - e.homeY;
      if (lx * lx + ly * ly > KNIGHT_LEASH ** 2) e.wanderAngle = Math.atan2(-ly, -lx);
      dx = Math.cos(e.wanderAngle); dy = Math.sin(e.wanderAngle);
      speed = KNIGHT_WANDER_SPEED;
    }
    e.vx = dx * speed; e.vy = dy * speed;
    const p = pushOut(s, e.x + (e.vx * dt) / 1000, e.y + (e.vy * dt) / 1000, KNIGHT_RADIUS);
    e.x = p.x; e.y = p.y;

    // A knight brushing a desecrated house re-blesses (reconsecrates) it back to
    // standing — unless the village's own ground forbids it (none here; mirror of
    // the shrine-protection seam, kept simple). Inversion of snuffDwelling.
    const sr2 = (KNIGHT_RADIUS + RECONSECRATE_REACH) ** 2;
    for (const n of s.scenery) {
      if (n.kind !== "house" || !n.desecrated) continue;
      if ((n.x - e.x) ** 2 + (n.y - e.y) ** 2 > sr2) continue;
      reconsecrateHouse(s, n);
    }
  }
}

// Raze a standing house to desecrated ground: count it, mend the horde, and (the
// inversion of the parent's kindle) leave it razed so it may rise into a totem. A
// still-scarred (re-blessed) house resists the horde (no re-razing). The single
// raze path, so the minion proximity and the altar burst raze a house identically.
function desecrateHouse(s: NecroState, n: ArenaNode, heal: number): void {
  if (n.kind !== "house" || n.desecrated) return;
  if (n.reconsecrated && n.reconsecrated > s.elapsed) return; // the scar still bars re-razing
  n.desecrated = true; n.desecAt = s.elapsed; n.risen = false; n.reconsecrated = 0;
  s.desecCount++;
  if (heal) {
    // The village rallies the horde only up to HEAL_CAP·maxHp; distribute the
    // mend across living minions so razing keeps a swarm on its feet.
    const live = s.minions.filter((m) => !m.dead);
    if (live.length) {
      const each = heal; // heal each living minion a little (clamped to its cap)
      for (const m of live) {
        const ceil = Math.max(m.hp, m.maxHp * HEAL_CAP);
        m.hp = Math.min(ceil, m.hp + each);
      }
    }
  }
}

// Re-bless a desecrated house back to standing: scar the ground (a deadline that
// bars re-razing for a while) and tally the loss. The inversion of snuffDwelling.
function reconsecrateHouse(s: NecroState, n: ArenaNode): void {
  if (n.kind !== "house" || !n.desecrated) return;
  n.desecrated = false; n.risen = false;
  n.reconsecrated = s.elapsed + RECONSECRATE_MS;
  if (s.desecCount > 0) s.desecCount--;
  s.reconsecrated++;
}

// Is the point over a re-blessed house's lingering scar? (Visual reach + tests —
// the re-raze bar itself lives in desecrateHouse.)
function nearScar(s: NecroState, x: number, y: number): boolean {
  for (const n of s.scenery) {
    if (n.kind !== "house" || !n.reconsecrated || n.reconsecrated <= s.elapsed) continue;
    if ((x - n.x) ** 2 + (y - n.y) ** 2 <= SCAR_RADIUS ** 2) return true;
  }
  return false;
}

// Houses razed long enough RISE into bone-totem ally emitters; and a risen totem
// burns the knights around it every frame on its own (autonomous — no charge gate,
// the inversion of the awakened-dwelling pulse). Run each frame.
function stepHouses(s: NecroState, dt: number): void {
  const tr2 = TOTEM_RADIUS ** 2;
  const tdmg = (TOTEM_DMG * dt) / 1000;
  for (const n of s.scenery) {
    if (n.kind !== "house" || !n.desecrated) continue;
    if (!n.risen && n.desecAt !== undefined && s.elapsed - n.desecAt >= HOUSE_RISE_MS) {
      n.risen = true;
    }
    if (!n.risen) continue;
    for (const e of s.knights) {
      if (e.dead) continue;
      if ((e.x - n.x) ** 2 + (e.y - n.y) ** 2 <= tr2) {
        e.hp -= tdmg;
        e.hit = s.elapsed + HIT_FLASH_MS;
        if (e.hp <= 0) killKnight(s, e);
      }
    }
  }
}

// Minions razing houses: a minion within reach of a standing, non-reblessed house
// razes it (mending the horde). Mirror of the dwelling-kindle pass, body-driven.
function stepDesecrate(s: NecroState): void {
  for (const n of s.scenery) {
    if (n.kind !== "house" || n.desecrated) continue;
    if (n.reconsecrated && n.reconsecrated > s.elapsed) continue;
    const rr = (MINION_RADIUS + DESEC_REACH) ** 2;
    for (const m of s.minions) {
      if (m.dead) continue;
      if ((n.x - m.x) ** 2 + (n.y - m.y) ** 2 <= rr) { desecrateHouse(s, n, DESEC_HEAL); break; }
    }
  }
}

// An altar fires its one-shot blood-burst when the necromancer stands beside it: a
// wide burst that fells/wounds every knight and razes every house in reach, then
// the altar is spent. The inversion of the parent's press cascade.
function stepAltar(s: NecroState): void {
  const h = s.hero;
  for (const n of s.scenery) {
    if (n.kind !== "altar" || n.spent) continue;
    const rr = (ALTAR_TRIGGER_REACH + (OBSTACLE_RADIUS.altar || 0)) ** 2;
    if ((n.x - h.x) ** 2 + (n.y - h.y) ** 2 > rr) continue;
    n.spent = true;
    const br2 = ALTAR_BURST_R ** 2;
    for (const e of s.knights) {
      if (e.dead) continue;
      if ((e.x - n.x) ** 2 + (e.y - n.y) ** 2 <= br2) {
        e.hp -= ALTAR_BURST_DMG;
        e.hit = s.elapsed + HIT_FLASH_MS;
        if (e.hp <= 0) killKnight(s, e);
      }
    }
    for (const d of s.scenery) {
      if (d.kind !== "house" || d.desecrated) continue;
      if ((d.x - n.x) ** 2 + (d.y - n.y) ** 2 <= br2) desecrateHouse(s, d, 0);
    }
    s.raises.push({ x: n.x, y: n.y, r: ALTAR_BURST_R, until: s.elapsed + 360 });
  }
}

// Gather any soul-wisp the necromancer has walked onto: souls += WISP_SOULS. Then
// retire faded (or gathered) wisps. The inversion of the parent's ember motes.
function stepWisps(s: NecroState): void {
  if (!s.wisps.length) return;
  const h = s.hero;
  const rr = (HERO_RADIUS + WISP_RADIUS) ** 2;
  for (const w of s.wisps) {
    if (w.until <= s.elapsed) continue;
    if ((w.x - h.x) ** 2 + (w.y - h.y) ** 2 <= rr) {
      w.until = 0; // consumed
      s.souls += WISP_SOULS;
    }
  }
  s.wisps = s.wisps.filter((w) => w.until > s.elapsed);
}

// One slice of march time, analogous to pentagram's stepCombat: integrate the
// necromancer from the input vector, raise minions at graves, move the horde, move
// the watch, resolve the house layer and altar burst, gather wisps, and check the
// terminal states.
function stepMarch(s: NecroState, dt: number, move: Move): void {
  if (s.phase !== "march") return;
  s.elapsed += dt;
  const h = s.hero;

  // Travelling along a cleared causeway runs the necromancer swift; off it, normal.
  const onPath = s.causeways.some(
    (p) => closestOnSegment(h.x, h.y, p.x1, p.y1, p.x2, p.y2).d <= CAUSEWAY_HALF,
  );
  const speed = HERO_SPEED * (onPath ? CAUSEWAY_BOOST : 1);
  h.vx = move.x * speed;
  h.vy = move.y * speed;
  {
    const p = pushOut(s, h.x + (h.vx * dt) / 1000, h.y + (h.vy * dt) / 1000, HERO_RADIUS);
    h.x = p.x; h.y = p.y;
  }
  if (h.hurt > 0) h.hurt = Math.max(0, h.hurt - dt);

  // The raising-pentagram inscribes while the necromancer holds still and bleeds
  // away as he marches; only an inscribed sigil raises the dead (see stepRaise).
  if (Math.hypot(h.vx, h.vy) < HERO_STILL_MAXSPEED) {
    h.charge = Math.min(1, h.charge + dt / PENTA_CHARGE_MS);
  } else {
    h.charge = Math.max(0, h.charge - dt / PENTA_CHARGE_MS);
  }
  h.angle = (h.angle + dt * PENTA_SPIN) % 360;

  stepRaise(s);        // an inscribed sigil over a grave raises skeletons (costs souls)
  stepWisps(s);        // gather any soul-wisp underfoot
  stepMinions(s, dt);  // the horde follows / auto-targets the watch
  stepKnights(s, dt);  // the watch guards / engages the horde and the necromancer
  stepDesecrate(s);    // minions raze the houses they reach (heals the horde)
  stepHouses(s, dt);   // razed houses rise into totems; totems burn the watch
  stepAltar(s);        // an altar by the necromancer fires its one-shot burst

  // Retire spent FX (cheap; only when any are live).
  if (s.raises.length) s.raises = s.raises.filter((r) => r.until > s.elapsed);

  // Terminal: the necromancer falls first; else the whole watch is overrun.
  if (h.hp <= 0) { h.hp = 0; s.phase = "lost"; }
  else if (s.knights.every((e) => e.dead)) { s.phase = "won"; } // the village is overrun
}

// ---------- Sprites (reused pattern from app.ts / pentagram.ts) ----------

const svgNS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const LOW_FX = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

// The base sprites this spinoff draws. Scenery uses the house (standing/
// desecrated/totem/reconsecrated)/well/altar/grave art; the necromancer is its own
// sprite; the knights have guard/engage faces; the minion is a skeleton.
const SPRITE_NAMES = [
  "ground", "house-standing", "house-desecrated", "house-totem", "house-reconsecrated",
  "well", "altar", "grave", "grave-spent",
  // Tiled terrain laid along a segment: barricade (the linear blocker) + causeway
  // (the speed lane). Universal — never a village re-skin. Render falls back to
  // procedural lines when the PNG is absent.
  "barricade", "causeway",
  "knight-guard", "knight-engage", "skeleton", "necromancer",
] as const;

// Which sprites a village may re-skin (art/<villageId>/<name>.png) — the built
// world. The four house states + well + altar match the parent's re-skinnable set.
const CITY_SPRITES = new Set<string>([
  "ground", "house-standing", "house-desecrated", "house-totem", "house-reconsecrated",
  "well", "altar",
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

// A tileable terrain texture (causeway / barricade) laid along a segment: a rect
// the length of the segment, exactly one tile tall, rotated to its heading and
// filled with a horizontally-tiling pattern. Used only when the PNG has loaded —
// callers fall back to the procedural lines otherwise.
function tiledSegment(patId: string, seg: Segment, thick: number, opacity: number): SVGRectElement {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const ang = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1) * 180 / Math.PI;
  return el("rect", {
    x: 0, y: 0, width: len, height: thick, fill: `url(#${patId})`, opacity,
    transform: `translate(${seg.x1.toFixed(1)} ${seg.y1.toFixed(1)}) rotate(${ang.toFixed(2)}) translate(0 ${(-thick / 2).toFixed(1)})`,
  });
}

// The raising-pentagram's five-pointed star, as an SVG path centred on (cx,cy).
// Pure geometry (mirrors pentagram.ts's, but this module shares nothing with it):
// five rim points stepped by 72°, joined in the 0-2-4-1-3 star order and closed.
function pentagramPath(cx: number, cy: number, r: number, rotDeg: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = ((-90 + rotDeg + i * 72) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const order = [0, 2, 4, 1, 3];
  let d = `M${pts[order[0]][0].toFixed(1)} ${pts[order[0]][1].toFixed(1)} `;
  for (let i = 1; i < 5; i++) d += `L${pts[order[i]][0].toFixed(1)} ${pts[order[i]][1].toFixed(1)} `;
  return d + "Z";
}

// ---------- Render (reads NecroState; wholesale rebuild each frame) ----------

// Built once: filters/gradients + the camera group. Adds the necrotic #necro
// palette (cold green/violet) in place of the parent's warm flame.
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
    <radialGradient id="haloRise">
      <stop offset="0%" stop-color="#d8ffe6" stop-opacity="1"/>
      <stop offset="28%" stop-color="#7affb0" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#7affb0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="necro">
      <stop offset="0%" stop-color="#b9ffd0" stop-opacity="0.35"/>
      <stop offset="48%" stop-color="#3cff8a" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="#7a3cff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="wisp">
      <stop offset="0%" stop-color="#e6fff0" stop-opacity="1"/>
      <stop offset="45%" stop-color="#7affb0" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#7affb0" stop-opacity="0"/>
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
    </pattern>
    <pattern id="causewayPat" patternUnits="userSpaceOnUse" width="${CAUSEWAY_HALF * 2}" height="${CAUSEWAY_HALF * 2}">
      <image href="art/causeway.png" width="${CAUSEWAY_HALF * 2}" height="${CAUSEWAY_HALF * 2}"/>
    </pattern>
    <pattern id="barricadePat" patternUnits="userSpaceOnUse" width="${BARRICADE_VIS_THICK}" height="${BARRICADE_VIS_THICK}">
      <image href="art/barricade.png" width="${BARRICADE_VIS_THICK}" height="${BARRICADE_VIS_THICK}"/>
    </pattern>`;
  svg.appendChild(defs);
  const cam = el("g", {});
  svg.appendChild(cam);
  return cam;
}

const SCENERY_SPRITE: Record<NodeKind, string> = {
  house: "house-standing", well: "well", altar: "altar", grave: "grave",
};
const SCENERY_SIZE: Record<NodeKind, number> = {
  house: 46, well: 44, altar: 56, grave: 44,
};

// Resolve a node's sprite name from its live state: a house shows its standing/
// desecrated/totem/reconsecrated face (a still-active scar reads reconsecrated); a
// grave shows its spent face once emptied; wells/altars their base (a spent altar
// just dims). Each state sprite falls back to its base when the PNG isn't loaded,
// so missing art never drops a node to a bare rect.
function scenerySprite(s: NecroState, n: ArenaNode): string {
  switch (n.kind) {
    case "house":
      if (n.desecrated) return n.risen ? "house-totem" : "house-desecrated";
      if (n.reconsecrated && n.reconsecrated > s.elapsed && sprites.has("house-reconsecrated")) return "house-reconsecrated";
      return "house-standing";
    case "grave":
      return n.graveSpent && sprites.has("grave-spent") ? "grave-spent" : "grave";
    default:
      return SCENERY_SPRITE[n.kind];
  }
}

function render(s: NecroState, layer: SVGGElement): void {
  layer.innerHTML = "";

  // Ground — the village's tiled floor (or solid gloom if the art isn't loaded).
  const hasGround = sprites.has("ground");
  layer.appendChild(el("rect", {
    x: 0, y: 0, width: s.w, height: s.h,
    fill: hasGround ? "url(#groundPat)" : "#0a0f0c", opacity: hasGround ? 0.5 : 1,
  }));

  // Causeways — open lanes drawn on the ground beneath the built world.
  const hasCauseway = sprites.has("causeway");
  for (const p of s.causeways) {
    if (hasCauseway) {
      layer.appendChild(tiledSegment("causewayPat", p, CAUSEWAY_HALF * 2, 0.7));
      continue;
    }
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#1c2a1c", "stroke-width": CAUSEWAY_HALF * 2,
      "stroke-linecap": "round", opacity: 0.45,
    }));
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#3a5a40", "stroke-width": 3,
      "stroke-linecap": "round", "stroke-dasharray": "10 14", opacity: 0.4,
    }));
  }

  // Barricades — walls strung between posts, drawn beneath the built world.
  const hasBarricade = sprites.has("barricade");
  for (const f of s.barricades) {
    if (hasBarricade) {
      layer.appendChild(tiledSegment("barricadePat", f, BARRICADE_VIS_THICK, 0.95));
      continue;
    }
    layer.appendChild(el("line", {
      x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
      stroke: "#0f1510", "stroke-width": BARRICADE_HALF * 2,
      "stroke-linecap": "round", opacity: 0.92,
    }));
    layer.appendChild(el("line", {
      x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
      stroke: "#3f4a3a", "stroke-width": 2.5,
      "stroke-linecap": "round", opacity: 0.7,
    }));
  }

  // Scenery — the built world. A desecrated house glows necrotic green; a risen
  // totem shows its emitter reach; a re-blessed house's scar marks the ground.
  for (const n of s.scenery) {
    const solid = OBSTACLE_KINDS.has(n.kind);
    // A re-blessed house's lingering scar — a pool of consecrated (holy) ground.
    if (n.kind === "house" && n.reconsecrated && n.reconsecrated > s.elapsed) {
      const life = (n.reconsecrated - s.elapsed) / RECONSECRATE_MS;
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: SCAR_RADIUS, fill: "#1a2a20", opacity: 0.3 * life }));
      layer.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: SCAR_RADIUS * 0.7, fill: "none",
        stroke: "#cfe8d8", "stroke-width": 1, "stroke-dasharray": "4 10", opacity: 0.3 * life,
      }));
    }
    if (n.kind === "house" && n.desecrated) {
      const halo = n.risen ? 32 + 6 * Math.sin(s.elapsed / 220) : 30;
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: halo, fill: "url(#haloRise)", opacity: n.risen ? 0.85 : 0.7 }));
      if (n.risen) {
        layer.appendChild(el("circle", {
          cx: n.x, cy: n.y, r: TOTEM_RADIUS, fill: "none",
          stroke: "#7affb0", "stroke-width": 1.2, opacity: 0.2,
        }));
      }
    }
    // A grave glows faintly while it still holds dead to raise.
    if (n.kind === "grave" && !n.graveSpent) {
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: 26, fill: "url(#necro)", opacity: 0.5 }));
    }
    const spriteName = scenerySprite(s, n);
    const key = spriteFor(s.level, spriteName);
    const op = solid ? (n.spent ? 0.4 : 1) : (n.kind === "grave" && n.graveSpent ? 0.4 : 0.6);
    if (key) {
      layer.appendChild(spriteImage(key, n.x, n.y, SCENERY_SIZE[n.kind], op));
    } else {
      // Procedural fallback so the game is playable with zero PNGs. Each kind reads
      // distinctly: houses as homes, wells/altars as solid blocks, graves as mounds.
      const fill =
        n.kind === "grave" ? (n.graveSpent ? "#181c18" : "#16241a")
          : n.kind === "house" ? (n.desecrated ? (n.risen ? "#0e2018" : "#16261c") : "#1c1f18")
            : "#14180f"; // well / altar
      const stroke =
        n.kind === "grave" ? "#5affa0"
          : n.kind === "house" ? (n.desecrated ? "#7affb0" : "#5a6a4a")
            : "#6a7a5a";
      layer.appendChild(el("rect", {
        x: n.x - 9, y: n.y - 9, width: 18, height: 18, rx: 2,
        fill, stroke, "stroke-width": 1, opacity: solid ? (n.spent ? 0.5 : 0.95) : 0.8,
      }));
    }
    if (solid) {
      layer.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: (OBSTACLE_RADIUS[n.kind] || 0),
        fill: "none", stroke: "#3a4a30", "stroke-width": 1.5, opacity: 0.4,
      }));
    }
  }

  // Soul-wisps — bright gatherable motes a felled knight left behind. They pulse
  // and fade. Procedural only (no PNG).
  for (const w of s.wisps) {
    const life = Math.max(0, (w.until - s.elapsed) / WISP_TTL_MS);
    if (life <= 0) continue;
    const pulse = 1 + 0.25 * Math.sin(s.elapsed / 140);
    layer.appendChild(el("circle", {
      cx: w.x, cy: w.y, r: 13 * pulse, fill: "url(#wisp)",
      opacity: Math.min(1, 0.4 + life), filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
    layer.appendChild(el("circle", { cx: w.x, cy: w.y, r: 3.0, fill: "#e6fff0" }));
  }

  // Raise-burst rings — a quick necrotic eruption where the dead clawed up (or an
  // altar burst), fading as it expands. Procedural only.
  for (const r of s.raises) {
    const life = Math.max(0, (r.until - s.elapsed) / 360);
    if (life <= 0) continue;
    layer.appendChild(el("circle", {
      cx: r.x, cy: r.y, r: r.r * (1.0 + (1 - life) * 0.5),
      fill: "none", stroke: "#7affb0", "stroke-width": 3 + 4 * life,
      opacity: 0.6 * life, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
  }

  // Knights — the village watch. Engaging ones draw full; guards lurk faint.
  const knightKey = sprites.has("knight-engage")
    ? "knight-engage" : sprites.has("knight-guard") ? "knight-guard" : null;
  const guardKey = sprites.has("knight-guard") ? "knight-guard" : knightKey;
  for (const e of s.knights) {
    if (e.dead) continue;
    const op = e.state === "engage" ? 1 : 0.6;
    const flash = e.hit > s.elapsed ? Math.max(0, (e.hit - s.elapsed) / HIT_FLASH_MS) : 0;
    const sz = (e.captain ? 58 : 44) * (1 + flash * 0.18);
    const useKey = e.state === "engage" ? knightKey : guardKey;
    if (useKey) {
      layer.appendChild(spriteImage(useKey, e.x, e.y, sz, op));
    } else {
      const q = KNIGHT_RADIUS * (e.captain ? 2 : 1.5);
      layer.appendChild(el("rect", {
        x: e.x - q / 2, y: e.y - q / 2, width: q, height: q,
        fill: "#2a2620", stroke: "#cfd2c0", "stroke-width": 2, opacity: op,
      }));
    }
    // A captain reads at a glance: a steel-bright ring.
    if (e.captain) {
      layer.appendChild(el("circle", {
        cx: e.x, cy: e.y, r: KNIGHT_RADIUS + 6, fill: "none",
        stroke: "#dfe4d0", "stroke-width": 2, opacity: 0.55 * op,
      }));
    }
    if (flash > 0) {
      const grow = 1 - flash;
      const fx: Record<string, string> = LOW_FX ? {} : { filter: "url(#bloom)" };
      layer.appendChild(el("circle", {
        cx: e.x, cy: e.y, r: KNIGHT_RADIUS * (0.9 + 0.5 * grow),
        fill: "#9dffb6", opacity: 0.7 * flash, ...fx,
      }));
    }
    if (e.state === "engage" && e.hp < e.maxHp) {
      const bw = 30, frac = Math.max(0, e.hp / e.maxHp);
      const by = e.y - KNIGHT_RADIUS - 11;
      layer.appendChild(el("rect", { x: e.x - bw / 2, y: by, width: bw, height: 3, fill: "#2a2410", opacity: 0.85 }));
      layer.appendChild(el("rect", { x: e.x - bw / 2, y: by, width: bw * frac, height: 3, fill: "#dfe4d0", opacity: 0.95 }));
    }
  }

  // Minions — the horde. Small bone figures, drawn over the watch they swarm.
  const minionKey = sprites.has("skeleton") ? "skeleton" : null;
  for (const m of s.minions) {
    if (m.dead) continue;
    const flash = m.hit > s.elapsed ? Math.max(0, (m.hit - s.elapsed) / HIT_FLASH_MS) : 0;
    const sz = 30 * (1 + flash * 0.18);
    if (minionKey) {
      layer.appendChild(spriteImage(minionKey, m.x, m.y, sz, 1));
    } else {
      // Procedural skeleton: a small pale lozenge with a faint green glow.
      layer.appendChild(el("circle", { cx: m.x, cy: m.y, r: MINION_RADIUS + 3, fill: "url(#haloRise)", opacity: 0.4 }));
      layer.appendChild(el("circle", {
        cx: m.x, cy: m.y, r: MINION_RADIUS, fill: "#e8efd8",
        stroke: "#7affb0", "stroke-width": 1.5, opacity: 0.95,
      }));
    }
    if (flash > 0) {
      const fx: Record<string, string> = LOW_FX ? {} : { filter: "url(#bloom)" };
      layer.appendChild(el("circle", {
        cx: m.x, cy: m.y, r: MINION_RADIUS * 1.2, fill: "#ff6b6b", opacity: 0.6 * flash, ...fx,
      }));
    }
    if (m.hp < m.maxHp) {
      const bw = 22, frac = Math.max(0, m.hp / m.maxHp);
      const by = m.y - MINION_RADIUS - 8;
      layer.appendChild(el("rect", { x: m.x - bw / 2, y: by, width: bw, height: 2.4, fill: "#1c2410", opacity: 0.8 }));
      layer.appendChild(el("rect", { x: m.x - bw / 2, y: by, width: bw * frac, height: 2.4, fill: "#7affb0", opacity: 0.95 }));
    }
  }

  // The raising-pentagram — the only procedural sigil. It scales and brightens as
  // it inscribes (charge), turns slowly, and flares brighter once it is armed to
  // raise (charge ≥ PENTA_RAISE_AT). Drawn under the necromancer so he stands at its heart.
  const h = s.hero;
  if (h.charge > 0.02) {
    const r = PENTA_RADIUS * (0.72 + 0.28 * h.charge);
    const op = 0.2 + 0.6 * h.charge;
    const armed = h.charge >= PENTA_RAISE_AT;
    layer.appendChild(el("circle", { cx: h.x, cy: h.y, r, fill: "url(#necro)", opacity: op * 0.6 }));
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r, fill: "none", stroke: "#7affb0", "stroke-width": 1.6,
      opacity: op, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
    layer.appendChild(el("path", {
      d: pentagramPath(h.x, h.y, r * 0.92, h.angle),
      fill: "none", stroke: armed ? "#d8ffe6" : "#7affb0",
      "stroke-width": 2.4, "stroke-linejoin": "round",
      opacity: op, filter: "url(#glow)",
    }));
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: r * 0.92, fill: "none", stroke: "#7affb0",
      "stroke-width": 1, opacity: op * 0.6,
    }));
  }

  // The necromancer, drawn last over everything with a necrotic aura.
  layer.appendChild(el("circle", { cx: h.x, cy: h.y, r: 30, fill: "url(#haloRise)", opacity: 0.85 }));
  layer.appendChild(el("circle", { cx: h.x, cy: h.y, r: 22, fill: "url(#necro)", opacity: 0.5 }));
  if (sprites.has("necromancer")) {
    layer.appendChild(spriteImage("necromancer", h.x, h.y, 46, 1));
  } else {
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: HERO_RADIUS, fill: "#1a2420",
      stroke: "#9dffb6", "stroke-width": 2.5, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
    }));
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: HERO_RADIUS * 0.5, fill: "#9dffb6", opacity: 0.9,
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

interface NecroLegacy {
  runs: number;          // marches ended
  overruns: number;      // villages overrun (clears)
  best: Record<string, number>; // fastest overrun per village id, ms
  housesRazed: number;   // lifetime houses razed across all marches
  totemsRaised: number;  // lifetime houses that rose into bone-totems
}

function emptyNecroLegacy(): NecroLegacy {
  return { runs: 0, overruns: 0, best: {}, housesRazed: 0, totemsRaised: 0 };
}

function loadNecroLegacy(): NecroLegacy {
  try {
    const raw = localStorage.getItem(NECRO_LEGACY_KEY);
    if (!raw) return emptyNecroLegacy();
    const l = JSON.parse(raw) as Partial<NecroLegacy>;
    return {
      runs: l.runs || 0,
      overruns: l.overruns || 0,
      best: l.best || {},
      housesRazed: l.housesRazed || 0,
      totemsRaised: l.totemsRaised || 0,
    };
  } catch { return emptyNecroLegacy(); }
}

function saveNecroLegacy(l: NecroLegacy): void {
  try { localStorage.setItem(NECRO_LEGACY_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

// Fold an overrun into the legacy — write-once at the win transition. Best time
// never worsens.
function recordOverrun(level: LevelDef, ms: number, razed = 0, totems = 0): NecroLegacy {
  const l = loadNecroLegacy();
  l.runs++; l.overruns++;
  l.housesRazed += razed;
  l.totemsRaised += totems;
  if (!l.best[level.id] || ms < l.best[level.id]) l.best[level.id] = ms;
  saveNecroLegacy(l);
  return l;
}

// Fold a fall into the legacy — write-once at the lose transition.
function recordFall(razed = 0, totems = 0): NecroLegacy {
  const l = loadNecroLegacy();
  l.runs++;
  l.housesRazed += razed;
  l.totemsRaised += totems;
  saveNecroLegacy(l);
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
  const soulsEl = byId("souls");
  const cityEl = byId("cityname");
  const toastEl = byId("toast");
  const stickEl = byId("stick");
  const stickKnob = byId("stick-knob");
  const mmEl = byId("minimap") as unknown as SVGSVGElement;
  const headerEl = document.querySelector("header") as HTMLElement | null;

  const layer = scaffold(svg);
  let s: NecroState | null = null;

  // ----- Camera: follows the necromancer; pinch / wheel zoom. -----
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
    minK = m / aw;
    maxK = Math.max(1.6, m / 320);
    cam.k = Math.min(maxK, Math.max(minK, m / 640));
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

  const ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];
  function hud(): void {
    if (!s) return;
    hpFill.style.width = Math.max(0, (s.hero.hp / s.hero.maxHp) * 100) + "%";
    cityEl.textContent = s.level.name;
    soulsEl.textContent = `${s.souls} souls · ${aliveMinions(s)} risen`;
    const alive = aliveKnights(s);
    let foes = alive > 0 ? `Overrun ${alive} / ${s.total} knights` : `Village overrun`;
    if (alive > 0 && alive <= 3) {
      let best: Knight | null = null, bd = Infinity;
      for (const e of s.knights) {
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
  }

  // A glanceable corner overview of the whole arena.
  const MM_MAX = 96;
  let mmTick = 0;
  function minimap(): void {
    if (!s || s.phase !== "march") { mmEl.style.display = "none"; return; }
    if (mmTick++ % 5 !== 0) return;
    const scale = Math.min(MM_MAX / s.w, MM_MAX / s.h);
    const mw = s.w * scale, mh = s.h * scale;
    mmEl.style.display = "block";
    mmEl.style.top = `${(headerEl ? headerEl.offsetHeight : 50) + 6}px`;
    mmEl.style.width = `${mw.toFixed(1)}px`;
    mmEl.style.height = `${mh.toFixed(1)}px`;
    mmEl.setAttribute("viewBox", `0 0 ${mw.toFixed(1)} ${mh.toFixed(1)}`);
    mmEl.innerHTML = "";
    mmEl.appendChild(el("rect", { x: 0, y: 0, width: mw, height: mh, fill: "#06120a", opacity: 0.5 }));
    // Razed houses — your progress (risen totems brighter).
    for (const n of s.scenery) {
      if (n.kind !== "house" || !n.desecrated) continue;
      mmEl.appendChild(el("circle", {
        cx: n.x * scale, cy: n.y * scale, r: n.risen ? 1.7 : 1.1,
        fill: n.risen ? "#d8ffe6" : "#7affb0", opacity: 0.9,
      }));
    }
    // The horde.
    for (const m of s.minions) {
      if (m.dead) continue;
      mmEl.appendChild(el("circle", { cx: m.x * scale, cy: m.y * scale, r: 1.0, fill: "#e8efd8", opacity: 0.85 }));
    }
    // The watch that remains — the map's whole point (captains stand out).
    for (const e of s.knights) {
      if (e.dead) continue;
      mmEl.appendChild(el("circle", {
        cx: e.x * scale, cy: e.y * scale, r: e.captain ? 1.9 : 1.3,
        fill: "#cfd2c0", opacity: 0.95,
      }));
    }
    const vw = svg.clientWidth, vh = svg.clientHeight;
    mmEl.appendChild(el("rect", {
      x: (-cam.x / cam.k) * scale, y: (-cam.y / cam.k) * scale,
      width: (vw / cam.k) * scale, height: (vh / cam.k) * scale,
      fill: "none", stroke: "#9dffb6", "stroke-width": 0.6, opacity: 0.5,
    }));
    // The necromancer, last so it sits on top.
    mmEl.appendChild(el("circle", {
      cx: s.hero.x * scale, cy: s.hero.y * scale, r: 2.3,
      fill: "#d8ffe6", stroke: "#3cff8a", "stroke-width": 0.8,
    }));
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

  const TOAST_MS = 3200;
  function showToast(text: string): void {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    window.setTimeout(() => toastEl.classList.remove("show"), TOAST_MS);
  }

  // ----- The march loop -----
  let lastFrame = 0;
  let running = false;
  let introHold = false;
  let introHoldTimer: ReturnType<typeof setTimeout> | undefined;
  function marchFrame(now: number): void {
    if (!running || !s) return;
    if (!lastFrame) lastFrame = now;
    let dt = now - lastFrame; lastFrame = now;
    if (dt > 100) dt = 100;

    if (introHold && (move.x || move.y || keys.size > 0)) {
      introHold = false;
      clearTimeout(introHoldTimer);
      toastEl.classList.remove("show");
    }

    if (!introHold && s.phase === "march") {
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
      stepMarch(s, dt, move);
      centerCam(s.hero.x, s.hero.y);
    }

    render(s, layer);
    hud();
    minimap();

    if (s.phase === "won") { running = false; onWin(); return; }
    if (s.phase === "lost") { running = false; onLost(); return; }
    requestAnimationFrame(marchFrame);
  }

  function startCity(level: LevelDef): void {
    s = buildArena(level);
    loadCitySprites(level.id, repaint);
    hideOverlay();
    setupZoom();
    centerCam(s.hero.x, s.hero.y);
    hud();
    showToast("Overrun the village: defeat EVERY knight to win (watch the count, top-right). March onto a grave to RAISE skeletons — they cost souls and fight on their own, hunting the nearest knight. Felling a knight grants souls (and may drop a soul-wisp to gather). Raze the houses to heal your horde, and weave around the wells and altars. The knights fight back — keep your own life, top-left, or you fall.");
    introHold = true;
    clearTimeout(introHoldTimer);
    introHoldTimer = setTimeout(() => { introHold = false; }, TOAST_MS);
    running = true; lastFrame = 0;
    requestAnimationFrame(marchFrame);
  }

  function onWin(): void {
    if (!s) return;
    const ms = s.elapsed;
    const razed = s.desecCount, total = s.housesTotal;
    const totems = s.scenery.filter((n) => n.risen).length;
    const sc = scoreRun(s);
    const l = recordOverrun(s.level, ms, razed, totems);
    const best = l.best[s.level.id];
    const razedLine = (razed >= total && total > 0
      ? `You razed every house — <em>${total}</em>. Nothing of the village stands.`
      : `You razed <em>${razed}</em> of ${total} houses.`)
      + (totems ? ` <em>${totems}</em> rose as bone-totems to fight beside the horde.` : "")
      + (s.reconsecrated ? ` The watch re-blessed <em>${s.reconsecrated}</em> back to standing.` : "");
    const row = (label: string, val: string) =>
      `<div><dt>${label}</dt><dd>${val}</dd></div>`;
    const breakdown =
      `<div class="legacy"><div class="legacy-head">Score</div><dl>` +
      row("Host overrun", `${sc.base}`) +
      row("Speed", `${sc.speed}`) +
      row("Houses razed", `${sc.houses}`) +
      row("Survival", `${sc.survival}`) +
      (sc.untouched ? row("Untouched", `${sc.untouched}`) : "") +
      row("Village difficulty", `×${sc.mult}`) +
      row("<strong>Total</strong>", `<strong>${sc.total}</strong>`) +
      `</dl></div>`;
    showOverlay(
      "The village is overrun",
      `Every knight of <em>${s.level.name}</em> is undone — ${s.total} of them — ` +
      `in <em>${fmtTime(ms)}</em>.<br><br>` +
      `${razedLine}<br><br>` +
      (best === ms ? `<em>A new best for this village.</em>` : `Best here: ${fmtTime(best)}.`) +
      breakdown,
      "March again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function onLost(): void {
    if (!s) return;
    recordFall(s.desecCount, s.scenery.filter((n) => n.risen).length);
    showOverlay(
      "Your march is broken",
      `The watch of <em>${s.level.name}</em> cut you down with ` +
      `<em>${aliveKnights(s)}</em> knights still standing.<br><br>` +
      `You had razed <em>${s.desecCount}</em> of ${s.housesTotal} houses ` +
      `and raised <em>${s.raisedTotal}</em> of the dead.<br><br>` +
      `<em>The grave is patient. March again.</em>`,
      "Try again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function showPicker(selId?: string): void {
    s = null; running = false;
    introHold = false; clearTimeout(introHoldTimer);
    mmEl.style.display = "none";
    const l = loadNecroLegacy();
    const sel = levelById(selId || "") || LEVELS[0];
    const card = sel.art ? `<img class="city-art" src="${sel.art}" alt="">` : "";
    let html =
      card +
      `<p class="lede">Choose a village to march upon. March onto an open grave to ` +
      `raise skeletons — they cost souls and hunt the knights on their own. Raze the ` +
      `houses to heal your horde, weave around the wells and altars, and run the ` +
      `causeways to outpace the watch. Defeat every knight and the village is overrun.` +
      `</p><div class="cities">`;
    for (const lv of LEVELS) {
      const done = l.best[lv.id];
      const mark = done ? ` <span class="legacy-new">overrun ${fmtTime(done)}</span>` : "";
      html +=
        `<button class="city${lv.id === sel.id ? " sel" : ""}" data-id="${lv.id}">` +
        `<span class="city-name">${lv.name}${mark}</span>` +
        `<span class="city-line">${lv.epigraph}</span></button>`;
    }
    html += `</div>`;

    if (l.runs > 0) {
      html +=
        `<div class="legacy"><div class="legacy-head">Your marches</div><dl>` +
        `<div><dt>Marches</dt><dd>${l.runs}</dd></div>` +
        `<div><dt>Villages overrun</dt><dd>${l.overruns}</dd></div>` +
        `<div><dt>Houses razed</dt><dd>${l.housesRazed}</dd></div>` +
        `<div><dt>Bone-totems raised</dt><dd>${l.totemsRaised}</dd></div></dl></div>`;
    }

    showOverlay(
      "The Necromancer's March", html, `March upon ${sel.name}`, () => startCity(sel),
    );
    const img = ovBody.querySelector<HTMLImageElement>(".city-art");
    if (img) img.onerror = () => { img.style.display = "none"; };
    overlay.querySelectorAll<HTMLButtonElement>(".city").forEach((b) => {
      b.onclick = () => {
        const lv = levelById(b.dataset.id || "");
        if (lv) showPicker(lv.id);
      };
    });
  }

  // ---------- Start screen + sharing the game ----------
  function gameUrl(): string { return location.origin + location.pathname; }

  function showStart(): void {
    s = null; running = false;
    mmEl.style.display = "none";
    const body =
      `<img class="start-logo" src="./icons/icon-512.png" alt="The Necromancer's March">` +
      `<p class="frx-quote">“They named the dimming 'mercy.' We named it a beginning.”</p>` +
      `<div class="start-share">` +
      `<button class="start-act" data-act="link">Share game link</button></div>`;
    showOverlay("The Necromancer's March", body, "Begin the march", () => showPicker());
    ovBtn2.style.display = "none";
    ovBody.querySelectorAll<HTMLImageElement>("img").forEach((im) => {
      im.onerror = () => { im.style.display = "none"; };
    });
    ovBody.querySelectorAll<HTMLButtonElement>(".start-act").forEach((b) => {
      b.onclick = () => { if (b.dataset.act === "link") void shareGameLink(); };
    });
  }

  async function shareGameLink(): Promise<void> {
    const url = gameUrl();
    const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "The Necromancer's March", text: "Raise the dead and overrun the village.", url }); return; }
      catch (e) { if ((e as { name?: string }).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); showToast("Game link copied to the clipboard."); }
    catch { showToast(url); }
  }

  byId("reset").addEventListener("click", () => showPicker());

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
  showStart();
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
// Mirrors app.ts/pentagram.ts: a headless harness sets __NECRO_TEST__ and reads
// the sim off __necro instead of the shell ever starting.
const testGlobal = globalThis as unknown as {
  __NECRO_TEST__?: boolean;
  __necro?: Record<string, unknown>;
};
if (typeof globalThis !== "undefined" && testGlobal.__NECRO_TEST__) {
  testGlobal.__necro = {
    generateNecroVillage, buildArena, freshNecro, stepMarch,
    stepRaise, stepMinions, stepKnights, stepDesecrate, stepHouses, stepAltar, stepWisps,
    killKnight, desecrateHouse, reconsecrateHouse, nearScar,
    nearestKnight, nearestMinion,
    aliveKnights, aliveMinions, clearedPct, houseReadout, scoreRun, difficultyMult,
    LEVELS, levelById,
    weaveSegments, closestOnSegment, pushOut, pentagramPath,
    render, scaffold, scenerySprite, spriteFor,
    loadNecroLegacy, saveNecroLegacy, recordOverrun, recordFall, emptyNecroLegacy,
    K: {
      W, H, HERO_HP, HERO_RADIUS, HERO_IFRAMES_MS, HERO_SPEED, HERO_KNOCKBACK,
      SOUL_START, RAISE_COST, RAISE_MIN, RAISE_MAX, GRAVE_REACH, GRAVE_RADIUS,
      GRAVE_RAISES, GRAVE_COOLDOWN_MS, SOUL_PER_KILL,
      HERO_STILL_MAXSPEED, PENTA_CHARGE_MS, PENTA_RAISE_AT, PENTA_RADIUS, PENTA_SPIN,
      WISP_DROP_CHANCE, WISP_SOULS, WISP_TTL_MS, WISP_RADIUS,
      MINION_HP, MINION_SPEED, MINION_RADIUS, MINION_DMG, MINION_ATTACK_CD,
      MINION_ATTACK_REACH, MINION_SEP, MINION_FOLLOW_DIST, MINION_AGGRO, MINION_CAP,
      KNIGHT_HP, KNIGHT_SPEED, KNIGHT_RADIUS, KNIGHT_DMG, KNIGHT_ATTACK_CD,
      KNIGHT_ATTACK_REACH, KNIGHT_SEP, KNIGHT_PER_POST, AGGRO_RADIUS,
      KNIGHT_WANDER_SPEED, KNIGHT_LEASH, CLEANUP_AGGRO_FRAC, CAPTAIN_HP_MUL, CAPTAIN_DMG,
      OBSTACLE_RADIUS, BARRICADE_HALF, CAUSEWAY_HALF, CAUSEWAY_BOOST,
      DESEC_REACH, DESEC_HEAL, HEAL_CAP, HOUSE_RISE_MS, TOTEM_RADIUS, TOTEM_DMG,
      RECONSECRATE_REACH, RECONSECRATE_MS, SCAR_RADIUS,
      ALTAR_TRIGGER_REACH, ALTAR_BURST_R, ALTAR_BURST_DMG,
      SCORE_PER_KNIGHT, SCORE_SURVIVAL_MAX, SCORE_UNTOUCHED, HIT_FLASH_MS,
    },
  };
} else {
  start();
}

// This trailing export makes necro.ts a *module* (its top-level names are
// module-scoped), so it compiles in the same project as app.ts (a classic global
// script) and pentagram.ts without their identically-named declarations (W, el,
// render, start, LEVELS, …) colliding. The page loads it with <script
// type="module">; the test loads it via dynamic import().
export {};
