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

// 16. Cities (levels): hand-tuned maps that reroll generation + economy under
// the same rules. The default freshGame() is The Old City; other ids reshape
// the map and round-trip through the save.
ok(Array.isArray(lb.LEVELS) && lb.LEVELS.length >= 3, `cities are defined (${lb.LEVELS.length})`);
ok(new Set(lb.LEVELS.map((l) => l.id)).size === lb.LEVELS.length, "city ids are unique");
ok(lb.LEVELS.every((l) => l.districts.length === 5), "every city has five quarters");
ok(lb.levelById("old-city") && !lb.levelById("nope"), "levelById resolves known ids only");

const gOld = lb.freshGame();
ok(gOld.level && gOld.level.id === "old-city", "freshGame() defaults to The Old City");
ok(gOld.flame === gOld.level.startFlame, "a city's start flame seeds the night");

// A distinct city reshapes the board: its own start flame, quarter names, and
// (for a tinder city like Ashfold) a more conductive, more pressed map.
const ash = lb.levelById("ashfold");
const gAsh = lb.freshGame(ash);
ok(gAsh.level.id === "ashfold", "freshGame(level) walks the chosen city");
ok(gAsh.flame === ash.startFlame, `the chosen city's flame seeds the night (${gAsh.flame})`);
ok(lb.districtStats(gAsh).every((d, i) => d.name === ash.districts[i].name),
  "districtStats reads the chosen city's quarters");
const ashKinds = {};
for (const n of gAsh.nodes) ashKinds[n.kind] = (ashKinds[n.kind] || 0) + 1;
ok(ashKinds.press >= 1 && ashKinds.keeper >= 1, "the chosen city seeds presses and keepers");

// The keeper radius helper honours the city's base reach.
const gw = lb.freshGame(lb.levelById("glassworks"));
const kw = gw.nodes.find((n) => n.kind === "keeper");
const reach = lb.keeperRadius(gw, kw);
ok(reach <= gw.level.keeperRadius * 1.001, `a keeper's reach starts at its city's base (${reach | 0})`);

// The city id round-trips through the save, rebuilding its quarters on load.
lb.saveGame(gAsh);
const reAsh = lb.loadGame();
ok(reAsh && reAsh.g.level.id === "ashfold", "the city id round-trips through the save");
ok(reAsh.g.level.districts[0].name === ash.districts[0].name, "load rebuilds the city's quarters");

// Weather temperament: night 1 is still in any city; later nights respect the sky.
ok(lb.rollWeather(1, ash).kind === "still", "night 1 is still in any city");
const drown = lb.levelById("drowned");
ok(["still", "wind", "rain"].includes(lb.rollWeather(5, drown).kind), "a city rolls a valid sky");

// 17. Terrain: barriers reshape the map. A canal damps the fire that crosses it;
// a wall damps it harder AND severs the dawn's flood-fill and the avatar's path.
const tNodes = [
  { x: 100, y: 100 }, { x: 300, y: 100 }, // a pair straddling x=200
].map((p, id) => ({ id, x: p.x, y: p.y, kind: "dwelling" }));
const plainCity = lb.finalizeCity(tNodes.map((n) => ({ ...n })), []);
const canalCity = lb.finalizeCity(tNodes.map((n) => ({ ...n })), [{ x1: 200, y1: 0, x2: 200, y2: 400 }]);
const wallCity = lb.finalizeCity(tNodes.map((n) => ({ ...n })), [{ x1: 200, y1: 0, x2: 200, y2: 400, wall: true }]);
ok(canalCity.edges[0].conductivity < plainCity.edges[0].conductivity, "a canal damps the fire that crosses it");
ok(wallCity.edges[0].conductivity < canalCity.edges[0].conductivity, "a wall damps it harder than a canal");

// segIntersect / closestOnSegment sanity
ok(lb.segIntersect(0, 0, 10, 0, 5, -5, 5, 5), "segIntersect: crossing segments cross");
ok(!lb.segIntersect(0, 0, 10, 0, 0, 5, 10, 5), "segIntersect: parallel segments do not");
ok(Math.abs(lb.closestOnSegment(5, 5, 0, 0, 10, 0).d - 5) < 1e-9, "closestOnSegment finds the perpendicular foot");

// wallBetween reads the run's walls: true across a wall, false across a canal.
const gWall = lb.freshGame(lb.levelById("glassworks"));
ok(gWall.barriers.length > 0 && gWall.barriers.some((b) => b.wall), "the walled city carries its walls");
const aw = { x: 470, y: 400 }, bw = { x: 560, y: 400 }; // straddle the Glassworks wall near x~500
gWall.nodes[0].x = aw.x; gWall.nodes[0].y = aw.y;
gWall.nodes[1].x = bw.x; gWall.nodes[1].y = bw.y;
ok(lb.wallBetween(gWall, 0, 1), "wallBetween is true across a wall");
const gCanal = lb.freshGame(lb.levelById("drowned"));
ok(gCanal.barriers.length > 0 && gCanal.barriers.every((b) => !b.wall), "the drowned city carries only canals");
gCanal.nodes[0].x = 100; gCanal.nodes[0].y = 540;
gCanal.nodes[1].x = 100; gCanal.nodes[1].y = 640; // straddle a canal — but it is no wall
ok(!lb.wallBetween(gCanal, 0, 1), "wallBetween is false across a canal");

// The core proof: a node lit behind a wall, with no awakened soul on its side,
// fades at dawn — while the identical geometry without the wall survives.
function dawnAcross(barriers) {
  const nodes = [{ id: 0, x: 100, y: 400 }, { id: 1, x: 300, y: 400 }].map((p) => ({
    id: p.id, x: p.x, y: p.y, px: p.x, py: p.y, kind: "dwelling",
    state: "dark", brightness: 0, revealed: true, heat: 0, veil: 0, decoy: 0, nights: 0, district: 0,
  }));
  const city = lb.finalizeCity(nodes, barriers);
  const g = { ...lb.freshGame(), nodes: city.nodes, edges: city.edges, adj: city.adj, barriers };
  lb.awaken(g, 0);          // a soul on the LEFT only
  lb.kindle(g, 1);          // a bare light on the RIGHT
  lb.applyDawn(g);
  return g.nodes[1].state;  // does the right-hand light survive?
}
ok(dawnAcross([]) === "lit", "without a wall, a connected light survives the dawn");
ok(dawnAcross([{ x1: 200, y1: 0, x2: 200, y2: 800, wall: true }]) === "dark", "a wall severs the dawn — the far light fades");

// pushOut shoves a body off a wall, and is a no-op away from one.
const gp = lb.freshGame(lb.levelById("glassworks"));
const onWall = lb.pushOut(gp, 500, 400, 14); // near the Glassworks wall at x~500..540
ok(Math.hypot(onWall.x - 500, onWall.y - 400) > 0, "pushOut moves a body off a wall");
const gpClear = lb.freshGame(); // The Old City has no barriers
const clear = lb.pushOut(gpClear, 500, 400, 14);
ok(clear.x === 500 && clear.y === 400, "pushOut is a no-op where there are no walls");

// 18. Perks: a meta-layer that bends the carrier's dials, resolved via perkMods.
const gBare = lb.freshGame();
const baseMods = lb.perkMods(gBare);
ok(baseMods.startFlameBonus === 0 && baseMods.keeperRadiusMul === 1, "a bare flame resolves to default dials");
gBare.perk = "dim-watch";
ok(lb.perkMods(gBare).keeperRadiusMul < 1 && lb.perkMods(gBare).startFlameBonus < 0, "a tradeoff perk applies both its plus and its minus");

// deep-lungs raises the flame a night begins with.
const ash18 = lb.levelById("ashfold");
const plainFlame = lb.freshGame(ash18, "").maxFlame;
ok(lb.freshGame(ash18, "deep-lungs").maxFlame === plainFlame + 2, "deep-lungs swells the starting flame");

// dim-watch shrinks the keeper's sensed ring.
const gDim = lb.freshGame(lb.levelById("glassworks"), "dim-watch");
const gNorm = lb.freshGame(lb.levelById("glassworks"), "");
const kd = gDim.nodes.find((n) => n.kind === "keeper");
const kn = gNorm.nodes.find((n) => n.kind === "keeper");
ok(lb.keeperRadius(gDim, kd) < lb.keeperRadius(gNorm, kn) * 1.001, "dim-watch quiets the watch's reach");

// 19. Embers: recordRun banks a capped amount and persists it; perks buy from it.
store.delete("lightbringer.legacy.v1");
const gE = lb.freshGame();
gE.night = 3;
const aE = gE.nodes.find((n) => n.kind === "dwelling" && n.state === "dark");
lb.awaken(gE, aE.id);
const rE = lb.recordRun(gE);
ok(typeof rE.earned === "number" && rE.earned > 0, `recordRun banks embers (${rE.earned})`);
ok(rE.earned <= 12, "embers are capped per run");
ok(lb.loadLegacy().embers === rE.earned, "the embers persist to the legacy");

// saveLegacy round-trips ownership and the equipped perk.
const lg = lb.loadLegacy();
lg.embers = 50; lg.perksOwned = ["deep-lungs"]; lg.perkEquipped = "deep-lungs";
lb.saveLegacy(lg);
const lg2 = lb.loadLegacy();
ok(lg2.embers === 50 && lg2.perksOwned.includes("deep-lungs") && lg2.perkEquipped === "deep-lungs", "saveLegacy round-trips embers and owned perks");
// loadGame re-derives the equipped perk from the legacy (no save bump).
const gPk = lb.freshGame();
lb.saveGame(gPk);
ok(lb.loadGame().g.perk === "deep-lungs", "loadGame re-derives the equipped perk from the legacy");
// an unowned equipped id is rejected on load (defends against tampering).
const lg3 = lb.loadLegacy(); lg3.perkEquipped = "not-a-perk"; lb.saveLegacy(lg3);
ok(lb.loadLegacy().perkEquipped === "", "an unowned/unknown equipped perk falls back to bare flame");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
