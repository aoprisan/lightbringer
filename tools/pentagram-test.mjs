// Headless combat test for the Pentagram spinoff. No browser, no deps.
// Stubs just enough storage so pentagram.js loads, then drives the sim.
globalThis.__PG_TEST__ = true;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

await import("../pentagram.js");
const pg = globalThis.__pg;
const K = pg.K;
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok  -", msg); };

const still = { x: 0, y: 0 };
// Run the sim for `ms` total in fixed slices, with a given input vector.
function run(s, ms, move = still, slice = 16) {
  for (let t = 0; t < ms; t += slice) pg.stepCombat(s, slice, move);
}

// 1. Cities + arena generation
ok(Array.isArray(pg.LEVELS) && pg.LEVELS.length >= 3, `cities are defined (${pg.LEVELS.length})`);
ok(new Set(pg.LEVELS.map((l) => l.id)).size === pg.LEVELS.length, "city ids are unique");
ok(pg.levelById("old-city") && !pg.levelById("nope"), "levelById resolves known ids only");

const scenery = pg.generateCity(pg.levelById("old-city"));
ok(scenery.length > 80, `arena dresses the city (${scenery.length} nodes)`);
const posts = scenery.filter((n) => n.kind === "keeper");
ok(posts.length >= 4, `keeper-posts present (${posts.length})`);

// 2. A fresh descent raises a finite host = posts * SHADE_PER_KEEPER, hero centred
const s = pg.buildArena(pg.levelById("old-city"));
const livePosts = s.scenery.filter((n) => n.kind === "keeper").length;
ok(s.total === livePosts * K.SHADE_PER_KEEPER, `finite host = posts*${K.SHADE_PER_KEEPER} (${s.total})`);
ok(s.shades.length === s.total && s.total > 0, "every shade is rostered");
ok(s.hero.x === K.W / 2 && s.hero.y === K.H / 2, "hero starts at the city's heart");
ok(s.hero.hp === K.HERO_HP && s.phase === "fight", "hero begins at full health, fighting");
ok(pg.aliveShades(s) === s.total && pg.clearedPct(s) === 0, "all shades alive, nothing cleared yet");

// 3. The pentagram inscribes while still and burns a shade in its ring to death.
const s2 = pg.buildArena(pg.levelById("old-city"));
// Isolate one shade right beside the hero; park the rest far away and asleep.
const victim = s2.shades[0];
victim.x = s2.hero.x + 40; victim.y = s2.hero.y; victim.wakeAt = 0; victim.hp = K.SHADE_HP;
for (let i = 1; i < s2.shades.length; i++) {
  s2.shades[i].x = 5; s2.shades[i].y = 5; s2.shades[i].wakeAt = 1e9; // never wakes, far off
}
run(s2, K.PENTA_CHARGE_MS + 30, still); // inscribe fully
ok(s2.penta.charge > 0.9, `standing still inscribes the sigil (charge=${s2.penta.charge.toFixed(2)})`);
run(s2, K.PENTA_PULSE_MS * 4, still);   // let it pulse
ok(victim.dead, "the pentagram burns a shade in its ring to death");
ok(s2.kills === 1, "a kill is counted");

// 4. A shade outside the ring is untouched by the pulses.
const s3 = pg.buildArena(pg.levelById("old-city"));
const far = s3.shades[0];
far.x = s3.hero.x + K.PENTA_RADIUS + 60; far.y = s3.hero.y; far.wakeAt = 1e9; // out of range, asleep
const hpBefore = far.hp;
for (let i = 1; i < s3.shades.length; i++) s3.shades[i].wakeAt = 1e9;
run(s3, K.PENTA_PULSE_MS * 4, still);
ok(far.hp === hpBefore, "a shade beyond the ring takes no damage");

// 5. Moving decays the sigil.
const s4 = pg.buildArena(pg.levelById("old-city"));
for (const e of s4.shades) e.wakeAt = 1e9;
run(s4, K.PENTA_CHARGE_MS + 30, still);
const charged = s4.penta.charge;
run(s4, K.PENTA_CHARGE_MS, { x: 1, y: 0 }); // walk
ok(s4.penta.charge < charged, `moving lets the sigil fade (${charged.toFixed(2)} -> ${s4.penta.charge.toFixed(2)})`);

// 6. Clearing every shade wins the descent.
const s5 = pg.buildArena(pg.levelById("old-city"));
for (const e of s5.shades) { e.x = s5.hero.x; e.y = s5.hero.y; e.wakeAt = 0; e.hp = K.SHADE_HP; }
run(s5, K.PENTA_CHARGE_MS + K.PENTA_PULSE_MS * 12, still);
ok(s5.shades.every((e) => e.dead), "all shades fall when stacked on the sigil");
ok(s5.phase === "won", "clearing the host wins the descent");
ok(pg.clearedPct(s5) === 1, "cleared percentage reaches 100%");
// Once won, the sim is inert.
const kAfter = s5.kills;
pg.stepCombat(s5, 100, still);
ok(s5.kills === kAfter, "a won descent does not keep simulating");

// 7. Contact damage + i-frames; enough touches bring the hero down (lost).
const s6 = pg.buildArena(pg.levelById("old-city"));
// One shade glued to the hero; the pentagram can't save you if it can also touch you.
const biter = s6.shades[0];
biter.x = s6.hero.x; biter.y = s6.hero.y; biter.wakeAt = 0; biter.hp = 1e9; // unkillable, for the test
for (let i = 1; i < s6.shades.length; i++) s6.shades[i].wakeAt = 1e9;
pg.stepCombat(s6, 16, still);
const hp1 = s6.hero.hp;
ok(hp1 < K.HERO_HP, `a shade in contact bites the hero (${K.HERO_HP} -> ${hp1})`);
ok(s6.hero.hurt > 0, "a blow sets i-frames");
// i-frames spare an immediate second blow.
biter.x = s6.hero.x; biter.y = s6.hero.y; // re-glue after knockback
pg.stepCombat(s6, 16, still);
ok(s6.hero.hp === hp1, "i-frames spare the hero an immediate second blow");
// Hammer it long enough and the hero falls.
biter.x = s6.hero.x; biter.y = s6.hero.y;
run(s6, K.HERO_IFRAMES_MS * (K.HERO_HP / K.SHADE_CONTACT_DMG + 4), still, 8);
ok(s6.phase === "lost", "enough blows bring the hero down");

// 8. Shades chase the hero (a woken shade closes the distance).
const s7 = pg.buildArena(pg.levelById("old-city"));
for (const e of s7.shades) e.wakeAt = 1e9;
const chaser = s7.shades[0];
chaser.wakeAt = 0;
chaser.x = s7.hero.x + 400; chaser.y = s7.hero.y;
const d0 = Math.hypot(chaser.x - s7.hero.x, chaser.y - s7.hero.y);
run(s7, 500, still); // hero stands; chaser should close in
const d1 = Math.hypot(chaser.x - s7.hero.x, chaser.y - s7.hero.y);
ok(d1 < d0, `a woken shade closes on the hero (${d0 | 0} -> ${d1 | 0})`);

// 9. Solid structures block the hero — walking into one never passes through.
const s8 = pg.buildArena(pg.levelById("old-city"));
for (const e of s8.shades) e.wakeAt = 1e9; // no swarm to jostle the hero
ok(s8.solids.length > 0, `the city has solid structures (${s8.solids.length})`);
const wall = s8.solids[0];
const wr = K.OBSTACLE_RADIUS[wall.kind];
s8.hero.x = wall.x - (K.HERO_RADIUS + wr + 30); // just outside, to its left
s8.hero.y = wall.y;
run(s8, 1000, { x: 1, y: 0 }); // shove straight into it for a second
const dWall = Math.hypot(s8.hero.x - wall.x, s8.hero.y - wall.y);
ok(dWall >= K.HERO_RADIUS + wr - 1, `the hero is stopped at a solid's edge (d=${dWall | 0} >= ${K.HERO_RADIUS + wr})`);

// 10. A dark dwelling caught in the charged ring lights and mends the hero.
const s9 = pg.buildArena(pg.levelById("old-city"));
for (const e of s9.shades) e.wakeAt = 1e9;
s9.solids = []; // isolate: nothing nudges the hero off its mark
// Light only the one dwelling we place; pre-light the rest so they don't fire.
const home = s9.scenery.find((n) => n.kind === "dwelling");
for (const n of s9.scenery) if (n.kind === "dwelling" && n !== home) n.lit = true;
home.lit = false; home.x = s9.hero.x + 30; home.y = s9.hero.y;
s9.hero.hp = 40; // wounded, so the mend is visible
run(s9, K.PENTA_CHARGE_MS + K.PENTA_PULSE_MS * 2, still);
ok(home.lit === true, "a dark dwelling in the ring kindles alight");
ok(s9.litCount === 1, "lighting a dwelling counts toward the relit tally");
ok(s9.hero.hp === 40 + K.DWELLING_HEAL, `lighting a dwelling mends the hero (40 -> ${s9.hero.hp})`);

// 12. Fences are walls — the hero cannot pass through one.
const sf = pg.buildArena(pg.levelById("old-city"));
for (const e of sf.shades) e.wakeAt = 1e9; // no swarm to jostle the hero
ok(sf.fences.length > 0, `the city is strung with fences (${sf.fences.length})`);
sf.solids = []; sf.pathways = []; // isolate the fence; no boost to muddy the math
const fen = sf.fences[0];
const fmx = (fen.x1 + fen.x2) / 2, fmy = (fen.y1 + fen.y2) / 2;     // midpoint
const fdx = fen.x2 - fen.x1, fdy = fen.y2 - fen.y1, fl = Math.hypot(fdx, fdy) || 1;
const nx = -fdy / fl, ny = fdx / fl;                               // unit normal
sf.hero.x = fmx + nx * (K.HERO_RADIUS + K.FENCE_HALF + 40);        // just off one side
sf.hero.y = fmy + ny * (K.HERO_RADIUS + K.FENCE_HALF + 40);
run(sf, 1200, { x: -nx, y: -ny });                                 // shove into the fence
const fcd = pg.closestOnSegment(sf.hero.x, sf.hero.y, fen.x1, fen.y1, fen.x2, fen.y2).d;
ok(fcd >= K.HERO_RADIUS + K.FENCE_HALF - 1, `the hero is stopped at a fence (d=${fcd | 0} >= ${K.HERO_RADIUS + K.FENCE_HALF})`);

// 13. Pathways are lanes — the hero runs faster while travelling one.
const sp = pg.buildArena(pg.levelById("old-city"));
for (const e of sp.shades) e.wakeAt = 1e9;
ok(sp.pathways.length > 0, `the city is laced with pathways (${sp.pathways.length})`);
sp.solids = []; sp.fences = []; sp.pathways = []; // baseline: no lane under the hero
sp.hero.x = 100; sp.hero.y = 100;
const baseX = sp.hero.x;
run(sp, 500, { x: 1, y: 0 });
const baseDist = sp.hero.x - baseX;
// Same walk, but with a straight lane laid under the hero's path.
const sp2 = pg.buildArena(pg.levelById("old-city"));
for (const e of sp2.shades) e.wakeAt = 1e9;
sp2.solids = []; sp2.fences = [];
sp2.pathways = [{ x1: 80, y1: 100, x2: 900, y2: 100 }];
sp2.hero.x = 100; sp2.hero.y = 100;
const pathX = sp2.hero.x;
run(sp2, 500, { x: 1, y: 0 });
const pathDist = sp2.hero.x - pathX;
ok(pathDist > baseDist + 1, `the hero runs faster on a pathway (${baseDist | 0} -> ${pathDist | 0})`);

// 11. Legacy: clears and deaths fold into a private key, best time never worsens.
store.delete("pentagram.legacy.v1");
ok(pg.loadPgLegacy().runs === 0, "an untouched legacy starts empty");
const lv = pg.levelById("old-city");
const l1 = pg.recordClear(lv, 5000, 4);
ok(l1.runs === 1 && l1.clears === 1 && l1.best["old-city"] === 5000, "recordClear folds a cleansing");
ok(l1.dwellingsLit === 4, "recordClear folds dwellings relit");
const l2 = pg.recordClear(lv, 8000);
ok(l2.best["old-city"] === 5000, "a slower clear cannot worsen the best");
const l3 = pg.recordClear(lv, 3000);
ok(l3.best["old-city"] === 3000, "a faster clear sets a new best");
const l4 = pg.recordDeath(2);
ok(l4.runs === 4 && l4.clears === 3, "a death bumps runs but not clears");
ok(l4.dwellingsLit === 6, "a death still folds dwellings relit (4 + 2)");
ok(pg.loadPgLegacy().best["old-city"] === 3000, "the legacy persists to storage");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
