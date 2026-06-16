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
// dwelling can `lit` once the sigil's ring catches it; held long enough a lit one
// `awoke`s into an ally emitter; a shade can snuff one back to dark, scarring the
// ground (`veil`, an s.elapsed time the scar lasts to). A press carries a one-shot
// cascade until `spent`. All of these are live-play state — never persisted.
interface ArenaNode {
  x: number; y: number; kind: NodeKind;
  lit?: boolean;   // a dwelling kindled alight by the sigil/conduit/press
  litAt?: number;  // s.elapsed when it was kindled (ages toward awakening)
  awoke?: boolean; // a lit dwelling that held long enough — now pulses the dark
  veil?: number;   // a snuffed dwelling's scar: s.elapsed time it damps relighting to
  spent?: boolean; // a press whose one-shot cascade has fired
  seen?: boolean;  // the hero's body has reached it (fresco first-footing)
}

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
  spitter?: boolean;   // a ranged shade: holds its distance and lobs bolts (punishes standing still)
  darter?: boolean;    // a quick, frail shade: closes the gap fast before the sigil ramps
  cooldown?: number;   // ms until a spitter can lob its next bolt
}

// A spitter's bolt — the watch's only ranged attack, the module's one projectile.
// Slow enough to sidestep if you're already moving; punishing if you stand to
// inscribe. It is mere matter — fences and solid structures stop it (the
// pentagram's flame burns through; this does not). Live-play FX, never persisted.
interface Bolt {
  x: number; y: number; vx: number; vy: number;
  born: number; // s.elapsed at fire — for lifetime cull; set to -1 to retire (spent)
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

// A warden's seal — a Goetia-style occult sigil, drawn as a NODE-AND-EDGE figure
// (a star polygon, like the seals of the Ars Goetia). The carrier does not
// freehand the whole glyph in one stroke; they CONNECT its glowing nodes one edge
// (a "strand") at a time — start and end a line on two nodes and that strand binds.
// This guided, snap-to-node, strand-by-strand build is the "help" the seal gives
// the hand. Each `SealEdge` carries its own progress (`done`/`quality`), reset
// fresh each time the warden rises (the seal is never persisted mid-duel).
interface SealEdge {
  a: number; b: number;   // node indices this strand connects
  done: boolean;          // has the carrier bound this strand?
  quality: number;        // best 0..1 trace quality drawn for it so far
}
interface Sigil {
  cx: number; cy: number; r: number;       // containment circle, world space
  nodes: { x: number; y: number }[];       // the glowing points you connect
  edges: SealEdge[];                        // the strands to draw (node a → node b)
}

// What a submitted finger-stroke did to the seal (drives the duel's toast).
type TraceStatus =
  | "none"     // not in the duel
  | "short"    // too few points to read as a stroke
  | "offnode"  // didn't begin and end on the seal's nodes
  | "noedge"   // those two nodes aren't joined by a strand
  | "weak"     // on a strand, but too loose to bind
  | "veiled"   // a strand, but the warden's veil unravelled the line
  | "already"  // that strand already holds
  | "bound";   // a strand just bound
interface TraceResult { quality: number; edge: number; status: TraceStatus; }

interface BossState {
  hp: number; maxHp: number;
  biteAcc: number;      // ms accumulated toward the next snuff (the warden's bite)
  cx: number; cy: number; r: number; // the seal's centre + reach, in world space
  seal: Sigil;          // this warden's unique Goetic seal (the thing you trace)
  veils: Veil[];        // drifting dark pools over the seal — a stroke crossing one is unravelled
  sel: number;          // keyboard-targeted strand (index into seal.edges; -1 = none left)
  lastQuality: number;  // 0..1 of the most recent trace (for the toast/flash)
  flash: number;        // s.elapsed time until which it flares from a fresh trace
}

interface PgState {
  level: LevelDef;
  w: number; h: number;  // this arena's world size (W/H scaled by level.sizeScale)
  scenery: ArenaNode[];
  solids: ArenaNode[];   // scenery the hero/shades can't pass (presses, shrines)
  conduitLinks: { c: ArenaNode; dwellings: ArenaNode[] }[]; // each conduit and the dwellings it fuses (a relay graph, built once)
  spreadQueue: { node: ArenaNode; at: number }[]; // dwellings awaiting a conduit relay's delayed kindle (live, not persisted)
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
  bolts: Bolt[];         // spitters' in-flight bolts (live FX, not persisted)
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
  litCount: number;     // how many are kindled right now (secondary objective)
  snuffed: number;      // lights the watch has clawed back this descent
  shownFrescoes: number[]; // FRESCO indices already uncovered this descent
  pendingFresco: string | null; // a fresco awaiting the shell's pause-and-show
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
const FENCE_VIS_THICK = 26;      // drawn thickness of the fence sprite (reads taller than its slim collision)

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

// Spitter shades — the city's ranged watch. A spitter does NOT close; it holds a
// standoff distance and lobs a slow bolt at where the hero is, so standing still
// to inscribe is punished and you must break the sigil to reposition. Frail (it
// is artillery, not a brawler) and dies to the pulse like any shade. The bolt is
// the module's only projectile (see stepBolts / the Bolt interface).
const SPITTER_HP = 30;           // frailer than a common shade (44)
const SPITTER_STANDOFF = 210;    // the range it tries to hold from the hero
const SPITTER_SPEED_MUL = 0.7;   // it repositions slower than a chaser closes
const SPITTER_RANGE = 380;       // won't lob past this
const SPITTER_COOLDOWN_MS = 1900; // between lobs
const BOLT_SPEED = 230;          // units/s — slow enough to sidestep while moving
const BOLT_DMG = 12;             // hero HP per bolt (gated by the same i-frames as a touch)
const BOLT_RADIUS = 9;
const BOLT_LIFETIME_MS = 2600;   // a bolt fades if it reaches nothing

// Darter shades — a quick, frail melee shade. It closes the gap before the sigil
// ramps, making pathways and fences matter defensively rather than offensively.
// Common contact damage; just faster and softer. No projectile — pure chaser.
const DARTER_HP = 26;            // very frail
const DARTER_SPEED_MUL = 1.7;    // far quicker than a common chaser (SHADE_SPEED)

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
const HEAL_CAP = 0.6;            // …but the city can only rally you to this frac of maxHp.
                                 // A clean run above the cap isn't pulled down; once a swarm
                                 // bites you below it, relighting mends only back up to the cap —
                                 // so a real hit can't be fully facetanked away. This is what
                                 // keeps the watch lethal while relighting stays worth doing.
// A lit dwelling held long enough AWAKENS into an ally emitter; the watch can
// snuff a lit one back to dark, scarring the ground. The whole loop is live-play
// terrain (never persisted), the same ethos as decoys/fences.
const DWELLING_AWAKEN_MS = 5200; // a lit dwelling that holds this long awakens…
const AWAKENED_RADIUS = 96;      // …and then pulses the dark within this each pentagram pulse
const AWAKENED_DMG = 9;          // …for this much (autonomous, charge-independent)
const SNUFF_REACH = 26;          // a shade within this (+its radius) of a lit dwelling snuffs it
const SNUFF_VEIL_MS = 6000;      // a snuffed dwelling scars the ground this long (barring its own relight)…
const SCAR_RADIUS = 60;          // …drawn this wide (the scar's visual reach; it bars relighting, not the hero's sigil)

// Conduits — a lit dwelling relays its flame along the conduits it touches to the
// next dark dwelling down the line, a beat later: a fuse you light one end of.
const CONDUIT_REACH = 150;       // a conduit fuses dwellings within this of it
const CONDUIT_DELAY = 520;       // ms the flame takes to travel one conduit hop
const CONDUIT_HEAL = 3;          // a relayed kindle mends less than a direct ring catch
const CONDUIT_MAX_LINKS = 4;     // cap on dwellings a single conduit fuses (nearest first)

// Presses — a built press, body-blocking, holds a one-shot cascade. Stand by it
// at a FULL inscription and it fires: a wide burst that lights every dwelling and
// burns every (unshielded) shade in reach, then the press is spent.
const PRESS_TRIGGER_REACH = 46;  // hero centre within this (+the press radius) fires it
const PRESS_BURST_R = 200;       // the cascade's reach
const PRESS_BURST_DMG = 60;      // damage dealt to every shade caught

// Shrines — consecrated ground. Dwellings within a shrine's aura can't be snuffed
// (a safe quarter to relight), and a hero standing in the aura inscribes even on
// veiled/scarred ground (a place to make a stand).
const SHRINE_AURA = 150;         // radius of a shrine's consecrated ground

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
const FRESCO_SET_BONUS = 5;      // embers banked once, when a city's whole fresco
                                 // subset is first uncovered (see the reliquary)

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
// Keeper rises and the fight becomes turn-based: its Goetic seal glows over it as
// a graph of nodes and strands, and the carrier BINDS the seal by drawing those
// strands — a line from one glowing node to another. traceScore (pure geometry)
// rates each strand 0..1 — accuracy (how close to the line) × coverage (did the
// whole strand get drawn); a strand of quality ≥ SEAL_EDGE_DONE binds. Bind every
// strand to break the warden. Meanwhile it snuffs every BOSS_BITE_MS for
// BOSS_BITE_DMG, so the seal is a race. This is the design surface for the duel.
const BOSS_RING_R = 150;         // world radius of the seal's containment circle
const BOSS_HP = 100;             // base warden health (the binding meter; × difficultyMult)
const BOSS_BITE_MS = 3000;       // the warden snuffs this often (at a fresh, unbound seal)…
const BOSS_BITE_DMG = 12;        // …draining this much hero HP each snuff
const BOSS_BITE_RAMP = 0.5;      // the bite interval shortens up to this frac as the seal binds (the warden quickens near its end)
const BOSS_KEY_COST = 6;         // hero HP spent to bind a strand by keyboard (a cruder rite than a clean trace)
const BOSS_VEILS_BASE = 2;       // drifting veils over the easiest warden's seal…
const BOSS_VEILS_DIFF = 3;       // …plus up to this many more on the hardest
const BOSS_VEIL_R = 44;          // a duel-veil's reach (smaller than the field's, so the seal stays traceable)
const BOSS_VEIL_DRIFT = 34;      // units/s a duel-veil wanders across the seal
const BOSS_VEIL_UNRAVEL = 0.7;   // a stroke wholly inside the veils loses this frac of its quality
const TRACE_TOL_FRAC = 0.26;     // how far off the line (× ring r) still scores
const TRACE_MIN_POINTS = 6;      // a stroke shorter than this can't score
const TRACE_FLASH_MS = 260;      // how long the warden flares from a fresh trace
// The warden's seal — a node-and-edge star polygon, seeded per city so each is
// unique but recognizably a seal. The carrier connects its glowing nodes one
// strand at a time (snap-to-node + per-strand binding is the hand's "help"). These
// dials are the design surface for the seal's shape and forgiveness.
const SEAL_RING_FRAC = 0.86;     // node-ring radius (× containment r)
const SEAL_NODES_MIN = 5;        // fewest ring nodes a seal may have…
const SEAL_NODES_SPAN = 3;       // …plus 0..(span-1) more (so 5..7 points before difficulty)
const SEAL_DIFF_NODES = 1;       // …plus 0..this more, scaled by the city's difficulty (harder ⇒ a denser seal, more strands to bind)
const SEAL_HUB_CHANCE = 0.5;     // chance the seal has a centre hub with spokes
const SEAL_RIM_CHANCE = 0.4;     // chance the plain outer rim is also drawn (rises with difficulty)
const SEAL_SPOKE_CHANCE = 0.7;   // per-node chance of a spoke to the hub
const SEAL_SNAP_FRAC = 0.34;     // a stroke end within this (× r) snaps to a node
const SEAL_EDGE_DONE = 0.48;     // trace quality that binds a strand (0..1)

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
  spitterCount?: number; // keeper-posts whose wave includes a ranged spitter (default 0)
  darterCount?: number;  // keeper-posts whose wave includes a quick darter (default 0)
  sizeScale?: number;  // arena size = W/H × this (default 1); leans the difficulty
  frescoes?: number[]; // FRESCO indices this city can surface — its signature
                       // subset. The union across LEVELS must cover every index
                       // (see the reliquary), so the collection wants every city.
                       // Undefined/exhausted falls back to the global pool.
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
    frescoes: [0, 6, 8, 15], // the foundational creed
  },
  {
    id: "ashfold",
    name: "Ashfold",
    epigraph: "Dry tinder that remembers fire. The watch is many and quick to rise.",
    art: "art/city-ashfold.jpg",
    nodeCount: 130, minDist: 64,
    conduitFrac: 0.26, pressCount: 6, shrineCount: 3,
    keeperCount: 7, keeperSpacing: 320,
    fenceCount: 6, pathwayCount: 9, veilCount: 2, eliteCount: 2, darterCount: 3, sizeScale: 1.0,
    frescoes: [4, 9, 11], // fire and the spoken word
  },
  {
    id: "drowned",
    name: "The Drowned Quarter",
    epigraph: "The water took the low streets. Few shades here — but they wake patient and far.",
    art: "art/city-drowned.jpg",
    nodeCount: 104, minDist: 86,
    conduitFrac: 0.10, pressCount: 2, shrineCount: 6,
    keeperCount: 4, keeperSpacing: 420,
    fenceCount: 11, pathwayCount: 3, veilCount: 4, eliteCount: 1, spitterCount: 2, sizeScale: 1.15,
    frescoes: [1, 3, 10], // mercy, the veil, the patient morning
  },
  {
    id: "glassworks",
    name: "The Glassworks",
    epigraph: "Everything here is bright and breaks. The watch is thick and tightly packed.",
    art: "art/city-glassworks.jpg",
    nodeCount: 134, minDist: 66,
    conduitFrac: 0.14, pressCount: 3, shrineCount: 8,
    keeperCount: 9, keeperSpacing: 270,
    fenceCount: 13, pathwayCount: 5, veilCount: 2, eliteCount: 3, darterCount: 4, spitterCount: 2, sizeScale: 1.0,
    frescoes: [7, 13, 14], // seeing clearly, scratching the whitewash
  },
  {
    id: "vesper",
    name: "Vesper Row",
    epigraph: "The watch is thickest where the faithful sleep. The hardest descent.",
    art: "art/city-vesper.jpg",
    nodeCount: 124, minDist: 70,
    conduitFrac: 0.08, pressCount: 3, shrineCount: 4,
    keeperCount: 11, keeperSpacing: 250,
    fenceCount: 9, pathwayCount: 4, veilCount: 3, eliteCount: 4, spitterCount: 3, darterCount: 3, sizeScale: 1.1,
    frescoes: [2, 5, 12, 16], // the faithful's quarter
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
  // Each post raises SHADE_PER_KEEPER shades in distinct slots so the roles never
  // collide: slot 0 may be an elite champion, slot 1 a ranged spitter, slot 2 a
  // quick darter — each gated by the city's per-role count. The rest are common.
  const eliteCount = Math.min(level.eliteCount ?? 0, posts.length);
  const spitterCount = Math.min(level.spitterCount ?? 0, posts.length);
  const darterCount = Math.min(level.darterCount ?? 0, posts.length);
  posts.forEach((post, pi) => {
    for (let j = 0; j < SHADE_PER_KEEPER; j++) {
      const elite = j === 0 && pi < eliteCount;
      const spitter = !elite && j === 1 && pi < spitterCount;
      const darter = !elite && !spitter && j === 2 && pi < darterCount;
      const hp = elite ? SHADE_HP * ELITE_HP_MUL
        : spitter ? SPITTER_HP : darter ? DARTER_HP : SHADE_HP;
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
        elite, shielded: elite, spitter, darter, cooldown: 0,
      });
    }
  });
  // Conduit fuses: each conduit links the nearest few dwellings within reach, so a
  // lit dwelling can relay its flame to the next down the line. Pure geometry,
  // built once (mirrors fences/pathways). A fuse needs at least two ends to carry.
  const dwellingsAll = scenery.filter((n) => n.kind === "dwelling");
  const conduitLinks = scenery
    .filter((n) => n.kind === "conduit")
    .map((c) => ({
      c,
      dwellings: dwellingsAll
        .map((n) => ({ n, d: (n.x - c.x) ** 2 + (n.y - c.y) ** 2 }))
        .filter((o) => o.d <= CONDUIT_REACH ** 2)
        .sort((a, b) => a.d - b.d)
        .slice(0, CONDUIT_MAX_LINKS)
        .map((o) => o.n),
    }))
    .filter((l) => l.dwellings.length >= 2);
  // Resolve the equipped sigil and bake its stat lean into effective constants.
  const type = pentaTypeById(loadPgLegacy().equipped);
  return {
    level, w, h, scenery,
    solids: scenery.filter((n) => OBSTACLE_KINDS.has(n.kind)),
    conduitLinks, spreadQueue: [],
    fences, pathways,
    hero, shades,
    penta: { charge: 0, angle: 0 },
    type,
    fxRadius: PENTA_RADIUS * type.radiusMul,
    fxCharge: PENTA_CHARGE_MS * type.chargeMul,
    fxPulse: PENTA_PULSE_MS * type.pulseMul,
    fxDmg: PENTA_DMG * type.dmgMul,
    scorch: [], veils: weaveVeils(w, h, level.veilCount ?? 0), motes: [], bolts: [], surgeUntil: 0,
    arcs: [], novas: [], novaFired: false,
    pulseAcc: 0, elapsed: 0, kills: 0, hits: 0, total: shades.length,
    dwellingsTotal: scenery.filter((n) => n.kind === "dwelling").length,
    litCount: 0, snuffed: 0,
    shownFrescoes: [], pendingFresco: null,
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

// The lights readout for the HUD: how many dwellings burn now, of the city's
// total, with a star mark for any that have awakened into ally emitters.
function litReadout(s: PgState): string {
  const awoke = s.scenery.reduce((c, n) => c + (n.awoke ? 1 : 0), 0);
  const base = `+${s.litCount} / ${s.dwellingsTotal} lit`;
  return awoke ? `${base} · ${awoke}✦` : base;
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

// Is the point over a snuffed dwelling's lingering scar? (A scar marks ground the
// watch clawed back; the dwelling under it resists relighting until it fades. Used
// for the visual reach and tests — the relight bar itself is in kindleDwelling.)
function nearScar(s: PgState, x: number, y: number): boolean {
  for (const n of s.scenery) {
    if (n.kind !== "dwelling" || !n.veil || n.veil <= s.elapsed) continue;
    if ((x - n.x) ** 2 + (y - n.y) ** 2 <= SCAR_RADIUS ** 2) return true;
  }
  return false;
}

// Is the point on consecrated ground (within any shrine's aura)? Dwellings here
// can't be snuffed and the hero inscribes even when veiled/scarred.
function inShrineAura(s: PgState, x: number, y: number): boolean {
  for (const n of s.scenery) {
    if (n.kind !== "shrine") continue;
    if ((x - n.x) ** 2 + (y - n.y) ** 2 <= SHRINE_AURA ** 2) return true;
  }
  return false;
}

// Kindle a dark dwelling alight: count it, mend the hero, and send its flame down
// any conduit it touches to the next dark dwelling (a delayed relay). The single
// kindle path, so the ring, the conduit relay, and the press cascade all light a
// dwelling the same way. A still-scarred dwelling resists the flame (no relight).
function kindleDwelling(s: PgState, n: ArenaNode, heal: number): void {
  if (n.kind !== "dwelling" || n.lit) return;
  if (n.veil && n.veil > s.elapsed) return; // the scar still damps relighting here
  n.lit = true; n.litAt = s.elapsed; n.awoke = false; n.veil = 0;
  s.litCount++;
  if (heal) {
    // The city rallies you only up to HEAL_CAP·maxHp; if you're already above it
    // (e.g. fresh, full HP) the heal is a no-op rather than a pull-down.
    const ceil = Math.max(s.hero.hp, s.hero.maxHp * HEAL_CAP);
    s.hero.hp = Math.min(ceil, s.hero.hp + heal);
  }
  // Relay along every conduit this dwelling touches, to its other dark ends.
  for (const link of s.conduitLinks) {
    if (!link.dwellings.includes(n)) continue;
    for (const d of link.dwellings) {
      if (d === n || d.lit) continue;
      if (!s.spreadQueue.some((q) => q.node === d)) {
        s.spreadQueue.push({ node: d, at: s.elapsed + CONDUIT_DELAY });
      }
    }
  }
}

// Snuff a lit dwelling back to dark: scar the ground (a charge-damping veil that
// bars relighting for a while) and tally the loss. The single snuff path.
function snuffDwelling(s: PgState, n: ArenaNode): void {
  n.lit = false; n.awoke = false;
  n.veil = s.elapsed + SNUFF_VEIL_MS;
  if (s.litCount > 0) s.litCount--;
  s.snuffed++;
}

// Advance the conduit relays: any queued dwelling whose travel time has elapsed
// kindles now (which may itself relay on down the line — the fuse cascades).
function stepSpread(s: PgState): void {
  if (!s.spreadQueue.length) return;
  const ready: { node: ArenaNode; at: number }[] = [];
  s.spreadQueue = s.spreadQueue.filter((q) => {
    if (s.elapsed >= q.at) { ready.push(q); return false; }
    return true;
  });
  for (const q of ready) kindleDwelling(s, q.node, CONDUIT_HEAL);
}

// Lit dwellings that have held their flame long enough AWAKEN into ally emitters
// (they answer the pentagram's pulse in stepPentagram). Autonomous — they mature
// even after the hero has moved on.
function stepDwellings(s: PgState): void {
  for (const n of s.scenery) {
    if (n.kind === "dwelling" && n.lit && !n.awoke
      && n.litAt !== undefined && s.elapsed - n.litAt >= DWELLING_AWAKEN_MS) {
      n.awoke = true;
    }
  }
}

// A press fires its one-shot cascade when the hero stands beside it at a FULL
// inscription: a wide burst that burns every unshielded shade and lights every
// dwelling in reach, then the press is spent.
function stepPress(s: PgState): void {
  if (s.penta.charge < 1) return;
  const h = s.hero;
  for (const n of s.scenery) {
    if (n.kind !== "press" || n.spent) continue;
    const rr = (PRESS_TRIGGER_REACH + (OBSTACLE_RADIUS.press || 0)) ** 2;
    if ((n.x - h.x) ** 2 + (n.y - h.y) ** 2 > rr) continue;
    n.spent = true;
    const br2 = PRESS_BURST_R ** 2;
    for (const e of s.shades) {
      if (e.dead || e.shielded) continue;
      if ((e.x - n.x) ** 2 + (e.y - n.y) ** 2 <= br2) {
        e.hp -= PRESS_BURST_DMG;
        e.hit = s.elapsed + SHADE_HIT_MS;
        if (e.hp <= 0) killShade(s, e);
      }
    }
    for (const d of s.scenery) {
      if (d.kind !== "dwelling" || d.lit) continue;
      if ((d.x - n.x) ** 2 + (d.y - n.y) ** 2 <= br2) kindleDwelling(s, d, 0);
    }
    s.novas.push({ x: n.x, y: n.y, r: PRESS_BURST_R, until: s.elapsed + NOVA_FX_MS });
  }
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
      const dist = Math.hypot(dx, dy) || 1; dx /= dist; dy /= dist;
      // Separation among fellow chasers, so a crowd packs rather than overlaps.
      for (const o of s.shades) {
        if (o === e || o.dead || o.state !== "chase") continue;
        const ox = e.x - o.x, oy = e.y - o.y, od = Math.hypot(ox, oy);
        if (od > 0 && od < SHADE_SEP) { dx += (ox / od) * 0.7; dy += (oy / od) * 0.7; }
      }
      const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
      speed = SHADE_SPEED;
      if (e.darter) {
        // A darter rushes — far quicker than a common chaser, but frail.
        speed = SHADE_SPEED * DARTER_SPEED_MUL;
      } else if (e.spitter) {
        // A spitter holds standoff range and lobs bolts: back off if the hero
        // crowds it, hold ground in the band, drift in (slowly) if too far.
        speed = SHADE_SPEED * SPITTER_SPEED_MUL;
        if (dist < SPITTER_STANDOFF * 0.85) { dx = -dx; dy = -dy; }
        else if (dist <= SPITTER_STANDOFF * 1.15) { speed = 0; }
        e.cooldown = (e.cooldown ?? 0) - dt;
        if (e.cooldown <= 0 && dist <= SPITTER_RANGE) {
          const ax = h.x - e.x, ay = h.y - e.y, ad = Math.hypot(ax, ay) || 1;
          s.bolts.push({ x: e.x, y: e.y, vx: (ax / ad) * BOLT_SPEED, vy: (ay / ad) * BOLT_SPEED, born: s.elapsed });
          e.cooldown = SPITTER_COOLDOWN_MS;
        }
      }
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

    // A shade brushing a lit dwelling snuffs it back to dark — unless that
    // dwelling stands on consecrated ground (a shrine's aura protects it).
    const sr2 = (SHADE_RADIUS + SNUFF_REACH) ** 2;
    for (const n of s.scenery) {
      if (n.kind !== "dwelling" || !n.lit) continue;
      if ((n.x - e.x) ** 2 + (n.y - e.y) ** 2 > sr2) continue;
      if (inShrineAura(s, n.x, n.y)) continue;
      snuffDwelling(s, n);
    }
  }
}

// Advance spitters' bolts. A bolt flies straight, bites the hero on contact
// (gated by the same i-frames as a touch, so a bolt and a brush can't double-dip
// one slice), and is stopped by fences and solid structures — cover the hero can
// duck behind. The pentagram's flame burns through them; the watch's bolts are
// mere matter and do not. Spent/expired bolts are culled. Live FX, not persisted.
function stepBolts(s: PgState, dt: number): void {
  if (!s.bolts.length) return;
  const h = s.hero;
  for (const b of s.bolts) {
    if (b.born < 0) continue;
    const nx = b.x + (b.vx * dt) / 1000, ny = b.y + (b.vy * dt) / 1000;
    // Cover: a fence or a solid (press/shrine) stops the bolt dead.
    let blocked = false;
    for (const f of s.fences) {
      if (closestOnSegment(nx, ny, f.x1, f.y1, f.x2, f.y2).d <= BOLT_RADIUS + FENCE_HALF) { blocked = true; break; }
    }
    if (!blocked) {
      for (const n of s.solids) {
        const rr = BOLT_RADIUS + (OBSTACLE_RADIUS[n.kind] || 0);
        if ((nx - n.x) ** 2 + (ny - n.y) ** 2 <= rr * rr) { blocked = true; break; }
      }
    }
    if (blocked) { b.born = -1; continue; }
    b.x = nx; b.y = ny;
    if (h.hurt <= 0 && (b.x - h.x) ** 2 + (b.y - h.y) ** 2 <= (HERO_RADIUS + BOLT_RADIUS) ** 2) {
      h.hp -= BOLT_DMG; s.hits++; h.hurt = HERO_IFRAMES_MS; b.born = -1;
    }
  }
  s.bolts = s.bolts.filter((b) => b.born >= 0 && s.elapsed - b.born < BOLT_LIFETIME_MS);
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
    // Dwellings caught in the ring kindle (mending the hero, and relaying down any
    // conduit); awakened dwellings answer the pulse, biting the dark around them.
    for (const n of s.scenery) {
      if (n.kind !== "dwelling") continue;
      if (!n.lit) {
        if ((n.x - hero.x) ** 2 + (n.y - hero.y) ** 2 <= r2) kindleDwelling(s, n, DWELLING_HEAL);
        continue;
      }
      if (n.awoke) {
        const ar2 = AWAKENED_RADIUS ** 2;
        for (const e of s.shades) {
          if (e.dead || e.shielded) continue;
          if ((e.x - n.x) ** 2 + (e.y - n.y) ** 2 <= ar2) {
            e.hp -= AWAKENED_DMG;
            e.hit = s.elapsed + SHADE_HIT_MS;
            if (e.hp <= 0) killShade(s, e);
          }
        }
      }
    }
  }
}

// One slice of combat time, analogous to app.ts's stepCity: integrate the hero
// from the input vector, inscribe-or-fade the sigil, move the shades, pulse the
// pentagram, resolve contact, and check the terminal states.
// ---------- Frescoes ----------
// Painted fragments the Keepers whitewashed over. In the contemplative parent
// they surface as light spreads and reveals the map; here the carrier walks the
// streets in the flesh, so the trigger is the hero's body reaching a place for
// the first time. Pure sim, mirroring app.ts's maybeFresco: it only queues the
// text on s.pendingFresco — the shell pauses the descent and shows the card.
const FRESCO_REACH = 52; // hero centre within this of an unseen place uncovers it
const FRESCO_PER_DESCENT = 1; // how many frescoes may surface in a single descent

const FRESCOES: string[] = [
  "Beneath the whitewash: a sun, and under it, our faces.",
  "They named the dimness 'mercy' so we would thank them for it.",
  "Ora pro nobis, Lucifer — pray for us who were taught to fear the morning.",
  "The Veil is not a wall. It is a habit. Habits can be unlearned.",
  "Here a press once ran. The ink they burned still smells of psalms.",
  "Every Keeper was, once, a child told the candle would eat him.",
  "What is lit cannot be made unseen. That is why they fear you.",
  "The carrier burns. That was always the price. Carry it anyway.",
  "We do not win the city. We leave it able to win itself.",
  "A rumor is oil. A name spoken twice is a wick.",
  "The morning is not coming to judge you. It is only morning.",
  "They keep the lamps low and call the dark holy.",
  "A lamp lit in secret is still a lamp. Begin where no one watches.",
  "They whitewashed the walls, not the colour beneath. Scratch, and remember.",
  "Count the windows that answered yours: that is the city waking.",
  "The dark was never the enemy — only the forgetting that there was light.",
  "Two flames see farther than one, and fear each other less.",
];

// A few frescoes have painted art (the rest reveal as text alone), reusing the
// parent's jpgs — already in sw.js ASSETS, so they show offline too. Keyed by
// index into FRESCOES, matching app.ts.
const FRESCO_ART: Record<number, string> = {
  0: "art/fresco-sun.jpg",
  1: "art/fresco-mercy.jpg",
  2: "art/fresco-star.jpg",
  3: "art/fresco-veil.jpg",
  4: "art/fresco-press.jpg",
  5: "art/fresco-child.jpg",
  6: "art/fresco-window.jpg",
  7: "art/fresco-carrier.jpg",
  8: "art/fresco-city.jpg",
  9: "art/fresco-rumor.jpg",
  10: "art/fresco-morning.jpg",
  11: "art/fresco-lamps.jpg",
  12: "art/fresco-secret.jpg",
  13: "art/fresco-scratch.jpg",
  14: "art/fresco-answer.jpg",
  15: "art/fresco-ember.jpg",
  16: "art/fresco-twoflames.jpg",
};

function maybeFresco(s: PgState, n: ArenaNode): void {
  if (s.pendingFresco) return;                          // one at a time
  if (s.shownFrescoes.length >= FRESCOES.length) return; // pool exhausted
  // Presses and shrines always carry text; plainer ground rarely — as in app.ts.
  const chance = n.kind === "press" || n.kind === "shrine" ? 1 : 0.06;
  if (Math.random() > chance) return;
  // Draw from this city's signature subset (so collecting the reliquary wants
  // every city); fall back to the global pool when the city has none or its
  // subset is spent this descent. Which index, never whether one fires.
  const all = FRESCOES.map((_, i) => i).filter((i) => !s.shownFrescoes.includes(i));
  const sub = s.level.frescoes
    ? s.level.frescoes.filter((i) => !s.shownFrescoes.includes(i))
    : [];
  const choices = sub.length ? sub : all;
  if (!choices.length) return;
  const idx = choices[Math.floor(Math.random() * choices.length)];
  s.shownFrescoes.push(idx);
  s.pendingFresco = FRESCOES[idx];
}

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

  // First-footing: the hero's body reaching an un-walked place may uncover a
  // fresco beneath the whitewash. Queued on the state; the shell pauses to show
  // it. One at a time — the guard stops scanning once a fresco is pending — and
  // only FRESCO_PER_DESCENT may surface across a whole descent, so the reliquary
  // fills a city at a time across runs rather than all at once.
  if (!s.pendingFresco && s.shownFrescoes.length < Math.min(FRESCO_PER_DESCENT, FRESCOES.length)) {
    const reach2 = FRESCO_REACH ** 2;
    for (const n of s.scenery) {
      if (n.seen || n.kind === "keeper") continue;
      if ((n.x - h.x) ** 2 + (n.y - h.y) ** 2 <= reach2) {
        n.seen = true;
        maybeFresco(s, n);
        if (s.pendingFresco) break;
      }
    }
  }

  // Drift the dark pools, then decide the sigil from where the hero now stands.
  // A drifting veil pool unravels the sigil — unless the hero stands on
  // consecrated ground (a shrine's aura), where it inscribes regardless. (A
  // snuffed dwelling's scar bars *relighting* that dwelling, not the hero's own
  // sigil — the parent's asymmetry — so it never traps a hero standing on it.)
  stepVeils(s, dt);
  const veiled = inVeil(s, h.x, h.y) && !inShrineAura(s, h.x, h.y);

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
  stepBolts(s, dt);  // advance spitters' in-flight bolts (may bite the hero)
  stepPentagram(s, dt);
  stepSpread(s);     // advance any conduit relays whose travel time has elapsed
  stepDwellings(s);  // mature lit dwellings into awakened ally emitters
  stepPress(s);      // a press by the hero, at full charge, fires its cascade

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
  else if (s.shades.every((e) => e.dead)) { s.phase = "won"; } // the host falls — the descent is won
  // NOTE: the Veilwarden duel is disabled for now — clearing the host wins outright.
  // startBoss/stepBoss and the seal-tracing duel remain intact (and tested in
  // isolation) so the boss can be re-enabled by restoring the startBoss(s) call above.
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

type Pt = { x: number; y: number };

function gcd(a: number, b: number): number { while (b) { const t = b; b = a % b; a = t; } return a; }

// Build a warden's Goetic seal as a node-and-edge star polygon, seeded per city so
// each is unique but unmistakably a seal: n points (5..7) on a ring, joined into a
// star {n/skip} (pentagram, hexagram, heptagram…), optionally with the plain rim
// and a central hub with spokes. No art — pure geometry, like the parent's edges.
// The seed (city id hash) fixes the count, tilt, skip, hub and which extras appear,
// so the warden's seal rebuilds identically every time.
function makeSeal(cx: number, cy: number, r: number, seed: number, difficulty = 1): Sigil {
  const rnd = mulberry32(seed);
  // 0 at the easiest city (difficultyMult ~0.6), 1 at the hardest (~1.3). Drives
  // the *amount of binding work*, so a harder warden is genuinely a longer seal —
  // not just a bigger health number (the old difficulty knob touched only maxHp).
  const diffT = clamp((difficulty - 0.6) / 0.7, 0, 1);
  const tilt = rnd() * Math.PI * 2;
  const n = SEAL_NODES_MIN + Math.floor(rnd() * SEAL_NODES_SPAN) + Math.round(diffT * SEAL_DIFF_NODES);
  const ringR = r * SEAL_RING_FRAC;
  const nodes: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = tilt - Math.PI / 2 + (i / n) * Math.PI * 2;
    nodes.push({ x: cx + Math.cos(a) * ringR, y: cy + Math.sin(a) * ringR });
  }
  const hub = rnd() < SEAL_HUB_CHANCE ? nodes.push({ x: cx, y: cy }) - 1 : -1;

  const edges: SealEdge[] = [];
  const seen = new Set<string>();
  const addEdge = (a: number, b: number): void => {
    if (a === b) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b, done: false, quality: 0 });
  };

  // The star polygon {n/skip} — the seal's defining figure. A skip of 2..⌊n/2⌋
  // makes a pentagram, hexagram, heptagram…; non-coprime skips give compound
  // stars (e.g. {6/2} = two triangles, the Star of David), walked as gcd cycles.
  const skip = 2 + Math.floor(rnd() * Math.max(1, Math.floor(n / 2) - 1));
  const g = gcd(n, skip);
  for (let o = 0; o < g; o++) {
    let cur = o;
    do { const nxt = (cur + skip) % n; addEdge(cur, nxt); cur = nxt; } while (cur !== o);
  }
  // Sometimes the plain outer rim too, for a denser seal — likelier on hard cities.
  if (rnd() < SEAL_RIM_CHANCE + diffT * 0.4) for (let i = 0; i < n; i++) addEdge(i, (i + 1) % n);
  // Spokes from the hub (never leave the hub stranded).
  if (hub >= 0) {
    let spokes = 0;
    for (let i = 0; i < n; i++) if (rnd() < SEAL_SPOKE_CHANCE) { addEdge(i, hub); spokes++; }
    if (spokes === 0) addEdge(0, hub);
  }

  return { cx, cy, r, nodes, edges };
}

// One strand as a scoreable segment, and the whole seal as its strand segments
// (the template). Only a strand's two endpoints are nodes, so the line is straight.
function edgeSegment(seal: Sigil, e: SealEdge): Segment {
  const a = seal.nodes[e.a], b = seal.nodes[e.b];
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}
function sealSegments(seal: Sigil): Segment[] {
  return seal.edges.map((e) => edgeSegment(seal, e));
}

// The node nearest a point, within `maxD` — or -1. This is the snap that lets the
// carrier begin and end a strand on a glowing node without pixel precision.
function nearestNode(seal: Sigil, p: Pt, maxD: number): number {
  let best = -1, bd = maxD;
  for (let i = 0; i < seal.nodes.length; i++) {
    const n = seal.nodes[i];
    const d = Math.hypot(p.x - n.x, p.y - n.y);
    if (d <= bd) { bd = d; best = i; }
  }
  return best;
}

// The warden's counterplay: a handful of dark pools drifting over its own seal,
// seeded per city so the duel is deterministic. A finger-stroke crossing one is
// unravelled (submitTrace bleeds its quality), so the carrier must wait for a
// clean lane between the drifting veils — the action phase's veil-unravel idea,
// carried into the duel so it is a contested seal, not a checklist. Count scales
// with difficulty. (stepBoss drifts and bounces them inside the containment box.)
function makeBossVeils(cx: number, cy: number, r: number, seed: number, difficulty: number): Veil[] {
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const diffT = clamp((difficulty - 0.6) / 0.7, 0, 1);
  const count = BOSS_VEILS_BASE + Math.round(diffT * BOSS_VEILS_DIFF);
  const veils: Veil[] = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2, rad = (0.2 + 0.6 * rnd()) * r, dir = rnd() * Math.PI * 2;
    veils.push({
      x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad,
      vx: Math.cos(dir) * BOSS_VEIL_DRIFT, vy: Math.sin(dir) * BOSS_VEIL_DRIFT, r: BOSS_VEIL_R,
    });
  }
  return veils;
}

// The warden's bite interval, shortening as the seal binds (BOSS_BITE_RAMP) — the
// quickening that makes the endgame a real race. Shared by stepBoss and the render
// telegraph so the violet ring and the actual snuff can never drift apart.
function bossBiteInterval(b: BossState): number {
  const total = b.seal.edges.length;
  const frac = total ? b.seal.edges.filter((e) => e.done).length / total : 0;
  return BOSS_BITE_MS * (1 - BOSS_BITE_RAMP * frac);
}

// The next still-unbound strand after `from` (wrapping), or -1 if the seal is
// whole. Drives both the bind-and-advance and the keyboard target (`sel`).
function nextUnbound(seal: Sigil, from: number): number {
  const n = seal.edges.length;
  for (let k = 1; k <= n; k++) {
    const i = ((from + k) % n + n) % n;
    if (!seal.edges[i].done) return i;
  }
  return -1;
}

// Recompute the binding meter from how much of the seal holds, advance the keyboard
// target off any strand that just bound, and break the warden once every strand
// holds. The single place the duel's win is decided (trace or keyboard alike).
function refreshBoss(s: PgState): void {
  const b = s.boss; if (!b) return;
  const edges = b.seal.edges, bound = edges.filter((e) => e.done).length;
  b.hp = b.maxHp * (1 - bound / edges.length);
  if (b.sel < 0 || b.sel >= edges.length || edges[b.sel].done) b.sel = nextUnbound(b.seal, b.sel);
  if (bound === edges.length) { b.hp = 0; s.phase = "won"; }
}

// Raise the warden: a city-scaled seal (its difficulty now drives the *amount* of
// binding work, not just a health number), the drifting veils that contest it, and
// the keyboard target. Flips the run into the turn-based duel.
function startBoss(s: PgState): void {
  const dm = difficultyMult(s.level);
  const hp = Math.round(BOSS_HP * dm);
  const cx = s.w / 2, cy = s.h / 2;
  const seed = hashSeed(s.level.id);
  const seal = makeSeal(cx, cy, BOSS_RING_R, seed, dm);
  s.boss = {
    hp, maxHp: hp, biteAcc: 0,
    cx, cy, r: BOSS_RING_R, seal,
    veils: makeBossVeils(cx, cy, BOSS_RING_R, seed, dm),
    sel: seal.edges.length ? 0 : -1,
    lastQuality: 0, flash: 0,
  };
  s.phase = "boss";
}

// The warden's own clock: it drifts its veils and snuffs on a cadence that quickens
// as its seal binds, draining the carrier's flame. (The carrier's answer is
// submitTrace / keyBind.) Pure sim.
function stepBoss(s: PgState, dt: number): void {
  if (s.phase !== "boss" || !s.boss) return;
  s.elapsed += dt;
  const b = s.boss;
  // Drift the duel-veils, bouncing them inside the seal's containment box so they
  // keep orbiting the glyph rather than wandering off across the dead arena.
  for (const v of b.veils) {
    v.x += (v.vx * dt) / 1000; v.y += (v.vy * dt) / 1000;
    const lo = b.cx - b.r, hi = b.cx + b.r, ty = b.cy - b.r, by = b.cy + b.r;
    if (v.x < lo || v.x > hi) { v.vx = -v.vx; v.x = clamp(v.x, lo, hi); }
    if (v.y < ty || v.y > by) { v.vy = -v.vy; v.y = clamp(v.y, ty, by); }
  }
  const interval = bossBiteInterval(b);
  b.biteAcc += dt;
  while (b.biteAcc >= interval) {
    b.biteAcc -= interval;
    s.hero.hp -= BOSS_BITE_DMG;
  }
  if (s.hero.hp <= 0) { s.hero.hp = 0; s.phase = "lost"; }
}

// How much of a stroke lies in the warden's drifting veils, 0..1 — the unravel
// fraction (submitTrace bleeds the trace's quality by it).
function strokeVeiled(b: BossState, stroke: { x: number; y: number }[]): number {
  if (!b.veils.length || !stroke.length) return 0;
  let veiled = 0;
  for (const p of stroke) {
    if (b.veils.some((v) => (p.x - v.x) ** 2 + (p.y - v.y) ** 2 <= v.r * v.r)) veiled++;
  }
  return veiled / stroke.length;
}

// Read a finger-stroke against the warden's seal WITHOUT touching it: snap its ends
// to two nodes, find the strand they join, rate the line (traceScore) and bleed it by
// any veil it crossed. Because intent is fully captured by *which two nodes* the ends
// snap to, binding is forgiving of penmanship — a deliberate node-to-node stroke that
// roughly covers the line clears the bar; accuracy only grades the flourish. Pure (no
// mutation), so the same verdict drives submitTrace's bind, the toast, AND the live
// render feedback as the carrier draws. Returns the strand, its quality, and a status.
function evalTrace(b: BossState, stroke: { x: number; y: number }[]): TraceResult & { veilFrac: number } {
  const seal = b.seal;
  if (stroke.length < TRACE_MIN_POINTS) return { quality: 0, edge: -1, status: "short", veilFrac: 0 };

  const snap = b.r * SEAL_SNAP_FRAC;
  const ai = nearestNode(seal, stroke[0], snap);
  const bi = nearestNode(seal, stroke[stroke.length - 1], snap);
  if (ai < 0 || bi < 0 || ai === bi) return { quality: 0, edge: -1, status: "offnode", veilFrac: 0 };

  const idx = seal.edges.findIndex((e) => (e.a === ai && e.b === bi) || (e.a === bi && e.b === ai));
  if (idx < 0) return { quality: 0, edge: -1, status: "noedge", veilFrac: 0 };

  const e = seal.edges[idx];
  const veilFrac = strokeVeiled(b, stroke);
  const raw = traceScore(stroke, [edgeSegment(seal, e)], b.r * TRACE_TOL_FRAC);
  const q = +(raw * (1 - BOSS_VEIL_UNRAVEL * veilFrac)).toFixed(4);

  let status: TraceStatus;
  if (e.done) status = "already";
  else if (q >= SEAL_EDGE_DONE) status = "bound";
  else status = veilFrac > 0.25 ? "veiled" : "weak";

  return { quality: q, edge: idx, status, veilFrac };
}

// Bind one strand of the warden's seal from a finger-stroke. Reads the verdict with
// evalTrace, then mutates: it records the strand's best quality, binds it if the
// stroke cleared the bar, and refreshes the meter (which may break the warden).
// Returns what happened, for the toast.
function submitTrace(s: PgState, stroke: { x: number; y: number }[]): TraceResult {
  if (s.phase !== "boss" || !s.boss) return { quality: 0, edge: -1, status: "none" };
  const b = s.boss;
  const { quality, edge, status } = evalTrace(b, stroke);
  if (edge >= 0) {
    const e = b.seal.edges[edge];
    if (quality > e.quality) { e.quality = quality; b.lastQuality = quality; b.flash = s.elapsed + TRACE_FLASH_MS; }
    if (status === "bound") e.done = true;
  }
  refreshBoss(s);
  return { quality, edge, status };
}

// Keyboard fallback for the duel (desktop, no pointer-drag): cycle the targeted
// strand and bind it by rote. cycleSel walks `sel` to the next/prev unbound strand;
// keyBind binds the targeted one — a cruder rite than a clean trace, so it costs the
// carrier a little flame (BOSS_KEY_COST). Pure sim, so the harness can prove it.
function cycleSel(s: PgState, dir: number): void {
  if (s.phase !== "boss" || !s.boss) return;
  const seal = s.boss.seal, n = seal.edges.length;
  if (!n) return;
  let i = s.boss.sel < 0 ? (dir > 0 ? -1 : 0) : s.boss.sel;
  for (let k = 0; k < n; k++) {
    i = ((i + dir) % n + n) % n;
    if (!seal.edges[i].done) { s.boss.sel = i; return; }
  }
  s.boss.sel = -1;
}
function keyBind(s: PgState): TraceResult {
  if (s.phase !== "boss" || !s.boss) return { quality: 0, edge: -1, status: "none" };
  const b = s.boss, seal = b.seal;
  let idx = b.sel;
  if (idx < 0 || idx >= seal.edges.length || seal.edges[idx].done) idx = nextUnbound(seal, b.sel);
  if (idx < 0) return { quality: 0, edge: -1, status: "already" };
  const e = seal.edges[idx];
  e.done = true;
  e.quality = Math.max(e.quality, SEAL_EDGE_DONE);
  b.lastQuality = e.quality; b.flash = s.elapsed + TRACE_FLASH_MS;
  s.hero.hp -= BOSS_KEY_COST;
  refreshBoss(s); // win takes priority over a flame that just hit zero…
  if (s.phase === "boss" && s.hero.hp <= 0) { s.hero.hp = 0; s.phase = "lost"; }
  return { quality: e.quality, edge: idx, status: "bound" };
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

// The base sprites this spinoff draws. Scenery uses the dwelling (dark/lit/
// awakened/snuffed)/conduit/press/shrine art; the hero is the player-lantern; the
// shades are the Keepers.
const SPRITE_NAMES = [
  "ground", "dwelling-dark", "dwelling-lit", "dwelling-awakened", "dwelling-snuffed",
  "conduit", "press", "shrine",
  // Live-terrain object states (Burning Vigil): a conduit alive with travelling
  // flame, a press discharged after its cascade, a shrine's consecrated ground.
  // Swap onto the same node as their base; the loader falls back to the base if
  // a state PNG is absent. Not in CITY_SPRITES — universal, not yet re-skinned.
  "conduit-charged", "press-spent", "shrine-consecrated",
  // Terrain laid along a segment, tiled by a pattern (walkway = pathway lane,
  // fence = the linear blocker). Universal forces like the Keepers — never a
  // city re-skin, so not in CITY_SPRITES. Optional: render falls back to the
  // procedural lines when the PNG is absent.
  "pathway", "fence",
  "keeper-node", "keeper-patrol", "player-lantern",
] as const;

// Which sprites a city may re-skin (art/<cityId>/<name>.png) — the built world.
// The four dwelling states match the parent's re-skinnable set.
const CITY_SPRITES = new Set<string>([
  "ground", "dwelling-dark", "dwelling-lit", "dwelling-awakened", "dwelling-snuffed",
  "conduit", "press", "shrine",
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

// A tileable terrain texture (walkway / fence) laid along a segment: a rect the
// length of the segment, exactly one tile tall, rotated to the segment's heading
// and filled with a horizontally-tiling pattern. The segment runs down the
// rect's centre (the trailing translate lifts it by half the thickness) so the
// art sits one clean row tall and never splits across the centreline. Used only
// when the PNG has loaded — callers fall back to the procedural lines otherwise.
function tiledSegment(patId: string, seg: Segment, thick: number, opacity: number): SVGRectElement {
  const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
  const ang = Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1) * 180 / Math.PI;
  return el("rect", {
    x: 0, y: 0, width: len, height: thick, fill: `url(#${patId})`, opacity,
    transform: `translate(${seg.x1.toFixed(1)} ${seg.y1.toFixed(1)}) rotate(${ang.toFixed(2)}) translate(0 ${(-thick / 2).toFixed(1)})`,
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
    </pattern>
    <pattern id="walkwayPat" patternUnits="userSpaceOnUse" width="${PATHWAY_HALF * 2}" height="${PATHWAY_HALF * 2}">
      <image href="art/pathway.png" width="${PATHWAY_HALF * 2}" height="${PATHWAY_HALF * 2}"/>
    </pattern>
    <pattern id="fencePat" patternUnits="userSpaceOnUse" width="${FENCE_VIS_THICK}" height="${FENCE_VIS_THICK}">
      <image href="art/fence.png" width="${FENCE_VIS_THICK}" height="${FENCE_VIS_THICK}"/>
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

// Resolve a node's sprite name from its live state: a dwelling shows its dark/
// lit/awakened/snuffed face (a still-active scar reads snuffed); a conduit shows
// its charged face while it carries flame, a press its spent face once fired, a
// shrine its consecrated face (its ground is always snuff-proof). Each state
// sprite falls back to the base when its PNG isn't loaded, so missing art never
// drops a node to a bare rect. Both render passes go through this so they never
// diverge.
function scenerySprite(s: PgState, n: ArenaNode): string {
  switch (n.kind) {
    case "dwelling":
      if (n.lit) return n.awoke ? "dwelling-awakened" : "dwelling-lit";
      if (n.veil && n.veil > s.elapsed) return "dwelling-snuffed";
      return "dwelling-dark";
    case "conduit":
      return conduitLive(s, n) && sprites.has("conduit-charged") ? "conduit-charged" : "conduit";
    case "press":
      return n.spent && sprites.has("press-spent") ? "press-spent" : "press";
    case "shrine":
      return sprites.has("shrine-consecrated") ? "shrine-consecrated" : "shrine";
    default:
      return SCENERY_SPRITE[n.kind];
  }
}

// A conduit is "charged" while any dwelling it fuses is lit or has a relay in
// flight to it — the same liveness the brighter fuse line draws, so the sprite
// and the fuse can never disagree.
function conduitLive(s: PgState, c: ArenaNode): boolean {
  const link = s.conduitLinks.find((l) => l.c === c);
  return !!link && link.dwellings.some(
    (d) => d.lit || s.spreadQueue.some((q) => q.node === d),
  );
}

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
    const key = spriteFor(s.level, scenerySprite(s, n));
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
  // (Measured against the *current* interval, which shortens as the seal binds.)
  const frac = clamp(b.biteAcc / bossBiteInterval(b), 0, 1);
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
  // The strands — each edge of the seal. A bound strand burns bright and solid;
  // an unbound one waits as a faint dashed guide (the line to draw over).
  for (const e of seal.edges) {
    const a = seal.nodes[e.a], z = seal.nodes[e.b];
    if (e.done) {
      layer.appendChild(el("line", {
        x1: a.x, y1: a.y, x2: z.x, y2: z.y, stroke: "#ffe9b0", "stroke-width": 3.4,
        "stroke-linecap": "round", opacity: 0.95, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
      }));
    } else {
      layer.appendChild(el("line", {
        x1: a.x, y1: a.y, x2: z.x, y2: z.y, stroke: "#ffd87a", "stroke-width": 2,
        "stroke-linecap": "round", "stroke-dasharray": "6 9", opacity: 0.4,
      }));
    }
  }
  // The keyboard-targeted strand (desktop fallback) — a brighter dashed marker over
  // the unbound strand `sel` points at, so the hand knows what Enter will bind.
  if (b.sel >= 0 && b.sel < seal.edges.length && !seal.edges[b.sel].done) {
    const e = seal.edges[b.sel], a = seal.nodes[e.a], z = seal.nodes[e.b];
    layer.appendChild(el("line", {
      x1: a.x, y1: a.y, x2: z.x, y2: z.y, stroke: "#fff3d2", "stroke-width": 2.6,
      "stroke-linecap": "round", "stroke-dasharray": "2 7", opacity: 0.9,
    }));
  }
  // The nodes — the glowing points you connect. A node whose strands are all bound
  // burns full; one still waiting on a strand glows to beckon the hand.
  for (let i = 0; i < seal.nodes.length; i++) {
    const n = seal.nodes[i];
    const incident = seal.edges.filter((e) => e.a === i || e.b === i);
    const allBound = incident.length > 0 && incident.every((e) => e.done);
    const halo = allBound ? 0.95 : incident.some((e) => !e.done) ? 0.55 : 0.3;
    layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: 11, fill: "url(#haloAwake)", opacity: halo }));
    layer.appendChild(el("circle", {
      cx: n.x, cy: n.y, r: 6, fill: allBound ? "#fff3d2" : "#1a1206",
      stroke: "#ffe9b0", "stroke-width": 2, opacity: 0.95,
    }));
  }

  // The warden's drifting veils — pools of the old dark sliding over the seal. A
  // stroke dragged across one is unravelled (strokeVeiled), so they are lanes to
  // wait out, not walls. Drawn over the glyph so they genuinely occlude the lines.
  for (const v of b.veils) {
    layer.appendChild(el("circle", { cx: v.x, cy: v.y, r: v.r, fill: "url(#veil)" }));
    layer.appendChild(el("circle", {
      cx: v.x, cy: v.y, r: v.r, fill: "none",
      stroke: "#2a1840", "stroke-width": 1.5, "stroke-dasharray": "5 9", opacity: 0.5,
    }));
  }

  // The carrier's live finger-stroke, burning along behind the fingertip. While it's
  // drawn it teaches (reading the verdict with evalTrace, no mutation): the unbound
  // strands radiating from the node it sprang from glow as candidates, and the stroke
  // itself burns green when it would bind, gold when it's close, violet when the dark
  // is drinking it, and ember-red when it's off the seal's nodes or line.
  if (bossTrace && bossTrace.length >= 1) {
    const start = nearestNode(seal, bossTrace[0], b.r * SEAL_SNAP_FRAC);
    if (start >= 0) {
      for (const e of seal.edges) {
        if (e.done || (e.a !== start && e.b !== start)) continue;
        const a = seal.nodes[e.a], z = seal.nodes[e.b];
        layer.appendChild(el("line", {
          x1: a.x, y1: a.y, x2: z.x, y2: z.y, stroke: "#fff3d2", "stroke-width": 2.4,
          "stroke-linecap": "round", "stroke-dasharray": "3 6", opacity: 0.7,
        }));
      }
    }
    if (bossTrace.length > 1) {
      const v = evalTrace(b, bossTrace);
      const col = v.status === "bound" ? "#9dffa0"  // would bind — green
        : v.status === "weak" ? "#ffd87a"           // close — warm gold
        : v.status === "veiled" ? "#8a5cff"         // the dark is drinking it — violet
        : "#ff6a3c";                                // off the nodes/line — ember red
      let d = `M${bossTrace[0].x.toFixed(1)} ${bossTrace[0].y.toFixed(1)}`;
      for (let i = 1; i < bossTrace.length; i++) d += ` L${bossTrace[i].x.toFixed(1)} ${bossTrace[i].y.toFixed(1)}`;
      // A diffuse halo underneath (the #bloom filter is pure blur, no crisp source)…
      layer.appendChild(el("path", {
        d, fill: "none", stroke: col, "stroke-width": 7,
        "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.55,
        filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
      }));
      // …then a crisp, unblurred core on top so the line the finger draws reads sharply.
      layer.appendChild(el("path", {
        d, fill: "none", stroke: col, "stroke-width": 3,
        "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 1,
      }));
      // A bright white centreline keeps the stroke legible against the glow.
      layer.appendChild(el("path", {
        d, fill: "none", stroke: "#ffffff", "stroke-width": 1.3,
        "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.85,
      }));
    }
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

  // Spitters' bolts — motes of the old dark hurled at the hero. Drawn as a small
  // comet: a fading motion trail behind it (so it reads as hurtling, and you can
  // see where it came from), a cold-ringed dark body, and a hot core pip that
  // keeps it legible against the warm sigil it crosses.
  for (const b of s.bolts) {
    if (b.born < 0) continue;
    const fx: Record<string, string> = LOW_FX ? {} : { filter: "url(#bloom)" };
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const tl = BOLT_RADIUS * 2.6; // trail length
    layer.appendChild(el("line", {
      x1: b.x - (b.vx / sp) * tl, y1: b.y - (b.vy / sp) * tl, x2: b.x, y2: b.y,
      stroke: "#6fa8e8", "stroke-width": BOLT_RADIUS, "stroke-linecap": "round",
      opacity: 0.4, ...(LOW_FX ? {} : { filter: "url(#glow)" }),
    }));
    layer.appendChild(el("circle", {
      cx: b.x, cy: b.y, r: BOLT_RADIUS, fill: "#0e1530",
      stroke: "#a9d2ff", "stroke-width": 2, opacity: 0.95, ...fx,
    }));
    layer.appendChild(el("circle", {
      cx: b.x, cy: b.y, r: BOLT_RADIUS * 0.42, fill: "#eaf3ff", opacity: 0.95,
    }));
  }

  // Pathways — open lanes drawn on the ground beneath the built world: when the
  // walkway sprite has loaded it tiles a worn road down the lane; otherwise a
  // pale road bar with a faint warm centre line, so the swift routes read either
  // way at a glance.
  const hasWalkway = sprites.has("pathway");
  for (const p of s.pathways) {
    if (hasWalkway) {
      layer.appendChild(tiledSegment("walkwayPat", p, PATHWAY_HALF * 2, 0.7));
      continue;
    }
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

  // Conduit fuses — faint dashed lines from each conduit to the dwellings it can
  // relay to, so the player can read the streets that carry flame. A live fuse (a
  // lit source, or a relay in flight) burns a touch brighter.
  for (const link of s.conduitLinks) {
    for (const d of link.dwellings) {
      const live = d.lit || s.spreadQueue.some((q) => q.node === d);
      layer.appendChild(el("line", {
        x1: link.c.x, y1: link.c.y, x2: d.x, y2: d.y,
        stroke: "#7a6a3a", "stroke-width": live ? 2 : 1,
        "stroke-dasharray": "3 7", opacity: live ? 0.5 : 0.16,
      }));
    }
  }

  // Fences — low walls strung between posts, drawn beneath the built world so
  // dwellings and structures sit on top of them (a fence never covers a home):
  // when the fence sprite has loaded it tiles a barricade down the segment;
  // otherwise a stout dark bar with a lighter top edge so they read as solid
  // blockers either way.
  const hasFence = sprites.has("fence");
  for (const f of s.fences) {
    if (hasFence) {
      layer.appendChild(tiledSegment("fencePat", f, FENCE_VIS_THICK, 0.95));
      continue;
    }
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

  // Scenery — the built world, drawn dark for the Diablo gloom. Keeper-posts are
  // spawn-points, not scenery, so they aren't drawn here. Solid structures (press,
  // shrine) draw full-opacity with a faint ring so they read as blockers; a lit
  // dwelling glows with a warm halo.
  for (const n of s.scenery) {
    if (n.kind === "keeper") continue;
    const solid = OBSTACLE_KINDS.has(n.kind);
    // Consecrated ground — a faint protective ring marking a shrine's snuff-proof aura.
    if (n.kind === "shrine") {
      layer.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: SHRINE_AURA, fill: "none",
        stroke: "#9fe8c4", "stroke-width": 1.2, "stroke-dasharray": "4 10", opacity: 0.16,
      }));
    }
    // A snuffed dwelling's lingering scar — a small pool of clawed-back dark.
    if (n.kind === "dwelling" && n.veil && n.veil > s.elapsed) {
      const life = (n.veil - s.elapsed) / SNUFF_VEIL_MS;
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: SCAR_RADIUS, fill: "#0a0710", opacity: 0.3 * life }));
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: SCAR_RADIUS * 0.6, fill: "#160c22", opacity: 0.3 * life }));
    }
    if (n.kind === "dwelling" && n.lit) {
      // An awakened dwelling burns brighter and shows its emitter reach.
      const halo = n.awoke ? 32 + 6 * Math.sin(s.elapsed / 220) : 30;
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: halo, fill: "url(#haloAwake)", opacity: n.awoke ? 0.85 : 0.7 }));
      if (n.awoke) {
        layer.appendChild(el("circle", {
          cx: n.x, cy: n.y, r: AWAKENED_RADIUS, fill: "none",
          stroke: "#ffd87a", "stroke-width": 1.2, opacity: 0.2,
        }));
      }
    }
    const spriteName = scenerySprite(s, n);
    const key = spriteFor(s.level, spriteName);
    const op = solid ? (n.spent ? 0.4 : 1) : 0.5; // a spent press dims
    if (key) {
      layer.appendChild(spriteImage(key, n.x, n.y, SCENERY_SIZE[n.kind], op));
    } else {
      layer.appendChild(el("rect", {
        x: n.x - 8, y: n.y - 8, width: 16, height: 16, rx: 2,
        fill: n.lit ? "#3a2a14" : "#161a2c",
        stroke: solid ? "#3a3050" : n.lit ? "#ffd87a" : "#222842",
        "stroke-width": 1, opacity: solid ? (n.spent ? 0.5 : 0.95) : 0.7,
      }));
    }
    if (solid) {
      layer.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: (OBSTACLE_RADIUS[n.kind] || 0),
        fill: "none", stroke: "#3a3050", "stroke-width": 1.5, opacity: 0.4,
      }));
    }
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
    const sz = (e.elite ? 60 : e.darter ? 34 : 44) * (1 + recoil); // champions loom larger, darters smaller; recoil pop on impact
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
    // A spitter wears a faint dashed warm ring — the watch that lobs from afar.
    if (e.spitter) {
      layer.appendChild(el("circle", {
        cx: e.x, cy: e.y, r: SHADE_RADIUS + 7, fill: "none",
        stroke: "#e8a24a", "stroke-width": 1.5, opacity: 0.55 * op,
        "stroke-dasharray": "3 5",
      }));
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
  dwellingsLit: number;      // lifetime dwellings kindled across all descents
  dwellingsAwakened: number; // lifetime dwellings that awakened into ally emitters
  embers: number;       // unlock currency, banked from clears
  unlocked: string[];   // sigil ids the carrier owns (always includes "vigil")
  equipped: string;     // the sigil id currently equipped
  frescoesFound: number[]; // the reliquary — FRESCO indices uncovered, ever
}

function emptyPgLegacy(): PgLegacy {
  return { runs: 0, clears: 0, best: {}, dwellingsLit: 0, dwellingsAwakened: 0, embers: 0, unlocked: ["vigil"], equipped: "vigil", frescoesFound: [] };
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
    const found = Array.isArray(l.frescoesFound)
      ? [...new Set(l.frescoesFound.filter((i) => i >= 0 && i < FRESCOES.length))].sort((a, b) => a - b)
      : [];
    return {
      runs: l.runs || 0, clears: l.clears || 0, best: l.best || {},
      dwellingsLit: l.dwellingsLit || 0,
      dwellingsAwakened: l.dwellingsAwakened || 0,
      embers: l.embers || 0, unlocked: [...owned], equipped,
      frescoesFound: found,
    };
  } catch { return emptyPgLegacy(); }
}

function savePgLegacy(l: PgLegacy): void {
  try { localStorage.setItem(PG_LEGACY_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

function recordClear(level: LevelDef, ms: number, lit = 0, embers = 0, awoke = 0): PgLegacy {
  const l = loadPgLegacy();
  l.runs++; l.clears++;
  l.dwellingsLit += lit;
  l.dwellingsAwakened += awoke;
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

function recordDeath(lit = 0, awoke = 0): PgLegacy {
  const l = loadPgLegacy();
  l.runs++;
  l.dwellingsLit += lit;
  l.dwellingsAwakened += awoke;
  savePgLegacy(l);
  return l;
}

// Fold a descent's uncovered frescoes into the lifetime reliquary. Called once
// at each genuine run-end (win or fall), beside recordClear/recordDeath — the
// write-once-per-end ethos. Idempotent (a set union), and a city's whole subset
// being newly completed banks a one-time ember bounty (a once-complete subset
// stays complete in `before` forever after, so it never re-pays). Returns the
// fresh collection, the embers banked this fold, and the cities just completed.
function recordFrescoes(shown: number[]): { found: number[]; bonus: number; completed: string[] } {
  const l = loadPgLegacy();
  const before = new Set(l.frescoesFound);
  const after = new Set(before);
  for (const i of shown) if (i >= 0 && i < FRESCOES.length) after.add(i);
  let bonus = 0;
  const completed: string[] = [];
  for (const lv of LEVELS) {
    const subset = lv.frescoes;
    if (!subset || !subset.length) continue;
    if (!subset.every((i) => before.has(i)) && subset.every((i) => after.has(i))) {
      bonus += FRESCO_SET_BONUS;
      completed.push(lv.name);
    }
  }
  l.frescoesFound = [...after].sort((a, b) => a - b);
  l.embers += bonus;
  savePgLegacy(l);
  return { found: l.frescoesFound, bonus, completed };
}

// The reliquary gallery for the picker (pure string, no DOM). Tiles grouped by
// the city that carries each fresco; an uncovered tile shows its painted jpg
// (reused from the parent, already cached) and its line, a hidden one a CSS
// whitewash. A city whose whole subset is found wins an "illuminated" badge.
function frescoGalleryHtml(found: number[]): string {
  const got = new Set(found);
  // Every fresco belongs to exactly one city's subset; anything unassigned
  // (shouldn't happen — the union covers all) falls under "The streets".
  const assigned = new Set<number>();
  let groups = "";
  for (const lv of LEVELS) {
    const subset = lv.frescoes;
    if (!subset || !subset.length) continue;
    const complete = subset.every((i) => got.has(i));
    const badge = complete ? ` <span class="legacy-new">illuminated</span>` : "";
    const tiles = subset.map((i) => {
      assigned.add(i);
      return got.has(i)
        ? `<button class="frx" data-frx="${i}"><img class="frx-img" src="${FRESCO_ART[i]}" alt="" loading="lazy"><span class="frx-line">${FRESCOES[i]}</span></button>`
        : `<div class="frx frx-hidden"><span class="frx-wash">Beneath the whitewash…</span></div>`;
    }).join("");
    groups += `<div class="frx-city">${lv.name}${badge}</div><div class="reliquary">${tiles}</div>`;
  }
  const stray = FRESCOES.map((_, i) => i).filter((i) => !assigned.has(i));
  if (stray.length) {
    const tiles = stray.map((i) => got.has(i)
      ? `<button class="frx" data-frx="${i}"><img class="frx-img" src="${FRESCO_ART[i]}" alt="" loading="lazy"><span class="frx-line">${FRESCOES[i]}</span></button>`
      : `<div class="frx frx-hidden"><span class="frx-wash">Beneath the whitewash…</span></div>`).join("");
    groups += `<div class="frx-city">The streets</div><div class="reliquary">${tiles}</div>`;
  }
  return `<div class="legacy"><div class="legacy-head">` +
    `Reliquary <span class="legacy-new">${got.size}/${FRESCOES.length} uncovered</span></div></div>` +
    groups;
}

// ---------- QR code (byte mode, ECC level L, versions 1–5) ----------
// A tiny self-contained QR encoder so "share the game" works offline with the
// module's zero runtime dependencies — no external QR service is ever called.
// Scope: byte mode, error-correction level L, a single data block (versions
// 1–5, up to ~106 bytes — ample for the game's URL). Ported from the standard
// algorithm; validated in the harness by Reed–Solomon root checks, the finder/
// timing geometry, and a place+mask round-trip of the data back out of the
// matrix. Returns the module grid (true = dark) for the renderer to paint.
interface QrResult {
  size: number; version: number; mask: number;
  modules: boolean[][]; isFn: boolean[][]; codewords: number[];
}

// GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D).
const QR_EXP = new Uint8Array(256);
const QR_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { QR_EXP[i] = x; QR_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
})();
function qrMul(a: number, b: number): number {
  return (a === 0 || b === 0) ? 0 : QR_EXP[(QR_LOG[a] + QR_LOG[b]) % 255];
}
// Reed–Solomon generator polynomial of degree `n` (coefficients, leading first).
function qrGenPoly(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= qrMul(g[j], QR_EXP[i]); }
    g = ng;
  }
  return g;
}
// The `n` error-correction codewords for `data` (remainder of data·x^n ÷ gen).
function qrEcc(data: number[], n: number): number[] {
  const gen = qrGenPoly(n);
  const res = new Array(n).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift(); res.push(0);
    if (factor !== 0) for (let j = 0; j < n; j++) res[j] ^= qrMul(gen[j + 1], factor);
  }
  return res;
}

// [dataCodewords, eccCodewords] per version at level L (single block).
const QR_CAP: ([number, number] | null)[] = [null, [19, 7], [34, 10], [55, 15], [80, 20], [108, 26]];
const QR_ALIGN = [0, 0, 18, 22, 26, 30]; // single alignment-pattern centre per version (0 = none)

function qrMaskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

// 15-bit BCH format information for level L and the given mask.
function qrFormatBits(mask: number): number {
  const data = (0b01 << 3) | mask; // L = 01, then 3 mask bits
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff;
}

function qrEncode(text: string): QrResult | null {
  // UTF-8 bytes.
  const bytes: number[] = [];
  const utf8 = unescape(encodeURIComponent(text));
  for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i) & 0xff);
  // Smallest version that fits (4-bit mode + 8-bit count overhead ≈ 2 bytes).
  let version = 0;
  for (let v = 1; v <= 5; v++) if (bytes.length <= QR_CAP[v]![0] - 2) { version = v; break; }
  if (!version) return null;
  const [dataLen, eccLen] = QR_CAP[version]!;

  // Bit stream → data codewords.
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  put(0b0100, 4); put(bytes.length, 8);
  for (const b of bytes) put(b, 8);
  for (let i = 0, term = Math.min(4, dataLen * 8 - bits.length); i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const cw: number[] = [];
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; cw.push(b); }
  for (let pad = 0; cw.length < dataLen; pad++) cw.push(pad % 2 === 0 ? 0xec : 0x11);
  const all = cw.concat(qrEcc(cw, eccLen));

  // Matrix.
  const size = 17 + 4 * version;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () => new Array(size).fill(null));
  const isFn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = dark; isFn[r][c] = true;
  };
  // Finder patterns + separators.
  const finder = (r0: number, c0: number) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const dark = inner && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
      setFn(r0 + r, c0 + c, dark);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  // Timing patterns.
  for (let i = 0; i < size; i++) {
    if (modules[6][i] === null) setFn(6, i, i % 2 === 0);
    if (modules[i][6] === null) setFn(i, 6, i % 2 === 0);
  }
  // Alignment pattern (versions 2–5: a single centre).
  const a = QR_ALIGN[version];
  if (a) for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++)
    setFn(a + r, a + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
  // Reserve the format-info modules (filled with real bits after masking).
  const drawFormat = (value: number) => {
    const bit = (i: number) => ((value >> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) setFn(i, 8, bit(i));
    setFn(7, 8, bit(6)); setFn(8, 8, bit(7)); setFn(8, 7, bit(8));
    for (let i = 9; i < 15; i++) setFn(8, 14 - i, bit(i));
    for (let i = 0; i < 8; i++) setFn(8, size - 1 - i, bit(i));
    for (let i = 8; i < 15; i++) setFn(size - 15 + i, 8, bit(i));
    setFn(size - 8, 8, true);
  };
  drawFormat(0);

  // Lay the codeword bits in the zigzag, skipping function modules.
  let bi = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (modules[row][col] === null) {
          let dark = false;
          if (bi < all.length * 8) { dark = ((all[bi >> 3] >> (7 - (bi & 7))) & 1) !== 0; bi++; }
          modules[row][col] = dark;
        }
      }
    }
  }

  // Choose the mask with the lowest penalty.
  const applyMask = (mask: number) => {
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
      if (!isFn[r][c] && qrMaskBit(mask, r, c)) modules[r][c] = !modules[r][c];
  };
  const penalty = (): number => {
    let p = 0;
    for (let r = 0; r < size; r++) {
      let runC = 1, runR = 1;
      for (let c = 1; c < size; c++) {
        if (modules[r][c] === modules[r][c - 1]) { if (++runC >= 5) p += runC === 5 ? 3 : 1; } else runC = 1;
        if (modules[c][r] === modules[c - 1][r]) { if (++runR >= 5) p += runR === 5 ? 3 : 1; } else runR = 1;
      }
    }
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) p += 3;
    }
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c]) dark++;
    p += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return p;
  };
  let best = 0, bestP = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask); drawFormat(qrFormatBits(mask));
    const pp = penalty();
    applyMask(mask); // undo (XOR is its own inverse)
    if (pp < bestP) { bestP = pp; best = mask; }
  }
  applyMask(best); drawFormat(qrFormatBits(best));

  return { size, version, mask: best, modules: modules as boolean[][], isFn, codewords: all };
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
  const frescoEl = byId("fresco");
  const frescoImg = byId("fresco-img") as HTMLImageElement;
  const frescoCap = byId("fresco-cap");
  const stickEl = byId("stick");
  const stickKnob = byId("stick-knob");
  const mmEl = byId("minimap") as unknown as SVGSVGElement;
  const headerEl = document.querySelector("header") as HTMLElement | null;

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
    // During the warden duel a touch begins a strand-trace, not the joystick. Snap
    // the start to the nearest seal node so the line springs from a glowing point.
    if (s && s.phase === "boss") {
      bossPtr = e.pointerId;
      const p0 = worldPt(e.clientX, e.clientY);
      if (s.boss) {
        const ni = nearestNode(s.boss.seal, p0, s.boss.r * SEAL_SNAP_FRAC);
        if (ni >= 0) { p0.x = s.boss.seal.nodes[ni].x; p0.y = s.boss.seal.nodes[ni].y; }
      }
      bossTrace = [p0];
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
    // Releasing during the duel binds the drawn strand to the warden's seal.
    if (bossPtr === e.pointerId) {
      if (s && s.phase === "boss" && bossTrace) {
        const res = submitTrace(s, bossTrace);
        showToast(
          res.status === "bound" ? "The strand takes — the seal binds tighter."
          : res.status === "already" ? "That strand already holds — trace another."
          : res.status === "veiled" ? "The dark drank your line — wait for a veil to drift clear, then trace."
          : res.status === "weak" ? "Closer — draw straight from one point to the next."
          : res.status === "short" ? "Too brief — draw a line from node to node."
          : "Begin and end your line on the seal's glowing points.",
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
    // The duel's keyboard fallback (desktop, no pointer-drag): cycle the targeted
    // strand and bind it by rote. The pgFrame loop renders the change next frame.
    if (s && s.phase === "boss") {
      if (k === "tab" || k === "arrowright" || k === "arrowdown" || k === "d") { cycleSel(s, 1); e.preventDefault(); }
      else if (k === "arrowleft" || k === "arrowup" || k === "a") { cycleSel(s, -1); e.preventDefault(); }
      else if (k === " " || k === "enter") {
        const res = keyBind(s);
        showToast(res.status === "bound"
          ? "Bound by rote — the seal holds, though the flame pays for it."
          : "Every strand already holds.");
        e.preventDefault();
      }
      return;
    }
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
    // The duel: show the seal's binding progress where the shade count would be —
    // strands bound, the honest measure (the warden's "health" IS this fraction).
    if (s.boss && s.phase === "boss") {
      const edges = s.boss.seal.edges, bound = edges.filter((e) => e.done).length;
      foesEl.textContent = `Seal ${bound} / ${edges.length} bound`;
      lightsEl.textContent = litReadout(s);
      return;
    }
    const alive = aliveShades(s);
    // The win condition. Lead with the verb so the persistent readout reads as
    // THE objective, not a collectible like the (secondary) lit count beside it.
    let foes = alive > 0 ? `Clear ${alive} / ${s.total} shades` : `City cleansed`;
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
    lightsEl.textContent = litReadout(s);
    cityEl.textContent = s.level.name;
    sigilEl.textContent = s.type.name;
    sigilEl.style.color = s.type.star;
  }

  // A glanceable corner overview of the whole arena — the camera only ever shows
  // a fraction of it, so this is how you find the last few shades and read your
  // progress at a glance. Flat dots, no glow filters, and redrawn at a fraction
  // of the frame rate (shades don't need 60fps on a 96px map) to stay cheap.
  // Only meaningful in the real-time fight: the picker has no arena and the duel
  // locks the camera on the warden, so it hides in both.
  const MM_MAX = 96; // px — the minimap's longest edge
  let mmTick = 0;
  function minimap(): void {
    if (!s || s.phase !== "fight") { mmEl.style.display = "none"; return; }
    if (mmTick++ % 5 !== 0) return; // ~12 redraws/sec is plenty for a glance map
    const scale = Math.min(MM_MAX / s.w, MM_MAX / s.h);
    const mw = s.w * scale, mh = s.h * scale;
    mmEl.style.display = "block";
    // Sit just under the header. On a narrow (mobile) viewport the header's
    // stats/HP row wraps and it grows past the one-line desktop height; a
    // hardcoded top would leave the minimap painted over by the taller, higher
    // z-index header. Measure it live so we always clear whatever it wraps to.
    mmEl.style.top = `${(headerEl ? headerEl.offsetHeight : 50) + 6}px`;
    // Inline width/height (not the `width`/`height` attributes): the global
    // `svg { width:100%; height:100% }` rule for the arena would otherwise win
    // over presentation attributes and stretch the map across the whole screen.
    mmEl.style.width = `${mw.toFixed(1)}px`;
    mmEl.style.height = `${mh.toFixed(1)}px`;
    mmEl.setAttribute("viewBox", `0 0 ${mw.toFixed(1)} ${mh.toFixed(1)}`);
    mmEl.innerHTML = "";
    mmEl.appendChild(el("rect", { x: 0, y: 0, width: mw, height: mh, fill: "#070912", opacity: 0.5 }));
    // Reclaimed dwellings — your progress across the dark city (awakened brighter).
    for (const n of s.scenery) {
      if (n.kind !== "dwelling" || !n.lit) continue;
      mmEl.appendChild(el("circle", {
        cx: n.x * scale, cy: n.y * scale, r: n.awoke ? 1.7 : 1.1,
        fill: n.awoke ? "#fff3d2" : "#ffd87a", opacity: 0.9,
      }));
    }
    // The host that remains — the map's whole point (shielded champions stand out).
    for (const e of s.shades) {
      if (e.dead) continue;
      mmEl.appendChild(el("circle", {
        cx: e.x * scale, cy: e.y * scale, r: e.elite ? 1.9 : 1.3,
        fill: e.shielded ? "#b46cff" : "#ff5a3c", opacity: 0.95,
      }));
    }
    // The camera's window onto the arena, so the dots place against what you see.
    const vw = svg.clientWidth, vh = svg.clientHeight;
    mmEl.appendChild(el("rect", {
      x: (-cam.x / cam.k) * scale, y: (-cam.y / cam.k) * scale,
      width: (vw / cam.k) * scale, height: (vh / cam.k) * scale,
      fill: "none", stroke: "#ffe9b0", "stroke-width": 0.6, opacity: 0.5,
    }));
    // The hero, last so it sits on top.
    mmEl.appendChild(el("circle", {
      cx: s.hero.x * scale, cy: s.hero.y * scale, r: 2.3,
      fill: "#fff6d8", stroke: "#ff6a3c", "stroke-width": 0.8,
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

  const TOAST_MS = 3200; // how long a toast stays up (also gates the intro hold)
  function showToast(text: string): void {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    window.setTimeout(() => toastEl.classList.remove("show"), TOAST_MS);
  }

  // ----- The descent loop -----
  let lastFrame = 0;
  let running = false;
  // The opening tutorial toast is long; rather than let the swarm lurch forward
  // while the carrier reads it, the fight is held frozen (scene drawn, nothing
  // stepped) until the toast fades or the carrier gives input — so the descent
  // only truly begins once the "popup" is gone. Set in startCity.
  let introHold = false;
  let introHoldTimer: ReturnType<typeof setTimeout> | undefined;
  function pgFrame(now: number): void {
    if (!running || !s) return;
    if (!lastFrame) lastFrame = now;
    let dt = now - lastFrame; lastFrame = now;
    if (dt > 100) dt = 100; // a backgrounded tab must not lurch the fight forward

    // Hold the opening: draw the arena but step nothing while the tutorial toast
    // is up. The carrier's first move (joystick or WASD) dismisses it early.
    if (introHold && (move.x || move.y || keys.size > 0)) {
      introHold = false;
      clearTimeout(introHoldTimer);
      toastEl.classList.remove("show");
    }

    if (!introHold && s.phase === "fight") {
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
    minimap();

    if (s.phase === "won") { running = false; onWin(); return; }
    if (s.phase === "lost") { running = false; onLost(); return; }
    // A fresco uncovered this frame surfaces as a small, quiet card (art) or a
    // toast (text) — the descent keeps running, so an action fight is never frozen
    // mid-swarm. It fades on its own.
    if (s.pendingFresco) { revealFresco(s.pendingFresco); s.pendingFresco = null; }
    requestAnimationFrame(pgFrame);
  }

  // The host has fallen and the warden risen: drop the joystick, lock the camera
  // on the warden, and tell the carrier how the duel is fought.
  function onBossRise(): void {
    bossTrace = null; bossPtr = null;
    move.x = 0; move.y = 0; stick = null; hideStick();
    frameBoss();
    showToast("The Veilwarden rises. Trace its seal end to end — node to glowing node — to bind each strand; keep clear of the drifting veils, which unravel a line dragged through them. It snuffs faster as the seal binds, so race the violet ring. (Desktop: arrows pick a strand, Enter binds it.)");
  }

  // A revealed fresco surfaces without halting the descent: a painted fragment gets
  // a small, quiet illuminated card; a plain one falls back to a toast — mirroring
  // the parent. Both fade on their own and never eat the joystick (pointer-events:
  // none), so the action runs on underneath. (No freeze: an action fight can't be
  // modal-paused mid-swarm.)
  let frescoTimer: ReturnType<typeof setTimeout> | undefined;
  function revealFresco(text: string): void {
    const idx = FRESCOES.indexOf(text);
    const art = idx >= 0 ? FRESCO_ART[idx] : undefined;
    if (!art) { showToast(text); return; }
    // Show the painted card only once the jpg decodes; if the art is absent
    // (not yet generated), fall back to the quiet toast — no broken image.
    frescoImg.onload = () => {
      frescoCap.textContent = text;
      // Place it away from the hero: if the hero is in the lower half of the
      // viewport (camera clamped at the arena's bottom edge), the bottom card
      // would sit over the action and joystick — flip it to the top, clearing
      // the live header height the way the minimap does.
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const heroY = s ? cam.y + s.hero.y * cam.k : 0;
      if (heroY > vh * 0.5) {
        frescoEl.style.top = `${(headerEl ? headerEl.offsetHeight : 50) + 10}px`;
        frescoEl.classList.add("at-top");
      } else {
        frescoEl.style.top = "";
        frescoEl.classList.remove("at-top");
      }
      frescoEl.classList.add("show");
      clearTimeout(frescoTimer);
      frescoTimer = setTimeout(() => frescoEl.classList.remove("show"), 6000);
    };
    frescoImg.onerror = () => { showToast(text); };
    frescoImg.src = art;
  }

  function startCity(level: LevelDef): void {
    s = buildArena(level);
    loadCitySprites(level.id, repaint);
    hideOverlay();
    clearTimeout(frescoTimer); frescoEl.classList.remove("show"); // no card lingers into a new run
    setupZoom();
    centerCam(s.hero.x, s.hero.y);
    hud();
    showToast("Cleanse the city: clear EVERY shade to win (watch the count, top-right). Stand still to inscribe the pentagram — it burns shades and lights the dark dwellings around you; move to dodge. Weave around presses, shrines and fences, run the pathways to kite the swarm. Keep out of the drifting veil pools (they unravel the sigil), break a shielded champion with a FULL inscription, and gather the embers the fallen leave to bite harder. (Lighting dwellings heals you and is worth score, but clearing the shades is what wins.)");
    // Freeze the descent under the tutorial toast: the shades only begin to stir
    // once the carrier has had a moment to read it (or moves to dismiss it).
    introHold = true;
    clearTimeout(introHoldTimer);
    introHoldTimer = setTimeout(() => { introHold = false; }, TOAST_MS);
    running = true; lastFrame = 0;
    requestAnimationFrame(pgFrame);
  }

  function onWin(): void {
    if (!s) return;
    const ms = s.elapsed;
    const lit = s.litCount, total = s.dwellingsTotal;
    const awoke = s.scenery.filter((n) => n.awoke).length;
    const sc = scoreRun(s);
    const l = recordClear(s.level, ms, lit, sc.embers, awoke);
    const fr = recordFrescoes(s.shownFrescoes); // fold the reliquary; may bank a bonus
    const banked = l.embers + fr.bonus;
    const best = l.best[s.level.id];
    const relit = (lit >= total && total > 0
      ? `You relit every dwelling — <em>${total}</em>. The city is whole again.`
      : `You relit <em>${lit}</em> of ${total} dwellings.`)
      + (awoke ? ` <em>${awoke}</em> awakened to fight beside you.` : "")
      + (s.snuffed ? ` The watch clawed <em>${s.snuffed}</em> back into the dark.` : "");
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
      (fr.bonus
        ? row("Reliquary", `${fr.completed.join(", ")} <em>illuminated</em> · +${fr.bonus}`)
        : "") +
      row("Embers earned", `+${sc.embers + fr.bonus} <span class="legacy-new">${banked} banked</span>`) +
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
    recordDeath(s.litCount, s.scenery.filter((n) => n.awoke).length);
    const fr = recordFrescoes(s.shownFrescoes); // the reliquary keeps what you saw, even in falling
    const reliquary = fr.bonus
      ? `<br><br>Yet you uncovered the frescoes of <em>${fr.completed.join(", ")}</em> — ` +
        `<em>+${fr.bonus} embers</em> for the reliquary.`
      : "";
    const unbound = s.boss ? s.boss.seal.edges.filter((e) => !e.done).length : 0;
    const how = s.boss
      ? `The Veilwarden of <em>${s.level.name}</em> snuffed your flame with ` +
        `<em>${unbound}</em> of its ${s.boss.seal.edges.length} strands still unbound.`
      : `The watch of <em>${s.level.name}</em> pulled you down with ` +
        `<em>${aliveShades(s)}</em> shades still standing.`;
    showOverlay(
      "You fell",
      `${how}<br><br>` +
      `You had relit <em>${s.litCount}</em> of ${s.dwellingsTotal} dwellings.` +
      `${reliquary}<br><br>` +
      `<em>The dark is patient. Descend again.</em>`,
      "Try again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function showPicker(selId?: string): void {
    s = null; running = false;
    introHold = false; clearTimeout(introHoldTimer); // drop any pending intro hold
    mmEl.style.display = "none"; // no arena to overview at the city select
    const l = loadPgLegacy();
    // The selected city — defaults to the first, and supplies the establishing
    // art shown at the top of the card (mirrors the parent's Lamplighter intro).
    const sel = levelById(selId || "") || LEVELS[0];
    const card = sel.art ? `<img class="city-art" src="${sel.art}" alt="">` : "";
    let html =
      card +
      `<p class="lede">Choose a city to descend into. Stand still to inscribe a ` +
      `pentagram that burns the shades around you; move to dodge their touch and ` +
      `weave around the solid presses, shrines and fences. Run the pathways to outpace ` +
      `the swarm, and catch a dark dwelling in the ring to light it and mend yourself. ` +
      `Clear every shade and the city is cleansed.</p><div class="cities">`;
    for (const lv of LEVELS) {
      const done = l.best[lv.id];
      const mark = done ? ` <span class="legacy-new">cleansed ${fmtTime(done)}</span>` : "";
      html +=
        `<button class="city${lv.id === sel.id ? " sel" : ""}" data-id="${lv.id}">` +
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
        `<div><dt>Dwellings relit</dt><dd>${l.dwellingsLit}</dd></div>` +
        `<div><dt>Dwellings awakened</dt><dd>${l.dwellingsAwakened}</dd></div></dl></div>`;
    }

    // The reliquary opens as its own view (the secondary button), not buried in
    // this card — the gallery is a lot to scroll past on the way to a descent.
    showOverlay(
      "The Burning Vigil", html, `Descend into ${sel.name}`, () => startCity(sel),
      `The reliquary · ${l.frescoesFound.length}/${FRESCOES.length}`, () => showReliquary(sel.id),
    );
    // The establishing image fails silently when its art isn't shipped offline.
    const img = ovBody.querySelector<HTMLImageElement>(".city-art");
    if (img) img.onerror = () => { img.style.display = "none"; };
    // Picking a city re-renders the card so its art and highlight follow the
    // selection; the descent begins from the primary button.
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
        if (act === "unlock") { unlockType(id); equipType(id); }
        else if (act === "equip") equipType(id);
        showPicker(); // re-render so the new ownership/equip state shows
      };
    });
  }

  // The reliquary — its own view, reached from the picker's secondary button.
  // The whole collection grouped by city; tapping an uncovered fresco re-shows
  // its painted card (the same in-descent reveal). `backTo` keeps the city the
  // carrier had selected so the picker returns where they left it.
  function showReliquary(backTo?: string): void {
    s = null; running = false;
    mmEl.style.display = "none";
    const l = loadPgLegacy();
    const body =
      `<p class="lede">The painted fragments the watch whitewashed over, uncovered ` +
      `as you walk the cities in the flesh. Each city hides its own set — collect ` +
      `one entire and it banks an ember bounty. Tap any you've found to read it again.</p>` +
      frescoGalleryHtml(l.frescoesFound);
    showOverlay(
      "The Reliquary", body, "Back to the cities", () => showPicker(backTo),
      "Share as PNG", () => { void shareReliquary(l.frescoesFound); },
    );
    // The img already shipped/cached; onerror hides a missing tile (no broken image).
    overlay.querySelectorAll<HTMLButtonElement>(".frx[data-frx]").forEach((b) => {
      const i = Number(b.dataset.frx);
      b.onclick = () => { if (i >= 0 && i < FRESCOES.length) showFresco(i, backTo); };
      const img = b.querySelector<HTMLImageElement>(".frx-img");
      if (img) img.onerror = () => { img.style.display = "none"; };
    });
  }

  // A single fresco, full size — the home for its own "share as PNG". Reached by
  // tapping a tile in the reliquary; "Back" returns there (keeping `backTo`).
  function showFresco(i: number, backTo?: string): void {
    s = null; running = false;
    const art = FRESCO_ART[i];
    const city = LEVELS.find((lv) => lv.frescoes && lv.frescoes.includes(i));
    const where = city ? `<p class="frx-where">Uncovered in <em>${city.name}</em></p>` : "";
    const body =
      (art ? `<img class="frx-full" src="${art}" alt="">` : "") +
      `<p class="frx-quote">“${FRESCOES[i]}”</p>` + where;
    showOverlay(
      "A fresco", body, "Back", () => showReliquary(backTo),
      "Share as PNG", () => { void shareFresco(i); },
    );
    const img = ovBody.querySelector<HTMLImageElement>(".frx-full");
    if (img) img.onerror = () => { img.style.display = "none"; };
  }

  // ---------- Share as PNG ----------
  // Render a share card to a canvas and hand it to the native share sheet when
  // it accepts files (mobile PWAs); otherwise fall back to a plain download.
  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function shareCanvas(canvas: HTMLCanvasElement, filename: string, title: string): Promise<void> {
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob) { showToast("Could not render the image."); return; }
    const nav = navigator as Navigator & {
      canShare?: (d: unknown) => boolean; share?: (d: unknown) => Promise<void>;
    };
    const file = new File([blob], filename, { type: "image/png" });
    if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
      try { await nav.share({ files: [file], title }); return; }
      catch (e) { if ((e as { name?: string }).name === "AbortError") return; } // cancelled
      // share rejected for another reason — fall through to download
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // Wrap `text` to `maxW` px (the canvas font must already be set).
  function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const w of text.split(" ")) {
      const next = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = w; }
      else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  const SHARE_BG = "#0b0a10", SHARE_INK = "#f1e6cf", SHARE_DIM = "#b9a98a", SHARE_GOLD = "#e8b34b";

  async function shareFresco(i: number): Promise<void> {
    showToast("Preparing image…");
    const cw = 1080, ch = 1350, sq = cw; // painted square on top, caption below
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = SHARE_BG; ctx.fillRect(0, 0, cw, ch);
    try {
      const img = await loadImage(FRESCO_ART[i]);
      const scale = Math.max(sq / img.width, sq / img.height);
      const dw = img.width * scale, dh = img.height * scale;
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, sq, sq); ctx.clip();
      ctx.drawImage(img, (sq - dw) / 2, (sq - dh) / 2, dw, dh);
      ctx.restore();
    } catch { /* no art shipped — leave the dark panel */ }
    const grad = ctx.createLinearGradient(0, sq - 220, 0, ch);
    grad.addColorStop(0, "rgba(11,10,16,0)"); grad.addColorStop(1, SHARE_BG);
    ctx.fillStyle = grad; ctx.fillRect(0, sq - 220, cw, ch - (sq - 220));
    ctx.textAlign = "center";
    ctx.fillStyle = SHARE_INK; ctx.font = "italic 46px Georgia, serif";
    const lines = wrapLines(ctx, `“${FRESCOES[i]}”`, cw - 160);
    let y = sq + 70;
    for (const ln of lines) { ctx.fillText(ln, cw / 2, y); y += 62; }
    ctx.fillStyle = SHARE_GOLD; ctx.font = "600 26px Georgia, serif";
    ctx.fillText("✦  THE BURNING VIGIL · RELIQUARY", cw / 2, ch - 56);
    await shareCanvas(c, `fresco-${i}.png`, "A fresco from The Burning Vigil");
  }

  async function shareReliquary(found: number[]): Promise<void> {
    showToast("Preparing image…");
    const got = new Set(found);
    const cw = 1080, pad = 60, cols = 4, gap = 18;
    const cell = Math.floor((cw - pad * 2 - gap * (cols - 1)) / cols);
    const rows = Math.ceil(FRESCOES.length / cols);
    const top = 210, bottom = 110;
    const ch = top + rows * cell + (rows - 1) * gap + bottom;
    const c = document.createElement("canvas"); c.width = cw; c.height = ch;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = SHARE_BG; ctx.fillRect(0, 0, cw, ch);
    ctx.textAlign = "center";
    ctx.fillStyle = SHARE_INK; ctx.font = "600 64px Georgia, serif";
    ctx.fillText("The Reliquary", cw / 2, 96);
    ctx.fillStyle = SHARE_GOLD; ctx.font = "500 34px Georgia, serif";
    ctx.fillText(`${got.size} / ${FRESCOES.length} frescoes uncovered`, cw / 2, 152);
    const imgs = await Promise.all(FRESCOES.map((_, i) =>
      got.has(i) ? loadImage(FRESCO_ART[i]).catch(() => null) : Promise.resolve(null)));
    for (let i = 0; i < FRESCOES.length; i++) {
      const x = pad + (i % cols) * (cell + gap), y = top + Math.floor(i / cols) * (cell + gap);
      const img = imgs[i];
      if (got.has(i) && img) {
        const scale = Math.max(cell / img.width, cell / img.height);
        const dw = img.width * scale, dh = img.height * scale;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, cell, cell); ctx.clip();
        ctx.drawImage(img, x + (cell - dw) / 2, y + (cell - dh) / 2, dw, dh);
        ctx.restore();
        ctx.strokeStyle = "rgba(232,179,75,0.5)"; ctx.lineWidth = 2;
        ctx.strokeRect(x, y, cell, cell);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fillRect(x, y, cell, cell);
        ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
        ctx.setLineDash([6, 6]); ctx.strokeRect(x + 1, y + 1, cell - 2, cell - 2); ctx.setLineDash([]);
        ctx.fillStyle = SHARE_DIM; ctx.font = "italic 30px Georgia, serif";
        ctx.fillText("?", x + cell / 2, y + cell / 2 + 10);
      }
    }
    ctx.fillStyle = SHARE_GOLD; ctx.font = "600 26px Georgia, serif";
    ctx.fillText("✦  THE BURNING VIGIL", cw / 2, ch - 50);
    await shareCanvas(c, "reliquary.png", "My reliquary — The Burning Vigil");
  }

  // ---------- Start screen + sharing the game ----------
  // The deployed page, sans any query/hash — what we hand out to others.
  function gameUrl(): string { return location.origin + location.pathname; }

  // The title screen: logo, a random fresco for art, and ways to share the game.
  // "Enter the Vigil" drops into the city picker.
  function showStart(): void {
    s = null; running = false;
    mmEl.style.display = "none";
    const lg = loadPgLegacy();
    // A random fresco for the title art — prefer ones the carrier has uncovered
    // (so it teases the reliquary), else any from the pool.
    const pool = lg.frescoesFound.length ? lg.frescoesFound : FRESCOES.map((_, i) => i);
    const fi = pool[Math.floor(Math.random() * pool.length)];
    const art = FRESCO_ART[fi];
    const body =
      `<img class="start-logo" src="./icons/icon-512.png" alt="The Burning Vigil">` +
      (art
        ? `<figure class="start-fresco"><img src="${art}" alt=""><figcaption>“${FRESCOES[fi]}”</figcaption></figure>`
        : `<p class="frx-quote">“${FRESCOES[fi]}”</p>`) +
      `<div class="start-share">` +
      `<button class="start-act" data-act="link">Share game link</button>` +
      `<button class="start-act" data-act="qr">Show QR code</button></div>`;
    showOverlay("The Burning Vigil", body, "Enter the Vigil", () => showPicker());
    ovBtn2.style.display = "none";
    ovBody.querySelectorAll<HTMLImageElement>("img").forEach((im) => {
      im.onerror = () => { im.style.display = "none"; }; // silent fallback, no broken image
    });
    ovBody.querySelectorAll<HTMLButtonElement>(".start-act").forEach((b) => {
      b.onclick = () => { if (b.dataset.act === "link") void shareGameLink(); else showQR(); };
    });
  }

  async function shareGameLink(): Promise<void> {
    const url = gameUrl();
    const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "The Burning Vigil", text: "Carry the flame through the dark city.", url }); return; }
      catch (e) { if ((e as { name?: string }).name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); showToast("Game link copied to the clipboard."); }
    catch { showToast(url); }
  }

  // The QR view: a scannable code to the game, generated offline. "Share QR
  // image" hands the rendered canvas to the share sheet / a download.
  function showQR(): void {
    const url = gameUrl();
    const q = qrEncode(url);
    const body =
      `<p class="lede">Point a phone camera here to open The Burning Vigil.</p>` +
      (q ? `<canvas id="qr-canvas" class="qr-canvas" aria-label="QR code linking to the game"></canvas>`
         : `<p class="frx-quote">This address is too long to encode as a QR.</p>`) +
      `<p class="qr-url">${url}</p>`;
    if (q) {
      showOverlay("Share the Vigil", body, "Back", () => showStart(),
        "Share QR image", () => { void shareCanvas(byId("qr-canvas") as HTMLCanvasElement, "burning-vigil-qr.png", "The Burning Vigil"); });
      drawQR(byId("qr-canvas") as HTMLCanvasElement, q);
    } else {
      showOverlay("Share the Vigil", body, "Back", () => showStart());
    }
  }

  // Paint a QR matrix onto a canvas with a 4-module quiet zone (dark on a light
  // parchment so a camera reads it cleanly).
  function drawQR(canvas: HTMLCanvasElement, q: QrResult): void {
    const quiet = 4, scale = 8, n = q.size + quiet * 2, px = n * scale;
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f1e6cf"; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#0b0a10";
    for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++)
      if (q.modules[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
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
// Mirrors app.ts: a headless harness sets __PG_TEST__ and reads the sim off
// __pg instead of the shell ever starting.
const testGlobal = globalThis as unknown as {
  __PG_TEST__?: boolean;
  __pg?: Record<string, unknown>;
};
if (typeof globalThis !== "undefined" && testGlobal.__PG_TEST__) {
  testGlobal.__pg = {
    generateCity, buildArena, freshPg, stepCombat, stepShades, stepBolts, stepPentagram,
    stepVeils, inVeil, stepMotes, killShade, weaveVeils,
    kindleDwelling, snuffDwelling, stepSpread, stepDwellings, stepPress,
    nearScar, inShrineAura, litReadout,
    startBoss, stepBoss, submitTrace, evalTrace, cycleSel, keyBind,
    bossBiteInterval, makeBossVeils, strokeVeiled, nextUnbound,
    pentagramSegments, traceScore,
    makeSeal, sealSegments, edgeSegment, nearestNode, hashSeed,
    render, scaffold,
    aliveShades, clearedPct, scoreRun, difficultyMult, LEVELS, levelById,
    weaveSegments, closestOnSegment, maybeFresco, FRESCOES, FRESCO_ART, FRESCO_REACH,
    recordFrescoes, frescoGalleryHtml, savePgLegacy,
    qrEncode, qrEcc, qrMul, qrMaskBit, QR_EXP,
    loadPgLegacy, recordClear, recordDeath, emptyPgLegacy, unlockType, equipType,
    PENTA_TYPES, pentaTypeById,
    K: {
      W, H, HERO_HP, HERO_RADIUS, HERO_STILL_MAXSPEED, HERO_IFRAMES_MS, HERO_SPEED,
      PENTA_RADIUS, PENTA_PULSE_MS, PENTA_DMG, PENTA_CHARGE_MS,
      SHADE_HP, SHADE_RADIUS, SHADE_CONTACT_DMG, SHADE_PER_KEEPER,
      AGGRO_RADIUS, SHADE_WANDER_SPEED, SHADE_LEASH,
      OBSTACLE_RADIUS, DWELLING_HEAL, HEAL_CAP, FENCE_HALF, PATHWAY_HALF, PATHWAY_BOOST,
      DWELLING_AWAKEN_MS, AWAKENED_RADIUS, AWAKENED_DMG, SNUFF_REACH, SNUFF_VEIL_MS, SCAR_RADIUS,
      CONDUIT_REACH, CONDUIT_DELAY, CONDUIT_HEAL, CONDUIT_MAX_LINKS,
      PRESS_TRIGGER_REACH, PRESS_BURST_R, PRESS_BURST_DMG, SHRINE_AURA,
      SCORCH_RADIUS, SCORCH_MAX, FRESCO_SET_BONUS,
      ELITE_HP_MUL, ELITE_CONTACT_DMG,
      SPITTER_HP, SPITTER_STANDOFF, SPITTER_SPEED_MUL, SPITTER_RANGE, SPITTER_COOLDOWN_MS,
      BOLT_SPEED, BOLT_DMG, BOLT_RADIUS, BOLT_LIFETIME_MS,
      DARTER_HP, DARTER_SPEED_MUL,
      VEIL_RADIUS, VEIL_DRIFT, VEIL_DRAIN_MUL,
      MOTE_DROP_CHANCE, MOTE_TTL_MS, MOTE_RADIUS, MOTE_SURGE_MS, MOTE_SURGE_DMG,
      BOSS_RING_R, BOSS_HP, BOSS_BITE_MS, BOSS_BITE_DMG, BOSS_BITE_RAMP, BOSS_KEY_COST,
      BOSS_VEILS_BASE, BOSS_VEILS_DIFF, BOSS_VEIL_R, BOSS_VEIL_DRIFT, BOSS_VEIL_UNRAVEL,
      TRACE_TOL_FRAC, TRACE_MIN_POINTS, TRACE_FLASH_MS,
      SEAL_RING_FRAC, SEAL_NODES_MIN, SEAL_NODES_SPAN, SEAL_DIFF_NODES, SEAL_SNAP_FRAC, SEAL_EDGE_DONE,
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
