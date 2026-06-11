// THE LIGHT-BRINGER — light-propagation prototype
// Core question under test: does "kindling" feel like a real decision?

// ---------- Types ----------

type NodeKind = "dwelling" | "conduit" | "shrine" | "keeper";
type NodeState = "dark" | "lit" | "awakened" | "snuffed";

interface CityNode {
  id: number;
  x: number;
  y: number;
  kind: NodeKind;
  state: NodeState;
  brightness: number; // 0..1
  revealed: boolean;
  heat: number; // keeper attention accumulated on this node
}

interface Edge {
  a: number;
  b: number;
  conductivity: number; // chance multiplier for spread per tick
}

interface GameState {
  nodes: CityNode[];
  edges: Edge[];
  adj: Map<number, number[]>;
  night: number;
  maxFlame: number;
  flame: number;
  mode: "kindle" | "awaken";
  phase: "night" | "dawn" | "end";
  tick: number;
}

// ---------- Tuning ----------

const W = 1000;
const H = 1400;
const NODE_COUNT = 110;
const MIN_DIST = 78;
const NEIGHBORS = 3;
const START_FLAME = 9;
const KINDLE_COST = 1;
const AWAKEN_COST = 3;
const TICK_MS = 650;
const KEEPER_SNUFF_EVERY = 5; // ticks
const KEEPER_RADIUS = 230;

const COND: Record<NodeKind, number> = {
  conduit: 0.5, // oil, paper, rumor — carries light fast
  dwelling: 0.18,
  shrine: 0.28,
  keeper: 0.0,
};

// ---------- City generation ----------

function rngId(): number {
  return Math.floor(Math.random() * 1e9);
}

function generateCity(): { nodes: CityNode[]; edges: Edge[]; adj: Map<number, number[]> } {
  const nodes: CityNode[] = [];
  let guard = 0;
  while (nodes.length < NODE_COUNT && guard++ < 20000) {
    const x = 60 + Math.random() * (W - 120);
    const y = 60 + Math.random() * (H - 120);
    if (nodes.every((n) => (n.x - x) ** 2 + (n.y - y) ** 2 > MIN_DIST ** 2)) {
      nodes.push({
        id: nodes.length,
        x,
        y,
        kind: "dwelling",
        state: "dark",
        brightness: 0,
        revealed: false,
        heat: 0,
      });
    }
  }

  // Assign kinds: ~18% conduits, 5 shrines, 6 keeper posts spread out
  const shuffled = [...nodes].sort(() => Math.random() - 0.5);
  shuffled.slice(0, Math.floor(nodes.length * 0.18)).forEach((n) => (n.kind = "conduit"));
  shuffled.slice(-5).forEach((n) => (n.kind = "shrine"));
  // Keepers: pick spread-out nodes
  const keepers: CityNode[] = [];
  for (const n of shuffled) {
    if (n.kind !== "dwelling") continue;
    if (keepers.every((k) => (k.x - n.x) ** 2 + (k.y - n.y) ** 2 > 380 ** 2)) {
      n.kind = "keeper";
      keepers.push(n);
      if (keepers.length >= 6) break;
    }
  }

  // Edges: connect each node to its k nearest
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const near = nodes
      .filter((m) => m.id !== n.id)
      .sort(
        (p, q) =>
          (p.x - n.x) ** 2 + (p.y - n.y) ** 2 - ((q.x - n.x) ** 2 + (q.y - n.y) ** 2)
      )
      .slice(0, NEIGHBORS);
    for (const m of near) {
      const key = n.id < m.id ? `${n.id}-${m.id}` : `${m.id}-${n.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cond = Math.min(COND[n.kind] + COND[m.kind], 0.6) + 0.08;
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
  n.revealed = true;
  if (depth <= 0) return;
  for (const m of g.adj.get(id) ?? []) reveal(g, m, depth - 1);
}

function kindle(g: GameState, id: number): boolean {
  const n = g.nodes[id];
  if (n.state !== "dark" || n.kind === "keeper") return false;
  n.state = "lit";
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
      const chance = e.conductivity * n.brightness * (n.state === "awakened" ? 1.25 : 1);
      if (Math.random() < chance * 0.45) toLight.push(mId);
    }
    // Lit (un-banked) flames slowly dim; awakened ones hold steady
    if (n.state === "lit") n.brightness = Math.max(0.35, n.brightness - 0.03);
  }
  for (const id of toLight) kindle(g, id);
}

function stepKeepers(g: GameState): void {
  if (g.tick % KEEPER_SNUFF_EVERY !== 0) return;
  for (const k of g.nodes) {
    if (k.kind !== "keeper") continue;
    // Find brightest lit node in radius; awakened nodes resist one extra cycle via heat
    let target: CityNode | null = null;
    for (const n of g.nodes) {
      if (n.state !== "lit" && n.state !== "awakened") continue;
      const d2 = (n.x - k.x) ** 2 + (n.y - k.y) ** 2;
      if (d2 > KEEPER_RADIUS ** 2) continue;
      if (!target || n.brightness > target.brightness) target = n;
    }
    if (!target) continue;
    target.heat += 1;
    const threshold = target.state === "awakened" ? 2 : 1;
    if (target.heat >= threshold) {
      target.state = "snuffed"; // irreversible — this is the Go-like asymmetry
      target.brightness = 0;
      target.revealed = true;
    }
  }
}

function litStats(g: GameState): { lit: number; total: number; awakened: number } {
  let lit = 0;
  let awakened = 0;
  let total = 0;
  for (const n of g.nodes) {
    if (n.kind === "keeper") continue;
    total++;
    if (n.state === "lit" || n.state === "awakened") lit++;
    if (n.state === "awakened") awakened++;
  }
  return { lit, total, awakened };
}

// At dawn, only light connected to an awakened soul survives.
function applyDawn(g: GameState): { survived: number; faded: number } {
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
      n.state = "dark";
      n.brightness = 0;
      faded++;
    } else if (n.state === "lit") {
      n.brightness = 0.8;
    }
    n.heat = 0;
  }
  return { survived: keep.size, faded };
}

// ---------- Rendering (SVG) ----------

const svgNS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function render(g: GameState, svg: SVGSVGElement, onTap: (id: number) => void): void {
  svg.innerHTML = "";

  const defs = el("defs", {});
  defs.innerHTML = `
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="9" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="halo">
      <stop offset="0%" stop-color="#e8b34b" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#e8b34b" stop-opacity="0"/>
    </radialGradient>`;
  svg.appendChild(defs);

  // Edges
  for (const e of g.edges) {
    const a = g.nodes[e.a];
    const b = g.nodes[e.b];
    const litEdge =
      (a.state === "lit" || a.state === "awakened") &&
      (b.state === "lit" || b.state === "awakened");
    const visible = a.revealed && b.revealed;
    svg.appendChild(
      el("line", {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: litEdge ? "#e8b34b" : "#2a2f4a",
        "stroke-opacity": litEdge ? 0.7 : visible ? 0.5 : 0.14,
        "stroke-width": litEdge ? 2 : 1,
      })
    );
  }

  // Nodes
  for (const n of g.nodes) {
    const grp = el("g", { style: "cursor:pointer" });
    const isLit = n.state === "lit" || n.state === "awakened";

    if (isLit) {
      grp.appendChild(el("circle", { cx: n.x, cy: n.y, r: 46 * n.brightness + 14, fill: "url(#halo)" }));
    }

    let fill = "#3a4060";
    let r = 7;
    let opacity = n.revealed ? 0.9 : 0.22;

    if (n.kind === "keeper") {
      fill = "#9fc4e8";
      r = 9;
      // Keepers render featureless until lit nearby — coldly visible only when revealed
      opacity = n.revealed ? 0.95 : 0.1;
      grp.appendChild(
        el("rect", {
          x: n.x - r, y: n.y - r, width: r * 2, height: r * 2,
          fill, opacity, transform: `rotate(45 ${n.x} ${n.y})`,
        })
      );
    } else {
      if (n.state === "snuffed") {
        fill = "#12131f";
        // sealed: heavy blot with a cold rim
        grp.appendChild(el("circle", { cx: n.x, cy: n.y, r: 11, fill, stroke: "#46527a", "stroke-width": 1.5, opacity: 0.95 }));
      } else {
        if (isLit) {
          fill = n.state === "awakened" ? "#ffd87a" : "#e8b34b";
          r = n.state === "awakened" ? 10 : 8;
          opacity = 1;
        } else if (n.kind === "conduit") {
          fill = n.revealed ? "#5a5f86" : "#3a4060";
        } else if (n.kind === "shrine") {
          fill = n.revealed ? "#8a7aa8" : "#3a4060";
          opacity = Math.max(opacity, 0.35); // shrines faintly visible always
        }
        const c = el("circle", { cx: n.x, cy: n.y, r, fill, opacity });
        if (isLit) c.setAttribute("filter", "url(#glow)");
        grp.appendChild(c);
        if (n.state === "awakened") {
          grp.appendChild(el("circle", { cx: n.x, cy: n.y, r: 15, fill: "none", stroke: "#ffd87a", "stroke-width": 1.4, opacity: 0.85 }));
        }
      }
    }

    grp.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      onTap(n.id);
    });
    svg.appendChild(grp);
  }
}

// ---------- Game shell ----------

function start(): void {
  const { nodes, edges, adj } = generateCity();
  const g: GameState = {
    nodes, edges, adj,
    night: 1,
    maxFlame: START_FLAME,
    flame: START_FLAME,
    mode: "kindle",
    phase: "night",
    tick: 0,
  };

  // Initial faint reveal around shrines so the player has somewhere to begin
  for (const n of g.nodes) if (n.kind === "shrine") reveal(g, n.id, 1);

  const svg = document.getElementById("city") as unknown as SVGSVGElement;
  const flameEl = document.getElementById("flame")!;
  const nightEl = document.getElementById("night")!;
  const litEl = document.getElementById("litpct")!;
  const modeBtn = document.getElementById("mode") as HTMLButtonElement;
  const endBtn = document.getElementById("endnight") as HTMLButtonElement;
  const overlay = document.getElementById("overlay")!;
  const overlayTitle = document.getElementById("ov-title")!;
  const overlayBody = document.getElementById("ov-body")!;
  const overlayBtn = document.getElementById("ov-btn") as HTMLButtonElement;

  function hud(): void {
    flameEl.textContent = "✦".repeat(g.flame) + "·".repeat(Math.max(0, g.maxFlame - g.flame));
    nightEl.textContent = `Night ${g.night}`;
    const s = litStats(g);
    litEl.textContent = `${Math.round((s.lit / s.total) * 100)}% lit`;
    modeBtn.textContent = g.mode === "kindle" ? `Kindle (${KINDLE_COST}✦)` : `Awaken (${AWAKEN_COST}✦)`;
    modeBtn.className = g.mode;
  }

  function draw(): void {
    render(g, svg, onTap);
    hud();
  }

  function onTap(id: number): void {
    if (g.phase !== "night") return;
    const n = g.nodes[id];
    if (g.mode === "kindle") {
      if (g.flame < KINDLE_COST) return;
      if (kindle(g, id)) g.flame -= KINDLE_COST;
    } else {
      if (g.flame < AWAKEN_COST) return;
      if (n.kind === "dwelling" && (n.state === "dark" || n.state === "lit")) {
        n.state = "awakened";
        n.brightness = 1;
        reveal(g, id, 2);
        g.flame -= AWAKEN_COST;
      }
    }
    draw();
  }

  modeBtn.addEventListener("click", () => {
    g.mode = g.mode === "kindle" ? "awaken" : "kindle";
    hud();
  });

  function dawn(): void {
    g.phase = "dawn";
    const before = litStats(g);
    const { faded } = applyDawn(g);
    const after = litStats(g);
    g.maxFlame -= 1; // the carrier burns

    if (g.maxFlame <= 0) {
      g.phase = "end";
      overlayTitle.textContent = "The carrier is spent";
      overlayBody.textContent =
        after.lit > 0
          ? `Your flame is gone, but ${after.lit} lights still burn without you — ${Math.round((after.lit / after.total) * 100)}% of the city. That is the victory.`
          : `Your flame is gone, and the city is dark. Nothing you lit outlived you.`;
      overlayBtn.textContent = "Begin again";
      overlayBtn.onclick = () => location.reload();
    } else {
      overlayTitle.textContent = `Dawn, after night ${g.night}`;
      overlayBody.textContent =
        `${faded} unbanked lights faded with the dark. ${after.lit} survive, held by ${after.awakened} awakened souls. ` +
        `Your flame burns lower: ${g.maxFlame}✦ remain to you.`;
      overlayBtn.textContent = "Carry on";
      overlayBtn.onclick = () => {
        g.night += 1;
        g.flame = g.maxFlame;
        g.phase = "night";
        overlay.classList.add("hidden");
        draw();
      };
    }
    overlay.classList.remove("hidden");
    draw();
  }

  endBtn.addEventListener("click", dawn);

  setInterval(() => {
    if (g.phase !== "night") return;
    g.tick += 1;
    stepSpread(g);
    stepKeepers(g);
    draw();
  }, TICK_MS);

  draw();
}

start();
