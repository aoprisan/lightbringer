// THE LIGHT-BRINGER — a contemplative inversion game.
// You carry a stolen flame through a city taught that light burns.
// Kindling reveals geometry that was always there; light spreads on its own
// along anything that can carry it; the Keepers snuff, and what they snuff
// gets heavier. The carrier burns: each night your flame is smaller. You will
// not finish the city. The question is whether what you lit outlives you.
//
// Authored in TypeScript; tsc compiles this to app.js, which is what ships.

// ---------- Types ----------

type NodeKind = "dwelling" | "conduit" | "press" | "shrine" | "keeper";
type NodeState = "dark" | "lit" | "awakened" | "snuffed";
type Phase = "intro" | "night" | "dawn" | "end";
type Mode = "kindle" | "awaken" | "decoy";

type WeatherKind = "still" | "wind" | "rain";
// wx/wy is the unit vector the wind blows TOWARD (a "north wind" runs south).
interface Weather { kind: WeatherKind; wx: number; wy: number }

interface CityNode {
  id: number;
  x: number;  // anchor — fixed; edges/adjacency derive from this
  y: number;
  px: number; // patrol position — only Keepers drift away from their anchor
  py: number;
  kind: NodeKind;
  state: NodeState;
  brightness: number; // 0..1
  revealed: boolean;
  heat: number; // Keeper attention accrued here
  veil: number; // thickening dark left by snuffing
  decoy: number; // breaths a false light still burns here (0 = none); never saved
  nights: number; // dawns this soul has held as awakened; HEARTH_NIGHTS settles a hearth
  district: number;
}

interface Edge {
  a: number;
  b: number;
  conductivity: number;
}

interface City {
  nodes: CityNode[];
  edges: Edge[];
  adj: Map<number, number[]>;
}

interface GameState extends City {
  level: LevelDef; // which city this run walks — resolved from its id, never null
  night: number;
  maxFlame: number;
  flame: number;
  weather: Weather;
  mode: Mode;
  phase: Phase;
  tick: number;
  shownFrescoes: number[];
  pendingFresco: string | null;
  lastSnuffDistrict: number;
  veilThickened: boolean;
  lostSoul: boolean; // an awakened soul was snuffed since the last draw
  decoySpent: boolean; // a Keeper searched a false light since the last draw
  player?: Player; // the avatar, in action mode only — transient, never persisted
  playerHit?: boolean; // a Keeper caught the avatar since the last draw (action mode)
}

// The carrier as a body abroad in the streets — only in action mode. The avatar
// is never a node and never persisted; the turn-based shell never creates one,
// so every sim path guards on `g.player` and behaves exactly as before without it.
interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hurt: number; // remaining i-frame ms after a Keeper's touch (0 = vulnerable)
}

interface District {
  name: string;
  x: number;
  y: number;
}

// ---------- Tuning ----------

const W = 1000;
const H = 1400;
const NODE_COUNT = 124;
const MIN_DIST = 70;
const NEIGHBORS = 3;

const START_FLAME = 12;
const KINDLE_COST = 1;
const AWAKEN_COST = 3;
const DECOY_COST = 2;              // a false light to draw a Keeper off its post

const TICK_MS = 850;
const KEEPER_SNUFF_EVERY = 3;      // ticks between a Keeper's snuffings, once in reach
const KEEPER_RADIUS = 220;         // base sensing radius
const KEEPER_SPEED = 13;           // patrol drift per tick while hunting
const KEEPER_LEASH = 340;          // how far a Keeper strays from its post
const KEEPER_SNUFF_REACH = 80;     // a Keeper must close to this range to snuff
const AWAKEN_KINDLE_EVERY = 4;     // ticks between an awakened soul's own kindling
const DECOY_TICKS = 10;            // breaths a false light burns before it fades
const HEARTH_NIGHTS = 3;           // dawns an awakened soul must hold to settle into a hearth
const HEARTH_REFUND = 1;           // flame each hearth returns to the carrier at dawn
const MAX_KEEPERS = 12;            // cap on Veil reinforcements
const VEIL_REINFORCE_AT = 3.2;     // local veil weight that thickens into a new Keeper

const WIND_BOOST = 0.75;           // wind swings spread chance by ±this, by edge direction
const RAIN_SPREAD_DAMP = 0.55;     // rain slows the fire...
const RAIN_KEEPER_SLOW = 0.6;      // ...and the watch
const RAIN_SNUFF_DELAY = 2;        // extra ticks between snuffs in the rain
const PRESS_VEIL_BLOCK = 1.2;      // a street scarred past this refuses the press's word

const IDLE_CAP_TICKS = 600;        // most "while you were away" ticks we simulate

// ---------- Action mode ("The Lamplighter Run") ----------
// An optional real-time shell layered over the very same turn-based sim: you
// drive a flame avatar, the city breathes on a clock instead of per tap, and
// the Keepers hunt you rather than only the light. Everything below is inert
// unless action mode is on (build flag, or the `?action` query param). The sim
// functions gain avatar-aware branches that are all guarded on `g.player`, so
// the turn-based game and the headless test are untouched.
const ACTION_MODE = true;          // build default; ?action=0 turns it off at runtime
const ACTION_PREF_KEY = "lightbringer.mode.action"; // sticky choice, so mobile/PWA keep it
const ACTION_STEP_MS = 170;        // wall-clock ms per city breath when clocked (~TICK_MS/5)
const PLAYER_SPEED = 260;          // avatar travel, world units per second
const PLAYER_RADIUS = 14;          // avatar body, for draw and hit tests
const KINDLE_RADIUS = 120;         // auto-kindle reach around a stationary avatar
const KINDLE_COOLDOWN_MS = 260;    // minimum gap between auto-kindles (the "fire rate")
const MOVE_KINDLE_MAXSPEED = 40;   // avatar must be slower than this (units/s) to auto-kindle
const HIT_FLAME_COST = 1;          // flame lost when a Keeper catches the avatar
const HIT_IFRAMES_MS = 900;        // grace after a hit, no further damage
const KEEPER_PLAYER_LEASH = 900;   // a Keeper chasing the avatar ranges far past its post

const COND: Record<NodeKind, number> = {
  conduit: 0.5,   // oil, paper, rumor — carries light fast
  press: 0.66,    // a printing press: word made many
  dwelling: 0.18,
  shrine: 0.28,
  keeper: 0.0,
};

const SAVE_KEY = "lightbringer.save.v5";

// ---------- Districts ----------
// Five quarters, found by nearest fixed anchor so clusters look organic. Every
// city keeps these same five anchors (balanced map coverage); only the quarter
// NAMES change per city, for flavour. DISTRICTS is The Old City's set and the
// default a save falls back to.
const DISTRICTS: District[] = [
  { name: "The Lower Nave", x: 300, y: 230 },
  { name: "Ashfold", x: 720, y: 360 },
  { name: "The Glassworks", x: 250, y: 720 },
  { name: "Vesper Row", x: 760, y: 850 },
  { name: "The Drowned Quarter", x: 500, y: 1180 },
];

// Re-skin the five anchors with a city's own quarter names (same positions).
function quarters(...names: [string, string, string, string, string]): District[] {
  return DISTRICTS.map((d, i) => ({ name: names[i], x: d.x, y: d.y }));
}

function districtOf(x: number, y: number, districts: District[]): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < districts.length; i++) {
    const d = (districts[i].x - x) ** 2 + (districts[i].y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ---------- Cities (levels) ----------
// The one procedural map is now one of several hand-tuned CITIES the carrier may
// choose to walk into. A LevelDef is a pure bundle of generation + economy
// overrides: it changes how generateCity() seeds the map and how a night begins,
// but every rule (spread, Keepers, dawn, hearths, the carrier's burn) is
// unchanged. So each city is a different *puzzle in the same language* — denser
// or sparser, more conductive or more watched, windier or rain-drowned — with no
// new mechanic and no broken invariant. The Old City is the original generation,
// kept exactly; the rest lean the same dials in distinct directions.
interface LevelDef {
  id: string;
  name: string;        // the city's name (distinct from its five quarters)
  epigraph: string;    // a line shown beneath it on the choose-a-city card
  art?: string;        // optional establishing image (art/city-*.jpg); silent-fail
  nodeCount: number;   // how many places the city holds
  minDist: number;     // closest two places sit — larger means sparser/sprawling
  conduitFrac: number; // share of places that are conduits (fire runs along them)
  pressCount: number;  // printing presses — word made many
  shrineCount: number; // street shrines — each lights its whole quarter
  keeperCount: number; // Keepers seeded at dusk (the Veil may still breed more)
  keeperSpacing: number;// closest two seeded Keepers sit
  keeperRadius: number;// base sensing radius for this city's watch
  startFlame: number;  // the flame a night begins with
  sky: { wind: number; rain: number }; // weather temperament (rest is still air)
  districts: District[];
  unlockNight?: number; // furthest-night legacy needed to unlock (0/undef = open)
}

const LEVELS: LevelDef[] = [
  {
    id: "old-city",
    name: "The Old City",
    epigraph: "Where you first stole the flame. The watch is even, the streets remember nothing.",
    art: "art/city-old.jpg",
    nodeCount: NODE_COUNT, minDist: MIN_DIST,
    conduitFrac: 0.16, pressCount: 4, shrineCount: 5,
    keeperCount: 6, keeperSpacing: 360, keeperRadius: KEEPER_RADIUS,
    startFlame: START_FLAME,
    sky: { wind: 0.35, rain: 0.30 },
    districts: DISTRICTS,
  },
  {
    id: "ashfold",
    name: "Ashfold",
    epigraph: "They burned it once to teach it fear. It is dry tinder, and it remembers fire.",
    art: "art/city-ashfold.jpg",
    nodeCount: 130, minDist: 64,
    conduitFrac: 0.26, pressCount: 6, shrineCount: 3,
    keeperCount: 7, keeperSpacing: 320, keeperRadius: 240,
    startFlame: 14,
    sky: { wind: 0.62, rain: 0.05 },
    districts: quarters("The Cinder Yards", "Embergate", "The Tanneries", "Smokefell", "The Black Quay"),
  },
  {
    id: "drowned",
    name: "The Drowned Quarter",
    epigraph: "The water took the low streets. What light remains here, remains alone — and patient.",
    art: "art/city-drowned.jpg",
    nodeCount: 104, minDist: 86,
    conduitFrac: 0.10, pressCount: 2, shrineCount: 6,
    keeperCount: 4, keeperSpacing: 420, keeperRadius: 300,
    startFlame: 11,
    sky: { wind: 0.10, rain: 0.62 },
    districts: quarters("The Sunk Nave", "Tidewall", "The Weir", "Greylethe", "Mussel Row"),
  },
  {
    id: "glassworks",
    name: "The Glassworks",
    epigraph: "Everything here is bright and breaks. The watch is thick and quick. Be precise.",
    art: "art/city-glassworks.jpg",
    nodeCount: 134, minDist: 66,
    conduitFrac: 0.14, pressCount: 3, shrineCount: 8,
    keeperCount: 9, keeperSpacing: 270, keeperRadius: 170,
    startFlame: 10,
    sky: { wind: 0.30, rain: 0.20 },
    districts: quarters("The Kilns", "Prism Row", "The Annealing", "Cullet Yard", "The Lantern Houses"),
  },
  {
    id: "vesper",
    name: "Vesper Row",
    epigraph: "The watch is thickest where the faithful sleep. The fire will not run for you here — place every light by hand.",
    art: "art/city-vesper.jpg",
    nodeCount: 124, minDist: 70,
    conduitFrac: 0.08, pressCount: 3, shrineCount: 4,
    keeperCount: 11, keeperSpacing: 250, keeperRadius: 230,
    startFlame: 12,
    sky: { wind: 0.25, rain: 0.25 },
    districts: quarters("The Cloisters", "Matins", "The Long Watch", "Compline", "The Pale"),
    unlockNight: 4,
  },
];

function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

// ---------- Weather ----------
// Each night has a sky, rolled at dusk. Wind drives the fire before it and
// starves what stands against it; rain slows the flame — and the Keepers'
// patrols with it. Night 1 is always still: the baseline the others bend.

function rollWeather(night: number, level: LevelDef = LEVELS[0]): Weather {
  if (night <= 1) return { kind: "still", wx: 0, wy: 0 };
  const r = Math.random();
  const { wind, rain } = level.sky;
  if (r < wind) {
    const dirs: [number, number][] = [[0, 1], [0, -1], [-1, 0], [1, 0]];
    const [wx, wy] = dirs[Math.floor(Math.random() * dirs.length)];
    return { kind: "wind", wx, wy };
  }
  if (r < wind + rain) return { kind: "rain", wx: 0, wy: 0 };
  return { kind: "still", wx: 0, wy: 0 };
}

// Compass word for where the wind comes FROM (a "north wind" runs southward).
function windWord(w: Weather): string {
  if (w.wy > 0) return "north";
  if (w.wy < 0) return "south";
  return w.wx > 0 ? "west" : "east";
}

function weatherLabel(w: Weather): string {
  return w.kind === "still" ? "still air" : w.kind === "rain" ? "rain" : `${windWord(w)} wind`;
}

function weatherNotice(w: Weather): string {
  if (w.kind === "wind") return `A ${windWord(w)} wind tonight — the flame runs before it.`;
  if (w.kind === "rain") return "Rain tonight. The fire crawls beneath it — but so does the watch.";
  return "The air is still tonight.";
}

// Frescoes hidden under the whitewash — revealed as the city lights.
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
];

// A few of the most quotable frescoes have painted art (the rest reveal as text
// alone). Keyed by index into FRESCOES; see art-prompts/06*.txt.
const FRESCO_ART: Record<number, string> = {
  0: "art/fresco-sun.jpg",     // "Beneath the whitewash: a sun, and under it, our faces."
  3: "art/fresco-veil.jpg",    // "The Veil is not a wall. It is a habit."
  4: "art/fresco-press.jpg",   // "Here a press once ran…"
  5: "art/fresco-child.jpg",   // "Every Keeper was, once, a child…"
  10: "art/fresco-morning.jpg",// "The morning is not coming to judge you. It is only morning."
};

// ---------- City generation ----------

function generateCity(level: LevelDef): City {
  const nodes: CityNode[] = [];
  let guard = 0;
  while (nodes.length < level.nodeCount && guard++ < 20000) {
    const x = 60 + Math.random() * (W - 120);
    const y = 60 + Math.random() * (H - 120);
    if (nodes.every((n) => (n.x - x) ** 2 + (n.y - y) ** 2 > level.minDist ** 2)) {
      nodes.push(makeNode(nodes.length, x, y, "dwelling", level.districts));
    }
  }

  // Assign kinds: conduits (rumor/oil), a few presses, shrines, spread-out
  // Keepers — counts and spacing are the city's, so each map reads differently.
  const shuffled = [...nodes].sort(() => Math.random() - 0.5);
  const nConduit = Math.floor(nodes.length * level.conduitFrac);
  shuffled.slice(0, nConduit).forEach((n) => (n.kind = "conduit"));
  shuffled.slice(nConduit, nConduit + level.pressCount).forEach((n) => (n.kind = "press"));
  shuffled.slice(-level.shrineCount).forEach((n) => (n.kind = "shrine"));

  const keepers: CityNode[] = [];
  for (const n of shuffled) {
    if (n.kind !== "dwelling") continue;
    if (keepers.every((k) => (k.x - n.x) ** 2 + (k.y - n.y) ** 2 > level.keeperSpacing ** 2)) {
      n.kind = "keeper";
      keepers.push(n);
      if (keepers.length >= level.keeperCount) break;
    }
  }

  return finalizeCity(nodes);
}

function makeNode(id: number, x: number, y: number, kind: NodeKind, districts: District[]): CityNode {
  return {
    id, x, y, kind,
    px: x, py: y,        // patrol position; non-Keepers never leave home
    state: "dark",       // dark | lit | awakened | snuffed
    brightness: 0,       // 0..1
    revealed: false,
    heat: 0,             // Keeper attention accrued here
    veil: 0,             // thickening dark left by snuffing
    decoy: 0,            // breaths a false light still burns here (0 = none)
    nights: 0,           // dawns held as an awakened soul
    district: districtOf(x, y, districts),
  };
}

// Build edges (streets, conduits, lines of rumor) + adjacency from node geometry.
// Deterministic from positions/kinds, so we can rebuild it after loading a save.
function finalizeCity(nodes: CityNode[]): City {
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const near = nodes
      .filter((m) => m.id !== n.id)
      .sort((p, q) =>
        (p.x - n.x) ** 2 + (p.y - n.y) ** 2 - ((q.x - n.x) ** 2 + (q.y - n.y) ** 2))
      .slice(0, NEIGHBORS);
    for (const m of near) {
      const key = n.id < m.id ? `${n.id}-${m.id}` : `${m.id}-${n.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cond = Math.min(COND[n.kind] + COND[m.kind], 0.66) + 0.08;
      edges.push({ a: n.id, b: m.id, conductivity: cond });
    }
  }
  const adj = new Map<number, number[]>();
  for (const e of edges) {
    if (!adj.has(e.a)) adj.set(e.a, []);
    if (!adj.has(e.b)) adj.set(e.b, []);
    adj.get(e.a)!.push(e.b);
    adj.get(e.b)!.push(e.a);
  }
  return { nodes, edges, adj };
}

// ---------- Simulation ----------

function edgeBetween(g: GameState, a: number, b: number): Edge | undefined {
  return g.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}

function reveal(g: GameState, id: number, depth: number): void {
  const n = g.nodes[id];
  if (!n.revealed) {
    n.revealed = true;
    maybeFresco(g, n);
  }
  if (depth <= 0) return;
  for (const m of g.adj.get(id) ?? []) reveal(g, m, depth - 1);
}

// Lighting a node may uncover a fresco the Keepers painted over.
function maybeFresco(g: GameState, n: CityNode): void {
  if (g.shownFrescoes.length >= FRESCOES.length) return;
  // presses and shrines always carry text; dwellings rarely.
  const chance = n.kind === "press" || n.kind === "shrine" ? 1 : 0.06;
  if (Math.random() > chance) return;
  const remaining = FRESCOES
    .map((_, i) => i)
    .filter((i) => !g.shownFrescoes.includes(i));
  if (!remaining.length) return;
  const idx = remaining[Math.floor(Math.random() * remaining.length)];
  g.shownFrescoes.push(idx);
  g.pendingFresco = FRESCOES[idx];
}

function kindle(g: GameState, id: number): boolean {
  const n = g.nodes[id];
  if (n.state !== "dark" || n.kind === "keeper") return false;
  n.state = "lit";
  n.brightness = 1;
  n.decoy = 0; // a false light that catches for real is no longer a ruse
  reveal(g, id, n.kind === "press" ? 3 : 2);
  if (n.kind === "shrine") revealDistrict(g, n.district); // a shrine lights its quarter
  if (n.kind === "press") runPress(g, n);                 // word made many — at once
  return true;
}

// A lit press is word made many: its whole carrier line catches in one breath.
// The cascade runs only along conduits and presses (a chained press fires in
// turn, through kindle's own hook); ground scarred past PRESS_VEIL_BLOCK
// refuses the word. Terminates because kindle only ever acts on dark nodes.
function runPress(g: GameState, press: CityNode): void {
  const queue = [press.id];
  while (queue.length) {
    const id = queue.pop()!;
    for (const mId of g.adj.get(id) ?? []) {
      const m = g.nodes[mId];
      if (m.state !== "dark") continue;
      if (m.kind !== "conduit" && m.kind !== "press") continue;
      if (m.veil >= PRESS_VEIL_BLOCK) continue;
      kindle(g, mId);
      queue.push(mId);
    }
  }
}

function revealDistrict(g: GameState, d: number): void {
  for (const n of g.nodes) if (n.district === d) n.revealed = true;
}

function awaken(g: GameState, id: number): boolean {
  const n = g.nodes[id];
  if (n.kind !== "dwelling") return false;
  if (n.state !== "dark" && n.state !== "lit") return false;
  n.state = "awakened";
  n.brightness = 1;
  n.decoy = 0;
  reveal(g, id, 2);
  return true;
}

// Lay a false light on dark, empty ground. It carries nothing and spreads
// nothing — but a Keeper breaks for it before any true flame (see stepKeepers),
// walks out to search the empty house, and finds only the spent ruse. Fades on
// its own after DECOY_TICKS breaths. Deliberately transient: never persisted.
function placeDecoy(g: GameState, id: number): boolean {
  const n = g.nodes[id];
  if (n.kind === "keeper") return false;
  if (n.state !== "dark" || n.decoy > 0) return false;
  n.decoy = DECOY_TICKS;
  n.revealed = true; // the carrier sees the lure they laid
  return true;
}

// Each breath a false light burns lower; at zero it fades back into the dark.
function stepDecoys(g: GameState): void {
  for (const n of g.nodes) if (n.decoy > 0) n.decoy -= 1;
}

function stepSpread(g: GameState): void {
  const toLight: number[] = [];
  for (const n of g.nodes) {
    if (n.state !== "lit" && n.state !== "awakened") continue;
    for (const mId of g.adj.get(n.id) ?? []) {
      const m = g.nodes[mId];
      if (m.state !== "dark" || m.kind === "keeper") continue;
      const e = edgeBetween(g, n.id, mId);
      if (!e) continue;
      const veilDamp = 1 - Math.min(0.6, m.veil * 0.25); // heavy dark resists relight
      // The sky shapes the night: wind favours edges that run with it and
      // starves those against it; rain damps every edge alike.
      let sky = 1;
      if (g.weather.kind === "rain") {
        sky = RAIN_SPREAD_DAMP;
      } else if (g.weather.kind === "wind") {
        const dx = m.x - n.x, dy = m.y - n.y;
        const len = Math.hypot(dx, dy) || 1;
        sky = 1 + WIND_BOOST * ((dx * g.weather.wx + dy * g.weather.wy) / len);
      }
      const chance =
        e.conductivity * n.brightness * (n.state === "awakened" ? 1.25 : 1) * veilDamp * sky;
      if (Math.random() < chance * 0.45) toLight.push(mId);
    }
    if (n.state === "lit") n.brightness = Math.max(0.35, n.brightness - 0.03);
  }
  for (const id of toLight) kindle(g, id);
}

// Awakened souls are autonomous light sources: while you are away they kindle
// on their own. This is the idle layer — and the light-bringer's whole victory.
function stepAwakened(g: GameState): void {
  if (g.tick % AWAKEN_KINDLE_EVERY !== 0) return;
  for (const n of g.nodes) {
    if (n.state !== "awakened") continue;
    let best: number | null = null;
    let bestScore = -Infinity;
    for (const mId of g.adj.get(n.id) ?? []) {
      const m = g.nodes[mId];
      if (m.state !== "dark" || m.kind === "keeper") continue;
      const e = edgeBetween(g, n.id, mId);
      if (!e) continue;
      const score = e.conductivity - m.veil * 0.3; // favour easy, un-thickened ground
      if (score > bestScore) { bestScore = score; best = mId; }
    }
    if (best != null) kindle(g, best);
  }
}

// A Keeper's sight widens with the snuffed dark around it — the Veil patrols
// its own scars. Sensing stays anchored to the POST (x/y), never the patrol
// position: ground outside every ring is never hunted, so placement remains
// the strategy. Kept as a pure helper so render() can draw the very ring the
// simulation enforces; the two must never drift apart.
function keeperRadius(g: GameState, k: CityNode): number {
  const base = g.level.keeperRadius; // each city sets the watch's base reach
  let localVeil = 0;
  for (const n of g.nodes) {
    const d2 = (n.x - k.x) ** 2 + (n.y - k.y) ** 2;
    if (d2 <= (base * 1.4) ** 2) localVeil += n.veil;
  }
  return base * (1 + Math.min(0.6, localVeil * 0.05));
}

// Keepers patrol. A Keeper's post sees the worst light within its ring — an
// awakened soul outranks any lit ground, however bright; within a tier the
// brightest draws the eye — and the sentinel walks out to it, snuffing only
// what its hand actually reaches. With nothing to hunt it drifts back to its
// post, never straying past its leash. Rain slows both the pursuit and the
// snuffing hand.
function stepKeepers(g: GameState): void {
  const rain = g.weather.kind === "rain";
  const speed = KEEPER_SPEED * (rain ? RAIN_KEEPER_SLOW : 1);
  const snuffEvery = KEEPER_SNUFF_EVERY + (rain ? RAIN_SNUFF_DELAY : 0);
  for (const k of g.nodes) {
    if (k.kind !== "keeper") continue;
    const radius2 = keeperRadius(g, k) ** 2;
    let target: CityNode | null = null;
    // A false light the carrier has laid draws the eye before any true flame:
    // a Keeper breaks for the nearest decoy in its sight, past even a waking
    // soul. With none, it falls back to the worst real light (souls, then the
    // brightest ground).
    let decoyD2 = Infinity;
    for (const n of g.nodes) {
      if (n.decoy <= 0 || n.kind === "keeper") continue;
      const d2 = (n.x - k.x) ** 2 + (n.y - k.y) ** 2;
      if (d2 <= radius2 && d2 < decoyD2) { decoyD2 = d2; target = n; }
    }
    // In action mode the carrier walks the streets in the flesh. A Keeper with
    // no false light to chase breaks for the avatar before any standing flame —
    // and commits, ranging far past its usual leash to run the intruder down.
    let huntingPlayer = false;
    if (!target && g.player &&
        (g.player.x - k.x) ** 2 + (g.player.y - k.y) ** 2 <= radius2) {
      huntingPlayer = true;
    }
    if (!target && !huntingPlayer) {
      let targetAwake = false;
      for (const n of g.nodes) {
        if (n.state !== "lit" && n.state !== "awakened") continue;
        if ((n.x - k.x) ** 2 + (n.y - k.y) ** 2 > radius2) continue;
        const awake = n.state === "awakened";
        if (!target ||
            (awake && !targetAwake) ||
            (awake === targetAwake && n.brightness > target.brightness)) {
          target = n;
          targetAwake = awake;
        }
      }
    }
    if (target || huntingPlayer) {
      const tx = huntingPlayer ? g.player!.x : target!.x;
      const ty = huntingPlayer ? g.player!.y : target!.y;
      const leash = huntingPlayer ? KEEPER_PLAYER_LEASH : KEEPER_LEASH;
      const dx = tx - k.px, dy = ty - k.py;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        const step = Math.min(speed, d);
        k.px += (dx / d) * step;
        k.py += (dy / d) * step;
      }
      // The leash: a Keeper never abandons its post entirely — but it strays far
      // when the quarry is the carrier itself.
      const ax = k.px - k.x, ay = k.py - k.y;
      const ad = Math.hypot(ax, ay);
      if (ad > leash) {
        k.px = k.x + (ax / ad) * leash;
        k.py = k.y + (ay / ad) * leash;
      }
    } else {
      const dx = k.x - k.px, dy = k.y - k.py;
      const d = Math.hypot(dx, dy);
      if (d > 1) {
        const step = Math.min(speed * 0.5, d);
        k.px += (dx / d) * step;
        k.py += (dy / d) * step;
      }
    }
    // On a snuff tick, the hand falls on the worst light within arm's reach —
    // not only the chosen quarry. A false light within reach is searched first:
    // the empty house is found out, the ruse spent, and no scar is left behind —
    // that wasted reach is the breaths the carrier bought.
    if (g.tick % snuffEvery === 0) {
      let decoyPrey: CityNode | null = null;
      let decoyPreyD2 = Infinity;
      for (const n of g.nodes) {
        if (n.decoy <= 0 || n.kind === "keeper") continue;
        const d2 = (n.x - k.px) ** 2 + (n.y - k.py) ** 2;
        if (d2 <= KEEPER_SNUFF_REACH ** 2 && d2 < decoyPreyD2) { decoyPreyD2 = d2; decoyPrey = n; }
      }
      if (decoyPrey) { decoyPrey.decoy = 0; g.decoySpent = true; continue; }
      // The hand falls on the carrier if it can reach: flame is spent (flame is
      // the avatar's life in action mode), but the avatar is no node, so no scar
      // is left. A brief grace (i-frames) spares it repeated blows, and the blow
      // shoves it clear of the Keeper.
      if (g.player && g.player.hurt <= 0 &&
          (g.player.x - k.px) ** 2 + (g.player.y - k.py) ** 2 <= KEEPER_SNUFF_REACH ** 2) {
        g.flame = Math.max(0, g.flame - HIT_FLAME_COST);
        g.player.hurt = HIT_IFRAMES_MS;
        g.playerHit = true;
        const pd = Math.hypot(g.player.x - k.px, g.player.y - k.py) || 1;
        g.player.x += ((g.player.x - k.px) / pd) * 24;
        g.player.y += ((g.player.y - k.py) / pd) * 24;
        // Keep the shove inside the walls — a Keeper pinning the carrier to an
        // edge must not push it out of bounds (the RAF clamp only runs later).
        g.player.x = Math.max(PLAYER_RADIUS, Math.min(W - PLAYER_RADIUS, g.player.x));
        g.player.y = Math.max(PLAYER_RADIUS, Math.min(H - PLAYER_RADIUS, g.player.y));
        continue; // this Keeper's hand is spent on the carrier this tick
      }
      let prey: CityNode | null = null;
      let preyAwake = false;
      for (const n of g.nodes) {
        if (n.state !== "lit" && n.state !== "awakened") continue;
        if ((n.x - k.px) ** 2 + (n.y - k.py) ** 2 > KEEPER_SNUFF_REACH ** 2) continue;
        const awake = n.state === "awakened";
        if (!prey ||
            (awake && !preyAwake) ||
            (awake === preyAwake && n.brightness > prey.brightness)) {
          prey = n;
          preyAwake = awake;
        }
      }
      if (prey) snuff(g, prey);
    }
  }
  reinforceVeil(g);
}

function snuff(g: GameState, n: CityNode): void {
  const wasAwakened = n.state === "awakened";
  n.state = "snuffed";
  n.brightness = 0;
  n.revealed = true;
  n.heat = 0;
  n.nights = 0; // a snuffed soul's hearth-age dies with it
  // Snuffed ground does not return to neutral dark — it thickens. A martyred
  // soul scars hardest, and that scar is what eventually breeds a new Keeper.
  n.veil += wasAwakened ? 2 : 1.2;
  for (const mId of g.adj.get(n.id) ?? []) g.nodes[mId].veil += 0.5;
  g.lastSnuffDistrict = n.district;
  if (wasAwakened) g.lostSoul = true;
}

// Heavily-snuffed ground thickens into a new Keeper post: more patrolled.
function reinforceVeil(g: GameState): void {
  if (g.nodes.filter((n) => n.kind === "keeper").length >= MAX_KEEPERS) return;
  let worst: CityNode | null = null;
  for (const n of g.nodes) {
    if (n.state !== "snuffed") continue;
    if (n.veil < VEIL_REINFORCE_AT) continue;
    if (g.nodes.some((k) => k.kind === "keeper" &&
        (k.x - n.x) ** 2 + (k.y - n.y) ** 2 < 240 ** 2)) continue;
    if (!worst || n.veil > worst.veil) worst = n;
  }
  if (!worst) return;
  // The thickest scar becomes a Keeper; geometry it carried goes inert.
  worst.kind = "keeper";
  worst.state = "dark";
  worst.veil = 0;
  worst.revealed = true;
  worst.px = worst.x;
  worst.py = worst.y;
  g.veilThickened = true;
}

// A hearth is an awakened soul that has held through enough dawns to settle —
// a home that keeps the flame. It behaves as any awakened soul for spread,
// keepers, and dawn; it merely also returns flame to the carrier each morning.
function isHearth(n: CityNode): boolean {
  return n.state === "awakened" && n.nights >= HEARTH_NIGHTS;
}

interface LitStats { lit: number; total: number; awakened: number; hearths: number; }

function litStats(g: GameState): LitStats {
  let lit = 0, awakened = 0, hearths = 0, total = 0;
  for (const n of g.nodes) {
    if (n.kind === "keeper") continue;
    total++;
    if (n.state === "lit" || n.state === "awakened") lit++;
    if (n.state === "awakened") awakened++;
    if (isHearth(n)) hearths++;
  }
  return { lit, total, awakened, hearths };
}

interface DistrictStat { name: string; lit: number; total: number; }

function districtStats(g: GameState): DistrictStat[] {
  const out: DistrictStat[] = g.level.districts.map((d) => ({ name: d.name, lit: 0, total: 0 }));
  for (const n of g.nodes) {
    if (n.kind === "keeper") continue;
    out[n.district].total++;
    if (n.state === "lit" || n.state === "awakened") out[n.district].lit++;
  }
  return out;
}

// At dawn only light connected to an awakened soul survives; the rest fades.
function applyDawn(g: GameState): { faded: number } {
  const keep = new Set<number>();
  const queue = g.nodes.filter((n) => n.state === "awakened").map((n) => n.id);
  queue.forEach((id) => keep.add(id));
  while (queue.length) {
    const id = queue.pop()!;
    for (const m of g.adj.get(id) ?? []) {
      const node = g.nodes[m];
      if ((node.state === "lit" || node.state === "awakened") && !keep.has(m)) {
        keep.add(m);
        queue.push(m);
      }
    }
  }
  let faded = 0;
  for (const n of g.nodes) {
    if (n.kind === "keeper") { n.px = n.x; n.py = n.y; } // the watch returns to its posts
    if (n.state === "lit" && !keep.has(n.id)) {
      n.state = "dark"; n.brightness = 0; faded++;
    } else if (n.state === "lit") {
      n.brightness = 0.8;
    }
    // Awakened souls always survive the dawn (they seed the flood-fill); each
    // they hold through ages them one night nearer to becoming a hearth.
    if (n.state === "awakened") n.nights += 1;
    n.heat = 0;
  }
  return { faded };
}

// ---------- Persistence ----------

interface SaveData {
  v: number;
  level: string; // which city this run walks (LevelDef id)
  night: number;
  maxFlame: number;
  flame: number;
  tick: number;
  phase: Phase;
  shownFrescoes: number[];
  savedAt: number;
  weather: [WeatherKind, number, number];
  nodes: [number, number, NodeKind, NodeState, number, number, number, number, number, number, number][];
}

function saveGame(g: GameState): void {
  try {
    const data: SaveData = {
      v: 5,
      level: g.level.id,
      night: g.night, maxFlame: g.maxFlame, flame: g.flame,
      tick: g.tick, phase: g.phase,
      shownFrescoes: g.shownFrescoes,
      savedAt: Date.now(),
      weather: [g.weather.kind, g.weather.wx, g.weather.wy],
      nodes: g.nodes.map((n) => [
        n.x | 0, n.y | 0, n.kind, n.state,
        Math.round(n.brightness * 100), n.revealed ? 1 : 0,
        n.heat, Math.round(n.veil * 10),
        n.px | 0, n.py | 0, n.nights,
      ]),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (_) { /* storage may be unavailable; play on */ }
}

function loadGame(): { g: GameState; savedAt: number } | null {
  let data: SaveData;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    data = JSON.parse(raw) as SaveData;
  } catch (_) { return null; }
  if (!data || data.v !== 5 || !Array.isArray(data.nodes)) return null;

  // Resolve the city this run walked; an unknown id falls back to The Old City,
  // whose quarters/economy then drive the rebuild.
  const level = levelById(data.level) ?? LEVELS[0];
  const nodes = data.nodes.map((r, id) => {
    const n = makeNode(id, r[0], r[1], r[2], level.districts);
    n.state = r[3];
    n.brightness = r[4] / 100;
    n.revealed = !!r[5];
    n.heat = r[6];
    n.veil = r[7] / 10;
    n.px = typeof r[8] === "number" ? r[8] : n.x;
    n.py = typeof r[9] === "number" ? r[9] : n.y;
    n.nights = typeof r[10] === "number" ? r[10] : 0;
    return n;
  });
  const { edges, adj } = finalizeCity(nodes);
  const w = data.weather;
  const g: GameState = {
    nodes, edges, adj, level,
    night: data.night, maxFlame: data.maxFlame, flame: data.flame,
    weather: Array.isArray(w) && (w[0] === "still" || w[0] === "wind" || w[0] === "rain")
      ? { kind: w[0], wx: w[1] || 0, wy: w[2] || 0 }
      : { kind: "still", wx: 0, wy: 0 },
    mode: "kindle", phase: data.phase === "end" ? "end" : "night",
    tick: data.tick || 0,
    shownFrescoes: Array.isArray(data.shownFrescoes) ? data.shownFrescoes : [],
    pendingFresco: null, lastSnuffDistrict: -1, veilThickened: false,
    lostSoul: false, decoySpent: false,
  };
  return { g, savedAt: data.savedAt || Date.now() };
}

function freshGame(level: LevelDef = LEVELS[0]): GameState {
  const { nodes, edges, adj } = generateCity(level);
  const g: GameState = {
    nodes, edges, adj, level,
    night: 1, maxFlame: level.startFlame, flame: level.startFlame,
    weather: rollWeather(1, level),
    mode: "kindle", phase: "night", tick: 0,
    shownFrescoes: [], pendingFresco: null,
    lastSnuffDistrict: -1, veilThickened: false, lostSoul: false,
    decoySpent: false,
  };
  for (const n of g.nodes) if (n.kind === "shrine") reveal(g, n.id, 1);
  return g;
}

// ---------- Legacy: a record across runs ----------
// A lifetime tally kept in its OWN localStorage key, apart from the save — so it
// survives "Begin again", carries between the classic and Lamplighter shells,
// and never forces a save-version bump. It records the carrier's deepest runs:
// the furthest night reached, the brightest morning held, and the most hearths
// settled. Read on the intro to give a returning carrier something to outdo, and
// folded in exactly once — when a run ends.
const LEGACY_KEY = "lightbringer.legacy.v1";

interface Legacy {
  runs: number;        // runs carried to their end
  bestNight: number;   // furthest night reached
  bestLit: number;     // most lights carried into a morning
  bestPct: number;     // brightest morning, as a percent of the city
  bestHearths: number; // most hearths settled in a single run
}

function emptyLegacy(): Legacy {
  return { runs: 0, bestNight: 0, bestLit: 0, bestPct: 0, bestHearths: 0 };
}

function loadLegacy(): Legacy {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const r = JSON.parse(raw) as Partial<Legacy>;
      return {
        runs: r.runs || 0,
        bestNight: r.bestNight || 0,
        bestLit: r.bestLit || 0,
        bestPct: r.bestPct || 0,
        bestHearths: r.bestHearths || 0,
      };
    }
  } catch (_) { /* storage may be unavailable; the record is best-effort */ }
  return emptyLegacy();
}

// Which lifetime bests a just-ended run newly bettered, so the end screen can
// mark them. (lit and pct move together, but a smaller, denser city can beat the
// percent without the count — track both.)
interface LegacyBeat { night: boolean; lit: boolean; pct: boolean; hearths: boolean; }

// Fold a finished run into the lifetime record and persist it. Returns the saved
// legacy (already including this run) and the bests this run set.
function recordRun(g: GameState): { legacy: Legacy; beat: LegacyBeat } {
  const s = litStats(g);
  const pct = s.total ? Math.round((s.lit / s.total) * 100) : 0;
  const prev = loadLegacy();
  const beat: LegacyBeat = {
    night: g.night > prev.bestNight,
    lit: s.lit > prev.bestLit,
    pct: pct > prev.bestPct,
    hearths: s.hearths > prev.bestHearths,
  };
  const legacy: Legacy = {
    runs: prev.runs + 1,
    bestNight: Math.max(prev.bestNight, g.night),
    bestLit: Math.max(prev.bestLit, s.lit),
    bestPct: Math.max(prev.bestPct, pct),
    bestHearths: Math.max(prev.bestHearths, s.hearths),
  };
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy)); } catch (_) { /* best-effort */ }
  return { legacy, beat };
}

// The legacy block for the overlays (pure string, no DOM). With nothing recorded
// yet it stays silent. `beat` (passed on an end screen) marks the fresh bests.
function legacyHtml(l: Legacy, beat?: LegacyBeat): string {
  if (l.runs <= 0) return "";
  const mark = (on?: boolean) => (on ? ` <span class="legacy-new">new best</span>` : "");
  const runs = `${l.runs} ${l.runs === 1 ? "run" : "runs"}`;
  return `<div class="legacy"><div class="legacy-head">Carried across ${runs}</div><dl>` +
    `<div><dt>Furthest night</dt><dd>${l.bestNight}${mark(beat?.night)}</dd></div>` +
    `<div><dt>Brightest morning</dt><dd>${l.bestPct}% · ${l.bestLit} lights${mark(beat && (beat.pct || beat.lit))}</dd></div>` +
    `<div><dt>Most hearths kept</dt><dd>${l.bestHearths}${mark(beat?.hearths)}</dd></div>` +
    `</dl></div>`;
}

// One breath of the city: light spreads a step, awakened souls kindle, the
// Keepers advance and snuff. This is the single unit of simulation time —
// the turn-based shell runs exactly one per player action (or deliberate Wait),
// and the idle catch-up loops it for "while you were away".
function stepCity(g: GameState): void {
  g.tick += 1;
  stepSpread(g);
  stepAwakened(g);
  stepKeepers(g);
  stepDecoys(g);
}

// Run the city forward unattended (used for "while you were away").
function simulateTicks(g: GameState, count: number): void {
  for (let i = 0; i < count; i++) stepCity(g);
}

// ---------- Rendering (SVG) ----------

const svgNS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// Touch devices skip the big gaussian bloom — it is the one filter mobile
// GPUs choke on at full-screen redraw rates; the tight glow stays.
const LOW_FX = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

// Painted sprites (see ART_PLAN.md) are strictly optional: every art/*.png
// that exists is used, and anything missing keeps its vector primitive — the
// game is playable with zero, some, or all of the set. Sprites are generated
// on solid night (#0B0E1A), so each <image> is drawn through the spriteFade
// mask, which melts the square edge into the dark.
const SPRITE_NAMES = [
  "ground", "dwelling-dark", "dwelling-lit", "dwelling-awakened",
  "dwelling-snuffed", "conduit", "press", "shrine",
  "keeper-node", "keeper-patrol", "player-lantern", "veil-scar", "flame-spark",
] as const;
const sprites = new Set<string>();

// Probe each file once at startup; each arrival notifies (the shell repaints).
function loadSprites(onChange: () => void): void {
  if (typeof Image === "undefined") return; // headless test harness
  for (const name of SPRITE_NAMES) {
    const img = new Image();
    img.onload = () => { sprites.add(name); onChange(); };
    img.src = `art/${name}.png`;
  }
}

function spriteImage(
  name: string, x: number, y: number, size: number, opacity: number,
): SVGImageElement {
  return el("image", {
    href: `art/${name}.png`,
    x: x - size / 2, y: y - size / 2, width: size, height: size,
    opacity, mask: "url(#spriteFade)",
  });
}

// Built once: the filter/gradient defs and the camera group every frame
// renders into. The camera transform lives on the returned group, so pan and
// zoom survive each repaint untouched.
function scaffold(svg: SVGSVGElement): SVGGElement {
  svg.innerHTML = "";

  // Reusable filters and radial palettes. Two glows (a tight core flare and a
  // soft bloom) plus gradients for warm light, cold Keeper auras, and inky veil.
  const defs = el("defs", {});
  defs.innerHTML = `
    <filter id="glow" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="3.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="bloom" x="-200%" y="-200%" width="500%" height="500%">
      <feGaussianBlur stdDeviation="11"/>
    </filter>
    <radialGradient id="halo">
      <stop offset="0%" stop-color="#ffe9b0" stop-opacity="0.85"/>
      <stop offset="32%" stop-color="#e8b34b" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#e8b34b" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="haloAwake">
      <stop offset="0%" stop-color="#fff3d2" stop-opacity="1"/>
      <stop offset="28%" stop-color="#ffd87a" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#ffd87a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cold">
      <stop offset="0%" stop-color="#9fc4e8" stop-opacity="0.16"/>
      <stop offset="55%" stop-color="#6f8fc0" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="#6f8fc0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="veil">
      <stop offset="0%" stop-color="#01020a" stop-opacity="0.95"/>
      <stop offset="55%" stop-color="#05060d" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#05060d" stop-opacity="0"/>
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

// Repaint the city into the camera layer. Pure read of `g`; the layer's
// transform (pan/zoom) is owned by the shell and untouched here.
function render(g: GameState, layer: SVGGElement, dawnMode?: boolean): void {
  layer.innerHTML = "";

  // Painted cobblestone ground, when its sprite exists — beneath every mark.
  // Dawn keeps the bare pale field; the texture is night art.
  if (!dawnMode && sprites.has("ground")) {
    layer.appendChild(el("rect", {
      x: 0, y: 0, width: W, height: H, fill: "url(#groundPat)", opacity: 0.55,
    }));
  }

  // Veil blots first — the thickening dark sits beneath everything, an ink
  // stain that feathers out into the night rather than a hard disc.
  for (const n of g.nodes) {
    if (n.veil > 0.1 && n.kind !== "keeper") {
      const r = 18 + Math.min(34, n.veil * 9);
      const op = Math.min(0.9, 0.4 + n.veil * 0.14);
      if (!dawnMode && sprites.has("veil-scar")) {
        layer.appendChild(spriteImage("veil-scar", n.x, n.y, r * 2.6, op));
      } else {
        layer.appendChild(el("circle", { cx: n.x, cy: n.y, r, fill: "url(#veil)", opacity: op }));
      }
    }
  }

  // Keeper reach — for every Keeper the light has uncovered, draw the patrol
  // ring it actually snuffs within, so its threat is something you place
  // around rather than a surprise. A cold aura fills the disc and a dashed
  // rim marks the edge; both swell as nearby veil thickens (keeperRadius is the
  // same one stepKeepers enforces).
  if (!dawnMode) {
    for (const k of g.nodes) {
      if (k.kind !== "keeper" || !k.revealed) continue;
      // The ring is drawn around the POST — the ground a Keeper's sight
      // covers — while the sentinel itself roams within it.
      const rad = keeperRadius(g, k);
      layer.appendChild(el("circle", { cx: k.x, cy: k.y, r: rad, fill: "url(#cold)" }));
      layer.appendChild(el("circle", {
        cx: k.x, cy: k.y, r: rad, fill: "none", stroke: "#9fc4e8",
        "stroke-opacity": 0.22, "stroke-width": 1, "stroke-dasharray": "2 9",
      }));
    }
  }

  // Edges. Lit streets carry a warm thread (with a soft underglow); revealed
  // conduits and presses show as dashed lines of rumour; the rest stay faint.
  for (const e of g.edges) {
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    if (a.kind === "keeper" || b.kind === "keeper") continue; // Keepers float free
    const litEdge =
      (a.state === "lit" || a.state === "awakened") &&
      (b.state === "lit" || b.state === "awakened");
    const visible = a.revealed && b.revealed;
    const carrier = a.kind === "conduit" || a.kind === "press" ||
      b.kind === "conduit" || b.kind === "press";
    if (litEdge && !dawnMode && !LOW_FX) {
      layer.appendChild(el("line", {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: "#ffcf6e", "stroke-opacity": 0.28, "stroke-width": 5,
        "stroke-linecap": "round", filter: "url(#bloom)",
      }));
    }
    const line = el("line", {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: litEdge ? "#e8b34b" : dawnMode ? "#d8cfe0" : carrier ? "#3a4068" : "#242a44",
      "stroke-opacity": litEdge ? 0.78 : visible ? (dawnMode ? 0.25 : carrier ? 0.45 : 0.4) : 0.1,
      "stroke-width": litEdge ? 1.8 : 1,
    });
    if (carrier && visible && !litEdge && !dawnMode) line.setAttribute("stroke-dasharray", "1 6");
    layer.appendChild(line);
  }

  // Nodes. (Taps are handled by the shell's camera layer — nearest-node
  // hit-testing — so the groups carry no listeners of their own.)
  for (const n of g.nodes) {
    const grp = el("g", {});
    const isLit = n.state === "lit" || n.state === "awakened";
    const awake = n.state === "awakened";

    if (isLit) {
      grp.appendChild(el("circle", {
        cx: n.x, cy: n.y,
        r: (awake ? 56 : 44) * n.brightness + (awake ? 16 : 12),
        fill: awake ? "url(#haloAwake)" : "url(#halo)",
      }));
    }

    if (n.kind === "keeper") {
      if (!dawnMode && sprites.has("keeper-patrol")) {
        // The post stands at (x,y); the robed sentinel roams at (px,py).
        if (n.revealed && sprites.has("keeper-node")) {
          grp.appendChild(spriteImage("keeper-node", n.x, n.y, 66, 0.9));
        }
        grp.appendChild(spriteImage("keeper-patrol", n.px, n.py, 42, n.revealed ? 1 : 0.12));
      } else {
        // A watchful sentinel: a cold diamond with a dark vertical slit for an
        // eye, drawn at its patrol position — it moves, and you see it move.
        const r = 9;
        const op = n.revealed ? 0.95 : 0.1;
        grp.appendChild(el("rect", {
          x: n.px - r, y: n.py - r, width: r * 2, height: r * 2, rx: 1.5,
          fill: "#9fc4e8", opacity: op, transform: `rotate(45 ${n.px} ${n.py})`,
        }));
        if (n.revealed) {
          grp.appendChild(el("rect", {
            x: n.px - 1.4, y: n.py - 4.5, width: 2.8, height: 9, rx: 1.4,
            fill: "#0b0f1c", opacity: 0.85,
          }));
        }
      }
    } else if (n.state === "snuffed") {
      if (!dawnMode && n.kind === "dwelling" && sprites.has("dwelling-snuffed")) {
        grp.appendChild(spriteImage("dwelling-snuffed", n.x, n.y, 54, 0.95));
      } else {
        // Snuffed ground: a cold-rimmed husk over its own veil stain.
        grp.appendChild(el("circle", {
          cx: n.x, cy: n.y, r: 10, fill: "#0a0c16",
          stroke: "#46527a", "stroke-width": 1.4, opacity: 0.95,
        }));
        grp.appendChild(el("circle", { cx: n.x, cy: n.y, r: 2.4, fill: "#2a3354", opacity: 0.9 }));
      }
    } else {
      // Dwellings swap sprites by state; the other kinds have one face each,
      // with a flame-spark laid over them when they burn.
      const spriteName = n.kind === "dwelling"
        ? (awake ? "dwelling-awakened" : isLit ? "dwelling-lit" : "dwelling-dark")
        : n.kind;
      if (!dawnMode && sprites.has(spriteName)) {
        const size = n.kind === "press" ? 64 : n.kind === "shrine" ? 52 : n.kind === "conduit" ? 50 : 54;
        const op = isLit ? 1 : n.revealed ? 0.88 : n.kind === "shrine" ? 0.3 : 0.16;
        grp.appendChild(spriteImage(spriteName, n.x, n.y, size, op));
        if (isLit && n.kind !== "dwelling" && sprites.has("flame-spark")) {
          grp.appendChild(spriteImage("flame-spark", n.x, n.y - 6, 24, 1));
        }
      } else {
        let fill = dawnMode ? "#cfc6dc" : "#3a4060";
        let r = 7;
        let opacity = n.revealed ? 0.9 : 0.2;
        if (isLit) {
          fill = awake ? "#ffd87a" : "#e8b34b";
          r = awake ? 9 : 7.5;
          opacity = 1;
        } else if (n.kind === "conduit") {
          fill = n.revealed ? "#5a5f86" : "#3a4060";
        } else if (n.kind === "press") {
          fill = n.revealed ? "#6f6a8e" : "#3a4060";
          r = 8;
        } else if (n.kind === "shrine") {
          fill = n.revealed ? "#8a7aa8" : "#3a4060";
          opacity = Math.max(opacity, 0.35);
        }
        const c = el("circle", { cx: n.x, cy: n.y, r, fill, opacity });
        if (isLit) c.setAttribute("filter", "url(#glow)");
        grp.appendChild(c);
        // A lit node carries a hot white heart inside the flame.
        if (isLit) {
          grp.appendChild(el("circle", {
            cx: n.x, cy: n.y, r: awake ? 3.4 : 2.6, fill: "#fff6da",
          }));
        }
        // Presses bear an inked mark; unlit shrines a faint aureole.
        if (n.kind === "press" && n.revealed && !isLit) {
          grp.appendChild(el("rect", { x: n.x - 3, y: n.y - 3, width: 6, height: 6, fill: "#0b0d1a", opacity: 0.6 }));
        }
        if (n.kind === "shrine" && n.revealed && !isLit) {
          grp.appendChild(el("circle", {
            cx: n.x, cy: n.y, r: 12, fill: "none",
            stroke: "#8a7aa8", "stroke-width": 0.8, "stroke-opacity": 0.4,
          }));
        }
      }
      // A false light the carrier has laid: a thin warm flicker the Keepers
      // mistake for flame, ringed in a dashed cold rim so you can tell the ruse
      // from a true light (and from an awakened soul's solid double-ring).
      if (n.decoy > 0 && n.state === "dark") {
        grp.appendChild(el("circle", {
          cx: n.x, cy: n.y, r: 26, fill: "url(#halo)", opacity: 0.4,
        }));
        grp.appendChild(el("circle", { cx: n.x, cy: n.y, r: 4, fill: "#ffe9b0", opacity: 0.8 }));
        grp.appendChild(el("circle", {
          cx: n.x, cy: n.y, r: 13, fill: "none", stroke: "#9fc4e8",
          "stroke-width": 1, "stroke-opacity": 0.7, "stroke-dasharray": "2 3",
        }));
      }
      // Awakened souls wear a steady halo-ring: a beacon, and a marked one.
      // Drawn over sprite and primitive alike — it is gameplay information.
      if (awake) {
        grp.appendChild(el("circle", {
          cx: n.x, cy: n.y, r: 15, fill: "none",
          stroke: "#ffd87a", "stroke-width": 1.4, opacity: 0.85,
        }));
        grp.appendChild(el("circle", {
          cx: n.x, cy: n.y, r: 19, fill: "none",
          stroke: "#ffd87a", "stroke-width": 0.6, opacity: 0.4,
        }));
        // A settled hearth reads richer: a bright outer band and a warm core,
        // marking the soul that has held long enough to feed the carrier.
        if (isHearth(n)) {
          grp.appendChild(el("circle", {
            cx: n.x, cy: n.y, r: 24, fill: "none",
            stroke: "#ffe9b0", "stroke-width": 1.6, opacity: 0.7,
          }));
          grp.appendChild(el("circle", { cx: n.x, cy: n.y, r: 3, fill: "#fff6da", opacity: 0.95 }));
        }
      }
    }

    layer.appendChild(grp);
  }

  // The carrier itself, when abroad in the flesh (action mode). Drawn last, over
  // everything: a faint dashed ring for the auto-kindle reach, a warm halo, the
  // lantern (sprite or a glowing core), and a red flash through the hit-grace.
  if (g.player) {
    const p = g.player;
    layer.appendChild(el("circle", {
      cx: p.x, cy: p.y, r: KINDLE_RADIUS, fill: "none", stroke: "#ffd87a",
      "stroke-width": 1, "stroke-opacity": 0.12, "stroke-dasharray": "4 8",
    }));
    layer.appendChild(el("circle", {
      cx: p.x, cy: p.y, r: 34, fill: "url(#haloAwake)", opacity: 0.9,
    }));
    if (sprites.has("player-lantern")) {
      layer.appendChild(spriteImage("player-lantern", p.x, p.y, 44, 1));
    } else {
      layer.appendChild(el("circle", {
        cx: p.x, cy: p.y, r: PLAYER_RADIUS, fill: "#fff3d2",
        stroke: "#ffe9b0", "stroke-width": 2, filter: LOW_FX ? "url(#glow)" : "url(#bloom)",
      }));
      layer.appendChild(el("circle", {
        cx: p.x, cy: p.y, r: PLAYER_RADIUS, fill: "#fff3d2",
        stroke: "#ffe9b0", "stroke-width": 2,
      }));
    }
    if (p.hurt > 0) {
      layer.appendChild(el("circle", {
        cx: p.x, cy: p.y, r: PLAYER_RADIUS + 6, fill: "none",
        stroke: "#ff6b6b", "stroke-width": 2.5, opacity: 0.8,
      }));
    }
  }
}

// ---------- Game shell ----------

function byId(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`missing element #${id}`);
  return e;
}

function start(): void {
  const svg = byId("city") as unknown as SVGSVGElement;
  const flameEl = byId("flame");
  const nightEl = byId("night");
  const litEl = byId("litpct");
  const modeBtn = byId("mode");
  const waitBtn = byId("wait");
  const endBtn = byId("endnight");
  const resetBtn = byId("reset");
  const overlay = byId("overlay");
  const overlayTitle = byId("ov-title");
  const overlayBody = byId("ov-body");
  const overlayBtn = byId("ov-btn");
  const overlayBtn2 = byId("ov-btn2");
  const toast = byId("toast");
  const rules = byId("rules");
  const rulesBody = byId("rules-body");
  const rulesBtn = byId("rules-btn");
  const rulesClose = byId("rules-close");
  const fresco = byId("fresco");
  const frescoImg = byId("fresco-img") as HTMLImageElement;
  const frescoCap = byId("fresco-cap");
  const wx = byId("wx");
  const stickEl = byId("stick");
  const stickKnob = byId("stick-knob");

  // Action mode: a real-time shell over the very same sim. The choice is sticky.
  // A `?action` (or `?action=0`) query is authoritative and is remembered, so an
  // installed PWA — whose start_url carries no query — and a returning player
  // both keep the chosen mode. With no query we fall back to the stored
  // preference, then the build flag. The in-app toggle (in the Rules panel) is
  // the only entry point that needs no URL editing, which is what makes action
  // mode reachable on a phone at all.
  const actionQuery = typeof location !== "undefined"
    ? /[?&]action(?:=([^&]*))?/.exec(location.search) : null;
  let actionMode: boolean;
  if (actionQuery) {
    actionMode = actionQuery[1] !== "0"; // ?action / ?action=1 → on, ?action=0 → off
    try { localStorage.setItem(ACTION_PREF_KEY, actionMode ? "1" : "0"); } catch { /* ignore */ }
  } else {
    // An explicit stored choice (either way) wins; only with no stored preference
    // at all do we fall back to the build default. This keeps the in-app toggle
    // meaningful in both directions even when the default is run mode.
    let stored: string | null = null;
    try { stored = localStorage.getItem(ACTION_PREF_KEY); } catch { /* ignore */ }
    actionMode = stored === null ? ACTION_MODE : stored === "1";
  }
  // Remember the mode and reload into it — the same save carries across, so a
  // night in progress simply switches shells.
  function setMode(action: boolean): void {
    try { localStorage.setItem(ACTION_PREF_KEY, action ? "1" : "0"); } catch { /* ignore */ }
    if (typeof location !== "undefined") location.reload();
  }

  const loaded = loadGame();
  let g: GameState = loaded ? loaded.g : freshGame();

  // ----- Camera: drag pans, pinch or wheel zooms, a quiet tap acts. -----
  // The map keeps its world coordinates (W×H); everything renders into one
  // group whose transform is the camera. On a phone the old fit-the-whole-map
  // view made nodes a few pixels wide — now the city fills the screen and the
  // player moves through it.
  const layer = scaffold(svg);
  const cam = { x: 0, y: 0, k: 1 };
  let minK = 0.2;
  let maxK = 2;

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
  function fitCam(): void {
    const vw = svg.clientWidth, vh = svg.clientHeight;
    const fit = Math.min(vw / W, vh / H);    // whole city visible
    const cover = Math.max(vw / W, vh / H);  // city fills the screen
    minK = fit * 0.95;
    maxK = Math.max(1.5, cover * 1.5);
    // Portrait screens (a phone, roughly the map's shape) start filled;
    // wide desktop windows keep the whole city in view.
    cam.k = cover <= fit * 1.75 ? cover : fit;
    cam.x = (vw - W * cam.k) / 2;
    cam.y = (vh - H * cam.k) / 2;
    clampCam();
    applyCam();
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let tap: { x: number; y: number; t: number; id: number } | null = null;
  let pinch: { d: number; k: number; wx: number; wy: number } | null = null;

  // Action-mode input: a floating virtual joystick (touch) and WASD/arrows
  // (desktop) both feed one normalized move vector that the RAF loop reads.
  const STICK_MAX = 60; // px from origin for full tilt
  const move = { x: 0, y: 0 };
  const keys = new Set<string>();
  let stick: { id: number; ox: number; oy: number; moved: boolean } | null = null;
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
      if (actionMode) {
        stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, moved: false };
        move.x = 0; move.y = 0;
        showStick(e.clientX, e.clientY);
      } else {
        tap = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
      }
    } else {
      tap = null;
      stick = null;
      hideStick();
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        pinch = {
          d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
          k: cam.k,
          wx: (mx - cam.x) / cam.k,
          wy: (my - cam.y) / cam.k,
        };
      }
    }
  });
  svg.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 1) {
      if (actionMode && stick && stick.id === e.pointerId) {
        const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
        const mag = Math.hypot(dx, dy);
        if (mag > 8) stick.moved = true;
        const r = mag ? Math.min(1, mag / STICK_MAX) : 0;
        move.x = mag ? (dx / mag) * r : 0;
        move.y = mag ? (dy / mag) * r : 0;
        moveKnob(dx, dy);
      } else if (!actionMode) {
        cam.x += e.clientX - p.x;
        cam.y += e.clientY - p.y;
        if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 9) tap = null;
        clampCam();
        applyCam();
      }
    }
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 2 && pinch) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      cam.k = Math.min(maxK, Math.max(minK, pinch.k * (d / pinch.d)));
      cam.x = mx - pinch.wx * cam.k; // keep the world point under the pinch centre
      cam.y = my - pinch.wy * cam.k;
      clampCam();
      applyCam();
    }
  });
  function endPointer(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (stick && stick.id === e.pointerId) {
      // A quick touch that never tilted the stick is an awaken-tap at that spot.
      if (!stick.moved && actionMode) actionTapAt(e.clientX, e.clientY);
      stick = null;
      move.x = 0; move.y = 0;
      hideStick();
    }
    if (tap && tap.id === e.pointerId) {
      if (Date.now() - tap.t < 500) tapAt(e.clientX, e.clientY);
      tap = null;
    }
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const k = Math.min(maxK, Math.max(minK, cam.k * Math.exp(-e.deltaY * 0.0015)));
    const wx = (e.clientX - cam.x) / cam.k, wy = (e.clientY - cam.y) / cam.k;
    cam.k = k;
    cam.x = e.clientX - wx * k;
    cam.y = e.clientY - wy * k;
    clampCam();
    applyCam();
  }, { passive: false });
  window.addEventListener("resize", () => { clampCam(); applyCam(); });

  // Desktop movement in action mode: WASD / arrow keys feed the same vector.
  const MOVE_KEYS = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];
  if (actionMode) {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.includes(k)) { keys.add(k); e.preventDefault(); }
    });
    window.addEventListener("keyup", (e) => { keys.delete(e.key.toLowerCase()); });
    window.addEventListener("blur", () => keys.clear());
  }

  // A tap acts on the nearest node within thumb's reach — generous when
  // zoomed out, where the nodes themselves are a few pixels wide. (Nodes sit
  // at least MIN_DIST apart in world units, so the nearest match is unique.)
  function tapAt(sx: number, sy: number): void {
    const wx = (sx - cam.x) / cam.k, wy = (sy - cam.y) / cam.k;
    const reach = Math.min(46, Math.max(20, 30 / cam.k));
    let best: CityNode | null = null;
    let bd = reach * reach;
    for (const n of g.nodes) {
      if (n.kind === "keeper") continue;
      const d2 = (n.x - wx) ** 2 + (n.y - wy) ** 2;
      if (d2 <= bd) { bd = d2; best = n; }
    }
    if (best) onTap(best.id);
  }

  // Action mode: a tap that didn't drive the stick awakens the dwelling nearest
  // the touch — the carrier's one deliberate, flame-priced investment.
  function actionTapAt(sx: number, sy: number): void {
    if (g.phase !== "night") return;
    const wx2 = (sx - cam.x) / cam.k, wy2 = (sy - cam.y) / cam.k;
    const reach = Math.min(60, Math.max(26, 40 / cam.k));
    let best: CityNode | null = null;
    let bd = reach * reach;
    for (const n of g.nodes) {
      if (n.kind !== "dwelling" || n.state === "snuffed") continue;
      const d2 = (n.x - wx2) ** 2 + (n.y - wy2) ** 2;
      if (d2 <= bd) { bd = d2; best = n; }
    }
    if (!best) return;
    if (g.flame < AWAKEN_COST) { showToast(`Awakening a soul costs ${AWAKEN_COST}✦ — your life runs low.`); return; }
    if (awaken(g, best.id)) { g.flame -= AWAKEN_COST; }
    else showToast("Only a dwelling — a person — can be awakened.");
  }

  fitCam();

  // Painted sprites pop in as each file is found (or never, harmlessly, while
  // the art is still being generated). Arrivals coalesce into one repaint.
  let spriteFrame = 0;
  loadSprites(() => {
    if (spriteFrame) return;
    spriteFrame = requestAnimationFrame(() => {
      spriteFrame = 0;
      draw(g.phase === "end");
    });
  });

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  function showToast(text: string): void {
    toast.textContent = text;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 5200);
  }

  // A revealed fresco with painted art gets its own quiet illuminated card;
  // plain ones fall back to a toast.
  let frescoTimer: ReturnType<typeof setTimeout> | undefined;
  function hideFresco(): void { fresco.classList.remove("show"); }
  function revealFresco(text: string): void {
    const idx = FRESCOES.indexOf(text);
    const art = idx >= 0 ? FRESCO_ART[idx] : undefined;
    if (!art) { showToast(text); return; }
    frescoImg.src = art;
    frescoCap.textContent = text;
    fresco.classList.add("show");
    clearTimeout(frescoTimer);
    frescoTimer = setTimeout(hideFresco, 7000);
  }
  fresco.addEventListener("click", hideFresco);

  function hud(): void {
    flameEl.textContent = "✦".repeat(Math.max(0, g.flame)) +
      "·".repeat(Math.max(0, g.maxFlame - g.flame));
    nightEl.textContent = `Night ${g.night} · ${weatherLabel(g.weather)}`;
    const s = litStats(g);
    litEl.textContent = `${Math.round((s.lit / s.total) * 100)}% lit`;
    modeBtn.textContent = g.mode === "kindle" ? `Kindle (${KINDLE_COST}✦)`
      : g.mode === "awaken" ? `Awaken (${AWAKEN_COST}✦)`
      : `Decoy (${DECOY_COST}✦)`;
    modeBtn.className = g.mode;
  }

  function draw(dawnMode?: boolean): void {
    render(g, layer, dawnMode);
    hud();
    // The sky, washed over the whole screen. The CSS backgrounds point at
    // art/rain-overlay.png / art/wind-overlay.png and fail silently until
    // those files exist.
    wx.className = g.phase === "night" && g.weather.kind !== "still" ? g.weather.kind : "";
    if (g.pendingFresco) { revealFresco(g.pendingFresco); g.pendingFresco = null; }
    if (g.lostSoul) {
      g.lostSoul = false;
      showToast("A soul you woke is snuffed; the Veil closes where they stood.");
    } else if (g.decoySpent) {
      showToast("A Keeper searches your false light, and finds an empty house.");
    }
    g.decoySpent = false;
    g.playerHit = false; // the hit-flash is driven by player.hurt; clear the per-draw flag
    if (g.veilThickened) {
      g.veilThickened = false;
      const d = g.lastSnuffDistrict >= 0 ? g.level.districts[g.lastSnuffDistrict].name : "the city";
      showToast(`The Veil thickens over ${d}. A new Keeper wakes.`);
    }
  }

  // One breath of the city, driven by the player rather than a clock: the turn
  // advances only when you act or deliberately Wait. After the city steps we
  // save and repaint, surfacing any toast (a snuffed soul, a thickened veil).
  function breathe(): void {
    stepCity(g);
    saveGame(g);
    draw();
  }

  // ----- Action mode: the real-time shell over the same sim -----
  function spawnPlayer(): void {
    g.player = { x: W / 2, y: H / 2, vx: 0, vy: 0, hurt: 0 };
  }
  function centerCam(wx2: number, wy2: number): void {
    const vw = svg.clientWidth, vh = svg.clientHeight;
    cam.x = vw / 2 - wx2 * cam.k;
    cam.y = vh / 2 - wy2 * cam.k;
    clampCam();
    applyCam();
  }
  let lastFrame = 0;
  let stepAcc = 0;
  let saveAcc = 0;
  let kindleCd = 0;
  let running = false;
  function actionFrame(now: number): void {
    if (!running) return;
    if (g.phase === "end") { running = false; return; }
    if (!lastFrame) lastFrame = now;
    let dt = now - lastFrame; lastFrame = now;
    if (dt > 100) dt = 100; // a backgrounded tab must not lurch the city forward
    const p = g.player!;

    // Keyboard feeds the move vector while the stick is idle.
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
    p.vx = move.x * PLAYER_SPEED;
    p.vy = move.y * PLAYER_SPEED;
    p.x = Math.max(PLAYER_RADIUS, Math.min(W - PLAYER_RADIUS, p.x + p.vx * dt / 1000));
    p.y = Math.max(PLAYER_RADIUS, Math.min(H - PLAYER_RADIUS, p.y + p.vy * dt / 1000));
    if (p.hurt > 0) p.hurt = Math.max(0, p.hurt - dt);

    // The weapon: stand still and the lantern kindles the nearest dark ground.
    kindleCd -= dt;
    if (g.phase === "night" && Math.hypot(p.vx, p.vy) < MOVE_KINDLE_MAXSPEED && kindleCd <= 0) {
      let best: CityNode | null = null;
      let bd = KINDLE_RADIUS ** 2;
      for (const n of g.nodes) {
        if (n.kind === "keeper" || n.state !== "dark") continue;
        const d2 = (n.x - p.x) ** 2 + (n.y - p.y) ** 2;
        if (d2 <= bd) { bd = d2; best = n; }
      }
      if (best) { kindle(g, best.id); kindleCd = KINDLE_COOLDOWN_MS; }
    }

    // The city breathes on the clock — the same stepCity the turn-based shell
    // drives per tap, just timed (and capped so a long frame can't spiral).
    if (g.phase === "night") {
      stepAcc += dt;
      let breaths = 0;
      while (stepAcc >= ACTION_STEP_MS && breaths < 8) { stepCity(g); stepAcc -= ACTION_STEP_MS; breaths++; }
      if (stepAcc > ACTION_STEP_MS) stepAcc = ACTION_STEP_MS;
    }

    centerCam(p.x, p.y);
    draw();

    saveAcc += dt;
    if (saveAcc >= 1000) { saveGame(g); saveAcc = 0; }

    // Flame is the avatar's life; when it gutters out, the run is over.
    if (g.phase === "night" && g.flame <= 0) { actionGameOver(); return; }

    requestAnimationFrame(actionFrame);
  }
  function startAction(): void {
    if (running) return;
    running = true;
    lastFrame = 0;
    requestAnimationFrame(actionFrame);
  }
  function actionGameOver(): void {
    running = false;
    g.phase = "end";
    g.player = undefined; // no avatar on the morning-after board
    saveGame(g);
    const { legacy, beat } = recordRun(g); // fold this run into the lifetime record
    draw(true);
    const after = litStats(g);
    showOverlay(
      "The flame gutters out",
      (after.lit > 0
        ? `The Keepers ran you down — but ${after.lit} lights still burn without you, ${Math.round((after.lit / after.total) * 100)}% of the city, held by ${after.awakened} awakened souls.<br><br><em>That is the only victory there was. Ora pro nobis, Lucifer.</em>`
        : `The Keepers ran you down, and the city is dark again.<br><br><em>Begin again. The morning is patient.</em>`) +
        legacyHtml(legacy, beat),
      "Begin again", () => { localStorage.removeItem(SAVE_KEY); location.reload(); }
    );
  }

  function onTap(id: number): void {
    if (g.phase !== "night") return;
    const n = g.nodes[id];
    let acted = false;
    if (g.mode === "kindle") {
      if (g.flame < KINDLE_COST) { showToast("No flame left to give. Wait, or end the night."); return; }
      if (kindle(g, id)) { g.flame -= KINDLE_COST; acted = true; }
    } else if (g.mode === "awaken") {
      if (g.flame < AWAKEN_COST) { showToast(`Awakening a soul costs ${AWAKEN_COST}✦.`); return; }
      if (n.kind !== "dwelling") { showToast("Only a dwelling — a person — can be awakened."); return; }
      if (awaken(g, id)) { g.flame -= AWAKEN_COST; acted = true; }
    } else {
      if (g.flame < DECOY_COST) { showToast(`A false light costs ${DECOY_COST}✦.`); return; }
      if (placeDecoy(g, id)) { g.flame -= DECOY_COST; acted = true; }
      else { showToast("Lay a false light only on dark, empty ground."); return; }
    }
    if (!acted) return; // a tap that lights nothing costs no breath
    breathe();          // your flame, then the city draws one breath in answer
    // The Light-Bringer's hand, glimpsed where the flame was given. Appended
    // after the breath's repaint, it fades by CSS and vanishes with the next
    // wholesale redraw — ephemeral by construction.
    if (sprites.has("player-lantern")) {
      const mark = spriteImage("player-lantern", n.x, n.y - 18, 48, 1);
      mark.setAttribute("class", "lantern-mark");
      layer.appendChild(mark);
    }
  }

  modeBtn.addEventListener("click", () => {
    g.mode = g.mode === "kindle" ? "awaken" : g.mode === "awaken" ? "decoy" : "kindle";
    hud();
  });

  // Wait: spend no flame, but let the night breathe once — light spreads and
  // your awakened souls kindle, at the cost of one step of the Keepers' advance.
  waitBtn.addEventListener("click", () => {
    if (g.phase !== "night") return;
    breathe();
  });

  // ----- Rules: the illuminated page, built from the tuning constants so it
  // never drifts from the actual economy. Opened from the header, read, closed. -----
  rulesBody.innerHTML =
    `<p class="lede">A contemplative inversion. Carry a stolen flame through a city taught that light burns.</p>` +

    `<h3>The premise</h3>` +
    `<p>The Keepers maintain the <em>Veil</em> — a sanctioned dimness in which people live safe, obedient, half&#8209;asleep. You carry a stolen flame. Every place you kindle becomes <em>visible</em>, and visibility is the one thing the Veil cannot survive.</p>` +

    `<h3>Reading the board</h3>` +
    `<dl>` +
    `<dt><span class="swatch" style="background:var(--gold-bright)"></span>✦ Flame</dt>` +
    `<dd>Your fuel, and it is finite. You begin a night with this city's measure (${g.level.startFlame}✦) and spend it to kindle and to awaken.</dd>` +
    `<dt>Kindle — ${KINDLE_COST}✦</dt>` +
    `<dd>Light a place. From there light spreads on its own along conduits and printing presses — the swift carriers of word and fire. Light a <em>press</em> itself and its whole line of carriers catches in one breath.</dd>` +
    `<dt>Awaken — ${AWAKEN_COST}✦</dt>` +
    `<dd>Wake a <em>dwelling</em> into a living soul. Awakened souls kindle by themselves, even while you are away, and they alone carry light through the dawn. Only a dwelling — a person — can be awakened.</dd>` +
    `<dt>Decoy — ${DECOY_COST}✦</dt>` +
    `<dd>Lay a <em>false light</em> on dark, empty ground. It carries nothing and fades on its own — but a Keeper breaks for it before any true flame, walks out to search the empty house, and finds only the spent ruse (no scar). Bait one off its post, then kindle or awaken where it cannot reach.</dd>` +
    `<dt><span class="swatch ring"></span>The cold rings</dt>` +
    `<dd>A Keeper's sight. Keepers <em>patrol</em>: one that sees light leaves its post and closes on it — an awakened soul before any plainer light — and snuffs only what it reaches, then drifts home when the dark is restored. Awaken <em>outside</em> the rings, and watch them move.</dd>` +
    `</dl>` +

    `<h3>How a night runs</h3>` +
    `<ul>` +
    `<li>Tap to act; the footer button toggles between <em>kindle</em> and <em>awaken</em>. Drag to pan the city, pinch to zoom.</li>` +
    `<li><em>The city moves only when you do.</em> Each act — or a deliberate <em>Wait</em> — lets the night breathe once: light spreads a step outward, your awakened souls kindle around themselves, and the Keepers advance.</li>` +
    `<li>Keepers stalk and snuff the light they reach. <em>Snuffing is irreversible</em> — snuffed ground scars over, damps any attempt to relight it, and once the scar thickens enough it breeds a <em>new Keeper</em>.</li>` +
    `<li><em>Wait</em> to let the light spread without spending flame — but every breath moves the Keepers too. End the night whenever you choose.</li>` +
    `</ul>` +

    `<h3>The sky</h3>` +
    `<p>No two nights are alike. A <em>wind</em> drives the flame before it and starves what stands against it. <em>Rain</em> slows the fire to a crawl — and the Keepers' patrols with it. The header names each night's sky.</p>` +

    `<h3>Dawn</h3>` +
    `<p>At dawn, only light still connected to an awakened soul survives; every unbanked light fades back into the dark. Then <em>the carrier burns</em> — each dawn your greatest flame falls by one. You will not finish the city.</p>` +

    `<h3>Hearths</h3>` +
    `<p>A soul that holds awakened through <em>${HEARTH_NIGHTS} dawns</em> settles into a <em>hearth</em> — a home that keeps the flame. Each hearth returns <em>+${HEARTH_REFUND}✦</em> to you at dawn. The carrier still burns, so the end still comes; hearths only make the nights you have left burn brighter. Protect your oldest souls — bait the Keepers off them with decoys — and they become your warmth.</p>` +

    `<h3>The only victory</h3>` +
    `<p>When your flame is finally spent, what the awakened souls still hold is everything that outlived you. Bank light in souls, set where the Keepers cannot reach, and carry as much of the city into the morning as you can.</p>` +

    `<h3>The five quarters of ${g.level.name}</h3>` +
    `<p class="districts2">${g.level.districts.map((d) => d.name).join("<br>")}</p>` +

    // The mode toggle: the one entry point that needs no URL editing, so action
    // mode is reachable on a phone (and an installed PWA, which never carries the
    // ?action query). The chosen mode is remembered across launches.
    `<h3>${actionMode ? "The Lamplighter Run" : "Another way to play"}</h3>` +
    `<p>${actionMode
      ? "You are walking the streets in the flesh — move, and stand still to kindle. Prefer the contemplative, turn-based night?"
      : "There is a real-time mode — <em>The Lamplighter Run</em> — where you become the flame and walk the streets while the Keepers hunt you."}</p>` +
    `<p><button id="mode-toggle" class="mode-toggle">${actionMode ? "Switch to the classic night" : "Try the Lamplighter Run ▸"}</button></p>` +

    `<p class="seal">Ora pro nobis, Lucifer.</p>`;

  const modeToggle = document.getElementById("mode-toggle");
  if (modeToggle) modeToggle.addEventListener("click", () => setMode(!actionMode));

  // The persistent header switch — the one entry point a returning carrier can
  // see without opening the rules. Its label names the shell it would take you
  // to, and the choice is remembered across launches (setMode reloads into it).
  const modeSwitch = document.getElementById("mode-switch");
  if (modeSwitch) {
    modeSwitch.textContent = actionMode ? "Classic night" : "Lamplighter Run";
    modeSwitch.addEventListener("click", () => setMode(!actionMode));
  }

  function openRules(): void { rules.classList.add("show"); }
  function closeRules(): void { rules.classList.remove("show"); }
  rulesBtn.addEventListener("click", openRules);
  rulesClose.addEventListener("click", closeRules);
  // Tap the surrounding dark (not the page) to close.
  rules.addEventListener("click", (ev) => { if (ev.target === rules) closeRules(); });

  function showOverlay(
    title: string,
    body: string,
    btnText: string,
    onBtn: () => void,
    btn2Text?: string,
    onBtn2?: () => void,
  ): void {
    overlayTitle.textContent = title;
    overlayBody.innerHTML = body;
    overlayBtn.textContent = btnText;
    overlayBtn.onclick = onBtn;
    if (btn2Text) {
      overlayBtn2.style.display = "";
      overlayBtn2.textContent = btn2Text;
      overlayBtn2.onclick = onBtn2 ?? null;
    } else {
      overlayBtn2.style.display = "none";
    }
    overlay.classList.remove("hidden");
  }

  function districtLine(g: GameState): string {
    return districtStats(g)
      .map((d) => `${d.name} — ${d.total ? Math.round((d.lit / d.total) * 100) : 0}%`)
      .join("<br>");
  }

  function dawn(): void {
    g.phase = "dawn";
    const { faded } = applyDawn(g);
    const after = litStats(g);
    g.maxFlame -= 1; // the carrier burns

    if (g.maxFlame <= 0) {
      g.phase = "end";
      saveGame(g);
      const { legacy, beat } = recordRun(g); // fold this run into the lifetime record
      draw(true); // render the city in dawn light, only survivors gold
      const pct = Math.round((after.lit / after.total) * 100);
      showOverlay(
        "The carrier is spent",
        (after.lit > 0
          ? `Your flame is gone. But ${after.lit} lights still burn without you — ${pct}% of the city, held by ${after.awakened} awakened souls${after.hearths > 0 ? `, ${after.hearths} of them settled hearths that will keep the flame` : ``}.<br><br>That is the only victory there was.<br><br><em>Ora pro nobis, Lucifer.</em>`
          : `Your flame is gone, and the city is dark. Nothing you lit outlived you.<br><br><em>Begin again. The morning is patient.</em>`) +
          legacyHtml(legacy, beat),
        "Begin again", () => { localStorage.removeItem(SAVE_KEY); location.reload(); }
      );
      return;
    }

    // Hearths — souls that have held HEARTH_NIGHTS dawns — return a little flame
    // to the carrier, the only warmth the dimming hand gets back. The carrier
    // still burns, so the run still ends; hearths only make the nights you have
    // left burn brighter.
    const refund = after.hearths * HEARTH_REFUND;
    const nightFlame = g.maxFlame + refund;

    saveGame(g);
    showOverlay(
      `Dawn, after night ${g.night}`,
      `${faded} unbanked lights faded with the dark. ${after.lit} survive, held by ${after.awakened} awakened souls.<br><br>` +
      `<span class="districts">${districtLine(g)}</span><br>` +
      `Your flame burns lower: ${g.maxFlame}✦ remain to you.` +
      (after.hearths > 0
        ? `<br>${after.hearths} ${after.hearths === 1 ? "hearth keeps" : "hearths keep"} the flame, returning +${refund}✦ for the night to come.`
        : ``),
      "Carry on", () => {
        g.night += 1;
        g.flame = nightFlame; // maxFlame, warmed by what the hearths return
        g.weather = rollWeather(g.night, g.level); // a new sky for the new night
        g.phase = "night";
        overlay.classList.add("hidden");
        saveGame(g);
        draw();
        showToast(weatherNotice(g.weather));
      }
    );
  }

  endBtn.addEventListener("click", dawn);

  // Start over from the beginning — irreversible, so confirm first.
  resetBtn.addEventListener("click", () => {
    showOverlay(
      "Begin again?",
      "This forgets the whole city — every awakened soul, every scar in the Veil, every night you have carried. The flame is handed back, full, to a stranger.",
      "Begin again",
      () => { localStorage.removeItem(SAVE_KEY); location.reload(); },
      "Keep carrying",
      () => { overlay.classList.add("hidden"); },
    );
  });

  // No clock: the city is turn-based now. It advances one breath per player
  // action (or Wait) via breathe(); only the idle catch-up below still runs the
  // sim unattended, converting wall-clock absence into breaths at TICK_MS each.

  // ----- Choose-a-city: on a fresh start the carrier picks which city to walk
  // into. Each is the same rules under different dials (density, conduction, the
  // watch, the sky), so it is a new puzzle, not a new game. Picking rerolls the
  // not-yet-begun city in place (g is reassigned); a returning carrier keeps the
  // city their save already carries. The hardest city opens once the legacy shows
  // a deep enough run. -----
  const introLegacy = loadLegacy();
  function cityOpen(lv: LevelDef): boolean {
    return !lv.unlockNight || introLegacy.bestNight >= lv.unlockNight;
  }
  function cityPickerHtml(selId: string): string {
    return `<div class="cities">` + LEVELS.map((lv) => {
      const locked = !cityOpen(lv);
      const cls = `city${lv.id === selId ? " sel" : ""}${locked ? " locked" : ""}`;
      const line = locked
        ? `Carry a flame to night ${lv.unlockNight} to open this city`
        : lv.epigraph;
      return `<button class="${cls}" data-city="${lv.id}"${locked ? " disabled" : ""}>` +
        `<span class="city-name">${lv.name}</span>` +
        `<span class="city-line">${line}</span></button>`;
    }).join("") + `</div>`;
  }
  function wireCityPicker(onPick: (lv: LevelDef) => void): void {
    document.querySelectorAll<HTMLButtonElement>("#ov-body .city").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lv = levelById(btn.dataset.city || "");
        if (lv && cityOpen(lv)) onPick(lv);
      });
    });
    // The establishing card, if its art exists (art/city-*.jpg); fails silently.
    const img = document.querySelector<HTMLImageElement>("#ov-body .city-art");
    if (img) img.onerror = () => { img.style.display = "none"; };
  }

  // The classic night's intro, rebuilt whenever the city choice changes so the
  // card art, epigraph highlight, and button label track the selection.
  function showClassicIntro(): void {
    const card = g.level.art
      ? `<img class="city-art" src="${g.level.art}" alt="">`
      : `<img class="ov-sigil" src="art/keeper-sigil.png" alt="A Keeper's sigil" width="96" height="96">`;
    showOverlay(
      "The Light-Bringer",
      card +
      `The world has been taught that the light burns. The Keepers maintain the Veil — a sanctioned dimness in which people live safe, obedient, half-asleep.<br><br>` +
      `You carry a stolen flame. Every place you kindle becomes visible — and visibility is what the Veil cannot survive.<br><br>` +
      `<em>Choose a city to carry it into:</em>` +
      cityPickerHtml(g.level.id) +
      `<em>Tap to kindle; drag to pan, pinch to zoom. The city moves only when you do — each act, or a Wait, lets the night breathe once. The cold rings are the Keepers' sight. Awaken a dwelling and it carries the light while you are away. The carrier burns: each night your flame is smaller. You will not finish the city.</em>` +
      legacyHtml(introLegacy),
      `Carry the flame into ${g.level.name}`,
      () => { g.phase = "night"; overlay.classList.add("hidden"); draw(); },
      "Try the Lamplighter Run ▸", () => setMode(true),
    );
    wireCityPicker((lv) => { g = freshGame(lv); showClassicIntro(); draw(); });
    draw();
  }

  // The Lamplighter Run's intro, with the same picker. Choosing a city rerolls
  // the map and re-spawns the avatar at its heart, ready to run.
  function showActionIntro(): void {
    const card = g.level.art ? `<img class="city-art" src="${g.level.art}" alt="">` : "";
    showOverlay(
      "The Lamplighter Run",
      card +
      `You are the flame now. Move with the stick — or <em>WASD</em> — and <em>stand still</em> to kindle the dark around you. Tap a dwelling to awaken a soul (${AWAKEN_COST}✦). The Keepers no longer wait: they leave their posts to hunt you. Your ✦ is your life — when it gutters out, the run ends.<br><br>` +
      `<em>Choose a city to run:</em>` +
      cityPickerHtml(g.level.id),
      `Run ${g.level.name}`,
      () => { overlay.classList.add("hidden"); startAction(); },
      "The classic night ▸", () => setMode(false),
    );
    wireCityPicker((lv) => {
      g = freshGame(lv);
      spawnPlayer();
      g.phase = "night";
      centerCam(g.player!.x, g.player!.y);
      showActionIntro();
      draw();
    });
  }

  // ----- First-paint: intro, or "while you were away" -----
  if (actionMode) {
    // Auto-kindle and tap-to-awaken replace the kindle/awaken/wait footer;
    // End-the-night stays. Hide the turn-based help line, spawn the avatar.
    modeBtn.style.display = "none";
    waitBtn.style.display = "none";
    const help = document.getElementById("help");
    if (help) help.style.display = "none";
    spawnPlayer();
    if (g.phase === "end") {
      g.player = undefined;
      draw(true);
      const after = litStats(g);
      showOverlay("The flame gutters out",
        `${after.lit} lights still burn — ${Math.round((after.lit / after.total) * 100)}% of the city.<br><br><em>Ora pro nobis, Lucifer.</em>` +
          legacyHtml(loadLegacy()),
        "Begin again", () => { localStorage.removeItem(SAVE_KEY); location.reload(); });
    } else {
      g.phase = "night";
      centerCam(g.player!.x, g.player!.y);
      draw();
      showActionIntro();
    }
  } else if (!loaded) {
    g.phase = "intro";
    showClassicIntro();
  } else if (g.phase === "end") {
    draw(true);
    const after = litStats(g);
    showOverlay("The carrier is spent",
      `${after.lit} lights still burn — ${Math.round((after.lit / after.total) * 100)}% of the city.<br><br><em>Ora pro nobis, Lucifer.</em>` +
        legacyHtml(loadLegacy()),
      "Begin again", () => { localStorage.removeItem(SAVE_KEY); location.reload(); });
  } else {
    // Awakened souls kept working while the app was closed.
    const elapsed = Date.now() - loaded.savedAt;
    const ticks = Math.min(IDLE_CAP_TICKS, Math.floor(elapsed / TICK_MS));
    const before = litStats(g);
    if (ticks > 8 && before.awakened > 0) {
      simulateTicks(g, ticks);
      const after = litStats(g);
      const gained = after.lit - before.lit;
      saveGame(g);
      draw();
      if (gained !== 0) {
        showOverlay(
          "While you were away",
          gained > 0
            ? `The souls you awakened kept the flame. ${gained > 0 ? "+" : ""}${gained} more lights now burn — the city is ${Math.round((after.lit / after.total) * 100)}% lit.`
            : `The Keepers were busy in your absence. The light is ${Math.round((after.lit / after.total) * 100)}% now.`,
          "Carry on", () => overlay.classList.add("hidden")
        );
      }
    } else {
      draw();
    }
  }
}

// Service worker registration for offline play.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

// Test hook (no effect in the browser): lets a headless harness exercise the sim.
const testGlobal = globalThis as unknown as {
  __LB_TEST__?: boolean;
  __lb?: Record<string, unknown>;
};
if (typeof globalThis !== "undefined" && testGlobal.__LB_TEST__) {
  testGlobal.__lb = {
    generateCity, freshGame, simulateTicks, stepCity, stepSpread, stepAwakened,
    stepKeepers, keeperRadius, kindle, awaken, placeDecoy, snuff, litStats, isHearth, applyDawn,
    districtStats, saveGame, loadGame, rollWeather, DISTRICTS,
    loadLegacy, recordRun, emptyLegacy,
    LEVELS, levelById,
  };
} else {
  start();
}
