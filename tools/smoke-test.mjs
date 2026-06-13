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
ok(reloaded.g.nodes.every((n) => typeof n.px === "number" && typeof n.py === "number"),
  "patrol positions survive the save");

// 7b. Weather round-trips through the save
g.weather = { kind: "wind", wx: 0, wy: 1 };
lb.saveGame(g);
const rew = lb.loadGame();
ok(rew.g.weather.kind === "wind" && rew.g.weather.wy === 1, "save round-trips the weather");
const rolled = lb.rollWeather(5);
ok(["still", "wind", "rain"].includes(rolled.kind), `weather rolls a valid sky (${rolled.kind})`);
ok(lb.rollWeather(1).kind === "still", "night 1 is always still");

// 8. Awakened souls are beacons: a Keeper hunts them before brighter lit ground.
// Place an awakened soul and a lit node on top of a Keeper; only the soul should fall.
const g3 = lb.freshGame();
const keeper3 = g3.nodes.find((n) => n.kind === "keeper");
const beacon = g3.nodes.find((n) => n.kind === "dwelling" && n.state === "dark");
const plain = g3.nodes.find((n) => n.kind === "dwelling" && n.state === "dark" && n.id !== beacon.id);
beacon.x = keeper3.x + 8; beacon.y = keeper3.y + 8;
plain.x = keeper3.x - 8; plain.y = keeper3.y - 8;
lb.awaken(g3, beacon.id);
lb.kindle(g3, plain.id);
g3.nodes[plain.id].brightness = 1; // at least as bright as the beacon
g3.tick = 0;                       // 0 % KEEPER_SNUFF_EVERY === 0 -> Keepers act
lb.stepKeepers(g3);
ok(g3.nodes[beacon.id].state === "snuffed", "Keeper snuffs the awakened beacon first");
ok(g3.nodes[plain.id].state === "lit", "the equally-bright lit node is spared that cycle");
ok(g3.lostSoul === true, "losing an awakened soul raises the lostSoul flag");

// 8b. Keepers patrol: one that sees light leaves its post and closes on it,
// but snuffs nothing until it is within reach.
const g7 = lb.freshGame();
const k7 = g7.nodes.find((n) => n.kind === "keeper");
const prey = g7.nodes.find((n) => n.kind === "dwelling" && n.state === "dark");
prey.x = k7.x + 150; prey.y = k7.y; // seen (within 220) but out of snuff reach
lb.kindle(g7, prey.id);
g7.tick = 3; // a snuff tick — distance alone must spare the prey
lb.stepKeepers(g7);
ok(k7.px > k7.x, `a Keeper leaves its post toward the light (drifted ${(k7.px - k7.x) | 0})`);
ok(prey.state === "lit", "but snuffs nothing it has not reached");

// 9. A Keeper's patrol reach widens as veil thickens around it
const g4 = lb.freshGame();
const keeper4 = g4.nodes.find((n) => n.kind === "keeper");
const base = lb.keeperRadius(g4, keeper4);
for (const n of g4.nodes) {
  if ((n.x - keeper4.x) ** 2 + (n.y - keeper4.y) ** 2 < 180 ** 2) n.veil = 3;
}
const widened = lb.keeperRadius(g4, keeper4);
ok(widened > base, `keeper radius widens with veil (${base | 0} -> ${widened | 0})`);

// 10. A kindled press fires its whole carrier line at once
const g5 = lb.freshGame();
const press = g5.nodes.find((n) => n.kind === "press");
const carrier = (g5.adj.get(press.id) || [])
  .map((i) => g5.nodes[i])
  .find((n) => n.kind !== "keeper" && n.state === "dark");
carrier.kind = "conduit";
carrier.veil = 0;
lb.kindle(g5, press.id);
ok(carrier.state === "lit", "a kindled press fires its carrier line in one breath");

// 11. stepCity is one breath: it advances the tick by exactly one and runs the
// same sim the turn-based shell drives per action.
const g6 = lb.freshGame();
const beforeTick = g6.tick;
lb.stepCity(g6);
ok(g6.tick === beforeTick + 1, `stepCity advances exactly one breath (${beforeTick} -> ${g6.tick})`);
const tenBefore = g6.tick;
lb.simulateTicks(g6, 10);
ok(g6.tick === tenBefore + 10, "simulateTicks runs ten breaths of stepCity");

// 12. Decoys: a false light, transient and scar-free, that bends the watch.
const gd = lb.freshGame();
const darkDwell = gd.nodes.find((n) => n.kind === "dwelling" && n.state === "dark");
ok(lb.placeDecoy(gd, darkDwell.id) && darkDwell.decoy > 0, "placeDecoy lays a false light on dark ground");
ok(!lb.placeDecoy(gd, darkDwell.id), "cannot stack a second decoy on the same ground");
ok(!lb.placeDecoy(gd, gd.nodes.find((n) => n.kind === "keeper").id), "cannot lay a decoy on a Keeper");
const toLight = gd.nodes.find((n) => n.kind === "dwelling" && n.state === "dark" && n.id !== darkDwell.id);
lb.kindle(gd, toLight.id);
ok(!lb.placeDecoy(gd, toLight.id), "cannot lay a decoy on a real light");

// A Keeper breaks for a reachable decoy and searches it, leaving no scar.
const gk = lb.freshGame();
const keep = gk.nodes.find((n) => n.kind === "keeper");
let near = null, nd = Infinity; // the dark ground nearest this Keeper's post — within its sight
for (const n of gk.nodes) {
  if (n.kind === "keeper" || n.state !== "dark") continue;
  const d2 = (n.x - keep.x) ** 2 + (n.y - keep.y) ** 2;
  if (d2 < nd) { nd = d2; near = n; }
}
lb.placeDecoy(gk, near.id);
for (let i = 0; i < 40 && near.decoy > 0; i++) lb.stepCity(gk);
ok(near.decoy === 0, "a Keeper reaches and spends the false light");
ok(near.veil === 0, "the searched decoy leaves no scar in the Veil");
ok(gk.decoySpent, "spending a decoy raises the decoySpent flag");

// 13. Hearths: a soul that holds through enough dawns settles and feeds the flame.
const gh = lb.freshGame();
const soul = gh.nodes.find((n) => n.kind === "dwelling" && n.state === "dark");
lb.awaken(gh, soul.id);
ok(!lb.isHearth(soul), "a freshly awakened soul is not yet a hearth");
for (let i = 0; i < 3; i++) lb.applyDawn(gh); // HEARTH_NIGHTS dawns held
ok(soul.nights >= 3, `holding through dawns ages the soul (nights=${soul.nights})`);
ok(lb.isHearth(soul), "a soul that holds enough dawns settles into a hearth");
ok(lb.litStats(gh).hearths >= 1, "litStats counts the hearth");
// the hearth's age survives a save/load round-trip
lb.saveGame(gh);
const ghReload = lb.loadGame();
const soul2 = ghReload.g.nodes[soul.id];
ok(soul2.nights === soul.nights && lb.isHearth(soul2), "a hearth's age round-trips through the save");
// snuffing a hearth ends its age
lb.snuff(gh, soul);
ok(soul.nights === 0 && !lb.isHearth(soul), "snuffing a settled soul ends its hearth-age");

// 14. Action mode: a Keeper hunts the carrier itself, and a blow within reach
// drains flame. All avatar behaviour is gated on g.player, so every assertion
// above ran with no avatar and is unaffected.
const ga = lb.freshGame();
const ka = ga.nodes.find((n) => n.kind === "keeper");
ga.player = { x: ka.x + 150, y: ka.y, vx: 0, vy: 0, hurt: 0 }; // seen, out of reach
ga.tick = 1; // not a snuff tick — distance alone must spare the carrier
const flameBefore = ga.flame;
lb.stepKeepers(ga);
ok(ka.px > ka.x, `a Keeper leaves its post to hunt the carrier (drifted ${(ka.px - ka.x) | 0})`);
ok(ga.flame === flameBefore, "but spends no flame until it reaches the carrier");
// Now stand the carrier on the Keeper's hand on a snuff tick: a blow lands.
const gb = lb.freshGame();
const kb = gb.nodes.find((n) => n.kind === "keeper");
gb.player = { x: kb.x, y: kb.y, vx: 0, vy: 0, hurt: 0 };
gb.tick = 0; // a snuff tick
const hp = gb.flame;
lb.stepKeepers(gb);
ok(gb.flame === hp - 1, `a Keeper within reach drains the carrier's flame (${hp} -> ${gb.flame})`);
ok(gb.player.hurt > 0 && gb.playerHit === true, "a blow sets i-frames and the playerHit flag");
// i-frames spare a second blow on the very next snuff tick.
const hp2 = gb.flame;
gb.tick = 0;
lb.stepKeepers(gb);
ok(gb.flame === hp2, "i-frames spare the carrier a second immediate blow");

// 15. Legacy: a cross-run record kept apart from the save, folded in once per
// run and never below a previous best.
store.delete("lightbringer.legacy.v1");
ok(lb.loadLegacy().runs === 0, "an untouched legacy starts empty");
const gl = lb.freshGame();
gl.night = 4;
const a4 = gl.nodes.find((n) => n.kind === "dwelling" && n.state === "dark");
lb.awaken(gl, a4.id);
const r1 = lb.recordRun(gl);
ok(r1.legacy.runs === 1 && r1.legacy.bestNight === 4, "recordRun folds a run into the legacy");
ok(r1.beat.night === true, "a first run beats the (empty) night record");
ok(lb.loadLegacy().bestNight === 4, "the legacy persists to storage");
// A shallower run bumps the run count but never lowers a best.
const gl2 = lb.freshGame();
gl2.night = 2;
const r2 = lb.recordRun(gl2);
ok(r2.legacy.runs === 2 && r2.legacy.bestNight === 4, "a shallower run cannot lower a best");
ok(r2.beat.night === false, "and does not claim the night best");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
