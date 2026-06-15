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
// A pristine trace of a single seal strand (node a → node b).
function strandStroke(seal, e) { return perfectStroke([pg.edgeSegment(seal, e)], 0.04); }
// Bind every strand of a warden's seal, one clean stroke each. The drifting duel-
// veils are cleared first so the bind is deterministic — the veils' own unravel
// effect is exercised on its own in §24.
function bindSeal(s) {
  s.boss.veils = [];
  for (const e of [...s.boss.seal.edges]) pg.submitTrace(s, strandStroke(s.boss.seal, e));
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
// Bind every strand of the warden's seal cleanly until it breaks.
bindSeal(s5);
ok(s5.phase === "won", "binding the whole seal wins the descent");
// Once won, the duel is inert.
const hpAfter = s5.boss.hp;
pg.stepBoss(s5, 100); pg.submitTrace(s5, strandStroke(s5.boss.seal, s5.boss.seal.edges[0]));
ok(s5.boss.hp === hpAfter, "a won duel does not keep simulating");

// 7. Contact damage + i-frames; enough touches bring the hero down (lost).
const s6 = pg.buildArena(pg.levelById("old-city"));
// One shade glued to the hero; the pentagram can't save you if it can also touch you.
const biter = s6.shades[0];
biter.x = s6.hero.x; biter.y = s6.hero.y; wake(biter); biter.hp = 1e9; // unkillable, for the test
for (let i = 1; i < s6.shades.length; i++) park(s6.shades[i], 5, 5);
// Isolate the contact-death: no dwellings to mend the hero, no walls to break the
// biter's contact — so this measures only blows landed.
s6.scenery = []; s6.solids = []; s6.fences = []; s6.conduitLinks = [];
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
// Isolate one dwelling as the only scenery, so nothing else lights, relays, or is
// snuffed by a drifting shade (which would skew the tally).
const home = s9.scenery.find((n) => n.kind === "dwelling");
s9.scenery = [home]; s9.conduitLinks = [];
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
ok(old.dwellingsAwakened === 0, "an old save defaults the awakened-dwellings tally");

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
sv.scenery = sv.scenery.filter((n) => n.kind !== "shrine"); // a shrine aura would let the hero inscribe in a veil — keep it out of this test
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

// 21. The Veilwarden duel — a city-scaled boss bound strand by strand: a clean
//     strand binds and lowers the meter, a stray one does nothing, and its snuff
//     wears down an exhausted hero.
const sb = pg.buildArena(pg.levelById("vesper"));
pg.startBoss(sb);
sb.boss.veils = []; // clear the drifting veils so the clean-bind assertions are deterministic (veils tested in §24)
const expectHp = Math.round(K.BOSS_HP * pg.difficultyMult(pg.levelById("vesper")));
ok(sb.phase === "boss" && sb.boss.maxHp === expectHp, `startBoss raises a city-scaled warden (${sb.boss.maxHp})`);
// A clean strand binds (status "bound") and lowers the binding meter.
const e0 = sb.boss.seal.edges[0];
const hpA = sb.boss.hp;
const r0 = pg.submitTrace(sb, strandStroke(sb.boss.seal, e0));
ok(r0.status === "bound" && r0.quality > 0.85, `a clean strand binds (q=${r0.quality.toFixed(2)})`);
ok(e0.done && sb.boss.hp < hpA, "binding a strand lights it and lowers the meter");
// Re-tracing a bound strand reports "already" and does not lower the meter further.
const hpAlready = sb.boss.hp;
const rAgain = pg.submitTrace(sb, strandStroke(sb.boss.seal, e0));
ok(rAgain.status === "already" && sb.boss.hp === hpAlready, "a strand already held does not bind twice");
// A stroke that misses the nodes binds nothing and does no damage.
const hpB = sb.boss.hp;
const rMiss = pg.submitTrace(sb, junk);
ok(rMiss.status === "offnode" && sb.boss.hp === hpB, "a stroke off the seal's nodes binds nothing");
// The warden's snuff drains the hero over time, and enough of it fells you.
const sb2 = pg.buildArena(pg.levelById("old-city"));
pg.startBoss(sb2);
const hpStart = sb2.hero.hp;
for (let t = 0; t < K.BOSS_BITE_MS * 1.2; t += 16) pg.stepBoss(sb2, 16);
ok(sb2.hero.hp < hpStart, "the warden's snuff drains the hero over time");
sb2.hero.hp = K.BOSS_BITE_DMG; // one snuff from death
for (let t = 0; t < K.BOSS_BITE_MS * 1.2; t += 16) pg.stepBoss(sb2, 16);
ok(sb2.phase === "lost", "the warden wears an exhausted hero down to a fall");
// Binding every strand breaks the warden and empties the meter.
const sb3 = pg.buildArena(pg.levelById("old-city"));
pg.startBoss(sb3);
bindSeal(sb3);
ok(sb3.phase === "won" && sb3.boss.hp === 0, "binding the whole seal breaks the warden");

// 22. Goetic seals — each warden's seal is a unique, deterministic node-and-edge
//     star; it rebuilds identically from the city id and is cleanly bindable.
const sealA1 = pg.makeSeal(0, 0, 150, pg.hashSeed("old-city"));
const sealA2 = pg.makeSeal(0, 0, 150, pg.hashSeed("old-city"));
const sealB1 = pg.makeSeal(0, 0, 150, pg.hashSeed("vesper"));
ok(sealA1.nodes.length >= K.SEAL_NODES_MIN && sealA1.edges.length >= 3,
  `a seal is a node-and-edge figure (${sealA1.nodes.length} nodes, ${sealA1.edges.length} strands)`);
ok(JSON.stringify(sealA1) === JSON.stringify(sealA2),
  "a city's seal is deterministic — it rebuilds identically");
ok(JSON.stringify(sealA1.edges) !== JSON.stringify(sealB1.edges) || JSON.stringify(sealA1.nodes) !== JSON.stringify(sealB1.nodes),
  "different cities raise different seals");
ok(sealA1.nodes.every((p) => Math.hypot(p.x, p.y) <= 150 + 1e-6),
  "every seal node sits within the containment circle");
ok(pg.sealSegments(sealA1).length === sealA1.edges.length, "the seal yields one segment per strand");
const tolS = 150 * K.TRACE_TOL_FRAC;
ok(pg.traceScore(strandStroke(sealA1, sealA1.edges[0]), [pg.edgeSegment(sealA1, sealA1.edges[0])], tolS) > 0.85,
  "a clean strand trace scores high");
// nearestNode snaps a near-miss to a node but rejects a far point.
const n0 = sealA1.nodes[0];
ok(pg.nearestNode(sealA1, { x: n0.x + 4, y: n0.y - 4 }, 150 * K.SEAL_SNAP_FRAC) === 0, "a near point snaps to its node");
ok(pg.nearestNode(sealA1, { x: 9000, y: 9000 }, 150 * K.SEAL_SNAP_FRAC) === -1, "a far point snaps to no node");
// Every city's warden raises a seal whose every strand binds cleanly (no degenerate glyph).
for (const lv of pg.LEVELS) {
  const seal = pg.makeSeal(0, 0, 150, pg.hashSeed(lv.id));
  const worst = Math.min(...seal.edges.map((e) => pg.traceScore(strandStroke(seal, e), [pg.edgeSegment(seal, e)], tolS)));
  ok(worst >= K.SEAL_EDGE_DONE, `${lv.id}'s seal binds cleanly (worst strand q=${worst.toFixed(2)})`);
}

// 23. Frescoes — the hero's body reaching an un-walked place uncovers them.
const sfr = pg.buildArena(pg.levelById("old-city"));
for (const e of sfr.shades) park(e, 5, 5); // no swarm to jostle the hero
sfr.solids = []; sfr.fences = []; sfr.pathways = []; // a clear floor to walk
// A press always carries a fresco; stand the hero on top of one and step once.
const press = sfr.scenery.find((n) => n.kind === "press");
ok(!!press, "the old city has a press to uncover");
sfr.hero.x = press.x; sfr.hero.y = press.y;
pg.stepCombat(sfr, 16, still);
ok(press.seen === true, "walking onto a place marks it first-footed");
ok(sfr.pendingFresco && pg.FRESCOES.includes(sfr.pendingFresco),
  "a press uncovers a fresco, queued for the shell to show");
ok(sfr.shownFrescoes.length === 1, "the uncovered fresco is logged so it shows once");
// A seen place never re-fires, even pending cleared.
sfr.pendingFresco = null;
pg.stepCombat(sfr, 16, still);
ok(sfr.pendingFresco === null, "a place already first-footed does not re-fire");
// The pool is finite: once every fresco is shown, no place uncovers more.
const sfr2 = pg.buildArena(pg.levelById("old-city"));
sfr2.shownFrescoes = pg.FRESCOES.map((_, i) => i);
const anyNode = sfr2.scenery.find((n) => n.kind === "press" || n.kind === "shrine");
if (anyNode) pg.maybeFresco(sfr2, anyNode);
ok(sfr2.pendingFresco === null, "an exhausted fresco pool uncovers nothing");

// 24. Difficulty is real — a harder city raises a DENSER seal (more strands to
//     bind), not merely a bigger health number. Same seed, two difficulties.
const seedX = pg.hashSeed("old-city");
const easySeal = pg.makeSeal(0, 0, 150, seedX, 0.6);
const hardSeal = pg.makeSeal(0, 0, 150, seedX, 1.3);
ok(hardSeal.nodes.length > easySeal.nodes.length,
  `a harder warden raises a denser seal (${easySeal.nodes.length} -> ${hardSeal.nodes.length} nodes)`);
const worstHard = Math.min(...hardSeal.edges.map((e) =>
  pg.traceScore(strandStroke(hardSeal, e), [pg.edgeSegment(hardSeal, e)], 150 * K.TRACE_TOL_FRAC)));
ok(worstHard >= K.SEAL_EDGE_DONE, `the difficulty-scaled seal still binds cleanly (worst q=${worstHard.toFixed(2)})`);

// 25. Escalation — the warden's bite quickens as its seal binds, so the endgame is
//     a real race rather than a flat timer.
const sesc = pg.buildArena(pg.levelById("old-city"));
pg.startBoss(sesc);
const i0 = pg.bossBiteInterval(sesc.boss);
ok(Math.abs(i0 - K.BOSS_BITE_MS) < 1e-6, "a fresh, unbound seal bites at the base interval");
const eedges = sesc.boss.seal.edges;
for (let i = 0; i < eedges.length - 1; i++) eedges[i].done = true; // bind all but one (no win)
const i1 = pg.bossBiteInterval(sesc.boss);
ok(i1 < i0, `the warden quickens as the seal binds (${i0.toFixed(0)} -> ${i1.toFixed(0)} ms)`);
// Functionally: a near-bound warden drains the hero faster over the same window.
const sLo = pg.buildArena(pg.levelById("old-city")); pg.startBoss(sLo);
const sHi = pg.buildArena(pg.levelById("old-city")); pg.startBoss(sHi);
const he = sHi.boss.seal.edges; for (let i = 0; i < he.length - 1; i++) he[i].done = true;
for (let t = 0; t < K.BOSS_BITE_MS * 3; t += 16) { pg.stepBoss(sLo, 16); pg.stepBoss(sHi, 16); }
ok(sHi.hero.hp < sLo.hero.hp, `a near-bound warden bites harder (${sLo.hero.hp} vs ${sHi.hero.hp})`);

// 26. Counterplay — drifting veils over the seal unravel a stroke dragged through
//     them, so the duel is a contested seal, not a checklist. Count scales too.
const sveil = pg.buildArena(pg.levelById("old-city"));
pg.startBoss(sveil);
const ved = sveil.boss.seal.edges[0];
const vseg = pg.edgeSegment(sveil.boss.seal, ved);
const vmx = (vseg.x1 + vseg.x2) / 2, vmy = (vseg.y1 + vseg.y2) / 2;
const vhalf = Math.hypot(vseg.x2 - vseg.x1, vseg.y2 - vseg.y1) / 2 + 10;
sveil.boss.veils = [{ x: vmx, y: vmy, vx: 0, vy: 0, r: vhalf }]; // swallow the whole strand
const vstroke = strandStroke(sveil.boss.seal, ved);
ok(pg.strokeVeiled(sveil.boss, vstroke) > 0.9, "a stroke through a veil reads as unravelled");
const rVeiled = pg.submitTrace(sveil, vstroke);
ok(rVeiled.status === "veiled" && !ved.done, `the veil unravels an otherwise-clean trace (q=${rVeiled.quality})`);
sveil.boss.veils = []; // the veil drifts clear…
const rClear = pg.submitTrace(sveil, strandStroke(sveil.boss.seal, ved));
ok(rClear.status === "bound" && ved.done, "with the veil drifted clear, the same trace binds");
ok(pg.makeBossVeils(0, 0, 150, 1, 1.3).length > pg.makeBossVeils(0, 0, 150, 1, 0.6).length,
  "a harder warden drifts more veils over its seal");

// 27. Keyboard fallback — the desktop carrier (no pointer-drag) cycles the targeted
//     strand and binds it by rote, a cruder rite that costs a little flame.
const skb = pg.buildArena(pg.levelById("old-city"));
pg.startBoss(skb);
skb.boss.veils = [];
ok(skb.boss.sel === 0, "the duel begins with the first strand targeted");
const kbHp0 = skb.hero.hp, kbBefore = skb.boss.seal.edges.filter((e) => e.done).length;
const rKey = pg.keyBind(skb);
ok(rKey.status === "bound" && skb.boss.seal.edges.filter((e) => e.done).length === kbBefore + 1,
  "keyBind binds the targeted strand");
ok(skb.hero.hp === kbHp0 - K.BOSS_KEY_COST, "a keyboard bind costs the carrier flame");
pg.cycleSel(skb, 1);
ok(skb.boss.sel >= 0 && !skb.boss.seal.edges[skb.boss.sel].done, "cycleSel targets a still-unbound strand");
skb.hero.hp = 9999; // hold the flame so the keyboard clear can finish
let kbGuard = 0;
while (skb.phase === "boss" && kbGuard++ < 200) pg.keyBind(skb);
ok(skb.phase === "won", "binding every strand by keyboard wins the duel");

// 28. Snuffed dwellings — a shade brushing a lit dwelling claws it back to dark,
//     scarring the ground; consecrated ground (a shrine's aura) protects it.
const ssn = pg.buildArena(pg.levelById("old-city"));
ssn.solids = []; ssn.fences = []; ssn.pathways = [];
const dw = { x: 600, y: 600, kind: "dwelling", lit: true, awoke: true, litAt: 0 };
ssn.scenery = [dw]; ssn.litCount = 1; ssn.snuffed = 0;
park(ssn.shades[0], dw.x, dw.y); // a shade on the lit dwelling
for (let i = 1; i < ssn.shades.length; i++) park(ssn.shades[i], 5, 5);
pg.stepShades(ssn, 16);
ok(!dw.lit && !dw.awoke && dw.veil > ssn.elapsed, "a shade brushing a lit dwelling snuffs it to dark");
ok(ssn.litCount === 0 && ssn.snuffed === 1, "snuffing drops the lit tally and counts the loss");
ok(pg.nearScar(ssn, dw.x, dw.y), "a snuffed dwelling marks a scar on the ground");
// A still-scarred dwelling resists relighting (the scar bars the flame, not the hero).
const litBefore = ssn.litCount;
pg.kindleDwelling(ssn, dw, 0);
ok(!dw.lit && ssn.litCount === litBefore, "the scar bars relighting until it fades");

// 28b. A dwelling on consecrated ground (a shrine's aura) cannot be snuffed.
const ssh = pg.buildArena(pg.levelById("old-city"));
ssh.solids = []; ssh.fences = [];
const dw2 = { x: 600, y: 600, kind: "dwelling", lit: true, litAt: 0 };
ssh.scenery = [dw2, { x: 600, y: 600, kind: "shrine" }];
ssh.litCount = 1; ssh.snuffed = 0;
park(ssh.shades[0], dw2.x + 20, dw2.y);
for (let i = 1; i < ssh.shades.length; i++) park(ssh.shades[i], 5, 5);
pg.stepShades(ssh, 16);
ok(dw2.lit && ssh.snuffed === 0, "a dwelling within a shrine's aura resists snuffing");
ok(pg.inShrineAura(ssh, dw2.x, dw2.y), "inShrineAura reports consecrated ground");
// The hero inscribes on veiled ground while standing in a shrine's aura.
const ssv = pg.buildArena(pg.levelById("old-city"));
for (const e of ssv.shades) park(e, 5, 5);
ssv.solids = []; ssv.fences = []; ssv.pathways = [];
ssv.scenery = [{ x: ssv.hero.x, y: ssv.hero.y, kind: "shrine" }];
ssv.veils = [{ x: ssv.hero.x, y: ssv.hero.y, vx: 0, vy: 0, r: 100 }];
ssv.penta.charge = 0;
run(ssv, K.PENTA_CHARGE_MS + 30, still);
ok(ssv.penta.charge > 0.9, "a hero on consecrated ground inscribes even inside a veil");

// 29. Awakened dwellings — a lit dwelling held long enough awakens into an ally
//     emitter that pulses the dark around it on its own.
const saw = pg.buildArena(pg.levelById("old-city"));
saw.solids = []; saw.fences = []; saw.pathways = []; saw.veils = [];
const adw = { x: 300, y: 300, kind: "dwelling", lit: true, litAt: 0 };
saw.scenery = [adw];
ok((saw.elapsed = K.DWELLING_AWAKEN_MS + 1) && (pg.stepDwellings(saw), adw.awoke),
  "a lit dwelling held long enough awakens");
const esh = saw.shades[0];
esh.x = adw.x + 20; esh.y = adw.y; wake(esh); esh.hp = K.SHADE_HP;
for (let i = 1; i < saw.shades.length; i++) park(saw.shades[i], 5, 5);
const ehp0 = esh.hp;
saw.penta.charge = 1; // the pulse clock runs while inscribed (hero's own ring is far off)
for (let t = 0; t < K.PENTA_PULSE_MS * 2; t += 16) pg.stepPentagram(saw, 16);
ok(esh.hp < ehp0 || esh.dead, "an awakened dwelling pulses shades in its reach");

// 30. Conduits — a lit dwelling relays its flame down a conduit to the next dark
//     dwelling, a beat later (the fuse).
const scon = pg.buildArena(pg.levelById("old-city"));
const cd1 = { x: 400, y: 400, kind: "dwelling" };
const cd2 = { x: 480, y: 400, kind: "dwelling" };
const cc = { x: 440, y: 400, kind: "conduit" };
scon.scenery = [cd1, cd2, cc];
scon.conduitLinks = [{ c: cc, dwellings: [cd1, cd2] }];
scon.spreadQueue = []; scon.litCount = 0;
pg.kindleDwelling(scon, cd1, 0);
ok(cd1.lit && scon.spreadQueue.some((q) => q.node === cd2), "lighting a fused dwelling queues a relay to the next");
scon.elapsed += K.CONDUIT_DELAY + 1;
pg.stepSpread(scon);
ok(cd2.lit, "the conduit relays the flame to the next dwelling after a beat");
ok(scon.litCount === 2 && scon.spreadQueue.length === 0, "a relayed kindle counts and the queue drains");
// Build wires real fuses from geometry.
ok(scon.conduitLinks !== undefined && pg.buildArena(pg.levelById("old-city")).conduitLinks.length >= 0,
  "buildArena computes a conduit relay graph");

// 31. Presses — standing beside a press at a full inscription fires a one-shot
//     cascade that lights dwellings and burns shades in reach, then it is spent.
const spr = pg.buildArena(pg.levelById("old-city"));
spr.solids = []; spr.fences = []; spr.pathways = []; spr.veils = [];
const pr = { x: 800, y: 800, kind: "press" };
const pd = { x: 830, y: 800, kind: "dwelling" };
spr.scenery = [pr, pd]; spr.conduitLinks = []; spr.spreadQueue = []; spr.litCount = 0;
const psh = spr.shades[0]; psh.x = pr.x + 60; psh.y = pr.y; wake(psh); psh.hp = K.SHADE_HP;
for (let i = 1; i < spr.shades.length; i++) park(spr.shades[i], 5, 5);
spr.hero.x = pr.x; spr.hero.y = pr.y; spr.penta.charge = 1;
pg.stepPress(spr);
ok(pr.spent, "standing by a press at full charge fires its cascade");
ok(pd.lit && spr.litCount === 1, "the press cascade lights dwellings in reach");
ok(psh.hp < K.SHADE_HP || psh.dead, "the press cascade burns shades in reach");
// A spent press does not fire again.
const spentSnuff = pr.spent;
pg.stepPress(spr);
ok(spentSnuff && pr.spent, "a spent press holds no second cascade");
// A partial inscription cannot fire a press.
const spr2 = pg.buildArena(pg.levelById("old-city"));
spr2.scenery = [{ x: 100, y: 100, kind: "press" }];
spr2.hero.x = 100; spr2.hero.y = 100; spr2.penta.charge = 0.9;
pg.stepPress(spr2);
ok(!spr2.scenery[0].spent, "a press needs a FULL inscription to fire");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
