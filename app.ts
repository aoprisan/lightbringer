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
type Mode = "kindle" | "awaken";

interface CityNode {
  id: number;
  x: number;
  y: number;
  kind: NodeKind;
  state: NodeState;
  brightness: number; // 0..1
  revealed: boolean;
  heat: number; // Keeper attention accrued here
  veil: number; // thickening dark left by snuffing
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
  night: number;
  maxFlame: number;
  flame: number;
  mode: Mode;
  phase: Phase;
  tick: number;
  shownFrescoes: number[];
  pendingFresco: string | null;
  lastSnuffDistrict: number;
  veilThickened: boolean;
  lostSoul: boolean; // an awakened soul was snuffed since the last draw
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

const TICK_MS = 850;
const KEEPER_SNUFF_EVERY = 5;      // ticks between a Keeper's snuffings
const KEEPER_RADIUS = 220;         // base sensing radius
const AWAKEN_KINDLE_EVERY = 4;     // ticks between an awakened soul's own kindling
const MAX_KEEPERS = 12;            // cap on Veil reinforcements
const VEIL_REINFORCE_AT = 3.2;     // local veil weight that thickens into a new Keeper

const IDLE_CAP_TICKS = 600;        // most "while you were away" ticks we simulate

const COND: Record<NodeKind, number> = {
  conduit: 0.5,   // oil, paper, rumor — carries light fast
  press: 0.66,    // a printing press: word made many
  dwelling: 0.18,
  shrine: 0.28,
  keeper: 0.0,
};

const SAVE_KEY = "lightbringer.save.v2";

// ---------- Districts ----------
// Five quarters, found by nearest fixed anchor so clusters look organic.
const DISTRICTS: District[] = [
  { name: "The Lower Nave", x: 300, y: 230 },
  { name: "Ashfold", x: 720, y: 360 },
  { name: "The Glassworks", x: 250, y: 720 },
  { name: "Vesper Row", x: 760, y: 850 },
  { name: "The Drowned Quarter", x: 500, y: 1180 },
];

function districtOf(x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < DISTRICTS.length; i++) {
    const d = (DISTRICTS[i].x - x) ** 2 + (DISTRICTS[i].y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
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
  12: "art/fresco-morning.jpg",// "The morning is not coming to judge you. It is only morning."
};

// ---------- City generation ----------

function generateCity(): City {
  const nodes: CityNode[] = [];
  let guard = 0;
  while (nodes.length < NODE_COUNT && guard++ < 20000) {
    const x = 60 + Math.random() * (W - 120);
    const y = 60 + Math.random() * (H - 120);
    if (nodes.every((n) => (n.x - x) ** 2 + (n.y - y) ** 2 > MIN_DIST ** 2)) {
      nodes.push(makeNode(nodes.length, x, y, "dwelling"));
    }
  }

  // Assign kinds: conduits (rumor/oil), a few presses, shrines, spread-out Keepers.
  const shuffled = [...nodes].sort(() => Math.random() - 0.5);
  shuffled.slice(0, Math.floor(nodes.length * 0.16)).forEach((n) => (n.kind = "conduit"));
  shuffled.slice(Math.floor(nodes.length * 0.16), Math.floor(nodes.length * 0.16) + 4)
    .forEach((n) => (n.kind = "press"));
  shuffled.slice(-5).forEach((n) => (n.kind = "shrine"));

  const keepers: CityNode[] = [];
  for (const n of shuffled) {
    if (n.kind !== "dwelling") continue;
    if (keepers.every((k) => (k.x - n.x) ** 2 + (k.y - n.y) ** 2 > 360 ** 2)) {
      n.kind = "keeper";
      keepers.push(n);
      if (keepers.length >= 6) break;
    }
  }

  return finalizeCity(nodes);
}

function makeNode(id: number, x: number, y: number, kind: NodeKind): CityNode {
  return {
    id, x, y, kind,
    state: "dark",       // dark | lit | awakened | snuffed
    brightness: 0,       // 0..1
    revealed: false,
    heat: 0,             // Keeper attention accrued here
    veil: 0,             // thickening dark left by snuffing
    district: districtOf(x, y),
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
  reveal(g, id, n.kind === "press" ? 3 : 2);
  if (n.kind === "shrine") revealDistrict(g, n.district); // a shrine lights its quarter
  return true;
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
  reveal(g, id, 2);
  return true;
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
      const chance =
        e.conductivity * n.brightness * (n.state === "awakened" ? 1.25 : 1) * veilDamp;
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

// A Keeper's reach widens with the snuffed dark around it — the Veil patrols
// its own scars. Kept as a pure helper so render() can draw the very ring the
// simulation enforces; the two must never drift apart.
function keeperRadius(g: GameState, k: CityNode): number {
  let localVeil = 0;
  for (const n of g.nodes) {
    const d2 = (n.x - k.x) ** 2 + (n.y - k.y) ** 2;
    if (d2 <= (KEEPER_RADIUS * 1.4) ** 2) localVeil += n.veil;
  }
  return KEEPER_RADIUS * (1 + Math.min(0.6, localVeil * 0.05));
}

function stepKeepers(g: GameState): void {
  if (g.tick % KEEPER_SNUFF_EVERY !== 0) return;
  for (const k of g.nodes) {
    if (k.kind !== "keeper") continue;
    const radius2 = keeperRadius(g, k) ** 2;
    // A Keeper hunts beacons first: an awakened soul outranks any lit ground in
    // reach, however bright — banking a flame paints a target. Within a tier,
    // the brightest light draws the eye.
    let target: CityNode | null = null;
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
    if (target) snuff(g, target);
  }
  reinforceVeil(g);
}

function snuff(g: GameState, n: CityNode): void {
  const wasAwakened = n.state === "awakened";
  n.state = "snuffed";
  n.brightness = 0;
  n.revealed = true;
  n.heat = 0;
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
  g.veilThickened = true;
}

interface LitStats { lit: number; total: number; awakened: number; }

function litStats(g: GameState): LitStats {
  let lit = 0, awakened = 0, total = 0;
  for (const n of g.nodes) {
    if (n.kind === "keeper") continue;
    total++;
    if (n.state === "lit" || n.state === "awakened") lit++;
    if (n.state === "awakened") awakened++;
  }
  return { lit, total, awakened };
}

interface DistrictStat { name: string; lit: number; total: number; }

function districtStats(g: GameState): DistrictStat[] {
  const out: DistrictStat[] = DISTRICTS.map((d) => ({ name: d.name, lit: 0, total: 0 }));
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
    if (n.state === "lit" && !keep.has(n.id)) {
      n.state = "dark"; n.brightness = 0; faded++;
    } else if (n.state === "lit") {
      n.brightness = 0.8;
    }
    n.heat = 0;
  }
  return { faded };
}

// ---------- Persistence ----------

interface SaveData {
  v: number;
  night: number;
  maxFlame: number;
  flame: number;
  tick: number;
  phase: Phase;
  shownFrescoes: number[];
  savedAt: number;
  nodes: [number, number, NodeKind, NodeState, number, number, number, number][];
}

function saveGame(g: GameState): void {
  try {
    const data: SaveData = {
      v: 2,
      night: g.night, maxFlame: g.maxFlame, flame: g.flame,
      tick: g.tick, phase: g.phase,
      shownFrescoes: g.shownFrescoes,
      savedAt: Date.now(),
      nodes: g.nodes.map((n) => [
        n.x | 0, n.y | 0, n.kind, n.state,
        Math.round(n.brightness * 100), n.revealed ? 1 : 0,
        n.heat, Math.round(n.veil * 10),
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
  if (!data || data.v !== 2 || !Array.isArray(data.nodes)) return null;

  const nodes = data.nodes.map((r, id) => {
    const n = makeNode(id, r[0], r[1], r[2]);
    n.state = r[3];
    n.brightness = r[4] / 100;
    n.revealed = !!r[5];
    n.heat = r[6];
    n.veil = r[7] / 10;
    return n;
  });
  const { edges, adj } = finalizeCity(nodes);
  const g: GameState = {
    nodes, edges, adj,
    night: data.night, maxFlame: data.maxFlame, flame: data.flame,
    mode: "kindle", phase: data.phase === "end" ? "end" : "night",
    tick: data.tick || 0,
    shownFrescoes: Array.isArray(data.shownFrescoes) ? data.shownFrescoes : [],
    pendingFresco: null, lastSnuffDistrict: -1, veilThickened: false,
    lostSoul: false,
  };
  return { g, savedAt: data.savedAt || Date.now() };
}

function freshGame(): GameState {
  const { nodes, edges, adj } = generateCity();
  const g: GameState = {
    nodes, edges, adj,
    night: 1, maxFlame: START_FLAME, flame: START_FLAME,
    mode: "kindle", phase: "night", tick: 0,
    shownFrescoes: [], pendingFresco: null,
    lastSnuffDistrict: -1, veilThickened: false, lostSoul: false,
  };
  for (const n of g.nodes) if (n.kind === "shrine") reveal(g, n.id, 1);
  return g;
}

// Run the city forward unattended (used for "while you were away").
function simulateTicks(g: GameState, count: number): void {
  for (let i = 0; i < count; i++) {
    g.tick += 1;
    stepSpread(g);
    stepAwakened(g);
    stepKeepers(g);
  }
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

type TapHandler = (id: number) => void;

function render(g: GameState, svg: SVGSVGElement, onTap: TapHandler, dawnMode?: boolean): void {
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
    </radialGradient>`;
  svg.appendChild(defs);

  // Veil blots first — the thickening dark sits beneath everything, an ink
  // stain that feathers out into the night rather than a hard disc.
  for (const n of g.nodes) {
    if (n.veil > 0.1 && n.kind !== "keeper") {
      svg.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: 18 + Math.min(34, n.veil * 9),
        fill: "url(#veil)", opacity: Math.min(0.9, 0.4 + n.veil * 0.14),
      }));
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
      const rad = keeperRadius(g, k);
      svg.appendChild(el("circle", { cx: k.x, cy: k.y, r: rad, fill: "url(#cold)" }));
      svg.appendChild(el("circle", {
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
    if (litEdge && !dawnMode) {
      svg.appendChild(el("line", {
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
    svg.appendChild(line);
  }

  // Nodes
  for (const n of g.nodes) {
    const grp = el("g", { style: "cursor:pointer" });
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
      // A watchful sentinel: a cold diamond with a dark vertical slit for an eye.
      const r = 9;
      const op = n.revealed ? 0.95 : 0.1;
      grp.appendChild(el("rect", {
        x: n.x - r, y: n.y - r, width: r * 2, height: r * 2, rx: 1.5,
        fill: "#9fc4e8", opacity: op, transform: `rotate(45 ${n.x} ${n.y})`,
      }));
      if (n.revealed) {
        grp.appendChild(el("rect", {
          x: n.x - 1.4, y: n.y - 4.5, width: 2.8, height: 9, rx: 1.4,
          fill: "#0b0f1c", opacity: 0.85,
        }));
      }
    } else if (n.state === "snuffed") {
      // Snuffed ground: a cold-rimmed husk over its own veil stain.
      grp.appendChild(el("circle", {
        cx: n.x, cy: n.y, r: 10, fill: "#0a0c16",
        stroke: "#46527a", "stroke-width": 1.4, opacity: 0.95,
      }));
      grp.appendChild(el("circle", { cx: n.x, cy: n.y, r: 2.4, fill: "#2a3354", opacity: 0.9 }));
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
      // Awakened souls wear a steady halo-ring: a beacon, and a marked one.
      if (awake) {
        grp.appendChild(el("circle", {
          cx: n.x, cy: n.y, r: 15, fill: "none",
          stroke: "#ffd87a", "stroke-width": 1.4, opacity: 0.85,
        }));
        grp.appendChild(el("circle", {
          cx: n.x, cy: n.y, r: 19, fill: "none",
          stroke: "#ffd87a", "stroke-width": 0.6, opacity: 0.4,
        }));
      }
    }

    grp.addEventListener("pointerdown", (ev) => { ev.preventDefault(); onTap(n.id); });
    svg.appendChild(grp);
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

  const loaded = loadGame();
  let g: GameState = loaded ? loaded.g : freshGame();

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
    nightEl.textContent = `Night ${g.night}`;
    const s = litStats(g);
    litEl.textContent = `${Math.round((s.lit / s.total) * 100)}% lit`;
    modeBtn.textContent = g.mode === "kindle" ? `Kindle (${KINDLE_COST}✦)` : `Awaken (${AWAKEN_COST}✦)`;
    modeBtn.className = g.mode;
  }

  function draw(dawnMode?: boolean): void {
    render(g, svg, onTap, dawnMode);
    hud();
    if (g.pendingFresco) { revealFresco(g.pendingFresco); g.pendingFresco = null; }
    if (g.lostSoul) {
      g.lostSoul = false;
      showToast("A soul you woke is snuffed; the Veil closes where they stood.");
    }
    if (g.veilThickened) {
      g.veilThickened = false;
      const d = g.lastSnuffDistrict >= 0 ? DISTRICTS[g.lastSnuffDistrict].name : "the city";
      showToast(`The Veil thickens over ${d}. A new Keeper wakes.`);
    }
  }

  function onTap(id: number): void {
    if (g.phase !== "night") return;
    const n = g.nodes[id];
    if (g.mode === "kindle") {
      if (g.flame < KINDLE_COST) { showToast("No flame left to give. End the night."); return; }
      if (kindle(g, id)) g.flame -= KINDLE_COST;
    } else {
      if (g.flame < AWAKEN_COST) { showToast(`Awakening a soul costs ${AWAKEN_COST}✦.`); return; }
      if (n.kind !== "dwelling") { showToast("Only a dwelling — a person — can be awakened."); return; }
      if (awaken(g, id)) g.flame -= AWAKEN_COST;
    }
    saveGame(g);
    draw();
  }

  modeBtn.addEventListener("click", () => {
    g.mode = g.mode === "kindle" ? "awaken" : "kindle";
    hud();
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
    `<dd>Your fuel, and it is finite. You begin a night with ${START_FLAME}✦ and spend it to kindle and to awaken.</dd>` +
    `<dt>Kindle — ${KINDLE_COST}✦</dt>` +
    `<dd>Light a place. From there light spreads on its own along conduits and printing presses — the swift carriers of word and fire.</dd>` +
    `<dt>Awaken — ${AWAKEN_COST}✦</dt>` +
    `<dd>Wake a <em>dwelling</em> into a living soul. Awakened souls kindle by themselves, even while you are away, and they alone carry light through the dawn. Only a dwelling — a person — can be awakened.</dd>` +
    `<dt><span class="swatch ring"></span>The cold rings</dt>` +
    `<dd>A Keeper's reach. Anything lit within it is a target — and a Keeper hunts an awakened soul before any plainer light. Awaken <em>outside</em> the rings.</dd>` +
    `</dl>` +

    `<h3>How a night runs</h3>` +
    `<ul>` +
    `<li>Tap to act; the footer button toggles between <em>kindle</em> and <em>awaken</em>.</li>` +
    `<li>Each tick, light spreads outward and your awakened souls kindle around themselves.</li>` +
    `<li>Keepers snuff light within reach. <em>Snuffing is irreversible</em> — snuffed ground scars over, damps any attempt to relight it, and once the scar thickens enough it breeds a <em>new Keeper</em>.</li>` +
    `<li>End the night whenever your flame runs low.</li>` +
    `</ul>` +

    `<h3>Dawn</h3>` +
    `<p>At dawn, only light still connected to an awakened soul survives; every unbanked light fades back into the dark. Then <em>the carrier burns</em> — each dawn your greatest flame falls by one. You will not finish the city.</p>` +

    `<h3>The only victory</h3>` +
    `<p>When your flame is finally spent, what the awakened souls still hold is everything that outlived you. Bank light in souls, set where the Keepers cannot reach, and carry as much of the city into the morning as you can.</p>` +

    `<h3>The five quarters</h3>` +
    `<p class="districts2">${DISTRICTS.map((d) => d.name).join("<br>")}</p>` +

    `<p class="seal">Ora pro nobis, Lucifer.</p>`;

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
      draw(true); // render the city in dawn light, only survivors gold
      const pct = Math.round((after.lit / after.total) * 100);
      showOverlay(
        "The carrier is spent",
        after.lit > 0
          ? `Your flame is gone. But ${after.lit} lights still burn without you — ${pct}% of the city, held by ${after.awakened} awakened souls.<br><br>That is the only victory there was.<br><br><em>Ora pro nobis, Lucifer.</em>`
          : `Your flame is gone, and the city is dark. Nothing you lit outlived you.<br><br><em>Begin again. The morning is patient.</em>`,
        "Begin again", () => { localStorage.removeItem(SAVE_KEY); location.reload(); }
      );
      return;
    }

    saveGame(g);
    showOverlay(
      `Dawn, after night ${g.night}`,
      `${faded} unbanked lights faded with the dark. ${after.lit} survive, held by ${after.awakened} awakened souls.<br><br>` +
      `<span class="districts">${districtLine(g)}</span><br>` +
      `Your flame burns lower: ${g.maxFlame}✦ remain to you.`,
      "Carry on", () => {
        g.night += 1;
        g.flame = g.maxFlame;
        g.phase = "night";
        overlay.classList.add("hidden");
        saveGame(g);
        draw();
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

  // Live tick
  setInterval(() => {
    if (g.phase !== "night") return;
    g.tick += 1;
    stepSpread(g);
    stepAwakened(g);
    stepKeepers(g);
    saveGame(g);
    draw();
  }, TICK_MS);

  // ----- First-paint: intro, or "while you were away" -----
  if (!loaded) {
    g.phase = "intro";
    showOverlay(
      "The Light-Bringer",
      `<img class="ov-sigil" src="art/keeper-sigil.png" alt="A Keeper's sigil" width="96" height="96">` +
      `The world has been taught that the light burns. The Keepers maintain the Veil — a sanctioned dimness in which people live safe, obedient, half-asleep.<br><br>` +
      `You carry a stolen flame. Every place you kindle becomes visible — and visibility is what the Veil cannot survive.<br><br>` +
      `<em>Tap to kindle. The cold rings are the Keepers' reach. Awaken a dwelling and it carries the light while you are away — but a waking soul shines where they can see. The carrier burns: each night your flame is smaller. You will not finish the city.</em>`,
      "Carry the flame", () => { g.phase = "night"; overlay.classList.add("hidden"); draw(); }
    );
    draw();
  } else if (g.phase === "end") {
    draw(true);
    const after = litStats(g);
    showOverlay("The carrier is spent",
      `${after.lit} lights still burn — ${Math.round((after.lit / after.total) * 100)}% of the city.<br><br><em>Ora pro nobis, Lucifer.</em>`,
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
    generateCity, freshGame, simulateTicks, stepSpread, stepAwakened,
    stepKeepers, keeperRadius, kindle, awaken, snuff, litStats, applyDawn,
    districtStats, saveGame, loadGame, DISTRICTS,
  };
} else {
  start();
}
