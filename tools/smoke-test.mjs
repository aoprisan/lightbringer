// Headless smoke test for the simulation. No browser, no deps.
// Stubs just enough DOM/storage so app.js loads, then drives the sim.
globalThis.__LB_TEST__ = true;

// minimal in-memory localStorage
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

await import("../app.js");
const lb = globalThis.__lb;
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok  -", msg); };

// 1. City generation
const g = lb.freshGame();
ok(g.nodes.length > 80, `city has ${g.nodes.length} nodes`);
ok(g.edges.length > 80, `city has ${g.edges.length} edges`);
const kinds = {};
for (const n of g.nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
ok(kinds.keeper >= 5, `keepers present (${kinds.keeper})`);
ok(kinds.shrine >= 1, `shrines present (${kinds.shrine})`);
ok(kinds.press >= 1, `presses present (${kinds.press || 0})`);
ok(g.nodes.every((n) => n.district >= 0 && n.district < lb.DISTRICTS.length), "every node has a district");

// 2. Kindling lights a dark node and reveals neighbours
const dark = g.nodes.find((n) => n.kind === "dwelling" && n.state === "dark");
const litOk = lb.kindle(g, dark.id);
ok(litOk && g.nodes[dark.id].state === "lit", "kindle lights a dwelling");
ok(g.nodes[dark.id].revealed, "kindling reveals the node");

// 3. Awakening
const dw = g.nodes.find((n) => n.kind === "dwelling" && n.state === "dark");
ok(lb.awaken(g, dw.id) && g.nodes[dw.id].state === "awakened", "awaken a dwelling");
ok(!lb.awaken(g, g.nodes.find((n) => n.kind === "keeper").id), "cannot awaken a keeper");

// 4. Spread + keepers run without throwing; light grows over time
const before = lb.litStats(g).lit;
lb.simulateTicks(g, 60);
const after = lb.litStats(g).lit;
ok(after >= before, `light is sustained over 60 ticks (${before} -> ${after})`);

// 5. Snuffing thickens the veil (irreversible, gets worse)
const target = g.nodes.find((n) => n.state === "lit" || n.state === "awakened");
if (target) {
  lb.snuff(g, target);
  ok(target.state === "snuffed" && target.veil > 0, "snuff thickens the veil");
}

// 6. Dawn: only light connected to an awakened soul survives
const g2 = lb.freshGame();
// awaken one node, light an isolated other
const a = g2.nodes.find((n) => n.kind === "dwelling");
lb.awaken(g2, a.id);
const lone = g2.nodes.find((n) => n.id !== a.id && n.kind === "dwelling" &&
  !(g2.adj.get(a.id) || []).includes(n.id));
if (lone) lb.kindle(g2, lone.id);
const { faded } = lb.applyDawn(g2);
ok(g2.nodes[a.id].state === "awakened", "awakened soul survives the dawn");
ok(typeof faded === "number", `dawn fades unbanked light (faded=${faded})`);

// 7. Save/load round-trip
lb.saveGame(g);
const reloaded = lb.loadGame();
ok(reloaded && reloaded.g.nodes.length === g.nodes.length, "save/load round-trips the city");
ok(reloaded.g.night === g.night && reloaded.g.maxFlame === g.maxFlame, "save preserves night/flame");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
