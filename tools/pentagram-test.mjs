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
// A pristine finger-trace: densely sample every star segment, exactly on the line.
function perfectStroke(segs, step = 0.05) {
  const pts = [];
  for (const sg of segs) {
    for (let t = 0; t <= 1.0001; t += step) {
      pts.push({ x: sg.x1 + (sg.x2 - sg.x1) * t, y: sg.y1 + (sg.y2 - sg.y1) * t });
    }
  }
  return pts;
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

// 6. Clearing every shade raises the warden; tracing it down wins the descent.
const s5 = pg.buildArena(pg.levelById("old-city"));
for (const e of s5.shades) { e.x = s5.hero.x; e.y = s5.hero.y; wake(e); e.hp = K.SHADE_HP; }
run(s5, K.PENTA_CHARGE_MS + K.PENTA_PULSE_MS * 12, still);
ok(s5.shades.every((e) => e.dead), "all shades fall when stacked on the sigil");
ok(s5.phase === "boss" && s5.boss && s5.boss.hp > 0, "clearing the host raises the Veilwarden");
ok(pg.clearedPct(s5) === 1, "cleared percentage reaches 100%");
// Trace the pentagram cleanly until the warden falls.
const stroke5 = perfectStroke(pg.sealSegments(s5.boss.seal));
let g5 = 0;
while (s5.phase === "boss" && g5++ < 20) pg.submitTrace(s5, stroke5);
ok(s5.phase === "won", "tracing the warden down wins the descent");
// Once won, the duel is inert.
const hpAfter = s5.boss.hp;
pg.stepBoss(s5, 100); pg.submitTrace(s5, stroke5);
ok(s5.boss.hp === hpAfter, "a won duel does not keep simulating");

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

// 17. Elite champions — bigger hp, begin shielded, and only a FULL-charge pulse
//     breaks the shield (a partial pulse does nothing).
const sel = pg.buildArena(pg.levelById("vesper")); // a city that raises elites
const elites = sel.shades.filter((e) => e.elite);
ok(elites.length === Math.min(pg.levelById("vesper").eliteCount, sel.scenery.filter((n) => n.kind === "keeper").length),
  `a city raises one champion per elite post (${elites.length})`);
ok(elites.every((e) => e.shielded && e.maxHp === K.SHADE_HP * K.ELITE_HP_MUL),
  "an elite begins shielded with a champion's health");
// Park everyone, then test a shield against a deliberately weak (never-full) pulse.
for (const e of sel.shades) park(e, 5, 5);
const champ = elites[0];
champ.x = sel.hero.x + 40; champ.y = sel.hero.y; wake(champ); champ.shielded = true;
sel.penta.charge = 0.6; // hold below full by feathering: keep the hero from charging up
// Drive a few pulses while forcing the charge to stay partial each frame.
for (let t = 0; t < K.PENTA_PULSE_MS * 3; t += 16) { sel.penta.charge = 0.6; pg.stepPentagram(sel, 16); }
ok(champ.shielded && champ.hp === champ.maxHp, "a partial pulse cannot break or hurt an elite's shield");
// Now a full inscription shatters it; subsequent pulses then bite for real.
sel.penta.charge = 1;
for (let t = 0; t < K.PENTA_PULSE_MS * 2; t += 16) { sel.penta.charge = 1; pg.stepPentagram(sel, 16); }
ok(!champ.shielded, "a full-charge pulse shatters an elite's shield");
ok(champ.hp < champ.maxHp, "once unshielded an elite takes damage");

// 18. Veil pools — a still hero standing in one cannot inscribe; the sigil unravels.
const sv = pg.buildArena(pg.levelById("drowned")); // a city with several pools
for (const e of sv.shades) park(e, 5, 5);
ok(sv.veils.length > 0, `the city drifts with veil pools (${sv.veils.length})`);
// Charge up on clean ground first.
run(sv, K.PENTA_CHARGE_MS + 30, still);
ok(sv.penta.charge > 0.9, "the hero inscribes on clean ground");
ok(pg.inVeil(sv, sv.veils[0].x, sv.veils[0].y), "inVeil reports a point inside a pool");
// Park the hero dead-centre in a pool and stand still: the charge must bleed away.
const pool = sv.veils[0]; pool.vx = 0; pool.vy = 0; // stop it drifting off the hero
sv.hero.x = pool.x; sv.hero.y = pool.y;
const cIn = sv.penta.charge;
run(sv, K.PENTA_CHARGE_MS, still);
ok(sv.penta.charge < cIn, `standing in a veil pool unravels the sigil (${cIn.toFixed(2)} -> ${sv.penta.charge.toFixed(2)})`);

// 19. Ember motes — gathering one snaps the sigil to full and opens a damage surge.
const sm = pg.buildArena(pg.levelById("old-city"));
for (const e of sm.shades) park(e, 5, 5);
sm.veils = []; sm.solids = []; sm.fences = []; sm.pathways = [];
sm.penta.charge = 0;
sm.motes.push({ x: sm.hero.x, y: sm.hero.y, until: sm.elapsed + K.MOTE_TTL_MS });
pg.stepCombat(sm, 16, { x: 1, y: 0 }); // walk over it (moving, yet it should snap full)
ok(sm.motes.length === 0, "the hero gathers a mote underfoot");
ok(sm.penta.charge >= 1 - 1e-6 || sm.surgeUntil > sm.elapsed, "gathering a mote snaps charge full and opens a surge");
ok(sm.surgeUntil > sm.elapsed, "a gathered mote opens a damage-surge window");
// killShade drops a mote by MOTE_DROP_CHANCE; over many kills at least one lands.
const smd = pg.buildArena(pg.levelById("old-city"));
smd.motes = [];
for (let i = 0; i < 80; i++) pg.killShade(smd, { x: 200 + i, y: 200, dead: false });
ok(smd.kills === 80, "killShade counts every kill");
ok(smd.motes.length > 0, `slain shades leave gatherable ember motes (${smd.motes.length} of 80)`);

// 20. Gesture scoring — the risky core. A clean full trace scores high; junk and
//     empty strokes score zero; a single edge is gated low by coverage.
const segG = pg.pentagramSegments(0, 0, 100, 0);
ok(segG.length === 5, "the star is five segments");
ok(segG.every((sg, i) => {
  const nx = segG[(i + 1) % 5];
  return Math.abs(sg.x2 - nx.x1) < 1e-6 && Math.abs(sg.y2 - nx.y1) < 1e-6;
}), "the segments chain into a closed star");
const tolG = 100 * K.TRACE_TOL_FRAC;
const fullTrace = perfectStroke(segG);
const qFull = pg.traceScore(fullTrace, segG, tolG);
ok(qFull > 0.85, `a clean full trace scores high (${qFull})`);
ok(pg.traceScore([], segG, tolG) === 0, "an empty stroke scores zero");
ok(pg.traceScore(fullTrace.slice(0, 3), segG, tolG) === 0, "too few points score zero");
const junk = Array.from({ length: 40 }, (_, i) => ({ x: 9000 + i, y: -9000 }));
ok(pg.traceScore(junk, segG, tolG) === 0, "a stroke nowhere near the star scores zero");
const oneEdge = [];
for (let t = 0; t <= 1; t += 0.02) {
  oneEdge.push({ x: segG[0].x1 + (segG[0].x2 - segG[0].x1) * t, y: segG[0].y1 + (segG[0].y2 - segG[0].y1) * t });
}
const qEdge = pg.traceScore(oneEdge, segG, tolG);
ok(qEdge > 0 && qEdge < 0.4, `tracing only one edge is gated low by coverage (${qEdge})`);
// A noisy-but-faithful trace (jittered within the slack band) still scores well.
const noisy = fullTrace.map((p) => ({ x: p.x + (Math.random() - 0.5) * tolG * 0.6, y: p.y + (Math.random() - 0.5) * tolG * 0.6 }));
ok(pg.traceScore(noisy, segG, tolG) > 0.5, "a faithful but jittery trace still scores well");

// 21. The Veilwarden duel — a city-scaled boss, a perfect trace burns it, a poor
//     trace barely marks it, and its snuff wears down an exhausted hero.
const sb = pg.buildArena(pg.levelById("vesper"));
pg.startBoss(sb);
const expectHp = Math.round(K.BOSS_HP * pg.difficultyMult(pg.levelById("vesper")));
ok(sb.phase === "boss" && sb.boss.maxHp === expectHp, `startBoss raises a city-scaled warden (${sb.boss.maxHp})`);
// A perfect trace deals near the full BOSS_TRACE_DMG; a sloppy one far less.
const segB = pg.sealSegments(sb.boss.seal);
const hpA = sb.boss.hp;
const qPerf = pg.submitTrace(sb, perfectStroke(segB));
ok(qPerf > 0.85 && hpA - sb.boss.hp > K.BOSS_TRACE_DMG * 0.8, `a clean trace burns the warden deep (q=${qPerf.toFixed(2)})`);
const hpB = sb.boss.hp;
pg.submitTrace(sb, junk); // a stroke nowhere near the template
ok(sb.boss.hp === hpB, "a trace that misses the template does no damage");
// The warden's snuff drains the hero over time, and enough of it fells you.
const sb2 = pg.buildArena(pg.levelById("old-city"));
pg.startBoss(sb2);
const hpStart = sb2.hero.hp;
for (let t = 0; t < K.BOSS_BITE_MS * 1.2; t += 16) pg.stepBoss(sb2, 16);
ok(sb2.hero.hp < hpStart, "the warden's snuff drains the hero over time");
sb2.hero.hp = K.BOSS_BITE_DMG; // one snuff from death
for (let t = 0; t < K.BOSS_BITE_MS * 1.2; t += 16) pg.stepBoss(sb2, 16);
ok(sb2.phase === "lost", "the warden wears an exhausted hero down to a fall");
// The drawn template and the scorer share geometry: a perfect trace clears full health.
const sb3 = pg.buildArena(pg.levelById("old-city"));
pg.startBoss(sb3);
const strokeB3 = perfectStroke(pg.sealSegments(sb3.boss.seal));
let g3 = 0;
while (sb3.phase === "boss" && g3++ < 30) pg.submitTrace(sb3, strokeB3);
ok(sb3.phase === "won", "enough clean traces break the warden");

// 22. Goetic seals — each warden's seal is a unique, deterministic line-glyph;
//     it rebuilds identically from the city id and a perfect trace scores high.
const sealA1 = pg.makeSeal(0, 0, 150, pg.hashSeed("old-city"));
const sealA2 = pg.makeSeal(0, 0, 150, pg.hashSeed("old-city"));
const sealB1 = pg.makeSeal(0, 0, 150, pg.hashSeed("vesper"));
ok(sealA1.spine.length > 12, `a seal is an intricate glyph (${sealA1.spine.length} nodes)`);
ok(sealA1.terminals.length === 3, "a seal marks head, foot and heart with terminal dots");
ok(JSON.stringify(sealA1.spine) === JSON.stringify(sealA2.spine),
  "a city's seal is deterministic — it rebuilds identically");
ok(JSON.stringify(sealA1.spine) !== JSON.stringify(sealB1.spine),
  "different cities raise different seals");
ok(sealA1.spine.every((p) => Math.hypot(p.x, p.y) <= 150 + 1e-6),
  "every seal node sits within the containment circle");
ok(pg.sealSegments(sealA1).length === sealA1.spine.length - 1, "the spine is an open polyline of segments");
const tolS = 150 * K.TRACE_TOL_FRAC;
ok(pg.traceScore(perfectStroke(pg.sealSegments(sealA1)), pg.sealSegments(sealA1), tolS) > 0.85,
  "a clean trace of a seal scores high");
// Every city's warden raises a buildable, traceable seal (no degenerate glyph).
for (const lv of pg.LEVELS) {
  const seal = pg.makeSeal(0, 0, 150, pg.hashSeed(lv.id));
  const q = pg.traceScore(perfectStroke(pg.sealSegments(seal)), pg.sealSegments(seal), tolS);
  ok(q > 0.85, `${lv.id}'s seal is cleanly traceable (q=${q.toFixed(2)})`);
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
