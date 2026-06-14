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
const LEGACY_KEY = "pentagram.legacy.v1";
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok  -", msg); };

const still = { x: 0, y: 0 };
// Run the sim for `ms` total in fixed slices, with a given input vector.
function run(s, ms, move = still, slice = 16) {
  for (let t = 0; t < ms; t += slice) pg.stepCombat(s, slice, move);
}
// Park a shade asleep at a spot (its home too, so it won't wander off): used to
// isolate one shade by stowing the rest far from the hero, out of aggro range.
const park = (e, x, y) => { e.state = "wander"; e.x = x; e.y = y; e.homeX = x; e.homeY = y; };
// Rouse a shade to chase immediately (replaces the old wakeAt = 0).
const wake = (e) => { e.state = "chase"; };

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
ok(s.hero.x === s.w / 2 && s.hero.y === s.h / 2, "hero starts at the city's heart");
ok(s.hero.hp === K.HERO_HP && s.phase === "fight", "hero begins at full health, fighting");
ok(pg.aliveShades(s) === s.total && pg.clearedPct(s) === 0, "all shades alive, nothing cleared yet");
ok(s.shades.every((e) => e.state === "wander"), "the host begins lurking (wandering), not rushing");

// 3. The pentagram inscribes while still and burns a shade in its ring to death.
const s2 = pg.buildArena(pg.levelById("old-city"));
// Isolate one shade right beside the hero; park the rest far away and asleep.
const victim = s2.shades[0];
victim.x = s2.hero.x + 40; victim.y = s2.hero.y; wake(victim); victim.hp = K.SHADE_HP;
for (let i = 1; i < s2.shades.length; i++) park(s2.shades[i], 5, 5);
run(s2, K.PENTA_CHARGE_MS + 30, still); // inscribe fully
ok(s2.penta.charge > 0.9, `standing still inscribes the sigil (charge=${s2.penta.charge.toFixed(2)})`);
run(s2, K.PENTA_PULSE_MS * 4, still);   // let it pulse
ok(victim.dead, "the pentagram burns a shade in its ring to death");
ok(s2.kills === 1, "a kill is counted");

// 4. A shade beyond the ring (and beyond aggro) is untouched by the pulses.
const s3 = pg.buildArena(pg.levelById("old-city"));
const far = s3.shades[0];
park(far, s3.hero.x + K.AGGRO_RADIUS + 60, s3.hero.y); // out of ring and aggro, asleep
const hpBefore = far.hp;
for (let i = 1; i < s3.shades.length; i++) park(s3.shades[i], 5, 5);
run(s3, K.PENTA_PULSE_MS * 4, still);
ok(far.hp === hpBefore, "a shade beyond the ring takes no damage");
ok(far.state === "wander", "a shade beyond aggro range stays lurking");

// 5. Moving decays the sigil.
const s4 = pg.buildArena(pg.levelById("old-city"));
for (const e of s4.shades) park(e, 5, 5);
run(s4, K.PENTA_CHARGE_MS + 30, still);
const charged = s4.penta.charge;
run(s4, K.PENTA_CHARGE_MS, { x: 1, y: 0 }); // walk
ok(s4.penta.charge < charged, `moving lets the sigil fade (${charged.toFixed(2)} -> ${s4.penta.charge.toFixed(2)})`);

// 6. Clearing every shade wins the descent.
const s5 = pg.buildArena(pg.levelById("old-city"));
for (const e of s5.shades) { e.x = s5.hero.x; e.y = s5.hero.y; wake(e); e.hp = K.SHADE_HP; }
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
biter.x = s6.hero.x; biter.y = s6.hero.y; wake(biter); biter.hp = 1e9; // unkillable, for the test
for (let i = 1; i < s6.shades.length; i++) park(s6.shades[i], 5, 5);
pg.stepCombat(s6, 16, still);
const hp1 = s6.hero.hp;
ok(hp1 < K.HERO_HP, `a shade in contact bites the hero (${K.HERO_HP} -> ${hp1})`);
ok(s6.hero.hurt > 0, "a blow sets i-frames");
ok(s6.hits === 1, "a landed blow is counted (for the flawless bonus)");
// i-frames spare an immediate second blow.
biter.x = s6.hero.x; biter.y = s6.hero.y; // re-glue after knockback
pg.stepCombat(s6, 16, still);
ok(s6.hero.hp === hp1, "i-frames spare the hero an immediate second blow");
// Hammer it long enough and the hero falls.
biter.x = s6.hero.x; biter.y = s6.hero.y;
run(s6, K.HERO_IFRAMES_MS * (K.HERO_HP / K.SHADE_CONTACT_DMG + 4), still, 8);
ok(s6.phase === "lost", "enough blows bring the hero down");

// 8. Shades chase the hero (a roused shade closes the distance).
const s7 = pg.buildArena(pg.levelById("old-city"));
for (const e of s7.shades) park(e, 5, 5);
const chaser = s7.shades[0];
chaser.x = s7.hero.x + 400; chaser.y = s7.hero.y; wake(chaser);
const d0 = Math.hypot(chaser.x - s7.hero.x, chaser.y - s7.hero.y);
run(s7, 500, still); // hero stands; chaser should close in
const d1 = Math.hypot(chaser.x - s7.hero.x, chaser.y - s7.hero.y);
ok(d1 < d0, `a roused shade closes on the hero (${d0 | 0} -> ${d1 | 0})`);

// 8b. Aggro is proximity-driven and sticky.
const sa = pg.buildArena(pg.levelById("old-city"));
for (const e of sa.shades) park(e, 5, 5);
const near = sa.shades[0], outside = sa.shades[1];
park(near, sa.hero.x + K.AGGRO_RADIUS - 40, sa.hero.y);    // just inside aggro
park(outside, sa.hero.x + K.AGGRO_RADIUS + 80, sa.hero.y); // just outside aggro
run(sa, 400, still);
ok(near.state === "chase", "a wanderer within aggro range rouses to chase");
ok(outside.state === "wander", "a wanderer beyond aggro range keeps lurking");
// Now flee far: the roused one must not settle back.
sa.hero.x = 50; sa.hero.y = 50;
run(sa, 400, still);
ok(near.state === "chase", "aggro is sticky — a roused shade never settles back");

// 8c. A wanderer caught in the ring still burns (no wake gate) and is roused.
const sh = pg.buildArena(pg.levelById("old-city"));
for (const e of sh.shades) park(e, 5, 5);
const lurker = sh.shades[0];
park(lurker, sh.hero.x + 40, sh.hero.y); // inside the ring, but starts wandering
run(sh, K.PENTA_CHARGE_MS + K.PENTA_PULSE_MS * 4, still);
ok(lurker.dead, "a lurking shade in the ring burns just like a chaser");

// 8d. A wanderer is kept near its post by the leash.
const sl = pg.buildArena(pg.levelById("old-city"));
for (const e of sl.shades) park(e, 5, 5);
const drifter = sl.shades[0];
park(drifter, 300, 300); // far from the hero, free to wander its home
run(sl, 8000, still);
const drift = Math.hypot(drifter.x - 300, drifter.y - 300);
ok(drifter.state === "wander" && drift <= K.SHADE_LEASH + 150, `a wanderer stays near home (drift=${drift | 0})`);

// 9. Solid structures block the hero — walking into one never passes through.
const s8 = pg.buildArena(pg.levelById("old-city"));
for (const e of s8.shades) park(e, 5, 5); // no swarm to jostle the hero
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
for (const e of s9.shades) park(e, 5, 5);
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
for (const e of sf.shades) park(e, 5, 5); // no swarm to jostle the hero
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
for (const e of sp.shades) park(e, 5, 5);
ok(sp.pathways.length > 0, `the city is laced with pathways (${sp.pathways.length})`);
sp.solids = []; sp.fences = []; sp.pathways = []; // baseline: no lane under the hero
sp.hero.x = 100; sp.hero.y = 100;
const baseX = sp.hero.x;
run(sp, 500, { x: 1, y: 0 });
const baseDist = sp.hero.x - baseX;
// Same walk, but with a straight lane laid under the hero's path.
const sp2 = pg.buildArena(pg.levelById("old-city"));
for (const e of sp2.shades) park(e, 5, 5);
sp2.solids = []; sp2.fences = [];
sp2.pathways = [{ x1: 80, y1: 100, x2: 900, y2: 100 }];
sp2.hero.x = 100; sp2.hero.y = 100;
const pathX = sp2.hero.x;
run(sp2, 500, { x: 1, y: 0 });
const pathDist = sp2.hero.x - pathX;
ok(pathDist > baseDist + 1, `the hero runs faster on a pathway (${baseDist | 0} -> ${pathDist | 0})`);

// 11. Legacy: clears and deaths fold into a private key, best time never worsens.
store.delete(LEGACY_KEY);
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

// 14. Scoring: a clear banks a score and embers; the parts behave sensibly.
const ssc = pg.buildArena(pg.levelById("old-city"));
const sc0 = pg.scoreRun(ssc);
ok(sc0.base === ssc.total * 100, `base score = 100 per shade (${sc0.base})`);
ok(sc0.embers >= 1, `a clear always banks at least one ember (${sc0.embers})`);
ok(sc0.untouched > 0 && sc0.survival > 0, "an unscathed, full-health clear earns the bonuses");
ssc.hits = 2; // took blows
ok(pg.scoreRun(ssc).untouched === 0, "a blow forfeits the untouched bonus");
ok(pg.difficultyMult(pg.levelById("vesper")) > pg.difficultyMult(pg.levelById("old-city")),
  "a harder city multiplies a clear's score more");

// 15. Pentagram types: the equipped sigil leans the effective stats, and its
//     signature power fires. Unlocks/equips persist in the legacy (no key bump).
store.delete(LEGACY_KEY);
pg.recordClear(pg.levelById("old-city"), 1000, 0, 2000); // bank plenty of embers
pg.unlockType("ember"); pg.unlockType("wrath");
pg.equipType("ember");
const se = pg.buildArena(pg.levelById("old-city"));
ok(se.fxRadius < K.PENTA_RADIUS && se.fxCharge < K.PENTA_CHARGE_MS,
  "the Quick Ember shrinks the sigil's reach and charge time");
for (const e of se.shades) park(e, 5, 5);
run(se, se.fxCharge + se.fxPulse * 2, still);
ok(se.scorch.length > 0, "the Quick Ember scorches the ground it pulses on");
pg.equipType("vigil");
ok(pg.buildArena(pg.levelById("old-city")).fxRadius === K.PENTA_RADIUS, "the default Vigil uses the base reach");
pg.equipType("wrath");
const sn = pg.buildArena(pg.levelById("old-city"));
for (const e of sn.shades) park(e, 5, 5);
run(sn, sn.fxCharge + 60, still);
ok(sn.novaFired === true, "the Wrath erupts in a nova at full charge");
ok(sn.novas.length > 0, "the Wrath's nova leaves a visible eruption ring");

// 16. Unlock economy: cost is deducted, ownership persists, the unaffordable can't buy.
store.delete(LEGACY_KEY);
const fresh = pg.loadPgLegacy();
ok(fresh.embers === 0 && fresh.equipped === "vigil" && fresh.unlocked.length === 1,
  "a fresh legacy owns only the Vigil, with no embers");
pg.recordClear(pg.levelById("old-city"), 1000, 0, 200);
const pyre = pg.PENTA_TYPES.find((t) => t.id === "pyre");
const lu = pg.unlockType("pyre");
ok(lu.unlocked.includes("pyre") && lu.embers === 200 - pyre.cost, "unlocking a sigil deducts its cost");
ok(pg.loadPgLegacy().unlocked.includes("pyre"), "the unlock persists to storage");
pg.equipType("pyre");
ok(pg.loadPgLegacy().equipped === "pyre", "the equipped sigil persists");
const before = pg.loadPgLegacy().embers;
pg.unlockType("wrath"); // 240 embers, more than remain
ok(!pg.loadPgLegacy().unlocked.includes("wrath") && pg.loadPgLegacy().embers === before,
  "an unaffordable sigil cannot be unlocked");
// Backward compatibility: an old save without the new fields defaults cleanly.
store.set(LEGACY_KEY, JSON.stringify({ runs: 2, clears: 1, best: {}, dwellingsLit: 0 }));
const old = pg.loadPgLegacy();
ok(old.embers === 0 && old.equipped === "vigil" && old.unlocked.length === 1 && old.runs === 2,
  "an old save defaults the new sigil fields");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
