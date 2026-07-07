// The Iron Rain — a sixth action spinoff of The Light-Bringer, set under the
// leaden skies of a world war.
//
// Where the siblings walk the ground — carrying flame, death, a Sign, or a curse —
// this one FLIES. You captain a heavy bomber over defended country; your targets
// are the WORKS below (factories, depots, hardened pens, airfields) and the ARMY
// COLUMNS crawling between them. Silence every target and the raid is done; lose
// your airframe to the guns and you go down.
//
// The defining twist is the BOMB RUN. The family verb — stand still to channel a
// sigil — is impossible for a plane that cannot stop, so it is inverted into the
// one thing only a bomber game would ask: HOLD A STRAIGHT AND LEVEL COURSE. Flying
// steady arms the bombsight (charge ramps); once armed, bombs release on a cadence
// and burst where the sight is laid. But the FLAK below leads your flight path —
// a straight run is a predictable run — so the whole game lives in the tension
// between holding the run and breaking it. Fighter squadrons scramble from their
// airfields to run you down; your own ESCORT fighters fly cover and tangle with
// them (the one hero in this repo that brings friends).
//
// This file is a self-contained TS MODULE (it ends with `export {};`) so its
// top-level names (W, render, start, LEVELS, …) are module-scoped and never
// collide with its siblings pentagram.ts / necro.ts / eldritch.ts / werewolf.ts.
// The page loads it with <script type="module">; the test loads it via dynamic
// import(). The simulation is pure and headless (RaidState in, mutation out); the
// render pass only reads it — the same split that lets the sibling tests drive
// the others lets bomber-test.mjs drive this. Sections below:
//   Types -> Tuning -> Bombers (the shop) -> Theatres (levels) -> Arena generation
//   -> Raid sim -> Sprites -> Render -> Game shell -> Legacy -> SW + test seam.

// ---------- Types ----------

type Phase = "raid" | "won" | "lost";

// The WORKS — static ground targets, the win gate (with the columns). An airfield
// is special: its grounded squadron burns with it if you bomb it before it
// scrambles — the raid's deepest strategic choice.
type StructKind = "factory" | "depot" | "pens" | "airfield";

// Cosmetic ground fabric — the country the war is happening to. Never bombable,
// never a target: fields, woods and towns are drawn and spared.
type GroundKind = "field" | "wood" | "town";

interface ScenNode { x: number; y: number; kind: GroundKind; seed: number }

// A static target. `hit` is the flash timestamp, mirroring the siblings' bodies.
interface Structure {
  x: number; y: number; kind: StructKind;
  hp: number; maxHp: number;
  dead: boolean;
  hit: number;
}

// An army column — a moving target that patrols between waypoints. The mirror of
// the siblings' wandering host, inverted: it flees nothing and hunts nothing; it
// simply keeps the war moving until you stop it.
interface Column {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  dead: boolean;
  hit: number;
  wpX: number; wpY: number; // current patrol waypoint
}

// A flak battery. Not part of the win gate — but bombable (a secondary objective,
// the wards/dwellings analog) and the raid's core threat: it fires a TELEGRAPHED
// shell at your PREDICTED position (it leads a straight run perfectly).
interface FlakGun {
  x: number; y: number;
  hp: number; maxHp: number;
  dead: boolean;
  hit: number;
  cd: number;          // ms until it can lay the next shell
  tracking?: boolean;  // transient (per-frame): the gun has the bomber in range
}

// A laid flak shell — it bursts at (x,y) when `at` matures. Drawn as a sharpening
// reticle while it climbs: the telegraph that makes flak dodgeable.
interface FlakShell { x: number; y: number; at: number }

// A released bomb — it falls for BOMB_FALL_MS and bursts at (x,y). `master` marks
// the blockbuster an overcharged run releases (the overcharge mirror).
interface Bomb { x: number; y: number; at: number; master: boolean }

// A fighter — axis interceptor or friendly escort, one shape, `axis` splits the
// sides. Axis fighters begin "base" (parked on their airfield, fieldIdx) and
// scramble to "fly"; escorts are always flying, holding formation slot `slot`.
interface Plane {
  x: number; y: number; vx: number; vy: number;
  hp: number; maxHp: number;
  dead: boolean;
  axis: boolean;
  state: "base" | "fly";
  fieldIdx: number;    // axis: index into s.structures of its home airfield (-1 = escort)
  slot: number;        // escort: its formation slot around the bomber
  attackCd: number;    // ms until it can fire again
  hit: number;         // s.elapsed until which it flashes from a fresh hit
  firing?: boolean;    // transient (per-frame): tracer FX
  fireX?: number; fireY?: number; // transient: tracer endpoint
}

// FX and pickups, drawn then faded — never persisted. A Burst is an explosion
// ring (bomb or flak); a Fire is the Firestorm's lingering incendiary ground; a
// Chute is a supply parachute a downed axis fighter may leave (catch it to patch
// the airframe — the clue-mote analog).
interface Burst { x: number; y: number; r: number; until: number; flak: boolean }
interface Fire { x: number; y: number; until: number }
interface Chute { x: number; y: number; until: number }

// A drifting cloud bank — the sky's mist: inside it flak can't lay shells on you
// and fighters hold their fire, but the bombsight can't see the ground either
// (the charge bleeds). Cover that costs you the run.
interface Cloud { x: number; y: number; r: number; vx: number; vy: number }

// A line segment — here only the STREAMS: high tailwind lanes that speed the
// bomber (the paths analog). Nothing in the sky blocks like a wall.
interface Segment { x1: number; y1: number; x2: number; y2: number }

// A river — purely atmospheric water (no collision), the siblings' pools.
interface Pool { x: number; y: number; rx: number; ry: number; seed: number }

// A defensive gun POST — a crewed turret mounted on the airframe (nose, dorsal,
// tail). Each bears on its own sector of the sky and, on its cadence, rakes the
// nearest axis fighter in range and arc. Three of them ring the bomber so it can
// answer the interceptors on its own (the escorts and the Fortress's gunners
// power are extra fire, not the only fire). `mount` is the offset along the
// fuselage (body frame, +forward); `sector`/`arc` are the bearing it can train
// on, relative to the nose. `firing`/`fireX`/`fireY` are transient tracer FX.
interface Post {
  mount: number;       // offset along the fuselage from the hull centre (+forward)
  sector: number;      // arc centre relative to the nose (0 = forward, PI = aft)
  arc: number;         // half-arc it can bear on (PI = an all-round turret)
  attackCd: number;    // ms until it can fire again
  firing?: boolean;    // transient (per-frame): tracer FX
  fireX?: number; fireY?: number; // transient: tracer endpoint
}

// The bomber. It can never stop: `heading`/`speed` integrate every frame (no
// input = cruise straight on). `charge` is the bombsight; `overcharge` banks a
// blockbuster past a full arm (any hard turn spends it).
interface Hero {
  x: number; y: number; vx: number; vy: number;
  heading: number;     // radians, the way the nose points
  speed: number;       // current airspeed, units/s
  hp: number; maxHp: number;
  hurt: number;        // remaining i-frame ms after a hit (0 = vulnerable)
  charge: number;      // 0..1 — how fully the bombsight is armed (ramps while steady)
  overcharge: number;  // 0..1 — banked past a full arm; the next bomb is a blockbuster
  bombCd: number;      // ms until the armed sight releases again (cadence)
  angle: number;       // the reticle's slow cosmetic spin, in degrees
  posts: Post[];       // the three defensive gun posts (nose/dorsal/tail)
}

interface RaidState {
  level: LevelDef;
  w: number; h: number;
  scenery: ScenNode[];   // cosmetic ground fabric (fields, woods, towns — spared)
  rivers: Pool[];        // cosmetic water
  structures: Structure[]; // static targets (win gate, with the columns)
  columns: Column[];     // moving targets (win gate)
  flak: FlakGun[];       // the guns (bombable; not required)
  balloons: { x: number; y: number }[]; // barrage balloons — the sky's only solids
  clouds: Cloud[];       // drifting cover that blinds the sight
  streams: Segment[];    // tailwind lanes the bomber rides
  hero: Hero;
  loadout: BomberType;   // the equipped airframe (resolved from the legacy at build)
  planes: Plane[];       // axis fighters AND friendly escorts (one roster, `axis` splits)
  bombs: Bomb[];
  shells: FlakShell[];
  bursts: Burst[];       // fading explosion FX
  fires: Fire[];         // incendiary ground (the Firestorm's power)
  chutes: Chute[];       // supply parachutes (catch to patch the airframe)
  alert: number;         // 0..1 — the defence's rousing: bombs raise it, time bleeds it
  elapsed: number;       // ms since the raid began (clear time)
  destroyed: number;     // targets silenced (structures + columns)
  total: number;         // the finite target list: silence them all to win
  flakTotal: number;     // batteries the theatre began with
  flakDown: number;      // batteries silenced (secondary objective)
  fightersDown: number;  // axis fighters downed in the air
  escortsTotal: number;  // escorts the raid began with
  hits: number;          // times the bomber has taken a hit
  phase: Phase;
}

interface Move { x: number; y: number } // normalized input vector, -1..1 each

// ---------- Tuning ----------
// The design surface. Balance changes should be constant changes here, the same
// ethos as the sibling games' tuning blocks.

const W = 1500;
const H = 2000;

// The bomber. It never stops — no input means cruise, straight on. Steering turns
// the nose toward the stick at TURN_RATE; full stick opens the throttle.
const SPEED_CRUISE = 170;        // hands-off airspeed, units/s (the bomber's floor)
const SPEED_MAX = 260;           // full-throttle airspeed
const TURN_RATE = 2.6;           // radians/s the nose can swing
const HERO_RADIUS = 18;
const HERO_HP = 100;
const HERO_IFRAMES_MS = 500;     // grace after a hit, no further damage

// The BOMB RUN — the weapon and the gate on every bomb. Holding a straight and
// level course (angular velocity under STEADY_TURN) ARMS the sight (charge ramps
// to 1); a hard turn lets it bleed (you dodge). Bombs release only once
// sufficiently armed — the same deliberate-channel verb the Vigil pioneered,
// turned on its head for a hero that cannot stand still. Cloud blinds the sight.
const STEADY_TURN = 0.9;         // rad/s — turn slower than this and the run holds
const SIGHT_CHARGE_MS = 1500;    // time flown steady to fully arm (and to bleed)
const SIGHT_ARM_AT = 0.65;       // the sight releases once at least this armed
const SIGHT_SPIN = 0.04;         // degrees of reticle rotation per ms (cosmetic)
const BOMB_CD_MS = 650;          // ms between releases while the sight holds
const BOMB_FALL_MS = 700;        // a bomb's fall before it bursts (the telegraph)
const BOMB_CARRY = 90;           // units ahead of the nose the sight is laid
const BOMB_RADIUS = 120;         // the burst's reach
const BOMB_DMG = 35;             // damage a burst deals to every target in reach
const BURST_FX_MS = 420;         // how long an explosion ring lingers

// Overcharge — the risk/reward on the core verb (mirror of the siblings'). Hold
// the run PAST a full arm and an overcharge banks (0→1 over SIGHT_OVERCHARGE_MS);
// any hard turn spends it back to nothing. The next release with a full bank is a
// BLOCKBUSTER: a far wider, far heavier burst. Hold the run longer — more power,
// and the flak has had longer to find your line.
const SIGHT_OVERCHARGE_MS = 1800; // time past a full arm to bank one blockbuster
const MASTER_RADIUS_MUL = 1.8;    // the blockbuster's reach × the bomb's
const MASTER_DMG_MUL = 2.2;       // …its damage ×

// FLAK — the raid's core threat, and the counter-pressure on the run. A battery
// with the bomber in range lays a shell at the bomber's PREDICTED position (led
// by its velocity over the fuse) plus scatter; the shell is telegraphed for the
// whole fuse, then bursts. Fly straight and the lead is perfect; jink and it
// bursts behind you. Punishes exactly what the bombsight demands.
const FLAK_RANGE = 430;          // a battery tracks a bomber within this
const FLAK_CD_MS = 1900;         // ms between a battery's shells (at zero alert)
const FLAK_FUSE_MS = 900;        // the shell's climb — the dodge window
const FLAK_BURST_R = 70;         // the burst's reach (bomber AND any fighter inside)
const FLAK_DMG = 16;             // damage the burst deals
const FLAK_SCATTER = 46;         // the lay's random spread (units)
const FLAK_HP = 60;              // a battery's hp (bombable)
const FLAK_RADIUS = 20;          // …its footprint for the blast reach

// ALERT — the defence's rousing (0..1). Every burst raises it; time bleeds it.
// High alert quickens the flak and stretches the fighters' scramble radius — so
// a raid breathes: strike, slip away, let the guns settle, strike again.
const ALERT_PER_BURST = 0.09;    // alert a bomb burst adds
const ALERT_DECAY = 0.03;        // alert shed per second
const ALERT_FLAK_HASTE = 1.9;    // at full alert a battery fires this × faster
const ALERT_SCRAMBLE_MUL = 0.9;  // at full alert the scramble radius grows this fraction

// FIGHTERS — the axis interceptors. Each airfield holds a grounded squadron that
// SCRAMBLES when the bomber comes inside its (alert-stretched) radar reach — or
// burns on the ground if you bomb the field first. A scrambled fighter runs the
// bomber down and fires in bursts; it tangles with an escort that presses it.
const FIGHTER_HP = 26;
const FIGHTER_SPEED = 300;       // faster than the bomber — you cannot outrun them
const FIGHTER_RANGE = 150;       // it fires within this of its mark
const FIGHTER_CD = 900;          // ms between its bursts
const FIGHTER_DMG = 7;           // damage a burst deals the bomber
const FIGHTER_DMG_PLANE = 9;     // …an escort
const FIGHTER_TANGLE_R = 200;    // an escort inside this pulls the fighter off the bomber
const SCRAMBLE_RANGE = 520;      // radar reach that scrambles a grounded squadron
const FIGHTER_PER_FIELD = 3;     // fighters each airfield holds
const PLANE_RADIUS = 11;
const PLANE_SEP = 40;            // fighters push apart within this (so they swarm, not stack)

// ESCORTS — your own fighters (the horde inverted into a wing). They hold a
// formation ring around the bomber and peel off to engage any axis fighter that
// enters the fray, then re-form. They can be shot down; bringing them home pays.
const ESCORT_HP = 30;
const ESCORT_SPEED = 310;
const ESCORT_RANGE = 140;        // it fires within this of its mark
const ESCORT_CD = 800;           // ms between its bursts
const ESCORT_DMG = 9;            // damage its burst deals
const ESCORT_ENGAGE_R = 560;     // it engages an axis fighter within this of the fray
const ESCORT_FORM_R = 95;        // the formation ring's radius around the bomber

// SHOOTING POSTS — the bomber's own defensive guns. Three crewed turrets ring
// the airframe (nose, dorsal, tail); each bears on its own sector of the sky and
// on its cadence rakes the nearest axis fighter within range and arc. Together
// they give the bomber all-round defensive fire so it can shoot the interceptors
// down itself, not merely outfly them. Built per-airframe in buildArena.
const TURRET_RANGE = 210;        // a post fires at an axis fighter within this
const TURRET_CD = 1000;          // ms between a post's bursts
const TURRET_DMG = 8;            // damage a post's burst deals a fighter
const TURRET_NOSE_ARC = 1.4;     // half-arc the nose/tail turrets can train on (~80°)

// Barrage balloons — the sky's only solids: tethered blimps every plane must
// weave around (the menhir analog, lifted a thousand feet).
const BALLOON_RADIUS = 26;

// Clouds — drifting banks: inside one the bomber is HIDDEN (flak can't lay a
// shell on it, fighters hold their fire and won't scramble to it) but the sight
// is BLIND (the charge bleeds). Cover that costs you the run.
const CLOUD_DRIFT = 12;          // a bank's drift speed, units/s

// Streams — high tailwind lanes the bomber rides (the paths analog).
const STREAM_HALF = 34;          // half-width of a lane
const STREAM_BOOST = 1.35;       // bomber speed multiplier while riding one

// Supply chutes — a downed axis fighter may leave one adrift; catching it
// patches the airframe. The mote analog, and the only mid-raid mending.
const CHUTE_DROP_CHANCE = 0.4;   // fraction of downed fighters that leave one
const CHUTE_TTL_MS = 8000;       // how long a chute drifts before it's lost
const CHUTE_RADIUS = 22;         // catch reach (over and above the hero's radius)
const PATCH_HEAL = 9;            // hp a caught chute restores

// Powers (the airframes' passives — see BOMBER_TYPES).
const GUNNER_R = 130;            // the Fortress's turrets rake fighters within this
const GUNNER_DPS = 14;           // …for this much a second
const EVASIVE_SCATTER_MUL = 2.1; // the Mosquito doubles the flak's scatter against it
const FIRE_TTL_MS = 6000;        // the Firestorm's incendiary ground lingers this long
const FIRE_R = 80;               // …its reach
const FIRE_DPS = 9;              // …its burn against ground targets inside

const COLUMN_SPEED = 30;         // an army column's crawl, units/s
const COLUMN_HP = 60;
const COLUMN_RADIUS = 24;        // its footprint for the blast reach

// Per-kind structure hp and blast footprint (the pens are hardened concrete).
const STRUCT_HP: Record<StructKind, number> = { factory: 110, depot: 70, pens: 170, airfield: 90 };
const STRUCT_RADIUS: Record<StructKind, number> = { factory: 30, depot: 26, pens: 34, airfield: 40 };

const HIT_FLASH_MS = 150;        // how long a body flashes from a fresh hit

// Scoring — a completed raid banks a score. Tuned for relationships, not
// magnitudes: faster pays, silencing the guns pays, bringing the escorts home
// pays, and a harder theatre multiplies it all. (Score feeds MEDALS — the
// currency for the airframe shop.)
const SCORE_PER_TARGET = 120;         // base, per target on the list
const SCORE_TARGET_PER_TARGET = 6000; // ms per target you're "expected" to take
const SCORE_SPEED_PER_SEC = 20;       // points per second cleared under that target
const SCORE_PER_FLAK = 40;            // per battery silenced (secondary objective)
const SCORE_ESCORT_MAX = 200;         // full points for every escort brought home
const SCORE_SURVIVAL_MAX = 220;       // full points for a whole airframe at the end
const SCORE_UNTOUCHED = 240;          // flawless bonus (no hit taken all raid)

// Medals — the cross-raid unlock currency (the embers/relics/lore/moonstones
// mirror). A completed raid banks a share of its score; even a raid that ends in
// the ground leaves the medals of the targets you silenced first.
const MEDAL_SCORE_DIV = 12;      // medals from a raid = score ÷ this (min 1)
const MEDAL_PER_TARGET = 1;      // medals a shoot-down still leaves, per target silenced

const BOMBER_LEGACY_KEY = "bomber.legacy.v1";

// ---------- Bombers (the airframe shop) ----------
// Each airframe bends the run's dials and carries a passive POWER, mirror of the
// Vigil's sigils / the Watcher's Signs. "none" is a plain stat-lean; "gunners"
// rakes fighters that press the bomber; "evasive" doubles the flak's scatter;
// "incendiary" leaves burning ground under every burst. Powers fire
// automatically — the only choice is which airframe to fly.
type BomberPower = "none" | "gunners" | "evasive" | "incendiary";

interface BomberType {
  id: string; name: string; desc: string; cost: number;
  radiusMul: number;   // burst reach        × BOMB_RADIUS
  chargeMul: number;   // arming time        × SIGHT_CHARGE_MS (a slower sight)
  pulseMul: number;    // release cadence    × BOMB_CD_MS
  dmgMul: number;      // burst damage       × BOMB_DMG
  speedMul: number;    // airspeed           × (cruise and max alike)
  hpMul: number;       // airframe           × HERO_HP
  power: BomberPower;  // the airframe's passive behaviour
  trim: string;        // the airframe's signature trim/tracer hue
  roundel: string;     // its roundel/marking hue
}

const BOMBER_TYPES: BomberType[] = [
  {
    id: "lanc", name: "The Lancaster", cost: 0,
    desc: "The steady workhorse you began the war with. Even reach, even bite, an honest airframe.",
    radiusMul: 1, chargeMul: 1, pulseMul: 1, dmgMul: 1, speedMul: 1, hpMul: 1, power: "none",
    trim: "#ffb84d", roundel: "#e8f2fa",
  },
  {
    id: "fortress", name: "The Fortress", cost: 120,
    desc: "A flying gun-platform — slow and heavy, hits harder, and its turret gunners rake any fighter that presses in close.",
    radiusMul: 1.1, chargeMul: 1.15, pulseMul: 1.15, dmgMul: 1.25, speedMul: 0.88, hpMul: 1.5, power: "gunners",
    trim: "#9fc0d8", roundel: "#e8f2fa",
  },
  {
    id: "mosquito", name: "The Mosquito", cost: 160,
    desc: "The wooden wonder — fast and frail, a quick sight and a light stick, and the flak's lead scatters wide against it.",
    radiusMul: 0.8, chargeMul: 0.6, pulseMul: 0.7, dmgMul: 0.7, speedMul: 1.25, hpMul: 0.7, power: "evasive",
    trim: "#9fe0a8", roundel: "#f2fae8",
  },
  {
    id: "firestorm", name: "The Firestorm", cost: 240,
    desc: "The incendiary ship — every burst leaves the ground burning, and what crawls through the fire does not crawl far. The capstone raid.",
    radiusMul: 1.2, chargeMul: 1.1, pulseMul: 1, dmgMul: 1, speedMul: 1, hpMul: 1, power: "incendiary",
    trim: "#ff7a4d", roundel: "#fae8d8",
  },
];

function bomberTypeById(id: string): BomberType {
  return BOMBER_TYPES.find((t) => t.id === id) || BOMBER_TYPES[0];
}

// ---------- Theatres (levels) ----------
// Hand-tuned raid theatres, the same generation-dial ethos the siblings use: how
// much country, how many works and columns, how thick the guns and the squadrons.

// A theatre's visual signature — palette and atmosphere, so each raid reads as
// its own country even in pure-vector (zero-PNG) mode. Pure data; render reads it.
interface RaidTheme {
  ground: string;       // the land's base tint
  field: string;        // farmland patch fill
  wood: string;         // woodland patch fill
  town: string;         // town roof fill (the country you spare)
  water: string;        // a river's core fill
  waterEdge: string;    // …its bank stroke
  riverCount: number;   // how many rivers wind through
  haze: string;         // an atmospheric wash over the whole country
  hazeOpacity: number;  // …its strength (0 = clear air)
}

interface LevelDef {
  id: string;
  name: string;
  epigraph: string;
  theme: RaidTheme;
  art?: string;          // optional establishing image (silent-fail)
  sceneryCount: number;  // cosmetic ground fabric (fields/woods/towns)
  minDist: number;
  factoryCount: number;  // the works — static targets (win gate)
  depotCount: number;
  pensCount: number;     // hardened pens (tough)
  airfieldCount: number; // airfields — each holds a grounded squadron
  columnCount: number;   // army columns on the move (win gate)
  flakCount: number;     // batteries (the guns)
  balloonCount: number;  // barrage balloons (aerial solids)
  cloudCount: number;    // drifting cover
  streamCount: number;   // tailwind lanes
  escortCount: number;   // your fighters this raid
  sizeScale?: number;    // arena size = W/H × this (default 1); leans the difficulty
}

const LEVELS: LevelDef[] = [
  {
    id: "channel",
    name: "The Channel Coast",
    epigraph: "Radar masts and coastal batteries on the grey water's edge. The guns are thin here and the squadrons green. A fair first raid.",
    theme: {
      ground: "#232a20", field: "#333d26", wood: "#1b271a", town: "#3c3626",
      water: "#16323f", waterEdge: "#3e708a", riverCount: 4,
      haze: "#8a98a2", hazeOpacity: 0.10,
    },
    sceneryCount: 96, minDist: 78,
    factoryCount: 2, depotCount: 3, pensCount: 0, airfieldCount: 1,
    columnCount: 2, flakCount: 5, balloonCount: 0, cloudCount: 4, streamCount: 5,
    escortCount: 3, sizeScale: 0.9,
  },
  {
    id: "yards",
    name: "The Marshalling Yards",
    epigraph: "A rail country feeding the front — sheds, sidings, and columns forever on the move. The guns are waking and the fighters fly in pairs.",
    theme: {
      ground: "#282318", field: "#3a3320", wood: "#221c12", town: "#40351f",
      water: "#183038", waterEdge: "#456a72", riverCount: 3,
      haze: "#8c8676", hazeOpacity: 0.11,
    },
    sceneryCount: 108, minDist: 72,
    factoryCount: 3, depotCount: 4, pensCount: 0, airfieldCount: 2,
    columnCount: 4, flakCount: 8, balloonCount: 2, cloudCount: 4, streamCount: 6,
    escortCount: 3, sizeScale: 1.0,
  },
  {
    id: "pens",
    name: "The U-Boat Pens",
    epigraph: "A harbour poured in concrete — the pens shrug off anything but a held run, the balloons ride thick, and the harbour guns never sleep.",
    theme: {
      ground: "#1e252a", field: "#28322f", wood: "#182521", town: "#31302c",
      water: "#123244", waterEdge: "#3e7088", riverCount: 6,
      haze: "#8896a2", hazeOpacity: 0.16,
    },
    sceneryCount: 100, minDist: 76,
    factoryCount: 2, depotCount: 2, pensCount: 3, airfieldCount: 2,
    columnCount: 2, flakCount: 12, balloonCount: 6, cloudCount: 5, streamCount: 4,
    escortCount: 4, sizeScale: 1.05,
  },
  {
    id: "ruhr",
    name: "The Ruhr Valley",
    epigraph: "The happy valley — the war's own forge, ringed in more guns than any sky in the world. Everything the defence has learned waits here.",
    theme: {
      ground: "#26221a", field: "#342c1b", wood: "#1f1c12", town: "#3c3226",
      water: "#16242e", waterEdge: "#42606f", riverCount: 4,
      haze: "#8a7e6a", hazeOpacity: 0.18,
    },
    sceneryCount: 116, minDist: 70,
    factoryCount: 4, depotCount: 3, pensCount: 2, airfieldCount: 3,
    columnCount: 5, flakCount: 16, balloonCount: 8, cloudCount: 6, streamCount: 5,
    escortCount: 4, sizeScale: 1.15,
  },
];

function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

// ---------- Arena generation ----------
// The same Poisson-disc-ish placement the siblings use: scatter the cosmetic
// country, then place the works, the columns, the guns clustered on what they
// defend, the balloons over the works, and the squadrons on their fields.

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Closest point on segment AB to P, and the distance to it — the workhorse for
// "is the bomber riding a stream?".
function closestOnSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { x: number; y: number; d: number } {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1);
  const x = ax + dx * t, y = ay + dy * t;
  return { x, y, d: Math.hypot(px - x, py - y) };
}

// String `count` line segments between pairs of scenery nodes whose gap falls in
// [lo, hi] — the streams. Pure geometry, mirrors the siblings' weaveSegments.
function weaveSegments(nodes: ScenNode[], count: number, lo: number, hi: number): Segment[] {
  const segs: Segment[] = [];
  if (nodes.length < 2) return segs;
  let guard = 0;
  while (segs.length < count && guard++ < count * 40) {
    const a = nodes[Math.floor(Math.random() * nodes.length)];
    let best: ScenNode | null = null, bestD = Infinity;
    for (const b of nodes) {
      if (b === a) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d >= lo && d <= hi && d < bestD) { bestD = d; best = b; }
    }
    if (best) segs.push({ x1: a.x, y1: a.y, x2: best.x, y2: best.y });
  }
  return segs;
}

// Push a flying body out of any balloon it has overlapped, then back inside the
// world bounds. The sky's whole collision model — nothing on the ground blocks it.
function pushOut(s: RaidState, x: number, y: number, radius: number): { x: number; y: number } {
  for (const b of s.balloons) {
    const rr = radius + BALLOON_RADIUS;
    let dx = x - b.x, dy = y - b.y;
    let d = Math.hypot(dx, dy);
    if (d >= rr) continue;
    if (d === 0) { dx = 1; dy = 0; d = 1; }
    x = b.x + (dx / d) * rr;
    y = b.y + (dy / d) * rr;
  }
  return { x: clamp(x, radius, s.w - radius), y: clamp(y, radius, s.h - radius) };
}

// Is (x,y) inside any cloud bank? (The hidden/blind predicate.)
function inCloud(s: RaidState, x: number, y: number): boolean {
  for (const c of s.clouds) {
    if (Math.hypot(x - c.x, y - c.y) <= c.r) return true;
  }
  return false;
}

// Build a fresh raid: lay the country, place the target list, cluster the guns,
// park the squadrons, and bring the bomber in over the southern edge with its
// escorts in formation.
function buildArena(level: LevelDef): RaidState {
  const w = Math.round(W * (level.sizeScale ?? 1));
  const h = Math.round(H * (level.sizeScale ?? 1));

  // The cosmetic country — fields, woods, and the towns you spare.
  const scenery: ScenNode[] = [];
  let guard = 0;
  while (scenery.length < level.sceneryCount && guard++ < 20000) {
    const x = 50 + Math.random() * (w - 100);
    const y = 50 + Math.random() * (h - 100);
    if (scenery.every((n) => (n.x - x) ** 2 + (n.y - y) ** 2 > level.minDist ** 2)) {
      const roll = Math.random();
      const kind: GroundKind = roll < 0.45 ? "field" : roll < 0.7 ? "wood" : "town";
      scenery.push({ x, y, kind, seed: Math.floor(Math.random() * 1000) });
    }
  }

  // Rivers — atmospheric only.
  const rivers: Pool[] = [];
  let rg = 0;
  while (rivers.length < level.theme.riverCount && rg++ < 600) {
    const rx = 70 + Math.random() * 140;
    const ry = rx * (0.3 + Math.random() * 0.4);
    const x = clamp(40 + Math.random() * (w - 80), rx, w - rx);
    const y = clamp(40 + Math.random() * (h - 80), ry, h - ry);
    rivers.push({ x, y, rx, ry, seed: Math.floor(Math.random() * 1000) });
  }

  // The bomber enters over the southern edge, nose north.
  const spawnX = w / 2, spawnY = h - 120;

  // Scatter `count` spots, spaced from each other and clear of the entry run.
  const TARGET_SPACING = 230;
  const spot = (spots: { x: number; y: number }[], spacing = TARGET_SPACING): { x: number; y: number } => {
    let g = 0;
    while (g++ < 4000) {
      const x = 90 + Math.random() * (w - 180);
      const y = 90 + Math.random() * (h - 260);
      if ((x - spawnX) ** 2 + (y - spawnY) ** 2 < 320 ** 2) continue;
      if (spots.every((p) => (p.x - x) ** 2 + (p.y - y) ** 2 > spacing ** 2)) return { x, y };
    }
    return { x: 90 + Math.random() * (w - 180), y: 90 + Math.random() * (h - 260) };
  };

  // The works — the static target list.
  const structures: Structure[] = [];
  const placed: { x: number; y: number }[] = [];
  const addStruct = (kind: StructKind, count: number): void => {
    for (let i = 0; i < count; i++) {
      const p = spot(placed);
      placed.push(p);
      const hp = STRUCT_HP[kind];
      structures.push({ x: p.x, y: p.y, kind, hp, maxHp: hp, dead: false, hit: 0 });
    }
  };
  addStruct("factory", level.factoryCount);
  addStruct("depot", level.depotCount);
  addStruct("pens", level.pensCount);
  addStruct("airfield", level.airfieldCount);

  // The columns — moving targets, each with a first waypoint.
  const columns: Column[] = [];
  for (let i = 0; i < level.columnCount; i++) {
    const p = spot(placed, 160);
    placed.push(p);
    columns.push({
      x: p.x, y: p.y, vx: 0, vy: 0,
      hp: COLUMN_HP, maxHp: COLUMN_HP, dead: false, hit: 0,
      wpX: 90 + Math.random() * (w - 180), wpY: 90 + Math.random() * (h - 180),
    });
  }

  // The guns — each battery digs in near a random work (it defends something).
  const flak: FlakGun[] = [];
  for (let i = 0; i < level.flakCount; i++) {
    const home = structures.length ? structures[Math.floor(Math.random() * structures.length)] : { x: w / 2, y: h / 2 };
    const a = Math.random() * Math.PI * 2;
    const r = 90 + Math.random() * 160;
    flak.push({
      x: clamp(home.x + Math.cos(a) * r, 40, w - 40),
      y: clamp(home.y + Math.sin(a) * r, 40, h - 40),
      hp: FLAK_HP, maxHp: FLAK_HP, dead: false, hit: 0, cd: Math.random() * FLAK_CD_MS,
    });
  }

  // Balloons — moored over the works.
  const balloons: { x: number; y: number }[] = [];
  for (let i = 0; i < level.balloonCount; i++) {
    const home = structures.length ? structures[Math.floor(Math.random() * structures.length)] : { x: w / 2, y: h / 2 };
    const a = Math.random() * Math.PI * 2;
    const r = 70 + Math.random() * 180;
    const x = clamp(home.x + Math.cos(a) * r, 60, w - 60);
    const y = clamp(home.y + Math.sin(a) * r, 60, h - 60);
    if ((x - spawnX) ** 2 + (y - spawnY) ** 2 < 260 ** 2) continue;
    balloons.push({ x, y });
  }

  // Clouds — drifting banks.
  const clouds: Cloud[] = [];
  for (let i = 0; i < level.cloudCount; i++) {
    const a = Math.random() * Math.PI * 2;
    clouds.push({
      x: 100 + Math.random() * (w - 200), y: 100 + Math.random() * (h - 200),
      r: 120 + Math.random() * 90,
      vx: Math.cos(a) * CLOUD_DRIFT, vy: Math.sin(a) * CLOUD_DRIFT,
    });
  }

  const streams = weaveSegments(scenery, level.streamCount, level.minDist * 3, level.minDist * 6);

  const legacy = loadBomberLegacy();
  const loadout = bomberTypeById(legacy.equipped);
  const hero: Hero = {
    x: spawnX, y: spawnY, vx: 0, vy: -SPEED_CRUISE,
    heading: -Math.PI / 2, speed: SPEED_CRUISE,
    hp: Math.round(HERO_HP * loadout.hpMul), maxHp: Math.round(HERO_HP * loadout.hpMul),
    hurt: 0, charge: 0, overcharge: 0, bombCd: 0, angle: 0,
    // The three defensive posts: a forward nose gun, an all-round dorsal turret,
    // and a rearward tail gun — together they cover the whole sky.
    posts: [
      { mount: HERO_RADIUS * 0.9, sector: 0, arc: TURRET_NOSE_ARC, attackCd: 0 },
      { mount: 0, sector: 0, arc: Math.PI, attackCd: 0 },
      { mount: -HERO_RADIUS * 1.05, sector: Math.PI, arc: TURRET_NOSE_ARC, attackCd: 0 },
    ],
  };

  // One roster of planes: the grounded axis squadrons, then the escorts in a
  // formation ring around the bomber.
  const planes: Plane[] = [];
  structures.forEach((st, si) => {
    if (st.kind !== "airfield") return;
    for (let j = 0; j < FIGHTER_PER_FIELD; j++) {
      const a = (j / FIGHTER_PER_FIELD) * Math.PI * 2;
      planes.push({
        x: clamp(st.x + Math.cos(a) * 26, PLANE_RADIUS, w - PLANE_RADIUS),
        y: clamp(st.y + Math.sin(a) * 26, PLANE_RADIUS, h - PLANE_RADIUS),
        vx: 0, vy: 0, hp: FIGHTER_HP, maxHp: FIGHTER_HP, dead: false,
        axis: true, state: "base", fieldIdx: si, slot: j, attackCd: 0, hit: 0,
      });
    }
  });
  for (let i = 0; i < level.escortCount; i++) {
    const a = (i / level.escortCount) * Math.PI * 2;
    planes.push({
      x: clamp(hero.x + Math.cos(a) * ESCORT_FORM_R, PLANE_RADIUS, w - PLANE_RADIUS),
      y: clamp(hero.y + Math.sin(a) * ESCORT_FORM_R, PLANE_RADIUS, h - PLANE_RADIUS),
      vx: 0, vy: 0, hp: ESCORT_HP, maxHp: ESCORT_HP, dead: false,
      axis: false, state: "fly", fieldIdx: -1, slot: i, attackCd: 0, hit: 0,
    });
  }

  return {
    level, w, h, scenery, rivers,
    structures, columns, flak, balloons, clouds, streams,
    hero, loadout, planes,
    bombs: [], shells: [], bursts: [], fires: [], chutes: [],
    alert: 0, elapsed: 0,
    destroyed: 0, total: structures.length + columns.length,
    flakTotal: flak.length, flakDown: 0, fightersDown: 0,
    escortsTotal: level.escortCount, hits: 0,
    phase: "raid",
  };
}

const freshRaid = buildArena; // alias, mirrors the siblings' freshGame naming

// ---------- Raid simulation (pure, headless-testable) ----------

function aliveTargets(s: RaidState): number {
  let n = 0;
  for (const t of s.structures) if (!t.dead) n++;
  for (const c of s.columns) if (!c.dead) n++;
  return n;
}

function clearedPct(s: RaidState): number {
  return s.total ? s.destroyed / s.total : 0;
}

function escortsAlive(s: RaidState): number {
  let n = 0;
  for (const p of s.planes) if (!p.axis && !p.dead) n++;
  return n;
}

// The HUD's secondary readout: the wing, the guns silenced, the defence's temper.
function raidReadout(s: RaidState): string {
  return `${escortsAlive(s)} escorts · ${s.flakDown}/${s.flakTotal} guns · alert ${Math.round(s.alert * 100)}%`;
}

function difficultyMult(level: LevelDef): number {
  const m = 0.8 + level.flakCount * 0.03 +
    level.airfieldCount * FIGHTER_PER_FIELD * 0.02 +
    level.pensCount * 0.03 + ((level.sizeScale ?? 1) - 1) * 0.5;
  return Math.round(m * 100) / 100;
}

interface ScoreBreakdown {
  base: number; speed: number; guns: number; escorts: number;
  survival: number; untouched: number; mult: number; total: number;
}
function scoreRun(s: RaidState): ScoreBreakdown {
  const base = s.total * SCORE_PER_TARGET;
  const target = s.total * SCORE_TARGET_PER_TARGET;
  const speed = Math.max(0, Math.round(((target - s.elapsed) / 1000) * SCORE_SPEED_PER_SEC));
  const guns = s.flakDown * SCORE_PER_FLAK;
  const escorts = s.escortsTotal
    ? Math.round((escortsAlive(s) / s.escortsTotal) * SCORE_ESCORT_MAX) : 0;
  const survival = Math.round((s.hero.hp / s.hero.maxHp) * SCORE_SURVIVAL_MAX);
  const untouched = s.hits === 0 ? SCORE_UNTOUCHED : 0;
  const mult = difficultyMult(s.level);
  const total = Math.round((base + speed + guns + escorts + survival + untouched) * mult);
  return { base, speed, guns, escorts, survival, untouched, mult, total };
}

// Centralized target-death path — every silencing (bomb, blockbuster, fire)
// counts the same. The mirror of the siblings' banish/killKnight. An airfield's
// grounded squadron burns with it — the raid's deepest strategic payoff.
function destroyTarget(s: RaidState, t: Structure | Column): void {
  if (t.dead) return;
  t.dead = true;
  s.destroyed += 1;
  const st = t as Structure;
  if (st.kind === "airfield") {
    const idx = s.structures.indexOf(st);
    for (const p of s.planes) {
      if (p.axis && p.state === "base" && p.fieldIdx === idx) p.dead = true;
    }
  }
}

// Centralized target-damage path. All bomb / blockbuster / fire damage routes here.
function hurtTarget(s: RaidState, t: Structure | Column, dmg: number): void {
  if (t.dead) return;
  t.hp -= dmg;
  t.hit = s.elapsed + HIT_FLASH_MS;
  if (t.hp <= 0) { t.hp = 0; destroyTarget(s, t); }
}

// A battery's own damage path — silenced guns count for the secondary objective.
function hurtFlak(s: RaidState, f: FlakGun, dmg: number): void {
  if (f.dead) return;
  f.hp -= dmg;
  f.hit = s.elapsed + HIT_FLASH_MS;
  if (f.hp <= 0) { f.hp = 0; f.dead = true; s.flakDown += 1; }
}

// The bomber's damage path — one gate, i-framed like every sibling hero.
function hurtBomber(s: RaidState, dmg: number): void {
  const h = s.hero;
  if (h.hurt > 0) return;
  h.hp -= dmg;
  h.hurt = HERO_IFRAMES_MS;
  s.hits += 1;
}

// A fighter's damage path (both sides) — and the downing that follows. A downed
// axis fighter may leave a supply chute adrift (the mote analog).
function hurtPlane(s: RaidState, p: Plane, dmg: number): void {
  if (p.dead) return;
  p.hp -= dmg;
  p.hit = s.elapsed + HIT_FLASH_MS;
  if (p.hp <= 0) { p.hp = 0; downPlane(s, p); }
}

function downPlane(s: RaidState, p: Plane): void {
  if (p.dead) return;
  p.dead = true;
  if (p.axis) {
    s.fightersDown += 1;
    if (Math.random() < CHUTE_DROP_CHANCE) {
      s.chutes.push({ x: p.x, y: p.y, until: s.elapsed + CHUTE_TTL_MS });
    }
  }
}

// Release one bomb from the armed sight — it falls, then bursts where it was
// laid (BOMB_CARRY ahead of the nose at release). A banked overcharge makes it a
// blockbuster and is spent. The deterministic heart of the weapon; stepSight
// gates and paces it, the test calls it directly.
function releaseBomb(s: RaidState): void {
  const h = s.hero;
  const master = h.overcharge >= 1;
  if (master) h.overcharge = 0;
  s.bombs.push({
    x: clamp(h.x + Math.cos(h.heading) * BOMB_CARRY, 0, s.w),
    y: clamp(h.y + Math.sin(h.heading) * BOMB_CARRY, 0, s.h),
    at: s.elapsed + BOMB_FALL_MS,
    master,
  });
}

// Pace the sight: only a sufficiently-armed run releases, and only on its cadence.
function stepSight(s: RaidState, dt = 16): void {
  const h = s.hero;
  if (h.charge < SIGHT_ARM_AT) return;
  h.bombCd -= dt;
  if (h.bombCd > 0) return;
  h.bombCd = BOMB_CD_MS * s.loadout.pulseMul;
  releaseBomb(s);
}

// A matured bomb bursts: AoE damage to every work, column and battery in reach,
// the alert rises, and the Firestorm leaves the ground burning.
function burstBomb(s: RaidState, b: Bomb): void {
  const radius = BOMB_RADIUS * s.loadout.radiusMul * (b.master ? MASTER_RADIUS_MUL : 1);
  const dmg = BOMB_DMG * s.loadout.dmgMul * (b.master ? MASTER_DMG_MUL : 1);
  for (const t of s.structures) {
    if (!t.dead && Math.hypot(t.x - b.x, t.y - b.y) <= radius + STRUCT_RADIUS[t.kind]) hurtTarget(s, t, dmg);
  }
  for (const c of s.columns) {
    if (!c.dead && Math.hypot(c.x - b.x, c.y - b.y) <= radius + COLUMN_RADIUS) hurtTarget(s, c, dmg);
  }
  for (const f of s.flak) {
    if (!f.dead && Math.hypot(f.x - b.x, f.y - b.y) <= radius + FLAK_RADIUS) hurtFlak(s, f, dmg);
  }
  if (s.loadout.power === "incendiary") {
    s.fires.push({ x: b.x, y: b.y, until: s.elapsed + FIRE_TTL_MS });
  }
  s.alert = Math.min(1, s.alert + ALERT_PER_BURST);
  s.bursts.push({ x: b.x, y: b.y, r: radius, until: s.elapsed + BURST_FX_MS, flak: false });
}

function stepBombs(s: RaidState): void {
  for (let i = s.bombs.length - 1; i >= 0; i--) {
    const b = s.bombs[i];
    if (b.at > s.elapsed) continue;
    s.bombs.splice(i, 1);
    burstBomb(s, b);
  }
}

// The columns crawl between waypoints — the war keeps moving until you stop it.
function stepColumns(s: RaidState, dt: number): void {
  for (const c of s.columns) {
    if (c.dead) continue;
    const dx = c.wpX - c.x, dy = c.wpY - c.y;
    const d = Math.hypot(dx, dy);
    if (d < 20) {
      c.wpX = 90 + Math.random() * (s.w - 180);
      c.wpY = 90 + Math.random() * (s.h - 180);
      continue;
    }
    c.vx = (dx / d) * COLUMN_SPEED;
    c.vy = (dy / d) * COLUMN_SPEED;
    c.x += (c.vx * dt) / 1000;
    c.y += (c.vy * dt) / 1000;
  }
}

// The guns. A live battery with the (un-hidden) bomber in range lays a shell at
// the bomber's PREDICTED position — velocity led over the fuse, plus scatter.
// The alert quickens the cadence. Fly straight and the lead is perfect.
function stepFlak(s: RaidState, dt: number): void {
  const h = s.hero;
  const hidden = inCloud(s, h.x, h.y);
  const cdMul = 1 / (1 + s.alert * (ALERT_FLAK_HASTE - 1));
  const scatter = FLAK_SCATTER * (s.loadout.power === "evasive" ? EVASIVE_SCATTER_MUL : 1);
  for (const f of s.flak) {
    if (f.dead) continue;
    if (f.cd > 0) f.cd -= dt;
    const d = Math.hypot(h.x - f.x, h.y - f.y);
    f.tracking = !hidden && d <= FLAK_RANGE;
    if (!f.tracking || f.cd > 0) continue;
    f.cd = FLAK_CD_MS * cdMul;
    const lead = FLAK_FUSE_MS / 1000;
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * scatter;
    s.shells.push({
      x: clamp(h.x + h.vx * lead + Math.cos(a) * r, 0, s.w),
      y: clamp(h.y + h.vy * lead + Math.sin(a) * r, 0, s.h),
      at: s.elapsed + FLAK_FUSE_MS,
    });
  }
}

// Matured shells burst — the flak is indiscriminate: the bomber AND any flying
// plane (either side) caught in the burst is wounded.
function stepShells(s: RaidState): void {
  for (let i = s.shells.length - 1; i >= 0; i--) {
    const sh = s.shells[i];
    if (sh.at > s.elapsed) continue;
    s.shells.splice(i, 1);
    if (Math.hypot(s.hero.x - sh.x, s.hero.y - sh.y) <= FLAK_BURST_R + HERO_RADIUS) {
      hurtBomber(s, FLAK_DMG);
    }
    for (const p of s.planes) {
      if (p.dead || p.state !== "fly") continue;
      if (Math.hypot(p.x - sh.x, p.y - sh.y) <= FLAK_BURST_R + PLANE_RADIUS) hurtPlane(s, p, FLAK_DMG);
    }
    s.bursts.push({ x: sh.x, y: sh.y, r: FLAK_BURST_R, until: s.elapsed + BURST_FX_MS, flak: true });
  }
}

// Move a flying body by a desired velocity, then push it out of the balloons.
function movePlane(s: RaidState, p: Plane, vx: number, vy: number, dt: number): void {
  p.vx = vx; p.vy = vy;
  const np = pushOut(s, p.x + (vx * dt) / 1000, p.y + (vy * dt) / 1000, PLANE_RADIUS);
  p.x = np.x; p.y = np.y;
}

// Separation: nudge a plane away from crowded neighbours so squadrons swarm
// rather than stacking into one point.
function separatePlanes(s: RaidState, p: Plane): { x: number; y: number } {
  let sx = 0, sy = 0;
  for (const o of s.planes) {
    if (o === p || o.dead || o.state !== "fly") continue;
    const dx = p.x - o.x, dy = p.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d > 0 && d < PLANE_SEP) { sx += (dx / d) * (PLANE_SEP - d); sy += (dy / d) * (PLANE_SEP - d); }
  }
  return { x: sx, y: sy };
}

// The air war. Grounded axis squadrons scramble when the (un-hidden) bomber
// comes inside their alert-stretched radar reach. A flying axis fighter runs the
// bomber down — unless an escort tangles with it, which pulls it off. Escorts
// engage the nearest axis fighter in the fray, else hold the formation ring.
function stepPlanes(s: RaidState, dt: number): void {
  const h = s.hero;
  const hidden = inCloud(s, h.x, h.y);
  const scrambleR = SCRAMBLE_RANGE * (1 + s.alert * ALERT_SCRAMBLE_MUL);
  for (const p of s.planes) {
    if (p.dead) continue;
    p.firing = false;
    if (p.attackCd > 0) p.attackCd -= dt;

    if (p.axis && p.state === "base") {
      if (!hidden && Math.hypot(h.x - p.x, h.y - p.y) <= scrambleR) p.state = "fly";
      else continue;
    }

    const sep = separatePlanes(s, p);

    if (p.axis) {
      // The escort tangling closest pulls the fighter off the bomber.
      let mark: Plane | null = null, bd = FIGHTER_TANGLE_R;
      for (const o of s.planes) {
        if (o.dead || o.axis) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bd) { bd = d; mark = o; }
      }
      const tx = mark ? mark.x : h.x, ty = mark ? mark.y : h.y;
      const dx = tx - p.x, dy = ty - p.y;
      const d = Math.hypot(dx, dy) || 1;
      movePlane(s, p, (dx / d) * FIGHTER_SPEED + sep.x, (dy / d) * FIGHTER_SPEED + sep.y, dt);
      if (d <= FIGHTER_RANGE && p.attackCd <= 0) {
        if (mark) {
          p.attackCd = FIGHTER_CD;
          p.firing = true; p.fireX = mark.x; p.fireY = mark.y;
          hurtPlane(s, mark, FIGHTER_DMG_PLANE);
        } else if (!hidden && h.hurt <= 0) {
          // The cooldown is only spent on a landed burst — a fighter pressing an
          // i-framed bomber keeps its guns ready (matching the siblings' melee).
          p.attackCd = FIGHTER_CD;
          p.firing = true; p.fireX = h.x; p.fireY = h.y;
          hurtBomber(s, FIGHTER_DMG);
        }
      }
      continue;
    }

    // Escort: engage the nearest flying axis fighter in the fray, else re-form.
    let mark: Plane | null = null, bd = Infinity;
    for (const o of s.planes) {
      if (o.dead || !o.axis || o.state !== "fly") continue;
      const dHero = Math.hypot(o.x - h.x, o.y - h.y);
      const dSelf = Math.hypot(o.x - p.x, o.y - p.y);
      if (Math.min(dHero, dSelf) <= ESCORT_ENGAGE_R && dSelf < bd) { bd = dSelf; mark = o; }
    }
    if (mark) {
      const dx = mark.x - p.x, dy = mark.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      movePlane(s, p, (dx / d) * ESCORT_SPEED + sep.x, (dy / d) * ESCORT_SPEED + sep.y, dt);
      if (d <= ESCORT_RANGE && p.attackCd <= 0) {
        p.attackCd = ESCORT_CD;
        p.firing = true; p.fireX = mark.x; p.fireY = mark.y;
        hurtPlane(s, mark, ESCORT_DMG);
      }
    } else {
      // Hold the formation slot — a ring around the bomber.
      const a = (p.slot / Math.max(1, s.escortsTotal)) * Math.PI * 2;
      const fx = h.x + Math.cos(a) * ESCORT_FORM_R;
      const fy = h.y + Math.sin(a) * ESCORT_FORM_R;
      const dx = fx - p.x, dy = fy - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const sp = Math.min(ESCORT_SPEED, d * 4 + Math.hypot(h.vx, h.vy));
      movePlane(s, p, (dx / d) * sp + sep.x, (dy / d) * sp + sep.y, dt);
    }
  }
}

// The bomber's own defensive posts. Each of the three turrets bears on its
// sector of the sky; on its cadence it picks the nearest flying axis fighter
// within range and arc and rakes it with a burst (a tracer to the mark). This is
// what lets the bomber answer the interceptors itself — the deterministic heart
// of the defensive guns, mirror of the escorts' engage-and-fire, run from the
// hull. Pure over state; the test drives it directly.
function stepPosts(s: RaidState, dt: number): void {
  const h = s.hero;
  for (const post of h.posts) {
    post.firing = false;
    if (post.attackCd > 0) post.attackCd -= dt;
    // The post's muzzle in world space (mounted along the fuselage).
    const px = h.x + Math.cos(h.heading) * post.mount;
    const py = h.y + Math.sin(h.heading) * post.mount;
    let mark: Plane | null = null, bd = Infinity;
    for (const p of s.planes) {
      if (p.dead || !p.axis || p.state !== "fly") continue;
      const dx = p.x - px, dy = p.y - py;
      const d = Math.hypot(dx, dy);
      if (d > TURRET_RANGE) continue;
      // Only if the fighter falls inside this post's bearing (arc about sector).
      if (Math.abs(angleDiff(Math.atan2(dy, dx), h.heading + post.sector)) > post.arc) continue;
      if (d < bd) { bd = d; mark = p; }
    }
    if (mark && post.attackCd <= 0) {
      post.attackCd = TURRET_CD;
      post.firing = true; post.fireX = mark.x; post.fireY = mark.y;
      hurtPlane(s, mark, TURRET_DMG);
    }
  }
}

// The Fortress's turret gunners rake any flying axis fighter that presses in
// close — continuous, charge-independent (the ally-emitter ethos, airborne).
function stepGunners(s: RaidState, dt: number): void {
  if (s.loadout.power !== "gunners") return;
  const h = s.hero;
  for (const p of s.planes) {
    if (p.dead || !p.axis || p.state !== "fly") continue;
    if (Math.hypot(p.x - h.x, p.y - h.y) <= GUNNER_R) hurtPlane(s, p, (GUNNER_DPS * dt) / 1000);
  }
}

// The Firestorm's incendiary ground gnaws every ground target inside it.
function stepFires(s: RaidState, dt: number): void {
  if (!s.fires.length) return;
  for (let i = s.fires.length - 1; i >= 0; i--) {
    const f = s.fires[i];
    if (f.until <= s.elapsed) { s.fires.splice(i, 1); continue; }
    const dmg = (FIRE_DPS * dt) / 1000;
    for (const t of s.structures) {
      if (!t.dead && Math.hypot(t.x - f.x, t.y - f.y) <= FIRE_R + STRUCT_RADIUS[t.kind]) hurtTarget(s, t, dmg);
    }
    for (const c of s.columns) {
      if (!c.dead && Math.hypot(c.x - f.x, c.y - f.y) <= FIRE_R + COLUMN_RADIUS) hurtTarget(s, c, dmg);
    }
    for (const g of s.flak) {
      if (!g.dead && Math.hypot(g.x - f.x, g.y - f.y) <= FIRE_R + FLAK_RADIUS) hurtFlak(s, g, dmg);
    }
  }
}

// Catch any supply chute the bomber flies over — it patches the airframe.
function stepChutes(s: RaidState): void {
  const h = s.hero;
  const reach = HERO_RADIUS + CHUTE_RADIUS;
  for (let i = s.chutes.length - 1; i >= 0; i--) {
    const c = s.chutes[i];
    if (c.until <= s.elapsed) { s.chutes.splice(i, 1); continue; }
    if (Math.hypot(c.x - h.x, c.y - h.y) <= reach) {
      h.hp = Math.min(h.maxHp, h.hp + PATCH_HEAL);
      s.chutes.splice(i, 1);
    }
  }
}

// Clouds drift and turn back at the world's edge.
function stepClouds(s: RaidState, dt: number): void {
  for (const c of s.clouds) {
    c.x += (c.vx * dt) / 1000;
    c.y += (c.vy * dt) / 1000;
    if (c.x < -c.r * 0.5 || c.x > s.w + c.r * 0.5) c.vx = -c.vx;
    if (c.y < -c.r * 0.5 || c.y > s.h + c.r * 0.5) c.vy = -c.vy;
  }
}

// The per-frame entry. Integrates the bomber (which can never stop), arms or
// bleeds the sight by how steady the run is, then runs the war below and around
// it, and checks the terminal states (shot down, or every target silenced).
function stepRaid(s: RaidState, dt: number, move: Move): void {
  if (s.phase !== "raid") return;
  s.elapsed += dt;
  const h = s.hero;

  // Steer: the nose swings toward the stick at TURN_RATE; full stick opens the
  // throttle. No input = cruise, straight on — a bomber cannot stop.
  const mag = Math.hypot(move.x, move.y);
  const prevHeading = h.heading;
  if (mag > 0.12) {
    const want = Math.atan2(move.y, move.x);
    const maxTurn = (TURN_RATE * dt) / 1000;
    h.heading += clamp(angleDiff(want, h.heading), -maxTurn, maxTurn);
    if (h.heading > Math.PI) h.heading -= Math.PI * 2;
    if (h.heading < -Math.PI) h.heading += Math.PI * 2;
  }
  const throttle = mag > 0.12 ? Math.min(1, mag) : 0;
  const onStream = s.streams.some(
    (p) => closestOnSegment(h.x, h.y, p.x1, p.y1, p.x2, p.y2).d <= STREAM_HALF,
  );
  h.speed = (SPEED_CRUISE + (SPEED_MAX - SPEED_CRUISE) * throttle) *
    (onStream ? STREAM_BOOST : 1) * s.loadout.speedMul;
  h.vx = Math.cos(h.heading) * h.speed;
  h.vy = Math.sin(h.heading) * h.speed;
  {
    const p = pushOut(s, h.x + (h.vx * dt) / 1000, h.y + (h.vy * dt) / 1000, HERO_RADIUS);
    h.x = p.x; h.y = p.y;
  }
  if (h.hurt > 0) h.hurt = Math.max(0, h.hurt - dt);

  // The bomb run: a steady course arms the sight, a hard turn bleeds it, and
  // cloud blinds it outright. Past a full arm the held run banks an overcharge
  // (the next release is a blockbuster, see releaseBomb).
  const turnRate = (Math.abs(angleDiff(h.heading, prevHeading)) / Math.max(1, dt)) * 1000;
  const blind = inCloud(s, h.x, h.y);
  const chargeMs = SIGHT_CHARGE_MS * s.loadout.chargeMul;
  if (turnRate < STEADY_TURN && !blind) {
    h.charge = Math.min(1, h.charge + dt / chargeMs);
    if (h.charge >= 1) h.overcharge = Math.min(1, h.overcharge + dt / SIGHT_OVERCHARGE_MS);
  } else {
    h.charge = Math.max(0, h.charge - dt / chargeMs);
    h.overcharge = 0; // a broken run spends the banked blockbuster back to nothing
  }
  h.angle = (h.angle + dt * SIGHT_SPIN) % 360;

  stepSight(s, dt);    // an armed run releases bombs on its cadence
  stepBombs(s);        // matured bombs burst on the works below
  stepColumns(s, dt);  // the columns crawl on
  stepFlak(s, dt);     // the guns lay shells on the bomber's predicted line
  stepShells(s);       // matured shells burst (bomber and planes alike)
  stepPlanes(s, dt);   // squadrons scramble, fighters press, escorts tangle
  stepPosts(s, dt);    // the bomber's own defensive posts rake the interceptors
  stepGunners(s, dt);  // the Fortress's turrets rake what presses in
  stepFires(s, dt);    // the Firestorm's ground burns on
  stepChutes(s);       // catch any supply chute adrift
  stepClouds(s, dt);   // the banks drift

  s.alert = Math.max(0, s.alert - (ALERT_DECAY * dt) / 1000);

  // Retire spent FX (cheap; only when any are live).
  if (s.bursts.length) s.bursts = s.bursts.filter((b) => b.until > s.elapsed);

  // Terminal: shot down (HP), or every target silenced (the raid is done).
  if (h.hp <= 0) { h.hp = 0; s.phase = "lost"; return; }
  if (aliveTargets(s) === 0) { s.phase = "won"; }
}

// ---------- Sprites (reused pattern from the siblings) ----------

const svgNS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K, attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// The sprites this spinoff may draw. Every one has a procedural fallback, so the
// game is fully playable with zero PNGs — none have shipped yet, so none are in
// sw.js (added when the art ships).
const SPRITE_NAMES = [
  "ground", "factory", "depot", "pens", "airfield", "flakgun", "balloon",
  "bomber", "fighter", "escort", "column",
] as const;

// Which sprites a theatre may re-skin (art/<theatreId>/<name>.png).
const CITY_SPRITES = new Set<string>(["ground", "factory", "depot", "pens", "airfield"]);

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

// The bombsight reticle — this spinoff's sigil, in place of the siblings' star
// and Sign. Pure geometry: an outer ring, an inner ring, four crosshair strokes
// that stop short of the centre (the Norden's clear heart), and eight tick marks
// on the outer ring. Authored in a unit circle, scaled to r, rotated by rotDeg
// and centred on (cx,cy). Returns one multi-subpath `d` string — stroked, never
// filled — and closes (ends in "Z") so it reads as a single laid sight.
function bombsightPath(cx: number, cy: number, r: number, rotDeg: number): string {
  const rot = (rotDeg * Math.PI) / 180;
  const cosR = Math.cos(rot), sinR = Math.sin(rot);
  const f = (n: number) => n.toFixed(1);
  const P = (ux: number, uy: number): [number, number] => {
    const x = ux * r, y = uy * r;
    return [cx + x * cosR - y * sinR, cy + x * sinR + y * cosR];
  };
  const seg = (ax: number, ay: number, bx: number, by: number): string => {
    const [x1, y1] = P(ax, ay), [x2, y2] = P(bx, by);
    return `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
  };
  const ring = (ur: number): string => {
    const [tx, ty] = P(0, -ur), [bx, by] = P(0, ur);
    const wr = ur * r;
    return `M${f(tx)} ${f(ty)}A${f(wr)} ${f(wr)} 0 1 1 ${f(bx)} ${f(by)}A${f(wr)} ${f(wr)} 0 1 1 ${f(tx)} ${f(ty)}`;
  };
  let d = ring(1) + ring(0.44);
  // Four crosshair strokes, stopped short of the clear heart.
  d += seg(0, -0.96, 0, -0.16);
  d += seg(0, 0.16, 0, 0.96);
  d += seg(-0.96, 0, -0.16, 0);
  d += seg(0.16, 0, 0.96, 0);
  // Eight tick marks on the outer ring.
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8;
    d += seg(Math.cos(a) * 0.88, Math.sin(a) * 0.88, Math.cos(a), Math.sin(a));
  }
  return d + "Z";
}

// A top-down aircraft silhouette — the procedural fallback for every plane. One
// half-outline (nose +x), mirrored across the fuselage axis, rotated to the
// heading. The heavy bomber gets a broader wing and tailplane than a fighter.
function planePath(cx: number, cy: number, heading: number, r: number, heavy: boolean): string {
  const span = heavy ? 1.05 : 0.78;
  const half: [number, number][] = [
    [1.05, 0], [0.62, 0.09], [0.3, 0.11],
    [0.2, span * 0.16], [-0.02, span], [-0.22, span * 0.94], [-0.1, 0.13],
    [-0.6, 0.09],
    [-0.74, (heavy ? 0.42 : 0.34)], [-0.92, (heavy ? 0.38 : 0.3)], [-0.86, 0.06],
    [-1.0, 0.05],
  ];
  const cosR = Math.cos(heading), sinR = Math.sin(heading);
  const pts: [number, number][] = [];
  for (const p of half) pts.push(p);
  for (let i = half.length - 1; i >= 0; i--) pts.push([half[i][0], -half[i][1]]);
  let d = "";
  pts.forEach(([ux, uy], i) => {
    const x = cx + (ux * cosR - uy * sinR) * r;
    const y = cy + (ux * sinR + uy * cosR) * r;
    d += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return d + "Z";
}

// ---------- Procedural aircraft & ordnance art (the redrawn fallbacks) ----------
//
// The zero-PNG art the game actually ships. Every airframe, gun and vehicle is
// authored in a LOCAL frame centred on (cx,cy) with the nose toward +x, then the
// whole group is rotated to the heading — far cleaner than rotating each point,
// and it lets a silhouette carry real detail (nacelles, canopy, roundels, tank
// turrets) that a single stroked outline never could. Shapes are placed at
// cx+u·r, cy+v·r so the rotate() pivots correctly around the centre.

// A rotated local group for one vehicle; children use pt()/local offsets in r-units.
function bodyGroup(cx: number, cy: number, headingRad: number): SVGGElement {
  const deg = (headingRad * 180) / Math.PI;
  return el("g", { transform: `rotate(${deg.toFixed(1)} ${cx.toFixed(2)} ${cy.toFixed(2)})` });
}

// The heavy bomber: a long fuselage, broad swept wing carrying four engine
// nacelles (each with an amber exhaust bloom), a tailplane and fin, a glass nose,
// and roundels — drawn in the airframe's own trim so each loadout reads distinct.
function bomberShape(
  cx: number, cy: number, heading: number, r: number,
  body: string, trim: string, roundel: string, flash: boolean,
): SVGGElement {
  const g = bodyGroup(cx, cy, heading);
  const X = (u: number) => (cx + u * r).toFixed(1);
  const Y = (v: number) => (cy + v * r).toFixed(1);
  const bf = flash ? "#ffffff" : body;
  // Cast shadow — a soft dark echo offset across the airframe axis, for lift.
  g.appendChild(el("ellipse", { cx: X(-0.08), cy: Y(0.14), rx: r * 0.95, ry: r * 0.34, fill: "#000", opacity: 0.28 }));
  // Main wing — swept trapezoid, tip to tip.
  g.appendChild(el("path", {
    d: `M${X(0.34)} ${Y(0)}L${X(0.02)} ${Y(-1.18)}L${X(-0.24)} ${Y(-1.18)}L${X(-0.06)} ${Y(0)}`
      + `L${X(-0.24)} ${Y(1.18)}L${X(0.02)} ${Y(1.18)}Z`,
    fill: bf, stroke: trim, "stroke-width": 1.3, "stroke-linejoin": "round",
  }));
  // Tailplane.
  g.appendChild(el("path", {
    d: `M${X(-0.7)} ${Y(0)}L${X(-0.92)} ${Y(-0.52)}L${X(-1.02)} ${Y(-0.5)}L${X(-0.92)} ${Y(0)}`
      + `L${X(-1.02)} ${Y(0.5)}L${X(-0.92)} ${Y(0.52)}Z`,
    fill: bf, stroke: trim, "stroke-width": 1, "stroke-linejoin": "round",
  }));
  // Fuselage — pointed nose, rounded tail.
  g.appendChild(el("path", {
    d: `M${X(1.2)} ${Y(0)}Q${X(0.9)} ${Y(-0.17)} ${X(0.2)} ${Y(-0.16)}`
      + `L${X(-1.0)} ${Y(-0.12)}Q${X(-1.14)} ${Y(0)} ${X(-1.0)} ${Y(0.12)}`
      + `L${X(0.2)} ${Y(0.16)}Q${X(0.9)} ${Y(0.17)} ${X(1.2)} ${Y(0)}Z`,
    fill: bf, stroke: trim, "stroke-width": 1.3, "stroke-linejoin": "round",
  }));
  // Fin — a thin spine along the tail.
  g.appendChild(el("path", {
    d: `M${X(-0.7)} ${Y(0)}L${X(-1.08)} ${Y(-0.05)}L${X(-1.08)} ${Y(0.05)}Z`,
    fill: trim, opacity: 0.8,
  }));
  // Four engine nacelles + exhaust bloom.
  for (const v of [-0.42, -0.78, 0.42, 0.78]) {
    g.appendChild(el("rect", {
      x: X(0.02), y: Y(v - 0.11), width: r * 0.34, height: r * 0.22, rx: r * 0.08,
      fill: flash ? "#fff" : "#20242a", stroke: trim, "stroke-width": 0.8,
    }));
    g.appendChild(el("circle", { cx: X(0.02), cy: Y(v), r: r * 0.1, fill: "#ffcaa0", opacity: 0.85, filter: "url(#glow)" }));
  }
  // Glass nose + cockpit spine.
  g.appendChild(el("ellipse", { cx: X(0.82), cy: Y(0), rx: r * 0.22, ry: r * 0.12, fill: "#bfe0f2", opacity: 0.7 }));
  // Roundels on each wing.
  for (const v of [-0.62, 0.62]) {
    g.appendChild(el("circle", { cx: X(-0.08), cy: Y(v), r: r * 0.13, fill: roundel, opacity: 0.9 }));
    g.appendChild(el("circle", { cx: X(-0.08), cy: Y(v), r: r * 0.06, fill: trim }));
  }
  return g;
}

// A single-engine fighter: sleeker swept wings, a bubble canopy, a spinner nose,
// and a tail. Axis ships are iron with a red spinner; escorts steel-blue with the
// wing's amber trim. Compact — half the bomber's span.
function fighterShape(
  cx: number, cy: number, heading: number, r: number, axis: boolean, flash: boolean,
): SVGGElement {
  const g = bodyGroup(cx, cy, heading);
  const X = (u: number) => (cx + u * r).toFixed(1);
  const Y = (v: number) => (cy + v * r).toFixed(1);
  const body = flash ? "#ffffff" : axis ? "#43474d" : "#5f7f97";
  const edge = axis ? "#22262b" : "#bcd6ea";
  const accent = axis ? "#ff5a4d" : "#ffce7a";
  g.appendChild(el("ellipse", { cx: X(-0.05), cy: Y(0.12), rx: r * 0.85, ry: r * 0.3, fill: "#000", opacity: 0.26 }));
  // Swept main wing.
  g.appendChild(el("path", {
    d: `M${X(0.28)} ${Y(0)}L${X(-0.18)} ${Y(-1.02)}L${X(-0.4)} ${Y(-1.0)}L${X(-0.12)} ${Y(0)}`
      + `L${X(-0.4)} ${Y(1.0)}L${X(-0.18)} ${Y(1.02)}Z`,
    fill: body, stroke: edge, "stroke-width": 1.1, "stroke-linejoin": "round",
  }));
  // Tailplane.
  g.appendChild(el("path", {
    d: `M${X(-0.78)} ${Y(0)}L${X(-1.0)} ${Y(-0.42)}L${X(-1.08)} ${Y(-0.4)}L${X(-0.95)} ${Y(0)}`
      + `L${X(-1.08)} ${Y(0.4)}L${X(-1.0)} ${Y(0.42)}Z`,
    fill: body, stroke: edge, "stroke-width": 0.9, "stroke-linejoin": "round",
  }));
  // Fuselage — a slim spindle.
  g.appendChild(el("path", {
    d: `M${X(1.12)} ${Y(0)}Q${X(0.6)} ${Y(-0.15)} ${X(-0.2)} ${Y(-0.13)}`
      + `L${X(-1.02)} ${Y(-0.07)}Q${X(-1.12)} ${Y(0)} ${X(-1.02)} ${Y(0.07)}`
      + `L${X(-0.2)} ${Y(0.13)}Q${X(0.6)} ${Y(0.15)} ${X(1.12)} ${Y(0)}Z`,
    fill: body, stroke: edge, "stroke-width": 1.1, "stroke-linejoin": "round",
  }));
  // Spinner nose (side accent) + bubble canopy.
  g.appendChild(el("circle", { cx: X(1.02), cy: Y(0), r: r * 0.11, fill: accent }));
  g.appendChild(el("ellipse", { cx: X(0.28), cy: Y(0), rx: r * 0.2, ry: r * 0.1, fill: "#cfe6f4", opacity: 0.72 }));
  return g;
}

// A crater with a lit rim and a drift of smoke — what a silenced target becomes.
// Scaled by `rad` (the target's footprint) so a pens crater dwarfs a flak pit.
function craterMark(cx: number, cy: number, rad: number): SVGGElement {
  const g = el("g", {});
  g.appendChild(el("circle", { cx, cy, r: rad, fill: "#07070a", opacity: 0.9 }));
  g.appendChild(el("circle", { cx, cy, r: rad, fill: "none", stroke: "#2a2620", "stroke-width": 2, opacity: 0.7 }));
  g.appendChild(el("circle", { cx, cy, r: rad * 0.5, fill: "#1a1512", opacity: 0.9 }));
  // Ember glow + smoke rising.
  g.appendChild(el("circle", { cx, cy, r: rad * 0.34, fill: "#7a3416", opacity: 0.5, filter: "url(#glow)" }));
  g.appendChild(el("ellipse", { cx: cx + rad * 0.2, cy: cy - rad * 0.8, rx: rad * 0.55, ry: rad * 0.4, fill: "#2a2e33", opacity: 0.45, filter: "url(#cloudBlur)" }));
  return g;
}

// ---------- Render (reads RaidState; wholesale rebuild each frame) ----------

// Built once: filters/gradients + the camera group. The palette is dusk steel
// and tracer amber, in place of the siblings' flame and witch-light.
function scaffold(svg: SVGSVGElement): SVGGElement {
  svg.innerHTML = "";
  const defs = el("defs", {});
  defs.innerHTML = `
    <filter id="glow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="3.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="cloudBlur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    <filter id="waterRipple" x="-25%" y="-25%" width="150%" height="150%">
      <feTurbulence type="fractalNoise" baseFrequency="0.014 0.022" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <radialGradient id="burstGlow">
      <stop offset="0%" stop-color="#fff3d8" stop-opacity="0.95"/>
      <stop offset="35%" stop-color="#ffb84d" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ff7a4d" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="flakPuff">
      <stop offset="0%" stop-color="#3a3f46" stop-opacity="0.9"/>
      <stop offset="60%" stop-color="#23272e" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#181c22" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fireGlow">
      <stop offset="0%" stop-color="#ffd88a" stop-opacity="0.7"/>
      <stop offset="55%" stop-color="#ff8a3c" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ff5a2c" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="chuteGlow">
      <stop offset="0%" stop-color="#eafff2" stop-opacity="1"/>
      <stop offset="45%" stop-color="#9fe0a8" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#9fe0a8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="spriteFadeGrad">
      <stop offset="0%" stop-color="#fff"/>
      <stop offset="58%" stop-color="#fff"/>
      <stop offset="98%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <mask id="spriteFade" maskContentUnits="objectBoundingBox">
      <circle cx="0.5" cy="0.5" r="0.5" fill="url(#spriteFadeGrad)"/>
    </mask>`;
  svg.appendChild(defs);
  const cam = el("g", {});
  svg.appendChild(cam);
  return cam;
}

const STRUCT_HUE: Record<StructKind, string> = {
  factory: "#595247", depot: "#554b3e", pens: "#464e57", airfield: "#4c5342",
};

// A cheap deterministic hash in [0,1) — scatters cosmetic detail without state.
function hash01(i: number): number {
  const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function render(s: RaidState, layer: SVGGElement): void {
  layer.innerHTML = "";
  const th = s.level.theme;

  // The land — base tint, then the cosmetic country.
  layer.appendChild(el("rect", { x: 0, y: 0, width: s.w, height: s.h, fill: th.ground }));
  const groundKey = spriteFor(s.level, "ground");
  if (groundKey) {
    layer.appendChild(el("rect", { x: 0, y: 0, width: s.w, height: s.h, fill: th.ground, opacity: 0.2 }));
  }
  // The cosmetic country. Each patch is authored for internal contrast — a
  // hedgerow border, plough furrows, a canopy's lit crown — so the land reads as
  // real farmland/woodland/village under the night without lifting its low value
  // (targets stay the bright focal points). th.wood doubles as the "shadow" tint
  // and th.field as the "moonlit" tint, so every patch stays in the theatre key.
  for (const n of s.scenery) {
    if (n.kind === "field") {
      const fw = wu(n.seed, 62, 54), fh = wu(n.seed + 3, 46, 44);
      const rot = Math.round(hash01(n.seed + 9) * 40 - 20);
      const g = el("g", { transform: `rotate(${rot} ${n.x} ${n.y})` });
      const x0 = n.x - fw / 2, y0 = n.y - fh / 2;
      // Plot fill + a dark hedgerow border ringing it.
      g.appendChild(el("rect", { x: x0, y: y0, width: fw, height: fh, rx: 5, fill: th.field, opacity: 0.82 }));
      g.appendChild(el("rect", { x: x0, y: y0, width: fw, height: fh, rx: 5, fill: "none", stroke: th.wood, "stroke-width": 2, opacity: 0.55 }));
      // Ploughed fields (most) carry furrows; the rest read as open pasture.
      if (hash01(n.seed + 13) > 0.32) {
        const rows = 4 + Math.floor(hash01(n.seed + 11) * 3);
        let d = "";
        for (let i = 1; i < rows; i++) {
          const fy = y0 + (fh * i) / rows;
          d += `M${(x0 + 3).toFixed(1)} ${fy.toFixed(1)}L${(x0 + fw - 3).toFixed(1)} ${fy.toFixed(1)}`;
        }
        g.appendChild(el("path", { d, stroke: th.wood, "stroke-width": 0.8, opacity: 0.32 }));
      }
      layer.appendChild(g);
    } else if (n.kind === "wood") {
      // A soft understory, a cluster of canopy puffs, each with a top-lit crown.
      const g = el("g", {});
      g.appendChild(el("ellipse", { cx: n.x, cy: n.y + 4, rx: 30, ry: 21, fill: "#000", opacity: 0.24 }));
      for (let i = 0; i < 6; i++) {
        const cx = n.x + (hash01(n.seed + i) - 0.5) * 58;
        const cy = n.y + (hash01(n.seed + i + 40) - 0.5) * 46;
        const r = 9 + hash01(n.seed + i + 80) * 10;
        g.appendChild(el("circle", { cx, cy, r, fill: th.wood, opacity: 0.92 }));
        g.appendChild(el("circle", { cx: cx - r * 0.26, cy: cy - r * 0.3, r: r * 0.48, fill: th.field, opacity: 0.15 }));
      }
      layer.appendChild(g);
    } else { // town — a spared village: a tight cluster of dark roofs on scuffed ground
      const g = el("g", {});
      g.appendChild(el("ellipse", { cx: n.x, cy: n.y + 3, rx: 26, ry: 17, fill: "#000", opacity: 0.2 }));
      const roofs = 5 + Math.floor(hash01(n.seed + 4) * 3);
      for (let i = 0; i < roofs; i++) {
        const rx = n.x + (hash01(n.seed + i) - 0.5) * 46;
        const ry = n.y + (hash01(n.seed + i + 20) - 0.5) * 38;
        const rw = 8 + hash01(n.seed + i + 60) * 5;
        const rh = 6 + hash01(n.seed + i + 70) * 3;
        const rot = Math.round(hash01(n.seed + i + 30) * 90 - 45);
        g.appendChild(el("rect", {
          x: rx - rw / 2, y: ry - rh / 2, width: rw, height: rh, rx: 1,
          fill: th.town, stroke: "#000", "stroke-width": 0.7, opacity: 0.94,
          transform: `rotate(${rot} ${rx} ${ry})`,
        }));
        // A pale ridge-line catches the moon along the roof's spine.
        g.appendChild(el("rect", {
          x: rx - rw / 2 + 1, y: ry - rh / 2, width: rw - 2, height: 1.3,
          fill: "#5a5140", opacity: 0.5, transform: `rotate(${rot} ${rx} ${ry})`,
        }));
      }
      layer.appendChild(g);
    }
  }

  // Rivers — cosmetic water with an organic shore.
  for (const p of s.rivers) {
    const g = el("g", { filter: "url(#waterRipple)" });
    g.appendChild(el("ellipse", { cx: p.x, cy: p.y, rx: p.rx, ry: p.ry, fill: th.water, opacity: 0.9 }));
    // A moonlit sheen — an offset lighter core so the water reads as a surface,
    // not a hole; then the bank stroke.
    g.appendChild(el("ellipse", {
      cx: p.x - p.rx * 0.14, cy: p.y - p.ry * 0.22, rx: p.rx * 0.62, ry: p.ry * 0.5,
      fill: th.waterEdge, opacity: 0.13,
    }));
    g.appendChild(el("ellipse", {
      cx: p.x, cy: p.y, rx: p.rx, ry: p.ry,
      fill: "none", stroke: th.waterEdge, "stroke-width": 2.5, opacity: 0.5,
    }));
    layer.appendChild(g);
  }

  // Streams — the high tailwind lanes, drawn as faint contrail bands.
  for (const p of s.streams) {
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#aebfd0", "stroke-width": STREAM_HALF * 2, "stroke-linecap": "round", opacity: 0.05,
    }));
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: "#cfe0ee", "stroke-width": 2, "stroke-linecap": "round",
      "stroke-dasharray": "14 18", opacity: 0.22,
    }));
  }

  // The Firestorm's incendiary ground.
  for (const f of s.fires) {
    layer.appendChild(el("circle", { cx: f.x, cy: f.y, r: FIRE_R, fill: "url(#fireGlow)" }));
  }

  // The works — each kind its own procedural mark on a dark footprint pad (which
  // seats it and lifts it clear of the near-black land); a crater once silenced.
  for (const t of s.structures) {
    const rw = STRUCT_RADIUS[t.kind];
    const key = spriteFor(s.level, t.kind);
    if (key && !t.dead) { layer.appendChild(spriteImage(key, t.x, t.y, rw * 2.8, 0.96)); }
    else if (t.dead) {
      layer.appendChild(craterMark(t.x, t.y, rw * 0.8));
    } else {
      const flash = t.hit > s.elapsed;
      const fill = flash ? "#fff" : STRUCT_HUE[t.kind];
      const rim = flash ? "#fff" : "#8a8276";
      // Footprint pad — a soft dark disc under every work for contrast/grounding.
      layer.appendChild(el("ellipse", { cx: t.x, cy: t.y + rw * 0.42, rx: rw * 1.06, ry: rw * 0.62, fill: "#050505", opacity: 0.5 }));
      if (t.kind === "factory") {
        // Main hall + sawtooth roof + two smoking chimneys.
        layer.appendChild(el("rect", { x: t.x - 27, y: t.y - 12, width: 54, height: 30, rx: 2, fill, stroke: rim, "stroke-width": 1.6 }));
        let saw = "";
        for (let i = 0; i < 4; i++) { const bx = t.x - 24 + i * 13; saw += `M${bx} ${t.y - 12}L${bx + 6} ${t.y - 20}L${bx + 13} ${t.y - 12}`; }
        layer.appendChild(el("path", { d: saw, fill: "none", stroke: rim, "stroke-width": 1.4, "stroke-linejoin": "round", opacity: 0.85 }));
        for (const cx of [t.x - 15, t.x - 1]) {
          layer.appendChild(el("rect", { x: cx, y: t.y - 34, width: 6, height: 22, fill: "#26221c", stroke: rim, "stroke-width": 1 }));
          layer.appendChild(el("ellipse", { cx: cx + 3, cy: t.y - 40, rx: 8, ry: 11, fill: "#2c3036", opacity: 0.4, filter: "url(#cloudBlur)" }));
        }
        // Lit window row — the forge burning inside.
        for (let i = 0; i < 5; i++) layer.appendChild(el("rect", { x: t.x - 22 + i * 10, y: t.y + 6, width: 5, height: 7, fill: "#ffb54a", opacity: 0.7 }));
      } else if (t.kind === "depot") {
        // Fuel tanks (cylinders, seen from above) + a crate stack.
        for (let i = 0; i < 3; i++) {
          const cy = t.y - 12 + i * 12;
          layer.appendChild(el("rect", { x: t.x - 24, y: cy - 5, width: 40, height: 10, rx: 5, fill, stroke: rim, "stroke-width": 1.2 }));
          layer.appendChild(el("line", { x1: t.x - 12, y1: cy - 5, x2: t.x - 12, y2: cy + 5, stroke: rim, "stroke-width": 0.8, opacity: 0.5 }));
        }
        layer.appendChild(el("rect", { x: t.x + 18, y: t.y - 12, width: 10, height: 10, fill: "#4a4238", stroke: rim, "stroke-width": 0.9 }));
        layer.appendChild(el("rect", { x: t.x + 18, y: t.y, width: 10, height: 10, fill: "#4a4238", stroke: rim, "stroke-width": 0.9 }));
      } else if (t.kind === "pens") {
        // Concrete apron over water + arched sub-pen mouths.
        layer.appendChild(el("rect", { x: t.x - 32, y: t.y - 20, width: 64, height: 40, rx: 5, fill, stroke: "#6b7683", "stroke-width": 2.6 }));
        layer.appendChild(el("rect", { x: t.x - 32, y: t.y - 20, width: 64, height: 6, rx: 3, fill: "#7a8592", opacity: 0.5 }));
        for (let i = 0; i < 3; i++) {
          const px = t.x - 22 + i * 16;
          layer.appendChild(el("path", { d: `M${px} ${t.y + 16}L${px} ${t.y - 2}A5 5 0 0 1 ${px + 10} ${t.y - 2}L${px + 10} ${t.y + 16}Z`, fill: "#0c1014" }));
          layer.appendChild(el("path", { d: `M${px + 1} ${t.y + 16}L${px + 1} ${t.y - 1}`, fill: "none", stroke: "#3a444f", "stroke-width": 1, opacity: 0.6 }));
        }
      } else { // airfield — crossed tarmac runways with markings + two hangars
        layer.appendChild(el("line", { x1: t.x - 38, y1: t.y + 11, x2: t.x + 38, y2: t.y - 11, stroke: "#2f342a", "stroke-width": 16, "stroke-linecap": "round" }));
        layer.appendChild(el("line", { x1: t.x - 21, y1: t.y - 21, x2: t.x + 21, y2: t.y + 21, stroke: "#2f342a", "stroke-width": 13, "stroke-linecap": "round" }));
        layer.appendChild(el("line", { x1: t.x - 30, y1: t.y + 8.6, x2: t.x + 30, y2: t.y - 8.6, stroke: "#5a6150", "stroke-width": 1.4, "stroke-dasharray": "7 8", opacity: 0.7 }));
        for (const [hx, hy] of [[t.x - 30, t.y - 24], [t.x + 20, t.y + 15]] as [number, number][]) {
          layer.appendChild(el("path", { d: `M${hx} ${hy + 11}L${hx} ${hy + 3}Q${hx + 7} ${hy - 3} ${hx + 14} ${hy + 3}L${hx + 14} ${hy + 11}Z`, fill, stroke: rim, "stroke-width": 1 }));
        }
      }
    }
    if (!t.dead && t.hp < t.maxHp) {
      const frac = Math.max(0, t.hp / t.maxHp);
      layer.appendChild(el("rect", { x: t.x - rw, y: t.y - rw - 9, width: rw * 2, height: 3.5, rx: 1.5, fill: "#0c1013" }));
      layer.appendChild(el("rect", { x: t.x - rw, y: t.y - rw - 9, width: rw * 2 * frac, height: 3.5, rx: 1.5, fill: "#ffb84d" }));
    }
  }

  // The columns — a short file of armour, each an olive tank hull with a turret
  // and a forward gun, oriented by travel; a crater once broken.
  for (const c of s.columns) {
    if (c.dead) {
      layer.appendChild(craterMark(c.x, c.y, 15));
      continue;
    }
    const a = Math.atan2(c.vy, c.vx);
    const flash = c.hit > s.elapsed;
    const key = spriteFor(s.level, "column");
    if (key) { layer.appendChild(spriteImage(key, c.x, c.y, COLUMN_RADIUS * 2.6, 0.96)); }
    else {
      const hull = flash ? "#fff" : "#42472f";
      for (let i = -1; i <= 1; i++) {
        const vx = c.x - Math.cos(a) * i * 17, vy = c.y - Math.sin(a) * i * 17;
        const g = bodyGroup(vx, vy, a);
        g.appendChild(el("ellipse", { cx: vx, cy: vy + 4, rx: 11, ry: 5, fill: "#000", opacity: 0.3 }));
        g.appendChild(el("rect", { x: vx - 9, y: vy - 6, width: 18, height: 12, rx: 2, fill: hull, stroke: "#191b12", "stroke-width": 1.2 }));
        // track treads (light/dark edges)
        g.appendChild(el("rect", { x: vx - 9, y: vy - 6, width: 18, height: 2, fill: "#23261a" }));
        g.appendChild(el("rect", { x: vx - 9, y: vy + 4, width: 18, height: 2, fill: "#23261a" }));
        // turret + barrel forward
        g.appendChild(el("circle", { cx: vx - 1, cy: vy, r: 4.5, fill: flash ? "#fff" : "#4e543a", stroke: "#191b12", "stroke-width": 1 }));
        g.appendChild(el("rect", { x: vx + 3, y: vy - 1, width: 11, height: 2, fill: "#2a2d1e" }));
        layer.appendChild(g);
      }
    }
    if (c.hp < c.maxHp) {
      const frac = Math.max(0, c.hp / c.maxHp);
      layer.appendChild(el("rect", { x: c.x - 18, y: c.y - 24, width: 36, height: 3, rx: 1.5, fill: "#0c1013" }));
      layer.appendChild(el("rect", { x: c.x - 18, y: c.y - 24, width: 36 * frac, height: 3, rx: 1.5, fill: "#ffb84d" }));
    }
  }

  // The guns — a sandbag revetment ringing an AA mount whose twin barrels swing
  // onto the bomber; a tracking gun glows red and throws a sight-line; crater when
  // silenced.
  for (const f of s.flak) {
    if (f.dead) {
      layer.appendChild(craterMark(f.x, f.y, 12));
      continue;
    }
    const flash = f.hit > s.elapsed;
    const key = spriteFor(s.level, "flakgun");
    if (key) { layer.appendChild(spriteImage(key, f.x, f.y, FLAK_RADIUS * 2.8, 0.96)); }
    else {
      const hot = f.tracking ? "#ff5a4d" : "#5a5348";
      const ba = Math.atan2(s.hero.y - f.y, s.hero.x - f.x);
      // Tracking sight-line — a faint lead toward the bomber before it lays a shell.
      if (f.tracking) {
        layer.appendChild(el("line", {
          x1: f.x, y1: f.y, x2: f.x + Math.cos(ba) * 46, y2: f.y + Math.sin(ba) * 46,
          stroke: "#ff5a4d", "stroke-width": 1, "stroke-dasharray": "3 6", opacity: 0.4,
        }));
      }
      // Sandbag ring (an octagon of segments) around a dark pit.
      layer.appendChild(el("circle", { cx: f.x, cy: f.y, r: 13, fill: "#191712", opacity: 0.9 }));
      let ring = "";
      for (let k = 0; k < 8; k++) { const ang = (k / 8) * Math.PI * 2; ring += `${k ? "L" : "M"}${(f.x + Math.cos(ang) * 13).toFixed(1)} ${(f.y + Math.sin(ang) * 13).toFixed(1)}`; }
      layer.appendChild(el("path", { d: ring + "Z", fill: "none", stroke: flash ? "#fff" : "#4a4236", "stroke-width": 3.4, "stroke-linejoin": "round", opacity: 0.9 }));
      // The gun mount + twin barrels, swung onto the target.
      const g = bodyGroup(f.x, f.y, ba);
      g.appendChild(el("circle", { cx: f.x, cy: f.y, r: 5.5, fill: flash ? "#fff" : "#2b2822", stroke: hot, "stroke-width": 1.4 }));
      g.appendChild(el("rect", { x: f.x, y: f.y - 2.6, width: 19, height: 1.8, rx: 0.9, fill: hot }));
      g.appendChild(el("rect", { x: f.x, y: f.y + 0.8, width: 19, height: 1.8, rx: 0.9, fill: hot }));
      layer.appendChild(g);
    }
    if (f.hp < f.maxHp) {
      const frac = Math.max(0, f.hp / f.maxHp);
      layer.appendChild(el("rect", { x: f.x - 13, y: f.y - 21, width: 26, height: 3, rx: 1.5, fill: "#160c0c" }));
      layer.appendChild(el("rect", { x: f.x - 13, y: f.y - 21, width: 26 * frac, height: 3, rx: 1.5, fill: "#ff5a4d" }));
    }
  }

  // Laid flak shells — the telegraph: a reticle sharpening toward the burst.
  for (const sh of s.shells) {
    const k = clamp(1 - (sh.at - s.elapsed) / FLAK_FUSE_MS, 0, 1);
    layer.appendChild(el("circle", {
      cx: sh.x, cy: sh.y, r: FLAK_BURST_R * (1.25 - 0.25 * k),
      fill: "none", stroke: "#ff5a4d", "stroke-width": 1.2 + k * 1.6,
      "stroke-dasharray": "5 7", opacity: 0.25 + 0.55 * k,
    }));
    layer.appendChild(el("circle", { cx: sh.x, cy: sh.y, r: 2.2, fill: "#ff5a4d", opacity: 0.4 + 0.5 * k }));
  }

  // Falling bombs — the laid point, marked and sharpening until the burst.
  for (const b of s.bombs) {
    const k = clamp(1 - (b.at - s.elapsed) / BOMB_FALL_MS, 0, 1);
    const rr = (BOMB_RADIUS * s.loadout.radiusMul * (b.master ? MASTER_RADIUS_MUL : 1)) * (0.35 + 0.65 * k);
    layer.appendChild(el("circle", {
      cx: b.x, cy: b.y, r: rr,
      fill: "none", stroke: s.loadout.trim, "stroke-width": 1.4 + k,
      opacity: 0.25 + 0.45 * k,
    }));
    layer.appendChild(el("circle", { cx: b.x, cy: b.y, r: 3 + 2 * k, fill: s.loadout.trim, opacity: 0.8 }));
  }

  // Bursts — bomb blooms in amber, flak puffs in iron-grey.
  for (const b of s.bursts) {
    const k = (b.until - s.elapsed) / BURST_FX_MS;
    if (b.flak) {
      layer.appendChild(el("circle", { cx: b.x, cy: b.y, r: b.r * (1.25 - k * 0.25), fill: "url(#flakPuff)", opacity: Math.max(0, k) }));
    } else {
      layer.appendChild(el("circle", { cx: b.x, cy: b.y, r: b.r * (1.1 - k * 0.3), fill: "url(#burstGlow)", opacity: Math.max(0, k) }));
      layer.appendChild(el("circle", {
        cx: b.x, cy: b.y, r: b.r * (1.05 - k * 0.18),
        fill: "none", stroke: "#ffb84d", "stroke-width": 2 + k * 3, opacity: Math.max(0, k) * 0.7, filter: "url(#glow)",
      }));
    }
  }

  // Supply chutes.
  for (const c of s.chutes) {
    layer.appendChild(el("circle", { cx: c.x, cy: c.y, r: 16, fill: "url(#chuteGlow)" }));
    layer.appendChild(el("path", {
      d: `M${c.x - 8} ${c.y - 2}A8 8 0 0 1 ${c.x + 8} ${c.y - 2}L${c.x + 2} ${c.y + 8}L${c.x - 2} ${c.y + 8}Z`,
      fill: "#e8f2fa", opacity: 0.85,
    }));
  }

  // Balloons — the tether mark on the ground, then the blimp at its collision
  // radius (visual == hitbox, the family's rule for solids).
  for (const b of s.balloons) {
    layer.appendChild(el("line", { x1: b.x - 6, y1: b.y + 6, x2: b.x + 6, y2: b.y - 6, stroke: "#3a3f46", "stroke-width": 2, opacity: 0.6 }));
    layer.appendChild(el("line", { x1: b.x - 6, y1: b.y - 6, x2: b.x + 6, y2: b.y + 6, stroke: "#3a3f46", "stroke-width": 2, opacity: 0.6 }));
    const key = spriteFor(s.level, "balloon");
    if (key) { layer.appendChild(spriteImage(key, b.x, b.y, BALLOON_RADIUS * 2.6, 0.96)); }
    else {
      // Tail fins first (behind the envelope), then the gasbag with a sheen.
      const fin = BALLOON_RADIUS;
      layer.appendChild(el("path", {
        d: `M${b.x + fin * 0.72} ${b.y}L${b.x + fin * 1.2} ${b.y - fin * 0.5}`
          + `L${b.x + fin * 1.14} ${b.y}L${b.x + fin * 1.2} ${b.y + fin * 0.5}Z`,
        fill: "#4a535e", stroke: "#7a8592", "stroke-width": 1,
      }));
      layer.appendChild(el("ellipse", {
        cx: b.x, cy: b.y, rx: BALLOON_RADIUS, ry: BALLOON_RADIUS * 0.72,
        fill: "#5a6470", stroke: "#8a95a2", "stroke-width": 2,
      }));
      // Longitudinal seam + a top sheen.
      layer.appendChild(el("path", { d: `M${b.x - BALLOON_RADIUS * 0.9} ${b.y}L${b.x + BALLOON_RADIUS * 0.72} ${b.y}`, stroke: "#3a4048", "stroke-width": 1, opacity: 0.5 }));
      layer.appendChild(el("ellipse", {
        cx: b.x - BALLOON_RADIUS * 0.3, cy: b.y - BALLOON_RADIUS * 0.26,
        rx: BALLOON_RADIUS * 0.36, ry: BALLOON_RADIUS * 0.2, fill: "#b7c6d6", opacity: 0.45,
      }));
    }
  }

  // Tracers — this frame's bursts of fire, both sides. A bright core over a
  // softer glow so a burst reads as a lick of fire, not a dashed line.
  for (const p of s.planes) {
    if (p.dead || !p.firing || p.fireX == null || p.fireY == null) continue;
    const hue = p.axis ? "#ff5a4d" : "#ffb84d";
    layer.appendChild(el("line", {
      x1: p.x, y1: p.y, x2: p.fireX, y2: p.fireY,
      stroke: hue, "stroke-width": 3.4, opacity: 0.3, "stroke-linecap": "round", filter: "url(#glow)",
    }));
    layer.appendChild(el("line", {
      x1: p.x, y1: p.y, x2: p.fireX, y2: p.fireY,
      stroke: "#fff6df", "stroke-width": 1.2, opacity: 0.85, "stroke-dasharray": "7 6", "stroke-linecap": "round",
    }));
  }

  // The bomber's own defensive posts — this frame's turret bursts, laid from each
  // muzzle to its mark (the loadout's tracer hue, so friendly fire reads as yours).
  for (const post of s.hero.posts) {
    if (!post.firing || post.fireX == null || post.fireY == null) continue;
    const px = s.hero.x + Math.cos(s.hero.heading) * post.mount;
    const py = s.hero.y + Math.sin(s.hero.heading) * post.mount;
    layer.appendChild(el("line", {
      x1: px, y1: py, x2: post.fireX, y2: post.fireY,
      stroke: s.loadout.trim, "stroke-width": 3, opacity: 0.28, "stroke-linecap": "round", filter: "url(#glow)",
    }));
    layer.appendChild(el("line", {
      x1: px, y1: py, x2: post.fireX, y2: post.fireY,
      stroke: "#fff6df", "stroke-width": 1.1, opacity: 0.8, "stroke-dasharray": "6 6", "stroke-linecap": "round",
    }));
  }

  // The planes — axis fighters in iron with a red spinner, escorts steel-blue
  // with the wing's amber trim; a grounded squadron sits dimmed until it scrambles.
  for (const p of s.planes) {
    if (p.dead) continue;
    const flash = p.hit > s.elapsed;
    const grounded = p.state === "base";
    const heading = grounded ? -Math.PI / 2 : Math.atan2(p.vy, p.vx || 0.001);
    const key = spriteFor(s.level, p.axis ? "fighter" : "escort");
    if (key) { layer.appendChild(spriteImage(key, p.x, p.y, PLANE_RADIUS * 3, grounded ? 0.7 : 0.96)); }
    else {
      const shape = fighterShape(p.x, p.y, heading, PLANE_RADIUS * 1.5, p.axis, flash);
      if (grounded) shape.setAttribute("opacity", "0.6");
      layer.appendChild(shape);
    }
    if (!grounded && p.hp < p.maxHp) {
      const frac = Math.max(0, p.hp / p.maxHp);
      layer.appendChild(el("rect", { x: p.x - 11, y: p.y - 19, width: 22, height: 2.5, rx: 1.2, fill: "#0c1013" }));
      layer.appendChild(el("rect", { x: p.x - 11, y: p.y - 19, width: 22 * frac, height: 2.5, rx: 1.2, fill: p.axis ? "#ff5a4d" : "#9fe0a8" }));
    }
  }

  // The bomber — the sight laid ahead of the nose, then the airframe.
  const h = s.hero;
  if (h.charge > 0.02) {
    const armed = h.charge >= SIGHT_ARM_AT;
    const lx = h.x + Math.cos(h.heading) * BOMB_CARRY;
    const ly = h.y + Math.sin(h.heading) * BOMB_CARRY;
    const rr = BOMB_RADIUS * s.loadout.radiusMul * (h.overcharge >= 1 ? MASTER_RADIUS_MUL : 1);
    layer.appendChild(el("path", {
      d: bombsightPath(lx, ly, 20 + rr * 0.28 * h.charge, h.angle),
      fill: "none", stroke: s.loadout.trim, "stroke-width": 1.4 + 1.6 * h.charge,
      opacity: 0.3 + 0.6 * h.charge, filter: "url(#glow)",
    }));
    if (armed) {
      layer.appendChild(el("circle", {
        cx: lx, cy: ly, r: rr * h.charge,
        fill: "none", stroke: s.loadout.trim, "stroke-width": 1.2,
        "stroke-dasharray": "4 9", opacity: 0.35,
      }));
    }
    if (h.overcharge > 0) {
      layer.appendChild(el("circle", {
        cx: h.x, cy: h.y, r: 30 + 7 * h.overcharge,
        fill: "none", stroke: "#fff", "stroke-width": 1.5, opacity: 0.3 + 0.5 * h.overcharge,
        "stroke-dasharray": "3 6",
      }));
    }
  }
  const hbKey = spriteFor(s.level, "bomber");
  if (hbKey) { layer.appendChild(spriteImage(hbKey, h.x, h.y, HERO_RADIUS * 3.2, 1)); }
  else {
    const hurtFlash = h.hurt > 0 && Math.floor(s.elapsed / 80) % 2 === 0;
    const body = hurtFlash ? "#ffd0d0" : "#5c6a58";
    layer.appendChild(bomberShape(h.x, h.y, h.heading, HERO_RADIUS * 1.35, body, s.loadout.trim, s.loadout.roundel, hurtFlash));
    // The three gun posts — a dark blister at each mount, glinting when it fires.
    for (const post of h.posts) {
      const px = h.x + Math.cos(h.heading) * post.mount;
      const py = h.y + Math.sin(h.heading) * post.mount;
      layer.appendChild(el("circle", {
        cx: px, cy: py, r: 2.8,
        fill: post.firing ? "#fff6df" : "#2b3130",
        stroke: post.firing ? s.loadout.trim : "#151a19", "stroke-width": 1,
      }));
    }
  }

  // Clouds — drawn OVER the planes: the world disappears into them, and so do you.
  for (const c of s.clouds) {
    const g = el("g", { filter: "url(#cloudBlur)", "pointer-events": "none" });
    g.appendChild(el("ellipse", { cx: c.x, cy: c.y, rx: c.r, ry: c.r * 0.74, fill: "#c8d2dc", opacity: 0.4 }));
    g.appendChild(el("ellipse", { cx: c.x - c.r * 0.4, cy: c.y + c.r * 0.16, rx: c.r * 0.6, ry: c.r * 0.4, fill: "#aebfd0", opacity: 0.32 }));
    g.appendChild(el("ellipse", { cx: c.x + c.r * 0.36, cy: c.y - c.r * 0.1, rx: c.r * 0.55, ry: c.r * 0.42, fill: "#d8e2ea", opacity: 0.3 }));
    layer.appendChild(g);
  }

  // Haze — the theatre's atmosphere, washed over everything.
  if (th.hazeOpacity > 0) {
    layer.appendChild(el("rect", {
      x: 0, y: 0, width: s.w, height: s.h, fill: th.haze,
      opacity: th.hazeOpacity * 0.6, "pointer-events": "none",
    }));
  }
}

// A tiny width helper for the field patches (deterministic off the seed).
function wu(seed: number, base: number, spread: number): number {
  return base + hash01(seed) * spread;
}

// ---------- Legacy (cross-raid record, in its own key) ----------

interface BomberLegacy {
  runs: number;         // raids flown
  raids: number;        // raids completed (wins)
  best: Record<string, number>; // best clear time per theatre id
  targetsDestroyed: number; // lifetime targets silenced
  fightersDowned: number;   // lifetime axis fighters downed
  medals: number;       // the unlock currency
  unlocked: string[];   // owned airframe ids
  equipped: string;     // the equipped airframe id
}

function emptyBomberLegacy(): BomberLegacy {
  return {
    runs: 0, raids: 0, best: {}, targetsDestroyed: 0, fightersDowned: 0,
    medals: 0, unlocked: ["lanc"], equipped: "lanc",
  };
}

function loadBomberLegacy(): BomberLegacy {
  const base = emptyBomberLegacy();
  try {
    const raw = localStorage.getItem(BOMBER_LEGACY_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<BomberLegacy>;
    const l: BomberLegacy = {
      runs: p.runs ?? 0,
      raids: p.raids ?? 0,
      best: p.best ?? {},
      targetsDestroyed: p.targetsDestroyed ?? 0,
      fightersDowned: p.fightersDowned ?? 0,
      medals: p.medals ?? 0,
      unlocked: Array.isArray(p.unlocked) && p.unlocked.length ? p.unlocked.slice() : ["lanc"],
      equipped: p.equipped ?? "lanc",
    };
    if (!l.unlocked.includes("lanc")) l.unlocked.unshift("lanc");
    if (!l.unlocked.includes(l.equipped)) l.equipped = "lanc";
    return l;
  } catch {
    return base;
  }
}

function saveBomberLegacy(l: BomberLegacy): void {
  try { localStorage.setItem(BOMBER_LEGACY_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}

// Fold a completed raid (a win) into the legacy — write-once at the end transition.
function recordRaid(level: LevelDef, ms: number, targets = 0, medals = 0, fighters = 0): BomberLegacy {
  const l = loadBomberLegacy();
  l.runs += 1; l.raids += 1;
  l.targetsDestroyed += targets;
  l.fightersDowned += fighters;
  l.medals += medals;
  const prev = l.best[level.id];
  if (prev == null || ms < prev) l.best[level.id] = ms;
  saveBomberLegacy(l);
  return l;
}

// Fold a shoot-down (a loss) — bumps the run count and banks what was silenced
// first, but no completed raid and no best.
function recordDown(targets = 0, fighters = 0, medals = 0): BomberLegacy {
  const l = loadBomberLegacy();
  l.runs += 1;
  l.targetsDestroyed += targets;
  l.fightersDowned += fighters;
  l.medals += medals;
  saveBomberLegacy(l);
  return l;
}

function unlockBomber(id: string): BomberLegacy {
  const l = loadBomberLegacy();
  const t = BOMBER_TYPES.find((x) => x.id === id);
  if (t && !l.unlocked.includes(id) && l.medals >= t.cost) {
    l.medals -= t.cost; l.unlocked.push(id);
    saveBomberLegacy(l);
  }
  return l;
}

function equipBomber(id: string): BomberLegacy {
  const l = loadBomberLegacy();
  if (l.unlocked.includes(id)) { l.equipped = id; saveBomberLegacy(l); }
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
  const sightFill = byId("sight");
  const foesEl = byId("foes");
  const wingEl = byId("souls");
  const cityEl = byId("cityname");
  const toastEl = byId("toast");
  const stickEl = byId("stick");
  const stickKnob = byId("stick-knob");
  const mmEl = byId("minimap") as unknown as SVGSVGElement;
  const headerEl = document.querySelector("header") as HTMLElement | null;

  const layer = scaffold(svg);
  let s: RaidState | null = null;

  // ----- Camera: follows the bomber; pinch / wheel zoom. -----
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
    cam.k = Math.min(maxK, Math.max(minK, m / 700));
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
  window.addEventListener("blur", () => {
    // Drop every live input, not just the keyboard: a pointer capture lost to
    // the blur would otherwise leave the joystick vector stuck and the bomber
    // banking on its own when focus returns.
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
    sightFill.style.width = Math.max(0, s.hero.charge * 100) + "%";
    cityEl.textContent = s.level.name;
    wingEl.textContent = raidReadout(s);
    const alive = aliveTargets(s);
    let foes = alive > 0 ? `Silence ${alive} / ${s.total}` : `Raid complete`;
    if (alive > 0 && alive <= 4) {
      let bx = 0, by = 0, bd = Infinity;
      for (const t of s.structures) {
        if (t.dead) continue;
        const d = (t.x - s.hero.x) ** 2 + (t.y - s.hero.y) ** 2;
        if (d < bd) { bd = d; bx = t.x; by = t.y; }
      }
      for (const c of s.columns) {
        if (c.dead) continue;
        const d = (c.x - s.hero.x) ** 2 + (c.y - s.hero.y) ** 2;
        if (d < bd) { bd = d; bx = c.x; by = c.y; }
      }
      if (bd < Infinity) {
        const ang = Math.atan2(by - s.hero.y, bx - s.hero.x);
        foes += ` ${ARROWS[(((Math.round(ang / (Math.PI / 4))) % 8) + 8) % 8]}`;
      }
    }
    foesEl.textContent = foes;
  }

  const MM_MAX = 96;
  let mmTick = 0;
  function minimap(): void {
    if (!s || s.phase !== "raid") { mmEl.style.display = "none"; return; }
    if (mmTick++ % 5 !== 0) return;
    const scale = Math.min(MM_MAX / s.w, MM_MAX / s.h);
    const mw = s.w * scale, mh = s.h * scale;
    mmEl.style.display = "block";
    mmEl.style.top = `${(headerEl ? headerEl.offsetHeight : 50) + 6}px`;
    mmEl.style.width = `${mw.toFixed(1)}px`;
    mmEl.style.height = `${mh.toFixed(1)}px`;
    mmEl.setAttribute("viewBox", `0 0 ${mw.toFixed(1)} ${mh.toFixed(1)}`);
    mmEl.innerHTML = "";
    mmEl.appendChild(el("rect", { x: 0, y: 0, width: mw, height: mh, fill: "#0a0e12", opacity: 0.5 }));
    for (const t of s.structures) {
      if (t.dead) continue;
      mmEl.appendChild(el("rect", {
        x: t.x * scale - 1.6, y: t.y * scale - 1.6, width: 3.2, height: 3.2,
        fill: "#ffb84d", opacity: 0.95,
      }));
    }
    for (const c of s.columns) {
      if (c.dead) continue;
      mmEl.appendChild(el("circle", { cx: c.x * scale, cy: c.y * scale, r: 1.5, fill: "#d0b060", opacity: 0.95 }));
    }
    for (const f of s.flak) {
      if (f.dead) continue;
      mmEl.appendChild(el("circle", { cx: f.x * scale, cy: f.y * scale, r: 1.2, fill: "#ff5a4d", opacity: 0.8 }));
    }
    for (const p of s.planes) {
      if (p.dead || p.state !== "fly") continue;
      mmEl.appendChild(el("circle", {
        cx: p.x * scale, cy: p.y * scale, r: 1.2,
        fill: p.axis ? "#ff8a7a" : "#9fe0a8", opacity: 0.9,
      }));
    }
    const vw = svg.clientWidth, vh = svg.clientHeight;
    mmEl.appendChild(el("rect", {
      x: (-cam.x / cam.k) * scale, y: (-cam.y / cam.k) * scale,
      width: (vw / cam.k) * scale, height: (vh / cam.k) * scale,
      fill: "none", stroke: "#e8f2fa", "stroke-width": 0.6, opacity: 0.5,
    }));
    mmEl.appendChild(el("circle", {
      cx: s.hero.x * scale, cy: s.hero.y * scale, r: 2.3,
      fill: "#e8f2fa", stroke: "#ffb84d", "stroke-width": 0.8,
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

  // ----- The raid loop -----
  let lastFrame = 0;
  let running = false;
  let introHold = false;
  let introHoldTimer: ReturnType<typeof setTimeout> | undefined;
  function raidFrame(now: number): void {
    if (!running || !s) return;
    if (!lastFrame) lastFrame = now;
    let dt = now - lastFrame; lastFrame = now;
    if (dt > 100) dt = 100;

    if (introHold && (move.x || move.y || keys.size > 0)) {
      introHold = false;
      clearTimeout(introHoldTimer);
      toastEl.classList.remove("show");
    }

    if (!introHold && s.phase === "raid") {
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
      stepRaid(s, dt, move);
      centerCam(s.hero.x, s.hero.y);
    }

    render(s, layer);
    hud();
    minimap();

    if (s.phase === "won") { running = false; onWin(); return; }
    if (s.phase === "lost") { running = false; onLost(); return; }
    requestAnimationFrame(raidFrame);
  }

  function startCity(level: LevelDef): void {
    s = buildArena(level);
    loadCitySprites(level.id, repaint);
    hideOverlay();
    setupZoom();
    centerCam(s.hero.x, s.hero.y);
    hud();
    showToast("Silence every TARGET below (count, top-right) — the works and the army columns. Your bomber cannot stop: steer with the joystick or WASD. HOLD A STRAIGHT AND LEVEL COURSE to arm the bombsight (the amber bar) — an armed sight releases bombs ahead of the nose. But the FLAK leads a straight run perfectly: watch the red reticles and break away before they burst. Fighters will scramble from their airfields — bomb the field first and its squadron burns on the ground; your escorts will tangle with the rest.");
    introHold = true;
    clearTimeout(introHoldTimer);
    introHoldTimer = setTimeout(() => { introHold = false; }, TOAST_MS);
    running = true; lastFrame = 0;
    requestAnimationFrame(raidFrame);
  }

  function onWin(): void {
    if (!s) return;
    const ms = s.elapsed;
    const sc = scoreRun(s);
    const medals = Math.max(1, Math.round(sc.total / MEDAL_SCORE_DIV));
    const l = recordRaid(s.level, ms, s.destroyed, medals, s.fightersDown);
    const best = l.best[s.level.id];
    const gunLine = s.flakDown > 0
      ? `You silenced <em>${s.flakDown}</em> of ${s.flakTotal} batteries on the way.`
      : `Every battery is still firing behind you.`;
    const wingLine = escortsAlive(s) === s.escortsTotal && s.escortsTotal > 0
      ? `The whole wing came home — <em>${s.escortsTotal}</em> escorts.`
      : `<em>${escortsAlive(s)}</em> of ${s.escortsTotal} escorts came home.`;
    const row = (label: string, val: string) => `<div><dt>${label}</dt><dd>${val}</dd></div>`;
    const breakdown =
      `<div class="legacy"><div class="legacy-head">Score</div><dl>` +
      row("Targets silenced", `${sc.base}`) +
      row("Speed", `${sc.speed}`) +
      row("Guns silenced", `${sc.guns}`) +
      row("Escorts home", `${sc.escorts}`) +
      row("Survival", `${sc.survival}`) +
      (sc.untouched ? row("Untouched", `${sc.untouched}`) : "") +
      row("Theatre difficulty", `×${sc.mult}`) +
      row("<strong>Total</strong>", `<strong>${sc.total}</strong>`) +
      `</dl></div>`;
    showOverlay(
      "The raid is complete",
      `Every target in <em>${s.level.name}</em> is silenced — ${s.total} of them — ` +
      `in <em>${fmtTime(ms)}</em>, with <em>${s.fightersDown}</em> fighters downed on the way.<br><br>` +
      `${gunLine} ${wingLine}<br><br>` +
      (best === ms ? `<em>A new best for this theatre.</em>` : `Best here: ${fmtTime(best)}.`) +
      ` <em>+${medals}</em> medals pinned.` +
      breakdown,
      "Fly it again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function onLost(): void {
    if (!s) return;
    const medals = s.destroyed * MEDAL_PER_TARGET;
    recordDown(s.destroyed, s.fightersDown, medals);
    showOverlay(
      "You are going down",
      `The guns of <em>${s.level.name}</em> found you with ` +
      `<em>${aliveTargets(s)}</em> targets still standing.<br><br>` +
      `You had silenced <em>${s.destroyed}</em> of ${s.total}, downed <em>${s.fightersDown}</em> fighters, ` +
      `and <em>${escortsAlive(s)}</em> of your escorts turned for home without you.<br><br>` +
      (medals > 0 ? `What you struck first leaves <em>+${medals}</em> medals behind. ` : ``) +
      `<em>The works can be rebuilt. So can you. Fly again.</em>`,
      "Fly again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
  }

  function showPicker(selId?: string): void {
    s = null; running = false;
    introHold = false; clearTimeout(introHoldTimer);
    mmEl.style.display = "none";
    const l = loadBomberLegacy();
    const sel = levelById(selId || "") || LEVELS[0];
    const card = sel.art ? `<img class="city-art" src="${sel.art}" alt="">` : "";
    let html =
      card +
      `<p class="lede">Choose a theatre to raid. Your bomber cannot stop — hold a ` +
      `straight and level run to arm the bombsight and lay your sticks on the works ` +
      `and the columns. But the flak leads a straight run perfectly, the squadrons ` +
      `scramble to meet you, and only your escorts stand between them and your ` +
      `tail. Silence every target to complete the raid.</p><div class="cities">`;
    for (const lv of LEVELS) {
      const done = l.best[lv.id];
      const mark = done ? ` <span class="legacy-new">raided ${fmtTime(done)}</span>` : "";
      html +=
        `<button class="city${lv.id === sel.id ? " sel" : ""}" data-id="${lv.id}">` +
        `<span class="city-name">${lv.name}${mark}</span>` +
        `<span class="city-line">${lv.epigraph}</span></button>`;
    }
    html += `</div>`;

    // The airframe shop — raids bank medals; spend them here, then equip.
    html +=
      `<div class="legacy"><div class="legacy-head">` +
      `Airframes <span class="legacy-new">${l.medals} medals</span></div></div>` +
      `<div class="ptypes">`;
    for (const t of BOMBER_TYPES) {
      const owned = l.unlocked.includes(t.id);
      const equipped = l.equipped === t.id;
      const afford = l.medals >= t.cost;
      let badge: string, act: string, disabled = false;
      if (equipped) { badge = ` <span class="legacy-new">equipped</span>`; act = ""; disabled = true; }
      else if (owned) { badge = ""; act = "equip"; }
      else if (afford) { badge = ` <span class="legacy-new">${t.cost} medals</span>`; act = "unlock"; }
      else { badge = ` <span class="ptype-cost">${t.cost} medals</span>`; act = ""; disabled = true; }
      const verb = act === "equip" ? "Equip" : act === "unlock" ? "Commission" : equipped ? "Equipped" : "Locked";
      html +=
        `<button class="ptype${equipped ? " sel" : ""}" data-id="${t.id}" data-act="${act}"${disabled ? " disabled" : ""}>` +
        `<span class="city-name"><span class="ptype-swatch" style="background:${t.roundel};box-shadow:0 0 6px ${t.trim}"></span>${t.name}${badge}</span>` +
        `<span class="city-line">${t.desc}</span>` +
        `<span class="ptype-verb">${verb}</span></button>`;
    }
    html += `</div>`;

    if (l.runs > 0) {
      html +=
        `<div class="legacy"><div class="legacy-head">Your tours</div><dl>` +
        `<div><dt>Raids flown</dt><dd>${l.runs}</dd></div>` +
        `<div><dt>Raids completed</dt><dd>${l.raids}</dd></div>` +
        `<div><dt>Targets silenced</dt><dd>${l.targetsDestroyed}</dd></div>` +
        `<div><dt>Fighters downed</dt><dd>${l.fightersDowned}</dd></div></dl></div>`;
    }

    showOverlay(
      "The Iron Rain", html, `Raid ${sel.name}`, () => startCity(sel),
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
        if (act === "unlock") { unlockBomber(id); equipBomber(id); }
        else if (act === "equip") equipBomber(id);
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
      `<img class="start-logo" src="./icons/bomber-icon-192.png" alt="The Iron Rain">` +
      `<p class="frx-quote">“The bombers will always get through.”</p>` +
      `<div class="start-share">` +
      `<button class="start-act" data-act="link">Share game link</button></div>`;
    showOverlay("The Iron Rain", body, "Fly the raid", () => showPicker());
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
      try { await nav.share({ title: "The Iron Rain", text: "Hold the bomb run, dodge the flak, bring the wing home.", url }); return; }
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
// Mirrors the siblings: a headless harness sets __BOMBER_TEST__ and reads the
// sim off __bomber instead of the shell ever starting.
const testGlobal = globalThis as unknown as {
  __BOMBER_TEST__?: boolean;
  __bomber?: Record<string, unknown>;
};
if (typeof globalThis !== "undefined" && testGlobal.__BOMBER_TEST__) {
  testGlobal.__bomber = {
    buildArena, freshRaid, stepRaid,
    stepSight, releaseBomb, burstBomb, stepBombs, stepColumns,
    stepFlak, stepShells, stepPlanes, stepPosts, stepGunners, stepFires, stepChutes, stepClouds,
    destroyTarget, hurtTarget, hurtFlak, hurtBomber, hurtPlane, downPlane,
    aliveTargets, clearedPct, escortsAlive, raidReadout, scoreRun, difficultyMult,
    LEVELS, levelById,
    weaveSegments, closestOnSegment, pushOut, inCloud, angleDiff,
    bombsightPath, planePath,
    render, scaffold, spriteFor,
    loadBomberLegacy, saveBomberLegacy, recordRaid, recordDown, emptyBomberLegacy,
    BOMBER_TYPES, bomberTypeById, unlockBomber, equipBomber,
    K: {
      W, H, SPEED_CRUISE, SPEED_MAX, TURN_RATE, HERO_RADIUS, HERO_HP, HERO_IFRAMES_MS,
      STEADY_TURN, SIGHT_CHARGE_MS, SIGHT_ARM_AT, SIGHT_SPIN,
      BOMB_CD_MS, BOMB_FALL_MS, BOMB_CARRY, BOMB_RADIUS, BOMB_DMG, BURST_FX_MS,
      SIGHT_OVERCHARGE_MS, MASTER_RADIUS_MUL, MASTER_DMG_MUL,
      FLAK_RANGE, FLAK_CD_MS, FLAK_FUSE_MS, FLAK_BURST_R, FLAK_DMG, FLAK_SCATTER,
      FLAK_HP, FLAK_RADIUS,
      ALERT_PER_BURST, ALERT_DECAY, ALERT_FLAK_HASTE, ALERT_SCRAMBLE_MUL,
      FIGHTER_HP, FIGHTER_SPEED, FIGHTER_RANGE, FIGHTER_CD, FIGHTER_DMG,
      FIGHTER_DMG_PLANE, FIGHTER_TANGLE_R, SCRAMBLE_RANGE, FIGHTER_PER_FIELD,
      PLANE_RADIUS, PLANE_SEP,
      ESCORT_HP, ESCORT_SPEED, ESCORT_RANGE, ESCORT_CD, ESCORT_DMG,
      ESCORT_ENGAGE_R, ESCORT_FORM_R,
      TURRET_RANGE, TURRET_CD, TURRET_DMG, TURRET_NOSE_ARC,
      BALLOON_RADIUS, CLOUD_DRIFT, STREAM_HALF, STREAM_BOOST,
      CHUTE_DROP_CHANCE, CHUTE_TTL_MS, CHUTE_RADIUS, PATCH_HEAL,
      GUNNER_R, GUNNER_DPS, EVASIVE_SCATTER_MUL, FIRE_TTL_MS, FIRE_R, FIRE_DPS,
      COLUMN_SPEED, COLUMN_HP, COLUMN_RADIUS, STRUCT_HP, STRUCT_RADIUS, HIT_FLASH_MS,
      SCORE_PER_TARGET, SCORE_PER_FLAK, SCORE_ESCORT_MAX, SCORE_SURVIVAL_MAX,
      SCORE_UNTOUCHED, MEDAL_SCORE_DIV, MEDAL_PER_TARGET,
    },
  };
} else {
  start();
}

// This trailing export makes bomber.ts a *module* (its top-level names are
// module-scoped), so it compiles in the same project as its siblings without
// their identically-named declarations (W, el, render, start, LEVELS, …)
// colliding.
export {};
