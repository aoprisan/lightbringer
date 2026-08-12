// The Watcher at the Threshold — a fourth action-combat spinoff of The Light-Bringer,
// set in the world of H. P. Lovecraft's mythos.
//
// Where the lightbringer's spinoffs carry FLAME (the Vigil) or DEATH (the
// Necromancer's March), the Watcher carries a SIGN. You walk an investigator
// through a doomed coastal place; standing still TRACES the Elder Sign — a burning
// sigil that BANISHES the eldritch host pouring from the rifts. Clear the finite
// host and the threshold is sealed; you win.
//
// The defining twist is SANITY — a second life-bar nothing else in this repo has.
// The very act of tracing the Sign frays the mind (each banishing pulse costs
// sanity); the nearness of the host bleeds it (DREAD); and a Nightgaunt's GAZE
// lances it from afar. Restore it by sealing ward-stones (their auras steady you)
// and gathering the clue-motes the banished leave. Lose your HP and you are slain;
// lose your SANITY and you go MAD — two different ends, one threshold.
//
// This file is a self-contained TS MODULE (it ends with `export {};`) so its
// top-level names (W, render, start, LEVELS, …) are module-scoped and never collide
// with app.ts (a classic global script) or its siblings pentagram.ts / necro.ts.
// The page loads it with <script type="module">; the test loads it via dynamic
// import(). The simulation is pure and headless (EldState in, mutation out); the
// render pass only reads it — the same split that lets the sibling tests drive the
// others lets eldritch-test.mjs drive this. Sections below:
//   Types -> Tuning -> Signs -> Places -> Arena generation -> Watch sim ->
//   Sprites -> Render -> Game shell -> Legacy -> SW + test seam.

// ---------- Types ----------

// RIFTS (where the host pours through) are a placement role, NOT a node kind — so
// the kinds are the pure built fabric of the place.
type NodeKind = "ruin" | "menhir" | "ward";
type Phase = "watch" | "won" | "lost";
type LossCause = "slain" | "mad";

// A horror lurks near its rift until the Watcher (or a sealed ward) draws it, then
// hunts. Aggro is sticky once roused — the mirror of the sibling games' enemy AI.
type HorrorState = "lurk" | "hunt";

// The five kinds of the host. Most are melee shamblers; the gazer and acolyte are
// the standoff specialists (the gazer drains SANITY at range, the acolyte mends).
type HorrorKind = "shambler" | "darter" | "brute" | "gazer" | "acolyte";

// A built node. A WARD can be sealed (`lit`) by the Sign — its aura steadies the
// mind and burns the host; a horror brushing a sealed ward DEFILES it (dark again,
// and a scar bars resealing for a while — the inversion the sibling games share).
interface ArenaNode {
  x: number; y: number; kind: NodeKind;
  lit?: boolean;     // a ward-stone sealed by the Sign (an ally emitter)
  litAt?: number;    // s.elapsed when it was sealed (for the bloom flourish)
  defiled?: number;  // s.elapsed a defiled ward's scar bars resealing to (0/undef = clean)
}

// A line segment. Walls (block bodies, capsule collision) and paths (the Watcher
// runs swift along them). Pure geometry, woven from node positions at build.
interface Segment { x1: number; y1: number; x2: number; y2: number }

// The Watcher — the investigator.
interface Hero {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  sanity: number; maxSanity: number; // the second life-bar; 0 = madness
  hurt: number;       // remaining i-frame ms after a horror's blow (0 = vulnerable)
  charge: number;     // 0..1 — how fully the Elder Sign is traced (ramps while still)
  overcharge: number; // 0..1 — banked past a full trace (hold longer); empowers the next pulse
  signCd: number;     // ms until the traced Sign pulses again (cadence)
  angle: number;      // the sigil's slow cosmetic spin, in degrees
}

// A member of the eldritch host.
interface Horror {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  dead: boolean;
  state: HorrorState;
  variant: HorrorKind;
  wanderAngle: number;
  homeX: number; homeY: number; // its rift anchor (the lurk leash centre)
  attackCd: number;             // ms until it can claw again
  hit: number;                  // s.elapsed until which it flashes from a fresh blow
  bornAt: number;               // s.elapsed it rose (for the rise flourish)
  gaze?: boolean;               // transient (per-frame): a gazer lancing the Watcher's sanity this frame
  mending?: boolean;            // transient (per-frame): an acolyte channelling a mend this frame
  mendX?: number; mendY?: number; // transient: the horror it is mending (beam endpoint)
}

// FX, drawn then faded — never persisted. A Pulse is the Sign's banishing ring; a
// Mote is a clue a banished horror drops (gather it to steady the mind).
interface Pulse { x: number; y: number; r: number; until: number }
interface Mote { x: number; y: number; until: number }
// A body of water — purely atmospheric (no collision), seeded per place to give each
// threshold its own drowned, fog-bound, or swampy character. Drawn beneath the world.
interface Pool { x: number; y: number; rx: number; ry: number; seed: number }

interface EldState {
  level: LevelDef;
  w: number; h: number;
  scenery: ArenaNode[];
  solids: ArenaNode[];   // scenery the bodies can't pass (the menhirs)
  wards: ArenaNode[];    // cached ward-stones (the seal sites)
  walls: Segment[];      // crumbled walls the bodies must weave around (and break a gaze)
  paths: Segment[];      // old roads the Watcher runs swift along
  pools: Pool[];         // atmospheric water bodies (cosmetic; the place's signature)
  hero: Hero;            // the Watcher
  sign: SignType;        // the equipped Elder Sign variant (resolved from the legacy at build)
  horrors: Horror[];
  pulses: Pulse[];       // fading banishing rings (cosmetic)
  motes: Mote[];         // gatherable clue-motes dropped by the banished
  fervor: number;        // 0..1 zeal — the banish-streak (ramps pulse damage & stride)
  fervorUntil: number;   // s.elapsed the streak window stays open to (then it drains)
  tollNext: number;      // s.elapsed at which the drowned bell next tolls
  tolls: number;         // tolls so far this watch (each stirs a bigger cohort)
  tollFlash: number;     // s.elapsed until which the fresh toll reads on screen
  elapsed: number;       // ms since the watch began (clear time)
  banished: number;      // horrors banished
  hits: number;          // times a horror has landed a blow on the Watcher
  total: number;         // the finite host: banish them all to win
  wardsTotal: number;    // ward-stones the place began with
  litCount: number;      // wards sealed right now (secondary objective)
  defiledCount: number;  // wards the host has defiled this watch
  seed: number;          // the arena's build seed — the duel token's heart
  killTimes: number[];   // ms timestamp of every banishing, in order — my echo
  rival?: DuelRun;       // the challenger's echo, when this watch answers a duel
  phase: Phase;
  lossCause: LossCause;  // which end befell the Watcher (set when phase -> "lost")
}

interface Move { x: number; y: number } // normalized input vector, -1..1 each

// ---------- Tuning ----------
// The design surface. Balance changes should be constant changes here, the same
// ethos as the sibling games' tuning blocks.

const W = 1500;
const H = 2000;

// The Watcher.
const HERO_SPEED = 244;          // travel, world units per second
const HERO_RADIUS = 16;
const HERO_HP = 100;
const HERO_SANITY = 100;         // the mind's reservoir
const HERO_IFRAMES_MS = 700;     // grace after a blow, no further corporeal damage
const HERO_KNOCKBACK = 56;       // units the Watcher is shoved back by a blow

// The Elder Sign — the Watcher's weapon and the gate on every banishing. Standing
// still TRACES it (charge ramps to 1); moving lets it fade (you dodge). The Sign
// pulses only once sufficiently traced (stepSign gates on SIGN_BANISH_AT), so a
// banishing is a deliberate stand — the same stand-still verb the Vigil pioneered,
// here turned on the mythos. Tracing frays the mind: each pulse costs sanity.
const HERO_STILL_MAXSPEED = 40;  // travel slower than this (units/s) to trace
const SIGN_CHARGE_MS = 440;      // time stationary to fully trace (and to fade)
const SIGN_BANISH_AT = 0.6;      // the Sign banishes once at least this traced
const SIGN_RADIUS = 172;         // the banishing reach around the Watcher (a broad Elder Sign)
const SIGN_PULSE_MS = 520;       // ms between banishing pulses while the Sign holds
const SIGN_DMG = 17;             // damage a pulse deals to every horror in reach
const SIGN_SANITY_COST = 2.4;    // sanity each pulse costs (tracing forbidden geometry)
const SIGN_SPIN = 0.05;          // degrees of sigil rotation per ms (cosmetic)
const PULSE_FX_MS = 360;         // how long a banishing ring lingers

// Overcharge — the risk/reward on the core verb (mirror of the Necromancer's). Hold
// still PAST a full trace and an overcharge banks (0→1 over SIGN_OVERCHARGE_MS); any
// movement spends it back to nothing. When the next pulse fires with a full
// overcharge it is EMPOWERED: a wider ring that REPELS the host AND steadies the
// mind (restores sanity), then resets. Hold the stand longer — more power, more dread.
const SIGN_OVERCHARGE_MS = 720;      // time past a full trace to bank one overcharge
const OVERCHARGE_RADIUS_MUL = 1.7;   // an empowered pulse's reach × the Sign's reach
const OVERCHARGE_SANITY = 14;        // sanity an empowered pulse restores

// ---- The watch's heartbeat (the family's engagement redesign, ported) ----
// THE TOLLING — Innsmouth's drowned bell. On a cadence the deep stirs: the
// cohort of lurking horrors NEAREST the Watcher rouses and converges, so the
// fight comes to him instead of waiting at its rift to be walked to. Each toll
// stirs a bigger cohort and the cadence shortens as the host thins — the last
// stragglers hunt YOU. (The Vigil's Tolling, re-themed; same shape, same names,
// so a fix in one ports to the other.)
const TOLL_FIRST_MS = 18000;     // quiet grace before the first toll
const TOLL_INTERVAL_MS = 14000;  // base gap between tolls…
const TOLL_ACCEL = 0.6;          // …shaved by up to this fraction as the host thins
const TOLL_ROUSE_BASE = 3;       // horrors stirred by the first toll…
const TOLL_ROUSE_GROWTH = 2;     // …plus this many more per toll since
const TOLL_FLASH_MS = 1400;      // how long the bell's ring reads on screen

// ZEAL — the banish-streak (the Vigil's fervor, re-themed): each banishing in
// quick succession hardens the Watcher's conviction — pulses bite harder and
// his stride quickens — until the window lapses and doubt seeps back.
const FERVOR_PER_KILL = 0.2;     // meter gained per banishing (0..1)
const FERVOR_WINDOW_MS = 4000;   // a banishing holds the zeal alive this long
const FERVOR_DECAY_MS = 1500;    // lapsed zeal drains full→empty this fast
const FERVOR_DMG = 0.5;          // pulse damage ×(1 + this × zeal)
const FERVOR_SPEED = 0.18;       // Watcher speed ×(1 + this × zeal)
const REPEL_KNOCK = 64;              // units an empowered (or Naacal) pulse flings the host back

// SANITY — the second life-bar, and the soul of this spinoff. It bleeds from DREAD
// (the nearness of the host), from a gazer's GAZE, and from tracing the Sign; it is
// restored at sealed wards and by gathered clue-motes. At 0 the Watcher goes MAD.
const DREAD_RADIUS = 230;        // a hunting horror within this bleeds the Watcher's mind
const DREAD_DPS = 5.0;           // sanity/sec at the very edge of contact (scaled by closeness)
const PANIC_SANITY = 30;         // below this the render dread-vignette deepens (cosmetic threshold)

// Clue-motes — a banished horror may leave a clue (rarer than a guaranteed drop);
// gathering it (walk over it) STEADIES the mind. The sanity economy's heartbeat.
const MOTE_DROP_CHANCE = 0.42;   // fraction of banishings that leave a clue-mote
const MOTE_TTL_MS = 7000;        // how long a clue-mote waits to be gathered
const MOTE_RADIUS = 18;          // gather reach (over and above the hero's radius)
const CLUE_SANITY = 9;           // sanity a gathered clue-mote restores

const HIT_FLASH_MS = 150;        // how long a body flashes from a fresh blow

// ---------- Signs (unlockable Elder Sign variants) ----------
// Each Sign is a different sigil with its own banishing dials and a passive POWER,
// mirror of the Vigil's PentaPower and the Necromancer's rite powers. "none" is a
// plain stat-lean; "chain" arcs a banishing to a nearby horror; "calm" steadies the
// mind on each banishing (the sanity Sign); "repel" knocks the host back on every
// pulse. Powers fire automatically — the only choice is which Sign to equip.
type SignPower = "none" | "chain" | "calm" | "repel";

interface SignType {
  id: string; name: string; desc: string; cost: number;
  radiusMul: number;     // banishing reach     × SIGN_RADIUS
  chargeMul: number;     // trace time          × SIGN_CHARGE_MS (a slower sigil)
  pulseMul: number;      // pulse cadence        × SIGN_PULSE_MS
  dmgMul: number;        // pulse damage         × SIGN_DMG
  sanityCostMul: number; // sanity per pulse     × SIGN_SANITY_COST (a gentler sigil costs less)
  power: SignPower;      // the Sign's passive behaviour
  ring: string;          // the sigil's signature glow/ring hue
  star: string;          // the sigil's star-stroke hue
}

const SIGN_TYPES: SignType[] = [
  {
    id: "elder", name: "The Elder Sign", cost: 0,
    desc: "The branching star Akeley sent. Even reach, even bite — the steady ward you began with.",
    radiusMul: 1, chargeMul: 1, pulseMul: 1, dmgMul: 1, sanityCostMul: 1, power: "none",
    ring: "#7ad8ff", star: "#e6f6ff",
  },
  {
    id: "yellow", name: "The Yellow Sign", cost: 120,
    desc: "The mark of the King in tatters — wider and heavier, and a banishing arcs to the next horror near. Dear to the mind.",
    radiusMul: 1.32, chargeMul: 1.2, pulseMul: 1.28, dmgMul: 1.5, sanityCostMul: 1.35, power: "chain",
    ring: "#ffd76a", star: "#fff3c0",
  },
  {
    id: "voor", name: "The Voorish Sign", cost: 160,
    desc: "The gesture that makes the unseen seen — a tight, quick sigil that steadies the mind with every banishing.",
    radiusMul: 0.84, chargeMul: 0.72, pulseMul: 0.66, dmgMul: 0.78, sanityCostMul: 0.6, power: "calm",
    ring: "#9bffd8", star: "#d8fff0",
  },
  {
    id: "naacal", name: "The Naacal Glyph", cost: 240,
    desc: "Glyphs from drowned Mu — every pulse erupts and flings the host back. The capstone ward against the press.",
    radiusMul: 1.12, chargeMul: 1.12, pulseMul: 1.0, dmgMul: 1.15, sanityCostMul: 1.1, power: "repel",
    ring: "#c08aff", star: "#f0d8ff",
  },
];

function signTypeById(id: string): SignType {
  return SIGN_TYPES.find((t) => t.id === id) || SIGN_TYPES[0];
}

// ---------- The host (per-variant tuning) ----------
// Most of the host are shamblers; the rest are seeded among them per place. Each
// block is the design surface for that kind.

// The shambler (Deep One) — the common melee body of the host. Shuffles toward the
// Watcher and claws on a cooldown; the Sign's bread-and-butter target.
const HORROR_HP = 30;
const HORROR_SPEED = 96;         // travel, units/s
const HORROR_RADIUS = 14;
const HORROR_CONTACT = 9;        // damage a claw deals to the Watcher
const HORROR_ATTACK_CD = 740;    // ms between a horror's claws
const HORROR_ATTACK_REACH = 16;  // within this (+radii) of the Watcher it can claw
const HORROR_SEP = 26;           // horrors push apart within this (so they swarm, not stack)
const HORROR_AGGRO = 380;        // a lurking horror within this of the Watcher rouses to hunt
const HORROR_WANDER_SPEED = 32;  // idle drift while lurking, units/s
const HORROR_LEASH = 240;        // a lurker steers home if it drifts past this from its rift
const HORROR_PER_RIFT = 4;       // shamblers each rift musters (the host gate)
const CLEANUP_AGGRO_FRAC = 0.2;  // once this few remain, all rouse so a watch always ends
const RISE_MS = 600;             // a freshly-mustered horror's rise flourish (cosmetic)

// Darter (Byakhee) — fast, frail flyer that closes before the Sign ramps.
const DARTER_HP_MUL = 0.55;      // a darter's hp × a shambler's
const DARTER_SPEED_MUL = 1.7;    // …its travel speed ×
const DARTER_CONTACT = 7;        // …its claw damage

// Brute (Star-Spawn) — slow, tough, heavy. Forces the Watcher to hold the Sign.
const BRUTE_HP_MUL = 3.2;        // a brute's hp × a shambler's
const BRUTE_SPEED_MUL = 0.66;    // …its travel speed ×
const BRUTE_CONTACT = 18;        // …its claw damage (a heavy blow)

// Gazer (Nightgaunt) — the host's standoff sanity-threat. It never claws: it holds
// a standoff and, with line of sight to the Watcher, LANCES the mind (drains sanity
// at range). The counters are to break sight behind a wall, or close and banish it.
// Punishes turtling at range. Frail (a soft target to rush down).
const GAZER_HP_MUL = 1.1;        // a gazer's hp × a shambler's (frail backline)
const GAZER_SPEED_MUL = 0.9;     // …its travel speed ×
const GAZER_RANGE = 300;         // it lances a Watcher within this (with line of sight)
const GAZER_STANDOFF = 210;      // it backs away from a Watcher closer than this (kiting)
const GAZE_DPS = 9;              // sanity/sec a clear gaze drains

// Acolyte (Cultist) — the host's mender. It never claws: it holds back and channels
// a strong single-target mend into the most-wounded horror in range, undoing the
// Sign's chip damage. Kill it (or its mark) first. Frail.
const ACOLYTE_HP_MUL = 1.2;      // an acolyte's hp × a shambler's
const ACOLYTE_SPEED_MUL = 0.85;  // …its travel speed ×
const ACOLYTE_RANGE = 240;       // it mends the most-wounded horror within this
const ACOLYTE_STANDOFF = 180;    // it kites from a Watcher closer than this
const ACOLYTE_HEAL = 15;         // hp/sec it channels into its mark

// Per-variant DREAD weight — how heavily the kind bleeds the Watcher's mind by its
// mere nearness (a brute looms; a darter barely registers).
const HORROR_DREAD: Record<HorrorKind, number> = {
  shambler: 1, darter: 0.7, brute: 1.8, gazer: 1.2, acolyte: 0.8,
};

// Chain (the Yellow Sign's power) — a banishing arcs to the nearest other horror.
const CHAIN_RANGE = 150;         // the arc reaches this far from the banished horror
const CHAIN_DMG = 14;            // damage the arc deals
// Calm (the Voorish Sign's power) — each banishing steadies the mind this much.
const CALM_SANITY = 4;

// Menhirs — the place's solid standing stones; bodies weave around them. Ruins and
// wards are passable (you pass the former, seal the latter).
const OBSTACLE_KINDS = new Set<NodeKind>(["menhir"]);
const OBSTACLE_RADIUS: Partial<Record<NodeKind, number>> = { menhir: 24 };

// Walls — crumbled stretches strung between neighbouring rifts. They block movement
// (a capsule: the segment plus this half-thickness) for every body, AND break a
// gazer's line of sight — the Watcher weaves them as cover for the mind.
const WALL_HALF = 8;             // half-thickness of a wall (collision)
const WALL_VIS_THICK = 24;       // drawn thickness of the wall

// Paths — old roads the Watcher runs swift along.
const PATH_HALF = 30;            // half-width of a path lane
const PATH_BOOST = 1.4;          // hero speed multiplier while on a path

// Wards — sealing one (with the Sign) lights it: its aura STEADIES the Watcher's
// mind and BURNS the host that strays in. A horror brushing a sealed ward DEFILES it
// (dark again, and a scar bars resealing for a while). All live-play, never persisted.
const WARD_SEAL_REACH = 30;      // a ward this close to the Sign's reach is sealed by a pulse
const WARD_KINDLE_SANITY = 8;    // sanity sealing a ward restores (a beacon against the dark)
const WARD_AURA = 132;           // the sealed ward's aura radius
const WARD_SANITY_PER_SEC = 7;   // sanity/sec the aura restores to a Watcher within it
const WARD_DMG = 11;             // damage/sec the aura deals to a horror within it (ally emitter)
const DEFILE_REACH = 24;         // a horror this close to a sealed ward defiles it
const DEFILE_MS = 6000;          // a defiled ward's scar bars resealing this long
const SCAR_RADIUS = 56;          // the scar's drawn reach

// Scoring — sealing the threshold banks a score. Tuned for relationships, not
// magnitudes: faster pays, a calm/warded/unscathed watch pays, and a harder place
// multiplies it all. (Score feeds LORE — the currency for the Sign shop.)
const SCORE_PER_BANISH = 100;        // base, per horror in the host
const SCORE_TARGET_PER_BANISH = 1500; // ms per horror you're "expected" to take
const SCORE_SPEED_PER_SEC = 20;      // points per second cleared under that target
const SCORE_WARDS_MAX = 260;         // full points for a fully-sealed place
const SCORE_SURVIVAL_MAX = 200;      // full points for full HP at the seal
const SCORE_SANITY_MAX = 220;        // full points for full SANITY at the seal
const SCORE_UNTOUCHED = 240;         // flawless bonus (no blow landed all watch)

// Lore — the cross-watch unlock currency (the inversion of the Vigil's embers /
// the Necromancer's relics). A seal banks a share of its score; even a broken watch
// leaves the lore of the horrors you banished, so progress never fully stalls.
const LORE_SCORE_DIV = 12;       // lore from a seal = score ÷ this (min 1)
const LORE_PER_BANISH = 1;       // lore a fall still leaves, per horror banished

const ELD_LEGACY_KEY = "eldritch.legacy.v1";

// ---------- Places (levels) ----------
// Hand-tuned Lovecraftian places, the same generation dials the sibling games use:
// how many nodes, how dense, how many menhirs/wards (the seal sites), and how many
// rifts (each musters a wave of the host — the host gate). A watch has no flame to
// spend and no dawn to reach.
// A place's visual signature — the palette and atmosphere that make each threshold
// read as a distinct world even in pure-vector (zero-PNG) mode. Pure data; render
// reads it. Each LevelDef carries one.
interface EldTheme {
  ground: string;        // the floor's base tint (under any ground.png overlay)
  stone: string;         // vector ruin/menhir fill (the built world's stone)
  stoneEdge: string;     // …its edge stroke
  water: string;         // a water body's core fill
  waterEdge: string;     // …its shoreline/foam stroke
  waterCount: number;    // how many water bodies the place floods in
  haze: string;          // an atmospheric fog/miasma wash over the whole arena
  hazeOpacity: number;   // …its strength (0 = clear air)
  particle: "rain" | "spore" | "bubble" | "ash" | "none"; // drifting ambient motes
  particleColor: string; // …their hue
}

interface LevelDef {
  id: string;
  name: string;
  epigraph: string;
  // The watch's story. The places are one campaign — the Watcher following the
  // horror from the shunned coast inland and at last to the drowned city itself,
  // each threshold sealed only revealing the next. `story` is a chapter that
  // names where the trail came from and where it runs next; a place is reachable
  // only after sealing the one before it (see `placeUnlocked` — the places
  // unlock in LEVELS order). Shown in the picker (with the PROLOGUE in front of
  // the very first watch).
  story: string;
  theme: EldTheme;
  art?: string;          // optional establishing image (art/place-*.png); silent-fail
  nodeCount: number;
  minDist: number;
  menhirCount: number;   // solid standing stones (cover, blocks bodies)
  wardCount: number;     // ward-stones — the seal sites (sanity beacons)
  riftCount: number;     // rifts — each musters HORROR_PER_RIFT shamblers
  riftSpacing: number;
  wallCount: number;     // crumbled walls woven between rifts (cover + gaze-break)
  pathCount: number;     // old roads the Watcher runs swift along
  darterCount?: number;  // rifts whose second body is a fast darter (default 0)
  bruteCount?: number;   // rifts that muster an extra heavy brute (default 0)
  gazerCount?: number;   // rifts that muster an extra standoff gazer (default 0)
  acolyteCount?: number; // rifts that muster an extra backline acolyte (default 0)
  sizeScale?: number;    // arena size = W/H × this (default 1); leans the difficulty
}

const LEVELS: LevelDef[] = [
  {
    id: "innsmouth",
    name: "Innsmouth",
    epigraph: "A shunned fishing port, its people gone strange and gilled. The host is thin here, the threshold shallow. A fair first watch.",
    story: "It begins on the rotting waterfront your inquiry led you to: Innsmouth, " +
      "whose folk went into the water at Devil Reef and came back gilled and wrong. " +
      "The Deep Ones wade ashore thin here and the threshold is shallow — a place to " +
      "learn the Sign's true price, which is paid in mind, not blood. Seal it, and " +
      "follow the harbour ledgers inland to the hills they traded with.",
    art: "art/place-innsmouth.png",
    // A rotting harbour town — brackish green tide-pools, salt-rain, kelp-dark stone.
    theme: {
      ground: "#0a1512", stone: "#1b2a26", stoneEdge: "#34564a",
      water: "#123a36", waterEdge: "#3f7a64", waterCount: 6,
      haze: "#13241f", hazeOpacity: 0.22, particle: "rain", particleColor: "#9fc4bf",
    },
    nodeCount: 110, minDist: 72,
    menhirCount: 5, wardCount: 6, riftCount: 5, riftSpacing: 360,
    wallCount: 7, pathCount: 6, sizeScale: 0.9,
  },
  {
    id: "dunwich",
    name: "Dunwich",
    epigraph: "Decayed hill-country under whippoorwill skies. The old blood runs thick and the things it calls run faster. Darters haunt the gambrel roofs.",
    story: "Innsmouth's ledgers named the buyers of its gold: the decayed hill-farms " +
      "of Dunwich, where the old blood called something down off Sentinel Hill long " +
      "ago and never sent it back. The whippoorwills pace your heartbeat here, and " +
      "what the old blood calls runs faster than anything the sea sent. Keep to the " +
      "old roads and keep your mind whole — beyond these hills the sea-fog is " +
      "gathering over Kingsport.",
    art: "art/place-dunwich.png",
    // Sour back-country — a sluggish brown creek, fungal spores adrift, sallow stone.
    theme: {
      ground: "#13110a", stone: "#2a2417", stoneEdge: "#56492a",
      water: "#1d2614", waterEdge: "#4d5a2c", waterCount: 3,
      haze: "#171208", hazeOpacity: 0.18, particle: "spore", particleColor: "#9fc06a",
    },
    nodeCount: 122, minDist: 66,
    menhirCount: 6, wardCount: 7, riftCount: 7, riftSpacing: 320,
    wallCount: 6, pathCount: 9, darterCount: 3, gazerCount: 1, acolyteCount: 1, sizeScale: 1.0,
  },
  {
    id: "kingsport",
    name: "Kingsport",
    epigraph: "A queer old town of terrible high houses and sea-fog. The faithful of strange churches keep their rites — and mend their own.",
    story: "What you banished in the hills whispered, before it went, of a town that " +
      "dreams: Kingsport, its terrible high houses climbing into the sea-fog where " +
      "strange steeples keep older rites than any church admits. The faithful mend " +
      "their own — break the acolytes first, or banish the same horror twice. And in " +
      "the fog the harbour charts agree on one impossible thing: a city has risen " +
      "where no city can stand.",
    art: "art/place-kingsport.png",
    // Cliff-town drowned in sea-fog — cold steel harbour, thick haze, pale ash-mist.
    theme: {
      ground: "#0a0e15", stone: "#1c2430", stoneEdge: "#3c5070",
      water: "#15293f", waterEdge: "#3f6390", waterCount: 4,
      haze: "#1b2433", hazeOpacity: 0.4, particle: "ash", particleColor: "#bcc8d6",
    },
    nodeCount: 116, minDist: 70,
    menhirCount: 8, wardCount: 5, riftCount: 8, riftSpacing: 280,
    wallCount: 12, pathCount: 5, darterCount: 3, bruteCount: 2, gazerCount: 3, acolyteCount: 2, sizeScale: 1.1,
  },
  {
    id: "rlyeh",
    name: "R'lyeh",
    epigraph: "The drowned city risen, its geometry all wrong. Here the star-spawn wade and the great gazers watch. In his house the dreamer waits.",
    story: "The charts did not lie. R'lyeh is risen, dripping and aeon-slimed, its " +
      "geometry all wrong to the eye that must nonetheless trace true lines upon it — " +
      "and every threshold you sealed on that long road from Innsmouth was only a " +
      "door to this one. The star-spawn wade its streets; the great gazers watch " +
      "from angles that are not angles. In his house the dreamer waits. Trace the " +
      "Sign a last time, and hold your mind together while you shut what the strange " +
      "aeons opened.",
    art: "art/place-rlyeh.png",
    // The corpse-city under the waves — luminous abyssal water everywhere, rising
    // bubbles, basalt gone green with aeons. The most flooded threshold of all.
    theme: {
      ground: "#04110f", stone: "#0c2220", stoneEdge: "#1f6a64",
      water: "#0a3036", waterEdge: "#27a09a", waterCount: 8,
      haze: "#04181a", hazeOpacity: 0.3, particle: "bubble", particleColor: "#7ad8ff",
    },
    nodeCount: 104, minDist: 84,
    menhirCount: 10, wardCount: 4, riftCount: 9, riftSpacing: 300,
    wallCount: 10, pathCount: 3, darterCount: 2, bruteCount: 4, gazerCount: 4, acolyteCount: 2, sizeScale: 1.18,
  },
];

function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

// ---------- The campaign (the watches as one investigation) ----------
// The places are a single arc, told in order: the Watcher following the horror
// from the shunned coast inland and finally out to the drowned city itself, each
// threshold sealed only revealing the next. The PROLOGUE frames the first watch;
// each LevelDef.story is a chapter linking the place before to the place after;
// the EPILOGUE plays once every threshold is sealed. The places unlock in LEVELS
// order (`placeUnlocked`), so the campaign is the progression — you cannot reach
// Dunwich until Innsmouth is sealed.
const PROLOGUE =
  "You were a scholar once, and should have burned the book. Instead you read " +
  "it — and now you alone can see the thresholds standing open along this " +
  "rotten coast, and the host that wades through them. The Elder Sign you " +
  "took from that page will banish them; it will also, stroke by stroke, " +
  "spend your mind to do it. Keep the watch anyway. No one else can see the " +
  "doors, and the doors are opening.";
const EPILOGUE =
  "Four thresholds, four seals, and the sea lies flat from Innsmouth harbour " +
  "to the impossible meridian where R'lyeh went under again. The dreamer is " +
  "not dead — that is not dead which can eternal lie — but the doors are " +
  "shut, and your Sign holds them shut. What remains of your mind keeps the " +
  "watch still, by lamplight, over charts no sane man will ever read. It is " +
  "enough. It has to be.";

// Sequential progression: the first place is always open; each later one unlocks
// only once the place before it in LEVELS has been sealed at least once (a
// `best` time is recorded on every seal). This is what threads the watches into
// a campaign — you follow the horror the way the story is told. (A duel link
// bypasses this on purpose: answering a gauntlet is a guest pass into a place
// the investigation has not yet reached, exactly like the Vigil's.)
function placeUnlocked(level: LevelDef, l: EldLegacy): boolean {
  const i = LEVELS.indexOf(level);
  if (i <= 0) return true;
  return !!l.best[LEVELS[i - 1].id];
}

// Roman-numeral chapter label for a place (its 1-based place in the campaign).
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
function storyChapter(level: LevelDef): string {
  const i = LEVELS.indexOf(level);
  return ROMAN[i] ?? String(i + 1);
}

// ---------- Arena generation ----------
// The same Poisson-disc-ish placement + kind assignment as the siblings, trimmed to
// return plain {x,y,kind} nodes (no edges/adjacency — a watch never spreads along
// streets). Most nodes are ruins; menhirCount menhirs + wardCount wards are
// scattered; rifts are placed with spacing, clear of each other.

function generateEldritch(
  level: LevelDef,
  w = W * (level.sizeScale ?? 1),
  h = H * (level.sizeScale ?? 1),
): { nodes: ArenaNode[]; rifts: { x: number; y: number }[] } {
  const nodes: ArenaNode[] = [];
  let guard = 0;
  while (nodes.length < level.nodeCount && guard++ < 20000) {
    const x = 60 + rnd() * (w - 120);
    const y = 60 + rnd() * (h - 120);
    if (nodes.every((n) => (n.x - x) ** 2 + (n.y - y) ** 2 > level.minDist ** 2)) {
      nodes.push({ x, y, kind: "ruin" });
    }
  }

  const shuffled = shuffle([...nodes]);
  let cursor = 0;
  const take = (n: number): ArenaNode[] => {
    const slice = shuffled.slice(cursor, cursor + n);
    cursor += n;
    return slice;
  };
  take(level.menhirCount).forEach((n) => (n.kind = "menhir"));
  take(level.wardCount).forEach((n) => { n.kind = "ward"; n.lit = false; });

  // Rifts — placed on still-ruin nodes, spaced apart so waves don't stack.
  const rifts: { x: number; y: number }[] = [];
  for (const n of shuffled) {
    if (n.kind !== "ruin") continue;
    if (rifts.every((p) => (p.x - n.x) ** 2 + (p.y - n.y) ** 2 > level.riftSpacing ** 2)) {
      rifts.push({ x: n.x, y: n.y });
      if (rifts.length >= level.riftCount) break;
    }
  }

  return { nodes, rifts };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Closest point on segment AB to P, and the distance to it. The workhorse for both
// wall collision (capsule = segment + radius) and "is the hero on a path?" (distance
// to the lane's centre line).
function closestOnSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { x: number; y: number; d: number } {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  const x = ax + dx * t, y = ay + dy * t;
  return { x, y, d: Math.hypot(px - x, py - y) };
}

// Do segments A(a→b) and B(c→d) cross? Standard orientation test — used to tell
// whether a wall stands between a gazer and the Watcher (so its gaze is broken).
function segsCross(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy);
  const o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by);
  return o1 !== o2 && o3 !== o4;
}

// Does any wall stand on the line between two points? (A gazer's line of sight asks.)
function wallBetween(s: EldState, ax: number, ay: number, bx: number, by: number): boolean {
  for (const f of s.walls) {
    if (segsCross(ax, ay, bx, by, f.x1, f.y1, f.x2, f.y2)) return true;
  }
  return false;
}

// String `count` line segments between pairs of nodes whose gap falls in [lo, hi],
// hugging each anchor's nearest in-band neighbour so the segment runs along the
// grid. Walls want short gaps; paths want longer gaps. Wards are skipped so the seal
// sites stay clear. Pure geometry — it only reads the placed nodes.
function weaveSegments(
  nodes: ArenaNode[], count: number, lo: number, hi: number,
): Segment[] {
  const segs: Segment[] = [];
  const pool = nodes.filter((n) => n.kind !== "ward");
  if (pool.length < 2) return segs;
  let guard = 0;
  while (segs.length < count && guard++ < count * 40) {
    const a = pool[Math.floor(rnd() * pool.length)];
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

// Push a moving body out of any blocking terrain it has overlapped — solid menhirs
// (circle-vs-circle) and walls (circle-vs-segment) — then back inside the world
// bounds. Shove along the normal so a body slides along an edge rather than stopping.
function pushOut(s: EldState, x: number, y: number, radius: number): { x: number; y: number } {
  for (const n of s.solids) {
    const rr = radius + (OBSTACLE_RADIUS[n.kind] || 0);
    let dx = x - n.x, dy = y - n.y;
    let d = Math.hypot(dx, dy);
    if (d >= rr) continue;
    if (d === 0) { dx = 1; dy = 0; d = 1; }
    x = n.x + (dx / d) * rr;
    y = n.y + (dy / d) * rr;
  }
  for (const f of s.walls) {
    const rr = radius + WALL_HALF;
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

// ---------- Rival duels (zero-backend async challenges) ----------
// Any finished watch folds into a compact URL-safe token: the arena seed (the
// same seed rebuilds the same place everywhere), the challenger's banishing
// timeline, and how their run ended. Opening the game with ?duel=<token> stages
// the SAME battlefield with the rival's echo pacing you on the HUD; the end
// screen calls the verdict and offers the counter-challenge. No server — the
// link IS the duel. The codec/verdict are pure and mirrored verbatim across the
// five siblings (only GAME_TAG differs, so a token never opens the wrong game).
const GAME_TAG = "eldritch";
const NAME_KEY = "lightbringer.rival.name"; // one signature across all five games

interface DuelRun {
  name: string;    // the challenger's signature (sanitized on decode)
  level: string;   // level id — the same ground
  seed: number;    // arena seed — the same ruins, the same host
  weapon: string;  // their equipped Sign id (display only)
  result: "won" | "lost";
  ms: number;      // their clock when the run ended
  score: number;   // their final score (display only; the verdict never reads it)
  kills: number[]; // ms timestamp of each banishing, ascending — the echo
}

// The deterministic PRNG behind a duel seed (same as the Vigil's seal roller).
function mulberry32(a: number): () => number {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Generation-path randomness goes through this hook so a duel seed rebuilds the
// identical arena. buildArena swaps in mulberry32(seed) for the build, then
// restores Math.random — live-sim rolls (drops, AI jitter) stay truly random.
let rnd: () => number = Math.random;

// Fisher–Yates over rnd() — the old sort(() => random - 0.5) shuffle leans on
// engine sort internals, which a cross-device duel seed can't afford.
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// A rival's name travels inside the token and lands in overlay HTML — strip
// anything markup-shaped and cap it. An empty signature gets the stock one.
function sanitizeName(raw: unknown): string {
  const s = String(raw ?? "").replace(/[<>&"'`]/g, "").replace(/\s+/g, " ").trim();
  return s.slice(0, 24) || "A rival";
}

// Kill times ride as delta-encoded deciseconds (small ints, so the JSON stays
// tight); the whole record is JSON → base64url. ~100 kills ≈ a 500-char token.
function encodeDuel(run: DuelRun): string {
  let prev = 0;
  const k = run.kills.map((t) => {
    const ds = Math.max(prev, Math.round(t / 100));
    const d = ds - prev; prev = ds; return d;
  });
  const json = JSON.stringify({
    v: 1, g: GAME_TAG, n: run.name, l: run.level, s: run.seed, w: run.weapon,
    r: run.result === "won" ? 1 : 0, t: Math.round(run.ms), sc: Math.round(run.score), k,
  });
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Strict decode: any malformed, foreign-game, or unknown-level token yields
// null (a bad link must never throw mid-boot). Numbers are re-validated — the
// token is player-supplied data.
function decodeDuel(token: string): DuelRun | null {
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const o = JSON.parse(decodeURIComponent(escape(atob(b64)))) as Record<string, unknown>;
    if (o.v !== 1 || o.g !== GAME_TAG) return null;
    if (!levelById(String(o.l))) return null;
    const seed = Number(o.s);
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
    if (!Array.isArray(o.k)) return null;
    let acc = 0;
    const kills: number[] = [];
    for (const d of o.k) {
      const n = Number(d);
      if (!Number.isFinite(n) || n < 0) return null;
      acc += Math.round(n);
      kills.push(acc * 100);
    }
    const ms = Number(o.t), score = Number(o.sc);
    if (!Number.isFinite(ms) || ms < 0 || !Number.isFinite(score)) return null;
    return {
      name: sanitizeName(o.n), level: String(o.l), seed: seed >>> 0,
      weapon: String(o.w ?? ""), result: o.r === 1 ? "won" : "lost",
      ms: Math.round(ms), score: Math.round(score), kills,
    };
  } catch { return null; }
}

// How many of the rival's kills had landed by `elapsed` — the echo's pace, read
// by the HUD every frame and by the tests. Kills are ascending, so break early.
function rivalKillsAt(rival: DuelRun, elapsed: number): number {
  let n = 0;
  for (const t of rival.kills) { if (t <= elapsed) n++; else break; }
  return n;
}

// Who takes the duel. Sealing beats falling; two seals race the clock; two falls
// compare how much of the host each banished, then who lasted longer. Score is
// deliberately not consulted — it bends with Signs, while time-and-kills on the
// same seed is apples to apples.
function duelVerdict(mine: DuelRun, rival: DuelRun): "win" | "loss" | "draw" {
  if (mine.result !== rival.result) return mine.result === "won" ? "win" : "loss";
  if (mine.result === "won") {
    if (mine.ms !== rival.ms) return mine.ms < rival.ms ? "win" : "loss";
    return "draw";
  }
  if (mine.kills.length !== rival.kills.length) {
    return mine.kills.length > rival.kills.length ? "win" : "loss";
  }
  if (mine.ms !== rival.ms) return mine.ms > rival.ms ? "win" : "loss";
  return "draw";
}

// Build a fresh watch: dress the place, drop the Watcher at its heart, and muster a
// finite host from each rift (shamblers, with the per-place variants seeded among
// them as extra bodies — the same "extra defenders" pattern the siblings use).
function buildArena(level: LevelDef, seed?: number): EldState {
  // The whole build runs on a seeded stream: pass a rival's seed and the same
  // place rises — same ruins, same rifts, same host — on any device. Left
  // unseeded, a fresh roll is drawn (and kept on s.seed), so ANY watch can be
  // turned into a challenge after the fact.
  const arenaSeed = (seed ?? Math.floor(Math.random() * 0x100000000)) >>> 0;
  rnd = mulberry32(arenaSeed);
  const w = Math.round(W * (level.sizeScale ?? 1));
  const h = Math.round(H * (level.sizeScale ?? 1));
  const { nodes: scenery, rifts } = generateEldritch(level, w, h);
  const walls = weaveSegments(scenery, level.wallCount, level.minDist * 0.9, level.minDist * 2.0);
  const paths = weaveSegments(scenery, level.pathCount, level.minDist * 3, level.minDist * 5);
  const legacy = loadEldLegacy();
  const sign = signTypeById(legacy.equipped);
  const hero: Hero = {
    x: w / 2, y: h / 2, vx: 0, vy: 0, hp: HERO_HP, maxHp: HERO_HP,
    sanity: HERO_SANITY, maxSanity: HERO_SANITY,
    hurt: 0, charge: 0, overcharge: 0, signCd: 0, angle: 0,
  };
  const horrors: Horror[] = [];
  const darterCount = Math.min(level.darterCount ?? 0, rifts.length);
  const bruteCount = Math.min(level.bruteCount ?? 0, rifts.length);
  const gazerCount = Math.min(level.gazerCount ?? 0, rifts.length);
  const acolyteCount = Math.min(level.acolyteCount ?? 0, rifts.length);
  // Muster one horror near a rift — a small helper so a rift's shamblers and its
  // (optional) variants all rise the same way.
  const muster = (rift: { x: number; y: number }, variant: HorrorKind, hpMul: number): void => {
    const a = rnd() * Math.PI * 2;
    const r = 16 + rnd() * 40;
    const x = clamp(rift.x + Math.cos(a) * r, HORROR_RADIUS, w - HORROR_RADIUS);
    const y = clamp(rift.y + Math.sin(a) * r, HORROR_RADIUS, h - HORROR_RADIUS);
    const hp = Math.round(HORROR_HP * hpMul);
    horrors.push({
      x, y, vx: 0, vy: 0, hp, maxHp: hp, dead: false,
      state: "lurk", variant,
      wanderAngle: rnd() * Math.PI * 2,
      homeX: rift.x, homeY: rift.y,
      attackCd: 0, hit: 0, bornAt: 0,
    });
  };
  // Water bodies — atmospheric only (no collision), seeded clear of the Watcher's
  // central spawn so the opening read is dry ground. Each place floods in its own.
  const pools: Pool[] = [];
  let pg = 0;
  while (pools.length < level.theme.waterCount && pg++ < 600) {
    const rx = 78 + rnd() * 150;
    const ry = rx * (0.55 + rnd() * 0.5);
    const x = clamp(40 + rnd() * (w - 80), rx, w - rx);
    const y = clamp(40 + rnd() * (h - 80), ry, h - ry);
    if ((x - w / 2) ** 2 + (y - h / 2) ** 2 < 220 ** 2) continue;
    pools.push({ x, y, rx, ry, seed: Math.floor(rnd() * 1000) });
  }
  rifts.forEach((rift, ri) => {
    for (let j = 0; j < HORROR_PER_RIFT; j++) {
      // The 2nd body of a rift is a fast darter on the first `darterCount` rifts.
      const darter = j === 1 && ri < darterCount;
      const variant: HorrorKind = darter ? "darter" : "shambler";
      const hpMul = darter ? DARTER_HP_MUL : 1;
      muster(rift, variant, hpMul);
    }
    // The specialists are EXTRA bodies the first N rifts raise — added, not slotted.
    if (ri < bruteCount) muster(rift, "brute", BRUTE_HP_MUL);
    if (ri < gazerCount) muster(rift, "gazer", GAZER_HP_MUL);
    if (ri < acolyteCount) muster(rift, "acolyte", ACOLYTE_HP_MUL);
  });
  const state: EldState = {
    level, w, h, scenery,
    solids: scenery.filter((n) => OBSTACLE_KINDS.has(n.kind)),
    wards: scenery.filter((n) => n.kind === "ward"),
    walls, paths, pools,
    hero, sign, horrors,
    pulses: [], motes: [],
    fervor: 0, fervorUntil: 0,
    tollNext: TOLL_FIRST_MS, tolls: 0, tollFlash: 0,
    elapsed: 0, banished: 0, hits: 0, total: horrors.length,
    wardsTotal: scenery.filter((n) => n.kind === "ward").length,
    litCount: 0, defiledCount: 0,
    seed: arenaSeed, killTimes: [],
    phase: "watch", lossCause: "slain",
  };
  rnd = Math.random; // the seeded window covers the build only — live sim rolls free
  return state;
}

const freshWatch = buildArena; // alias, mirrors the siblings' freshGame naming

// ---------- Watch simulation (pure, headless-testable) ----------

function aliveHorrors(s: EldState): number {
  let n = 0;
  for (const e of s.horrors) if (!e.dead) n++;
  return n;
}

function clearedPct(s: EldState): number {
  return s.total ? s.banished / s.total : 0;
}

// The HUD's secondary readout: wards sealed and the host that remains.
function sanityReadout(s: EldState): string {
  return `${Math.ceil(s.hero.sanity)} sanity · ${s.litCount}/${s.wardsTotal} wards`;
}

function difficultyMult(level: LevelDef): number {
  const variants = (level.darterCount ?? 0) + (level.bruteCount ?? 0) +
    (level.gazerCount ?? 0) + (level.acolyteCount ?? 0);
  const m = 0.8 + level.riftCount * 0.05 + variants * 0.04 + ((level.sizeScale ?? 1) - 1) * 0.5;
  return Math.round(m * 100) / 100;
}

interface ScoreBreakdown {
  base: number; speed: number; wards: number; survival: number;
  sanity: number; untouched: number; mult: number; total: number;
}
function scoreRun(s: EldState): ScoreBreakdown {
  const base = s.total * SCORE_PER_BANISH;
  const target = s.total * SCORE_TARGET_PER_BANISH;
  const speed = Math.max(0, Math.round(((target - s.elapsed) / 1000) * SCORE_SPEED_PER_SEC));
  const wards = s.wardsTotal ? Math.round((s.litCount / s.wardsTotal) * SCORE_WARDS_MAX) : 0;
  const survival = Math.round((s.hero.hp / s.hero.maxHp) * SCORE_SURVIVAL_MAX);
  const sanity = Math.round((s.hero.sanity / s.hero.maxSanity) * SCORE_SANITY_MAX);
  const untouched = s.hits === 0 ? SCORE_UNTOUCHED : 0;
  const mult = difficultyMult(s.level);
  const total = Math.round((base + speed + wards + survival + sanity + untouched) * mult);
  return { base, speed, wards, survival, sanity, untouched, mult, total };
}

// Centralized horror-death path — so every banishing (Sign pulse, ward aura, chain
// arc) counts the same and fires the Sign's on-banish power identically. The mirror
// of the siblings' killKnight / killMinion.
function banish(s: EldState, e: Horror): void {
  if (e.dead) return;
  e.dead = true;
  s.banished += 1;
  s.killTimes.push(Math.round(s.elapsed)); // the echo a duel token carries
  // Every banishing stokes the Watcher's zeal and re-opens its window.
  s.fervor = Math.min(1, s.fervor + FERVOR_PER_KILL);
  s.fervorUntil = s.elapsed + FERVOR_WINDOW_MS;
  // The Sign's on-banish powers.
  if (s.sign.power === "calm") {
    s.hero.sanity = clamp(s.hero.sanity + CALM_SANITY, 0, s.hero.maxSanity);
  }
  if (s.sign.power === "chain") {
    const idx = nearestHorror(s, e.x, e.y, CHAIN_RANGE);
    if (idx >= 0) hurtHorror(s, s.horrors[idx], CHAIN_DMG);
  }
  // A banished horror may leave a clue-mote (the sanity economy's heartbeat).
  if (Math.random() < MOTE_DROP_CHANCE) {
    s.motes.push({ x: e.x, y: e.y, until: s.elapsed + MOTE_TTL_MS });
  }
}

// Centralized horror-damage path. All Sign / ward / chain damage routes through it.
function hurtHorror(s: EldState, e: Horror, dmg: number): void {
  if (e.dead) return;
  e.hp -= dmg;
  e.hit = s.elapsed + HIT_FLASH_MS;
  if (e.hp <= 0) { e.hp = 0; banish(s, e); }
}

// Index of the nearest non-dead horror to (x,y) within `range`, or -1. (Chain asks.)
function nearestHorror(s: EldState, x: number, y: number, range: number): number {
  let best = -1, bestD = range;
  for (let i = 0; i < s.horrors.length; i++) {
    const e = s.horrors[i];
    if (e.dead) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Fire one banishing pulse from the Watcher — AoE damage to the host in reach, a
// sanity cost, sealing any dark ward caught, the Sign's power, and an empowered
// erupt if an overcharge is banked. The deterministic heart of the weapon; stepSign
// gates and paces it, the test calls it directly.
function firePulse(s: EldState): void {
  const h = s.hero;
  const empowered = h.overcharge >= 1;
  const radius = SIGN_RADIUS * s.sign.radiusMul * (empowered ? OVERCHARGE_RADIUS_MUL : 1);
  // The bite: the Sign's lean × the zeal of the banish-streak.
  const dmg = SIGN_DMG * s.sign.dmgMul * (1 + FERVOR_DMG * s.fervor);
  // Tracing the Sign frays the mind (an empowered pulse repays it below).
  h.sanity = clamp(h.sanity - SIGN_SANITY_COST * s.sign.sanityCostMul, 0, h.maxSanity);
  for (const e of s.horrors) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    if (d > radius + HORROR_RADIUS) continue;
    if (empowered || s.sign.power === "repel") {
      const a = Math.atan2(e.y - h.y, e.x - h.x);
      // The shove respects the world: clamped to the arena and pushed out of
      // solids, so a repelled horror can't be flung through a menhir or off-map.
      const p = pushOut(s,
        clamp(e.x + Math.cos(a) * REPEL_KNOCK, HORROR_RADIUS, s.w - HORROR_RADIUS),
        clamp(e.y + Math.sin(a) * REPEL_KNOCK, HORROR_RADIUS, s.h - HORROR_RADIUS),
        HORROR_RADIUS);
      e.x = p.x; e.y = p.y;
    }
    hurtHorror(s, e, dmg);
  }
  // Seal any dark ward the ring caught (a secondary objective folded into the verb).
  for (const n of s.wards) {
    if (n.lit) continue;
    if (n.defiled && n.defiled > s.elapsed) continue;
    if (Math.hypot(n.x - h.x, n.y - h.y) <= radius + WARD_SEAL_REACH) kindleWard(s, n);
  }
  if (empowered) {
    h.sanity = clamp(h.sanity + OVERCHARGE_SANITY, 0, h.maxSanity);
    h.overcharge = 0;
  }
  s.pulses.push({ x: h.x, y: h.y, r: radius, until: s.elapsed + PULSE_FX_MS });
}

// Pace the Sign: only a sufficiently-traced sigil pulses, and only on its cadence.
function stepSign(s: EldState, dt = 16): void {
  const h = s.hero;
  if (h.charge < SIGN_BANISH_AT) return;
  h.signCd -= dt;
  if (h.signCd > 0) return;
  h.signCd = SIGN_PULSE_MS * s.sign.pulseMul;
  firePulse(s);
}

// The Tolling — the watch's pacing engine, the Vigil's bell heard through fathoms
// of black water. When its time comes, the cohort of lurking horrors NEAREST the
// Watcher rouses and converges (near ones, so a fight arrives soon, from every
// direction at once). Each toll stirs a bigger cohort, and the cadence shortens
// as the host thins, so the endgame hunts the Watcher instead of hiding from him.
function stepToll(s: EldState): void {
  if (s.elapsed < s.tollNext) return;
  const lurkers = s.horrors
    .filter((e) => !e.dead && e.state === "lurk")
    .map((e) => ({ e, d: (e.x - s.hero.x) ** 2 + (e.y - s.hero.y) ** 2 }))
    .sort((a, b) => a.d - b.d);
  const count = TOLL_ROUSE_BASE + s.tolls * TOLL_ROUSE_GROWTH;
  for (const { e } of lurkers.slice(0, count)) e.state = "hunt";
  s.tolls++;
  s.tollFlash = s.elapsed + TOLL_FLASH_MS;
  const cleared = s.total ? s.banished / s.total : 0;
  s.tollNext = s.elapsed + TOLL_INTERVAL_MS * (1 - TOLL_ACCEL * cleared);
}

// The heartbeat readout for the HUD — pure, so the harness can assert it: the
// bell's countdown, the zeal's burn, and a banked overcharge.
function watchReadout(s: EldState): string {
  const parts: string[] = [];
  const bell = Math.max(0, Math.ceil((s.tollNext - s.elapsed) / 1000));
  if (bell <= 6) parts.push(`Bell ${bell}s`);
  if (s.fervor > 0) parts.push(`Zeal ×${(1 + FERVOR_DMG * s.fervor).toFixed(1)}`);
  if (s.hero.overcharge >= 1) parts.push("SIGN charged");
  return parts.join(" · ");
}

// The host's dread bleeds the Watcher's mind — each hunting horror within
// DREAD_RADIUS drains sanity, scaled by closeness and the kind's dread weight.
function stepDread(s: EldState, dt: number): void {
  const h = s.hero;
  let drain = 0;
  for (const e of s.horrors) {
    if (e.dead || e.state !== "hunt") continue;
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    if (d > DREAD_RADIUS) continue;
    drain += DREAD_DPS * (HORROR_DREAD[e.variant] ?? 1) * (1 - d / DREAD_RADIUS);
  }
  if (drain > 0) h.sanity = clamp(h.sanity - (drain * dt) / 1000, 0, h.maxSanity);
}

// Move a body by a desired velocity for dt, then push it out of terrain. Shared by
// every horror kind so collision is uniform.
function moveBody(s: EldState, e: Horror, vx: number, vy: number, dt: number, radius: number): void {
  e.vx = vx; e.vy = vy;
  const p = pushOut(s, e.x + (vx * dt) / 1000, e.y + (vy * dt) / 1000, radius);
  e.x = p.x; e.y = p.y;
}

// Separation: nudge a horror away from its crowded neighbours so the host swarms
// rather than stacking into one point.
function separate(s: EldState, e: Horror): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const o of s.horrors) {
    if (o === e || o.dead) continue;
    const dx = e.x - o.x, dy = e.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < HORROR_SEP) { sx += (dx / d) * (HORROR_SEP - d); sy += (dy / d) * (HORROR_SEP - d); }
  }
  return { x: sx, y: sy };
}

// The host AI. A horror lurks near its rift until the Watcher comes within aggro (or
// the cleanup sweep rouses it), then hunts. Melee kinds close and claw; the gazer
// holds a standoff and lances the mind; the acolyte holds back and mends the host.
function stepHorrors(s: EldState, dt: number): void {
  const h = s.hero;
  const fewLeft = aliveHorrors(s) <= Math.ceil(s.total * CLEANUP_AGGRO_FRAC);
  for (const e of s.horrors) {
    if (e.dead) continue;
    e.gaze = false; e.mending = false;
    const dxh = h.x - e.x, dyh = h.y - e.y;
    const dh = Math.hypot(dxh, dyh) || 1;

    if (e.state === "lurk") {
      if (dh < HORROR_AGGRO || fewLeft) {
        e.state = "hunt";
      } else {
        // Idle drift on a leash around the rift (jitter scaled by dt so the
        // drift's character doesn't change with the display's refresh rate).
        e.wanderAngle += (Math.random() - 0.5) * 0.5 * (dt / 16.7);
        let wx = Math.cos(e.wanderAngle) * HORROR_WANDER_SPEED;
        let wy = Math.sin(e.wanderAngle) * HORROR_WANDER_SPEED;
        const dHome = Math.hypot(e.x - e.homeX, e.y - e.homeY);
        if (dHome > HORROR_LEASH) {
          wx = ((e.homeX - e.x) / dHome) * HORROR_WANDER_SPEED;
          wy = ((e.homeY - e.y) / dHome) * HORROR_WANDER_SPEED;
        }
        moveBody(s, e, wx, wy, dt, HORROR_RADIUS);
        continue;
      }
    }

    const sep = separate(s, e);

    if (e.variant === "gazer") {
      // Hold a standoff; lance the mind with line of sight.
      const speed = HORROR_SPEED * GAZER_SPEED_MUL;
      let dirx = 0, diry = 0;
      if (dh < GAZER_STANDOFF) { dirx = -dxh / dh; diry = -dyh / dh; }   // kite away
      else if (dh > GAZER_RANGE) { dirx = dxh / dh; diry = dyh / dh; }   // close in
      moveBody(s, e, dirx * speed + sep.x, diry * speed + sep.y, dt, HORROR_RADIUS);
      if (dh <= GAZER_RANGE && !wallBetween(s, e.x, e.y, h.x, h.y)) {
        e.gaze = true;
        h.sanity = clamp(h.sanity - (GAZE_DPS * dt) / 1000, 0, h.maxSanity);
      }
      defileNearWard(s, e);
      continue;
    }

    if (e.variant === "acolyte") {
      // Hold back; mend the most-wounded horror in range.
      const speed = HORROR_SPEED * ACOLYTE_SPEED_MUL;
      let dirx = 0, diry = 0;
      if (dh < ACOLYTE_STANDOFF) { dirx = -dxh / dh; diry = -dyh / dh; } // kite from the Watcher
      moveBody(s, e, dirx * speed + sep.x, diry * speed + sep.y, dt, HORROR_RADIUS);
      let mark: Horror | null = null, worst = 1;
      for (const o of s.horrors) {
        if (o === e || o.dead || o.hp >= o.maxHp) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) > ACOLYTE_RANGE) continue;
        const frac = o.hp / o.maxHp;
        if (frac < worst) { worst = frac; mark = o; }
      }
      if (mark) {
        mark.hp = Math.min(mark.maxHp, mark.hp + (ACOLYTE_HEAL * dt) / 1000);
        e.mending = true; e.mendX = mark.x; e.mendY = mark.y;
      }
      defileNearWard(s, e);
      continue;
    }

    // Melee kinds (shambler / darter / brute): close and claw.
    const speed = HORROR_SPEED *
      (e.variant === "darter" ? DARTER_SPEED_MUL : e.variant === "brute" ? BRUTE_SPEED_MUL : 1);
    moveBody(s, e, (dxh / dh) * speed + sep.x, (dyh / dh) * speed + sep.y, dt, HORROR_RADIUS);
    if (e.attackCd > 0) e.attackCd -= dt;
    const reach = HERO_RADIUS + HORROR_RADIUS + HORROR_ATTACK_REACH;
    // The cooldown is only spent on a landed blow — a horror pawing at an
    // i-framed Watcher keeps its swing ready for the instant the frames end
    // (matching the necro knights' melee).
    if (dh <= reach && e.attackCd <= 0 && h.hurt <= 0) {
      e.attackCd = HORROR_ATTACK_CD;
      const contact = e.variant === "darter" ? DARTER_CONTACT
        : e.variant === "brute" ? BRUTE_CONTACT : HORROR_CONTACT;
      h.hp -= contact;
      h.hurt = HERO_IFRAMES_MS;
      s.hits += 1;
      h.x = clamp(h.x + (dxh / dh) * -HERO_KNOCKBACK, HERO_RADIUS, s.w - HERO_RADIUS);
      h.y = clamp(h.y + (dyh / dh) * -HERO_KNOCKBACK, HERO_RADIUS, s.h - HERO_RADIUS);
    }
    defileNearWard(s, e);
  }
}

// A horror brushing a sealed ward defiles it (dark again + a scar bars resealing).
function defileNearWard(s: EldState, e: Horror): void {
  for (const n of s.wards) {
    if (!n.lit) continue;
    if (Math.hypot(e.x - n.x, e.y - n.y) <= HORROR_RADIUS + DEFILE_REACH) defileWard(s, n);
  }
}

// Seal a dark ward: light it, count it, and steady the Watcher's mind a little.
function kindleWard(s: EldState, n: ArenaNode): void {
  if (n.lit) return;
  if (n.defiled && n.defiled > s.elapsed) return;
  n.lit = true; n.litAt = s.elapsed;
  s.litCount += 1;
  s.hero.sanity = clamp(s.hero.sanity + WARD_KINDLE_SANITY, 0, s.hero.maxSanity);
}

// Defile a sealed ward: dark again, drop the tally, and scar the ground for a while.
function defileWard(s: EldState, n: ArenaNode): void {
  if (!n.lit) return;
  n.lit = false; n.litAt = undefined;
  n.defiled = s.elapsed + DEFILE_MS;
  s.litCount = Math.max(0, s.litCount - 1);
  s.defiledCount += 1;
}

function nearScar(s: EldState, x: number, y: number): boolean {
  for (const n of s.wards) {
    if (n.defiled && n.defiled > s.elapsed && Math.hypot(n.x - x, n.y - y) <= SCAR_RADIUS) return true;
  }
  return false;
}

// Sealed wards as ally emitters: the aura steadies the Watcher's mind and burns the
// host that strays in.
function stepWards(s: EldState, dt: number): void {
  const h = s.hero;
  for (const n of s.wards) {
    if (!n.lit) continue;
    if (Math.hypot(h.x - n.x, h.y - n.y) <= WARD_AURA) {
      h.sanity = clamp(h.sanity + (WARD_SANITY_PER_SEC * dt) / 1000, 0, h.maxSanity);
    }
    for (const e of s.horrors) {
      if (e.dead) continue;
      if (Math.hypot(e.x - n.x, e.y - n.y) <= WARD_AURA) hurtHorror(s, e, (WARD_DMG * dt) / 1000);
    }
  }
}

// Gather any clue-mote underfoot — it steadies the mind.
function stepMotes(s: EldState): void {
  const h = s.hero;
  const reach = HERO_RADIUS + MOTE_RADIUS;
  for (let i = s.motes.length - 1; i >= 0; i--) {
    const m = s.motes[i];
    if (m.until <= s.elapsed) { s.motes.splice(i, 1); continue; }
    if (Math.hypot(m.x - h.x, m.y - h.y) <= reach) {
      h.sanity = clamp(h.sanity + CLUE_SANITY, 0, h.maxSanity);
      s.motes.splice(i, 1);
    }
  }
}

// The per-frame entry. Integrates the Watcher, runs the host, the wards, dread and
// motes, then checks the terminal states (slain, mad, or the threshold sealed).
function stepWatch(s: EldState, dt: number, move: Move): void {
  if (s.phase !== "watch") return;
  s.elapsed += dt;
  const h = s.hero;

  // Running along an old path carries the Watcher swift; off it, normal.
  const onPath = s.paths.some(
    (p) => closestOnSegment(h.x, h.y, p.x1, p.y1, p.x2, p.y2).d <= PATH_HALF,
  );
  // Burning zeal quickens the stride — the streak feeds momentum.
  const speed = HERO_SPEED * (1 + FERVOR_SPEED * s.fervor) * (onPath ? PATH_BOOST : 1);
  h.vx = move.x * speed;
  h.vy = move.y * speed;
  {
    const p = pushOut(s, h.x + (h.vx * dt) / 1000, h.y + (h.vy * dt) / 1000, HERO_RADIUS);
    h.x = p.x; h.y = p.y;
  }
  if (h.hurt > 0) h.hurt = Math.max(0, h.hurt - dt);

  // Zeal bleeds once its banish-window lapses — a streak must be FED to burn.
  if (s.fervor > 0 && s.elapsed > s.fervorUntil) {
    s.fervor = Math.max(0, s.fervor - dt / FERVOR_DECAY_MS);
  }

  // The Sign traces while the Watcher holds still and fades as he moves; past a full
  // trace the held stand banks an overcharge (the next pulse erupts, see firePulse).
  const chargeMs = SIGN_CHARGE_MS * s.sign.chargeMul;
  if (Math.hypot(h.vx, h.vy) < HERO_STILL_MAXSPEED) {
    h.charge = Math.min(1, h.charge + dt / chargeMs);
    if (h.charge >= 1) h.overcharge = Math.min(1, h.overcharge + dt / SIGN_OVERCHARGE_MS);
  } else {
    h.charge = Math.max(0, h.charge - dt / chargeMs);
    h.overcharge = 0; // moving spends the banked overcharge back to nothing
  }
  h.angle = (h.angle + dt * SIGN_SPIN) % 360;

  stepToll(s);         // the drowned bell: stir a converging cohort on its cadence
  stepSign(s, dt);     // a traced Sign pulses, banishing the host in reach (costs sanity)
  stepHorrors(s, dt);  // the host lurks / hunts the Watcher, claws or lances the mind
  stepWards(s, dt);    // sealed wards steady the mind and burn the host in their aura
  stepDread(s, dt);    // the nearness of the host bleeds the mind
  stepMotes(s);        // gather any clue-mote underfoot (steadies the mind)

  // Retire spent FX (cheap; only when any are live).
  if (s.pulses.length) s.pulses = s.pulses.filter((p) => p.until > s.elapsed);

  // Terminal: slain (HP), mad (SANITY), or the threshold sealed (host banished).
  if (h.hp <= 0) { h.hp = 0; s.phase = "lost"; s.lossCause = "slain"; return; }
  if (h.sanity <= 0) { h.sanity = 0; s.phase = "lost"; s.lossCause = "mad"; return; }
  if (aliveHorrors(s) === 0) { s.phase = "won"; }
}

// ---------- Sprites (reused pattern from app.ts / pentagram.ts / necro.ts) ----------

const svgNS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// The base sprites this spinoff may draw. Every one has a procedural fallback, so
// the game is fully playable with zero PNGs — none have shipped yet, so none are in
// sw.js (added when the art ships). Scenery uses the ruin/menhir/ward art; the
// Watcher and the host are their own sprites.
const SPRITE_NAMES = [
  "ground", "ruin", "menhir", "ward", "ward-lit", "ward-defiled",
  "wall", "path", "watcher",
  "shambler", "darter", "brute", "gazer", "acolyte",
] as const;

// Which sprites a place may re-skin (art/<placeId>/<name>.png) — the built world.
const CITY_SPRITES = new Set<string>(["ground", "ruin", "menhir", "ward", "ward-lit"]);

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

function spriteImage(key: string, x: number, y: number, size: number, opacity: number): SVGImageElement {
  return el("image", {
    href: `art/${key}.png`,
    x: x - size / 2, y: y - size / 2, width: size, height: size,
    opacity, mask: "url(#spriteFade)",
  });
}

// The Watcher's Sign is the Necronomicon "Sigil of the Gateway" — the Lovecraftian
// gate the investigator traces, in place of the siblings' five-pointed star. Pure
// geometry: an outer ring enclosing an interlaced lattice (a top apex fanning rays
// down, two chords, a woven base) with three small binding loops. Authored in a
// unit circle, then scaled to r, rotated by rotDeg and centred on (cx,cy). Returns
// one multi-subpath `d` string — stroked, never filled — and closes (ends in "Z")
// so it reads as a single sealed sign.
function pentagramPath(cx: number, cy: number, r: number, rotDeg: number): string {
  const rot = (rotDeg * Math.PI) / 180;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const f = (n: number) => n.toFixed(1);
  // Map a unit-circle point (rotation about centre, y down) into world space.
  const P = (ux: number, uy: number): [number, number] => {
    const x = ux * r, y = uy * r;
    return [cx + x * cosR - y * sinR, cy + x * sinR + y * cosR];
  };
  // A straight polyline through unit points.
  const seg = (pts: [number, number][]): string => {
    const w = pts.map(([ux, uy]) => P(ux, uy));
    let s = `M${f(w[0][0])} ${f(w[0][1])}`;
    for (let i = 1; i < w.length; i++) s += `L${f(w[i][0])} ${f(w[i][1])}`;
    return s;
  };
  // A small binding loop (full circle of unit-radius lr, centred on unit (ux,uy)).
  const loop = (ux: number, uy: number, lr: number): string => {
    const [tx, ty] = P(ux, uy - lr);
    const [bx, by] = P(ux, uy + lr);
    const wr = lr * r;
    return `M${f(tx)} ${f(ty)}A${f(wr)} ${f(wr)} 0 1 1 ${f(bx)} ${f(by)}A${f(wr)} ${f(wr)} 0 1 1 ${f(tx)} ${f(ty)}`;
  };
  // The enclosing ring (drawn as two arcs from top to bottom and back).
  const [topx, topy] = P(0, -1), [botx, boty] = P(0, 1);
  let d = `M${f(topx)} ${f(topy)}A${f(r)} ${f(r)} 0 1 1 ${f(botx)} ${f(boty)}A${f(r)} ${f(r)} 0 1 1 ${f(topx)} ${f(topy)}`;
  // The interlaced lattice (straight chords).
  const T: [number, number] = [0, -0.9]; // top apex
  d += seg([T, [-0.66, 0.55]]);          // apex rays, fanning down
  d += seg([T, [0.66, 0.55]]);
  d += seg([T, [-0.28, 0.78]]);
  d += seg([T, [0.30, 0.77]]);
  d += seg([[-0.88, -0.30], [0.88, -0.30]]); // upper chord
  d += seg([[-0.82, 0.12], [0.86, -0.04]]);  // lower (tilted) chord
  d += seg([[-0.66, 0.55], [0.30, 0.77]]);   // woven base
  d += seg([[0.66, 0.55], [-0.28, 0.78]]);
  d += seg([[-0.66, 0.55], [0.66, 0.55]]);   // base chord
  // Three binding loops (upper-right, left, base).
  d += loop(0.52, -0.52, 0.1);
  d += loop(-0.78, 0.04, 0.1);
  d += loop(-0.02, 0.82, 0.1);
  return d + "Z";
}

// ---------- Render (reads EldState; wholesale rebuild each frame) ----------

// Built once: filters/gradients + the camera group. The palette is the abyssal
// cyan/violet of the deep, in place of the siblings' warm flame and necrotic green.
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
    <filter id="waterRipple" x="-25%" y="-25%" width="150%" height="150%">
      <feTurbulence type="fractalNoise" baseFrequency="0.014 0.022" numOctaves="2" seed="11" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="30" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="hazeBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="40"/>
    </filter>
    <radialGradient id="signGlow">
      <stop offset="0%" stop-color="#e6f6ff" stop-opacity="1"/>
      <stop offset="30%" stop-color="#7ad8ff" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#7ad8ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ward">
      <stop offset="0%" stop-color="#d8fbff" stop-opacity="0.5"/>
      <stop offset="46%" stop-color="#5ad0ff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#7a3cff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mote">
      <stop offset="0%" stop-color="#eaffff" stop-opacity="1"/>
      <stop offset="45%" stop-color="#7ad8ff" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#7ad8ff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="dread">
      <stop offset="55%" stop-color="#1a0026" stop-opacity="0"/>
      <stop offset="100%" stop-color="#1a0026" stop-opacity="0.8"/>
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

const SCENERY_SIZE: Record<NodeKind, number> = { ruin: 46, menhir: 48, ward: 44 };

// Resolve a node's sprite name from its live state.
function scenerySprite(s: EldState, n: ArenaNode): string {
  switch (n.kind) {
    case "ward":
      if (n.lit) return "ward-lit";
      if (n.defiled && n.defiled > s.elapsed && sprites.has("ward-defiled")) return "ward-defiled";
      return "ward";
    default:
      return n.kind;
  }
}

const HORROR_HUE: Record<HorrorKind, string> = {
  shambler: "#4f8a7a", darter: "#7a9b4f", brute: "#5a4f8a", gazer: "#8a4f7a", acolyte: "#8a7a4f",
};

function render(s: EldState, layer: SVGGElement): void {
  layer.innerHTML = "";

  // Ground — the place's floor, tinted to its theme so each threshold reads as its
  // own world even with no art loaded; the shared ground.png washes over the tint.
  const th = s.level.theme;
  const hasGround = sprites.has("ground");
  layer.appendChild(el("rect", { x: 0, y: 0, width: s.w, height: s.h, fill: th.ground }));
  if (hasGround) {
    layer.appendChild(el("rect", { x: 0, y: 0, width: s.w, height: s.h, fill: "url(#groundPat)", opacity: 0.34 }));
  }

  // Water — the place's signature element: drowned plazas, brackish tide-pools, a
  // sour creek. Cosmetic (bodies wade through). Organic shorelines via turbulence,
  // with a slow animated shimmer and drifting ripple rings keyed off elapsed time.
  for (const p of s.pools) {
    const g = el("g", { filter: "url(#waterRipple)" });
    g.appendChild(el("ellipse", { cx: p.x, cy: p.y, rx: p.rx, ry: p.ry, fill: th.water, opacity: 0.92 }));
    g.appendChild(el("ellipse", {
      cx: p.x, cy: p.y, rx: p.rx, ry: p.ry,
      fill: "none", stroke: th.waterEdge, "stroke-width": 3, opacity: 0.55,
    }));
    // Surface highlight — a soft offset disc that catches the abyssal light.
    g.appendChild(el("ellipse", {
      cx: p.x - p.rx * 0.16, cy: p.y - p.ry * 0.2, rx: p.rx * 0.5, ry: p.ry * 0.42,
      fill: th.waterEdge, opacity: 0.12,
    }));
    layer.appendChild(g);
    // Two expanding ripple rings, phased by the pool's seed (drawn crisp, unfiltered).
    for (let i = 0; i < 2; i++) {
      const ph = ((s.elapsed * 0.00018) + p.seed * 0.31 + i * 0.5) % 1;
      layer.appendChild(el("ellipse", {
        cx: p.x, cy: p.y, rx: p.rx * (0.25 + ph * 0.7), ry: p.ry * (0.25 + ph * 0.7),
        fill: "none", stroke: th.waterEdge, "stroke-width": 1.4,
        opacity: (1 - ph) * 0.3, "pointer-events": "none",
      }));
    }
  }

  // Paths — old roads beneath the built world.
  for (const p of s.paths) {
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#10202a", "stroke-width": PATH_HALF * 2, "stroke-linecap": "round", opacity: 0.5,
    }));
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#2a4a5a", "stroke-width": 3, "stroke-linecap": "round",
      "stroke-dasharray": "10 14", opacity: 0.4,
    }));
  }

  // Walls — crumbled stretches, drawn beneath the built world.
  for (const f of s.walls) {
    layer.appendChild(el("line", {
      x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
      stroke: "#0c1218", "stroke-width": WALL_VIS_THICK, "stroke-linecap": "round", opacity: 0.9,
    }));
    layer.appendChild(el("line", {
      x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
      stroke: "#33424c", "stroke-width": 2.5, "stroke-linecap": "round", opacity: 0.5,
    }));
  }

  // Scar rings under defiled wards (bars resealing).
  for (const n of s.wards) {
    if (n.defiled && n.defiled > s.elapsed) {
      layer.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: SCAR_RADIUS,
        fill: "none", stroke: "#7a3cff", "stroke-width": 1.5,
        "stroke-dasharray": "4 8", opacity: 0.4,
      }));
    }
  }

  // Sealed-ward auras (steady the mind, burn the host).
  for (const n of s.wards) {
    if (!n.lit) continue;
    layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: WARD_AURA, fill: "url(#ward)" }));
  }

  // Scenery — ruins, menhirs, wards. Sprite if loaded, else a procedural mark.
  for (const n of s.scenery) {
    const size = SCENERY_SIZE[n.kind];
    const key = spriteFor(s.level, scenerySprite(s, n));
    if (key) { layer.appendChild(spriteImage(key, n.x, n.y, size, 0.96)); continue; }
    if (n.kind === "menhir") {
      layer.appendChild(el("rect", {
        x: n.x - 9, y: n.y - 20, width: 18, height: 40, rx: 5,
        fill: th.stone, stroke: th.stoneEdge, "stroke-width": 1.5,
      }));
    } else if (n.kind === "ward") {
      const sealed = n.lit;
      layer.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: 11,
        fill: sealed ? "#cdeeff" : "#1a2730",
        stroke: sealed ? "#7ad8ff" : "#3a4a55", "stroke-width": 2,
        filter: sealed ? "url(#glow)" : undefined as unknown as string,
      }));
      layer.appendChild(el("path", {
        d: pentagramPath(n.x, n.y, 8, 0),
        fill: "none", stroke: sealed ? "#1a2730" : "#5a6a75", "stroke-width": 1.2, opacity: 0.9,
      }));
    } else {
      layer.appendChild(el("rect", {
        x: n.x - 13, y: n.y - 10, width: 26, height: 20, rx: 3,
        fill: th.stone, stroke: th.stoneEdge, "stroke-width": 1.2, opacity: 0.85,
      }));
    }
  }

  // Clue-motes.
  for (const m of s.motes) {
    layer.appendChild(el("circle", { cx: m.x, cy: m.y, r: 13, fill: "url(#mote)" }));
  }

  // The host.
  for (const e of s.horrors) {
    if (e.dead) continue;
    const r = e.variant === "brute" ? 18 : e.variant === "darter" ? 11 : 14;
    const flash = e.hit > s.elapsed;
    // An acolyte's mend-beam.
    if (e.mending && e.mendX != null && e.mendY != null) {
      layer.appendChild(el("line", {
        x1: e.x, y1: e.y, x2: e.mendX, y2: e.mendY,
        stroke: "#caa84f", "stroke-width": 2, opacity: 0.5, "stroke-dasharray": "3 5",
      }));
    }
    // A gazer's gaze-beam.
    if (e.gaze) {
      layer.appendChild(el("line", {
        x1: e.x, y1: e.y, x2: s.hero.x, y2: s.hero.y,
        stroke: "#c850ff", "stroke-width": 2, opacity: 0.55,
      }));
    }
    const key = spriteFor(s.level, e.variant);
    if (key) { layer.appendChild(spriteImage(key, e.x, e.y, r * 2.6, 0.96)); }
    else {
      layer.appendChild(el("circle", {
        cx: e.x, cy: e.y, r,
        fill: flash ? "#ffffff" : HORROR_HUE[e.variant],
        stroke: e.state === "hunt" ? "#0a0d12" : "#2a3038", "stroke-width": 2,
        opacity: e.state === "lurk" ? 0.7 : 1,
      }));
      // A couple of pale eyes to read as "wrong".
      layer.appendChild(el("circle", { cx: e.x - r * 0.3, cy: e.y - r * 0.15, r: 2, fill: "#d8ffff" }));
      layer.appendChild(el("circle", { cx: e.x + r * 0.3, cy: e.y - r * 0.15, r: 2, fill: "#d8ffff" }));
    }
    // A wounded body's hp pip.
    if (e.hp < e.maxHp && !e.dead) {
      const frac = Math.max(0, e.hp / e.maxHp);
      layer.appendChild(el("rect", { x: e.x - r, y: e.y - r - 7, width: r * 2, height: 3, fill: "#20272e" }));
      layer.appendChild(el("rect", { x: e.x - r, y: e.y - r - 7, width: r * 2 * frac, height: 3, fill: "#d85a6a" }));
    }
  }

  // Banishing rings (fading FX).
  for (const p of s.pulses) {
    const k = (p.until - s.elapsed) / PULSE_FX_MS;
    layer.appendChild(el("circle", {
      cx: p.x, cy: p.y, r: p.r * (1.05 - k * 0.18),
      fill: "none", stroke: s.sign.ring, "stroke-width": 3 + k * 3, opacity: Math.max(0, k) * 0.7,
      filter: "url(#glow)",
    }));
  }

  // The Watcher — the Elder Sign traced beneath, then the body.
  const h = s.hero;
  if (h.charge > 0.02) {
    const traced = h.charge >= SIGN_BANISH_AT;
    const rr = SIGN_RADIUS * s.sign.radiusMul * (h.overcharge >= 1 ? OVERCHARGE_RADIUS_MUL : 1);
    if (traced) layer.appendChild(el("circle", { cx: h.x, cy: h.y, r: rr * h.charge, fill: "url(#signGlow)" }));
    layer.appendChild(el("path", {
      d: pentagramPath(h.x, h.y, 44 + 18 * h.charge, h.angle),
      fill: "none", stroke: s.sign.star, "stroke-width": 2 + 2 * h.charge,
      opacity: 0.35 + 0.6 * h.charge, filter: "url(#glow)",
    }));
    if (h.overcharge > 0) {
      layer.appendChild(el("circle", {
        cx: h.x, cy: h.y, r: 30 + 6 * h.overcharge,
        fill: "none", stroke: "#fff", "stroke-width": 1.5, opacity: 0.3 + 0.5 * h.overcharge,
        "stroke-dasharray": "3 6",
      }));
    }
  }
  // Zeal — the banish-streak burns as a pale-fire aura around the Watcher.
  if (s.fervor > 0) {
    const fp = 1 + 0.1 * Math.sin(s.elapsed / 110);
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: (HERO_RADIUS + 8 + 14 * s.fervor) * fp, fill: "none",
      stroke: "#9fe8d8", "stroke-width": 1.5 + 2 * s.fervor, opacity: 0.25 + 0.5 * s.fervor,
      filter: "url(#glow)",
    }));
  }

  // The Tolling — the drowned bell's ring races outward: the deep has stirred,
  // and the roused cohort is already converging.
  if (s.tollFlash > s.elapsed) {
    const prog = 1 - (s.tollFlash - s.elapsed) / TOLL_FLASH_MS;
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: 60 + 640 * prog, fill: "none",
      stroke: "#3f7f8f", "stroke-width": 3 * (1 - prog) + 0.5, opacity: 0.55 * (1 - prog),
    }));
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: 30 + 640 * prog * 0.8, fill: "none",
      stroke: "#bfeff0", "stroke-width": 1.5, opacity: 0.35 * (1 - prog),
    }));
  }

  const hwKey = spriteFor(s.level, "watcher");
  if (hwKey) { layer.appendChild(spriteImage(hwKey, h.x, h.y, HERO_RADIUS * 2.6, 1)); }
  else {
    const hurt = h.hurt > 0 && Math.floor(s.elapsed / 80) % 2 === 0;
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: HERO_RADIUS,
      fill: hurt ? "#ffd0d0" : "#cfe8f0", stroke: "#7ad8ff", "stroke-width": 2.5, filter: "url(#glow)",
    }));
    layer.appendChild(el("circle", { cx: h.x, cy: h.y - 4, r: 4, fill: "#1a2730" }));
  }

  // Atmosphere — the place's haze and its drifting ambient motes (salt-rain over
  // Innsmouth, spores over Dunwich, sea-fog ash over Kingsport, rising deep-bubbles
  // in R'lyeh). Cosmetic, deterministic from elapsed, drawn over the world.
  renderAtmosphere(s, layer);

  // Dread vignette — deepens as sanity falls (cosmetic; centred on the Watcher).
  if (h.sanity < PANIC_SANITY) {
    const k = 1 - h.sanity / PANIC_SANITY;
    layer.appendChild(el("circle", {
      cx: h.x, cy: h.y, r: Math.max(s.w, s.h),
      fill: "url(#dread)", opacity: 0.3 + 0.5 * k, "pointer-events": "none",
    }));
  }
}

// A cheap deterministic hash in [0,1) — lets the ambient layer scatter motes without
// state (no per-particle objects to persist), reproducible frame to frame.
function hash01(i: number): number {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// The place's haze + drifting ambient motes. Pure cosmetic, read off s.elapsed so it
// animates with the sim clock and stays deterministic (no allocation between frames).
function renderAtmosphere(s: EldState, layer: SVGGElement): void {
  const th = s.level.theme;
  // Haze — a flat wash plus a few large, slow, blurred banks of fog drifting across.
  if (th.hazeOpacity > 0) {
    layer.appendChild(el("rect", {
      x: 0, y: 0, width: s.w, height: s.h, fill: th.haze,
      opacity: th.hazeOpacity * 0.6, "pointer-events": "none",
    }));
    for (let i = 0; i < 3; i++) {
      const drift = (s.elapsed * 0.012 * (i % 2 ? 1 : -1) + i * 530) % (s.w + 400);
      const cx = (i % 2 ? drift : s.w + 200 - drift) - 200;
      layer.appendChild(el("ellipse", {
        cx, cy: s.h * (0.2 + 0.3 * i), rx: 360, ry: 200,
        fill: th.haze, opacity: th.hazeOpacity * 0.5,
        filter: "url(#hazeBlur)", "pointer-events": "none",
      }));
    }
  }
  // Ambient motes — kind sets the motion: rain streaks fall slanted, ash drifts down,
  // spores bob, bubbles rise. ~44 of them, scattered by hash, animated off elapsed.
  if (th.particle === "none") return;
  const N = 44;
  const t = s.elapsed;
  for (let i = 0; i < N; i++) {
    const bx = hash01(i) * s.w;
    const by = hash01(i + 99);
    let x = bx, y = 0, op = 0.4, kind = th.particle;
    if (kind === "rain") {
      x = (bx + t * 0.05) % s.w;
      y = (by * s.h + t * 0.95) % s.h;
      layer.appendChild(el("line", {
        x1: x, y1: y, x2: x - 4, y2: y + 16,
        stroke: th.particleColor, "stroke-width": 1.4, opacity: 0.35, "pointer-events": "none",
      }));
      continue;
    } else if (kind === "ash") {
      x = bx + Math.sin(t * 0.0006 + i) * 26;
      y = (by * s.h + t * 0.12) % s.h;
      op = 0.3;
    } else if (kind === "spore") {
      x = bx + Math.sin(t * 0.0009 + i * 1.7) * 34;
      y = (by * s.h + Math.cos(t * 0.0007 + i) * 22 + t * 0.03) % s.h;
      op = 0.4;
    } else { // bubble — rises
      x = bx + Math.sin(t * 0.0011 + i * 2.1) * 16;
      y = (by * s.h - t * 0.16 + s.h) % s.h;
      op = 0.45;
    }
    const rr = 1.3 + hash01(i + 7) * 2.2;
    layer.appendChild(el("circle", {
      cx: x, cy: y, r: rr, fill: th.particleColor, opacity: op, "pointer-events": "none",
    }));
  }
}

// ---------- Legacy (cross-watch record, in its own key) ----------

interface EldLegacy {
  runs: number;        // watches begun
  seals: number;       // thresholds sealed (wins)
  best: Record<string, number>; // best clear time per place id
  wardsSealed: number; // lifetime wards sealed
  banished: number;    // lifetime horrors banished
  lore: number;        // the unlock currency
  unlocked: string[];  // owned Sign ids
  equipped: string;    // the equipped Sign id
}

function emptyEldLegacy(): EldLegacy {
  return {
    runs: 0, seals: 0, best: {}, wardsSealed: 0, banished: 0,
    lore: 0, unlocked: ["elder"], equipped: "elder",
  };
}

function loadEldLegacy(): EldLegacy {
  const base = emptyEldLegacy();
  try {
    const raw = localStorage.getItem(ELD_LEGACY_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<EldLegacy>;
    const l: EldLegacy = {
      runs: p.runs ?? 0,
      seals: p.seals ?? 0,
      best: p.best ?? {},
      wardsSealed: p.wardsSealed ?? 0,
      banished: p.banished ?? 0,
      lore: p.lore ?? 0,
      unlocked: Array.isArray(p.unlocked) && p.unlocked.length ? p.unlocked.slice() : ["elder"],
      equipped: p.equipped ?? "elder",
    };
    if (!l.unlocked.includes("elder")) l.unlocked.unshift("elder");
    if (!l.unlocked.includes(l.equipped)) l.equipped = "elder";
    return l;
  } catch {
    return base;
  }
}

function saveEldLegacy(l: EldLegacy): void {
  try { localStorage.setItem(ELD_LEGACY_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

// Fold a sealed threshold (a win) into the legacy — write-once at the end transition.
function recordSeal(level: LevelDef, ms: number, wards = 0, lore = 0, banishedN = 0): EldLegacy {
  const l = loadEldLegacy();
  l.runs += 1; l.seals += 1;
  l.wardsSealed += wards;
  l.banished += banishedN;
  l.lore += lore;
  const prev = l.best[level.id];
  if (prev == null || ms < prev) l.best[level.id] = ms;
  saveEldLegacy(l);
  return l;
}

// Fold a broken watch (a loss) — bumps the run count and banks the lore of the
// banished, but no seal and no best.
function recordFall(wards = 0, banishedN = 0, lore = 0): EldLegacy {
  const l = loadEldLegacy();
  l.runs += 1;
  l.wardsSealed += wards;
  l.banished += banishedN;
  l.lore += lore;
  saveEldLegacy(l);
  return l;
}

function unlockSign(id: string): EldLegacy {
  const l = loadEldLegacy();
  const t = SIGN_TYPES.find((x) => x.id === id);
  if (t && !l.unlocked.includes(id) && l.lore >= t.cost) {
    l.lore -= t.cost; l.unlocked.push(id);
    saveEldLegacy(l);
  }
  return l;
}

function equipSign(id: string): EldLegacy {
  const l = loadEldLegacy();
  if (l.unlocked.includes(id)) { l.equipped = id; saveEldLegacy(l); }
  return l;
}

// ---------- Game shell ----------

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function fmtTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(1);
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

// Haptics — a phone-only murmur of impact, in the sound layer's ethos: the frame
// loop diffs observable sim state and buzzes, so the pure sim never touches it
// (and a device without a vibrator silently ignores it).
function buzz(pattern: number | number[]): void {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

function start(): void {
  const svg = byId("city") as unknown as SVGSVGElement;
  const overlay = byId("overlay");
  const ovTitle = byId("ov-title");
  const ovBody = byId("ov-body");
  const ovBtn = byId("ov-btn") as HTMLButtonElement;
  const ovBtn2 = byId("ov-btn2") as HTMLButtonElement;
  const hpFill = byId("hp");
  const sanFill = byId("sanity");
  const foesEl = byId("foes");
  const sanEl = byId("souls");
  const cityEl = byId("cityname");
  const toastEl = byId("toast");
  const stickEl = byId("stick");
  const stickKnob = byId("stick-knob");
  const mmEl = byId("minimap") as unknown as SVGSVGElement;
  const headerEl = document.querySelector("header") as HTMLElement | null;

  const layer = scaffold(svg);
  let s: EldState | null = null;

  // ----- Camera: follows the Watcher; pinch / wheel zoom. -----
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
  const STICK_MAX = 60;  // px from ring centre to full deflection
  // A resting thumb trembles a few px; without slack that tremor creeps the
  // Watcher and breaks the stand-still tracing of the Sign the watch hangs on.
  const STICK_DEAD = 8;
  const move: Move = { x: 0, y: 0 };
  const keys = new Set<string>();
  const pointers = new Map<number, { x: number; y: number }>();
  let stick: { id: number; ox: number; oy: number } | null = null;
  let pinch: { d: number; k: number } | null = null;

  function placeStick(sx: number, sy: number): void {
    stickEl.style.left = sx + "px";
    stickEl.style.top = sy + "px";
  }
  function showStick(sx: number, sy: number): void {
    placeStick(sx, sy);
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
      let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
      const over = Math.hypot(dx, dy);
      if (over > STICK_MAX) {
        // Follow the finger: past the rim the ring is dragged along, so pulling
        // the other way answers at once instead of only after the finger has
        // re-crossed the whole overshoot.
        const pull = (over - STICK_MAX) / over;
        stick.ox += dx * pull; stick.oy += dy * pull;
        placeStick(stick.ox, stick.oy);
        dx = e.clientX - stick.ox; dy = e.clientY - stick.oy;
      }
      const mag = Math.hypot(dx, dy);
      // Dead zone, then re-scale so full speed still sits at the rim.
      const r = mag > STICK_DEAD ? Math.min(1, (mag - STICK_DEAD) / (STICK_MAX - STICK_DEAD)) : 0;
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
  window.addEventListener("blur", () => {
    // Drop every live input, not just the keyboard: a pointer capture lost to
    // the blur would otherwise leave the joystick vector stuck and the hero
    // walking on their own when focus returns.
    keys.clear();
    pointers.clear(); pinch = null;
    stick = null; move.x = 0; move.y = 0; hideStick();
  });
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
    sanFill.style.width = Math.max(0, (s.hero.sanity / s.hero.maxSanity) * 100) + "%";
    cityEl.textContent = s.level.name;
    sanEl.textContent = sanityReadout(s);
    const alive = aliveHorrors(s);
    let foes = alive > 0 ? `Banish ${alive} / ${s.total}` : `Threshold sealed`;
    if (alive > 0 && alive <= 4) {
      let best: Horror | null = null, bd = Infinity;
      for (const e of s.horrors) {
        if (e.dead) continue;
        const d = (e.x - s.hero.x) ** 2 + (e.y - s.hero.y) ** 2;
        if (d < bd) { bd = d; best = e; }
      }
      if (best) {
        const ang = Math.atan2(best.y - s.hero.y, best.x - s.hero.x);
        foes += ` ${ARROWS[(((Math.round(ang / (Math.PI / 4))) % 8) + 8) % 8]}`;
      }
    }
    // The rival's echo paces the same readout: their banish count as of this very
    // moment of their run (✓ they sealed / ✝ they fell, once their clock is out).
    if (s.rival) {
      const rk = rivalKillsAt(s.rival, s.elapsed);
      const done = s.elapsed >= s.rival.ms ? (s.rival.result === "won" ? " ✓" : " ✝") : "";
      foes += ` · ⚔ ${s.rival.name} ${rk}${done}`;
    }
    // The heartbeat: the bell's countdown, the zeal's burn, a charged Sign.
    const beat = watchReadout(s);
    if (beat) foes += ` · ${beat}`;
    foesEl.textContent = foes;
  }

  const MM_MAX = 96;
  let mmTick = 0;
  function minimap(): void {
    if (!s || s.phase !== "watch") { mmEl.style.display = "none"; return; }
    if (mmTick++ % 5 !== 0) return;
    const scale = Math.min(MM_MAX / s.w, MM_MAX / s.h);
    const mw = s.w * scale, mh = s.h * scale;
    mmEl.style.display = "block";
    mmEl.style.top = `${(headerEl ? headerEl.offsetHeight : 50) + 6}px`;
    mmEl.style.width = `${mw.toFixed(1)}px`;
    mmEl.style.height = `${mh.toFixed(1)}px`;
    mmEl.setAttribute("viewBox", `0 0 ${mw.toFixed(1)} ${mh.toFixed(1)}`);
    mmEl.innerHTML = "";
    mmEl.appendChild(el("rect", { x: 0, y: 0, width: mw, height: mh, fill: "#060c12", opacity: 0.5 }));
    for (const n of s.wards) {
      if (!n.lit) continue;
      mmEl.appendChild(el("circle", { cx: n.x * scale, cy: n.y * scale, r: 1.7, fill: "#7ad8ff", opacity: 0.9 }));
    }
    for (const e of s.horrors) {
      if (e.dead) continue;
      mmEl.appendChild(el("circle", {
        cx: e.x * scale, cy: e.y * scale,
        r: e.variant === "brute" ? 1.9 : e.variant === "gazer" || e.variant === "acolyte" ? 1.6 : 1.3,
        fill: e.variant === "gazer" ? "#c850ff" : e.variant === "acolyte" ? "#caa84f"
          : e.variant === "brute" ? "#9b8aff" : e.variant === "darter" ? "#b0d060" : "#7fc0b0",
        opacity: 0.95,
      }));
    }
    const vw = svg.clientWidth, vh = svg.clientHeight;
    mmEl.appendChild(el("rect", {
      x: (-cam.x / cam.k) * scale, y: (-cam.y / cam.k) * scale,
      width: (vw / cam.k) * scale, height: (vh / cam.k) * scale,
      fill: "none", stroke: "#cfe8f0", "stroke-width": 0.6, opacity: 0.5,
    }));
    mmEl.appendChild(el("circle", {
      cx: s.hero.x * scale, cy: s.hero.y * scale, r: 2.3,
      fill: "#e6f6ff", stroke: "#7ad8ff", "stroke-width": 0.8,
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

  const TOAST_MS = 3600;
  function showToast(text: string): void {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    window.setTimeout(() => toastEl.classList.remove("show"), TOAST_MS);
  }

  // ----- The watch loop -----
  let lastFrame = 0;
  let running = false;
  let introHold = false;
  let introHoldTimer: ReturnType<typeof setTimeout> | undefined;
  function watchFrame(now: number): void {
    if (!running || !s) return;
    if (!lastFrame) lastFrame = now;
    let dt = now - lastFrame; lastFrame = now;
    if (dt > 100) dt = 100;

    if (introHold && (move.x || move.y || keys.size > 0)) {
      introHold = false;
      clearTimeout(introHoldTimer);
      toastEl.classList.remove("show");
    }

    if (!introHold && s.phase === "watch") {
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
      const kBefore = s.killTimes.length, hpBefore = s.hero.hp, tollsBefore = s.tolls;
      stepWatch(s, dt, move);
      // Haptics: a tick per horror banished, a heavier knock when the Watcher
      // is struck (the later call wins if both fire in one frame).
      if (s.killTimes.length > kBefore) buzz(15);
      if (s.hero.hp < hpBefore) buzz(40);
      // The drowned bell just tolled — a stirred cohort is converging. Say so.
      if (s.tolls > tollsBefore) { buzz([20, 40, 20]); showToast("A bell tolls beneath the water — the deep stirs, and it comes for you."); }
      centerCam(s.hero.x, s.hero.y);
    }

    render(s, layer);
    hud();
    minimap();

    if (s.phase === "won") { running = false; buzz([30, 60, 120]); onWin(); return; }
    if (s.phase === "lost") { running = false; buzz(200); onLost(); return; }
    requestAnimationFrame(watchFrame);
  }

  function startCity(level: LevelDef, duel: DuelRun | null = null): void {
    s = buildArena(level, duel ? duel.seed : undefined);
    if (duel) s.rival = duel; // the echo the HUD paces and the end screen judges
    loadCitySprites(level.id, repaint);
    hideOverlay();
    setupZoom();
    centerCam(s.hero.x, s.hero.y);
    hud();
    showToast("Seal the threshold: BANISH every horror (count, top-right). Stand STILL to trace the Elder Sign — a sigil that banishes the host around you; move to dodge and it fades. Hold the trace past full to charge the Sign: the next pulse erupts wider and steadies the mind. Banishings in quick succession stoke your ZEAL — a streak that hardens the Sign's bite and quickens your stride. But tracing frays the MIND, and the nearness of the host bleeds it — watch your SANITY (top-left, beneath your health). Seal the ward-stones and gather the clue-motes the banished leave to steady it. And listen for the drowned BELL: on its toll the nearest lurking horrors stir and converge, faster and in greater numbers as the host thins. Lose your health and you are SLAIN; lose your sanity and you go MAD.");
    introHold = true;
    clearTimeout(introHoldTimer);
    introHoldTimer = setTimeout(() => { introHold = false; }, TOAST_MS);
    running = true; lastFrame = 0;
    requestAnimationFrame(watchFrame);
  }

  // ---------- Rival duels: the shell side ----------
  // The pure codec/verdict live with the sim (the "Rival duels" section up top);
  // this is everything that touches the DOM — signature, share sheet, the
  // arriving-gauntlet intro, and the end-screen verdict panel.
  function duelName(): string {
    try {
      const saved = localStorage.getItem(NAME_KEY);
      if (saved) return sanitizeName(saved);
      const typed = prompt("Sign your challenge — the name your rival will see:", "") || "";
      const name = sanitizeName(typed);
      localStorage.setItem(NAME_KEY, name);
      return name;
    } catch { return "A rival"; }
  }

  // Fold the watch just ended into a challenge record. The signature is left
  // blank here — the name prompt only fires if the Watcher actually shares.
  function myDuelRun(result: "won" | "lost", score: number): DuelRun {
    return {
      name: "", level: s!.level.id, seed: s!.seed, weapon: s!.sign.id,
      result, ms: Math.round(s!.elapsed), score: Math.round(score), kills: s!.killTimes.slice(),
    };
  }

  async function shareDuelLink(run: DuelRun): Promise<void> {
    const signed = { ...run, name: duelName() };
    const lvName = levelById(run.level)?.name ?? run.level;
    const url = `${gameUrl()}?duel=${encodeDuel(signed)}`;
    const text = run.result === "won"
      ? `⚔ I sealed ${lvName} in ${fmtTime(run.ms)}. Same ruins, same host — outpace my echo.`
      : `⚔ ${lvName} took me at ${run.kills.length} banishings. Same ruins, same host — outlast my echo.`;
    const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "The Watcher at the Threshold — a duel", text, url }); return; }
      catch (e) { if ((e as { name?: string }).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); showToast("Duel link copied — send it to your rival."); }
    catch { showToast(url); }
  }

  // The end-screen duel panel: a verdict when this run answered a gauntlet, and
  // always the button that turns the run just played into a fresh challenge.
  function duelPanelHtml(mine: DuelRun): string {
    const r = s ? s.rival : undefined;
    let verdictHtml = "";
    if (r) {
      const v = duelVerdict(mine, r);
      const line = v === "win" ? `<em>The duel is yours.</em> ${r.name}'s echo falls behind.`
        : v === "loss" ? `<em>${r.name} takes the duel.</em> Their echo held the better run.`
        : `<em>Dead even.</em> The duel stands unsettled.`;
      const sum = (who: string, d: { result: string; ms: number; kills: number[] }) =>
        `${who}: ${d.result === "won" ? `sealed in ${fmtTime(d.ms)}` : `fell at ${d.kills.length} banishings (${fmtTime(d.ms)})`}`;
      verdictHtml =
        `<div class="legacy"><div class="legacy-head">⚔ The duel</div>` +
        `<p class="city-line">${line}<br>${sum("You", mine)} · ${sum(r.name, r)}</p></div>`;
    }
    const label = r ? "⚔ Send the gauntlet back" : "⚔ Challenge a rival with this run";
    return verdictHtml +
      `<div class="start-share"><button class="start-act" data-duel="1">${label}</button></div>`;
  }

  // showOverlay rebuilds the body via innerHTML, so the button wires after it.
  function wireDuelShare(run: DuelRun): void {
    const b = ovBody.querySelector<HTMLButtonElement>("button[data-duel]");
    if (b) b.onclick = () => { void shareDuelLink(run); };
  }

  // A gauntlet arrives (?duel=<token> survived decoding): stage the challenge.
  // Declining falls through to the ordinary picker.
  function showDuelIntro(d: DuelRun): void {
    s = null; running = false;
    mmEl.style.display = "none";
    const lv = levelById(d.level)!; // decodeDuel already validated it
    const wpn = SIGN_TYPES.find((t) => t.id === d.weapon);
    const feat = d.result === "won"
      ? `sealed it in <em>${fmtTime(d.ms)}</em>`
      : `were taken at <em>${d.kills.length}</em> banishings`;
    const body =
      `<p class="lede">⚔ <em>${d.name}</em> throws down a gauntlet from <em>${lv.name}</em>: ` +
      `they ${feat}${wpn ? `, tracing ${wpn.name}` : ""}.</p>` +
      `<p class="lede">Answer it and the same place rises for you — the same ruins, the same rifts, ` +
      `the same host — while their echo paces you on the banish count. ` +
      `Beat their run and send the gauntlet back.</p>`;
    showOverlay(
      "A gauntlet thrown", body,
      "Answer on the same ground", () => startCity(lv, d),
      "Decline — choose a place", () => showPicker(),
    );
  }

  function onWin(): void {
    if (!s) return;
    const ms = s.elapsed;
    const wards = s.litCount, total = s.wardsTotal;
    const sc = scoreRun(s);
    const lore = Math.max(1, Math.round(sc.total / LORE_SCORE_DIV));
    const l = recordSeal(s.level, ms, wards, lore, s.banished);
    const best = l.best[s.level.id];
    const wardLine = (wards >= total && total > 0
      ? `You sealed every ward — <em>${total}</em>. The place is warded whole.`
      : `You sealed <em>${wards}</em> of ${total} ward-stones.`)
      + (s.defiledCount ? ` The host defiled <em>${s.defiledCount}</em> back to dark.` : "");
    const row = (label: string, val: string) => `<div><dt>${label}</dt><dd>${val}</dd></div>`;
    // The story beat for this seal: the whole campaign done plays the epilogue;
    // otherwise, sealing a place opens the trail to the next (and says so),
    // threading the watches into one investigation.
    const idx = LEVELS.indexOf(s.level);
    const next = LEVELS[idx + 1];
    const allDone = LEVELS.every((lv) => l.best[lv.id]);
    const storyBeat = allDone
      ? `<p class="city-story story-end">${EPILOGUE}</p>`
      : next
        ? `<p class="city-story">The trail runs on: <em>${next.name}</em>. ${next.epigraph}</p>`
        : "";
    const breakdown =
      storyBeat +
      `<div class="legacy"><div class="legacy-head">Score</div><dl>` +
      row("Host banished", `${sc.base}`) +
      row("Speed", `${sc.speed}`) +
      row("Wards sealed", `${sc.wards}`) +
      row("Survival", `${sc.survival}`) +
      row("Sanity kept", `${sc.sanity}`) +
      (sc.untouched ? row("Untouched", `${sc.untouched}`) : "") +
      row("Place difficulty", `×${sc.mult}`) +
      row("<strong>Total</strong>", `<strong>${sc.total}</strong>`) +
      `</dl></div>`;
    const mine = myDuelRun("won", sc.total);
    showOverlay(
      "The threshold is sealed",
      `Every horror of <em>${s.level.name}</em> is banished — ${s.total} of them — ` +
      `in <em>${fmtTime(ms)}</em>, with <em>${Math.ceil(s.hero.sanity)}</em> sanity still your own.<br><br>` +
      `${wardLine}<br><br>` +
      (best === ms ? `<em>A new best for this place.</em>` : `Best here: ${fmtTime(best)}.`) +
      ` <em>+${lore}</em> lore gathered.` +
      breakdown + duelPanelHtml(mine),
      "Watch again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
    wireDuelShare(mine);
  }

  function onLost(): void {
    if (!s) return;
    const lore = s.banished * LORE_PER_BANISH;
    recordFall(s.litCount, s.banished, lore);
    const mine = myDuelRun("lost", 0);
    const mad = s.lossCause === "mad";
    showOverlay(
      mad ? "Your mind is unmade" : "You are pulled under",
      (mad
        ? `The geometry of <em>${s.level.name}</em> broke something in you — you wander now among the host, ` +
          `another shape gone wrong, with <em>${aliveHorrors(s)}</em> horrors still abroad.`
        : `The host of <em>${s.level.name}</em> dragged you down with ` +
          `<em>${aliveHorrors(s)}</em> still abroad.`) +
      `<br><br>You had banished <em>${s.banished}</em> of ${s.total} and sealed <em>${s.litCount}</em> wards.<br><br>` +
      (lore > 0 ? `What you learned leaves <em>+${lore}</em> lore behind. ` : ``) +
      `<em>The threshold is patient. Watch again.</em>` +
      duelPanelHtml(mine),
      "Try again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
    wireDuelShare(mine);
  }

  function showPicker(selId?: string): void {
    s = null; running = false;
    introHold = false; clearTimeout(introHoldTimer);
    mmEl.style.display = "none";
    const l = loadEldLegacy();
    // The selected place — a still-locked one can never be the selection (its
    // button is disabled), so the Watch button below always targets open ground.
    let sel = levelById(selId || "") || LEVELS[0];
    if (!placeUnlocked(sel, l)) sel = LEVELS[0];
    const card = sel.art ? `<img class="city-art" src="${sel.art}" alt="">` : "";
    // The campaign chapter for the selected place — the prologue stands in front
    // of the very first watch (before any threshold is sealed), then each place
    // tells its own chapter, naming the trail on.
    const firstEver = l.seals === 0 && Object.keys(l.best).length === 0;
    const story = firstEver && sel.id === LEVELS[0].id
      ? `<p class="story-pre">${PROLOGUE}</p><p class="city-story">${sel.story}</p>`
      : `<p class="city-story"><span class="story-ch">Watch ${storyChapter(sel)}</span>${sel.story}</p>`;
    let html =
      card + story +
      `<p class="lede">Choose a place to keep watch over. Stand still to trace the Elder ` +
      `Sign and banish the host around you — but tracing frays the mind, and the host's ` +
      `nearness bleeds it. Seal the ward-stones to steady your sanity, run the old roads ` +
      `to outpace the press, and banish every horror to seal the threshold.</p><div class="cities">`;
    for (let i = 0; i < LEVELS.length; i++) {
      const lv = LEVELS[i];
      const done = l.best[lv.id];
      const open = placeUnlocked(lv, l);
      const ch = `<span class="city-ch">${ROMAN[i] ?? i + 1}</span>`;
      if (!open) {
        // A locked place keeps its mystery: name veiled behind its fog, the
        // trail there dark until the place before it is sealed.
        const prev = LEVELS[i - 1];
        html +=
          `<button class="city locked" disabled>` +
          `<span class="city-name">${ch}A shunned place <span class="legacy-new">locked</span></span>` +
          `<span class="city-line">Seal ${prev.name} to open the trail here.</span></button>`;
        continue;
      }
      const mark = done ? ` <span class="legacy-new">sealed ${fmtTime(done)}</span>` : "";
      html +=
        `<button class="city${lv.id === sel.id ? " sel" : ""}" data-id="${lv.id}">` +
        `<span class="city-name">${ch}${lv.name}${mark}</span>` +
        `<span class="city-line">${lv.epigraph}</span></button>`;
    }
    html += `</div>`;

    // The Sign shop — the unlockable Elder Sign variants. Watches bank lore; spend it
    // here to learn a Sign, then equip it.
    html +=
      `<div class="legacy"><div class="legacy-head">` +
      `Signs <span class="legacy-new">${l.lore} lore</span></div></div>` +
      `<div class="ptypes">`;
    for (const t of SIGN_TYPES) {
      const owned = l.unlocked.includes(t.id);
      const equipped = l.equipped === t.id;
      const afford = l.lore >= t.cost;
      let badge: string, act: string, disabled = false;
      if (equipped) { badge = ` <span class="legacy-new">equipped</span>`; act = ""; disabled = true; }
      else if (owned) { badge = ""; act = "equip"; }
      else if (afford) { badge = ` <span class="legacy-new">${t.cost} lore</span>`; act = "unlock"; }
      else { badge = ` <span class="ptype-cost">${t.cost} lore</span>`; act = ""; disabled = true; }
      const verb = act === "equip" ? "Equip" : act === "unlock" ? "Learn" : equipped ? "Equipped" : "Locked";
      html +=
        `<button class="ptype${equipped ? " sel" : ""}" data-id="${t.id}" data-act="${act}"${disabled ? " disabled" : ""}>` +
        `<span class="city-name"><span class="ptype-swatch" style="background:${t.star};box-shadow:0 0 6px ${t.ring}"></span>${t.name}${badge}</span>` +
        `<span class="city-line">${t.desc}</span>` +
        `<span class="ptype-verb">${verb}</span></button>`;
    }
    html += `</div>`;

    if (l.runs > 0) {
      html +=
        `<div class="legacy"><div class="legacy-head">Your watches</div><dl>` +
        `<div><dt>Watches</dt><dd>${l.runs}</dd></div>` +
        `<div><dt>Thresholds sealed</dt><dd>${l.seals}</dd></div>` +
        `<div><dt>Wards sealed</dt><dd>${l.wardsSealed}</dd></div>` +
        `<div><dt>Host banished</dt><dd>${l.banished}</dd></div></dl></div>`;
    }

    showOverlay(
      "The Watcher at the Threshold", html, `Keep watch over ${sel.name}`, () => startCity(sel),
    );
    const img = ovBody.querySelector<HTMLImageElement>(".city-art");
    if (img) img.onerror = () => { img.style.display = "none"; };
    overlay.querySelectorAll<HTMLButtonElement>(".city").forEach((b) => {
      b.onclick = () => {
        const lv = levelById(b.dataset.id || "");
        if (lv) showPicker(lv.id);
      };
    });
    overlay.querySelectorAll<HTMLButtonElement>(".ptype").forEach((b) => {
      const id = b.dataset.id || "", act = b.dataset.act || "";
      if (!act) return;
      b.onclick = () => {
        if (act === "unlock") { unlockSign(id); equipSign(id); }
        else if (act === "equip") equipSign(id);
        showPicker(sel.id);
      };
    });
  }

  // ---------- Start screen + sharing the game ----------
  function gameUrl(): string { return location.origin + location.pathname; }

  function showStart(): void {
    s = null; running = false;
    mmEl.style.display = "none";
    const body =
      `<img class="start-logo" src="./icons/eldritch-icon-192.png" alt="The Watcher at the Threshold">` +
      `<p class="frx-quote">“That is not dead which can eternal lie, and with strange aeons even death may die.”</p>` +
      `<div class="start-share">` +
      `<button class="start-act" data-act="link">Share game link</button></div>`;
    showOverlay("The Watcher at the Threshold", body, "Begin the watch", () => showPicker());
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
      try { await nav.share({ title: "The Watcher at the Threshold", text: "Trace the Elder Sign and banish the eldritch host.", url }); return; }
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
  // A duel link opens straight onto the gauntlet; anything malformed (or from a
  // sibling game) decodes to null and the ordinary title screen stands.
  const duelToken = new URLSearchParams(location.search).get("duel");
  const gauntlet = duelToken ? decodeDuel(duelToken) : null;
  if (gauntlet) showDuelIntro(gauntlet); else showStart();
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
// Mirrors the siblings: a headless harness sets __ELD_TEST__ and reads the sim off
// __eld instead of the shell ever starting.
const testGlobal = globalThis as unknown as {
  __ELD_TEST__?: boolean;
  __eld?: Record<string, unknown>;
};
if (typeof globalThis !== "undefined" && testGlobal.__ELD_TEST__) {
  testGlobal.__eld = {
    generateEldritch, buildArena, freshWatch, stepWatch,
    stepSign, firePulse, stepHorrors, stepWards, stepDread, stepMotes,
    banish, hurtHorror, kindleWard, defileWard, nearScar, nearestHorror,
    stepToll, watchReadout,
    aliveHorrors, clearedPct, sanityReadout, scoreRun, difficultyMult,
    LEVELS, levelById, placeUnlocked, storyChapter, PROLOGUE, EPILOGUE,
    weaveSegments, closestOnSegment, segsCross, wallBetween, pushOut, pentagramPath,
    render, scaffold, scenerySprite, spriteFor,
    loadEldLegacy, saveEldLegacy, recordSeal, recordFall, emptyEldLegacy,
    SIGN_TYPES, signTypeById, unlockSign, equipSign,
    encodeDuel, decodeDuel, duelVerdict, rivalKillsAt, sanitizeName, mulberry32, GAME_TAG,
    K: {
      W, H, HERO_HP, HERO_SANITY, HERO_RADIUS, HERO_IFRAMES_MS, HERO_SPEED, HERO_KNOCKBACK,
      HERO_STILL_MAXSPEED, SIGN_CHARGE_MS, SIGN_BANISH_AT, SIGN_RADIUS, SIGN_PULSE_MS,
      SIGN_DMG, SIGN_SANITY_COST, SIGN_SPIN, PULSE_FX_MS,
      SIGN_OVERCHARGE_MS, OVERCHARGE_RADIUS_MUL, OVERCHARGE_SANITY, REPEL_KNOCK,
      TOLL_FIRST_MS, TOLL_INTERVAL_MS, TOLL_ACCEL, TOLL_ROUSE_BASE, TOLL_ROUSE_GROWTH, TOLL_FLASH_MS,
      FERVOR_PER_KILL, FERVOR_WINDOW_MS, FERVOR_DECAY_MS, FERVOR_DMG, FERVOR_SPEED,
      DREAD_RADIUS, DREAD_DPS, PANIC_SANITY,
      MOTE_DROP_CHANCE, MOTE_TTL_MS, MOTE_RADIUS, CLUE_SANITY, HIT_FLASH_MS,
      HORROR_HP, HORROR_SPEED, HORROR_RADIUS, HORROR_CONTACT, HORROR_ATTACK_CD,
      HORROR_ATTACK_REACH, HORROR_SEP, HORROR_AGGRO, HORROR_WANDER_SPEED, HORROR_LEASH,
      HORROR_PER_RIFT, CLEANUP_AGGRO_FRAC, RISE_MS,
      DARTER_HP_MUL, DARTER_SPEED_MUL, DARTER_CONTACT,
      BRUTE_HP_MUL, BRUTE_SPEED_MUL, BRUTE_CONTACT,
      GAZER_HP_MUL, GAZER_SPEED_MUL, GAZER_RANGE, GAZER_STANDOFF, GAZE_DPS,
      ACOLYTE_HP_MUL, ACOLYTE_SPEED_MUL, ACOLYTE_RANGE, ACOLYTE_STANDOFF, ACOLYTE_HEAL,
      CHAIN_RANGE, CHAIN_DMG, CALM_SANITY,
      OBSTACLE_RADIUS, WALL_HALF, PATH_HALF, PATH_BOOST,
      WARD_SEAL_REACH, WARD_KINDLE_SANITY, WARD_AURA, WARD_SANITY_PER_SEC, WARD_DMG,
      DEFILE_REACH, DEFILE_MS, SCAR_RADIUS,
      SCORE_PER_BANISH, SCORE_SURVIVAL_MAX, SCORE_SANITY_MAX, SCORE_UNTOUCHED,
      LORE_SCORE_DIV, LORE_PER_BANISH,
    },
  };
} else {
  start();
}

// This trailing export makes eldritch.ts a *module* (its top-level names are
// module-scoped), so it compiles in the same project as app.ts (a classic global
// script) and its siblings without their identically-named declarations (W, el,
// render, start, LEVELS, …) colliding.
export {};
