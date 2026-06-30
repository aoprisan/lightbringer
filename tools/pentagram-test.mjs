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
s4.pathways = []; // off any lane — the hero's spawn sits on the avenue crossroads
for (const e of s4.shades) park(e, 5, 5);
run(s4, K.PENTA_CHARGE_MS + 30, still);
const charged = s4.penta.charge;
run(s4, K.PENTA_CHARGE_MS, { x: 1, y: 0 }); // walk
ok(s4.penta.charge < charged, `moving lets the sigil fade (${charged.toFixed(2)} -> ${s4.penta.charge.toFixed(2)})`);

// 6. Clearing every shade wins the descent outright (the Veilwarden duel is
//    disabled for now — see the boss-in-isolation coverage in tests 21-25).
const s5 = pg.buildArena(pg.levelById("old-city"));
for (const e of s5.shades) { e.x = s5.hero.x; e.y = s5.hero.y; wake(e); e.hp = K.SHADE_HP; }
run(s5, K.PENTA_CHARGE_MS + K.PENTA_PULSE_MS * 12, still);
ok(s5.shades.every((e) => e.dead), "all shades fall when stacked on the sigil");
ok(pg.clearedPct(s5) === 1, "cleared percentage reaches 100%");
ok(s5.phase === "won", "clearing the host wins the descent");
ok(!s5.boss, "no warden rises — the duel stays disabled");

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
sa.scenery = []; sa.mists = []; // isolate aggro: a grove/mist over the spawn would dull it
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

// 11b. The city's mend is capped: a near-full hero can't be topped back to full by
// relighting, so a swarm bite can't be fully facetanked away.
const s9b = pg.buildArena(pg.levelById("old-city"));
for (const e of s9b.shades) park(e, 5, 5);
const home2 = s9b.scenery.find((n) => n.kind === "dwelling");
s9b.scenery = [home2]; s9b.conduitLinks = [];
home2.lit = false; home2.x = s9b.hero.x + 30; home2.y = s9b.hero.y;
const cap = s9b.hero.maxHp * K.HEAL_CAP;
s9b.hero.hp = cap - 2; // just under the rally cap
run(s9b, K.PENTA_CHARGE_MS + K.PENTA_PULSE_MS * 2, still);
ok(s9b.hero.hp <= cap, `the city rallies the hero only to the cap (${s9b.hero.hp} <= ${cap})`);

// A hero already above the cap is not pulled down by lighting a dwelling.
const s9c = pg.buildArena(pg.levelById("old-city"));
for (const e of s9c.shades) park(e, 5, 5);
const home3 = s9c.scenery.find((n) => n.kind === "dwelling");
s9c.scenery = [home3]; s9c.conduitLinks = [];
home3.lit = false; home3.x = s9c.hero.x + 30; home3.y = s9c.hero.y;
s9c.hero.hp = s9c.hero.maxHp; // full health, above the cap
run(s9c, K.PENTA_CHARGE_MS + K.PENTA_PULSE_MS * 2, still);
ok(s9c.hero.hp === s9c.hero.maxHp, "a full-health hero is not pulled down to the cap by relighting");

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

// 13b. A pathway is a processional: walking a lane keeps inscribing (at a reduced
// rate), where the same walk off any lane lets the sigil fade to nothing.
const spw = pg.buildArena(pg.levelById("old-city"));
for (const e of spw.shades) park(e, 5, 5);
spw.solids = []; spw.fences = []; spw.veils = []; spw.pathways = []; spw.scenery = []; // a font near the path would inscribe-on-move
spw.hero.x = 100; spw.hero.y = 100; spw.penta.charge = 0.5;
run(spw, 400, { x: 1, y: 0 }); // walk off any lane
ok(spw.penta.charge < 0.5 - 1e-3, `walking off a lane lets the sigil fade (0.50 -> ${spw.penta.charge.toFixed(2)})`);
const spw2 = pg.buildArena(pg.levelById("old-city"));
for (const e of spw2.shades) park(e, 5, 5);
spw2.solids = []; spw2.fences = []; spw2.veils = []; spw2.scenery = []; // isolate the lane's processional inscribe
spw2.pathways = [{ x1: 80, y1: 100, x2: 900, y2: 100 }];
spw2.hero.x = 100; spw2.hero.y = 100; spw2.penta.charge = 0.5;
run(spw2, 400, { x: 1, y: 0 }); // same walk, but on a lane
ok(spw2.penta.charge > 0.5 + 1e-3, `walking a lane keeps inscribing (0.50 -> ${spw2.penta.charge.toFixed(2)})`);
ok(K.PATHWAY_INSCRIBE_MUL < 1, `a lane inscribes slower than standing still (mul=${K.PATHWAY_INSCRIBE_MUL})`);

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

// 11b. Story progression: the seven cities are one journey, unlocked in order.
//      The first city is always open; each later one opens only once the city
//      before it has been cleansed. Every city carries a story chapter, and the
//      prologue/epilogue frame the whole descent.
store.delete(LEGACY_KEY);
const fresh0 = pg.loadPgLegacy();
ok(pg.cityUnlocked(pg.LEVELS[0], fresh0), "the first city is open from the start");
ok(!pg.cityUnlocked(pg.LEVELS[1], fresh0), "the second city is locked until the first is cleansed");
ok(pg.LEVELS.slice(1).every((c) => !pg.cityUnlocked(c, fresh0)), "every city past the first starts locked");
pg.recordClear(pg.LEVELS[0], 4000); // cleanse the first city
const after1 = pg.loadPgLegacy();
ok(pg.cityUnlocked(pg.LEVELS[1], after1), "cleansing a city opens the road to the next");
ok(!pg.cityUnlocked(pg.LEVELS[2], after1), "but only the very next — the city after stays locked");
ok(pg.cityUnlocked(pg.LEVELS[1], after1) && !pg.cityUnlocked(pg.LEVELS[3], after1),
  "the unlock advances one city at a time");
store.delete(LEGACY_KEY);
ok(pg.LEVELS.every((c) => typeof c.story === "string" && c.story.length > 0),
  "every city carries a story chapter");
ok(pg.LEVELS.every((c, i) => pg.storyChapter(c) && pg.storyChapter(pg.LEVELS[i]) === pg.storyChapter(c)),
  "every city has a chapter label");
ok(pg.storyChapter(pg.LEVELS[0]) === "I" && pg.storyChapter(pg.LEVELS[1]) === "II",
  "chapters number the cities in journey order");
ok(typeof pg.PROLOGUE === "string" && pg.PROLOGUE.length > 0
  && typeof pg.EPILOGUE === "string" && pg.EPILOGUE.length > 0,
  "the journey is framed by a prologue and an epilogue");
// Each city's story should name the next city — that's what links them into a
// road (matched case-insensitively: a name reads "the Ember Foundry" mid-line).
ok(pg.LEVELS.slice(0, -1).every((c, i) =>
    c.story.toLowerCase().includes(pg.LEVELS[i + 1].name.toLowerCase())),
  "each city's story names the city it leads to");

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
// 14b. Difficulty prices in the threat load, not just host size: the veil-heavy
//      Drowned Quarter now out-rewards the fair tutorial, every menace dial
//      strictly raises the multiplier, fonts never drop a city below its host
//      floor, and no city beats the ceiling (the Bastion is the hardest).
ok(pg.difficultyMult(pg.levelById("drowned")) > pg.difficultyMult(pg.levelById("old-city")),
  "the veil-heavy Drowned Quarter now out-rewards the tutorial");
const baseLvl = { keeperCount: 6, sizeScale: 1 };
ok(pg.difficultyMult({ ...baseLvl, eliteCount: 3 }) > pg.difficultyMult(baseLvl),
  "elites raise a city's difficulty multiplier");
ok(pg.difficultyMult({ ...baseLvl, veilCount: 4 }) > pg.difficultyMult(baseLvl),
  "veil pools raise a city's difficulty multiplier");
ok(pg.difficultyMult({ ...baseLvl, fontCount: 5 }) === pg.difficultyMult(baseLvl),
  "lightwells never drop a city below its host baseline");
ok(pg.LEVELS.every((l) => pg.difficultyMult(l) <= 1.6),
  "no city exceeds the difficulty ceiling");
ok(pg.LEVELS.every((l) => l.id === "bastion"
    || pg.difficultyMult(l) <= pg.difficultyMult(pg.levelById("bastion"))),
  "The Pale Bastion is the hardest descent");

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
// One of five edges is still gated well below a full trace's 0.85+ by coverage —
// the wider duel slack (TRACE_TOL_FRAC) credits a little shared-endpoint overlap.
ok(qEdge > 0 && qEdge <= 0.45, `tracing only one edge is gated low by coverage (${qEdge})`);
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
// Only one fresco surfaces per descent: walking onto a *fresh* press after one
// has already shown uncovers nothing more this run.
const press2 = sfr.scenery.find((n) => n.kind === "press" && !n.seen);
if (press2) {
  sfr.pendingFresco = null;
  sfr.hero.x = press2.x; sfr.hero.y = press2.y;
  pg.stepCombat(sfr, 16, still);
  ok(sfr.pendingFresco === null && sfr.shownFrescoes.length === 1,
    "only one fresco surfaces per descent");
}
// The pool is finite: once every fresco is shown, no place uncovers more.
const sfr2 = pg.buildArena(pg.levelById("old-city"));
sfr2.shownFrescoes = pg.FRESCOES.map((_, i) => i);
const anyNode = sfr2.scenery.find((n) => n.kind === "press" || n.kind === "shrine");
if (anyNode) pg.maybeFresco(sfr2, anyNode);
ok(sfr2.pendingFresco === null, "an exhausted fresco pool uncovers nothing");

// 23b. The reliquary — frescoes are collected into the lifetime profile, drawn
//      from per-city signature subsets, with a one-time ember bounty per set.
store.delete(LEGACY_KEY);
ok(pg.loadPgLegacy().frescoesFound.length === 0, "a fresh reliquary is empty");
const fr1 = pg.recordFrescoes([3, 3, 1]);
ok(JSON.stringify(fr1.found) === "[1,3]", "recordFrescoes dedupes and sorts a descent's finds");
const fr2 = pg.recordFrescoes([1, 7]);
ok(JSON.stringify(fr2.found) === "[1,3,7]", "a later descent unions into the lifetime reliquary");
const fr3 = pg.recordFrescoes([-1, 99]);
ok(JSON.stringify(fr3.found) === "[1,3,7]", "out-of-range indices are ignored");

// Every fresco belongs to some city's subset, so the collection is completable.
const union = new Set();
for (const lvf of pg.LEVELS) for (const i of (lvf.frescoes || [])) union.add(i);
ok(union.size === pg.FRESCOES.length, "the per-city subsets cover every fresco (the reliquary is completable)");

// Completing a city's whole subset banks the bounty — exactly once.
store.delete(LEGACY_KEY);
const oc = pg.levelById("old-city");
const eBefore = pg.loadPgLegacy().embers;
const frC = pg.recordFrescoes(oc.frescoes);
ok(frC.bonus === K.FRESCO_SET_BONUS && frC.completed.includes(oc.name),
  "completing a city's subset banks the reliquary bounty");
ok(pg.loadPgLegacy().embers === eBefore + K.FRESCO_SET_BONUS, "the bounty lands in the legacy embers");
ok(pg.recordFrescoes(oc.frescoes).bonus === 0, "an already-complete subset never re-pays");

// A city draws frescoes from its own subset until that subset is spent.
const sash = pg.buildArena(pg.levelById("ashfold"));
const ashSub = pg.levelById("ashfold").frescoes;
for (let i = 0; i < 50 && sash.shownFrescoes.length < ashSub.length; i++) {
  const node = sash.scenery.find((n) => n.kind === "press" || n.kind === "shrine");
  sash.pendingFresco = null;
  pg.maybeFresco(sash, node);
}
ok(sash.shownFrescoes.length === ashSub.length && sash.shownFrescoes.every((i) => ashSub.includes(i)),
  "a city draws frescoes only from its own signature subset");
// With its subset spent, it falls back to the global pool.
sash.pendingFresco = null;
const fbNode = sash.scenery.find((n) => n.kind === "press" || n.kind === "shrine");
pg.maybeFresco(sash, fbNode);
const lastIdx = sash.shownFrescoes[sash.shownFrescoes.length - 1];
ok(sash.pendingFresco !== null && !ashSub.includes(lastIdx),
  "a spent subset falls back to the global fresco pool");

// The gallery renders progress, tappable tiles, whitewashed gaps, and badges.
store.delete(LEGACY_KEY);
pg.recordFrescoes([0, 6]);
const gal = pg.frescoGalleryHtml(pg.loadPgLegacy().frescoesFound);
ok(gal.includes(`2/${pg.FRESCOES.length} uncovered`), "the gallery reports collection progress");
ok(gal.includes('data-frx="0"') && gal.includes('data-frx="6"'), "uncovered frescoes render as tappable tiles");
ok(gal.includes("Beneath the whitewash…"), "uncollected frescoes stay whitewashed");
pg.recordFrescoes(oc.frescoes);
ok(pg.frescoGalleryHtml(pg.loadPgLegacy().frescoesFound).includes("illuminated"),
  "a fully-collected city shows the illuminated badge");

// 23c. QR encoder — self-contained, offline byte-mode generator for sharing.
const qrSmall = pg.qrEncode("AB");
ok(qrSmall && qrSmall.size === 21, "a short string encodes to a version-1 (21x21) QR");
ok(qrSmall.modules[0][0] && qrSmall.modules[0][6] && qrSmall.modules[6][0] && !qrSmall.modules[1][1],
  "the top-left finder pattern is well-formed");
ok(qrSmall.modules[0][20] && qrSmall.modules[20][0], "the top-right and bottom-left finders are present");
ok(qrSmall.modules[6][8] && !qrSmall.modules[6][9], "the timing pattern alternates");
ok(qrSmall.modules[qrSmall.size - 8][8] === true, "the fixed dark module is set");
// Reed–Solomon: the full codeword polynomial vanishes at the generator roots.
const qrEval = (coeffs, xExp) => {
  let acc = 0;
  for (const cf of coeffs) acc = pg.qrMul(acc, pg.QR_EXP[xExp % 255]) ^ cf;
  return acc;
};
const qrEccB = pg.qrEcc([32, 65, 205, 69, 41, 220, 46, 128, 236], 10);
const qrWord = [32, 65, 205, 69, 41, 220, 46, 128, 236].concat(qrEccB);
let qrRsOk = true;
for (let i = 0; i < 10; i++) if (qrEval(qrWord, i) !== 0) qrRsOk = false;
ok(qrRsOk, "Reed-Solomon codewords vanish at the generator roots (valid ECC)");
ok(pg.qrEncode("x".repeat(200)) === null, "an over-long string yields no QR (versions cap at 5)");
// Place+mask round-trip: read the data bits back out of the finished matrix.
const qr = pg.qrEncode("https://example.com/the-burning-vigil");
const grid = qr.modules.map((row) => row.slice());
for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++)
  if (!qr.isFn[r][c] && pg.qrMaskBit(qr.mask, r, c)) grid[r][c] = !grid[r][c];
const qrBits = [];
for (let right = qr.size - 1; right >= 1; right -= 2) {
  if (right === 6) right = 5;
  for (let vert = 0; vert < qr.size; vert++) for (let j = 0; j < 2; j++) {
    const col = right - j;
    const upward = ((right + 1) & 2) === 0;
    const row = upward ? qr.size - 1 - vert : vert;
    if (!qr.isFn[row][col]) qrBits.push(grid[row][col] ? 1 : 0);
  }
}
const qrCw = [];
for (let i = 0; i + 8 <= qrBits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | qrBits[i + j]; qrCw.push(b); }
ok(qrCw.slice(0, qr.codewords.length).every((v, i) => v === qr.codewords[i]),
  "the QR's data round-trips back through placement and masking");

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

// 28. evalTrace — the pure verdict that drives the bind, the toast, AND the live
//     drawing feedback. It must read the same outcome submitTrace acts on, without
//     ever mutating the seal (render calls it every frame while the finger draws).
const sev = pg.buildArena(pg.levelById("old-city"));
pg.startBoss(sev);
sev.boss.veils = [];
const evEdge = sev.boss.seal.edges[0];
const evStroke = strandStroke(sev.boss.seal, evEdge);
const evVerdict = pg.evalTrace(sev.boss, evStroke);
ok(evVerdict.status === "bound" && !evEdge.done, "evalTrace reads a clean strand as binding without mutating it");
const evRes = pg.submitTrace(sev, evStroke);
ok(evRes.status === evVerdict.status && evRes.edge === evVerdict.edge,
  "submitTrace acts on exactly the verdict evalTrace read");
ok(evEdge.done, "and only submitTrace actually binds the strand");
// A deliberate node-to-node stroke is forgiving of penmanship: a jittery line that
// stays roughly on the strand still binds (the whole point of the loosened duel).
const evJittery = strandStroke(sev.boss.seal, sev.boss.seal.edges[1]).map((p) => ({
  x: p.x + (Math.random() - 0.5) * 150 * K.TRACE_TOL_FRAC * 0.7,
  y: p.y + (Math.random() - 0.5) * 150 * K.TRACE_TOL_FRAC * 0.7,
}));
ok(pg.evalTrace(sev.boss, evJittery).status === "bound", "a jittery-but-faithful strand still binds");

// 29. Snuffed dwellings — a shade brushing a lit dwelling claws it back to dark,
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

// 30. Awakened dwellings — a lit dwelling held long enough awakens into an ally
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

// 31. Conduits — a lit dwelling relays its flame down a conduit to the next dark
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

// 32. Presses — standing beside a press at a full inscription fires a one-shot
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

// 33. Spitters — a ranged shade holds its distance, lobs bolts that bite a STILL
//     hero, and those bolts are stopped by fences (cover). A moving hero dodges.
const sspit = pg.buildArena(pg.levelById("old-city"));
sspit.fences = []; sspit.solids = []; sspit.veils = []; sspit.pathways = [];
sspit.scenery = []; sspit.mists = []; // a grove/mist over the hero would make the spitter hold fire
// One spitter due east of the hero, just inside its lob range; park the rest away.
const spit = sspit.shades[0];
spit.spitter = true; spit.elite = false; spit.shielded = false; spit.darter = false;
spit.cooldown = 0; spit.hp = K.SPITTER_HP; spit.maxHp = K.SPITTER_HP;
spit.x = sspit.hero.x + K.SPITTER_STANDOFF; spit.y = sspit.hero.y; wake(spit);
spit.homeX = spit.x; spit.homeY = spit.y;
for (let i = 1; i < sspit.shades.length; i++) park(sspit.shades[i], 5, 5);
const hpBeforeSpit = sspit.hero.hp;
run(sspit, K.SPITTER_COOLDOWN_MS + 200, still); // hero stands still and inscribes
ok(sspit.bolts !== undefined, "state carries a bolts array");
ok(sspit.hero.hp < hpBeforeSpit, "a spitter's bolt bites a hero who stands still");
// It keeps its distance rather than piling onto the hero like a chaser.
ok(Math.hypot(spit.x - sspit.hero.x, spit.y - sspit.hero.y) > K.HERO_RADIUS + K.SHADE_RADIUS + 20,
  "a spitter holds standoff range, not contact");

// A fence between spitter and hero eats the bolts — cover works.
const sfen = pg.buildArena(pg.levelById("old-city"));
sfen.solids = []; sfen.veils = []; sfen.pathways = [];
const spc = sfen.shades[0];
spc.spitter = true; spc.elite = false; spc.shielded = false; spc.darter = false;
spc.cooldown = 0; spc.hp = K.SPITTER_HP;
spc.x = sfen.hero.x + K.SPITTER_STANDOFF; spc.y = sfen.hero.y; wake(spc);
spc.homeX = spc.x; spc.homeY = spc.y;
for (let i = 1; i < sfen.shades.length; i++) park(sfen.shades[i], 5, 5);
// A vertical fence wall standing between the two, across the bolt's path.
const fx = sfen.hero.x + K.SPITTER_STANDOFF / 2;
sfen.fences = [{ x1: fx, y1: sfen.hero.y - 80, x2: fx, y2: sfen.hero.y + 80 }];
const hpBeforeFence = sfen.hero.hp;
run(sfen, K.SPITTER_COOLDOWN_MS * 2 + 200, still);
ok(sfen.hero.hp === hpBeforeFence, "a fence between them stops the bolts (cover)");

// 34. Darters — a quick, frail shade closes far faster than a common chaser.
const sdar = pg.buildArena(pg.levelById("old-city"));
sdar.fences = []; sdar.solids = []; sdar.veils = []; sdar.pathways = [];
const dar = sdar.shades[0];
dar.darter = true; dar.elite = false; dar.shielded = false; dar.spitter = false;
dar.hp = K.DARTER_HP; dar.maxHp = K.DARTER_HP;
const startGap = 300;
dar.x = sdar.hero.x + startGap; dar.y = sdar.hero.y; wake(dar);
const common = sdar.shades[1];
common.elite = false; common.shielded = false; common.spitter = false; common.darter = false;
common.x = sdar.hero.x - startGap; common.y = sdar.hero.y; wake(common);
for (let i = 2; i < sdar.shades.length; i++) park(sdar.shades[i], 5, 5);
const heroX = sdar.hero.x;
// Step a short, fixed window and compare how far each closed (hero held still).
for (let t = 0; t < 600; t += 16) pg.stepShades(sdar, 16); // movement only, no pulses
const darClosed = startGap - Math.abs(dar.x - heroX);
const comClosed = startGap - Math.abs(common.x - heroX);
ok(darClosed > comClosed * 1.3, `a darter closes faster than a common shade (${darClosed.toFixed(0)} vs ${comClosed.toFixed(0)})`);
ok(K.DARTER_HP < K.SHADE_HP, "a darter is frailer than a common shade");

// Roles are rostered from a city's per-role counts, in distinct slots (no collision).
const sroster = pg.buildArena(pg.levelById("vesper"));
ok(sroster.shades.some((e) => e.spitter) && sroster.shades.some((e) => e.darter),
  "a leaning city rosters both spitters and darters");
ok(sroster.shades.every((e) => !(e.spitter && e.darter) && !(e.elite && e.spitter) && !(e.elite && e.darter)),
  "no shade holds two roles at once");

// 35. Lightwells (fonts) — within a font's aura the hero inscribes EVEN WHILE
//     MOVING (the well feeds the flame), inverting the stand-still rule.
const sfont = pg.buildArena(pg.levelById("old-city"));
sfont.solids = []; sfont.fences = []; sfont.veils = [];
for (const e of sfont.shades) park(e, 5, 5);
const font = { x: 1000, y: 1000, kind: "font" };
sfont.scenery = [font]; sfont.conduitLinks = []; sfont.penta.charge = 0;
ok(pg.inFontAura(sfont, font.x, font.y), "a font's aura covers its centre");
ok(!pg.inFontAura(sfont, font.x + K.FONT_AURA + 40, font.y), "a font's aura is finite");
const moveR = { x: 1, y: 0 };
// Pin the hero on the font each slice and drive a hard move vector: a moving hero
// would normally let the sigil fade, but on the well it inscribes regardless.
for (let t = 0; t < 700; t += 16) {
  sfont.hero.x = font.x; sfont.hero.y = font.y;
  pg.stepCombat(sfont, 16, moveR);
}
ok(sfont.penta.charge > 0.5, `a moving hero inscribes inside a font (charge=${sfont.penta.charge.toFixed(2)})`);
// Off any font, a moving hero lets the sigil fade — the rule only bends on the well.
const sfar = pg.buildArena(pg.levelById("old-city"));
sfar.solids = []; sfar.fences = []; sfar.veils = []; sfar.scenery = []; sfar.conduitLinks = []; sfar.pathways = [];
for (const e of sfar.shades) park(e, 5, 5);
sfar.penta.charge = 1;
run(sfar, 500, moveR);
ok(sfar.penta.charge < 1, "off any font, a moving hero lets the sigil fade");

// 36. Ward-obelisks — a STANDING obelisk keeps shades in its aura SHIELDED (a
//     partial pulse does nothing); cracking it (full inscription within reach)
//     lifts the ward so a full pulse can then shatter the shields.
const sob = pg.buildArena(pg.levelById("old-city"));
sob.fences = []; sob.veils = []; sob.pathways = [];
const ob = { x: 1200, y: 1200, kind: "obelisk" };
sob.scenery = [ob]; sob.solids = [ob]; sob.conduitLinks = [];
for (let i = 1; i < sob.shades.length; i++) park(sob.shades[i], 5, 5);
const wob = sob.shades[0];
wob.elite = false; wob.shielded = false; wob.spitter = false; wob.darter = false; wob.healer = false;
wob.hp = K.SHADE_HP; wob.maxHp = K.SHADE_HP;
wob.x = ob.x + 120; wob.y = ob.y; // inside the ward aura
sob.hero.x = ob.x + 220; sob.hero.y = ob.y; // near the shade, but out of cracking reach
const obHp0 = wob.hp;
for (let t = 0; t < 1500; t += 16) { sob.penta.charge = 1; pg.stepObelisks(sob); pg.stepPentagram(sob, 16); }
ok(!ob.spent, "an obelisk out of reach is not cracked by the pulse");
ok(wob.shielded && wob.hp === obHp0, "a shade warded by a standing obelisk takes no damage");
// Crack it: stand on it at a full inscription.
sob.hero.x = ob.x; sob.hero.y = ob.y; sob.penta.charge = 1;
pg.stepObelisks(sob);
ok(ob.spent, "standing on an obelisk at full charge cracks it");
const obHp1 = wob.hp;
for (let t = 0; t < 1500; t += 16) { sob.penta.charge = 1; pg.stepObelisks(sob); pg.stepPentagram(sob, 16); }
ok(wob.hp < obHp1 || wob.dead, "once the obelisk is cracked the warded shade can be burned");

// 37. Warden-acolytes (healers) — a healer holds back and MENDS wounded shades
//     near it (never itself, never spawning any), so it must be killed first.
const sheal = pg.buildArena(pg.levelById("old-city"));
sheal.fences = []; sheal.solids = []; sheal.veils = []; sheal.pathways = [];
for (let i = 2; i < sheal.shades.length; i++) park(sheal.shades[i], 5, 5);
const heal = sheal.shades[0];
heal.healer = true; heal.elite = false; heal.shielded = false; heal.spitter = false; heal.darter = false;
heal.hp = K.HEALER_HP; heal.maxHp = K.HEALER_HP; heal.cooldown = 0;
heal.x = 1500; heal.y = 1500; wake(heal); heal.homeX = heal.x; heal.homeY = heal.y;
const patient = sheal.shades[1];
patient.healer = false; patient.elite = false; patient.shielded = false; patient.spitter = false; patient.darter = false;
patient.maxHp = K.SHADE_HP; patient.hp = 10; // wounded, beside the healer
const totalBefore = sheal.shades.length;
const patHp0 = patient.hp;
for (let t = 0; t < K.HEALER_COOLDOWN_MS + 100; t += 16) {
  patient.x = heal.x + 40; patient.y = heal.y;          // keep the patient beside the healer
  sheal.hero.x = heal.x - K.HEALER_STANDOFF; sheal.hero.y = heal.y; // pin the healer at standoff (still)
  pg.stepShades(sheal, 16);
}
ok(patient.hp > patHp0, `a healer mends a wounded shade (${patHp0} -> ${patient.hp})`);
ok(patient.hp <= patient.maxHp, "a heal never overfills past maxHp");
ok(sheal.shades.length === totalBefore, "a healer never spawns new shades (the host stays finite)");
ok(K.HEALER_HP < K.SHADE_HP, "a healer is frail");
// Healers roster on a disjoint post band from spitters (slot 1) — never two roles on one shade.
const shRoster = pg.buildArena(pg.levelById("bastion"));
ok(shRoster.shades.some((e) => e.healer), "a healer-leaning city rosters acolytes");
ok(shRoster.shades.every((e) =>
  !(e.healer && e.spitter) && !(e.healer && e.elite) && !(e.healer && e.darter)),
  "no shade is both a healer and another role");

// 38. The two new cities resolve, generate their signature structures, and keep
//     the fresco reliquary completable (the per-city subsets still partition all).
ok(pg.levelById("foundry") && pg.levelById("bastion"), "the two new cities resolve by id");
const sfo = pg.buildArena(pg.levelById("foundry"));
ok(sfo.scenery.some((n) => n.kind === "font"), "the Ember Foundry generates lightwells");
ok(sfo.shades.some((e) => e.healer), "the Ember Foundry rosters acolytes");
const sba = pg.buildArena(pg.levelById("bastion"));
ok(sba.scenery.some((n) => n.kind === "obelisk"), "the Pale Bastion generates ward-obelisks");
ok(sba.solids.some((n) => n.kind === "obelisk"), "a ward-obelisk is a solid (blocks bodies)");
const union2 = new Set();
for (const lvf of pg.LEVELS) for (const i of (lvf.frescoes || [])) union2.add(i);
ok(union2.size === pg.FRESCOES.length,
  "with the new cities, the per-city subsets still cover every fresco");

// 38b. Fonts and obelisks are no longer hidden in one city each — the core
// cities now seed them too, so every player meets both mechanics.
const fontCities = pg.LEVELS.filter((l) => pg.buildArena(l).scenery.some((n) => n.kind === "font"));
const obeliskCities = pg.LEVELS.filter((l) => pg.buildArena(l).scenery.some((n) => n.kind === "obelisk"));
ok(fontCities.length >= 3, `lightwells appear across several cities (${fontCities.length})`);
ok(obeliskCities.length >= 3, `ward-obelisks appear across several cities (${obeliskCities.length})`);
ok(pg.buildArena(pg.levelById("old-city")).scenery.some((n) => n.kind === "font"),
  "the Old City now teaches the lightwell");

// 39. Consecration rings: a full inscription sears warded ground that chips shades
//     standing on it, protects a lit dwelling inside it from snuffing, and fades
//     after CONSECRATE_MS. Standing refreshes the ring underfoot rather than spamming.
const scr = pg.buildArena(pg.levelById("old-city"));
for (const e of scr.shades) park(e, 5, 5); // stow the host far away
run(scr, scr.fxCharge + scr.fxPulse + 50, still); // stand until a full pulse fires
ok(scr.rings.length >= 1, "a full inscription sears a consecration ring");
ok(pg.inConsecration(scr, scr.hero.x, scr.hero.y), "the hero stands on warded ground");
const ringsAfterFirst = scr.rings.length;
run(scr, scr.fxPulse * 3, still); // keep standing in place
ok(scr.rings.length === ringsAfterFirst, "standing still refreshes the ring, not spawns new ones");

// Chip: a shade left standing on a ring loses health over time.
const ringVictim = scr.shades[0];
park(ringVictim, scr.hero.x, scr.hero.y);
const ringHp0 = ringVictim.hp;
pg.stepRings(scr, 1000); // a second on warded ground
ok(ringVictim.hp < ringHp0, `a shade on a consecration ring is chipped (${ringHp0} -> ${ringVictim.hp})`);

// Snuff protection: a lit dwelling inside a ring resists a brushing shade — and the
// same setup without the ring snuffs it (the control).
const scrP = pg.buildArena(pg.levelById("old-city"));
for (const e of scrP.shades) park(e, 5, 5);
const dwP = scrP.scenery.find((n) => n.kind === "dwelling" && !pg.inShrineAura(scrP, n.x, n.y));
dwP.lit = true; dwP.litAt = scrP.elapsed; scrP.litCount = 1;
scrP.rings.push({ x: dwP.x, y: dwP.y, until: scrP.elapsed + 5000 });
park(scrP.shades[0], dwP.x, dwP.y);
pg.stepShades(scrP, 16);
ok(dwP.lit === true, "a lit dwelling on a consecration ring resists snuffing");

const scrC = pg.buildArena(pg.levelById("old-city"));
for (const e of scrC.shades) park(e, 5, 5);
const dwC = scrC.scenery.find((n) => n.kind === "dwelling" && !pg.inShrineAura(scrC, n.x, n.y));
dwC.lit = true; dwC.litAt = scrC.elapsed; scrC.litCount = 1;
park(scrC.shades[0], dwC.x, dwC.y);
pg.stepShades(scrC, 16);
ok(dwC.lit === false, "without a ring, a brushing shade snuffs the dwelling (control)");

// Fade: an expired ring is retired and no longer wards its ground.
const scrF = pg.buildArena(pg.levelById("old-city"));
scrF.rings.push({ x: 100, y: 100, until: scrF.elapsed - 1 });
pg.stepRings(scrF, 16);
ok(scrF.rings.length === 0, "an expired consecration ring fades");
ok(!pg.inConsecration(scrF, 100, 100), "expired warded ground no longer protects");

// 40. Constellations: lighting every dwelling a conduit fuses completes the pattern
//     — its dwellings awaken at once and the carrier is healed; it fires once until a
//     snuff re-arms the fuse. Rewards where you relight, not how many.
const sco = pg.buildArena(pg.levelById("old-city"));
const clink = sco.conduitLinks[0];
ok(clink && clink.dwellings.length >= 2, "a city fuses at least one constellation");
sco.conduitLinks = [clink]; // isolate this fuse: overlapping links could complete a *different* constellation
for (const d of clink.dwellings) { d.lit = false; d.awoke = false; d.veil = 0; }
sco.litCount = 0; sco.constellations = 0; sco.hero.hp = 1; // dark start, room to heal
for (let i = 0; i < clink.dwellings.length - 1; i++) pg.kindleDwelling(sco, clink.dwellings[i], 0);
ok(sco.constellations === 0, "an incomplete fuse grants no constellation");
const cHpBefore = sco.hero.hp;
pg.kindleDwelling(sco, clink.dwellings[clink.dwellings.length - 1], 0);
ok(sco.constellations === 1, "lighting the whole fuse completes a constellation");
ok(sco.bursts.length === 1, "a completed constellation spawns a kindle-flash FX");
ok(clink.dwellings.every((d) => d.awoke), "a completed constellation awakens its dwellings at once");
ok(sco.hero.hp > cHpBefore, `a completed constellation rallies the carrier (${cHpBefore} -> ${sco.hero.hp})`);
ok(pg.litReadout(sco).includes("✸"), "the HUD shows the constellation tally");
// A snuff breaks the pattern and re-arms the fuse; re-lighting re-completes it.
pg.snuffDwelling(sco, clink.dwellings[0]);
ok(clink.done === false, "snuffing a constellation dwelling re-arms the fuse");
sco.constellations = 0; clink.dwellings[0].veil = 0; // scar faded
pg.kindleDwelling(sco, clink.dwellings[0], 0);
ok(sco.constellations === 1, "re-lighting the broken dwelling re-completes the constellation");

// 41. Ascension: a curse tier toughens the host, drifts in extra veils, and pays a
//     bigger score multiplier; the legacy tracks the deepest tier cleared per city
//     (unlocking the next). Tier 0 is the plain city, identical to no ascension.
ok(pg.curseFor(0).hpMul === 1 && pg.curseFor(0).scoreMul === 0 && pg.curseFor(0).extraVeils === 0,
  "ascension tier 0 is the plain city (no curse)");
const cz = pg.curseFor(3);
ok(cz.tier === 3 && cz.hpMul > 1 && cz.contactMul > 1 && cz.extraVeils === 3 && cz.scoreMul > 0,
  "a higher tier stacks vigor, bite, veils and reward");
ok(pg.curseFor(99).tier === K.ASC_MAX, "ascension is capped at ASC_MAX");

const a0 = pg.buildArena(pg.levelById("old-city"), 0);
const a2 = pg.buildArena(pg.levelById("old-city"), 2);
ok(a2.curse.tier === 2, "buildArena bakes the chosen ascension onto the descent");
ok(a2.veils.length === a0.veils.length + 2, "a curse drifts in extra veil pools");
const ascHp0 = a0.shades.reduce((m, e) => m + e.maxHp, 0);
const ascHp2 = a2.shades.reduce((m, e) => m + e.maxHp, 0);
ok(ascHp2 > ascHp0, `a curse toughens the host (${ascHp0 | 0} -> ${ascHp2 | 0} total HP)`);
ok(pg.scoreRun(a2).mult > pg.scoreRun(a0).mult, "a curse multiplies the score/embers more");

store.delete(LEGACY_KEY);
ok(Object.keys(pg.emptyPgLegacy().ascension).length === 0, "a fresh legacy has no ascensions");
pg.recordClear(pg.levelById("old-city"), 1000, 0, 0, 0, 2);
ok(pg.loadPgLegacy().ascension["old-city"] === 2, "clearing at a tier records it (unlocking the next)");
pg.recordClear(pg.levelById("old-city"), 1000, 0, 0, 0, 1);
ok(pg.loadPgLegacy().ascension["old-city"] === 2, "a shallower clear can't lower the recorded tier");

// 42. District plans: the arena clusters its nodes into named quarters of varying
//     density, each with an open plaza at its heart (a shrine landmark, no
//     buildings), and the centre stays a neutral crossroads where the hero spawns.
const dcity = pg.levelById("old-city");
const dDist = pg.resolveDistricts(dcity);
const dW = Math.round(K.W * (dcity.sizeScale ?? 1)), dH = Math.round(K.H * (dcity.sizeScale ?? 1));
ok(dDist.length === 4, `a city resolves its districts (${dDist.length})`);
ok(dDist.every((d) => d.x >= 60 && d.x <= dW - 60 && d.y >= 60 && d.y <= dH - 60),
  "every district anchor sits inside the arena bounds");
ok(Math.abs(dDist.reduce((sum, d) => sum + d.weight, 0) - 1) < 1e-9, "district weights are normalized");
// The arena heart (hero spawn) is left clear of any plaza.
ok(dDist.every((d) => (d.x - dW / 2) ** 2 + (d.y - dH / 2) ** 2 > d.plazaR ** 2),
  "no plaza covers the arena heart (the hero's crossroads)");

const distCity = pg.generateCity(dcity);
// Plazas are open: no BUILDING lies inside a plaza (a shrine landmark at the exact
// centre is allowed — it IS the plaza's landmark).
const buildings = distCity.filter((n) => n.kind !== "shrine");
ok(buildings.every((n) => dDist.every((d) => (d.x - n.x) ** 2 + (d.y - n.y) ** 2 >= d.plazaR ** 2)),
  "plazas stay clear of buildings");
// The scatter is clustered, not uniform: most nodes lie within reach of an anchor.
const nearAnchor = distCity.filter((n) =>
  dDist.some((d) => (d.x - n.x) ** 2 + (d.y - n.y) ** 2 <= (d.falloffR * 1.5) ** 2)).length;
ok(nearAnchor / distCity.length >= 0.6,
  `nodes cluster into the quarters (${nearAnchor}/${distCity.length} near an anchor)`);
// A shrine landmark sits at each plaza heart (up to shrineCount of them).
const landmarks = dDist.filter((d) =>
  distCity.some((n) => n.kind === "shrine" && (d.x - n.x) ** 2 + (d.y - n.y) ** 2 < 1)).length;
ok(landmarks === Math.min(dDist.length, dcity.shrineCount), `each plaza carries a shrine landmark (${landmarks})`);

// 42b. Authored terrain: the Old City traces its map's streets and rampart — six
//      avenues (a gate-cross plus four corner diagonals) and a gated perimeter
//      wall — merged onto the woven terrain. Its woven pathways are off, so its
//      pathways are exactly the six authored avenues.
const sav = pg.buildArena(pg.levelById("old-city"));
ok(sav.pathways.length === 6, `the Old City lays its six avenues (${sav.pathways.length})`);
// A vertical gate-to-gate avenue runs the full height through the centre.
ok(sav.pathways.some((p) => Math.abs(p.x1 - sav.w / 2) < 1 && Math.abs(p.x2 - sav.w / 2) < 1
  && Math.abs(p.y2 - p.y1) > sav.h * 0.8), "an avenue crosses gate-to-gate through the heart");
// The rampart's wall segments are present among the fences (authored walls merge
// into the fence layer — they block bodies, not flame).
const wallSegs = sav.fences.filter((f) =>
  (Math.abs(f.x1 - f.x2) < 1 || Math.abs(f.y1 - f.y2) < 1) // axis-aligned
  && (f.x1 < sav.w * 0.05 || f.x1 > sav.w * 0.95 || f.y1 < sav.h * 0.05 || f.y1 > sav.h * 0.95));
ok(wallSegs.length >= 8, `the rampart rings the city (${wallSegs.length} wall segments)`);
// Cities without authored terrain weave their lanes as before (no walls/avenues).
ok(pg.levelById("glassworks").avenues === undefined && pg.levelById("glassworks").walls === undefined,
  "other cities author no terrain (woven only)");
// The authored avenues stay clear of buildings — the streets read as open
// corridors, not blocks paved over (generateCity rejects nodes on a lane).
const avCity = pg.generateCity(pg.levelById("old-city"));
const avSegs = pg.levelById("old-city").avenues.map((a) =>
  ({ x1: a.x1 * sav.w, y1: a.y1 * sav.h, x2: a.x2 * sav.w, y2: a.y2 * sav.h }));
const onLane = (n) => avSegs.some((a) =>
  pg.closestOnSegment(n.x, n.y, a.x1, a.y1, a.x2, a.y2).d < K.PATHWAY_HALF);
ok(avCity.filter((n) => n.kind !== "shrine").every((n) => !onLane(n)),
  "buildings keep clear of the avenues (open streets)");

// 42c. plazaKind seats a city's signature landmark at its plaza hearts — the
//      Foundry's molten wells (fonts), the Bastion's ward-stones (obelisks) —
//      instead of shrines, counted against that kind's own dial.
for (const [id, kind, count] of [["foundry", "font", "fontCount"], ["bastion", "obelisk", "obeliskCount"]]) {
  const lv = pg.levelById(id);
  const dist = pg.resolveDistricts(lv);
  const sc = pg.generateCity(lv);
  const atHeart = dist.filter((d) =>
    sc.some((n) => n.kind === kind && (d.x - n.x) ** 2 + (d.y - n.y) ** 2 < 1)).length;
  ok(atHeart === Math.min(dist.length, lv[count]), `${id}: a ${kind} sits at each plaza heart (${atHeart})`);
}

// Every city still dresses with density to spare and its exact shrine count — the
// clustering never starves a city or drifts the scenery counts.
for (const lvl of pg.LEVELS) {
  const sc = pg.generateCity(lvl);
  ok(sc.length > 80, `${lvl.id}: arena keeps its density (${sc.length} nodes)`);
  ok(sc.filter((n) => n.kind === "keeper").length >= 4, `${lvl.id}: keeper-posts present`);
  ok(sc.filter((n) => n.kind === "shrine").length === lvl.shrineCount,
    `${lvl.id}: shrine count preserved (${lvl.shrineCount})`);
  ok(sc.filter((n) => n.kind === "font").length === (lvl.fontCount ?? 0), `${lvl.id}: font count preserved`);
  ok(sc.filter((n) => n.kind === "obelisk").length === (lvl.obeliskCount ?? 0), `${lvl.id}: obelisk count preserved`);
}

// 43. The expanded maps — four further cities carrying the new terrain vocabulary,
//     chained on from the Bastion. Each resolves and generates its signature kinds.
ok(pg.LEVELS.length === 11, `the maps now run to eleven cities (${pg.LEVELS.length})`);
ok(["emberwood", "mistmarket", "windward", "last-vigil"].every((id) => pg.levelById(id)),
  "the four new cities resolve by id");
ok(pg.levelById("bastion").story.toLowerCase().includes("the emberwood"),
  "the Bastion now leads on to the Emberwood (the journey extends)");
const ew = pg.buildArena(pg.levelById("emberwood"));
ok(ew.scenery.some((n) => n.kind === "cinder") && ew.scenery.some((n) => n.kind === "thicket"),
  "the Emberwood grows cinder-ground and thickets");
ok(ew.solids.some((n) => n.kind === "bonfire") && ew.solids.some((n) => n.kind === "barrow"),
  "the Emberwood's bonfires and barrows are solids (block bodies)");
const mm = pg.buildArena(pg.levelById("mistmarket"));
ok(mm.scenery.some((n) => n.kind === "mire") && mm.mists.length > 0 && mm.scenery.some((n) => n.kind === "spring"),
  "the Mistmarket has mires, drifting mist, and springs");
const wd = pg.buildArena(pg.levelById("windward"));
ok(wd.scenery.some((n) => n.kind === "gust") && wd.scenery.some((n) => n.kind === "hallow")
  && wd.solids.some((n) => n.kind === "pillar"),
  "Windward Heights has gusts, hallows, and (solid) pillars");
const lv2 = pg.buildArena(pg.levelById("last-vigil"));
ok(lv2.scenery.some((n) => n.kind === "vent") && lv2.scenery.some((n) => n.kind === "lantern")
  && lv2.scenery.some((n) => n.kind === "cinder"),
  "the Last Vigil gathers vents, lanterns, and cinders");

// 44. Emitter ground — cinder, bonfire, and lantern all burn shades in their aura,
//     charge-independent (the parent's scorch made fixed terrain).
for (const [kind, aura] of [["cinder", K.CINDER_AURA], ["bonfire", K.BONFIRE_AURA], ["lantern", K.LANTERN_AURA]]) {
  const sfl = pg.buildArena(pg.levelById("old-city"));
  for (const e of sfl.shades) park(e, 5, 5);
  const node = { x: 700, y: 700, kind };
  sfl.scenery = [node];
  const burn = sfl.shades[0];
  burn.elite = false; burn.shielded = false; burn.x = node.x; burn.y = node.y; burn.hp = K.SHADE_HP;
  const hp0 = burn.hp;
  pg.stepFields(sfl, 1000);
  ok(burn.hp < hp0, `a ${kind} burns a shade standing in its aura (${hp0} -> ${burn.hp.toFixed(1)})`);
  // A shade outside the aura is untouched.
  const safe = sfl.shades[1];
  safe.x = node.x + aura + 60; safe.y = node.y; const safe0 = safe.hp;
  pg.stepFields(sfl, 1000);
  ok(safe.hp === safe0, `a shade beyond a ${kind}'s aura is unharmed`);
}
// A shielded elite shrugs off ground burn (only a full pulse breaks the shield).
const sflE = pg.buildArena(pg.levelById("old-city"));
for (const e of sflE.shades) park(e, 5, 5);
sflE.scenery = [{ x: 500, y: 500, kind: "cinder" }];
const shieldVictim = sflE.shades[0];
shieldVictim.shielded = true; shieldVictim.x = 500; shieldVictim.y = 500;
const sv0 = shieldVictim.hp;
pg.stepFields(sflE, 1000);
ok(shieldVictim.hp === sv0, "a shielded elite shrugs off cinder ground");

// 45. Mires slow every body; thickets slow only the shades.
const stm = pg.buildArena(pg.levelById("old-city"));
stm.scenery = [{ x: 400, y: 400, kind: "mire" }];
ok(pg.terrainSpeedMul(stm, 400, 400, false) === K.MIRE_SLOW, "a mire slows the hero");
ok(pg.terrainSpeedMul(stm, 400, 400, true) === K.MIRE_SLOW, "a mire slows a shade too");
ok(pg.terrainSpeedMul(stm, 9000, 9000, false) === 1, "open ground does not slow");
stm.scenery = [{ x: 400, y: 400, kind: "thicket" }];
ok(pg.terrainSpeedMul(stm, 400, 400, false) === 1, "a thicket leaves the hero unslowed");
ok(pg.terrainSpeedMul(stm, 400, 400, true) === K.THICKET_SLOW, "a thicket snares only a shade");
ok(K.MIRE_SLOW < 1 && K.THICKET_SLOW < 1, "the slows are real (multiplier < 1)");

// 46. Hallows — consecrated tiles let the hero inscribe while MOVING (like a font)
//     and inside a veil (like a shrine).
const sha = pg.buildArena(pg.levelById("old-city"));
for (const e of sha.shades) park(e, 5, 5);
sha.solids = []; sha.fences = []; sha.veils = []; sha.pathways = [];
const hl = { x: 1000, y: 1000, kind: "hallow" };
sha.scenery = [hl]; sha.conduitLinks = []; sha.penta.charge = 0;
ok(pg.inHallow(sha, hl.x, hl.y), "inHallow reports consecrated tiles");
ok(!pg.inHallow(sha, hl.x + K.HALLOW_AURA + 40, hl.y), "a hallow's aura is finite");
for (let t = 0; t < 700; t += 16) { sha.hero.x = hl.x; sha.hero.y = hl.y; pg.stepCombat(sha, 16, { x: 1, y: 0 }); }
ok(sha.penta.charge > 0.5, `a moving hero inscribes inside a hallow (charge=${sha.penta.charge.toFixed(2)})`);
const shv = pg.buildArena(pg.levelById("old-city"));
for (const e of shv.shades) park(e, 5, 5);
shv.solids = []; shv.fences = []; shv.pathways = [];
shv.scenery = [{ x: shv.hero.x, y: shv.hero.y, kind: "hallow" }];
shv.veils = [{ x: shv.hero.x, y: shv.hero.y, vx: 0, vy: 0, r: 100 }];
shv.penta.charge = 0;
run(shv, K.PENTA_CHARGE_MS + 30, still);
ok(shv.penta.charge > 0.9, "a hero on a hallow inscribes even inside a veil");

// 47. Springs — standing in the water slowly mends the hero, but only to the cap.
const ssp = pg.buildArena(pg.levelById("old-city"));
for (const e of ssp.shades) park(e, 5, 5);
ssp.solids = []; ssp.fences = []; ssp.veils = []; ssp.pathways = [];
ssp.scenery = [{ x: ssp.hero.x, y: ssp.hero.y, kind: "spring" }]; ssp.conduitLinks = [];
ssp.hero.hp = 30;
run(ssp, 1000, still);
ok(ssp.hero.hp > 30, `a spring mends a hero standing in it (30 -> ${ssp.hero.hp.toFixed(1)})`);
const sspCap = pg.buildArena(pg.levelById("old-city"));
for (const e of sspCap.shades) park(e, 5, 5);
sspCap.solids = []; sspCap.fences = []; sspCap.veils = []; sspCap.pathways = [];
sspCap.scenery = [{ x: sspCap.hero.x, y: sspCap.hero.y, kind: "spring" }]; sspCap.conduitLinks = [];
const springCap = sspCap.hero.maxHp * K.HEAL_CAP;
sspCap.hero.hp = springCap - 2;
run(sspCap, 3000, still);
ok(sspCap.hero.hp <= springCap + 1e-6, `a spring mends only to the heal cap (${sspCap.hero.hp.toFixed(1)} <= ${springCap})`);

// 48. Ember vents erupt on their own cadence, burning unshielded shades in reach.
const svt = pg.buildArena(pg.levelById("old-city"));
for (const e of svt.shades) park(e, 5, 5);
const vt = { x: 700, y: 700, kind: "vent" };
svt.scenery = [vt];
const vv = svt.shades[0]; vv.shielded = false; vv.x = vt.x; vv.y = vt.y; vv.hp = K.SHADE_HP;
pg.stepVents(svt, 16); // seeds the clock; no eruption on the first tick
ok(vv.hp === K.SHADE_HP, "a vent does not erupt before its cadence");
svt.elapsed += K.VENT_CD + 1;
pg.stepVents(svt, 16);
ok(vv.hp < K.SHADE_HP, "a vent erupts on its cadence and burns shades in reach");

// 49. Gusts — a wind-vent resists a shade's approach (it can't fully close while in
//     the aura). Compared with the same chase over open ground.
function gustClose(withGust) {
  const sg = pg.buildArena(pg.levelById("old-city"));
  for (const e of sg.shades) park(e, 5, 5);
  sg.solids = []; sg.fences = []; sg.pathways = [];
  const node = { x: 900, y: 900, kind: "gust" };
  sg.scenery = withGust ? [node] : [];
  sg.hero.x = node.x; sg.hero.y = node.y; // hero at the gust's heart
  const chaser = sg.shades[0];
  chaser.elite = false; chaser.spitter = false; chaser.darter = false; chaser.healer = false;
  chaser.x = node.x + 90; chaser.y = node.y; chaser.state = "chase";
  for (let t = 0; t < 300; t += 16) pg.stepShades(sg, 16);
  return Math.hypot(chaser.x - node.x, chaser.y - node.y);
}
ok(gustClose(true) > gustClose(false) + 5, "a gust holds a shade off — it closes less than over open ground");

// 50. Mist — a hero in fog is hidden from the ranged watch (spitters hold fire) and
//     rouses wandering shades from a shrunken aggro range.
const smi = pg.buildArena(pg.levelById("old-city"));
for (const e of smi.shades) park(e, 5, 5);
smi.scenery = []; smi.solids = []; smi.fences = []; smi.pathways = []; smi.veils = [];
const mspit = smi.shades[0];
mspit.spitter = true; mspit.elite = false; mspit.shielded = false; mspit.darter = false; mspit.healer = false;
mspit.cooldown = 0; mspit.hp = K.SPITTER_HP; mspit.maxHp = K.SPITTER_HP;
mspit.x = smi.hero.x + K.SPITTER_STANDOFF; mspit.y = smi.hero.y; wake(mspit);
mspit.homeX = mspit.x; mspit.homeY = mspit.y;
smi.mists = [{ x: smi.hero.x, y: smi.hero.y, vx: 0, vy: 0, r: K.MIST_RADIUS }];
const mhp0 = smi.hero.hp;
run(smi, K.SPITTER_COOLDOWN_MS * 2 + 200, still);
ok(pg.inMist(smi, smi.hero.x, smi.hero.y), "inMist reports the hero hidden in fog");
ok(smi.hero.hp === mhp0, "a spitter holds fire while the hero hides in mist");
// Aggro shrinks: a wanderer that would rouse on open ground keeps lurking in mist.
const smi2 = pg.buildArena(pg.levelById("old-city"));
for (const e of smi2.shades) park(e, 5, 5);
const wlk = smi2.shades[0];
park(wlk, smi2.hero.x + K.AGGRO_RADIUS * 0.7, smi2.hero.y); // inside full aggro, outside the shrunk one
smi2.mists = [{ x: smi2.hero.x, y: smi2.hero.y, vx: 0, vy: 0, r: K.MIST_RADIUS }];
for (let t = 0; t < 400; t += 16) pg.stepShades(smi2, 16);
ok(wlk.state === "wander", "mist shrinks aggro — a shade that would rouse stays lurking");
const smi3 = pg.buildArena(pg.levelById("old-city"));
for (const e of smi3.shades) park(e, 5, 5);
const wlk3 = smi3.shades[0];
park(wlk3, smi3.hero.x + K.AGGRO_RADIUS * 0.7, smi3.hero.y);
smi3.mists = []; // control: no fog
for (let t = 0; t < 400; t += 16) pg.stepShades(smi3, 16);
ok(wlk3.state === "chase", "without mist, the same wanderer rouses (control)");

// 51. Relic caches — the hero's body cracking one grants an ember surge, once.
const sca = pg.buildArena(pg.levelById("old-city"));
for (const e of sca.shades) park(e, 5, 5);
sca.scenery = [{ x: sca.hero.x, y: sca.hero.y, kind: "cache" }];
sca.penta.charge = 0; sca.surgeUntil = 0;
pg.stepCaches(sca);
ok(sca.scenery[0].spent, "the hero cracks a relic cache underfoot");
ok(sca.penta.charge >= 1 - 1e-6 && sca.surgeUntil > sca.elapsed, "a cracked cache snaps the sigil full and opens a surge");
sca.penta.charge = 0;
pg.stepCaches(sca);
ok(sca.penta.charge === 0, "a spent cache grants nothing more");

// 52. Groves — concealing cover (the static cousin of mist): a hero under the
//     canopy is hidden from the ranged watch (spitters hold fire) and dulls aggro.
const sgr = pg.buildArena(pg.levelById("old-city"));
for (const e of sgr.shades) park(e, 5, 5);
sgr.scenery = [{ x: sgr.hero.x, y: sgr.hero.y, kind: "grove" }];
sgr.solids = []; sgr.fences = []; sgr.pathways = []; sgr.veils = []; sgr.mists = [];
ok(pg.inGrove(sgr, sgr.hero.x, sgr.hero.y), "inGrove reports the canopy");
ok(!pg.inGrove(sgr, sgr.hero.x + K.GROVE_AURA + 40, sgr.hero.y), "a grove's canopy is finite");
const grSpit = sgr.shades[0];
grSpit.spitter = true; grSpit.elite = false; grSpit.shielded = false; grSpit.darter = false; grSpit.healer = false;
grSpit.cooldown = 0; grSpit.hp = K.SPITTER_HP; grSpit.maxHp = K.SPITTER_HP;
grSpit.x = sgr.hero.x + K.SPITTER_STANDOFF; grSpit.y = sgr.hero.y; wake(grSpit);
grSpit.homeX = grSpit.x; grSpit.homeY = grSpit.y;
const grHp0 = sgr.hero.hp;
run(sgr, K.SPITTER_COOLDOWN_MS * 2 + 200, still);
ok(sgr.hero.hp === grHp0, "a spitter holds fire while the hero hides in a grove");
const sgr2 = pg.buildArena(pg.levelById("old-city"));
for (const e of sgr2.shades) park(e, 5, 5);
const grW = sgr2.shades[0];
park(grW, sgr2.hero.x + K.AGGRO_RADIUS * 0.7, sgr2.hero.y); // inside full aggro, outside the grove-dulled one
sgr2.scenery = [{ x: sgr2.hero.x, y: sgr2.hero.y, kind: "grove" }]; sgr2.mists = [];
for (let t = 0; t < 400; t += 16) pg.stepShades(sgr2, 16);
ok(grW.state === "wander", "a grove dulls aggro — a shade that would rouse stays lurking");
ok(K.GROVE_AGGRO_MUL < 1, "a grove's aggro dulling is real (mul < 1)");
ok(pg.buildArena(pg.levelById("emberwood")).scenery.some((n) => n.kind === "grove"),
  "the Emberwood is wooded (groves seed as tactical cover)");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
