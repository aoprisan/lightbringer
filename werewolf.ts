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
// repo has. You begin a HUMAN: frail, unable to fight, and able to STALK unseen among
// the village. Standing still bays at the moon and stokes your FURY; under MOONLIGHT it
// swells fast, by DAYLIGHT it crawls. When fury crests you TRANSFORM into the wolf —
// faster, and the only form that can fight. The wolf is a PREDATOR: it has no stand-and-
// channel verb — it builds MOMENTUM by running and RUNS prey down, mauling on contact
// and auto-POUNCING the straggler ahead. The village FLEES and panics (a spreading
// alarm rouses the armed hunters); but the change costs fury and daylight bleeds it, so
// you must feed (kill) to stay the beast. Night is your hour; by day you are prey.
//
// The whole loop is pure JOYSTICK — there is no attack button. Where and how fast you
// steer is the weapon: the maul and the pounce both fall out of your motion.
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
  | "hoard"     // a barrow-hoard: first-footing it stokes the curse, once
  | "woods";    // a stand of trees: concealing cover — the wolf melts into it (hidden from the watch, dulled aggro)
type Phase = "hunt" | "won" | "lost";

// A foe lurks near its green until the wolf (or a marked cairn) draws it, then hunts.
// Aggro is sticky once roused — the mirror of the sibling games' enemy AI.
type FoeState = "lurk" | "hunt";

// The five kinds of the watch, split by ROLE. The unarmed PREY — villager & hound —
// flee the beast and flock; their panic (alarm) is the danger, not their teeth. The
// armed HUNTERS — knight, huntsman, friar — converge on the wolf and are the real
// threat (the huntsman looses silver bolts, the friar bleeds the curse).
type FoeKind = "villager" | "hound" | "knight" | "huntsman" | "friar";

// Prey flee; hunters converge. The one predicate that splits the watch's behaviour.
function isPrey(v: FoeKind): boolean {
  return v === "villager" || v === "hound";
}

// The cursed soul wears one of two shapes. HUMAN cannot fight (only stalk, blend in,
// and stoke fury); WOLF is the predator — it runs prey down. The moon drives the change.
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
  form: HeroForm;                // human (cannot fight) or wolf (the predator)
  hurt: number;       // remaining i-frame ms after a blow (0 = vulnerable)
  momentum: number;   // 0..1 — the running predator's speed-charge; the wolf's whole weapon
  facing: number;     // heading (radians) the wolf last ran — the pounce cone & the body's face
  biteCd: number;     // ms until the maul can rend again (the contact-bite cadence)
  pounceCd: number;   // ms until the wolf can pounce again
  lunge: number;      // ms remaining of an active pounce-lunge (0 = none)
  lungeVx: number; lungeVy: number; // the lunge's locked velocity while it runs
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
  aimUntil?: number;            // a huntsman's aim wind-up deadline (s.elapsed); undefined = not aiming
  hit: number;                  // s.elapsed until which it flashes from a fresh blow
  bornAt: number;               // s.elapsed it mustered (for the rise flourish)
  alarm: number;                // 0..1 — a prey's panic; spreads to its neighbours and rouses the hunters
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
  quarry: number;         // index into foes of the night's marked quarry (-1 = none)
  quarryNight: boolean;   // are we inside the true-night window (edge-detects the mark)
  quarrySlain: number;    // marked quarry run down this hunt (each pays a blood-price)
  elapsed: number;        // ms since the hunt began (clear time)
  slain: number;          // foes cut down
  hits: number;           // times the watch has landed a blow on the hero
  total: number;          // the finite host: cut them all down to win
  cairnsTotal: number;    // cairns the place began with
  litCount: number;       // cairns marked right now (secondary objective)
  cleansedCount: number;  // cairns the watch has cleansed this hunt
  seed: number;           // the arena's build seed — the duel token's heart
  killTimes: number[];    // ms timestamp of every kill, in order — my echo
  rival?: DuelRun;        // the challenger's echo, when this hunt answers a duel
  phase: Phase;
}

interface Move { x: number; y: number } // normalized input vector, -1..1 each

// ---------- Tuning ----------
// The design surface. Balance changes should be constant changes here, the same
// ethos as the sibling games' tuning blocks.

const W = 1500;
const H = 2000;

// The village expansion: villages are tripled in linear size. Area grows with the
// square of a linear factor, so CONTENT_SCALE (applied to node/foe/terrain counts at
// generation time, never to the LevelDef literals themselves) keeps density — and
// difficultyMult, which reads the un-scaled LevelDef counts — unchanged.
const VILLAGE_SCALE = 3;
const CONTENT_SCALE = VILLAGE_SCALE * VILLAGE_SCALE;

// The cursed soul. Speed depends on the shape — the wolf is the swifter body.
const HERO_SPEED_HUMAN = 248;    // human travel, world units per second
const HERO_SPEED_WOLF = 304;     // wolf travel — the beast runs faster
const HERO_RADIUS = 16;
const HERO_HP = 100;
const HERO_IFRAMES_MS = 600;     // grace after a blow, no further damage (the watch bites through sooner)
const HERO_KNOCKBACK = 56;       // units the hero is shoved back by a blow

// THE PREDATOR'S WEAPON IS MOTION. A wolf does not stand and channel — it RUNS prey
// down. MOMENTUM (0..1) builds while the beast runs near top speed and bleeds when it
// slows; a bite's bite scales with it, so the verb is "build speed, run them down".
// The literal inverse of the siblings' stand-still sigil. Pure-joystick: nothing here
// is a button — the maul and the pounce both fall out of where you steer.
const HERO_STILL_MAXSPEED = 40;  // below this (units/s) a MAN bays at the moon (stokes fury)
const MOMENTUM_RISE_MS = 900;    // time at full wolf-run to fill momentum 0→1
const MOMENTUM_DECAY_MS = 650;   // time slowed/stopped to bleed momentum 1→0
const MOMENTUM_MIN_SPEED = 120;  // must travel faster than this (units/s) to build momentum

// The maul — the wolf's contact bite. Each BITE_CD, a wolf whose body reaches a foe
// rends the nearest one; the blow scales from MAUL_MIN_MUL (a near-standing graze) up
// to full at peak momentum. A connecting kill FEEDS the beast (KILL_HEAL, in slay).
const MAUL_REACH = 30;           // bite contact reach, over and above the two radii
const MAUL_DMG = 26;             // a full-momentum bite (× MAUL_MIN_MUL..1 by momentum × pelt)
const BITE_CD = 300;             // ms between contact bites (the maul cadence)
const MAUL_MIN_MUL = 0.45;       // a standing bite is this fraction of a full-run bite
const MAUL_KNOCK = 18;           // units a plain bite shoves its prey
const KILL_HEAL = 6;             // HP the predator feeds on a kill (the lit-dwelling heal, inverted)
const PULSE_FX_MS = 360;         // how long a bite/pounce ring lingers
const TERROR_KNOCK = 64;         // units a pounce (or a Black-pelt bite) flings its prey

// The pounce — the signature kill, and the reward for running fast. At POUNCE_AT
// momentum, if prey sits in a frontal cone the wolf auto-LUNGES onto it (a brief dash)
// and lands a heavy bite. No input of its own — it fires from your heading and speed.
const POUNCE_AT = 0.7;           // momentum needed to auto-pounce
const POUNCE_RANGE = 230;        // a frontal foe within this is pounced
const POUNCE_ARC = 0.72;         // half-angle (radians) of the pounce cone (~41°)
const POUNCE_MS = 170;           // how long the lunge-dash runs
const POUNCE_SPEED = 760;        // the lunge's travel, units/s
const POUNCE_CD = 850;           // ms between pounces
const POUNCE_SPEND = 0.35;       // momentum left after a pounce
const POUNCE_DMG_MUL = 2.2;      // a bite landed mid-lunge × this (the heavy pounce-bite)

// ALARM — the village's panic, and the one social meter. A prey near the hero gains
// alarm scaled by his CONSPICUOUSNESS (a wolf reads loud; a calm man blends in; mist &
// woods muffle him); it SPREADS prey→prey and DECAYS. Alarmed prey FLEE; a high village
// average ROUSES the hunters. This is the stealth-predator core: cull quiet & isolated.
const ALARM_RADIATE_WOLF = 1.7;  // alarm/sec a wolf radiates to a prey right beside it
const ALARM_RADIATE_MAN = 0.6;   // …a MAN reads this loud only while SPRINTING (else he blends in)
const MAN_SPRINT_SPEED = 170;    // a man travelling faster than this looks wrong (radiates alarm)
const ALARM_RADIATE_REACH = 240; // radiation falls linearly to 0 at this distance
const ALARM_MUFFLE_MUL = 0.25;   // radiation × this while the hero is in mist or woods
const ALARM_SPREAD_R = 130;      // prey within this of a panicked neighbour catch its panic
const ALARM_SPREAD_RATE = 0.9;   // how fast alarm equalises toward a louder neighbour, /sec
const ALARM_DECAY = 0.22;        // alarm/sec a prey sheds when nothing feeds it
const ALARM_KILL_SPIKE_R = 180;  // a kill terrifies prey within this to full alarm (a loud kill)
const ALARM_ROUSE = 0.34;        // village-average alarm at/above which the hunters converge
const PREY_FLEE_ALARM = 0.4;     // a prey this alarmed breaks and flees
const PREY_FLEE_SPEED_MUL = 1.12;// prey flee a touch faster than they idle
const PREY_COHESION = 0.55;      // flock pull toward nearby prey (herding) vs. raw flight

// THE MOON — the day/night wheel, and the soul of this spinoff. It drives the FURY,
// and fury drives the SHAPE. By moonlight fury swells; by daylight it crawls (human)
// or bleeds (wolf). daylight(moon): 1 at noon (moon 0/1), 0 at midnight (moon 0.5).
const MOON_CYCLE_MS = 60000;     // a full day-night wheel (one "night" comes ~every 30s)
const MOON_START = 0.35;         // begin near dusk — night, and the beast, come soon
const FURY_RISE_MS = 4600;       // human → full fury, standing under a full moon (slower to turn beast)
const FURY_DRAIN_MS = 7200;      // wolf fury drain at base (daylight bleeds it faster — a shorter beast window)
const FURY_PER_KILL = 0.14;      // fury a kill feeds the beast (sustains the change)

// Blood-motes — a felled foe may leave hot blood; gathering it (walk over it) STOKES
// the curse. The fury economy's heartbeat (mirror of the Vigil's ember surge).
const MOTE_DROP_CHANCE = 0.42;   // fraction of kills that leave a blood-mote
const MOTE_TTL_MS = 7000;        // how long a blood-mote waits to be gathered
const MOTE_RADIUS = 18;          // gather reach (over and above the hero's radius)
const MOTE_FURY = 0.18;          // fury a gathered blood-mote stokes

// THE NIGHT'S QUARRY — each true night the moon MARKS one soul of the watch (a
// hunter when any still stands, else the boldest prey). Run the quarry down before
// dawn and the kill pays a BLOOD-PRICE: a surge of fury, a full head of momentum,
// a mend, and score. At dawn an unclaimed mark fades. The moon's own bounty-board:
// it gives the sandbox a direction each night without adding a single input.
const QUARRY_NIGHT_DL = 0.3;     // daylight below this is "true night" — the mark holds
const QUARRY_FURY = 0.3;         // fury the blood-price surges
const QUARRY_HEAL = 12;          // HP the blood-price mends
const SCORE_QUARRY = 180;        // score banked per quarry run down

const HIT_FLASH_MS = 150;        // how long a body flashes from a fresh blow

// ---------- Pelts (unlockable wolf-form variants) ----------
// Each pelt is a different beast with its own maul dials and a passive POWER, mirror
// of the Vigil's PentaPower and the siblings' powers. "none" is a plain stat-lean;
// "frenzy" arcs a kill's bloodlust to a nearby foe; "moonblood" stokes the curse on
// each kill (the fury pelt); "terror" flings prey on every bite. Powers fire
// automatically — the only choice is which pelt to don.
type PeltPower = "none" | "frenzy" | "moonblood" | "terror";

interface PeltType {
  id: string; name: string; desc: string; cost: number;
  radiusMul: number;  // maul reach & pounce range × their bases (a longer-limbed beast)
  chargeMul: number;  // momentum-rise time × MOMENTUM_RISE_MS (a heavier beast winds up slower)
  pulseMul: number;   // bite cadence × BITE_CD (a faster-biting beast)
  dmgMul: number;     // bite damage × MAUL_DMG
  power: PeltPower;   // the pelt's passive behaviour
  ring: string;       // the speed-streak / bite-ring signature hue
  star: string;       // the claw-flash stroke hue
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
    desc: "A great old wolf — longer reach, harder bite, slower to wind to a sprint. A kill's frenzy leaps to the next throat near.",
    radiusMul: 1.32, chargeMul: 1.2, pulseMul: 1.28, dmgMul: 1.5, power: "frenzy",
    ring: "#e0b070", star: "#ffe6b0",
  },
  {
    id: "fell", name: "The Fell Pelt", cost: 160,
    desc: "A lean, quick runner — winds to a sprint fast and bites fast, and every kill swells the curse anew.",
    radiusMul: 0.84, chargeMul: 0.72, pulseMul: 0.66, dmgMul: 0.78, power: "moonblood",
    ring: "#9bd8ff", star: "#d8f0ff",
  },
  {
    id: "black", name: "The Black Pelt", cost: 240,
    desc: "The moon-touched beast — every bite flings its prey, and scatters the watch in terror.",
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

// The villager — the common PREY. They do not hunt the wolf; they FLEE it and flock.
// A villager only lashes out (FOE_CONTACT, a panicked flail) when truly cornered with
// the beast on top of it — the danger of a herd is the ALARM it raises, not its teeth.
const FOE_HP = 38;               // a hardier watch — the maul takes a beat longer to fell each
const FOE_SPEED = 110;           // travel, units/s
const FOE_RADIUS = 14;
const FOE_CONTACT = 8;           // a cornered prey's panicked flail at the hero
const FOE_ATTACK_CD = 740;       // ms between a prey's flails
const FOE_ATTACK_REACH = 16;     // within this (+radii) of the hero it can flail
const FOE_SEP = 26;              // bodies push apart within this (so they herd, not stack)
const FOE_AGGRO = 440;           // a prey within this of a conspicuous hero breaks and flees
const FOE_WANDER_SPEED = 32;     // idle drift while lurking, units/s
const FOE_LEASH = 240;           // a lurker steers home if it drifts past this from its green
const FOE_PER_GREEN = 5;         // villagers each green musters (a denser flock)
const CLEANUP_AGGRO_FRAC = 0.2;  // once this few remain, all rouse so a hunt always ends
const RISE_MS = 600;             // a freshly-mustered foe's rise flourish (cosmetic)

// Stealth — a calm MAN reads as one of their own and the watch sleeps; a man hidden in
// MIST or WOODS is muffled too. A hunter still roused stays roused (alarm is sticky).
const STEALTH_AGGRO_MUL = 0.5;   // a hunter's proximity-rouse range × this while the hero is muffled

// Hound — fast, frail PREY the houndsmen loosed; it flees faster than it can be run down.
const HOUND_HP_MUL = 0.55;       // a hound's hp × a villager's
const HOUND_SPEED_MUL = 1.7;     // …its travel speed ×
const HOUND_CONTACT = 7;         // …its bite damage

// Knight (man-at-arms) — a HUNTER: slow, plated, heavy. It converges on the wolf and
// punishes a beast that lingers in the open; focus-fire it or lead it off.
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
const BOLT_AIM_MS = 450;         // the aim wind-up before a bolt looses — the telegraph,
                                 // and the dodge window: move, or break its sight, to spoil it
const BOLT_SPEED = 330;          // a silver bolt's travel, units/s
const BOLT_DMG = 14;             // damage a bolt deals on a hit
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

// Moonwells — pale pools where the moon always reaches. Within their aura the hero's
// fury swells at the NIGHT rate whatever the hour, AND the wolf's momentum never bleeds
// (it can wheel and stalk without going cold) — a refuge of the moon and the wolf's
// foothold against the day. Live-play, never persisted.
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

// Glades — small moonlit clearings: a lesser moonwell. Within the aura fury swells at
// the night rate and the wolf's momentum holds — a foothold of moonlight on the run.
const GLADE_AURA = 120;          // radius of the glade's moonlit footing

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

// Woods — a dense stand of trees, the forest the wolf was born to. Concealing cover
// (the static cousin of mist, and the most thematic terrain of the hunt): a hero
// under the boughs is HIDDEN from the watch's huntsmen (they lose the line and hold
// fire) and the watch is slower to rouse (the same STEALTH_AGGRO_MUL that mist and
// a man's shape earn). The tactical heart of the expanded maps — slip into the trees
// to break a standoff or vanish from a swarm. Passable.
const WOODS_AURA = 150;          // radius of a stand's concealing canopy

// Cairns — the wolf's DENS. Make a kill beside a dark cairn (bite a foe within reach of
// it) and the beast CLAIMS it: its aura grants fury & momentum, rends the watch that
// strays in, and PANICS the prey within (alarm + an outward shove — a herding tool). A
// hunter brushing a claimed den CLEANSES it (dark again, a scar bars re-claiming). All
// live-play, never persisted — the ally-emitter / scar inversion the siblings share.
const CAIRN_MARK_REACH = 96;     // a kill this close to a dark den claims it
const CAIRN_MARK_FURY = 0.1;     // fury claiming a den stokes
const CAIRN_AURA = 132;          // the claimed den's aura radius
const CAIRN_FURY_PER_SEC = 0.12; // fury/sec the aura grants a hero within it
const CAIRN_DMG = 11;            // damage/sec the aura deals a foe within it (ally emitter)
const CAIRN_PANIC_PER_SEC = 0.5; // alarm/sec the aura drives into prey within it (herding)
const CAIRN_SHOVE = 28;          // units/s the aura shoves panicked prey outward
const CLEANSE_REACH = 24;        // a hunter this close to a claimed den cleanses it
const CLEANSE_MS = 6000;         // a cleansed den's scar bars re-claiming this long
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
  // The hunt's story. The villages are one campaign — the cursed soul driven
  // from his home, hunted village by village until nothing in the dale or the
  // outlands can hunt him. `story` is a chapter that names where the trail came
  // from and where it runs next; a village is reachable only after claiming the
  // one before it (see `villageUnlocked` — the villages unlock in LEVELS order).
  // Shown in the picker (with the PROLOGUE in front of the very first hunt).
  story: string;
  art?: string;           // optional establishing image (art/village-*.png); silent-fail
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
  woodsCount?: number;    // stands of trees — concealing cover (hide + dull aggro), the static cousin of mist
  sizeScale?: number;     // arena size = W/H × this (default 1); leans the difficulty
  winter?: boolean;       // render-only: a snow-bound village (cold palette, frosted scenery).
                          // Pure cosmetic — no rule changes, read solely by render().
}

const LEVELS: LevelDef[] = [
  {
    id: "thornwick",
    name: "Thornwick",
    epigraph: "A small thatched holt under a thin grey moon, its greens deep in snow. The watch is few and slow to rouse. A fair first hunt.",
    story: "It begins where the curse began: the snow-bound holt that was your home. " +
      "The watch is thin and drowsy, and the folk still call you by name when they scream. " +
      "Learn the shape of the hunt here — the baying, the turning, the feeding — for word " +
      "travels faster than a wolf runs.",
    art: "art/village-thornwick.png",
    nodeCount: 110, minDist: 72,
    stoneCount: 4, cottageCount: 7, cairnCount: 6, moonwellCount: 2,
    greenCount: 5, greenSpacing: 360,
    wallCount: 7, pathCount: 6, mistCount: 3, woodsCount: 3, sizeScale: 0.9,
    winter: true, // snow-bound first village — cold render palette, frosted scenery
  },
  {
    id: "greymoor",
    name: "Greymoor",
    epigraph: "Bleak moorland of gorse and standing stones, where houndsmen course the fog and bowmen wait the ridge.",
    story: "The survivors of Thornwick fled over the moor and sold your scent to the " +
      "houndsmen of Greymoor. Now dogs course the gorse and bowmen wait the ridgelines. " +
      "Take the fog when it drifts, and take the hounds first — a watch that cannot smell " +
      "you cannot hold.",
    art: "art/village-greymoor.png",
    nodeCount: 122, minDist: 66,
    stoneCount: 8, cottageCount: 5, cairnCount: 7, moonwellCount: 2,
    greenCount: 7, greenSpacing: 320,
    wallCount: 6, pathCount: 9, mistCount: 4, woodsCount: 4, houndCount: 3, huntsmanCount: 2, sizeScale: 1.0,
  },
  {
    id: "hollowby",
    name: "Hollowby",
    epigraph: "A walled market town under the abbey bell. Friars keep their relics, men-at-arms their wall, and the bowmen the gate.",
    story: "The abbey at Hollowby has named the thing you are, and the bell tolls it over " +
      "the wall each dusk. Friars walk the lanes with relics that bleed your fury thin. " +
      "Break their lines of sight, and break them — when the bell falls silent the town " +
      "will learn its wall was built to keep the wrong thing out.",
    art: "art/village-hollowby.png",
    nodeCount: 116, minDist: 70,
    stoneCount: 6, cottageCount: 10, cairnCount: 5, moonwellCount: 1,
    greenCount: 8, greenSpacing: 280,
    wallCount: 12, pathCount: 5, mistCount: 2, woodsCount: 2,
    houndCount: 3, knightCount: 2, huntsmanCount: 3, friarCount: 2, sizeScale: 1.1,
  },
  {
    id: "wulfmere",
    name: "Wulfmere",
    epigraph: "A drowned fen-village of black water and willow, the moon dead overhead. Every soul of it hunts you, and they are many.",
    story: "What was left of three villages waded into the fen and raised Wulfmere " +
      "against you — black water, willow, and every soul armed. The moon hangs dead " +
      "overhead here and the mist is yours. Drown the dale's last hope in it, and the " +
      "old country is beaten.",
    art: "art/village-wulfmere.png",
    nodeCount: 104, minDist: 84,
    stoneCount: 10, cottageCount: 4, cairnCount: 4, moonwellCount: 3,
    greenCount: 9, greenSpacing: 300,
    wallCount: 10, pathCount: 3, mistCount: 5, woodsCount: 4,
    houndCount: 2, knightCount: 4, huntsmanCount: 4, friarCount: 2, sizeScale: 1.18,
  },
  // ---- The Outlands (the maps' expansion: four further hunts) ----
  // Villages beyond the dale, each carrying the expanded terrain vocabulary — burned
  // holts, sucking fens, wind-scoured heads, and the last hollow where the curse ends.
  {
    id: "ashthorn",
    name: "Ashthorn",
    epigraph: "A holt the fire took and never left. The pyres still burn — and the watch fears them more than you.",
    story: "Beyond the dale the outlands begin, and the outlanders burned Ashthorn's " +
      "fields themselves rather than leave you cover. The pyres never went out. But fire " +
      "is no friend of theirs either — herd the watch through their own burning and the " +
      "holt will finish itself.",
    art: "art/village-ashthorn.png",
    nodeCount: 140, minDist: 64,
    stoneCount: 4, cottageCount: 6, cairnCount: 6, moonwellCount: 2,
    greenCount: 6, greenSpacing: 330,
    wallCount: 6, pathCount: 6, mistCount: 3,
    pyreCount: 3, marshfireCount: 4, brambleCount: 4, gibbetCount: 3, wispCount: 2, woodsCount: 5,
    houndCount: 3, huntsmanCount: 2, sizeScale: 1.0,
  },
  {
    id: "mirefen",
    name: "Mirefen",
    epigraph: "Black water and bane-herb under a drowned moon. The bog holds them; the wolfsbane bleeds you — find the springs.",
    story: "Mirefen heard how Ashthorn ended and sowed its bog with wolfsbane — " +
      "bane-herb enough to bleed the beast back into the man. Keep to the springs, keep " +
      "the change fed, and teach them that a starved wolf is not a cured one.",
    art: "art/village-mirefen.png",
    nodeCount: 150, minDist: 62,
    stoneCount: 5, cottageCount: 4, cairnCount: 6, moonwellCount: 2,
    greenCount: 7, greenSpacing: 310,
    wallCount: 5, pathCount: 4, mistCount: 5,
    bogCount: 5, wolfsbaneCount: 4, springCount: 3, wispCount: 3, dolmenCount: 3, woodsCount: 3,
    houndCount: 2, huntsmanCount: 3, friarCount: 2, sizeScale: 1.08,
  },
  {
    id: "galehead",
    name: "Galehead",
    epigraph: "A bare, wind-scoured headland where hot springs steam and the gale holds the watch off the open stone.",
    story: "The last of them ran for the sea and made their stand at Galehead, where the " +
      "gale scours the stone and nothing can hide. Nothing but you: the glades hold your " +
      "stride, the geysers hold their nerve. Run the headland down to its final door.",
    art: "art/village-galehead.png",
    nodeCount: 145, minDist: 64,
    stoneCount: 6, cottageCount: 3, cairnCount: 5, moonwellCount: 2,
    greenCount: 8, greenSpacing: 295,
    wallCount: 4, pathCount: 6, mistCount: 3,
    galeCount: 5, gladeCount: 4, geyserCount: 3, cartCount: 5, hoardCount: 3, woodsCount: 2,
    houndCount: 3, knightCount: 2, huntsmanCount: 2, sizeScale: 1.12,
  },
  {
    id: "direhollow",
    name: "Direhollow",
    epigraph: "The last hollow, where every soul of the watch has cornered itself for one final night. Everything you have learned, turned on them.",
    story: "Every soul that fled every village you emptied is cornered in Direhollow, " +
      "and they have made of it one great trap — pyre and bane, gale and bog. There is " +
      "no village after this one. End the war they started, and the long winter is yours.",
    art: "art/village-direhollow.png",
    nodeCount: 160, minDist: 60,
    stoneCount: 6, cottageCount: 6, cairnCount: 5, moonwellCount: 3,
    greenCount: 9, greenSpacing: 280,
    wallCount: 8, pathCount: 5, mistCount: 4,
    pyreCount: 3, wispCount: 2, marshfireCount: 2, geyserCount: 3, galeCount: 2,
    gladeCount: 3, springCount: 2, wolfsbaneCount: 2, dolmenCount: 2, hoardCount: 2, woodsCount: 4,
    houndCount: 3, knightCount: 3, huntsmanCount: 4, friarCount: 3, sizeScale: 1.22,
  },
];

function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

// ---------- The campaign (the hunts as one war) ----------
// The villages are a single arc, told in order: the cursed soul driven out of his
// home, hunted from village to village until nothing in the dale or the outlands
// is left to hunt him. The PROLOGUE frames the first hunt; each LevelDef.story is
// a chapter linking the village before to the village after; the EPILOGUE plays
// once every village is claimed. The villages unlock in LEVELS order
// (`villageUnlocked`), so the campaign is the progression — you cannot reach
// Greymoor until Thornwick is yours.
const PROLOGUE =
  "The wolf that opened your arm died on a huntsman's silver, but its hunger " +
  "lived, and moved in. Your own village saw the first moon take you — and " +
  "reached for the torches. The dale has closed against you now: every green " +
  "mustered, every road watched. Very well. If they will not let you be a man, " +
  "you will show them, village by village, what they made instead.";
const EPILOGUE =
  "Eight villages, eight moons, and no bell left ringing in the dale or beyond " +
  "it. The watch that named you devil is cut down to the last soul, and the " +
  "country lies silver and silent under a moon no one is left to fear. You are " +
  "what they made you — and everything they had is yours. The hunger, at last, " +
  "is quiet.";

// Sequential progression: the first village is always open; each later one
// unlocks only once the village before it in LEVELS has been claimed at least
// once (a `best` time is recorded on every claim). This is what threads the
// hunts into a campaign — you walk the trail the way it is told. (A duel link
// bypasses this on purpose: answering a gauntlet is a guest pass into a village
// the trail has not yet reached, exactly like the Vigil's.)
function villageUnlocked(level: LevelDef, l: WwLegacy): boolean {
  const i = LEVELS.indexOf(level);
  if (i <= 0) return true;
  return !!l.best[LEVELS[i - 1].id];
}

// Roman-numeral chapter label for a village (its 1-based place in the campaign).
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
function storyChapter(level: LevelDef): string {
  const i = LEVELS.indexOf(level);
  return ROMAN[i] ?? String(i + 1);
}

// ---------- Arena generation ----------
// The same Poisson-disc-ish placement + kind assignment as the siblings, trimmed to
// return plain {x,y,kind} nodes (no edges/adjacency — a hunt never spreads along
// streets). Most nodes are fields; the stones/cottages/cairns/moonwells are
// scattered; greens are placed with spacing, clear of each other.

function generateWerewolf(
  level: LevelDef,
  w = W * VILLAGE_SCALE * (level.sizeScale ?? 1),
  h = H * VILLAGE_SCALE * (level.sizeScale ?? 1),
): { nodes: ArenaNode[]; greens: { x: number; y: number }[] } {
  const nodes: ArenaNode[] = [];
  // A spatial-hash grid (cells sized to minDist, the rejection radius) keeps the
  // per-candidate neighbour check near-O(1) instead of scanning every placed node —
  // needed once village counts run into the thousands.
  const cell = level.minDist;
  const grid = new Map<string, ArenaNode[]>();
  const cellKey = (cx: number, cy: number) => `${cx},${cy}`;
  const tooClose = (x: number, y: number): boolean => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get(cellKey(gx, gy));
        if (!bucket) continue;
        for (const n of bucket) {
          if ((n.x - x) ** 2 + (n.y - y) ** 2 <= level.minDist ** 2) return true;
        }
      }
    }
    return false;
  };
  const targetNodes = level.nodeCount * CONTENT_SCALE;
  let guard = 0;
  while (nodes.length < targetNodes && guard++ < 20000 * CONTENT_SCALE) {
    const x = 60 + rnd() * (w - 120);
    const y = 60 + rnd() * (h - 120);
    if (!tooClose(x, y)) {
      const node: ArenaNode = { x, y, kind: "field" };
      nodes.push(node);
      const key = cellKey(Math.floor(x / cell), Math.floor(y / cell));
      const bucket = grid.get(key);
      if (bucket) bucket.push(node); else grid.set(key, [node]);
    }
  }

  const shuffled = shuffle([...nodes]);
  let cursor = 0;
  const take = (n: number): ArenaNode[] => {
    const slice = shuffled.slice(cursor, cursor + n);
    cursor += n;
    return slice;
  };
  take(level.stoneCount * CONTENT_SCALE).forEach((n) => (n.kind = "stone"));
  take(level.cottageCount * CONTENT_SCALE).forEach((n) => (n.kind = "cottage"));
  take(level.cairnCount * CONTENT_SCALE).forEach((n) => { n.kind = "cairn"; n.lit = false; });
  take(level.moonwellCount * CONTENT_SCALE).forEach((n) => (n.kind = "moonwell"));
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
    ["woods", level.woodsCount ?? 0],
  ];
  for (const [kind, n] of extraKinds) take(n * CONTENT_SCALE).forEach((node) => (node.kind = kind));

  // Greens — placed on still-field nodes, spaced apart so waves don't stack.
  const greens: { x: number; y: number }[] = [];
  const greenTarget = level.greenCount * CONTENT_SCALE;
  for (const n of shuffled) {
    if (n.kind !== "field") continue;
    if (greens.every((p) => (p.x - n.x) ** 2 + (p.y - n.y) ** 2 > level.greenSpacing ** 2)) {
      greens.push({ x: n.x, y: n.y });
      if (greens.length >= greenTarget) break;
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
// ---------- Rival duels (zero-backend async challenges) ----------
// Any finished hunt folds into a compact URL-safe token: the arena seed (the
// same seed rebuilds the same village everywhere), the challenger's kill
// timeline, and how their run ended. Opening the game with ?duel=<token> stages
// the SAME battlefield with the rival's echo pacing you on the HUD; the end
// screen calls the verdict and offers the counter-challenge. No server — the
// link IS the duel. The codec/verdict are pure and mirrored verbatim across the
// five siblings (only GAME_TAG differs, so a token never opens the wrong game).
const GAME_TAG = "werewolf";
const NAME_KEY = "lightbringer.rival.name"; // one signature across all five games

interface DuelRun {
  name: string;    // the challenger's signature (sanitized on decode)
  level: string;   // level id — the same ground
  seed: number;    // arena seed — the same village, the same watch
  weapon: string;  // their equipped pelt id (display only)
  result: "won" | "lost";
  ms: number;      // their clock when the run ended
  score: number;   // their final score (display only; the verdict never reads it)
  kills: number[]; // ms timestamp of each kill, ascending — the echo
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

// Who takes the duel. Claiming the village beats falling; two claims race the
// clock; two falls compare how much of the watch each cut down, then who lasted
// longer. Score is deliberately not consulted — it bends with pelts, while
// time-and-kills on the same seed is apples to apples.
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

function buildArena(level: LevelDef, seed?: number): WwState {
  // The whole build runs on a seeded stream: pass a rival's seed and the same
  // village rises — same stones, same greens, same watch — on any device. Left
  // unseeded, a fresh roll is drawn (and kept on s.seed), so ANY hunt can be
  // turned into a challenge after the fact.
  const arenaSeed = (seed ?? Math.floor(Math.random() * 0x100000000)) >>> 0;
  rnd = mulberry32(arenaSeed);
  const w = Math.round(W * VILLAGE_SCALE * (level.sizeScale ?? 1));
  const h = Math.round(H * VILLAGE_SCALE * (level.sizeScale ?? 1));
  const { nodes: scenery, greens } = generateWerewolf(level, w, h);
  const walls = weaveSegments(scenery, level.wallCount * CONTENT_SCALE, level.minDist * 0.9, level.minDist * 2.0);
  const paths = weaveSegments(scenery, level.pathCount * CONTENT_SCALE, level.minDist * 3, level.minDist * 5);
  const legacy = loadWwLegacy();
  const pelt = peltTypeById(legacy.equipped);
  const hero: Hero = {
    x: w / 2, y: h / 2, vx: 0, vy: 0, hp: HERO_HP, maxHp: HERO_HP,
    fury: 0, maxFury: 1, form: "human",
    hurt: 0, momentum: 0, facing: -Math.PI / 2, biteCd: 0, pounceCd: 0,
    lunge: 0, lungeVx: 0, lungeVy: 0, transformAt: 0,
  };
  const foes: Foe[] = [];
  const houndCount = Math.min((level.houndCount ?? 0) * CONTENT_SCALE, greens.length);
  const knightCount = Math.min((level.knightCount ?? 0) * CONTENT_SCALE, greens.length);
  const huntsmanCount = Math.min((level.huntsmanCount ?? 0) * CONTENT_SCALE, greens.length);
  const friarCount = Math.min((level.friarCount ?? 0) * CONTENT_SCALE, greens.length);
  // Muster one foe near a green — a small helper so a green's villagers and its
  // (optional) variants all rise the same way.
  const muster = (green: { x: number; y: number }, variant: FoeKind, hpMul: number): void => {
    const a = rnd() * Math.PI * 2;
    const r = 16 + rnd() * 40;
    const x = clamp(green.x + Math.cos(a) * r, FOE_RADIUS, w - FOE_RADIUS);
    const y = clamp(green.y + Math.sin(a) * r, FOE_RADIUS, h - FOE_RADIUS);
    const hp = Math.round(FOE_HP * hpMul);
    foes.push({
      x, y, vx: 0, vy: 0, hp, maxHp: hp, dead: false,
      state: "lurk", variant,
      wanderAngle: rnd() * Math.PI * 2,
      homeX: green.x, homeY: green.y,
      attackCd: 0, shootCd: rnd() * HUNTSMAN_SHOOT_CD, hit: 0, bornAt: 0, alarm: 0,
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
  for (let i = 0; i < level.mistCount * CONTENT_SCALE; i++) {
    const a = rnd() * Math.PI * 2;
    mists.push({
      x: 100 + rnd() * (w - 200),
      y: 100 + rnd() * (h - 200),
      r: 130 + rnd() * 110,
      vx: Math.cos(a) * MIST_DRIFT, vy: Math.sin(a) * MIST_DRIFT,
    });
  }
  const state: WwState = {
    level, w, h, scenery,
    solids: scenery.filter((n) => OBSTACLE_KINDS.has(n.kind)),
    cairns: scenery.filter((n) => n.kind === "cairn"),
    moonwells: scenery.filter((n) => n.kind === "moonwell"),
    walls, paths,
    hero, pelt, foes,
    bolts: [], pulses: [], motes: [], mists,
    moon: MOON_START,
    quarry: -1, quarryNight: false, quarrySlain: 0,
    elapsed: 0, slain: 0, hits: 0, total: foes.length,
    cairnsTotal: scenery.filter((n) => n.kind === "cairn").length,
    litCount: 0, cleansedCount: 0,
    seed: arenaSeed, killTimes: [],
    phase: "hunt",
  };
  rnd = Math.random; // the seeded window covers the build only — live sim rolls free
  return state;
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

// The HUD's secondary readout: the shape, the hour, how roused the village is, and
// whether the moon's quarry is marked (the night's bounty, waiting to be run down).
function furyReadout(s: WwState): string {
  const shape = s.hero.form === "wolf" ? "Wolf" : "Man";
  const panic = Math.round(villagePanic(s) * 100);
  const mark = s.quarry >= 0 ? " · QUARRY marked" : "";
  return `${shape} · ${moonWord(s)} · village ${panic}% roused${mark}`;
}

function difficultyMult(level: LevelDef): number {
  const variants = (level.houndCount ?? 0) + (level.knightCount ?? 0) +
    (level.huntsmanCount ?? 0) + (level.friarCount ?? 0);
  const m = 0.8 + level.greenCount * 0.05 + variants * 0.04 + ((level.sizeScale ?? 1) - 1) * 0.5;
  return Math.round(m * 100) / 100;
}

interface ScoreBreakdown {
  base: number; speed: number; cairns: number; quarry: number; survival: number;
  untouched: number; mult: number; total: number;
}
function scoreRun(s: WwState): ScoreBreakdown {
  const base = s.total * SCORE_PER_KILL;
  const target = s.total * SCORE_TARGET_PER_KILL;
  const speed = Math.max(0, Math.round(((target - s.elapsed) / 1000) * SCORE_SPEED_PER_SEC));
  const cairns = s.cairnsTotal ? Math.round((s.litCount / s.cairnsTotal) * SCORE_CAIRNS_MAX) : 0;
  const quarry = s.quarrySlain * SCORE_QUARRY;
  const survival = Math.round((s.hero.hp / s.hero.maxHp) * SCORE_SURVIVAL_MAX);
  const untouched = s.hits === 0 ? SCORE_UNTOUCHED : 0;
  const mult = difficultyMult(s.level);
  const total = Math.round((base + speed + cairns + quarry + survival + untouched) * mult);
  return { base, speed, cairns, quarry, survival, untouched, mult, total };
}

// Centralized foe-death path — so every kill (maw pulse, cairn aura, frenzy leap)
// counts the same and fires the pelt's on-kill power identically. The mirror of the
// siblings' killKnight / banish.
function slay(s: WwState, e: Foe): void {
  if (e.dead) return;
  e.dead = true;
  s.slain += 1;
  s.killTimes.push(Math.round(s.elapsed)); // the echo a duel token carries
  const h = s.hero;
  // Feeding the beast: a kill always stokes the curse a little AND mends the predator
  // (the lit-dwelling heal of the Vigil, inverted to the kill).
  h.fury = clamp(h.fury + FURY_PER_KILL, 0, h.maxFury);
  h.hp = Math.min(h.maxHp, h.hp + KILL_HEAL);
  // A kill is LOUD: it terrifies the prey that witness it to full alarm. Killing in the
  // open spreads panic; an isolated kill stays quiet — the stealth-predator's craft.
  for (const o of s.foes) {
    if (o.dead || !isPrey(o.variant)) continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) <= ALARM_KILL_SPIKE_R) o.alarm = 1;
  }
  // The night's QUARRY run down — the blood-price: a surge of the curse, a full head
  // of momentum (the chase rewarded in the chase's own coin), and a deeper mend.
  if (s.quarry >= 0 && s.foes[s.quarry] === e) {
    s.quarry = -1;
    s.quarrySlain += 1;
    h.fury = clamp(h.fury + QUARRY_FURY, 0, h.maxFury);
    h.hp = Math.min(h.maxHp, h.hp + QUARRY_HEAL);
    if (h.form === "wolf") h.momentum = 1;
    s.pulses.push({ x: e.x, y: e.y, r: 90, until: s.elapsed + PULSE_FX_MS * 2 });
  }
  // The pelt's on-kill powers.
  if (s.pelt.power === "moonblood") {
    h.fury = clamp(h.fury + MOONBLOOD_FURY, 0, h.maxFury);
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

// Per-kind node index. Terrain queries (inNodeAura, the emitter/geyser/gale passes)
// used to scan ALL scenery per body per frame — O(foes × scenery), six figures of
// distance checks on the biggest villages. The index groups nodes by kind once per
// scenery array; it is keyed by ARRAY IDENTITY (WeakMap), so a state whose scenery
// is swapped wholesale (the tests do this) indexes afresh, and node kinds never
// change after generation so an index never goes stale. Pure derived data — never
// persisted, in the cached-`s.cairns` ethos.
const kindIndexCache = new WeakMap<ArenaNode[], Map<NodeKind, ArenaNode[]>>();
function nodesOfKind(s: WwState, kind: NodeKind): ArenaNode[] {
  let idx = kindIndexCache.get(s.scenery);
  if (!idx) {
    idx = new Map();
    for (const n of s.scenery) {
      const bucket = idx.get(n.kind);
      if (bucket) bucket.push(n); else idx.set(n.kind, [n]);
    }
    kindIndexCache.set(s.scenery, idx);
  }
  return idx.get(kind) ?? [];
}

// Generic: is the point within `aura` of any node of `kind`? The workhorse for the
// new passable-terrain auras (glade/spring/bog/…), so each reads one line.
function inNodeAura(s: WwState, x: number, y: number, kind: NodeKind, aura: number): boolean {
  for (const n of nodesOfKind(s, kind)) {
    if ((x - n.x) ** 2 + (y - n.y) ** 2 <= aura * aura) return true;
  }
  return false;
}

// Is the point in a moonlit glade? Here the hero traces the maw even while loping
// (the moonwell's moving-trace gift, on a smaller patch).
function inGlade(s: WwState, x: number, y: number): boolean {
  return inNodeAura(s, x, y, "glade", GLADE_AURA);
}

// Is the point under a stand of woods? Concealing cover (the static cousin of mist):
// the wolf melts into the trees — hidden from the watch's huntsmen, and rousing the
// watch from a shrunken aggro range (see stepFoes).
function inWoods(s: WwState, x: number, y: number): boolean {
  return inNodeAura(s, x, y, "woods", WOODS_AURA);
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
    for (const n of nodesOfKind(s, kind)) {
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
  for (const n of nodesOfKind(s, "geyser")) {
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
  for (const n of nodesOfKind(s, "gale")) {
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
  for (const n of nodesOfKind(s, "hoard")) {
    if (n.spent) continue;
    if ((n.x - h.x) ** 2 + (n.y - h.y) ** 2 <= rr) {
      n.spent = true;
      h.fury = clamp(h.fury + HOARD_FURY, 0, h.maxFury);
    }
  }
}

// The wolf rends ONE foe — a contact bite whose force scales with MOMENTUM (a graze at
// a standstill, a maiming at a full run; heavier still mid-lunge). It feeds the beast
// on a kill, claims a dark DEN nearby, and is the deterministic heart of the weapon.
// stepMaul finds the target and paces it; the test calls this directly. (Assumes a
// wolf; stepMaul guarantees it. The single-target inverse of the siblings' AoE pulse.)
function bite(s: WwState, e: Foe): void {
  const h = s.hero;
  if (e.dead) return;
  const lunging = h.lunge > 0;
  const momMul = MAUL_MIN_MUL + (1 - MAUL_MIN_MUL) * h.momentum;
  let dmg = MAUL_DMG * momMul * s.pelt.dmgMul;
  if (lunging) dmg *= POUNCE_DMG_MUL;
  // Shove the prey — a plain bite nudges, a pounce or a Black-pelt bite flings.
  const a = Math.atan2(e.y - h.y, e.x - h.x);
  const knock = (lunging || s.pelt.power === "terror") ? TERROR_KNOCK : MAUL_KNOCK;
  e.x += Math.cos(a) * knock;
  e.y += Math.sin(a) * knock;
  hurtFoe(s, e, dmg);
  // Claim a dark DEN if the kill (or bite) fell beside one — territory the wolf marks.
  for (const n of s.cairns) {
    if (n.lit) continue;
    if (n.cleansed && n.cleansed > s.elapsed) continue;
    if (Math.hypot(n.x - h.x, n.y - h.y) <= CAIRN_MARK_REACH) markCairn(s, n);
  }
  // A short rend-ring at the throat (the bite FX; a pounce's reads bigger).
  s.pulses.push({
    x: e.x, y: e.y, r: (HERO_RADIUS + FOE_RADIUS) * (lunging ? 1.8 : 1),
    until: s.elapsed + PULSE_FX_MS,
  });
}

// Index of the nearest non-dead foe within `range` AND within `arc` (radians) of the
// wolf's facing — the pounce's target search (a frontal cone, so a pounce commits the
// way you steer). -1 if none.
function frontalFoe(s: WwState, range: number, arc: number): number {
  const h = s.hero;
  let best = -1, bestD = range;
  for (let i = 0; i < s.foes.length; i++) {
    const e = s.foes[i];
    if (e.dead) continue;
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    if (d >= bestD) continue;
    const a = Math.atan2(e.y - h.y, e.x - h.x);
    let da = Math.abs(a - h.facing);
    if (da > Math.PI) da = 2 * Math.PI - da;
    if (da <= arc) { bestD = d; best = i; }
  }
  return best;
}

// Pace the maul — the WOLF's weapon, all of it. Only a wolf rends (a man cannot fight,
// the gate that makes the form matter). On the bite cadence it rends the nearest foe in
// contact reach; and at high momentum, if prey sits in the frontal cone, it auto-POUNCES
// — a brief locked lunge that closes the gap and lands a heavy bite. Pure joystick:
// both fall out of where and how fast you steer; there is no attack button.
function stepMaul(s: WwState, dt = 16): void {
  const h = s.hero;
  if (h.form !== "wolf") return;
  if (h.biteCd > 0) h.biteCd -= dt;
  if (h.pounceCd > 0) h.pounceCd -= dt;
  // Contact bite: rend the nearest foe the wolf's body reaches, on the cadence.
  const reach = HERO_RADIUS + FOE_RADIUS + MAUL_REACH * s.pelt.radiusMul;
  if (h.biteCd <= 0) {
    const idx = nearestFoe(s, h.x, h.y, reach);
    if (idx >= 0) { bite(s, s.foes[idx]); h.biteCd = BITE_CD * s.pelt.pulseMul; }
  }
  // Auto-pounce: enough momentum + a frontal foe → lunge onto it (handled next frame in
  // stepHunt, which overrides the hero's velocity while h.lunge runs).
  if (h.lunge <= 0 && h.pounceCd <= 0 && h.momentum >= POUNCE_AT) {
    const idx = frontalFoe(s, POUNCE_RANGE * s.pelt.radiusMul, POUNCE_ARC);
    if (idx >= 0) {
      const e = s.foes[idx];
      const a = Math.atan2(e.y - h.y, e.x - h.x);
      h.lunge = POUNCE_MS;
      h.lungeVx = Math.cos(a) * POUNCE_SPEED;
      h.lungeVy = Math.sin(a) * POUNCE_SPEED;
      h.facing = a;
      h.pounceCd = POUNCE_CD;
      h.momentum = Math.min(h.momentum, POUNCE_SPEND);
    }
  }
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

// Separation: nudge a body away from its crowded neighbours so they herd/swarm rather
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

// Cohesion: pull a fleeing prey toward the centroid of its nearby flock — the flocking
// that makes the watch break into a HERD (curve toward kin) instead of scattering as
// loose dots. Returned at a fraction of travel speed so flight still wins.
function cohesion(s: WwState, e: Foe): { x: number; y: number } {
  let cx = 0, cy = 0, n = 0;
  for (const o of s.foes) {
    if (o === e || o.dead || !isPrey(o.variant)) continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) < ALARM_SPREAD_R) { cx += o.x; cy += o.y; n++; }
  }
  if (n === 0) return { x: 0, y: 0 };
  cx = cx / n - e.x; cy = cy / n - e.y;
  const d = Math.hypot(cx, cy) || 1;
  return { x: (cx / d) * PREY_COHESION * FOE_SPEED, y: (cy / d) * PREY_COHESION * FOE_SPEED };
}

// Idle drift on a leash around a body's green (shared by un-roused prey and hunters).
function wander(s: WwState, e: Foe, dt: number): void {
  // Jitter scaled by dt so the drift's character doesn't change with refresh rate.
  e.wanderAngle += (Math.random() - 0.5) * 0.5 * (dt / 16.7);
  let wx = Math.cos(e.wanderAngle) * FOE_WANDER_SPEED;
  let wy = Math.sin(e.wanderAngle) * FOE_WANDER_SPEED;
  const dHome = Math.hypot(e.x - e.homeX, e.y - e.homeY);
  if (dHome > FOE_LEASH) {
    wx = ((e.homeX - e.x) / dHome) * FOE_WANDER_SPEED;
    wy = ((e.homeY - e.y) / dHome) * FOE_WANDER_SPEED;
  }
  moveBody(s, e, wx, wy, dt, FOE_RADIUS);
}

// The village's panic — the average alarm across the living prey (0..1). Drives the
// HUD readout and, at/above ALARM_ROUSE, sends the hunters converging.
function villagePanic(s: WwState): number {
  let sum = 0, n = 0;
  for (const e of s.foes) if (!e.dead && isPrey(e.variant)) { sum += e.alarm; n++; }
  return n ? sum / n : 0;
}

// The watch AI — the predator-hunt's other half. PREY (villager/hound) flee the hero
// and FLOCK; their ALARM radiates from the hero's conspicuousness, spreads prey→prey,
// and decays — so cull quiet and isolated to keep the village calm. A roused village
// (or the wolf at close range) sends the armed HUNTERS (knight/huntsman/friar)
// converging: they are the real threat. Stealth as a man falls out for free (a calm man
// radiates nothing).
function stepFoes(s: WwState, dt: number): void {
  const h = s.hero;
  const fewLeft = aliveFoes(s) <= Math.ceil(s.total * CLEANUP_AGGRO_FRAC);
  const muffled = inMist(s, h.x, h.y) || inWoods(s, h.x, h.y);
  // How loud the hero reads to the flock this frame (the alarm he radiates). A calm or
  // slow man reads as one of their own (0); a sprinting man, or any wolf, is loud.
  const spd = Math.hypot(h.vx, h.vy);
  let conspic = h.form === "wolf" ? ALARM_RADIATE_WOLF
    : spd > MAN_SPRINT_SPEED ? ALARM_RADIATE_MAN : 0;
  if (muffled) conspic *= ALARM_MUFFLE_MUL;

  // ---- Alarm pass: radiate from the hero into nearby prey, spread prey→prey, decay. ----
  const prey: Foe[] = [];
  for (const e of s.foes) if (!e.dead && isPrey(e.variant)) prey.push(e);
  for (const e of prey) {
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    let a = e.alarm - (ALARM_DECAY * dt) / 1000;
    if (conspic > 0 && d < ALARM_RADIATE_REACH) {
      a += conspic * (1 - d / ALARM_RADIATE_REACH) * dt / 1000;
    }
    e.alarm = clamp(a, 0, 1);
  }
  // Spread (two-phase, so the result is order-independent): each prey eases toward the
  // alarm of its loudest near neighbour.
  if (prey.length > 1) {
    const add = new Array<number>(prey.length).fill(0);
    for (let i = 0; i < prey.length; i++) {
      let loud = prey[i].alarm;
      for (let j = 0; j < prey.length; j++) {
        if (i === j) continue;
        if (Math.hypot(prey[i].x - prey[j].x, prey[i].y - prey[j].y) < ALARM_SPREAD_R
          && prey[j].alarm > loud) loud = prey[j].alarm;
      }
      add[i] = (loud - prey[i].alarm) * ALARM_SPREAD_RATE * dt / 1000;
    }
    for (let i = 0; i < prey.length; i++) prey[i].alarm = clamp(prey[i].alarm + add[i], 0, 1);
  }
  // The village average — what rouses the hunters.
  let alarmSum = 0;
  for (const e of prey) alarmSum += e.alarm;
  const roused = (prey.length ? alarmSum / prey.length : 0) >= ALARM_ROUSE || fewLeft;

  for (const e of s.foes) {
    if (e.dead) continue;
    e.aiming = false; e.channeling = false;
    const dxh = h.x - e.x, dyh = h.y - e.y;
    const dh = Math.hypot(dxh, dyh) || 1;

    // ----- PREY: flee + flock. Not sticky — they calm as their alarm fades (slip into
    // mist and the herd settles). A wolf on top of a cornered prey takes a panic flail.
    if (isPrey(e.variant)) {
      // Flee on alarm, or on a CONSPICUOUS hero close by — but a muffled hero (in mist
      // or woods) must come much nearer to spook a prey by sight alone.
      const seeRange = FOE_AGGRO * (muffled ? STEALTH_AGGRO_MUL : 1);
      const flee = e.alarm >= PREY_FLEE_ALARM || (conspic > 0 && dh < seeRange) || fewLeft;
      e.state = flee ? "hunt" : "lurk";
      if (!flee) { wander(s, e, dt); continue; }
      const sep = separate(s, e);
      const coh = cohesion(s, e);
      const speed = FOE_SPEED * (e.variant === "hound" ? HOUND_SPEED_MUL : 1) * PREY_FLEE_SPEED_MUL;
      moveBody(s, e, (-dxh / dh) * speed + sep.x + coh.x, (-dyh / dh) * speed + sep.y + coh.y, dt, FOE_RADIUS);
      if (e.attackCd > 0) e.attackCd -= dt;
      const reach = HERO_RADIUS + FOE_RADIUS + FOE_ATTACK_REACH;
      if (h.form === "wolf" && dh <= reach && e.attackCd <= 0 && h.hurt <= 0) {
        e.attackCd = FOE_ATTACK_CD;
        h.hp -= e.variant === "hound" ? HOUND_CONTACT : FOE_CONTACT;
        h.hurt = HERO_IFRAMES_MS;
        s.hits += 1;
        h.x = clamp(h.x + (dxh / dh) * -HERO_KNOCKBACK, HERO_RADIUS, s.w - HERO_RADIUS);
        h.y = clamp(h.y + (dyh / dh) * -HERO_KNOCKBACK, HERO_RADIUS, s.h - HERO_RADIUS);
      }
      cleanseNearCairn(s, e);
      continue;
    }

    // ----- HUNTERS: converge when the village is roused or the wolf is near; sticky
    // once roused (armed pursuers do not give up). Muffled/human shrinks the proximity-wake.
    if (e.state === "lurk") {
      const near = dh < FOE_AGGRO * (muffled || h.form === "human" ? STEALTH_AGGRO_MUL : 1);
      if (roused || near) e.state = "hunt";
      else { wander(s, e, dt); continue; }
    }

    const sep = separate(s, e);

    if (e.variant === "huntsman") {
      // Hold a standoff; with line of sight it AIMS — a visible wind-up (the telegraph)
      // — then looses a silver bolt at where the hero stands as the string slips. The
      // wind-up is the dodge window: keep moving, or break its sight (a wall, mist,
      // the woods), and the aim is spoiled. It plants its feet while it draws.
      const speed = FOE_SPEED * HUNTSMAN_SPEED_MUL;
      let dirx = 0, diry = 0;
      if (dh < HUNTSMAN_STANDOFF) { dirx = -dxh / dh; diry = -dyh / dh; }   // kite away
      else if (dh > HUNTSMAN_RANGE) { dirx = dxh / dh; diry = dyh / dh; }   // close in
      if (e.aimUntil === undefined) {
        moveBody(s, e, dirx * speed + sep.x, diry * speed + sep.y, dt, FOE_RADIUS);
      }
      if (e.shootCd > 0) e.shootCd -= dt;
      const canSee = dh <= HUNTSMAN_RANGE && !wallBetween(s, e.x, e.y, h.x, h.y)
        && !inMist(s, h.x, h.y) && !inWoods(s, h.x, h.y);
      if (e.aimUntil !== undefined) {
        if (!canSee) {
          e.aimUntil = undefined;             // sight broken — the aim is spoiled
        } else if (s.elapsed >= e.aimUntil) { // the string slips — the bolt looses
          e.aimUntil = undefined;
          e.shootCd = HUNTSMAN_SHOOT_CD;
          e.aiming = true;
          const a = Math.atan2(dyh, dxh);
          s.bolts.push({ x: e.x, y: e.y, vx: Math.cos(a) * BOLT_SPEED, vy: Math.sin(a) * BOLT_SPEED, dead: false, bornAt: s.elapsed });
        }
      } else if (canSee && e.shootCd <= 0) {
        e.aimUntil = s.elapsed + BOLT_AIM_MS; // it draws the string — the telegraph begins
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

    // Knight — a heavy hunter: close and strike.
    const speed = FOE_SPEED * KNIGHT_SPEED_MUL;
    moveBody(s, e, (dxh / dh) * speed + sep.x, (dyh / dh) * speed + sep.y, dt, FOE_RADIUS);
    if (e.attackCd > 0) e.attackCd -= dt;
    const reach = HERO_RADIUS + FOE_RADIUS + FOE_ATTACK_REACH;
    if (dh <= reach && e.attackCd <= 0 && h.hurt <= 0) {
      e.attackCd = FOE_ATTACK_CD;
      h.hp -= KNIGHT_CONTACT;
      h.hurt = HERO_IFRAMES_MS;
      s.hits += 1;
      h.x = clamp(h.x + (dxh / dh) * -HERO_KNOCKBACK, HERO_RADIUS, s.w - HERO_RADIUS);
      h.y = clamp(h.y + (dyh / dh) * -HERO_KNOCKBACK, HERO_RADIUS, s.h - HERO_RADIUS);
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

// Claimed dens as ally emitters: the aura grants the hero fury (and tops up the wolf's
// momentum, the moon's foothold), rends the watch that strays in, and PANICS the prey
// within — driving alarm and shoving them outward, a herding tool for the predator.
function stepCairns(s: WwState, dt: number): void {
  const h = s.hero;
  for (const n of s.cairns) {
    if (!n.lit) continue;
    if (Math.hypot(h.x - n.x, h.y - n.y) <= CAIRN_AURA) {
      h.fury = clamp(h.fury + (CAIRN_FURY_PER_SEC * dt) / 1000, 0, h.maxFury);
      if (h.form === "wolf") h.momentum = Math.min(1, h.momentum + (CAIRN_FURY_PER_SEC * dt) / 1000);
    }
    for (const e of s.foes) {
      if (e.dead) continue;
      const ed = Math.hypot(e.x - n.x, e.y - n.y);
      if (ed > CAIRN_AURA) continue;
      hurtFoe(s, e, (CAIRN_DMG * dt) / 1000);
      if (isPrey(e.variant) && ed > 0) {
        e.alarm = clamp(e.alarm + (CAIRN_PANIC_PER_SEC * dt) / 1000, 0, 1);
        const push = (CAIRN_SHOVE * dt) / 1000;
        const p = pushOut(s, e.x + ((e.x - n.x) / ed) * push, e.y + ((e.y - n.y) / ed) * push, FOE_RADIUS);
        e.x = p.x; e.y = p.y;
      }
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

// ---------- The Night's Quarry ----------

// Choose the soul the moon marks: a hunter when any still stands (the watch's
// champion is the worthier prey), else among the prey. Random within the pool, so
// each night sends the wolf somewhere new.
function pickQuarry(s: WwState): number {
  const hunters: number[] = [], preyIdx: number[] = [];
  for (let i = 0; i < s.foes.length; i++) {
    const e = s.foes[i];
    if (e.dead) continue;
    (isPrey(e.variant) ? preyIdx : hunters).push(i);
  }
  const pool = hunters.length ? hunters : preyIdx;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : -1;
}

// Edge-detect the true-night window off the moon: as night falls the moon marks one
// living soul as the QUARRY; at dawn an unclaimed mark fades (missed — the moon does
// not wait). The reward lives in slay(), so any kill route (bite, den, pyre) claims it.
function stepQuarry(s: WwState): void {
  const night = daylight(s.moon) < QUARRY_NIGHT_DL;
  if (night && !s.quarryNight) {
    s.quarryNight = true;
    s.quarry = pickQuarry(s);
  } else if (!night && s.quarryNight) {
    s.quarryNight = false;
    s.quarry = -1; // dawn — the mark fades unclaimed
  }
  // Safety: a quarry felled by a route that predates the mark (or a stale index).
  if (s.quarry >= 0 && s.foes[s.quarry].dead) s.quarry = -1;
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
  // the swifter body. A lane speeds him; a bog bogs him (terrainSpeedMul, hero = not a
  // foe, so a bramble leaves him be). The two compose — a boosted lane through a bog.
  const onPath = s.paths.some(
    (p) => closestOnSegment(h.x, h.y, p.x1, p.y1, p.x2, p.y2).d <= PATH_HALF,
  );
  const baseSpeed = h.form === "wolf" ? HERO_SPEED_WOLF : HERO_SPEED_HUMAN;
  const speed = baseSpeed * (onPath ? PATH_BOOST : 1) * terrainSpeedMul(s, h.x, h.y, false);
  // While a pounce-lunge runs, the wolf's velocity is locked to the lunge (it commits);
  // otherwise the joystick drives it. The lunge is the only place momentum overrides input.
  if (h.lunge > 0) {
    h.lunge = Math.max(0, h.lunge - dt);
    h.vx = h.lungeVx;
    h.vy = h.lungeVy;
  } else {
    h.vx = move.x * speed;
    h.vy = move.y * speed;
  }
  {
    const p = pushOut(s, h.x + (h.vx * dt) / 1000, h.y + (h.vy * dt) / 1000, HERO_RADIUS);
    h.x = p.x; h.y = p.y;
  }
  if (h.hurt > 0) h.hurt = Math.max(0, h.hurt - dt);

  // The wolf faces where it runs — the pounce cone and the drawn body both read off it.
  const movdSpeed = Math.hypot(h.vx, h.vy);
  if (movdSpeed > HERO_STILL_MAXSPEED) h.facing = Math.atan2(h.vy, h.vx);

  // Moonlit footing — full moonlight inside a moonwell or a glade, whatever the hour.
  // There the wolf's MOMENTUM never bleeds (it can wheel and stalk without going cold).
  const moonlit = inMoonwell(s, h.x, h.y) || inGlade(s, h.x, h.y);
  const ml = moonlit ? 1 : moonlightOf(s.moon);
  const dl = moonlit ? 0 : daylight(s.moon);

  // MOMENTUM — the wolf's whole weapon. It builds while the beast runs near top speed
  // and bleeds when it slows (held, at moonlit footing). A man carries none.
  if (h.form === "wolf") {
    // A pounce-lunge doesn't feed the meter it just spent — its locked velocity
    // (well past top speed) would otherwise rebuild the POUNCE_SPEND within the
    // dash and defeat the cost.
    if (movdSpeed > MOMENTUM_MIN_SPEED && h.lunge <= 0) {
      h.momentum = Math.min(1, h.momentum + (dt / (MOMENTUM_RISE_MS * s.pelt.chargeMul)) * (movdSpeed / HERO_SPEED_WOLF));
    } else if (!moonlit) {
      h.momentum = Math.max(0, h.momentum - dt / MOMENTUM_DECAY_MS);
    }
  } else {
    h.momentum = 0;
  }

  // A bane-patch (wolfsbane) bleeds the hero's fury while he stands in it; a clear
  // spring slowly mends his wounds (gated by a cap, so it can't facetank the watch).
  if (inNodeAura(s, h.x, h.y, "wolfsbane", WOLFSBANE_AURA)) {
    h.fury = clamp(h.fury - (WOLFSBANE_DRAIN * dt) / 1000, 0, h.maxFury);
  }
  if (inNodeAura(s, h.x, h.y, "spring", SPRING_AURA)) {
    const ceil = Math.max(h.hp, h.maxHp * SPRING_HEAL_CAP);
    h.hp = Math.min(ceil, h.hp + (SPRING_HEAL_DPS * dt) / 1000);
  }

  // THE SHAPE — the moon drives the fury, the fury drives the form. A MAN's fury swells
  // under moonlight (faster as he holds still and BAYS); at the crest he TURNS. A WOLF's
  // fury bleeds (faster by daylight); spent, he turns back to a hunted man.
  const still = movdSpeed < HERO_STILL_MAXSPEED;
  if (h.form === "human") {
    h.fury = clamp(h.fury + (dt / FURY_RISE_MS) * (0.15 + ml) * (still ? 1.85 : 1), 0, h.maxFury);
    if (h.fury >= h.maxFury) { h.form = "wolf"; h.transformAt = s.elapsed; h.momentum = 0; }
  } else {
    h.fury = clamp(h.fury - (dt / FURY_DRAIN_MS) * (0.5 + dl * 1.5), 0, h.maxFury);
    if (h.fury <= 0) { h.form = "human"; h.transformAt = s.elapsed; h.momentum = 0; h.lunge = 0; }
  }

  stepQuarry(s);      // nightfall marks the moon's quarry; dawn fades an unclaimed mark
  stepMaul(s, dt);    // a wolf rends in contact reach (momentum-scaled) and auto-pounces
  stepFoes(s, dt);    // prey flee & flock; the alarm rouses the hunters to converge
  stepBolts(s, dt);   // silver bolts in flight
  stepCairns(s, dt);  // claimed dens grant fury/momentum, rend & panic the watch in aura
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
  field: 40, stone: 48, cottage: 76, cairn: 44, moonwell: 60,
  pyre: 72, dolmen: 80, gibbet: 52, cart: 44,
  wisp: 44, marshfire: 60, bog: 60, bramble: 60, glade: 60,
  spring: 56, geyser: 56, gale: 56, wolfsbane: 52, hoard: 44, woods: 96,
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

// Draw one of the watch procedurally — each kind its own silhouette, so the five
// roles read at a glance with zero PNGs: the hooded villager, the coursing hound,
// the plated knight, the bowed huntsman, the robed friar. A panicked prey cries out
// (the "!" that makes the alarm layer visible). Pure render, no sim reads back.
function drawFoe(s: WwState, e: Foe, layer: SVGGElement, r: number): void {
  const flash = e.hit > s.elapsed;
  const op = e.state === "lurk" ? 0.7 : 1;
  const stroke = e.state === "hunt" ? "#0a0d12" : "#2a3038";
  const body = (fill: string) => layer.appendChild(el("circle", {
    cx: e.x, cy: e.y, r, fill: flash ? "#ffffff" : fill, stroke, "stroke-width": 2, opacity: op,
  }));
  switch (e.variant) {
    case "hound": {
      // A coursing hound — a low body stretched along its run, ears pricked, a tail.
      const a = (Math.atan2(e.vy, e.vx) * 180) / Math.PI;
      const g = el("g", { transform: `rotate(${a.toFixed(1)} ${e.x} ${e.y})`, opacity: op });
      g.appendChild(el("line", {
        x1: e.x - r * 1.3, y1: e.y, x2: e.x - r * 2.0, y2: e.y - r * 0.5,
        stroke: "#4a3c28", "stroke-width": 2.5, "stroke-linecap": "round",
      }));
      g.appendChild(el("ellipse", {
        cx: e.x, cy: e.y, rx: r * 1.45, ry: r * 0.72,
        fill: flash ? "#ffffff" : FOE_HUE.hound, stroke, "stroke-width": 2,
      }));
      g.appendChild(el("path", {
        d: `M${e.x + r * 0.8} ${e.y - r * 0.5}l7 -6 -1 7Z`,
        fill: "#4a3c28", stroke: "#2a2014", "stroke-width": 1,
      }));
      g.appendChild(el("circle", { cx: e.x + r * 1.15, cy: e.y, r: 2, fill: "#1a1d22" }));
      layer.appendChild(g);
      break;
    }
    case "knight": {
      body(FOE_HUE.knight);
      // A kite shield on the arm; the great helm (visor slit); the drawn sword.
      layer.appendChild(el("path", {
        d: `M${e.x - r - 7} ${e.y - 8}q7 -5 14 0l-2 11q-5 8 -10 0Z`,
        fill: "#5a2a2a", stroke: "#aeb6c0", "stroke-width": 1.5, opacity: op,
      }));
      layer.appendChild(el("rect", {
        x: e.x - 6, y: e.y - r - 4, width: 12, height: 11, rx: 2,
        fill: "#aeb6c0", stroke: "#3a4048", "stroke-width": 1.5, opacity: op,
      }));
      layer.appendChild(el("line", {
        x1: e.x - 4, y1: e.y - r + 1, x2: e.x + 4, y2: e.y - r + 1,
        stroke: "#14181e", "stroke-width": 1.6, opacity: op,
      }));
      layer.appendChild(el("line", {
        x1: e.x + r, y1: e.y + 4, x2: e.x + r + 12, y2: e.y - 10,
        stroke: "#d8dee8", "stroke-width": 2.2, "stroke-linecap": "round", opacity: op,
      }));
      break;
    }
    case "huntsman": {
      body(FOE_HUE.huntsman);
      // A deep hood; the drawn bow and its string; a quiver at the back.
      layer.appendChild(el("circle", { cx: e.x, cy: e.y - r * 0.25, r: 4.5, fill: "#243018", opacity: op }));
      layer.appendChild(el("path", {
        d: `M${e.x + r - 2} ${e.y - r + 2}Q${e.x + r + 8} ${e.y} ${e.x + r - 2} ${e.y + r - 2}`,
        fill: "none", stroke: "#caa86a", "stroke-width": 2, opacity: op,
      }));
      layer.appendChild(el("line", {
        x1: e.x + r - 2, y1: e.y - r + 2, x2: e.x + r - 2, y2: e.y + r - 2,
        stroke: "#e8ecf6", "stroke-width": 0.8, opacity: op * 0.8,
      }));
      layer.appendChild(el("rect", {
        x: e.x - r - 4, y: e.y - 8, width: 5, height: 14, rx: 2,
        fill: "#4a3520", stroke: "#2a1e10", "stroke-width": 1, opacity: op,
      }));
      break;
    }
    case "friar": {
      body(FOE_HUE.friar);
      // The tonsured head under the cowl, and the raised cross — aglow as it channels.
      layer.appendChild(el("circle", {
        cx: e.x, cy: e.y - r * 0.3, r: 4.5,
        fill: "#c9b896", stroke: "#7a6a4a", "stroke-width": 1, opacity: op,
      }));
      layer.appendChild(el("path", {
        d: `M${e.x - 6} ${e.y - r * 0.3}a6 6 0 0 1 12 0`,
        fill: "none", stroke: "#8a7a58", "stroke-width": 2, opacity: op,
      }));
      const cop = e.channeling ? 1 : 0.85;
      layer.appendChild(el("rect", {
        x: e.x + r - 1, y: e.y - r - 8, width: 2.6, height: 14, fill: "#e6e0b0",
        opacity: cop, filter: e.channeling ? "url(#glow)" : undefined as unknown as string,
      }));
      layer.appendChild(el("rect", {
        x: e.x + r - 5, y: e.y - r - 4, width: 10.6, height: 2.6, fill: "#e6e0b0", opacity: cop,
      }));
      break;
    }
    default: {
      // Villager — a hooded head over a plain tunic.
      body(FOE_HUE.villager);
      layer.appendChild(el("circle", { cx: e.x, cy: e.y - r * 0.25, r: 4, fill: "#3a2e1e", opacity: op }));
      layer.appendChild(el("path", {
        d: `M${e.x - 5.5} ${e.y - r * 0.25}a5.5 5.5 0 0 1 11 0`,
        fill: "none", stroke: "#6a5a3e", "stroke-width": 2, opacity: op,
      }));
      break;
    }
  }
  // A panicked prey cries out — the alarm made visible at a glance.
  if (isPrey(e.variant) && e.alarm >= PREY_FLEE_ALARM && !flash) {
    const cry = layer.appendChild(el("text", {
      x: e.x + r * 0.9, y: e.y - r - 6, fill: "#ffd06a",
      "font-size": 13, "font-weight": 700, "text-anchor": "middle", opacity: 0.9,
    }));
    cry.textContent = "!";
  }
}

// Draw one of the expanded maps' new terrain/obstacle nodes procedurally. Returns
// true when it handled `n` (so the scenery loop skips its generic path). No PNGs
// ship for these yet — each reads as a coloured aura (where it has a reach) plus a
// distinct body, so the new vocabulary is legible without art. Pure render.
function renderNewTerrain(s: WwState, n: ArenaNode, layer: SVGGElement): boolean {
  const winter = !!s.level.winter; // snow-bound village — frost the woods
  const aura = (r: number, color: string, op: number, dash = "4 10") =>
    layer.appendChild(el("circle", {
      cx: n.x, cy: n.y, r, fill: "none", stroke: color,
      "stroke-width": 1.4, "stroke-dasharray": dash, opacity: op,
    }));
  const disc = (r: number, fill: string, op = 1) =>
    layer.appendChild(el("circle", { cx: n.x, cy: n.y, r, fill, opacity: op }));
  // A solid's drawn body matches its collision radius (OBSTACLE_RADIUS), so what you
  // see is what blocks you — the size audit's rule for every body-blocker.
  const R = OBSTACLE_RADIUS[n.kind] || 0;
  const solidRing = () => layer.appendChild(el("circle", {
    cx: n.x, cy: n.y, r: R, fill: "none", stroke: "#2c2a22", "stroke-width": 1.4, opacity: 0.4,
  }));
  // A single tree — a thick brown trunk and a layered, brightly-lit green canopy —
  // offset from the node centre, so a stand of woods can cluster several into a thicket.
  // Drawn big and high-contrast so the woods read clearly against the gloom.
  const tree = (dx: number, dy: number, cr: number) => {
    layer.appendChild(el("rect", { x: n.x + dx - 3, y: n.y + dy, width: 6, height: cr * 1.5, rx: 1.5, fill: "#3a2a18", opacity: 0.98 }));
    if (winter) {
      // a frosted evergreen — cool dark needles under a heavy cap of snow
      layer.appendChild(el("circle", { cx: n.x + dx, cy: n.y + dy, r: cr, fill: "#24463a", stroke: "#0a1a14", "stroke-width": 1.6, opacity: 0.98 }));
      layer.appendChild(el("circle", { cx: n.x + dx - cr * 0.24, cy: n.y + dy - cr * 0.30, r: cr * 0.62, fill: "#dfe9f2", opacity: 0.95 }));
      layer.appendChild(el("circle", { cx: n.x + dx - cr * 0.34, cy: n.y + dy - cr * 0.42, r: cr * 0.3, fill: "#ffffff", opacity: 0.9 }));
    } else {
      layer.appendChild(el("circle", { cx: n.x + dx, cy: n.y + dy, r: cr, fill: "#1d3f22", stroke: "#08160a", "stroke-width": 1.6, opacity: 0.98 }));
      layer.appendChild(el("circle", { cx: n.x + dx - cr * 0.26, cy: n.y + dy - cr * 0.30, r: cr * 0.6, fill: "#347a3a", opacity: 0.96 }));
      layer.appendChild(el("circle", { cx: n.x + dx - cr * 0.34, cy: n.y + dy - cr * 0.40, r: cr * 0.3, fill: "#5aac5e", opacity: 0.88 }));
    }
  };
  const pulse = 1 + 0.06 * Math.sin(s.elapsed / 240);
  switch (n.kind) {
    case "pyre": { // solid pyre + permanent burn aura (body fills its collision)
      aura(PYRE_AURA * pulse, "#ff9a3a", 0.22, "2 8");
      disc(PYRE_AURA, "#3a1606", 0.1);
      disc(R * 0.72, "#3a1606"); disc(R * 0.5, "#ff6a1e", 0.95); disc(R * 0.28, "#ffe6a0");
      solidRing(); return true;
    }
    case "dolmen": { disc(R, "#2c303a"); disc(R * 0.62, "#3a3f48", 0.95); disc(R * 0.3, "#565f6a", 0.9); solidRing(); return true; }
    case "gibbet": { // a gallows-post: an upright and a crossarm within the collision
      disc(R, "#241c14", 0.5);
      layer.appendChild(el("rect", { x: n.x - 2, y: n.y - R, width: 4, height: R * 2, fill: "#3a2c20" }));
      layer.appendChild(el("rect", { x: n.x - R * 0.7, y: n.y - R, width: R * 0.9, height: 4, fill: "#3a2c20" }));
      solidRing(); return true;
    }
    case "cart": { disc(R, "#2a2118"); disc(R * 0.6, "#3a2c20", 0.9); solidRing(); return true; }
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
    case "woods": { // a stand of trees — concealing cover (hide + dull aggro)
      aura(WOODS_AURA, winter ? "#8fb0d0" : "#3a7040", 0.26, "5 12");
      disc(WOODS_AURA, winter ? "#0c1420" : "#0b160c", 0.2); // forest shade pool out to the conceal radius
      tree(-34, 10, 24); tree(30, 20, 27); tree(2, -30, 26); tree(-16, 42, 20); tree(42, -24, 21);
      tree(-66, -12, 19); tree(64, 44, 20); tree(-48, 60, 18); tree(58, -52, 19); tree(10, 78, 18);
      return true;
    }
    default: return false;
  }
}

function render(s: WwState, layer: SVGGElement): void {
  layer.innerHTML = "";
  const night = moonlightOf(s.moon);
  const winter = !!s.level.winter; // a snow-bound village — cold palette, frosted scenery

  // Ground — the village floor. A winter village lays a cold moonlit-snow field over
  // the gloom (lighter, so the dark watch reads against it); otherwise the dirt floor
  // (or solid gloom if the art isn't loaded).
  const hasGround = sprites.has("ground");
  if (winter) {
    layer.appendChild(el("rect", { x: 0, y: 0, width: s.w, height: s.h, fill: "#6e7a90" }));
    // a faint brighter drift across the snow, so the field isn't a flat slab
    layer.appendChild(el("ellipse", {
      cx: s.w * 0.5, cy: s.h * 0.42, rx: s.w * 0.62, ry: s.h * 0.5,
      fill: "#8794a8", opacity: 0.5,
    }));
    if (hasGround) layer.appendChild(el("rect", {
      x: 0, y: 0, width: s.w, height: s.h, fill: "url(#groundPat)", opacity: 0.16,
    }));
  } else {
    layer.appendChild(el("rect", {
      x: 0, y: 0, width: s.w, height: s.h,
      fill: hasGround ? "url(#groundPat)" : "#10131a", opacity: hasGround ? 0.5 : 1,
    }));
  }

  // Paths — the village lanes beneath the built world. In winter they read as trodden
  // tracks through the snow (a darker slush bed, footprints lighter than the drift).
  for (const p of s.paths) {
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: winter ? "#566378" : "#231f1a", "stroke-width": PATH_HALF * 2, "stroke-linecap": "round", opacity: winter ? 0.6 : 0.5,
    }));
    layer.appendChild(el("line", {
      x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2,
      stroke: winter ? "#b6c2d4" : "#4a4030", "stroke-width": 3, "stroke-linecap": "round",
      "stroke-dasharray": "10 14", opacity: winter ? 0.55 : 0.45,
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
      stroke: winter ? "#d4dceb" : "#3a4a28", "stroke-width": 2.5, "stroke-linecap": "round", opacity: winter ? 0.7 : 0.5,
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
        fill: winter ? "#525a66" : "#3a3f48", stroke: winter ? "#8a96a6" : "#565f6a", "stroke-width": 1.5,
      }));
      // a cap of snow on the standing stone's crown
      if (winter) layer.appendChild(el("path", {
        d: `M${n.x - 10} ${n.y - 16}Q${n.x} ${n.y - 26} ${n.x + 10} ${n.y - 16}L${n.x + 10} ${n.y - 22}Q${n.x} ${n.y - 27} ${n.x - 10} ${n.y - 22}Z`,
        fill: "#e6ecf6", opacity: 0.92,
      }));
    } else if (n.kind === "cottage") {
      // Body and roof span the collision radius (≈30) so the cottage reads as big as it
      // blocks; brighter timber + a lit window make it legible in the night gloom. In
      // winter the thatch wears a thick cap of snow and the warm window glows against it.
      layer.appendChild(el("rect", {
        x: n.x - 26, y: n.y - 14, width: 52, height: 34, rx: 2,
        fill: winter ? "#54504a" : "#4a3829", stroke: winter ? "#8a8278" : "#7a5e42", "stroke-width": 2.5,
      }));
      layer.appendChild(el("path", {
        d: `M${n.x - 32} ${n.y - 11}L${n.x} ${n.y - 38}L${n.x + 32} ${n.y - 11}Z`,
        fill: winter ? "#dfe7f2" : "#5e4830", stroke: winter ? "#aeb9cc" : "#7a5e42", "stroke-width": 2.5,
      }));
      layer.appendChild(el("rect", {
        x: n.x - 6, y: n.y - 4, width: 12, height: 15, rx: 1,
        fill: "#ffcf7a", opacity: 0.95, filter: "url(#glow)",
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
      // A field — a faint tuft, drawn sparsely (a glint of snow in winter).
      layer.appendChild(el("circle", { cx: n.x, cy: n.y, r: 4, fill: winter ? "#cdd6e6" : "#2a2e22", opacity: winter ? 0.6 : 0.5 }));
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
  const quarryFoe = s.quarry >= 0 ? s.foes[s.quarry] : null;
  for (const e of s.foes) {
    if (e.dead) continue;
    const r = e.variant === "knight" ? 18 : e.variant === "hound" ? 11 : 14;
    // A friar's consecration beam.
    if (e.channeling && e.beamX != null && e.beamY != null) {
      layer.appendChild(el("line", {
        x1: e.x, y1: e.y, x2: e.beamX, y2: e.beamY,
        stroke: "#e6e0b0", "stroke-width": 2, opacity: 0.55, "stroke-dasharray": "3 5",
      }));
    }
    // A huntsman's aim — the telegraph: a red sight-line that sharpens as the string
    // is drawn, so the bolt is dodgeable by reaction, not only by cover.
    if (e.variant === "huntsman" && e.aimUntil !== undefined) {
      const k = clamp(1 - (e.aimUntil - s.elapsed) / BOLT_AIM_MS, 0, 1);
      layer.appendChild(el("line", {
        x1: e.x, y1: e.y, x2: s.hero.x, y2: s.hero.y,
        stroke: "#e0566a", "stroke-width": 1.2 + k * 1.2,
        "stroke-dasharray": "2 6", opacity: 0.25 + 0.45 * k,
      }));
    }
    // The moon's mark — a pulsing gold halo and a crescent over the night's quarry.
    if (e === quarryFoe) {
      const qp = 1 + 0.1 * Math.sin(s.elapsed / 180);
      layer.appendChild(el("circle", {
        cx: e.x, cy: e.y, r: (r + 9) * qp, fill: "none", stroke: "#ffd06a",
        "stroke-width": 2.2, "stroke-dasharray": "6 6", opacity: 0.85, filter: "url(#glow)",
      }));
      layer.appendChild(el("path", {
        d: `M${e.x - 5} ${e.y - r - 15}a7 7 0 1 0 10 3a5.6 5.6 0 1 1 -10 -3Z`,
        fill: "#ffd06a", opacity: 0.95, filter: "url(#glow)",
      }));
    }
    const key = spriteFor(s.level, e.variant);
    if (key) { layer.appendChild(spriteImage(key, e.x, e.y, r * 2.6, 0.96)); }
    else drawFoe(s, e, layer, r);
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

  // The hero — a speed-streak that swells with the wolf's MOMENTUM (and flares mid-
  // pounce), drawn beneath the body, then the body itself (oriented to its heading).
  const h = s.hero;
  const wolf = h.form === "wolf";
  const deg = (h.facing * 180) / Math.PI;
  if (wolf && (h.momentum > 0.05 || h.lunge > 0)) {
    const trail = (24 + 70 * h.momentum) * (h.lunge > 0 ? 1.5 : 1);
    const bx = h.x - Math.cos(h.facing) * trail, by = h.y - Math.sin(h.facing) * trail;
    layer.appendChild(el("line", {
      x1: bx, y1: by, x2: h.x, y2: h.y,
      stroke: s.pelt.ring, "stroke-width": 4 + 7 * h.momentum,
      "stroke-linecap": "round", opacity: 0.18 + 0.4 * h.momentum + (h.lunge > 0 ? 0.3 : 0),
      filter: "url(#glow)",
    }));
    // A leading claw-arc when the beast is at a full sprint (the pounce is imminent).
    if (h.momentum >= POUNCE_AT) {
      const fx = h.x + Math.cos(h.facing) * (HERO_RADIUS + 10);
      const fy = h.y + Math.sin(h.facing) * (HERO_RADIUS + 10);
      layer.appendChild(el("circle", {
        cx: fx, cy: fy, r: 6, fill: "none", stroke: s.pelt.star,
        "stroke-width": 2, opacity: 0.55, filter: "url(#glow)",
      }));
    }
  }
  const hwKey = spriteFor(s.level, wolf ? "wolf-beast" : "wolf-human");
  if (hwKey) {
    // The beast sprite is authored facing east and spun to the wolf's heading, so
    // a static image keeps the procedural body's directional read; the man stands
    // upright whichever way he walks.
    const img = spriteImage(hwKey, h.x, h.y, HERO_RADIUS * (wolf ? 3.0 : 2.4), 1);
    if (wolf) {
      const g = el("g", { transform: `rotate(${deg.toFixed(1)} ${h.x} ${h.y})` });
      g.appendChild(img);
      layer.appendChild(g);
    } else layer.appendChild(img);
  }
  else {
    const hurt = h.hurt > 0 && Math.floor(s.elapsed / 80) % 2 === 0;
    if (wolf) {
      // The beast — a dark hunched body (stretched along its heading), a wedge muzzle,
      // pricked ears, cold eyes, and a tail streaming harder the faster it runs.
      const g = el("g", { transform: `rotate(${deg.toFixed(1)} ${h.x} ${h.y})` });
      const rad = HERO_RADIUS + 3;
      const stretch = 1.2 + 0.5 * h.momentum;
      const coat = hurt ? "#5a3a3a" : "#241f26";
      g.appendChild(el("path", {
        d: `M${h.x - rad * stretch + 2} ${h.y}q-8 ${-3 - 5 * h.momentum} -15 ${-9 - 7 * h.momentum}`,
        fill: "none", stroke: coat, "stroke-width": 5, "stroke-linecap": "round",
      }));
      g.appendChild(el("ellipse", {
        cx: h.x, cy: h.y, rx: rad * stretch, ry: rad * 0.92,
        fill: coat, stroke: "#7a708a", "stroke-width": 2.5, filter: "url(#glow)",
      }));
      // The muzzle — a wedge past the body's leading edge.
      g.appendChild(el("path", {
        d: `M${h.x + rad * stretch - 5} ${h.y - 6}L${h.x + rad * stretch + 9} ${h.y}L${h.x + rad * stretch - 5} ${h.y + 6}Z`,
        fill: coat, stroke: "#7a708a", "stroke-width": 1.5,
      }));
      // Ears at the leading (snout) end — drawn in the un-rotated frame, then spun by g.
      g.appendChild(el("path", {
        d: `M${h.x + rad * 0.66} ${h.y - rad * 0.6}l8 -5 -2 9Z M${h.x + rad * 0.66} ${h.y + rad * 0.6}l8 5 -2 -9Z`,
        fill: coat, stroke: "#7a708a", "stroke-width": 1.5,
      }));
      // A pale ridge along the spine, so the body reads as fur, not a blot.
      g.appendChild(el("line", {
        x1: h.x - rad * stretch * 0.6, y1: h.y, x2: h.x + rad * stretch * 0.55, y2: h.y,
        stroke: "#4a4054", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.8,
      }));
      g.appendChild(el("circle", { cx: h.x + rad * 0.9, cy: h.y - 3.5, r: 2.2, fill: "#ffe04a" }));
      g.appendChild(el("circle", { cx: h.x + rad * 0.9, cy: h.y + 3.5, r: 2.2, fill: "#ffe04a" }));
      layer.appendChild(g);
    } else {
      // The man — a cloaked, hooded figure; his eyes kindle amber as the fury crests
      // (the turn, telegraphed on the body itself).
      layer.appendChild(el("circle", {
        cx: h.x, cy: h.y, r: HERO_RADIUS - 1,
        fill: hurt ? "#ffd0d0" : "#b9a98e", stroke: "#7a6a4a", "stroke-width": 2.5,
      }));
      // The cloak's hem sweeping the lower body.
      layer.appendChild(el("path", {
        d: `M${h.x - HERO_RADIUS + 2} ${h.y + 3}a${HERO_RADIUS - 2} ${HERO_RADIUS - 2} 0 0 0 ${(HERO_RADIUS - 2) * 2} 0Z`,
        fill: "#6a5a40", opacity: 0.9,
      }));
      layer.appendChild(el("circle", { cx: h.x, cy: h.y - 4, r: 4.5, fill: "#2a2018" }));
      // The hood drawn over the head.
      layer.appendChild(el("path", {
        d: `M${h.x - 7} ${h.y - 3}a7 7 0 0 1 14 0`,
        fill: "none", stroke: "#4a3a28", "stroke-width": 2.5,
      }));
      if (h.fury > 0.75) {
        layer.appendChild(el("circle", { cx: h.x - 2.5, cy: h.y - 5, r: 1.4, fill: "#ffd06a", filter: "url(#glow)" }));
        layer.appendChild(el("circle", { cx: h.x + 2.5, cy: h.y - 5, r: 1.4, fill: "#ffd06a", filter: "url(#glow)" }));
      }
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
function recordHunt(level: LevelDef, ms: number, cairns = 0, moonstones = 0, slainN = 0): WwLegacy {
  const l = loadWwLegacy();
  l.runs += 1; l.hunts += 1;
  l.cairnsMarked += cairns;
  l.moonstones += moonstones;
  l.slain += slainN;
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

// ---------- Sound (zero-dep WebAudio synth — the shell's layer, never the sim's) ----------
// No audio files ship: every sound is a small oscillator/noise gesture synthesized
// at call time. The context unlocks on the first user gesture (autoplay policy); a
// header button mutes it, persisted in a tiny hint key (like the hub's lastClass —
// deliberately NOT part of the legacy). The sim never calls these: the shell diffs
// observable state across stepHunt and fires the matching gesture, so the pure-sim /
// shell split holds and the headless tests never touch audio.

const WW_SOUND_KEY = "werewolf.sound";
let actx: AudioContext | null = null;
let master: GainNode | null = null;
let soundOn = true;
try { soundOn = typeof localStorage !== "undefined" && localStorage.getItem(WW_SOUND_KEY) === "off" ? false : true; } catch { /* default on */ }

function ensureAudio(): void {
  if (!soundOn || typeof window === "undefined") return;
  type AC = typeof AudioContext;
  const w = window as unknown as { AudioContext?: AC; webkitAudioContext?: AC };
  const Ctor = w.AudioContext || w.webkitAudioContext;
  if (!Ctor) return;
  if (!actx) {
    actx = new Ctor();
    master = actx.createGain();
    master.gain.value = 0.22;
    master.connect(actx.destination);
  }
  if (actx.state === "suspended") void actx.resume();
}

function audioReady(): boolean {
  return soundOn && !!actx && !!master && actx.state === "running";
}

// One enveloped oscillator voice: type, a frequency glide f0→f1 over dur, a fast
// attack and an exponential decay. The building block of every pitched gesture.
function voice(type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak: number): void {
  if (!actx || !master) return;
  const t0 = actx.currentTime + at;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f0), t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.04, dur * 0.25));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

// A decaying burst of band-passed noise — the bite/thud/rush material.
function noiseBurst(at: number, dur: number, freq: number, q: number, peak: number): void {
  if (!actx || !master) return;
  const t0 = actx.currentTime + at;
  const n = Math.max(1, Math.ceil(actx.sampleRate * dur));
  const buf = actx.createBuffer(1, n, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain();
  g.gain.value = peak;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0);
}

// The hunt's gestures — named for the beat they score, so the shell reads as prose.
const sfx = {
  howl(): void { // the TURN — two detuned voices rising to a long fall (the bay)
    if (!audioReady()) return;
    voice("sine", 170, 420, 0, 0.55, 0.14);
    voice("sine", 176, 432, 0, 0.55, 0.1);
    voice("sine", 420, 180, 0.55, 0.9, 0.12);
    voice("sine", 428, 186, 0.55, 0.9, 0.08);
  },
  manAgain(): void { // the change spent — a falling sigh
    if (!audioReady()) return;
    voice("sine", 320, 130, 0, 0.6, 0.12);
  },
  bite(): void {
    if (!audioReady()) return;
    noiseBurst(0, 0.07, 950, 1.1, 0.4);
    voice("triangle", 150, 60, 0, 0.11, 0.22);
  },
  pounce(): void { // the lunge — a rushing sweep
    if (!audioReady()) return;
    noiseBurst(0, 0.18, 1500, 0.7, 0.22);
    voice("sawtooth", 800, 220, 0, 0.2, 0.06);
  },
  kill(): void {
    if (!audioReady()) return;
    noiseBurst(0, 0.14, 420, 0.8, 0.5);
    voice("sine", 120, 42, 0, 0.28, 0.3);
  },
  hurt(): void { // a blow lands on the hero
    if (!audioReady()) return;
    voice("sine", 220, 90, 0, 0.18, 0.28);
    noiseBurst(0, 0.08, 600, 1.0, 0.3);
  },
  bolt(): void { // a silver bolt looses — a high tick to glance at
    if (!audioReady()) return;
    voice("square", 1500, 950, 0, 0.06, 0.05);
  },
  quarryMark(): void { // the moon marks — a soft bell
    if (!audioReady()) return;
    voice("sine", 660, 655, 0, 0.7, 0.11);
    voice("sine", 990, 985, 0, 0.5, 0.05);
  },
  quarryClaim(): void { // the blood-price paid — two ascending bells
    if (!audioReady()) return;
    voice("sine", 660, 660, 0, 0.4, 0.12);
    voice("sine", 880, 880, 0.13, 0.55, 0.12);
  },
  denClaim(): void { // a den claimed — a low gong
    if (!audioReady()) return;
    voice("sine", 196, 182, 0, 0.9, 0.16);
    voice("sine", 392, 380, 0, 0.5, 0.06);
  },
  roused(): void { // the village rouses — a distant toll
    if (!audioReady()) return;
    voice("sine", 330, 305, 0, 1.0, 0.1);
    voice("sine", 660, 640, 0, 0.6, 0.04);
  },
  win(): void {
    if (!audioReady()) return;
    voice("sine", 392, 392, 0, 0.3, 0.12);
    voice("sine", 494, 494, 0.16, 0.3, 0.12);
    voice("sine", 587, 587, 0.32, 0.6, 0.14);
  },
  lost(): void {
    if (!audioReady()) return;
    voice("sine", 392, 388, 0, 0.35, 0.12);
    voice("sine", 311, 308, 0.2, 0.4, 0.12);
    voice("sine", 262, 258, 0.4, 0.8, 0.13);
  },
};

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
  const momFill = byId("mom");
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

  // ----- The moon dial (header) — built once, updated by hud(). The disc waxes
  // toward midnight (full) and wanes toward noon (dark); a marker rides the wheel's
  // rim; the ring turns gold while the night's quarry is marked. -----
  const moonEl = byId("moon");
  {
    const mdefs = el("defs", {});
    mdefs.innerHTML = `<clipPath id="mclip"><circle cx="12" cy="12" r="7"/></clipPath>`;
    moonEl.appendChild(mdefs);
  }
  const moonRing = el("circle", { cx: 12, cy: 12, r: 10.5, fill: "none", stroke: "#4a5468", "stroke-width": 1.2, opacity: 0.9 });
  const moonDisc = el("circle", { cx: 12, cy: 12, r: 7, fill: "#eef2ff", opacity: 0.95 });
  const moonShade = el("circle", { cx: 12, cy: 12, r: 7.4, fill: "#0a0d14", opacity: 0.88, "clip-path": "url(#mclip)" });
  const moonMark = el("circle", { cx: 12, cy: 1.5, r: 1.8, fill: "#cdd6ea" });
  moonEl.appendChild(moonRing);
  moonEl.appendChild(moonDisc);
  moonEl.appendChild(moonShade);
  moonEl.appendChild(moonMark);

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
    ensureAudio(); // first gesture unlocks the synth (autoplay policy)
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
    if (MOVE_KEYS.includes(k)) { keys.add(k); e.preventDefault(); ensureAudio(); }
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
    furyFill.style.width = Math.max(0, (s.hero.fury / s.hero.maxFury) * 100) + "%";
    // The fury bar glows gold once it crests into the beast.
    furyFill.style.filter = s.hero.form === "wolf" ? "drop-shadow(0 0 6px #ffd06a)" : "";
    // Momentum — the wolf's weapon-charge; only meaningful (and only shown) as a beast.
    const wolf = s.hero.form === "wolf";
    momFill.style.width = Math.max(0, (wolf ? s.hero.momentum : 0) * 100) + "%";
    (momFill.parentElement as HTMLElement).style.opacity = wolf ? "1" : "0.25";
    momFill.style.filter = wolf && s.hero.momentum >= 0.7 ? "drop-shadow(0 0 6px #e0566a)" : "";
    cityEl.textContent = s.level.name;
    furyEl.textContent = furyReadout(s);
    // The moon dial: the shade slides off the disc toward midnight and covers it
    // toward noon; the rim-marker rides the wheel (top = noon, bottom = midnight).
    moonEl.style.display = "block";
    const dl = daylight(s.moon);
    moonShade.setAttribute("cx", (12 + 15 * (1 - dl)).toFixed(2));
    const ma = s.moon * Math.PI * 2 - Math.PI / 2;
    moonMark.setAttribute("cx", (12 + 10.5 * Math.cos(ma)).toFixed(2));
    moonMark.setAttribute("cy", (12 + 10.5 * Math.sin(ma)).toFixed(2));
    moonRing.setAttribute("stroke", s.quarry >= 0 ? "#ffd06a" : "#4a5468");
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
    // The rival's echo paces the same readout: their kill count as of this very
    // moment of their run (✓ they claimed / ✝ they fell, once their clock is out).
    if (s.rival) {
      const rk = rivalKillsAt(s.rival, s.elapsed);
      const done = s.elapsed >= s.rival.ms ? (s.rival.result === "won" ? " ✓" : " ✝") : "";
      foes += ` · ⚔ ${s.rival.name} ${rk}${done}`;
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
    // The night's quarry — a gold ring so the mark can be tracked across the village.
    if (s.quarry >= 0 && !s.foes[s.quarry].dead) {
      const q = s.foes[s.quarry];
      mmEl.appendChild(el("circle", {
        cx: q.x * scale, cy: q.y * scale, r: 3.2,
        fill: "none", stroke: "#ffd06a", "stroke-width": 0.9, opacity: 0.95,
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
      // Snapshot the observable beats, step, then score what changed — the sound
      // layer never reaches into the sim; it listens to it.
      const pv = {
        form: s.hero.form, hp: s.hero.hp, slain: s.slain,
        bolts: s.bolts.length, biteCd: s.hero.biteCd, lunge: s.hero.lunge,
        quarry: s.quarry, quarrySlain: s.quarrySlain, lit: s.litCount,
        panic: villagePanic(s),
      };
      stepHunt(s, dt, move);
      if (audioReady()) {
        if (s.hero.form !== pv.form) { if (s.hero.form === "wolf") sfx.howl(); else sfx.manAgain(); }
        if (s.slain > pv.slain) sfx.kill();
        else if (s.hero.biteCd > pv.biteCd) sfx.bite();
        if (s.hero.lunge > 0 && pv.lunge <= 0) sfx.pounce();
        if (s.bolts.length > pv.bolts) sfx.bolt();
        if (s.hero.hp < pv.hp) sfx.hurt();
        if (s.quarry >= 0 && pv.quarry < 0) sfx.quarryMark();
        if (s.quarrySlain > pv.quarrySlain) sfx.quarryClaim();
        if (s.litCount > pv.lit) sfx.denClaim();
        if (pv.panic < ALARM_ROUSE && villagePanic(s) >= ALARM_ROUSE) sfx.roused();
      }
      centerCam(s.hero.x, s.hero.y);
    }

    render(s, layer);
    hud();
    minimap();

    if (s.phase === "won") { running = false; sfx.win(); onWin(); return; }
    if (s.phase === "lost") { running = false; sfx.lost(); onLost(); return; }
    requestAnimationFrame(huntFrame);
  }

  function startCity(level: LevelDef, duel: DuelRun | null = null): void {
    s = buildArena(level, duel ? duel.seed : undefined);
    if (duel) s.rival = duel; // the echo the HUD paces and the end screen judges
    loadCitySprites(level.id, repaint);
    hideOverlay();
    setupZoom();
    centerCam(s.hero.x, s.hero.y);
    hud();
    showToast("Claim the village: CUT DOWN every soul of the watch (count, top-right). You begin a MAN — frail, unable to fight. Stand STILL to bay at the moon and stoke your FURY (top-left, beneath your blood); under MOONLIGHT it swells fast. At its crest you TURN BEAST — then standing still traces a blood-moon maw that RENDS the watch around you. Feed (kill) to hold the change; daylight bleeds it. When TRUE NIGHT falls the moon MARKS one of the watch (a gold halo) — run the QUARRY down before dawn for a surge of the curse. Hunt the huntsmen's silver bolts and the friars' bells, mark the cairns, and lurk in the fog.");
    introHold = true;
    clearTimeout(introHoldTimer);
    introHoldTimer = setTimeout(() => { introHold = false; }, TOAST_MS);
    running = true; lastFrame = 0;
    requestAnimationFrame(huntFrame);
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

  // Fold the hunt just ended into a challenge record. The signature is left
  // blank here — the name prompt only fires if the hunter actually shares.
  function myDuelRun(result: "won" | "lost", score: number): DuelRun {
    return {
      name: "", level: s!.level.id, seed: s!.seed, weapon: s!.pelt.id,
      result, ms: Math.round(s!.elapsed), score: Math.round(score), kills: s!.killTimes.slice(),
    };
  }

  async function shareDuelLink(run: DuelRun): Promise<void> {
    const signed = { ...run, name: duelName() };
    const lvName = levelById(run.level)?.name ?? run.level;
    const url = `${gameUrl()}?duel=${encodeDuel(signed)}`;
    const text = run.result === "won"
      ? `⚔ I claimed ${lvName} in ${fmtTime(run.ms)}. Same village, same moon — outpace my echo.`
      : `⚔ ${lvName} brought me down at ${run.kills.length} kills. Same village, same moon — outlast my echo.`;
    const nav = navigator as Navigator & { share?: (d: unknown) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: "The Moon's Hunger — a duel", text, url }); return; }
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
        `${who}: ${d.result === "won" ? `claimed in ${fmtTime(d.ms)}` : `fell at ${d.kills.length} kills (${fmtTime(d.ms)})`}`;
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
    moonEl.style.display = "none";
    const lv = levelById(d.level)!; // decodeDuel already validated it
    const wpn = PELT_TYPES.find((t) => t.id === d.weapon);
    const feat = d.result === "won"
      ? `claimed it in <em>${fmtTime(d.ms)}</em>`
      : `were brought down at <em>${d.kills.length}</em> kills`;
    const body =
      `<p class="lede">⚔ <em>${d.name}</em> throws down a gauntlet from <em>${lv.name}</em>: ` +
      `they ${feat}${wpn ? `, wearing ${wpn.name}` : ""}.</p>` +
      `<p class="lede">Answer it and the same village rises for you — the same stones, the same watch, ` +
      `the same fog — while their echo paces you on the kill count. ` +
      `Beat their run and send the gauntlet back.</p>`;
    showOverlay(
      "A gauntlet thrown", body,
      "Answer under the same moon", () => startCity(lv, d),
      "Decline — choose a village", () => showPicker(),
    );
  }

  function onWin(): void {
    if (!s) return;
    const ms = s.elapsed;
    const cairns = s.litCount, total = s.cairnsTotal;
    const sc = scoreRun(s);
    const moonstones = Math.max(1, Math.round(sc.total / MOONSTONE_SCORE_DIV));
    const l = recordHunt(s.level, ms, cairns, moonstones, s.slain);
    const best = l.best[s.level.id];
    const cairnLine = (cairns >= total && total > 0
      ? `You claimed every den — <em>${total}</em>. The village is yours, stone and soul.`
      : `You claimed <em>${cairns}</em> of ${total} dens.`)
      + (s.cleansedCount ? ` The watch cleansed <em>${s.cleansedCount}</em> back to dark.` : "")
      + (s.quarrySlain ? ` You ran down <em>${s.quarrySlain}</em> of the moon's marked quarry.` : "");
    const row = (label: string, val: string) => `<div><dt>${label}</dt><dd>${val}</dd></div>`;
    // The story beat for this claim: the whole campaign done plays the epilogue;
    // otherwise, claiming a village opens the trail to the next (and says so),
    // threading the hunts into one war.
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
      row("Watch cut down", `${sc.base}`) +
      row("Speed", `${sc.speed}`) +
      row("Dens claimed", `${sc.cairns}`) +
      (sc.quarry ? row("Quarry run down", `${sc.quarry}`) : "") +
      row("Survival", `${sc.survival}`) +
      (sc.untouched ? row("Untouched", `${sc.untouched}`) : "") +
      row("Village difficulty", `×${sc.mult}`) +
      row("<strong>Total</strong>", `<strong>${sc.total}</strong>`) +
      `</dl></div>`;
    const mine = myDuelRun("won", sc.total);
    showOverlay(
      "The hunt is yours",
      `Every soul of <em>${s.level.name}</em> is cut down — ${s.total} of them — ` +
      `in <em>${fmtTime(ms)}</em>.<br><br>` +
      `${cairnLine}<br><br>` +
      (best === ms ? `<em>A new best for this village.</em>` : `Best here: ${fmtTime(best)}.`) +
      ` <em>+${moonstones}</em> moonstones gathered.` +
      breakdown + duelPanelHtml(mine),
      "Hunt again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
    wireDuelShare(mine);
  }

  function onLost(): void {
    if (!s) return;
    const moonstones = s.slain * MOONSTONE_PER_KILL;
    recordFall(s.litCount, s.slain, moonstones);
    const mine = myDuelRun("lost", 0);
    // The night's tally — the score language shown even on a fall, so the player
    // learns what pays before their first claim (win-only bonuses named, zeroed).
    const row = (label: string, val: string) => `<div><dt>${label}</dt><dd>${val}</dd></div>`;
    const densPts = s.cairnsTotal ? Math.round((s.litCount / s.cairnsTotal) * SCORE_CAIRNS_MAX) : 0;
    const tally =
      `<div class="legacy"><div class="legacy-head">The night's tally</div><dl>` +
      row("Watch cut down", `${s.slain * SCORE_PER_KILL}`) +
      (s.quarrySlain ? row("Quarry run down", `${s.quarrySlain * SCORE_QUARRY}`) : "") +
      row("Dens claimed", `${densPts}`) +
      row("Speed · survival · flawless", `— a claim would add these, ×${difficultyMult(s.level)}`) +
      `</dl></div>`;
    showOverlay(
      "You are brought down",
      `The watch of <em>${s.level.name}</em> dragged you down with ` +
      `<em>${aliveFoes(s)}</em> still abroad.` +
      `<br><br>You had cut down <em>${s.slain}</em> of ${s.total} and claimed <em>${s.litCount}</em> dens.` +
      (s.quarrySlain ? ` You ran down <em>${s.quarrySlain}</em> of the moon's marked quarry.` : ``) +
      `<br><br>` +
      (moonstones > 0 ? `The blood you spilled leaves <em>+${moonstones}</em> moonstones behind. ` : ``) +
      `<em>The moon will rise again. Hunt again.</em>` +
      tally + duelPanelHtml(mine),
      "Try again", () => startCity(s!.level),
      "Choose another", () => showPicker(),
    );
    wireDuelShare(mine);
  }

  function showPicker(selId?: string): void {
    s = null; running = false;
    introHold = false; clearTimeout(introHoldTimer);
    mmEl.style.display = "none";
    moonEl.style.display = "none";
    const l = loadWwLegacy();
    // The selected village — a still-locked one can never be the selection (its
    // button is disabled), so the Hunt button below always targets open ground.
    let sel = levelById(selId || "") || LEVELS[0];
    if (!villageUnlocked(sel, l)) sel = LEVELS[0];
    const card = sel.art ? `<img class="city-art" src="${sel.art}" alt="">` : "";
    // The campaign chapter for the selected village — the prologue stands in
    // front of the very first hunt (before any village is claimed), then each
    // village tells its own chapter, naming the trail on.
    const firstEver = l.hunts === 0 && Object.keys(l.best).length === 0;
    const story = firstEver && sel.id === LEVELS[0].id
      ? `<p class="story-pre">${PROLOGUE}</p><p class="city-story">${sel.story}</p>`
      : `<p class="city-story"><span class="story-ch">Night ${storyChapter(sel)}</span>${sel.story}</p>`;
    let html =
      card + story +
      `<p class="lede">Choose a village to hunt. You begin a man and frail; stand still to ` +
      `bay at the moon and stoke your fury until you turn beast, then run the watch down — ` +
      `the wolf's weapon is momentum, the maul and the pounce. Feed to hold the change, run ` +
      `the lanes, lurk in the fog, and cut down every soul to claim the village.</p><div class="cities">`;
    for (let i = 0; i < LEVELS.length; i++) {
      const lv = LEVELS[i];
      const done = l.best[lv.id];
      const open = villageUnlocked(lv, l);
      const ch = `<span class="city-ch">${ROMAN[i] ?? i + 1}</span>`;
      if (!open) {
        // A locked village keeps its mystery: name veiled behind its night, the
        // trail there dark until the village before it is claimed.
        const prev = LEVELS[i - 1];
        html +=
          `<button class="city locked" disabled>` +
          `<span class="city-name">${ch}A dark village <span class="legacy-new">locked</span></span>` +
          `<span class="city-line">Claim ${prev.name} to open the trail here.</span></button>`;
        continue;
      }
      const mark = done ? ` <span class="legacy-new">claimed ${fmtTime(done)}</span>` : "";
      html +=
        `<button class="city${lv.id === sel.id ? " sel" : ""}" data-id="${lv.id}">` +
        `<span class="city-name">${ch}${lv.name}${mark}</span>` +
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
        `<div><dt>Dens claimed</dt><dd>${l.cairnsMarked}</dd></div>` +
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
    moonEl.style.display = "none";
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

  // The sound toggle — persisted in the tiny hint key; muting suspends the context
  // (no synthesis cost while off), unmuting resumes/creates it on the same gesture.
  const muteBtn = byId("mute") as HTMLButtonElement;
  const syncMute = (): void => { muteBtn.textContent = soundOn ? "Sound: on" : "Sound: off"; };
  muteBtn.addEventListener("click", () => {
    soundOn = !soundOn;
    try { localStorage.setItem(WW_SOUND_KEY, soundOn ? "on" : "off"); } catch { /* ignore */ }
    if (soundOn) ensureAudio();
    else if (actx && actx.state === "running") void actx.suspend();
    syncMute();
  });
  syncMute();

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
// Mirrors the siblings: a headless harness sets __WW_TEST__ and reads the sim off
// __ww instead of the shell ever starting.
const testGlobal = globalThis as unknown as {
  __WW_TEST__?: boolean;
  __ww?: Record<string, unknown>;
};
if (typeof globalThis !== "undefined" && testGlobal.__WW_TEST__) {
  testGlobal.__ww = {
    generateWerewolf, buildArena, freshHunt, stepHunt,
    stepMaul, bite, frontalFoe, stepFoes, stepBolts, stepCairns, stepMists, stepMotes,
    stepFields, stepGeysers, stepGale, stepHoards, inNodeAura, inGlade, inWoods, terrainSpeedMul,
    stepQuarry, pickQuarry, nodesOfKind,
    slay, hurtFoe, markCairn, cleanseCairn, nearScar, nearestFoe, isPrey, villagePanic,
    inMist, inMoonwell, daylight, moonlightOf, moonWord,
    aliveFoes, clearedPct, furyReadout, scoreRun, difficultyMult,
    LEVELS, levelById, villageUnlocked, storyChapter, PROLOGUE, EPILOGUE,
    weaveSegments, closestOnSegment, segsCross, wallBetween, pushOut, pentagramPath,
    render, scaffold, scenerySprite, spriteFor,
    loadWwLegacy, saveWwLegacy, recordHunt, recordFall, emptyWwLegacy,
    PELT_TYPES, peltTypeById, unlockPelt, equipPelt,
    encodeDuel, decodeDuel, duelVerdict, rivalKillsAt, sanitizeName, mulberry32, GAME_TAG,
    K: {
      W, H, HERO_HP, HERO_RADIUS, HERO_IFRAMES_MS, HERO_SPEED_HUMAN, HERO_SPEED_WOLF, HERO_KNOCKBACK,
      HERO_STILL_MAXSPEED, PULSE_FX_MS, TERROR_KNOCK,
      MOMENTUM_RISE_MS, MOMENTUM_DECAY_MS, MOMENTUM_MIN_SPEED,
      MAUL_REACH, MAUL_DMG, BITE_CD, MAUL_MIN_MUL, MAUL_KNOCK, KILL_HEAL,
      POUNCE_AT, POUNCE_RANGE, POUNCE_ARC, POUNCE_MS, POUNCE_SPEED, POUNCE_CD, POUNCE_SPEND, POUNCE_DMG_MUL,
      ALARM_RADIATE_WOLF, ALARM_RADIATE_MAN, MAN_SPRINT_SPEED, ALARM_RADIATE_REACH, ALARM_MUFFLE_MUL,
      ALARM_SPREAD_R, ALARM_SPREAD_RATE, ALARM_DECAY, ALARM_KILL_SPIKE_R, ALARM_ROUSE,
      PREY_FLEE_ALARM, PREY_FLEE_SPEED_MUL, PREY_COHESION,
      MOON_CYCLE_MS, MOON_START, FURY_RISE_MS, FURY_DRAIN_MS, FURY_PER_KILL,
      MOTE_DROP_CHANCE, MOTE_TTL_MS, MOTE_RADIUS, MOTE_FURY, HIT_FLASH_MS,
      FOE_HP, FOE_SPEED, FOE_RADIUS, FOE_CONTACT, FOE_ATTACK_CD,
      FOE_ATTACK_REACH, FOE_SEP, FOE_AGGRO, FOE_WANDER_SPEED, FOE_LEASH,
      FOE_PER_GREEN, CLEANUP_AGGRO_FRAC, RISE_MS, STEALTH_AGGRO_MUL,
      HOUND_HP_MUL, HOUND_SPEED_MUL, HOUND_CONTACT,
      KNIGHT_HP_MUL, KNIGHT_SPEED_MUL, KNIGHT_CONTACT,
      HUNTSMAN_HP_MUL, HUNTSMAN_SPEED_MUL, HUNTSMAN_RANGE, HUNTSMAN_STANDOFF, HUNTSMAN_SHOOT_CD,
      BOLT_AIM_MS, BOLT_SPEED, BOLT_DMG, BOLT_TTL_MS, BOLT_RADIUS,
      FRIAR_HP_MUL, FRIAR_SPEED_MUL, FRIAR_RANGE, FRIAR_STANDOFF, FRIAR_FURY_DRAIN,
      FRENZY_RANGE, FRENZY_DMG, MOONBLOOD_FURY,
      OBSTACLE_RADIUS, WALL_HALF, PATH_HALF, PATH_BOOST, MOONWELL_AURA, MIST_DRIFT,
      CAIRN_MARK_REACH, CAIRN_MARK_FURY, CAIRN_AURA, CAIRN_FURY_PER_SEC, CAIRN_DMG,
      CAIRN_PANIC_PER_SEC, CAIRN_SHOVE,
      CLEANSE_REACH, CLEANSE_MS, SCAR_RADIUS,
      PYRE_AURA, PYRE_DPS, WISP_AURA, WISP_DPS, MARSHFIRE_AURA, MARSHFIRE_DPS,
      BOG_AURA, BOG_SLOW, BRAMBLE_AURA, BRAMBLE_SLOW, GLADE_AURA,
      SPRING_AURA, SPRING_HEAL_DPS, SPRING_HEAL_CAP,
      GEYSER_CD, GEYSER_RADIUS, GEYSER_DMG, GALE_AURA, GALE_PUSH,
      WOLFSBANE_AURA, WOLFSBANE_DRAIN, HOARD_REACH, HOARD_FURY, WOODS_AURA,
      QUARRY_NIGHT_DL, QUARRY_FURY, QUARRY_HEAL, SCORE_QUARRY,
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
