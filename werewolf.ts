// The Moon's Hunger — a fifth action-combat spinoff of The Light-Bringer, set in a
// misty, fog-bound 13th-century Britain of thatch villages and standing stones.
//
// Where the lightbringer's spinoffs carry FLAME (the Vigil), DEATH (the
// Necromancer's March), or a SIGN (the Watcher), here you carry the CURSE. You walk
// a cursed soul through a sleeping village; when the moon swells you turn BEAST and
// the maw you trace under moonlight RENDS the watch that hunts you. Cut down the
// finite host of the village and the hunt is yours; lose your blood and you fall.
//
// The defining twist is the MOON — a living day/night wheel nothing else in this
// repo has. You begin a HUMAN: frail, unable to fight, hunted. Standing still bays
// at the moon and stokes your FURY; under MOONLIGHT it swells fast, by DAYLIGHT it
// crawls. When fury crests you TRANSFORM into the wolf — fast, and the only form
// that can attack. As the wolf, standing still inscribes a blood-moon maw that rends
// the host around you; but the change costs fury, and daylight bleeds it, so you
// must feed (kill) to stay the beast. Night is your hour; by day you are prey.
//
// This file is a self-contained TS MODULE (it ends with `export {};`) so its
// top-level names (W, render, start, LEVELS, …) are module-scoped and never collide
// with app.ts (a classic global script) or its siblings pentagram.ts / necro.ts /
// eldritch.ts. The page loads it with <script type="module">; the test loads it via
// dynamic import(). The simulation is pure and headless (WwState in, mutation out);
// the render pass only reads it — the split that lets the sibling tests drive the
// others lets werewolf-test.mjs drive this. Sections below:
//   Types -> Tuning -> Pelts -> Villages -> Arena generation -> Hunt sim ->
//   Sprites -> Render -> Game shell -> Legacy -> SW + test seam.

// ---------- Types ----------

// GREENS (the village gathering-grounds the watch musters from) are a placement
// role, NOT a node kind — so the kinds are the pure built fabric of the place.
type NodeKind =
  | "field" | "stone" | "cottage" | "cairn" | "moonwell"
  // New obstacles (solid, body-blocking — see OBSTACLE_KINDS):
  | "pyre"     // a great funeral pyre: a solid, ever-burning hazard to the watch
  | "dolmen"   // a broad capstone dolmen: broad solid cover
  | "gibbet"   // a gallows-post: medium solid cover
  | "cart"     // an abandoned wain: small solid cover
  // New terrain (passable zones/emitters/pickups, woven off the node geometry):
  | "wisp"      // a corpse-candle: a passable hazard that burns the watch in its aura
  | "marshfire" // burning marsh-gas ground: scorches the watch that crosses it
  | "bog"       // boggy ground: slows every body (hero and watch)
  | "bramble"   // briar-choked ground: slows only the watch
  | "glade"     // a moonlit glade: trace the maw even while loping (the moonwell's gift, smaller)
  | "spring"    // a clear spring: slowly mends the hero in its aura
  | "geyser"    // a hot spring: erupts a scalding burst on its own cadence
  | "gale"      // a moor-wind: shoves the watch away (the hero, anchored, is unmoved)
  | "wolfsbane" // a patch of the bane-herb: bleeds the hero's fury while he stands in it
  | "hoard";    // a barrow-hoard: first-footing it stokes the curse, once
type Phase = "hunt" | "won" | "lost";

// A foe lurks near its green until the wolf (or a marked cairn) draws it, then hunts.
// Aggro is sticky once roused — the mirror of the sibling games' enemy AI.
type FoeState = "lurk" | "hunt";

// The five kinds of the watch. Most are melee; the huntsman and friar are the
// standoff specialists (the huntsman looses silver bolts, the friar drains the curse).
type FoeKind = "villager" | "hound" | "knight" | "huntsman" | "friar";

// The cursed soul wears one of two shapes. HUMAN cannot fight (only flee and stoke
// fury); WOLF is the weapon. The moon drives the change.
type HeroForm = "human" | "wolf";

// A built node. A CAIRN can be marked (`lit`) by the wolf's maw — its aura grants
// fury and rends the host; a foe brushing a marked cairn CLEANSES it (dark again,
// and a scar bars re-marking for a while — the inversion the sibling games share).
interface ArenaNode {
  x: number; y: number; kind: NodeKind;
  lit?: boolean;      // a cairn marked by the wolf (an ally emitter)
  litAt?: number;     // s.elapsed when it was marked (for the bloom flourish)
  cleansed?: number;  // s.elapsed a cleansed cairn's scar bars re-marking to (0/undef = clean)
  spent?: boolean;    // a barrow-hoard the hero has already cracked open
  geyserAt?: number;  // a geyser's next eruption time (s.elapsed); lazily seeded
}

// A line segment. Walls — hedgerows & palisades — block bodies (capsule collision)
// and break a huntsman's line of sight; paths — the village lanes — speed the hero.
interface Segment { x1: number; y1: number; x2: number; y2: number }

// The cursed soul.
interface Hero {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  fury: number; maxFury: number; // the curse-meter; crest it to turn beast
  form: HeroForm;                // human (cannot attack) or wolf (the weapon)
  hurt: number;       // remaining i-frame ms after a blow (0 = vulnerable)
  charge: number;     // 0..1 — how fully the maw is traced (ramps while still)
  overcharge: number; // 0..1 — banked past a full trace (hold longer); empowers the next pulse
  mawCd: number;      // ms until the traced maw pulses again (cadence)
  angle: number;      // the blood-moon sigil's slow cosmetic spin, in degrees
  transformAt: number; // s.elapsed of the last change (for the transform flourish)
}

// A member of the village watch.
interface Foe {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  dead: boolean;
  state: FoeState;
  variant: FoeKind;
  wanderAngle: number;
  homeX: number; homeY: number; // its green anchor (the lurk leash centre)
  attackCd: number;             // ms until it can strike again
  shootCd: number;              // ms until a huntsman can loose another bolt
  hit: number;                  // s.elapsed until which it flashes from a fresh blow
  bornAt: number;               // s.elapsed it mustered (for the rise flourish)
  aiming?: boolean;             // transient (per-frame): a huntsman loosing a bolt this frame
  channeling?: boolean;         // transient (per-frame): a friar draining the curse this frame
  beamX?: number; beamY?: number; // transient: the friar's beam endpoint (the hero)
}

// FX & projectiles. A Pulse is the maw's rending ring; a Bolt is a huntsman's silver
// arrow; a Mote is the hot blood a felled foe leaves (gather it to stoke the curse);
// Mist is a drifting fog bank (the wolf's cover). All live-play, never persisted.
interface Pulse { x: number; y: number; r: number; until: number }
interface Bolt { x: number; y: number; vx: number; vy: number; dead: boolean; bornAt: number }
interface Mote { x: number; y: number; until: number }
interface Mist { x: number; y: number; r: number; vx: number; vy: number }

interface WwState {
  level: LevelDef;
  w: number; h: number;
  scenery: ArenaNode[];
  solids: ArenaNode[];    // scenery the bodies can't pass (stones & cottages)
  cairns: ArenaNode[];    // cached cairns (the mark sites)
  moonwells: ArenaNode[]; // cached moonwells (always-moonlit pools)
  walls: Segment[];       // hedgerows the bodies weave around (and break a bolt's flight)
  paths: Segment[];       // village lanes the hero runs swift along
  hero: Hero;             // the cursed soul
  pelt: PeltType;         // the equipped pelt (resolved from the legacy at build)
  foes: Foe[];
  bolts: Bolt[];          // huntsmen's silver arrows in flight
  pulses: Pulse[];        // fading rending rings (cosmetic)
  motes: Mote[];          // gatherable blood-motes dropped by the felled
  mists: Mist[];          // drifting fog banks (the wolf's cover from the watch)
  moon: number;           // 0..1 — the day/night wheel (0/1 = noon, 0.5 = midnight)
  elapsed: number;        // ms since the hunt began (clear time)
  slain: number;          // foes cut down
  hits: number;           // times the watch has landed a blow on the hero
  total: number;          // the finite host: cut them all down to win
  cairnsTotal: number;    // cairns the place began with
  litCount: number;       // cairns marked right now (secondary objective)
  cleansedCount: number;  // cairns the watch has cleansed this hunt
  phase: Phase;
}

interface Move { x: number; y: number } // normalized input vector, -1..1 each

// ---------- Tuning ----------
// The design surface. Balance changes should be constant changes here, the same
// ethos as the sibling games' tuning blocks.

const W = 1500;
const H = 2000;

// The cursed soul. Speed depends on the shape — the wolf is the swifter body.
const HERO_SPEED_HUMAN = 248;    // human travel, world units per second
const HERO_SPEED_WOLF = 304;     // wolf travel — the beast runs faster
const HERO_RADIUS = 16;
const HERO_HP = 100;
const HERO_IFRAMES_MS = 700;     // grace after a blow, no further damage
const HERO_KNOCKBACK = 56;       // units the hero is shoved back by a blow

// The maw — the wolf's weapon and the gate on every rending. Standing still TRACES
// it (charge ramps to 1); moving lets it fade (you dodge). It pulses only once
// sufficiently traced AND only while a WOLF (stepMaw gates on both) — a rending is a
// deliberate stand by the beast, the stand-still verb the Vigil pioneered turned to
// the curse. Each pulse spends a little fury, so a wolf must feed (kill) to hold.
const HERO_STILL_MAXSPEED = 40;  // travel slower than this (units/s) to trace
const CHARGE_MS = 440;           // time stationary to fully trace the maw (and to fade)
const MAW_BITE_AT = 0.6;         // the maw rends once at least this traced
const MAW_RADIUS = 132;          // the rending reach around the wolf
const MAW_PULSE_MS = 520;        // ms between rending pulses while the maw holds
const MAW_DMG = 17;              // damage a pulse deals to every foe in reach
const MAW_FURY_COST = 0.015;     // fury each rending spends (feed to outpace it)
const SIGIL_SPIN = 0.05;         // degrees of blood-moon rotation per ms (cosmetic)
const PULSE_FX_MS = 360;         // how long a rending ring lingers

// Overcharge — the risk/reward on the core verb (mirror of the siblings). Hold still
// PAST a full trace and an overcharge banks (0→1 over OVERCHARGE_MS); any movement
// spends it back to nothing. When the next pulse fires with a full overcharge it is
// EMPOWERED: a wider ring that TERRIFIES the host (flings it back) AND stokes the
// curse (restores fury), then resets. Hold the stand longer — more power, more peril.
const OVERCHARGE_MS = 720;       // time past a full trace to bank one overcharge
const OVERCHARGE_RADIUS_MUL = 1.7; // an empowered pulse's reach × the maw's reach
const OVERCHARGE_FURY = 0.25;    // fury an empowered pulse restores
const TERROR_KNOCK = 64;         // units an empowered (or Black-pelt) pulse flings the host

// THE MOON — the day/night wheel, and the soul of this spinoff. It drives the FURY,
// and fury drives the SHAPE. By moonlight fury swells; by daylight it crawls (human)
// or bleeds (wolf). daylight(moon): 1 at noon (moon 0/1), 0 at midnight (moon 0.5).
const MOON_CYCLE_MS = 60000;     // a full day-night wheel (one "night" comes ~every 30s)
const MOON_START = 0.35;         // begin near dusk — night, and the beast, come soon
const FURY_RISE_MS = 4200;       // human → full fury, standing under a full moon
const FURY_DRAIN_MS = 9000;      // wolf fury drain at base (daylight bleeds it faster)
const FURY_PER_KILL = 0.14;      // fury a kill feeds the beast (sustains the change)

// Blood-motes — a felled foe may leave hot blood; gathering it (walk over it) STOKES
// the curse. The fury economy's heartbeat (mirror of the Vigil's ember surge).
const MOTE_DROP_CHANCE = 0.42;   // fraction of kills that leave a blood-mote
const MOTE_TTL_MS = 7000;        // how long a blood-mote waits to be gathered
const MOTE_RADIUS = 18;          // gather reach (over and above the hero's radius)
const MOTE_FURY = 0.18;          // fury a gathered blood-mote stokes

const HIT_FLASH_MS = 150;        // how long a body flashes from a fresh blow

// ---------- Pelts (unlockable wolf-form variants) ----------
// Each pelt is a different beast with its own maw dials and a passive POWER, mirror
// of the Vigil's PentaPower and the siblings' powers. "none" is a plain stat-lean;
// "frenzy" arcs a kill's bloodlust to a nearby foe; "moonblood" stokes the curse on
// each kill (the fury pelt); "terror" flings the host back on every pulse. Powers
// fire automatically — the only choice is which pelt to don.
type PeltPower = "none" | "frenzy" | "moonblood" | "terror";

interface PeltType {
  id: string; name: string; desc: string; cost: number;
  radiusMul: number;  // rending reach  × MAW_RADIUS
  chargeMul: number;  // trace time     × CHARGE_MS (a slower beast)
  pulseMul: number;   // pulse cadence  × MAW_PULSE_MS
  dmgMul: number;     // pulse damage   × MAW_DMG
  power: PeltPower;   // the pelt's passive behaviour
  ring: string;       // the rending ring's signature hue
  star: string;       // the blood-moon sigil's stroke hue
}

const PELT_TYPES: PeltType[] = [
  {
    id: "grey", name: "The Grey Pelt", cost: 0,
    desc: "The common curse, even of tooth and reach. The beast you first became.",
    radiusMul: 1, chargeMul: 1, pulseMul: 1, dmgMul: 1, power: "none",
    ring: "#cdd6e6", star: "#f2f5ff",
  },
  {
    id: "dire", name: "The Dire Pelt", cost: 120,
    desc: "A great old wolf — wider, slower, harder-biting. A kill's frenzy leaps to the next throat near.",
    radiusMul: 1.32, chargeMul: 1.2, pulseMul: 1.28, dmgMul: 1.5, power: "frenzy",
    ring: "#e0b070", star: "#ffe6b0",
  },
  {
    id: "fell", name: "The Fell Pelt", cost: 160,
    desc: "A lean, quick runner — tight fast rends, and every kill swells the curse anew.",
    radiusMul: 0.84, chargeMul: 0.72, pulseMul: 0.66, dmgMul: 0.78, power: "moonblood",
    ring: "#9bd8ff", star: "#d8f0ff",
  },
  {
    id: "black", name: "The Black Pelt", cost: 240,
    desc: "The moon-touched beast — every rending erupts and scatters the watch in terror.",
    radiusMul: 1.12, chargeMul: 1.12, pulseMul: 1.0, dmgMul: 1.15, power: "terror",
    ring: "#b06aff", star: "#e6c0ff",
  },
];

function peltTypeById(id: string): PeltType {
  return PELT_TYPES.find((t) => t.id === id) || PELT_TYPES[0];
}

// ---------- The watch (per-variant tuning) ----------
// Most of the watch are villagers; the rest are seeded among them per place. Each
// block is the design surface for that kind.

// The villager — the common body of the watch. By night, or when the beast is near,
// they grab pitchfork and brand and close to strike; the maw's bread-and-butter.
const FOE_HP = 30;
const FOE_SPEED = 96;            // travel, units/s
const FOE_RADIUS = 14;
const FOE_CONTACT = 9;           // damage a strike deals to the hero
const FOE_ATTACK_CD = 740;       // ms between a foe's strikes
const FOE_ATTACK_REACH = 16;     // within this (+radii) of the hero it can strike
const FOE_SEP = 26;              // foes push apart within this (so they swarm, not stack)
const FOE_AGGRO = 380;           // a lurking foe within this of the hero rouses to hunt
const FOE_WANDER_SPEED = 32;     // idle drift while lurking, units/s
const FOE_LEASH = 240;           // a lurker steers home if it drifts past this from its green
const FOE_PER_GREEN = 4;         // villagers each green musters (the host gate)
const CLEANUP_AGGRO_FRAC = 0.2;  // once this few remain, all rouse so a hunt always ends
const RISE_MS = 600;             // a freshly-mustered foe's rise flourish (cosmetic)

// As a HUMAN — or hidden in MIST — the cursed soul reads as one of their own; the
// watch is slower to rouse. As the WOLF, they know you at once.
const STEALTH_AGGRO_MUL = 0.5;   // aggro range × this when the hero is human or in mist

// Hound — fast, frail beast the houndsmen loose; closes before the maw ramps.
const HOUND_HP_MUL = 0.55;       // a hound's hp × a villager's
const HOUND_SPEED_MUL = 1.7;     // …its travel speed ×
const HOUND_CONTACT = 7;         // …its bite damage

// Knight (man-at-arms) — slow, plated, heavy. Forces the wolf to hold the maw.
const KNIGHT_HP_MUL = 3.2;       // a knight's hp × a villager's
const KNIGHT_SPEED_MUL = 0.66;   // …its travel speed ×
const KNIGHT_CONTACT = 18;       // …its blow (a heavy one)

// Huntsman — the watch's ranged arm and the watch's ONLY projectile. It never melees:
// it holds a standoff and looses DODGEABLE silver bolts with line of sight. A wall
// stops a bolt (and makes it hold fire); MIST hides the hero from it. Punishes the
// stand-still trace — the counters are cover, mist, and movement. Frail.
const HUNTSMAN_HP_MUL = 1.1;     // a huntsman's hp × a villager's (frail backline)
const HUNTSMAN_SPEED_MUL = 0.9;  // …its travel speed ×
const HUNTSMAN_RANGE = 320;      // it looses at a hero within this (with line of sight)
const HUNTSMAN_STANDOFF = 200;   // it backs from a hero closer than this (kiting)
const HUNTSMAN_SHOOT_CD = 1500;  // ms between bolts
const BOLT_SPEED = 330;          // a silver bolt's travel, units/s
const BOLT_DMG = 11;             // damage a bolt deals on a hit
const BOLT_TTL_MS = 2600;        // a bolt's life before it falls spent
const BOLT_RADIUS = 7;           // a bolt's hit radius

// Friar — the watch's holy ward against the curse. It never melees: it holds back
// and channels CONSECRATION at a hero in range with line of sight, BLEEDING the fury
// that holds the beast (it can force you back to a man). Counters: break sight behind
// a wall, hide in mist, or close and rend it. Frail.
const FRIAR_HP_MUL = 1.2;        // a friar's hp × a villager's
const FRIAR_SPEED_MUL = 0.85;    // …its travel speed ×
const FRIAR_RANGE = 260;         // it consecrates a hero within this (with line of sight)
const FRIAR_STANDOFF = 190;      // it kites from a hero closer than this
const FRIAR_FURY_DRAIN = 0.22;   // fury/sec a clear consecration bleeds

// Frenzy (the Dire pelt's power) — a kill's bloodlust leaps to the nearest other foe.
const FRENZY_RANGE = 150;        // the leap reaches this far from the felled foe
const FRENZY_DMG = 14;           // damage the leap deals
// Moonblood (the Fell pelt's power) — each kill stokes the curse this much.
const MOONBLOOD_FURY = 0.12;

// Stones & cottages — the place's solids; bodies weave around them. Fields and cairns
// and moonwells are passable (you pass the first, mark the cairn, wade the well).
const OBSTACLE_KINDS = new Set<NodeKind>([
  "stone", "cottage",
  // The new solids: a pyre, a dolmen, a gibbet, an abandoned cart. Like every
  // obstacle they block bodies (pushOut); the pyre also burns the watch (stepFields).
  "pyre", "dolmen", "gibbet", "cart",
]);
const OBSTACLE_RADIUS: Partial<Record<NodeKind, number>> = {
  stone: 24, cottage: 30,
  pyre: 26, dolmen: 30, gibbet: 18, cart: 16,
};

// Walls — hedgerows & palisades strung between neighbours. They block movement (a
// capsule: the segment plus this half-thickness) for every body, AND stop a
// huntsman's bolt and break its line of sight — the wolf weaves them as cover.
const WALL_HALF = 8;             // half-thickness of a wall (collision)
const WALL_VIS_THICK = 24;       // drawn thickness of the wall

// Paths — the village lanes the hero runs swift along.
const PATH_HALF = 30;            // half-width of a lane
const PATH_BOOST = 1.4;          // hero speed multiplier while on a lane

// Moonwells — pale pools where the moon always reaches. The hero's fury swells (and
// the maw traces) at the NIGHT rate within their aura, whatever the hour — a refuge
// of the moon, and the wolf's foothold against the day. Live-play, never persisted.
const MOONWELL_AURA = 150;       // a moonwell's radius of moonlight

// Mist — drifting fog banks (the misty Britain made mechanical, and the wolf's cover).
// Within a bank, a huntsman cannot see the hero (holds fire) and the watch is slower
// to rouse (STEALTH_AGGRO_MUL). Pure FX-like state, drifting in stepMists.
const MIST_DRIFT = 18;           // a fog bank's drift, units/s

// ---- New terrain & obstacles (the maps' expanded vocabulary) ----
// All below are pure functions of node geometry, woven at build and held on the
// scenery — live-play terrain, never persisted, in the cairns/mist ethos. Per-place
// counts are LevelDef dials, all defaulting to none so the four original villages
// are untouched. (Mist already exists — these are ten kinds new to the hunt.)

// Pyres — a great solid funeral pyre that never goes out. A permanent hazard: it
// burns every foe within its aura (stepFields), the way a marked cairn rends the
// host, but from the start and indestructible — a body-blocking pillar of fire.
const PYRE_AURA = 132;           // radius the pyre scorches the watch within
const PYRE_DPS = 24;             // damage/sec to a foe standing in the aura

// Corpse-candles (wisps) — a passable will-o'-the-wisp that lures and burns the
// watch in its aura. A weaker pyre that is NOT solid (the hero wades it).
const WISP_AURA = 92;            // radius the candle burns the watch within
const WISP_DPS = 13;             // damage/sec to a foe in the aura

// Marsh-fire — burning marsh-gas underfoot. Passable for the hero, but it scorches
// any foe that crosses it: a pre-placed snare to herd the watch across.
const MARSHFIRE_AURA = 102;      // radius of the burning ground
const MARSHFIRE_DPS = 18;        // damage/sec to a foe on it

// Bog — boggy, sucking ground. Slows every body inside (hero AND watch): a neutral
// mire that bogs a chase and pins a careless hero alike.
const BOG_AURA = 118;            // radius of the slowing bog
const BOG_SLOW = 0.55;           // speed multiplier for any body in the bog

// Bramble — briar-choked thorns. Slows ONLY the watch (the lithe wolf slips
// through): a defensive snare to lead the host into.
const BRAMBLE_AURA = 114;        // radius of the snaring briars
const BRAMBLE_SLOW = 0.5;        // speed multiplier for a foe in the bramble

// Glades — small moonlit clearings. Within the aura the hero traces the maw EVEN
// WHILE LOPING (like a moonwell's gift, but only the moving-trace half), a place to
// keep the rending alive on the run.
const GLADE_AURA = 120;          // radius within which the hero traces while moving

// Springs — a clear, cold spring. Standing in the aura slowly mends the hero,
// gated by a cap so it tops you up but can't facetank the watch.
const SPRING_AURA = 110;         // radius of the spring's mending water
const SPRING_HEAL_DPS = 10;      // hero HP restored per second standing in it
const SPRING_HEAL_CAP = 0.6;     // …but only up to this fraction of maxHp

// Geysers — a scalding hot spring that erupts on its own cadence: a rhythmic burst
// that burns the watch in reach, charge-independent. A timed hazard to lure them on.
const GEYSER_CD = 2400;          // ms between a geyser's eruptions
const GEYSER_RADIUS = 128;       // the eruption's reach
const GEYSER_DMG = 28;           // damage to each foe caught in an eruption

// Gales — a hard moor-wind that shoves the watch out of its aura each frame (the
// hero, anchored by the curse, is unmoved): a repel field that opens a no-go lane.
const GALE_AURA = 136;           // radius of the gale's push
const GALE_PUSH = 58;            // units/s a foe is shoved outward while inside

// Wolfsbane — a patch of the bane-herb. While the hero stands in the aura it BLEEDS
// his fury (the curse-meter), threatening to tip a wolf back to a man — the hunt's
// one terrain hazard to the hero himself (the friar's drain, made ground).
const WOLFSBANE_AURA = 104;      // radius of the bane-patch
const WOLFSBANE_DRAIN = 0.16;    // fury/sec bled while standing in it

// Barrow-hoards — a grave-hoard the watch never found. The hero's body reaching one
// cracks it open for a surge of the curse (a fury jolt), then it is spent and inert.
const HOARD_REACH = 30;          // hero centre within this (+the hero radius) cracks it
const HOARD_FURY = 0.22;         // fury the curse surges when a hoard is cracked

// Cairns — marking one (with the maw, as a wolf) lights it: its aura GRANTS fury and
// RENDS the host that strays in. A foe brushing a marked cairn CLEANSES it (dark
// again, and a scar bars re-marking). All live-play, never persisted.
const CAIRN_MARK_REACH = 30;     // a cairn this close to the maw's reach is marked by a pulse
const CAIRN_MARK_FURY = 0.1;     // fury marking a cairn stokes
const CAIRN_AURA = 132;          // the marked cairn's aura radius
const CAIRN_FURY_PER_SEC = 0.12; // fury/sec the aura grants a hero within it
const CAIRN_DMG = 11;            // damage/sec the aura deals a foe within it (ally emitter)
const CLEANSE_REACH = 24;        // a foe this close to a marked cairn cleanses it
const CLEANSE_MS = 6000;         // a cleansed cairn's scar bars re-marking this long
const SCAR_RADIUS = 56;          // the scar's drawn reach

// Scoring — claiming the hunt banks a score. Tuned for relationships, not magnitudes:
// faster pays, a marked/unscathed hunt pays, and a harder place multiplies it all.
// (Score feeds MOONSTONES — the currency for the pelt shop.)
const SCORE_PER_KILL = 100;          // base, per foe in the host
const SCORE_TARGET_PER_KILL = 1500;  // ms per foe you're "expected" to take
const SCORE_SPEED_PER_SEC = 20;      // points per second cleared under that target
const SCORE_CAIRNS_MAX = 260;        // full points for a fully-marked place
const SCORE_SURVIVAL_MAX = 200;      // full points for full HP at the kill
const SCORE_UNTOUCHED = 240;         // flawless bonus (no blow landed all hunt)

// Moonstones — the cross-hunt unlock currency (the inversion of the Vigil's embers /
// the Watcher's lore). A hunt banks a share of its score; even a broken hunt leaves
// the moonstones of the foes you cut down, so progress never fully stalls.
const MOONSTONE_SCORE_DIV = 12;  // moonstones from a hunt = score ÷ this (min 1)
const MOONSTONE_PER_KILL = 1;    // moonstones a fall still leaves, per foe slain

const WW_LEGACY_KEY = "werewolf.legacy.v1";

// ---------- Villages (levels) ----------
// Hand-tuned 13th-century English villages, the same generation dials the sibling
// games use: how many nodes, how dense, how many stones/cottages/cairns/moonwells,
// and how many greens (each musters a wave of the watch — the host gate). A hunt has
// no flame to spend and no dawn to reach.
interface LevelDef {
  id: string;
  name: string;
  epigraph: string;
  art?: string;           // optional establishing image (art/village-*.jpg); silent-fail
  nodeCount: number;
  minDist: number;
  stoneCount: number;     // standing stones (solid, blocks bodies)
  cottageCount: number;   // thatch cottages (solid, blocks bodies)
  cairnCount: number;     // cairns — the mark sites (fury beacons)
  moonwellCount: number;  // moonwells — always-moonlit pools (fury refuges)
  greenCount: number;     // greens — each musters FOE_PER_GREEN villagers
  greenSpacing: number;
  wallCount: number;      // hedgerows woven between neighbours (cover + bolt-break)
  pathCount: number;      // lanes the hero runs swift along
  mistCount: number;      // drifting fog banks (the wolf's cover)
  houndCount?: number;    // greens whose second body is a fast hound (default 0)
  knightCount?: number;   // greens that muster an extra heavy knight (default 0)
  huntsmanCount?: number; // greens that muster an extra ranged huntsman (default 0)
  friarCount?: number;    // greens that muster an extra consecrating friar (default 0)
  // ---- New terrain & obstacle dials (the expanded maps' vocabulary) ----
  // Each carves that many nodes from the field pool (like stone/cottage counts), all
  // defaulting to 0 so the four original villages are untouched. The four solids
  // (pyre/dolmen/gibbet/cart) join s.solids automatically (OBSTACLE_KINDS).
  pyreCount?: number;     // great pyres — solid, ever-burning hazards to the watch
  dolmenCount?: number;   // capstone dolmens — broad solid cover
  gibbetCount?: number;   // gallows-posts — medium solid cover
  cartCount?: number;     // abandoned wains — small solid cover
  wispCount?: number;     // corpse-candles — passable burning hazards
  marshfireCount?: number;// burning marsh-gas — scorches the watch that crosses it
  bogCount?: number;      // boggy ground — slows every body
  brambleCount?: number;  // briars — slow only the watch
  gladeCount?: number;    // moonlit glades — trace the maw while loping
  springCount?: number;   // springs — slowly mend the hero
  geyserCount?: number;   // hot springs — erupt a scalding burst on a cadence
  galeCount?: number;     // moor-winds — shove the watch away
  wolfsbaneCount?: number;// bane-patches — bleed the hero's fury
  hoardCount?: number;    // barrow-hoards — first-footing surges the curse
  sizeScale?: number;     // arena size = W/H × this (default 1); leans the difficulty
}

const LEVELS: LevelDef[] = [
  {
    id: "thornwick",
    name: "Thornwick",
    epigraph: "A small thatched holt under a thin grey moon. The watch is few and slow to rouse. A fair first hunt.",
    art: "art/village-thornwick.jpg",
    nodeCount: 110, minDist: 72,
    stoneCount: 4, cottageCount: 7, cairnCount: 6, moonwellCount: 2,
    greenCount: 5, greenSpacing: 360,
    wallCount: 7, pathCount: 6, mistCount: 3, sizeScale: 0.9,
  },
  {
    id: "greymoor",
    name: "Greymoor",
    epigraph: "Bleak moorland of gorse and standing stones, where houndsmen course the fog and bowmen wait the ridge.",
    art: "art/village-greymoor.jpg",
    nodeCount: 122, minDist: 66,
    stoneCount: 8, cottageCount: 5, cairnCount: 7, moonwellCount: 2,
    greenCount: 7, greenSpacing: 320,
    wallCount: 6, pathCount: 9, mistCount: 4, houndCount: 3, huntsmanCount: 2, sizeScale: 1.0,
  },
  {
    id: "hollowby",
    name: "Hollowby",
    epigraph: "A walled market town under the abbey bell. Friars keep their relics, men-at-arms their wall, and the bowmen the gate.",
    art: "art/village-hollowby.jpg",
    nodeCount: 116, minDist: 70,
    stoneCount: 6, cottageCount: 10, cairnCount: 5, moonwellCount: 1,
    greenCount: 8, greenSpacing: 280,
    wallCount: 12, pathCount: 5, mistCount: 2,
    houndCount: 3, knightCount: 2, huntsmanCount: 3, friarCount: 2, sizeScale: 1.1,
  },
  {
    id: "wulfmere",
    name: "Wulfmere",
    epigraph: "A drowned fen-village of black water and willow, the moon dead overhead. Every soul of it hunts you, and they are many.",
    art: "art/village-wulfmere.jpg",
    nodeCount: 104, minDist: 84,
    stoneCount: 10, cottageCount: 4, cairnCount: 4, moonwellCount: 3,
    greenCount: 9, greenSpacing: 300,
    wallCount: 10, pathCount: 3, mistCount: 5,
    houndCount: 2, knightCount: 4, huntsmanCount: 4, friarCount: 2, sizeScale: 1.18,
  },
  // ---- The Outlands (the maps' expansion: four further hunts) ----
  // Villages beyond the dale, each carrying the expanded terrain vocabulary — burned
  // holts, sucking fens, wind-scoured heads, and the last hollow where the curse ends.
  {
    id: "ashthorn",
    name: "Ashthorn",
    epigraph: "A holt the fire took and never left. The pyres still burn — and the watch fears them more than you.",
    nodeCount: 140, minDist: 64,
    stoneCount: 4, cottageCount: 6, cairnCount: 6, moonwellCount: 2,
    greenCount: 6, greenSpacing: 330,
    wallCount: 6, pathCount: 6, mistCount: 3,
    pyreCount: 3, marshfireCount: 4, brambleCount: 4, gibbetCount: 3, wispCount: 2,
    houndCount: 3, huntsmanCount: 2, sizeScale: 1.0,
  },
  {
    id: "mirefen",
    name: "Mirefen",
    epigraph: "Black water and bane-herb under a drowned moon. The bog holds them; the wolfsbane bleeds you — find the springs.",
    nodeCount: 150, minDist: 62,
    stoneCount: 5, cottageCount: 4, cairnCount: 6, moonwellCount: 2,
    greenCount: 7, greenSpacing: 310,
    wallCount: 5, pathCount: 4, mistCount: 5,
    bogCount: 5, wolfsbaneCount: 4, springCount: 3, wispCount: 3, dolmenCount: 3,
    houndCount: 2, huntsmanCount: 3, friarCount: 2, sizeScale: 1.08,
  },
  {
    id: "galehead",
    name: "Galehead",
    epigraph: "A bare, wind-scoured headland where hot springs steam and the gale holds the watch off the open stone.",
    nodeCount: 145, minDist: 64,
    stoneCount: 6, cottageCount: 3, cairnCount: 5, moonwellCount: 2,
    greenCount: 8, greenSpacing: 295,
    wallCount: 4, pathCount: 6, mistCount: 3,
    galeCount: 5, gladeCount: 4, geyserCount: 3, cartCount: 5, hoardCount: 3,
    houndCount: 3, knightCount: 2, huntsmanCount: 2, sizeScale: 1.12,
  },
  {
    id: "direhollow",
    name: "Direhollow",
    epigraph: "The last hollow, where every soul of the watch has cornered itself for one final night. Everything you have learned, turned on them.",
    nodeCount: 160, minDist: 60,
    stoneCount: 6, cottageCount: 6, cairnCount: 5, moonwellCount: 3,
    greenCount: 9, greenSpacing: 280,
    wallCount: 8, pathCount: 5, mistCount: 4,
    pyreCount: 3, wispCount: 2, marshfireCount: 2, geyserCount: 3, galeCount: 2,
    gladeCount: 3, springCount: 2, wolfsbaneCount: 2, dolmenCount: 2, hoardCount: 2,
    houndCount: 3, knightCount: 3, huntsmanCount: 4, friarCount: 3, sizeScale: 1.22,
  },
];

function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

// ---------- Arena generation ----------
// The same Poisson-disc-ish placement + kind assignment as the siblings, trimmed to
// return plain {x,y,kind} nodes (no edges/adjacency — a hunt never spreads along
// streets). Most nodes are fields; the stones/cottages/cairns/moonwells are
// scattered; greens are placed with spacing, clear of each other.

function generateWerewolf(
  level: LevelDef,
  w = W * (level.sizeScale ?? 1),
  h = H * (level.sizeScale ?? 1),
): { nodes: ArenaNode[]; greens: { x: number; y: number }[] } {
  const nodes: ArenaNode[] = [];
  let guard = 0;
  while (nodes.length < level.nodeCount && guard++ < 20000) {
    const x = 60 + Math.random() * (w - 120);
    const y = 60 + Math.random() * (h - 120);
    if (nodes.every((n) => (n.x - x) ** 2 + (n.y - y) ** 2 > level.minDist ** 2)) {
      nodes.push({ x, y, kind: "field" });
    }
  }

  const shuffled = [...nodes].sort(() => Math.random() - 0.5);
  let cursor = 0;
  const take = (n: number): ArenaNode[] => {
    const slice = shuffled.slice(cursor, cursor + n);
    cursor += n;
    return slice;
  };
  take(level.stoneCount).forEach((n) => (n.kind = "stone"));
  take(level.cottageCount).forEach((n) => (n.kind = "cottage"));
  take(level.cairnCount).forEach((n) => { n.kind = "cairn"; n.lit = false; });
  take(level.moonwellCount).forEach((n) => (n.kind = "moonwell"));
  // The expanded maps' new terrain & obstacles — carved from the same field pool,
  // each by its own per-place dial (default 0, so the four original villages carve
  // none). The four solids join s.solids in buildArena via OBSTACLE_KINDS; the rest
  // are passable zones/emitters/pickups resolved by node geometry.
  const extraKinds: [NodeKind, number][] = [
    ["pyre", level.pyreCount ?? 0], ["dolmen", level.dolmenCount ?? 0],
    ["gibbet", level.gibbetCount ?? 0], ["cart", level.cartCount ?? 0],
    ["wisp", level.wispCount ?? 0], ["marshfire", level.marshfireCount ?? 0],
    ["bog", level.bogCount ?? 0], ["bramble", level.brambleCount ?? 0],
    ["glade", level.gladeCount ?? 0], ["spring", level.springCount ?? 0],
    ["geyser", level.geyserCount ?? 0], ["gale", level.galeCount ?? 0],
    ["wolfsbane", level.wolfsbaneCount ?? 0], ["hoard", level.hoardCount ?? 0],
  ];
  for (const [kind, n] of extraKinds) take(n).forEach((node) => (node.kind = kind));

  // Greens — placed on still-field nodes, spaced apart so waves don't stack.
  const greens: { x: number; y: number }[] = [];
  for (const n of shuffled) {
    if (n.kind !== "field") continue;
    if (greens.every((p) => (p.x - n.x) ** 2 + (p.y - n.y) ** 2 > level.greenSpacing ** 2)) {
      greens.push({ x: n.x, y: n.y });
      if (greens.length >= level.greenCount) break;
    }
  }

  return { nodes, greens };
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
// whether a wall stands between a huntsman and the hero (so a bolt is stopped and
// sight is broken).
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

// Does any wall stand on the line between two points? (A huntsman's line of sight,
// and a bolt's flight, both ask.)
function wallBetween(s: WwState, ax: number, ay: number, bx: number, by: number): boolean {
  for (const f of s.walls) {
    if (segsCross(ax, ay, bx, by, f.x1, f.y1, f.x2, f.y2)) return true;
  }
  return false;
}

// String `count` line segments between pairs of nodes whose gap falls in [lo, hi],
// hugging each anchor's nearest in-band neighbour so the segment runs along the grid.
// Walls want short gaps; paths want longer gaps. Cairns are skipped so the mark sites
// stay clear. Pure geometry — it only reads the placed nodes.
function weaveSegments(
  nodes: ArenaNode[], count: number, lo: number, hi: number,
): Segment[] {
  const segs: Segment[] = [];
  const pool = nodes.filter((n) => n.kind !== "cairn");
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

// Push a moving body out of any blocking terrain it has overlapped — solid stones &
// cottages (circle-vs-circle) and walls (circle-vs-segment) — then back inside the
// world bounds. Shove along the normal so a body slides along an edge rather than
// stopping.
function pushOut(s: WwState, x: number, y: number, radius: number): { x: number; y: number } {
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

// Build a fresh hunt: dress the village, drop the cursed soul (a HUMAN at dusk) at
// its heart, and muster a finite watch from each green (villagers, with the per-place
// variants seeded among them as extra bodies — the "extra defenders" pattern the
// siblings use).
function buildArena(level: LevelDef): WwState {
  const w = Math.round(W * (level.sizeScale ?? 1));
  const h = Math.round(H * (level.sizeScale ?? 1));
  const { nodes: scenery, greens } = generateWerewolf(level, w, h);
  const walls = weaveSegments(scenery, level.wallCount, level.minDist * 0.9, level.minDist * 2.0);
  const paths = weaveSegments(scenery, level.pathCount, level.minDist * 3, level.minDist * 5);
  const legacy = loadWwLegacy();
  const pelt = peltTypeById(legacy.equipped);
  const hero: Hero = {
    x: w / 2, y: h / 2, vx: 0, vy: 0, hp: HERO_HP, maxHp: HERO_HP,
    fury: 0, maxFury: 1, form: "human",
    hurt: 0, charge: 0, overcharge: 0, mawCd: 0, angle: 0, transformAt: 0,
  };
  const foes: Foe[] = [];
  const houndCount = Math.min(level.houndCount ?? 0, greens.length);
  const knightCount = Math.min(level.knightCount ?? 0, greens.length);
  const huntsmanCount = Math.min(level.huntsmanCount ?? 0, greens.length);
  const friarCount = Math.min(level.friarCount ?? 0, greens.length);
  // Muster one foe near a green — a small helper so a green's villagers and its
  // (optional) variants all rise the same way.
  const muster = (green: { x: number; y: number }, variant: FoeKind, hpMul: number): void => {
    const a = Math.random() * Math.PI * 2;
    const r = 16 + Math.random() * 40;
    const x = clamp(green.x + Math.cos(a) * r, FOE_RADIUS, w - FOE_RADIUS);
    const y = clamp(green.y + Math.sin(a) * r, FOE_RADIUS, h - FOE_RADIUS);
    const hp = Math.round(FOE_HP * hpMul);
    foes.push({
      x, y, vx: 0, vy: 0, hp, maxHp: hp, dead: false,
      state: "lurk", variant,
      wanderAngle: Math.random() * Math.PI * 2,
      homeX: green.x, homeY: green.y,
      attackCd: 0, shootCd: Math.random() * HUNTSMAN_SHOOT_CD, hit: 0, bornAt: 0,
    });
  };
  greens.forEach((green, gi) => {
    for (let j = 0; j < FOE_PER_GREEN; j++) {
      // The 2nd body of a green is a fast hound on the first `houndCount` greens.
      const hound = j === 1 && gi < houndCount;
      const variant: FoeKind = hound ? "hound" : "villager";
      const hpMul = hound ? HOUND_HP_MUL : 1;
      muster(green, variant, hpMul);
    }
    // The specialists are EXTRA bodies the first N greens raise — added, not slotted.
    if (gi < knightCount) muster(green, "knight", KNIGHT_HP_MUL);
    if (gi < huntsmanCount) muster(green, "huntsman", HUNTSMAN_HP_MUL);
    if (gi < friarCount) muster(green, "friar", FRIAR_HP_MUL);
  });
  // Drifting fog banks.
  const mists: Mist[] = [];
  for (let i = 0; i < level.mistCount; i++) {
    const a = Math.random() * Math.PI * 2;
    mists.push({
      x: 100 + Math.random() * (w - 200),
      y: 100 + Math.random() * (h - 200),
      r: 130 + Math.random() * 110,
      vx: Math.cos(a) * MIST_DRIFT, vy: Math.sin(a) * MIST_DRIFT,
    });
  }
  return {
    level, w, h, scenery,
    solids: scenery.filter((n) => OBSTACLE_KINDS.has(n.kind)),
    cairns: scenery.filter((n) => n.kind === "cairn"),
    moonwells: scenery.filter((n) => n.kind === "moonwell"),
    walls, paths,
    hero, pelt, foes,
    bolts: [], pulses: [], motes: [], mists,
    moon: MOON_START,
    elapsed: 0, slain: 0, hits: 0, total: foes.length,
    cairnsTotal: scenery.filter((n) => n.kind === "cairn").length,
    litCount: 0, cleansedCount: 0,
    phase: "hunt",
  };
}

const freshHunt = buildArena; // alias, mirrors the siblings' freshGame naming

// ---------- The moon (the day/night wheel) ----------

// Daylight at a moon phase: 1 at noon (moon 0/1), 0 at midnight (moon 0.5).
function daylight(moon: number): number {
  return 0.5 + 0.5 * Math.cos(moon * Math.PI * 2);
}
// Moonlight — the inverse; what swells the curse.
function moonlightOf(moon: number): number {
  return 1 - daylight(moon);
}
// A human-readable word for the hour (for the HUD).
function moonWord(s: WwState): string {
  const d = daylight(s.moon);
  if (d > 0.72) return "daylight";
  if (d > 0.4) return Math.sin(s.moon * Math.PI * 2) > 0 ? "dusk" : "dawn";
  if (d > 0.15) return "nightfall";
  return "the dead of night";
}

// ---------- Hunt simulation (pure, headless-testable) ----------

function aliveFoes(s: WwState): number {
  let n = 0;
  for (const e of s.foes) if (!e.dead) n++;
  return n;
}

function clearedPct(s: WwState): number {
  return s.total ? s.slain / s.total : 0;
}

// The HUD's secondary readout: the shape, the hour, and the cairns marked.
function furyReadout(s: WwState): string {
  const shape = s.hero.form === "wolf" ? "Wolf" : "Man";
  return `${shape} · ${moonWord(s)} · ${s.litCount}/${s.cairnsTotal} cairns`;
}

function difficultyMult(level: LevelDef): number {
  const variants = (level.houndCount ?? 0) + (level.knightCount ?? 0) +
    (level.huntsmanCount ?? 0) + (level.friarCount ?? 0);
  const m = 0.8 + level.greenCount * 0.05 + variants * 0.04 + ((level.sizeScale ?? 1) - 1) * 0.5;
  return Math.round(m * 100) / 100;
}

interface ScoreBreakdown {
  base: number; speed: number; cairns: number; survival: number;
  untouched: number; mult: number; total: number;
}
function scoreRun(s: WwState): ScoreBreakdown {
  const base = s.total * SCORE_PER_KILL;
  const target = s.total * SCORE_TARGET_PER_KILL;
  const speed = Math.max(0, Math.round(((target - s.elapsed) / 1000) * SCORE_SPEED_PER_SEC));
  const cairns = s.cairnsTotal ? Math.round((s.litCount / s.cairnsTotal) * SCORE_CAIRNS_MAX) : 0;
  const survival = Math.round((s.hero.hp / s.hero.maxHp) * SCORE_SURVIVAL_MAX);
  const untouched = s.hits === 0 ? SCORE_UNTOUCHED : 0;
  const mult = difficultyMult(s.level);
  const total = Math.round((base + speed + cairns + survival + untouched) * mult);
  return { base, speed, cairns, survival, untouched, mult, total };
}

// Centralized foe-death path — so every kill (maw pulse, cairn aura, frenzy leap)
// counts the same and fires the pelt's on-kill power identically. The mirror of the
// siblings' killKnight / banish.
function slay(s: WwState, e: Foe): void {
  if (e.dead) return;
  e.dead = true;
  s.slain += 1;
  // Feeding the beast: a kill always stokes the curse a little.
  s.hero.fury = clamp(s.hero.fury + FURY_PER_KILL, 0, s.hero.maxFury);
  // The pelt's on-kill powers.
  if (s.pelt.power === "moonblood") {
    s.hero.fury = clamp(s.hero.fury + MOONBLOOD_FURY, 0, s.hero.maxFury);
  }
  if (s.pelt.power === "frenzy") {
    const idx = nearestFoe(s, e.x, e.y, FRENZY_RANGE);
    if (idx >= 0) hurtFoe(s, s.foes[idx], FRENZY_DMG);
  }
  // A felled foe may leave a blood-mote (the fury economy's heartbeat).
  if (Math.random() < MOTE_DROP_CHANCE) {
    s.motes.push({ x: e.x, y: e.y, until: s.elapsed + MOTE_TTL_MS });
  }
}

// Centralized foe-damage path. All maw / cairn / frenzy / bolt-of-our-own damage
// routes through it.
function hurtFoe(s: WwState, e: Foe, dmg: number): void {
  if (e.dead) return;
  e.hp -= dmg;
  e.hit = s.elapsed + HIT_FLASH_MS;
  if (e.hp <= 0) { e.hp = 0; slay(s, e); }
}

// Index of the nearest non-dead foe to (x,y) within `range`, or -1. (Frenzy asks.)
function nearestFoe(s: WwState, x: number, y: number, range: number): number {
  let best = -1, bestD = range;
  for (let i = 0; i < s.foes.length; i++) {
    const e = s.foes[i];
    if (e.dead) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Is a point inside any drifting fog bank? (The wolf's cover from the watch.)
function inMist(s: WwState, x: number, y: number): boolean {
  for (const m of s.mists) if (Math.hypot(m.x - x, m.y - y) <= m.r) return true;
  return false;
}

// Is a point inside any moonwell's aura? (Where the moon always reaches.)
function inMoonwell(s: WwState, x: number, y: number): boolean {
  for (const n of s.moonwells) if (Math.hypot(n.x - x, n.y - y) <= MOONWELL_AURA) return true;
  return false;
}

// Generic: is the point within `aura` of any node of `kind`? The workhorse for the
// new passable-terrain auras (glade/spring/bog/…), so each reads one line.
function inNodeAura(s: WwState, x: number, y: number, kind: NodeKind, aura: number): boolean {
  for (const n of s.scenery) {
    if (n.kind !== kind) continue;
    if ((x - n.x) ** 2 + (y - n.y) ** 2 <= aura * aura) return true;
  }
  return false;
}

// Is the point in a moonlit glade? Here the hero traces the maw even while loping
// (the moonwell's moving-trace gift, on a smaller patch).
function inGlade(s: WwState, x: number, y: number): boolean {
  return inNodeAura(s, x, y, "glade", GLADE_AURA);
}

// The terrain speed multiplier for a body at a point: a bog slows EVERY body (hero
// and watch); a bramble snares only the watch. Multiplicative, worst-case compounds;
// 1 on open ground. Pure geometry, read in stepHunt (hero) and moveBody (foes).
function terrainSpeedMul(s: WwState, x: number, y: number, isFoe: boolean): number {
  let mul = 1;
  if (inNodeAura(s, x, y, "bog", BOG_AURA)) mul *= BOG_SLOW;
  if (isFoe && inNodeAura(s, x, y, "bramble", BRAMBLE_AURA)) mul *= BRAMBLE_SLOW;
  return mul;
}

// Continuous hazard ground (the marked-cairn ethos, made fixed terrain): pyres,
// corpse-candles and marsh-fire all burn the watch standing in their aura every
// frame, charge-independent. The single emitter path, so all three read the same.
function stepFields(s: WwState, dt: number): void {
  const EMITTERS: [NodeKind, number, number][] = [
    ["pyre", PYRE_AURA, PYRE_DPS],
    ["wisp", WISP_AURA, WISP_DPS],
    ["marshfire", MARSHFIRE_AURA, MARSHFIRE_DPS],
  ];
  for (const [kind, aura, dps] of EMITTERS) {
    const a2 = aura * aura, dmg = (dps * dt) / 1000;
    for (const n of s.scenery) {
      if (n.kind !== kind) continue;
      for (const e of s.foes) {
        if (e.dead) continue;
        if ((e.x - n.x) ** 2 + (e.y - n.y) ** 2 <= a2) hurtFoe(s, e, dmg);
      }
    }
  }
}

// Geysers erupt on their own cadence: every GEYSER_CD a scalding burst burns every
// foe within GEYSER_RADIUS (charge-independent). Each seeds its own clock the first
// time it is stepped, so they don't all fire in lockstep.
function stepGeysers(s: WwState, dt: number): void {
  void dt; // cadence is read off s.elapsed, not accumulated here
  for (const n of s.scenery) {
    if (n.kind !== "geyser") continue;
    if (n.geyserAt === undefined) { n.geyserAt = s.elapsed + GEYSER_CD; continue; }
    if (s.elapsed < n.geyserAt) continue;
    n.geyserAt = s.elapsed + GEYSER_CD;
    const gr2 = GEYSER_RADIUS ** 2;
    for (const e of s.foes) {
      if (e.dead) continue;
      if ((e.x - n.x) ** 2 + (e.y - n.y) ** 2 <= gr2) hurtFoe(s, e, GEYSER_DMG);
    }
    s.pulses.push({ x: n.x, y: n.y, r: GEYSER_RADIUS, until: s.elapsed + PULSE_FX_MS });
  }
}

// Gales shove every foe steadily out of their aura (the hero, anchored by the curse,
// is unmoved). Opens a no-go lane in the watch. A separate pass so it fires whatever
// the foe's state (lurk or hunt).
function stepGale(s: WwState, dt: number): void {
  for (const n of s.scenery) {
    if (n.kind !== "gale") continue;
    for (const e of s.foes) {
      if (e.dead) continue;
      const gx = e.x - n.x, gy = e.y - n.y, gd = Math.hypot(gx, gy);
      if (gd > 0 && gd < GALE_AURA) {
        const push = (GALE_PUSH * dt) / 1000;
        const p = pushOut(s, e.x + (gx / gd) * push, e.y + (gy / gd) * push, FOE_RADIUS);
        e.x = p.x; e.y = p.y;
      }
    }
  }
}

// Barrow-hoards — the hero's body reaching an un-cracked hoard breaks it open for a
// surge of the curse (a fury jolt), then the hoard is spent. The blood-mote reward,
// placed on the map (the Vigil's relic-cache, re-themed to the curse).
function stepHoards(s: WwState): void {
  const h = s.hero;
  const rr = (HERO_RADIUS + HOARD_REACH) ** 2;
  for (const n of s.scenery) {
    if (n.kind !== "hoard" || n.spent) continue;
    if ((n.x - h.x) ** 2 + (n.y - h.y) ** 2 <= rr) {
      n.spent = true;
      h.fury = clamp(h.fury + HOARD_FURY, 0, h.maxFury);
    }
  }
}

// Fire one rending pulse from the wolf — AoE damage to the watch in reach, marking
// any dark cairn caught, the pelt's power, a fury cost, and an empowered erupt if an
// overcharge is banked. The deterministic heart of the weapon; stepMaw gates and
// paces it, the test calls it directly. (Assumes the wolf shape; stepMaw guarantees.)
function firePulse(s: WwState): void {
  const h = s.hero;
  const empowered = h.overcharge >= 1;
  const radius = MAW_RADIUS * s.pelt.radiusMul * (empowered ? OVERCHARGE_RADIUS_MUL : 1);
  const dmg = MAW_DMG * s.pelt.dmgMul;
  // Every rending spends a little fury (feed to outpace it; an empowered pulse repays).
  h.fury = clamp(h.fury - MAW_FURY_COST, 0, h.maxFury);
  for (const e of s.foes) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    if (d > radius + FOE_RADIUS) continue;
    if (empowered || s.pelt.power === "terror") {
      const a = Math.atan2(e.y - h.y, e.x - h.x);
      e.x += Math.cos(a) * TERROR_KNOCK;
      e.y += Math.sin(a) * TERROR_KNOCK;
    }
    hurtFoe(s, e, dmg);
  }
  // Mark any dark cairn the ring caught (a secondary objective folded into the verb).
  for (const n of s.cairns) {
    if (n.lit) continue;
    if (n.cleansed && n.cleansed > s.elapsed) continue;
    if (Math.hypot(n.x - h.x, n.y - h.y) <= radius + CAIRN_MARK_REACH) markCairn(s, n);
  }
  if (empowered) {
    h.fury = clamp(h.fury + OVERCHARGE_FURY, 0, h.maxFury);
    h.overcharge = 0;
  }
  s.pulses.push({ x: h.x, y: h.y, r: radius, until: s.elapsed + PULSE_FX_MS });
}

// Pace the maw: only a WOLF, with a sufficiently-traced maw, rends — and only on its
// cadence. (Human form cannot attack; this is the gate that enforces it.)
function stepMaw(s: WwState, dt = 16): void {
  const h = s.hero;
  if (h.form !== "wolf") return;
  if (h.charge < MAW_BITE_AT) return;
  h.mawCd -= dt;
  if (h.mawCd > 0) return;
  h.mawCd = MAW_PULSE_MS * s.pelt.pulseMul;
  firePulse(s);
}

// Move a body by a desired velocity for dt, then push it out of terrain. Shared by
// every foe kind so collision is uniform.
function moveBody(s: WwState, e: Foe, vx: number, vy: number, dt: number, radius: number): void {
  // Terrain bogs the step: a bog slows every body, a bramble snares the watch.
  const tmul = terrainSpeedMul(s, e.x, e.y, true);
  vx *= tmul; vy *= tmul;
  e.vx = vx; e.vy = vy;
  const p = pushOut(s, e.x + (vx * dt) / 1000, e.y + (vy * dt) / 1000, radius);
  e.x = p.x; e.y = p.y;
}

// Separation: nudge a foe away from its crowded neighbours so the watch swarms rather
// than stacking into one point.
function separate(s: WwState, e: Foe): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const o of s.foes) {
    if (o === e || o.dead) continue;
    const dx = e.x - o.x, dy = e.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < FOE_SEP) { sx += (dx / d) * (FOE_SEP - d); sy += (dy / d) * (FOE_SEP - d); }
  }
  return { x: sx, y: sy };
}

// The watch AI. A foe lurks near its green until the hero comes within aggro (smaller
// while he's a man or hidden in mist) or the cleanup sweep rouses it, then hunts.
// Melee kinds close and strike; the huntsman holds a standoff and looses bolts; the
// friar holds back and bleeds the curse.
function stepFoes(s: WwState, dt: number): void {
  const h = s.hero;
  const fewLeft = aliveFoes(s) <= Math.ceil(s.total * CLEANUP_AGGRO_FRAC);
  // The watch is slower to rouse to a man, or to a beast lost in the fog.
  const stealthy = h.form === "human" || inMist(s, h.x, h.y);
  const aggro = FOE_AGGRO * (stealthy ? STEALTH_AGGRO_MUL : 1);
  for (const e of s.foes) {
    if (e.dead) continue;
    e.aiming = false; e.channeling = false;
    const dxh = h.x - e.x, dyh = h.y - e.y;
    const dh = Math.hypot(dxh, dyh) || 1;

    if (e.state === "lurk") {
      if (dh < aggro || fewLeft) {
        e.state = "hunt";
      } else {
        // Idle drift on a leash around the green.
        e.wanderAngle += (Math.random() - 0.5) * 0.5;
        let wx = Math.cos(e.wanderAngle) * FOE_WANDER_SPEED;
        let wy = Math.sin(e.wanderAngle) * FOE_WANDER_SPEED;
        const dHome = Math.hypot(e.x - e.homeX, e.y - e.homeY);
        if (dHome > FOE_LEASH) {
          wx = ((e.homeX - e.x) / dHome) * FOE_WANDER_SPEED;
          wy = ((e.homeY - e.y) / dHome) * FOE_WANDER_SPEED;
        }
        moveBody(s, e, wx, wy, dt, FOE_RADIUS);
        continue;
      }
    }

    const sep = separate(s, e);

    if (e.variant === "huntsman") {
      // Hold a standoff; loose a silver bolt with line of sight (not through mist).
      const speed = FOE_SPEED * HUNTSMAN_SPEED_MUL;
      let dirx = 0, diry = 0;
      if (dh < HUNTSMAN_STANDOFF) { dirx = -dxh / dh; diry = -dyh / dh; }   // kite away
      else if (dh > HUNTSMAN_RANGE) { dirx = dxh / dh; diry = dyh / dh; }   // close in
      moveBody(s, e, dirx * speed + sep.x, diry * speed + sep.y, dt, FOE_RADIUS);
      if (e.shootCd > 0) e.shootCd -= dt;
      const canSee = dh <= HUNTSMAN_RANGE && !wallBetween(s, e.x, e.y, h.x, h.y) && !inMist(s, h.x, h.y);
      if (canSee && e.shootCd <= 0) {
        e.shootCd = HUNTSMAN_SHOOT_CD;
        e.aiming = true;
        const a = Math.atan2(dyh, dxh);
        s.bolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * BOLT_SPEED, vy: Math.sin(a) * BOLT_SPEED, dead: false, bornAt: s.elapsed });
      }
      cleanseNearCairn(s, e);
      continue;
    }

    if (e.variant === "friar") {
      // Hold back; consecrate a hero in range with sight, bleeding the curse.
      const speed = FOE_SPEED * FRIAR_SPEED_MUL;
      let dirx = 0, diry = 0;
      if (dh < FRIAR_STANDOFF) { dirx = -dxh / dh; diry = -dyh / dh; } // kite from the hero
      moveBody(s, e, dirx * speed + sep.x, diry * speed + sep.y, dt, FOE_RADIUS);
      if (dh <= FRIAR_RANGE && !wallBetween(s, e.x, e.y, h.x, h.y)) {
        e.channeling = true; e.beamX = h.x; e.beamY = h.y;
        h.fury = clamp(h.fury - (FRIAR_FURY_DRAIN * dt) / 1000, 0, h.maxFury);
      }
      cleanseNearCairn(s, e);
      continue;
    }

    // Melee kinds (villager / hound / knight): close and strike.
    const speed = FOE_SPEED *
      (e.variant === "hound" ? HOUND_SPEED_MUL : e.variant === "knight" ? KNIGHT_SPEED_MUL : 1);
    moveBody(s, e, (dxh / dh) * speed + sep.x, (dyh / dh) * speed + sep.y, dt, FOE_RADIUS);
    if (e.attackCd > 0) e.attackCd -= dt;
    const reach = HERO_RADIUS + FOE_RADIUS + FOE_ATTACK_REACH;
    if (dh <= reach && e.attackCd <= 0) {
      e.attackCd = FOE_ATTACK_CD;
      if (h.hurt <= 0) {
        const contact = e.variant === "hound" ? HOUND_CONTACT
          : e.variant === "knight" ? KNIGHT_CONTACT : FOE_CONTACT;
        h.hp -= contact;
        h.hurt = HERO_IFRAMES_MS;
        s.hits += 1;
        h.x = clamp(h.x + (dxh / dh) * -HERO_KNOCKBACK, HERO_RADIUS, s.w - HERO_RADIUS);
        h.y = clamp(h.y + (dyh / dh) * -HERO_KNOCKBACK, HERO_RADIUS, s.h - HERO_RADIUS);
      }
    }
    cleanseNearCairn(s, e);
  }
}

// Huntsmen's silver bolts in flight — move, expire, stop at a wall, strike the hero.
function stepBolts(s: WwState, dt: number): void {
  const h = s.hero;
  for (let i = s.bolts.length - 1; i >= 0; i--) {
    const b = s.bolts[i];
    if (b.dead || b.bornAt + BOLT_TTL_MS <= s.elapsed) { s.bolts.splice(i, 1); continue; }
    const nx = b.x + (b.vx * dt) / 1000, ny = b.y + (b.vy * dt) / 1000;
    if (wallBetween(s, b.x, b.y, nx, ny)) { s.bolts.splice(i, 1); continue; } // a wall stops it
    b.x = nx; b.y = ny;
    if (b.x < 0 || b.y < 0 || b.x > s.w || b.y > s.h) { s.bolts.splice(i, 1); continue; }
    if (Math.hypot(b.x - h.x, b.y - h.y) <= HERO_RADIUS + BOLT_RADIUS) {
      if (h.hurt <= 0) { h.hp -= BOLT_DMG; h.hurt = HERO_IFRAMES_MS; s.hits += 1; }
      s.bolts.splice(i, 1);
    }
  }
}

// A foe brushing a marked cairn cleanses it (dark again + a scar bars re-marking).
function cleanseNearCairn(s: WwState, e: Foe): void {
  for (const n of s.cairns) {
    if (!n.lit) continue;
    if (Math.hypot(e.x - n.x, e.y - n.y) <= FOE_RADIUS + CLEANSE_REACH) cleanseCairn(s, n);
  }
}

// Mark a dark cairn: light it, count it, and stoke the curse a little.
function markCairn(s: WwState, n: ArenaNode): void {
  if (n.lit) return;
  if (n.cleansed && n.cleansed > s.elapsed) return;
  n.lit = true; n.litAt = s.elapsed;
  s.litCount += 1;
  s.hero.fury = clamp(s.hero.fury + CAIRN_MARK_FURY, 0, s.hero.maxFury);
}

// Cleanse a marked cairn: dark again, drop the tally, and scar the ground for a while.
function cleanseCairn(s: WwState, n: ArenaNode): void {
  if (!n.lit) return;
  n.lit = false; n.litAt = undefined;
  n.cleansed = s.elapsed + CLEANSE_MS;
  s.litCount = Math.max(0, s.litCount - 1);
  s.cleansedCount += 1;
}

function nearScar(s: WwState, x: number, y: number): boolean {
  for (const n of s.cairns) {
    if (n.cleansed && n.cleansed > s.elapsed && Math.hypot(n.x - x, n.y - y) <= SCAR_RADIUS) return true;
  }
  return false;
}

// Marked cairns as ally emitters: the aura grants the hero fury and rends the watch
// that strays in.
function stepCairns(s: WwState, dt: number): void {
  const h = s.hero;
  for (const n of s.cairns) {
    if (!n.lit) continue;
    if (Math.hypot(h.x - n.x, h.y - n.y) <= CAIRN_AURA) {
      h.fury = clamp(h.fury + (CAIRN_FURY_PER_SEC * dt) / 1000, 0, h.maxFury);
    }
    for (const e of s.foes) {
      if (e.dead) continue;
      if (Math.hypot(e.x - n.x, e.y - n.y) <= CAIRN_AURA) hurtFoe(s, e, (CAIRN_DMG * dt) / 1000);
    }
  }
}

// Drift the fog banks, bouncing them off the world bounds.
function stepMists(s: WwState, dt: number): void {
  for (const m of s.mists) {
    m.x += (m.vx * dt) / 1000;
    m.y += (m.vy * dt) / 1000;
    if (m.x < m.r || m.x > s.w - m.r) m.vx *= -1;
    if (m.y < m.r || m.y > s.h - m.r) m.vy *= -1;
    m.x = clamp(m.x, m.r, s.w - m.r);
    m.y = clamp(m.y, m.r, s.h - m.r);
  }
}

// Gather any blood-mote underfoot — it stokes the curse.
function stepMotes(s: WwState): void {
  const h = s.hero;
  const reach = HERO_RADIUS + MOTE_RADIUS;
  for (let i = s.motes.length - 1; i >= 0; i--) {
    const m = s.motes[i];
    if (m.until <= s.elapsed) { s.motes.splice(i, 1); continue; }
    if (Math.hypot(m.x - h.x, m.y - h.y) <= reach) {
      h.fury = clamp(h.fury + MOTE_FURY, 0, h.maxFury);
      s.motes.splice(i, 1);
    }
  }
}

// The per-frame entry. Advances the moon, integrates the hero, runs the watch, the
// bolts, the cairns, mist and motes, resolves the SHAPE, then checks the terminal
// states (fall, or the watch cut down).
function stepHunt(s: WwState, dt: number, move: Move): void {
  if (s.phase !== "hunt") return;
  s.elapsed += dt;
  s.moon = (s.moon + dt / MOON_CYCLE_MS) % 1;
  const h = s.hero;

  // Running a village lane carries the hero swift; off it, normal — and the wolf is
  // the swifter body.
  const onPath = s.paths.some(
    (p) => closestOnSegment(h.x, h.y, p.x1, p.y1, p.x2, p.y2).d <= PATH_HALF,
  );
  const baseSpeed = h.form === "wolf" ? HERO_SPEED_WOLF : HERO_SPEED_HUMAN;
  // A lane speeds the hero; a bog bogs him (terrainSpeedMul, hero = not a foe, so a
  // bramble leaves him be). The two compose — a boosted lane through a bog.
  const speed = baseSpeed * (onPath ? PATH_BOOST : 1) * terrainSpeedMul(s, h.x, h.y, false);
  h.vx = move.x * speed;
  h.vy = move.y * speed;
  {
    const p = pushOut(s, h.x + (h.vx * dt) / 1000, h.y + (h.vy * dt) / 1000, HERO_RADIUS);
    h.x = p.x; h.y = p.y;
  }
  if (h.hurt > 0) h.hurt = Math.max(0, h.hurt - dt);

  // Moonlight here — full inside a moonwell, whatever the hour.
  const well = inMoonwell(s, h.x, h.y);
  const ml = well ? 1 : moonlightOf(s.moon);
  const dl = well ? 0 : daylight(s.moon);

  // The maw traces while the hero holds still and fades as he moves; past a full
  // trace the held stand banks an overcharge (the next pulse erupts, see firePulse).
  // (As a man this stand instead bays at the moon — see the fury swell below.)
  const chargeMs = CHARGE_MS * s.pelt.chargeMul;
  const still = Math.hypot(h.vx, h.vy) < HERO_STILL_MAXSPEED;
  // A moonlit glade lets the maw trace even while loping (like a moonwell's gift).
  const tracing = still || inGlade(s, h.x, h.y);
  if (tracing) {
    h.charge = Math.min(1, h.charge + (dt / chargeMs) * (0.35 + 0.9 * ml));
  } else {
    h.charge = Math.max(0, h.charge - dt / chargeMs);
  }
  // Overcharge banks only on a true held STAND; loping (even in a glade) spends it.
  if (still && h.charge >= 1) h.overcharge = Math.min(1, h.overcharge + dt / OVERCHARGE_MS);
  else if (!still) h.overcharge = 0;
  h.angle = (h.angle + dt * SIGIL_SPIN) % 360;

  // A bane-patch (wolfsbane) bleeds the hero's fury while he stands in it; a clear
  // spring slowly mends his wounds (gated by a cap, so it can't facetank the watch).
  if (inNodeAura(s, h.x, h.y, "wolfsbane", WOLFSBANE_AURA)) {
    h.fury = clamp(h.fury - (WOLFSBANE_DRAIN * dt) / 1000, 0, h.maxFury);
  }
  if (inNodeAura(s, h.x, h.y, "spring", SPRING_AURA)) {
    const ceil = Math.max(h.hp, h.maxHp * SPRING_HEAL_CAP);
    h.hp = Math.min(ceil, h.hp + (SPRING_HEAL_DPS * dt) / 1000);
  }

  // THE SHAPE — the moon drives the fury, the fury drives the form. A man's fury
  // swells under moonlight (faster as he bays — stands and charges); at the crest he
  // TURNS. A wolf's fury bleeds (faster by daylight); spent, he turns back to a man.
  if (h.form === "human") {
    h.fury = clamp(h.fury + (dt / FURY_RISE_MS) * (0.15 + ml) * (1 + h.charge * 0.8), 0, h.maxFury);
    if (h.fury >= h.maxFury) { h.form = "wolf"; h.transformAt = s.elapsed; }
  } else {
    h.fury = clamp(h.fury - (dt / FURY_DRAIN_MS) * (0.5 + dl * 1.5), 0, h.maxFury);
    if (h.fury <= 0) { h.form = "human"; h.transformAt = s.elapsed; h.charge = 0; }
  }

  stepMaw(s, dt);     // a wolf with a traced maw rends the host in reach (spends fury)
  stepFoes(s, dt);    // the watch lurks / hunts the hero, strikes, looses bolts, consecrates
  stepBolts(s, dt);   // silver bolts in flight
  stepCairns(s, dt);  // marked cairns grant fury and rend the host in their aura
  stepFields(s, dt);  // pyre/wisp/marsh-fire emitters burn the watch in their auras
  stepGeysers(s, dt); // hot springs erupt a burst on their cadence
  stepGale(s, dt);    // moor-winds shove the watch out of their auras
  stepMists(s, dt);   // drift the fog banks
  stepMotes(s);       // gather any blood-mote underfoot (stokes the curse)
  stepHoards(s);      // crack a barrow-hoard the hero stands on (a fury surge)

  // Retire spent FX (cheap; only when any are live).
  if (s.pulses.length) s.pulses = s.pulses.filter((p) => p.until > s.elapsed);

  // Terminal: the hero falls (HP), or the watch is cut down (won).
  if (h.hp <= 0) { h.hp = 0; s.phase = "lost"; return; }
  if (aliveFoes(s) === 0) { s.phase = "won"; }
}

// ---------- Sprites (reused pattern from the sibling games) ----------

const svgNS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// The base sprites this spinoff may draw. Every one has a procedural fallback, so the
// game is fully playable with zero PNGs — none have shipped yet, so none are in sw.js
// (added when the art ships). Scenery uses the field/stone/cottage/cairn/moonwell
// art; the hero (two shapes) and the watch are their own sprites.
const SPRITE_NAMES = [
  "ground", "field", "stone", "cottage", "cairn", "cairn-marked", "cairn-cleansed",
  "moonwell", "wall", "path",
  "wolf-human", "wolf-beast",
  "villager", "hound", "knight", "huntsman", "friar",
] as const;

// Which sprites a place may re-skin (art/<villageId>/<name>.png) — the built world.
const CITY_SPRITES = new Set<string>(["ground", "field", "stone", "cottage", "cairn", "cairn-marked"]);

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

// The wolf's weapon-mark is a BLOOD-MOON SIGIL — a double ring (the full moon) raked
// across by claw-slashes, in place of the siblings' five-pointed star / Elder Sign.
// Pure geometry: an outer ring enclosing an inner ring, three long claw-rakes, and a
// few short radial rays. Authored in a unit circle, then scaled to r, rotated by
// rotDeg and centred on (cx,cy). Returns one multi-subpath `d` string — stroked,
// never filled — and closes (ends in "Z") so it reads as a single sealed mark.
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
    let str = `M${f(w[0][0])} ${f(w[0][1])}`;
    for (let i = 1; i < w.length; i++) str += `L${f(w[i][0])} ${f(w[i][1])}`;
    return str;
  };
  // A full ring of unit-radius ur (two arcs, top to bottom and back).
  const ring = (ur: number): string => {
    const [tx, ty] = P(0, -ur), [bx, by] = P(0, ur);
    const wr = ur * r;
    return `M${f(tx)} ${f(ty)}A${f(wr)} ${f(wr)} 0 1 1 ${f(bx)} ${f(by)}A${f(wr)} ${f(wr)} 0 1 1 ${f(tx)} ${f(ty)}`;
  };
  // The full moon — an outer ring enclosing an inner ring.
  let d = ring(1) + ring(0.62);
  // Three long claw-rakes raked across the moon (the slash).
  d += seg([[-0.62, -0.52], [0.52, 0.12]]);
  d += seg([[-0.72, -0.18], [0.42, 0.42]]);
  d += seg([[-0.56, 0.12], [0.56, 0.58]]);
  // A few short radial rays binding it.
  d += seg([[0, -0.62], [0, -1]]);
  d += seg([[0.62, 0], [1, 0]]);
  d += seg([[-0.62, 0], [-1, 0]]);
  d += seg([[0, 0.62], [0, 1]]);
  return d + "Z";
}

// ---------- Render (reads WwState; wholesale rebuild each frame) ----------

// Built once: filters/gradients + the camera group. The palette is moonlit silver and
// blood-red over fog-grey, in place of the siblings' warm flame / necrotic green /
// abyssal cyan.
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
    <radialGradient id="mawGlow">
      <stop offset="0%" stop-color="#ffe6ea" stop-opacity="1"/>
      <stop offset="30%" stop-color="#e0566a" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#e0566a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cairn">
      <stop offset="0%" stop-color="#eef2ff" stop-opacity="0.5"/>
      <stop offset="46%" stop-color="#9bb0e0" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#6a4fb0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mote">
      <stop offset="0%" stop-color="#ffd0d6" stop-opacity="1"/>
      <stop offset="45%" stop-color="#e0566a" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#e0566a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="well">
      <stop offset="0%" stop-color="#eef4ff" stop-opacity="0.55"/>
      <stop offset="50%" stop-color="#aec4f0" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#aec4f0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fog">
      <stop offset="0%" stop-color="#c8d2e0" stop-opacity="0.42"/>
      <stop offset="60%" stop-color="#b8c4d4" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#b8c4d4" stop-opacity="0"/>
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

const SCENERY_SIZE: Record<NodeKind, number> = {
  field: 40, stone: 48, cottage: 56, cairn: 44, moonwell: 60,
  pyre: 72, dolmen: 80, gibbet: 52, cart: 44,
  wisp: 44, marshfire: 60, bog: 60, bramble: 60, glade: 60,
  spring: 56, geyser: 56, gale: 56, wolfsbane: 52, hoard: 44,
};

// Resolve a node's sprite name from its live state.
function scenerySprite(s: WwState, n: ArenaNode): string {
  switch (n.kind) {
    case "cairn":
      if (n.lit) return "cairn-marked";
      if (n.cleansed && n.cleansed > s.elapsed && sprites.has("cairn-cleansed")) return "cairn-cleansed";
      return "cairn";
    default:
      return n.kind;
  }
}

const FOE_HUE: Record<FoeKind, string> = {
  villager: "#9a8a6a", hound: "#7a6a4a", knight: "#8a909a", huntsman: "#6a8a5a", friar: "#b0a890",
};

// Draw one of the expanded maps' new terrain/obstacle nodes procedurally. Returns
// true when it handled `n` (so the scenery loop skips its generic path). No PNGs
// ship for these yet — each reads as a coloured aura (where it has a reach) plus a
// distinct body, so the new vocabulary is legible without art. Pure render.
function renderNewTerrain(s: WwState, n: ArenaNode, layer: SVGGElement): boolean {
  const aura = (r: number, color: string, op: number, dash = "4 10") =>
    layer.appendChild(el("circle", {
      cx: n.x, cy: n.y, r, fill: "none", stroke: color,
      "stroke-width": 1.4, "stroke-dasharray": dash, opacity: op,
    }));
  const disc = (r: number, fill: string, op = 1) =>
    layer.appendChild(el("circle", { cx: n.x, cy: n.y, r, fill, opacity: op }));
  const pulse = 1 + 0.06 * Math.sin(s.elapsed / 240);
  switch (n.kind) {
    case "pyre": { // solid pyre + permanent burn aura
      aura(PYRE_AURA * pulse, "#ff9a3a", 0.22, "2 8");
      disc(PYRE_AURA, "#3a1606", 0.1);
      disc(15, "#3a1606"); disc(10, "#ff6a1e", 0.95); disc(5, "#ffe6a0");
      return true;
    }
    case "dolmen": { disc(24, "#2c303a"); disc(16, "#3a3f48", 0.95); disc(8, "#565f6a", 0.9); return true; }
    case "gibbet": { disc(13, "#241c14"); disc(8, "#3a2c20", 0.9); return true; }
    case "cart": { disc(12, "#2a2118"); disc(7, "#3a2c20", 0.9); return true; }
    case "wisp": { // passable corpse-candle emitter
      aura(WISP_AURA * pulse, "#9fe0c0", 0.2, "2 8");
      disc(7, "#13261c"); disc(4, "#bfffe0", 0.95);
      return true;
    }
    case "marshfire": { aura(MARSHFIRE_AURA, "#ff7a3a", 0.22, "3 7"); disc(MARSHFIRE_AURA, "#2a1404", 0.1); disc(8, "#ff6a1e", 0.9); return true; }
    case "bog": { disc(BOG_AURA, "#17210f", 0.24); aura(BOG_AURA, "#4a5a2a", 0.2, "2 10"); disc(8, "#243017", 0.9); return true; }
    case "bramble": { aura(BRAMBLE_AURA, "#5a9a4a", 0.22, "5 8"); disc(BRAMBLE_AURA, "#0f1d0b", 0.1); disc(8, "#1f3e18", 0.9); return true; }
    case "glade": { aura(GLADE_AURA, "#cfe0ff", 0.2, "2 9"); aura(GLADE_AURA * 0.7, "#9fb8e8", 0.14, "4 10"); disc(8, "#3a4458", 0.85); return true; }
    case "spring": { aura(SPRING_AURA, "#7ad0ff", 0.22, "3 9"); disc(SPRING_AURA, "#0c1c2a", 0.12); disc(9, "#173247", 0.9); disc(5, "#9fe0ff", 0.9); return true; }
    case "geyser": {
      const due = n.geyserAt !== undefined ? clamp((n.geyserAt - s.elapsed) / GEYSER_CD, 0, 1) : 1;
      aura(GEYSER_RADIUS, "#7fd6ff", 0.14 + 0.2 * (1 - due), "4 6");
      disc(9, "#0c1c2a"); disc(5, "#bfe8ff", 0.95);
      return true;
    }
    case "gale": { aura(GALE_AURA * pulse, "#cdd9ec", 0.2, "6 10"); aura(GALE_AURA * 0.6, "#cdd9ec", 0.14, "6 10"); disc(7, "#2c3340", 0.9); return true; }
    case "wolfsbane": { aura(WOLFSBANE_AURA, "#b08fd0", 0.22, "3 7"); disc(WOLFSBANE_AURA, "#1a1226", 0.1); disc(8, "#3a2a52", 0.9); disc(4, "#c9a8e8", 0.9); return true; }
    case "hoard": {
      const op = n.spent ? 0.3 : 1;
      disc(11, "#2a2208", op); disc(7, n.spent ? "#5a4a20" : "#ffcf5a", op);
      if (!n.spent) disc(3, "#fff4c8");
      return true;
    }
    default: return false;
  }
}

function render(s: WwState, layer: SVGGElement): void {
  layer.innerHTML = "";
  const night = moonlightOf(s.moon);

  // Ground — the village floor (or solid gloom if the art isn't loaded).
  const hasGround = sprites.has("ground");
  layer.appendChild(el("rect", {
    x: 0, y: 0, width: s.w, height: s.h,
    fill: hasGround ? "url(#groundPat)" : "#10131a", opacity: hasGround ? 0.5 : 1,
  }));

  // Paths — the village lanes beneath the built world.
  for (const p of s.paths) {
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#231f1a", "stroke-width": PATH_HALF * 2, "stroke-linecap": "round", opacity: 0.5,
    }));
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#4a4030", "stroke-width": 3, "stroke-linecap": "round",
      "stroke-dasharray": "10 14", opacity: 0.45,
    }));
  }

  // Walls — hedgerows & palisades, drawn beneath the built world.
  for (const f of s.walls) {
    layer.appendChild(el("line", {
      x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
      stroke: "#14180f", "stroke-width": WALL_VIS_THICK, "stroke-linecap": "round", opacity: 0.9,
    }));
    layer.appendChild(el("line", {
      x1: f.x1, y1: f.y1, x2: f.x2, y2: f.y2,
      stroke: "#3a4a28", "stroke-width": 2.5, "stroke-linecap": "round", opacity: 0.5,
    }));
  }

  // Moonwell auras — pools where the moon always reaches.
  for (const n of s.moonwells) {
    layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: MOONWELL_AURA, fill: "url(#well)" }));
  }

  // Scar rings under cleansed cairns (bars re-marking).
  for (const n of s.cairns) {
    if (n.cleansed && n.cleansed > s.elapsed) {
      layer.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: SCAR_RADIUS,
        fill: "none", stroke: "#6a4fb0", "stroke-width": 1.5,
        "stroke-dasharray": "4 8", opacity: 0.4,
      }));
    }
  }

  // Marked-cairn auras (grant fury, rend the host).
  for (const n of s.cairns) {
    if (!n.lit) continue;
    layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: CAIRN_AURA, fill: "url(#cairn)" }));
  }

  // Scenery — fields, stones, cottages, cairns, moonwells. Sprite if loaded, else a
  // procedural mark.
  for (const n of s.scenery) {
    const size = SCENERY_SIZE[n.kind];
    const key = spriteFor(s.level, scenerySprite(s, n));
    if (key) { layer.appendChild(spriteImage(key, n.x, n.y, size, 0.96)); continue; }
    // The expanded maps' new terrain & obstacles — drawn procedurally (no PNGs ship).
    if (renderNewTerrain(s, n, layer)) continue;
    if (n.kind === "stone") {
      layer.appendChild(el("rect", {
        x: n.x - 10, y: n.y - 22, width: 20, height: 44, rx: 6,
        fill: "#3a3f48", stroke: "#565f6a", "stroke-width": 1.5,
      }));
    } else if (n.kind === "cottage") {
      layer.appendChild(el("rect", {
        x: n.x - 18, y: n.y - 12, width: 36, height: 24, rx: 2,
        fill: "#3a2c20", stroke: "#5a4632", "stroke-width": 1.5,
      }));
      layer.appendChild(el("path", {
        d: `M${n.x - 22} ${n.y - 10}L${n.x} ${n.y - 26}L${n.x + 22} ${n.y - 10}Z`,
        fill: "#4a3a28", stroke: "#5a4632", "stroke-width": 1.5,
      }));
    } else if (n.kind === "moonwell") {
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: 16, fill: "#1a2438", stroke: "#7e98d0", "stroke-width": 2 }));
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: 9, fill: "#cfe0ff", opacity: 0.85, filter: "url(#glow)" }));
    } else if (n.kind === "cairn") {
      const marked = n.lit;
      layer.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: 11,
        fill: marked ? "#ffd6dc" : "#22262e",
        stroke: marked ? "#e0566a" : "#4a525c", "stroke-width": 2,
        filter: marked ? "url(#glow)" : undefined as unknown as string,
      }));
      layer.appendChild(el("path", {
        d: pentagramPath(n.x, n.y, 8, 0),
        fill: "none", stroke: marked ? "#22262e" : "#6a727c", "stroke-width": 1.2, opacity: 0.9,
      }));
    } else {
      // A field — a faint tuft, drawn sparsely.
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: 4, fill: "#2a2e22", opacity: 0.5 }));
    }
  }

  // Blood-motes.
  for (const m of s.motes) {
    layer.appendChild(el("circle", { cx: m.x, cy: m.y, r: 13, fill: "url(#mote)" }));
  }

  // Silver bolts in flight.
  for (const b of s.bolts) {
    const a = Math.atan2(b.vy, b.vx);
    const tx = b.x - Math.cos(a) * 12, ty = b.y - Math.sin(a) * 12;
    layer.appendChild(el("line", {
      x1: tx, y1: ty, x2: b.x, y2: b.y,
      stroke: "#e8ecf6", "stroke-width": 2.4, "stroke-linecap": "round", filter: "url(#glow)",
    }));
  }

  // The watch.
  for (const e of s.foes) {
    if (e.dead) continue;
    const r = e.variant === "knight" ? 18 : e.variant === "hound" ? 11 : 14;
    const flash = e.hit > s.elapsed;
    // A friar's consecration beam.
    if (e.channeling && e.beamX != null && e.beamY != null) {
      layer.appendChild(el("line", {
        x1: e.x, y1: e.y, x2: e.beamX, y2: e.beamY,
        stroke: "#e6e0b0", "stroke-width": 2, opacity: 0.55, "stroke-dasharray": "3 5",
      }));
    }
    const key = spriteFor(s.level, e.variant);
    if (key) { layer.appendChild(spriteImage(key, e.x, e.y, r * 2.6, 0.96)); }
    else {
      layer.appendChild(el("circle", {
        cx: e.x, cy: e.y, r,
        fill: flash ? "#ffffff" : FOE_HUE[e.variant],
        stroke: e.state === "hunt" ? "#0a0d12" : "#2a3038", "stroke-width": 2,
        opacity: e.state === "lurk" ? 0.7 : 1,
      }));
      // A small head, and for the huntsman a drawn bow-stroke.
      layer.appendChild(el("circle", { cx: e.x, cy: e.y - r * 0.2, r: 3, fill: "#1a1d22" }));
      if (e.variant === "huntsman") {
        layer.appendChild(el("path", {
          d: `M${e.x + r - 2} ${e.y - r + 2}Q${e.x + r + 6} ${e.y} ${e.x + r - 2} ${e.y + r - 2}`,
          fill: "none", stroke: "#caa86a", "stroke-width": 1.6,
        }));
      }
    }
    // A wounded body's hp pip.
    if (e.hp < e.maxHp && !e.dead) {
      const frac = Math.max(0, e.hp / e.maxHp);
      layer.appendChild(el("rect", { x: e.x - r, y: e.y - r - 7, width: r * 2, height: 3, fill: "#20272e" }));
      layer.appendChild(el("rect", { x: e.x - r, y: e.y - r - 7, width: r * 2 * frac, height: 3, fill: "#d85a6a" }));
    }
  }

  // Rending rings (fading FX).
  for (const p of s.pulses) {
    const k = (p.until - s.elapsed) / PULSE_FX_MS;
    layer.appendChild(el("circle", {
      cx: p.x, cy: p.y, r: p.r * (1.05 - k * 0.18),
      fill: "none", stroke: s.pelt.ring, "stroke-width": 3 + k * 3, opacity: Math.max(0, k) * 0.7,
      filter: "url(#glow)",
    }));
  }

  // Night wash — the whole village darkens toward midnight (drawn above the world,
  // below the hero and the fog so the beast and the moonlight read).
  if (night > 0.05) {
    layer.appendChild(el("rect", {
      x: 0, y: 0, width: s.w, height: s.h,
      fill: "#0a1024", opacity: night * 0.5, "pointer-events": "none",
    }));
  }

  // The hero — the blood-moon maw traced beneath (only a wolf rends), then the body.
  const h = s.hero;
  const wolf = h.form === "wolf";
  if (wolf && h.charge > 0.02) {
    const traced = h.charge >= MAW_BITE_AT;
    const rr = MAW_RADIUS * s.pelt.radiusMul * (h.overcharge >= 1 ? OVERCHARGE_RADIUS_MUL : 1);
    if (traced) layer.appendChild(el("circle", { cx: h.x, cy: h.y, r: rr * h.charge, fill: "url(#mawGlow)" }));
    layer.appendChild(el("path", {
      d: pentagramPath(h.x, h.y, 24 + 10 * h.charge, h.angle),
      fill: "none", stroke: s.pelt.star, "stroke-width": 2 + 2 * h.charge,
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
  const hwKey = spriteFor(s.level, wolf ? "wolf-beast" : "wolf-human");
  if (hwKey) { layer.appendChild(spriteImage(hwKey, h.x, h.y, HERO_RADIUS * (wolf ? 3.0 : 2.4), 1)); }
  else {
    const hurt = h.hurt > 0 && Math.floor(s.elapsed / 80) % 2 === 0;
    if (wolf) {
      // The beast — a dark hunched body, ears, and two cold eyes.
      const rad = HERO_RADIUS + 3;
      layer.appendChild(el("ellipse", {
        cx: h.x, cy: h.y, rx: rad * 1.2, ry: rad,
        fill: hurt ? "#5a3a3a" : "#241f26", stroke: "#7a708a", "stroke-width": 2.5, filter: "url(#glow)",
      }));
      layer.appendChild(el("path", {
        d: `M${h.x - rad * 0.7} ${h.y - rad * 0.7}l-3 -8 7 4Z M${h.x + rad * 0.7} ${h.y - rad * 0.7}l3 -8 -7 4Z`,
        fill: "#241f26", stroke: "#7a708a", "stroke-width": 1.5,
      }));
      layer.appendChild(el("circle", { cx: h.x - 5, cy: h.y - 2, r: 2.4, fill: "#ffe04a" }));
      layer.appendChild(el("circle", { cx: h.x + 5, cy: h.y - 2, r: 2.4, fill: "#ffe04a" }));
    } else {
      // The man — a smaller cloaked figure.
      layer.appendChild(el("circle", {
        cx: h.x, cy: h.y, r: HERO_RADIUS - 1,
        fill: hurt ? "#ffd0d0" : "#b9a98e", stroke: "#7a6a4a", "stroke-width": 2.5,
      }));
      layer.appendChild(el("circle", { cx: h.x, cy: h.y - 4, r: 4, fill: "#2a2018" }));
    }
  }

  // Fog banks — drawn last, above all (the wolf's cover, the misty Britain).
  for (const m of s.mists) {
    layer.appendChild(el("circle", { cx: m.x, cy: m.y, r: m.r, fill: "url(#fog)", "pointer-events": "none" }));
  }
}

// ---------- Legacy (cross-hunt record, in its own key) ----------

interface WwLegacy {
  runs: number;        // hunts begun
  hunts: number;       // villages claimed (wins)
  best: Record<string, number>; // best clear time per village id
  cairnsMarked: number; // lifetime cairns marked
  slain: number;       // lifetime foes cut down
  moonstones: number;  // the unlock currency
  unlocked: string[];  // owned pelt ids
  equipped: string;    // the equipped pelt id
}

function emptyWwLegacy(): WwLegacy {
  return {
    runs: 0, hunts: 0, best: {}, cairnsMarked: 0, slain: 0,
    moonstones: 0, unlocked: ["grey"], equipped: "grey",
  };
}

function loadWwLegacy(): WwLegacy {
  const base = emptyWwLegacy();
  try {
    const raw = localStorage.getItem(WW_LEGACY_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<WwLegacy>;
    const l: WwLegacy = {
      runs: p.runs ?? 0,
      hunts: p.hunts ?? 0,
      best: p.best ?? {},
      cairnsMarked: p.cairnsMarked ?? 0,
      slain: p.slain ?? 0,
      moonstones: p.moonstones ?? 0,
      unlocked: Array.isArray(p.unlocked) && p.unlocked.length ? p.unlocked.slice() : ["grey"],
      equipped: p.equipped ?? "grey",
    };
    if (!l.unlocked.includes("grey")) l.unlocked.unshift("grey");
    if (!l.unlocked.includes(l.equipped)) l.equipped = "grey";
    return l;
  } catch {
    return base;
  }
}

function saveWwLegacy(l: WwLegacy): void {
  try { localStorage.setItem(WW_LEGACY_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

// Fold a claimed village (a win) into the legacy — write-once at the end transition.
function recordHunt(level: LevelDef, ms: number, cairns = 0, moonstones = 0): WwLegacy {
  const l = loadWwLegacy();
  l.runs += 1; l.hunts += 1;
  l.cairnsMarked += cairns;
  l.moonstones += moonstones;
  const prev = l.best[level.id];
  if (prev == null || ms < prev) l.best[level.id] = ms;
  saveWwLegacy(l);
  return l;
}

// Fold a broken hunt (a loss) — bumps the run count and banks the moonstones of the
// foes you cut down, but no claim and no best.
function recordFall(cairns = 0, slainN = 0, moonstones = 0): WwLegacy {
  const l = loadWwLegacy();
  l.runs += 1;
  l.cairnsMarked += cairns;
  l.slain += slainN;
  l.moonstones += moonstones;
  saveWwLegacy(l);
  return l;
}

function unlockPelt(id: string): WwLegacy {
  const l = loadWwLegacy();
  const t = PELT_TYPES.find((x) => x.id === id);
  if (t && !l.unlocked.includes(id) && l.moonstones >= t.cost) {
    l.moonstones -= t.cost; l.unlocked.push(id);
    saveWwLegacy(l);
  }
  return l;
}

function equipPelt(id: string): WwLegacy {
  const l = loadWwLegacy();
  if (l.unlocked.includes(id)) { l.equipped = id; saveWwLegacy(l); }
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

function start(): void {
  const svg = byId("city") as unknown as SVGSVGElement;
  const overlay = byId("overlay");
  const ovTitle = byId("ov-title");
  const ovBody = byId("ov-body");
  const ovBtn = byId("ov-btn") as HTMLButtonElement;
  const ovBtn2 = byId("ov-btn2") as HTMLButtonElement;
  const hpFill = byId("hp");
  const furyFill = byId("fury");
  const foesEl = byId("foes");
  const furyEl = byId("souls");
  const cityEl = byId("cityname");
  const toastEl = byId("toast");
  const stickEl = byId("stick");
  const stickKnob = byId("stick-knob");
  const mmEl = byId("minimap") as unknown as SVGSVGElement;
  const headerEl = document.querySelector("header") as HTMLElement | null;

  const layer = scaffold(svg);
  let s: WwState | null = null;

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
    furyFill.style.width = Math.max(0, (s.hero.fury / s.hero.maxFury) * 100) + "%";
    // The fury bar glows gold once it crests into the beast.
    furyFill.style.filter = s.hero.form === "wolf" ? "drop-shadow(0 0 6px #ffd06a)" : "";
    cityEl.textContent = s.level.name;
    furyEl.textContent = furyReadout(s);
    const alive = aliveFoes(s);
    let foes = alive > 0 ? `Cut down ${alive} / ${s.total}` : `The hunt is yours`;
    if (alive > 0 && alive <= 4) {
      let best: Foe | null = null, bd = Infinity;
      for (const e of s.foes) {
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

  const MM_MAX = 96;
  let mmTick = 0;
  function minimap(): void {
    if (!s || s.phase !== "hunt") { mmEl.style.display = "none"; return; }
    if (mmTick++ % 5 !== 0) return;
    const scale = Math.min(MM_MAX / s.w, MM_MAX / s.h);
    const mw = s.w * scale, mh = s.h * scale;
    mmEl.style.display = "block";
    mmEl.style.top = `${(headerEl ? headerEl.offsetHeight : 50) + 6}px`;
    mmEl.style.width = `${mw.toFixed(1)}px`;
    mmEl.style.height = `${mh.toFixed(1)}px`;
    mmEl.setAttribute("viewBox", `0 0 ${mw.toFixed(1)} ${mh.toFixed(1)}`);
    mmEl.innerHTML = "";
    mmEl.appendChild(el("rect", { x: 0, y: 0, width: mw, height: mh, fill: "#0a0d12", opacity: 0.5 }));
    for (const n of s.cairns) {
      if (!n.lit) continue;
      mmEl.appendChild(el("circle", { cx: n.x * scale, cy: n.y * scale, r: 1.7, fill: "#e0566a", opacity: 0.9 }));
    }
    for (const e of s.foes) {
      if (e.dead) continue;
      mmEl.appendChild(el("circle", {
        cx: e.x * scale, cy: e.y * scale,
        r: e.variant === "knight" ? 1.9 : e.variant === "huntsman" || e.variant === "friar" ? 1.6 : 1.3,
        fill: e.variant === "huntsman" ? "#9bd060" : e.variant === "friar" ? "#e6e0b0"
          : e.variant === "knight" ? "#aeb6c0" : e.variant === "hound" ? "#c0a070" : "#c0b090",
        opacity: 0.95,
      }));
    }
    const vw = svg.clientWidth, vh = svg.clientHeight;
    mmEl.appendChild(el("rect", {
      x: (-cam.x / cam.k) * scale, y: (-cam.y / cam.k) * scale,
      width: (vw / cam.k) * scale, height: (vh / cam.k) * scale,
      fill: "none", stroke: "#e6ecf6", "stroke-width": 0.6, opacity: 0.5,
    }));
    mmEl.appendChild(el("circle", {
      cx: s.hero.x * scale, cy: s.hero.y * scale, r: 2.3,
      fill: s.hero.form === "wolf" ? "#ffe04a" : "#e6f0ff",
      stroke: "#e0566a", "stroke-width": 0.8,
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

  const TOAST_MS = 4200;
  function showToast(text: string): void {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    window.setTimeout(() => toastEl.classList.remove("show"), TOAST_MS);
  }

  // ----- The hunt loop -----
  let lastFrame = 0;
  let running = false;
  let introHold = false;
  let introHoldTimer: ReturnType<typeof setTimeout> | undefined;
  function huntFrame(now: number): void {
    if (!running || !s) return;
    if (!lastFrame) lastFrame = now;
    let dt = now - lastFrame; lastFrame = now;
    if (dt > 100) dt = 100;

    if (introHold && (move.x || move.y || keys.size > 0)) {
      introHold = false;
      clearTimeout(introHoldTimer);
      toastEl.classList.remove("show");
    }

    if (!introHold && s.phase === "hunt") {
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
      stepHunt(s, dt, move);
      centerCam(s.hero.x, s.hero.y);
    }

    render(s, layer);
    hud();
    minimap();

    if (s.phase === "won") { running = false; onWin(); return; }
    if (s.phase === "lost") { running = false; onLost(); return; }
    requestAnimationFrame(huntFrame);
  }

  function startCity(level: LevelDef): void {
    s = buildArena(level);
    loadCitySprites(level.id, repaint);
    hideOverlay();
    setupZoom();
    centerCam(s.hero.x, s.hero.y);
    hud();
    showToast("Claim the village: CUT DOWN every soul of the watch (count, top-right). You begin a MAN — frail, unable to fight. Stand STILL to bay at the moon and stoke your FURY (top-left, beneath your blood); under MOONLIGHT it swells fast. At its crest you TURN BEAST — then standing still traces a blood-moon maw that RENDS the watch around you. Feed (kill) to hold the change; daylight bleeds it. Hunt the huntsmen's silver bolts and the friars' bells, mark the cairns, and lurk in the fog.");
    introHold = true;
    clearTimeout(introHoldTimer);
    introHoldTimer = setTimeout(() => { introHold = false; }, TOAST_MS);
    running = true; lastFrame = 0;
    requestAnimationFrame(huntFrame);
  }

  function onWin(): void {
    if (!s) return;
    const ms = s.elapsed;
    const cairns = s.litCount, total = s.cairnsTotal;
    const sc = scoreRun(s);
    const moonstones = Math.max(1, Math.round(sc.total / MOONSTONE_SCORE_DIV));
    const l = recordHunt(s.level, ms, cairns, moonstones);
    const best = l.best[s.level.id];
    const cairnLine = (cairns >= total && total > 0
      ? `You marked every cairn — <em>${total}</em>. The village is yours, stone and soul.`
      : `You marked <em>${cairns}</em> of ${total} cairns.`)
      + (s.cleansedCount ? ` The watch cleansed <em>${s.cleansedCount}</em> back to dark.` : "");
    const row = (label: string, val: string) => `<div><dt>${label}</dt><dd>${val}</dd></div>`;
    const breakdown =
      `<div class="legacy"><div class="legacy-head">Score</div><dl>` +
      row("Watch cut down", `${sc.base}`) +
      row("Speed", `${sc.speed}`) +
      row("Cairns marked", `${sc.cairns}`) +
      row("Survival", `${sc.survival}`) +
      (sc.untouched ? row("Untouched", `${sc.untouched}`) : "") +
      row("Village difficulty", `×${sc.mult}`) +
      row("<strong>Total</strong>", `<strong>${sc.total}</strong>`) +
      `</dl></div>`;
    showOverlay(
      "The hunt is yours",
      `Every soul of <em>${s.level.name}</em> is cut down — ${s.total} of them — ` +
      `in <em>${fmtTime(ms)}</em>.<br><br>` +
      `${cairnLine}<br><br>` +
      (best === ms ? `<em>A new best for this village.</em>` : `Best here: ${fmtTime(best)}.`) +
      ` <em>+${moonstones}</em> moonstones gathered.` +
      breakdown,
      "Hunt again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function onLost(): void {
    if (!s) return;
    const moonstones = s.slain * MOONSTONE_PER_KILL;
    recordFall(s.litCount, s.slain, moonstones);
    showOverlay(
      "You are brought down",
      `The watch of <em>${s.level.name}</em> dragged you down with ` +
      `<em>${aliveFoes(s)}</em> still abroad.` +
      `<br><br>You had cut down <em>${s.slain}</em> of ${s.total} and marked <em>${s.litCount}</em> cairns.<br><br>` +
      (moonstones > 0 ? `The blood you spilled leaves <em>+${moonstones}</em> moonstones behind. ` : ``) +
      `<em>The moon will rise again. Hunt again.</em>`,
      "Try again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function showPicker(selId?: string): void {
    s = null; running = false;
    introHold = false; clearTimeout(introHoldTimer);
    mmEl.style.display = "none";
    const l = loadWwLegacy();
    const sel = levelById(selId || "") || LEVELS[0];
    const card = sel.art ? `<img class="city-art" src="${sel.art}" alt="">` : "";
    let html =
      card +
      `<p class="lede">Choose a village to hunt. You begin a man and frail; stand still to ` +
      `bay at the moon and stoke your fury until you turn beast, then stand still as the ` +
      `wolf to rend the watch around you. Feed to hold the change, run the lanes, lurk in ` +
      `the fog, and cut down every soul to claim the village.</p><div class="cities">`;
    for (const lv of LEVELS) {
      const done = l.best[lv.id];
      const mark = done ? ` <span class="legacy-new">claimed ${fmtTime(done)}</span>` : "";
      html +=
        `<button class="city${lv.id === sel.id ? " sel" : ""}" data-id="${lv.id}">` +
        `<span class="city-name">${lv.name}${mark}</span>` +
        `<span class="city-line">${lv.epigraph}</span></button>`;
    }
    html += `</div>`;

    // The pelt shop — the unlockable wolf-form variants. Hunts bank moonstones; spend
    // them here to don a pelt, then equip it.
    html +=
      `<div class="legacy"><div class="legacy-head">` +
      `Pelts <span class="legacy-new">${l.moonstones} moonstones</span></div></div>` +
      `<div class="ptypes">`;
    for (const t of PELT_TYPES) {
      const owned = l.unlocked.includes(t.id);
      const equipped = l.equipped === t.id;
      const afford = l.moonstones >= t.cost;
      let badge: string, act: string, disabled = false;
      if (equipped) { badge = ` <span class="legacy-new">worn</span>`; act = ""; disabled = true; }
      else if (owned) { badge = ""; act = "equip"; }
      else if (afford) { badge = ` <span class="legacy-new">${t.cost} moonstones</span>`; act = "unlock"; }
      else { badge = ` <span class="ptype-cost">${t.cost} moonstones</span>`; act = ""; disabled = true; }
      const verb = act === "equip" ? "Wear" : act === "unlock" ? "Take" : equipped ? "Worn" : "Locked";
      html +=
        `<button class="ptype${equipped ? " sel" : ""}" data-id="${t.id}" data-act="${act}"${disabled ? " disabled" : ""}>` +
        `<span class="city-name"><span class="ptype-swatch" style="background:${t.star};box-shadow:0 0 6px ${t.ring}"></span>${t.name}${badge}</span>` +
        `<span class="city-line">${t.desc}</span>` +
        `<span class="ptype-verb">${verb}</span></button>`;
    }
    html += `</div>`;

    if (l.runs > 0) {
      html +=
        `<div class="legacy"><div class="legacy-head">Your hunts</div><dl>` +
        `<div><dt>Hunts</dt><dd>${l.runs}</dd></div>` +
        `<div><dt>Villages claimed</dt><dd>${l.hunts}</dd></div>` +
        `<div><dt>Cairns marked</dt><dd>${l.cairnsMarked}</dd></div>` +
        `<div><dt>Watch cut down</dt><dd>${l.slain}</dd></div></dl></div>`;
    }

    showOverlay(
      "The Moon's Hunger", html, `Hunt ${sel.name}`, () => startCity(sel),
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
        if (act === "unlock") { unlockPelt(id); equipPelt(id); }
        else if (act === "equip") equipPelt(id);
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
      `<img class="start-logo" src="./icons/werewolf-icon-192.png" alt="The Moon's Hunger">` +
      `<p class="frx-quote">“Even a man who is pure in heart, and says his prayers by night, may become a wolf when the wolfsbane blooms and the moon is full and bright.”</p>` +
      `<div class="start-share">` +
      `<button class="start-act" data-act="link">Share game link</button></div>`;
    showOverlay("The Moon's Hunger", body, "Begin the hunt", () => showPicker());
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
      try { await nav.share({ title: "The Moon's Hunger", text: "Turn beast under the moon and hunt the village watch.", url }); return; }
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
// Mirrors the siblings: a headless harness sets __WW_TEST__ and reads the sim off
// __ww instead of the shell ever starting.
const testGlobal = globalThis as unknown as {
  __WW_TEST__?: boolean;
  __ww?: Record<string, unknown>;
};
if (typeof globalThis !== "undefined" && testGlobal.__WW_TEST__) {
  testGlobal.__ww = {
    generateWerewolf, buildArena, freshHunt, stepHunt,
    stepMaw, firePulse, stepFoes, stepBolts, stepCairns, stepMists, stepMotes,
    stepFields, stepGeysers, stepGale, stepHoards, inNodeAura, inGlade, terrainSpeedMul,
    slay, hurtFoe, markCairn, cleanseCairn, nearScar, nearestFoe,
    inMist, inMoonwell, daylight, moonlightOf, moonWord,
    aliveFoes, clearedPct, furyReadout, scoreRun, difficultyMult,
    LEVELS, levelById,
    weaveSegments, closestOnSegment, segsCross, wallBetween, pushOut, pentagramPath,
    render, scaffold, scenerySprite, spriteFor,
    loadWwLegacy, saveWwLegacy, recordHunt, recordFall, emptyWwLegacy,
    PELT_TYPES, peltTypeById, unlockPelt, equipPelt,
    K: {
      W, H, HERO_HP, HERO_RADIUS, HERO_IFRAMES_MS, HERO_SPEED_HUMAN, HERO_SPEED_WOLF, HERO_KNOCKBACK,
      HERO_STILL_MAXSPEED, CHARGE_MS, MAW_BITE_AT, MAW_RADIUS, MAW_PULSE_MS,
      MAW_DMG, MAW_FURY_COST, SIGIL_SPIN, PULSE_FX_MS,
      OVERCHARGE_MS, OVERCHARGE_RADIUS_MUL, OVERCHARGE_FURY, TERROR_KNOCK,
      MOON_CYCLE_MS, MOON_START, FURY_RISE_MS, FURY_DRAIN_MS, FURY_PER_KILL,
      MOTE_DROP_CHANCE, MOTE_TTL_MS, MOTE_RADIUS, MOTE_FURY, HIT_FLASH_MS,
      FOE_HP, FOE_SPEED, FOE_RADIUS, FOE_CONTACT, FOE_ATTACK_CD,
      FOE_ATTACK_REACH, FOE_SEP, FOE_AGGRO, FOE_WANDER_SPEED, FOE_LEASH,
      FOE_PER_GREEN, CLEANUP_AGGRO_FRAC, RISE_MS, STEALTH_AGGRO_MUL,
      HOUND_HP_MUL, HOUND_SPEED_MUL, HOUND_CONTACT,
      KNIGHT_HP_MUL, KNIGHT_SPEED_MUL, KNIGHT_CONTACT,
      HUNTSMAN_HP_MUL, HUNTSMAN_SPEED_MUL, HUNTSMAN_RANGE, HUNTSMAN_STANDOFF, HUNTSMAN_SHOOT_CD,
      BOLT_SPEED, BOLT_DMG, BOLT_TTL_MS, BOLT_RADIUS,
      FRIAR_HP_MUL, FRIAR_SPEED_MUL, FRIAR_RANGE, FRIAR_STANDOFF, FRIAR_FURY_DRAIN,
      FRENZY_RANGE, FRENZY_DMG, MOONBLOOD_FURY,
      OBSTACLE_RADIUS, WALL_HALF, PATH_HALF, PATH_BOOST, MOONWELL_AURA, MIST_DRIFT,
      CAIRN_MARK_REACH, CAIRN_MARK_FURY, CAIRN_AURA, CAIRN_FURY_PER_SEC, CAIRN_DMG,
      CLEANSE_REACH, CLEANSE_MS, SCAR_RADIUS,
      PYRE_AURA, PYRE_DPS, WISP_AURA, WISP_DPS, MARSHFIRE_AURA, MARSHFIRE_DPS,
      BOG_AURA, BOG_SLOW, BRAMBLE_AURA, BRAMBLE_SLOW, GLADE_AURA,
      SPRING_AURA, SPRING_HEAL_DPS, SPRING_HEAL_CAP,
      GEYSER_CD, GEYSER_RADIUS, GEYSER_DMG, GALE_AURA, GALE_PUSH,
      WOLFSBANE_AURA, WOLFSBANE_DRAIN, HOARD_REACH, HOARD_FURY,
      SCORE_PER_KILL, SCORE_SURVIVAL_MAX, SCORE_UNTOUCHED,
      MOONSTONE_SCORE_DIV, MOONSTONE_PER_KILL,
    },
  };
} else {
  start();
}

// This trailing export makes werewolf.ts a *module* (its top-level names are
// module-scoped), so it compiles in the same project as app.ts (a classic global
// script) and its siblings without their identically-named declarations (W, el,
// render, start, LEVELS, …) colliding.
export {};
