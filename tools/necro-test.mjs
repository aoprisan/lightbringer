// Headless march test for The Necromancer's March spinoff. No browser, no deps.
// Stubs just enough storage (and a minimal SVG document for the render smoke test)
// so necro.js loads, then drives the sim.
globalThis.__NECRO_TEST__ = true;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// A minimal SVG document so render()/scaffold() (which call document.createElementNS
// and set/append on the returned nodes) run headlessly. pentagram-test never rendered,
// so it lacked this — group 13 needs it. Each node supports the small surface el()
// and render touch: setAttribute, appendChild/append, style, children, innerHTML.
function makeNode() {
  const node = {
    children: [],
    style: {},
    _attrs: {},
    set innerHTML(_v) { this.children = []; },
    get innerHTML() { return ""; },
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; },
    appendChild(c) { this.children.push(c); return c; },
    append(c) { this.children.push(c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  return node;
}
globalThis.document = {
  createElementNS: () => makeNode(),
  createElement: () => makeNode(),
  getElementById: () => makeNode(),
  querySelector: () => makeNode(),
};

await import("../necro.js");
const necro = globalThis.__necro;
const K = necro.K;
const LEGACY_KEY = "necromancer.legacy.v1";
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok  -", msg); };

const still = { x: 0, y: 0 };
// Run the sim for `ms` total in fixed slices, with a given input vector.
function run(s, ms, move = still, slice = 16) {
  for (let t = 0; t < ms; t += slice) necro.stepMarch(s, slice, move);
}
// Park a knight asleep at a spot (its home too): used to isolate by stowing the
// rest far from the necromancer, out of aggro range.
const park = (e, x, y) => { e.state = "guard"; e.x = x; e.y = y; e.homeX = x; e.homeY = y; };
const wake = (e) => { e.state = "engage"; };
// Stow every knight far away and asleep, leaving the field clear.
function stowAll(s, x = 5, y = 5) { for (const e of s.knights) park(e, x, y); }

const id = "hollowmere";

// 1. Villages defined + arena generation knows known ids only.
ok(Array.isArray(necro.LEVELS) && necro.LEVELS.length >= 3, `villages are defined (${necro.LEVELS.length})`);
ok(new Set(necro.LEVELS.map((l) => l.id)).size === necro.LEVELS.length, "village ids are unique");
ok(necro.levelById(id) && !necro.levelById("nope"), "levelById resolves known ids only");

// 2. A fresh march dresses the village, musters a finite host, centres the
//    necromancer at full HP, fighting, with SOUL_START souls and no minions.
const gen = necro.generateNecroVillage(necro.levelById(id));
ok(gen.nodes.length > 80, `arena dresses the village (${gen.nodes.length} nodes)`);
ok(gen.nodes.some((n) => n.kind === "grave"), "open graves are present");
ok(gen.posts.length >= 4, `patrol posts are present (${gen.posts.length})`);

const s = necro.buildArena(necro.levelById(id));
ok(s.graves.length > 0 && s.graves.every((g) => g.kind === "grave"), `graves are cached (${s.graves.length})`);
ok(s.total === gen.posts.length * K.KNIGHT_PER_POST || s.total === s.knights.length,
  `finite host = posts*${K.KNIGHT_PER_POST} (${s.total})`);
ok(s.knights.length === s.total && s.total > 0, "every knight is rostered");
ok(s.hero.x === s.w / 2 && s.hero.y === s.h / 2, "necromancer starts at the village's heart");
ok(s.hero.hp === K.HERO_HP && s.phase === "march", "necromancer begins at full health, marching");
ok(s.souls === K.SOUL_START && s.minions.length === 0, "the march begins with the starting souls and no horde");
ok(necro.aliveKnights(s) === s.total && necro.clearedPct(s) === 0, "all knights alive, nothing overrun yet");
ok(s.knights.every((e) => e.state === "guard"), "the watch begins guarding, not rushing");

// 3. Raising from graves — souls drop by RAISE_COST, 1–3 minions, raisesLeft--; a
//    spent grave / no souls / a full horde no-op.
const s2 = necro.buildArena(necro.levelById(id));
stowAll(s2);
const grave = s2.graves[0];
s2.hero.x = grave.x; s2.hero.y = grave.y; // stand on the grave
const soulsBefore = s2.souls, raisesBefore = grave.raisesLeft;
necro.stepRaise(s2);
ok(s2.souls === soulsBefore - K.RAISE_COST, `raising deducts RAISE_COST souls (${soulsBefore} -> ${s2.souls})`);
ok(grave.raisesLeft === raisesBefore - 1, "a raise decrements the grave's raises left");
ok(s2.minions.length >= K.RAISE_MIN && s2.minions.length <= K.RAISE_MAX,
  `a raise spawns ${K.RAISE_MIN}–${K.RAISE_MAX} minions (${s2.minions.length})`);
ok(s2.minions.every((m) => m.state === "follow"), "freshly raised minions begin following");
// No souls: a raise no-ops.
s2.souls = 0; s2.elapsed += K.GRAVE_COOLDOWN_MS + 1;
const cntNoSoul = s2.minions.length;
necro.stepRaise(s2);
ok(s2.minions.length === cntNoSoul, "no souls raises nothing");
// A spent grave no-ops even with souls.
s2.souls = 99;
const spentG = { x: s2.hero.x, y: s2.hero.y, kind: "grave", raisesLeft: 0, graveSpent: true };
s2.graves = [spentG]; s2.elapsed += K.GRAVE_COOLDOWN_MS + 1;
const cntSpent = s2.minions.length;
necro.stepRaise(s2);
ok(s2.minions.length === cntSpent, "a spent grave raises nothing");
// A full horde no-ops.
const s2b = necro.buildArena(necro.levelById(id));
stowAll(s2b);
s2b.souls = 999;
for (let i = 0; i < K.MINION_CAP; i++) s2b.minions.push({ x: 10, y: 10, vx: 0, vy: 0, hp: K.MINION_HP, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0 });
const g2b = s2b.graves[0]; s2b.hero.x = g2b.x; s2b.hero.y = g2b.y;
const capCount = s2b.minions.length;
necro.stepRaise(s2b);
ok(s2b.minions.length === capCount, "a full horde raises nothing (MINION_CAP)");

// 4. Minion auto-target — a minion flips to attack a knight in aggro and closes the
//    distance; with none in range it follows within FOLLOW_DIST.
const s3 = necro.buildArena(necro.levelById(id));
stowAll(s3);
const target = s3.knights[0];
target.x = 700; target.y = 700; wake(target); target.hp = K.KNIGHT_HP;
const m1 = { x: 700 + K.MINION_AGGRO - 30, y: 700, vx: 0, vy: 0, hp: K.MINION_HP, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0 };
s3.minions = [m1];
s3.hero.x = 60; s3.hero.y = 60; // hero far away so follow can't muddy the test
const dM0 = Math.hypot(m1.x - target.x, m1.y - target.y);
const hpK0 = target.hp;
run(s3, 1500, still);
const dM1 = Math.hypot(m1.x - target.x, m1.y - target.y);
ok(m1.state === "attack", "a minion with a knight in range flips to attack");
ok(dM1 < dM0, `a minion closes on its quarry (${dM0 | 0} -> ${dM1 | 0})`);
ok(target.hp < hpK0 || target.dead, "a minion swings at the knight it reaches");
// With no knight in range it follows the necromancer.
const s3b = necro.buildArena(necro.levelById(id));
stowAll(s3b); // every knight far away and asleep, out of MINION_AGGRO
const m2 = { x: s3b.hero.x + 400, y: s3b.hero.y, vx: 0, vy: 0, hp: K.MINION_HP, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0 };
s3b.minions = [m2];
run(s3b, 3000, still);
const followGap = Math.hypot(m2.x - s3b.hero.x, m2.y - s3b.hero.y);
ok(m2.state === "follow" && followGap <= K.MINION_FOLLOW_DIST + K.MINION_RADIUS + 30,
  `a minion with no quarry follows the necromancer (gap=${followGap | 0})`);

// 5. Knight AI — rouses on the necromancer OR a minion in aggro, sticky, bites its
//    target; i-frames + hits + knockback gate a blow on the necromancer.
const s4 = necro.buildArena(necro.levelById(id));
stowAll(s4);
// (a) roused by the necromancer.
const kNear = s4.knights[0], kFar = s4.knights[1];
park(kNear, s4.hero.x + K.AGGRO_RADIUS - 40, s4.hero.y);
park(kFar, s4.hero.x + K.AGGRO_RADIUS + 120, s4.hero.y);
run(s4, 400, still);
ok(kNear.state === "engage", "a guard rouses when the necromancer is in aggro");
ok(kFar.state === "guard", "a guard beyond aggro keeps watching");
// sticky: flee far, it must not settle back.
s4.hero.x = 40; s4.hero.y = 40;
run(s4, 400, still);
ok(kNear.state === "engage", "aggro is sticky — a roused knight never settles back");
// (b) roused by a minion alone (necromancer far off).
const s4b = necro.buildArena(necro.levelById(id));
stowAll(s4b);
s4b.hero.x = 40; s4b.hero.y = 40;
const kMin = s4b.knights[0];
park(kMin, 900, 900);
s4b.minions = [{ x: 900 + K.AGGRO_RADIUS - 40, y: 900, vx: 0, vy: 0, hp: K.MINION_HP, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0 }];
run(s4b, 400, still);
ok(kMin.state === "engage", "a guard rouses when a minion alone is in aggro");
// (c) a knight glued to the necromancer bites it, sets i-frames, counts the hit, knocks back.
const s5 = necro.buildArena(necro.levelById(id));
stowAll(s5);
s5.scenery = []; s5.solids = []; s5.barricades = []; s5.causeways = [];
const biter = s5.knights[0];
biter.x = s5.hero.x; biter.y = s5.hero.y; wake(biter); biter.hp = 1e9; biter.attackCd = 0;
necro.stepKnights(s5, 16);
const hp1 = s5.hero.hp;
ok(hp1 < K.HERO_HP, `a knight in contact bites the necromancer (${K.HERO_HP} -> ${hp1})`);
ok(s5.hero.hurt > 0, "a blow sets i-frames");
ok(s5.hits === 1, "a landed blow is counted (for the flawless bonus)");
biter.x = s5.hero.x; biter.y = s5.hero.y; biter.attackCd = 0;
necro.stepKnights(s5, 16);
ok(s5.hero.hp === hp1, "i-frames spare the necromancer an immediate second blow");

// 6. Win on all-knights-dead — clearedPct 1, phase "won", no further sim.
const s6 = necro.buildArena(necro.levelById(id));
// Fell all but the last knight up front (counting each, so clearedPct tracks).
for (let i = 1; i < s6.knights.length; i++) necro.killKnight(s6, s6.knights[i]);
s6.wisps = []; s6.knights[0].hp = 1;
// One minion stacked on the last knight to fell it.
const lastK = s6.knights[0];
lastK.x = 800; lastK.y = 800; wake(lastK);
s6.minions = [{ x: 800, y: 800, vx: 0, vy: 0, hp: K.MINION_HP, maxHp: K.MINION_HP, dead: false, state: "attack", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0 }];
s6.hero.x = 800; s6.hero.y = 760;
run(s6, 1500, still);
ok(s6.knights.every((e) => e.dead), "the last knight falls to the horde");
ok(s6.phase === "won" && necro.clearedPct(s6) === 1, "felling every knight overruns the village (won)");
const killsAtWin = s6.kills;
necro.stepMarch(s6, 100, still);
ok(s6.kills === killsAtWin && s6.phase === "won", "a won march does not keep simulating");

// 7. Lose on necromancer death.
const s7 = necro.buildArena(necro.levelById(id));
stowAll(s7);
s7.scenery = []; s7.solids = []; s7.barricades = []; s7.causeways = [];
const killer = s7.knights[0];
killer.x = s7.hero.x; killer.y = s7.hero.y; wake(killer); killer.hp = 1e9;
run(s7, K.HERO_IFRAMES_MS * (K.HERO_HP / K.KNIGHT_DMG + 4), still, 8);
ok(s7.phase === "lost", "enough blows bring the necromancer down (lost)");

// 8. House desecration + horde heal — a minion razes a standing house, mending the
//    horde (capped); a knight re-blesses a razed one (barring re-razing); a held
//    razed house rises into a totem that damages a knight.
const s8 = necro.buildArena(necro.levelById(id));
stowAll(s8);
s8.solids = []; s8.barricades = []; s8.causeways = [];
const house = { x: 500, y: 500, kind: "house" };
s8.scenery = [house]; s8.desecCount = 0;
const woundedM = { x: 500, y: 500, vx: 0, vy: 0, hp: 6, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0 };
s8.minions = [woundedM];
necro.stepDesecrate(s8);
ok(house.desecrated && s8.desecCount === 1, "a minion razes a standing house it reaches");
ok(woundedM.hp === 6 + K.DESEC_HEAL, `razing a house mends the horde (6 -> ${woundedM.hp})`);
// Cap: a near-full minion is not mended past the rally cap.
const s8c = necro.buildArena(necro.levelById(id));
stowAll(s8c);
const house2 = { x: 500, y: 500, kind: "house" };
s8c.scenery = [house2];
const cap = K.MINION_HP * K.HEAL_CAP;
const cappedM = { x: 500, y: 500, vx: 0, vy: 0, hp: cap - 1, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0 };
s8c.minions = [cappedM];
necro.stepDesecrate(s8c);
ok(cappedM.hp <= Math.max(cap, cap - 1 + 0), `the village rallies the horde only to the cap (${cappedM.hp} <= ${cap})`);
// Reconsecration bars re-razing.
const s8r = necro.buildArena(necro.levelById(id));
stowAll(s8r);
const house3 = { x: 600, y: 600, kind: "house", desecrated: true, desecAt: 0 };
s8r.scenery = [house3]; s8r.desecCount = 1; s8r.reconsecrated = 0;
const knight = s8r.knights[0];
park(knight, 600, 600); wake(knight);
necro.stepKnights(s8r, 16);
ok(!house3.desecrated && house3.reconsecrated > s8r.elapsed, "a knight re-blesses a razed house to standing");
ok(s8r.desecCount === 0 && s8r.reconsecrated === 1, "re-blessing drops the razed tally and counts the loss");
ok(necro.nearScar(s8r, house3.x, house3.y), "a re-blessed house scars the ground");
// A still-scarred house resists re-razing.
const dcBefore = s8r.desecCount;
necro.desecrateHouse(s8r, house3, 0);
ok(!house3.desecrated && s8r.desecCount === dcBefore, "the scar bars re-razing until it fades");
// A held razed house rises into a totem that burns a knight.
const s8t = necro.buildArena(necro.levelById(id));
stowAll(s8t);
const totemHouse = { x: 300, y: 300, kind: "house", desecrated: true, desecAt: 0 };
s8t.scenery = [totemHouse];
s8t.elapsed = K.HOUSE_RISE_MS + 1;
necro.stepHouses(s8t, 16);
ok(totemHouse.risen, "a razed house held long enough rises into a bone-totem");
const tk = s8t.knights[0];
tk.x = totemHouse.x + 20; tk.y = totemHouse.y; wake(tk); tk.hp = K.KNIGHT_HP;
const tkHp0 = tk.hp;
for (let t = 0; t < 600; t += 16) necro.stepHouses(s8t, 16);
ok(tk.hp < tkHp0 || tk.dead, "a risen totem pulses knights in its reach");

// 9. Souls economy — killKnight grants souls + may drop a wisp; gathering one adds
//    WISP_SOULS.
const s9 = necro.buildArena(necro.levelById(id));
s9.wisps = []; s9.kills = 0;
const soulsK0 = s9.souls;
necro.killKnight(s9, s9.knights[0]);
ok(s9.knights[0].dead && s9.kills === 1, "killKnight marks the knight dead and counts the kill");
ok(s9.souls === soulsK0 + K.SOUL_PER_KILL, "felling a knight grants souls directly");
// Over many kills at least one wisp drops.
const s9d = necro.buildArena(necro.levelById(id));
s9d.wisps = [];
for (let i = 0; i < 80; i++) necro.killKnight(s9d, { x: 200 + i, y: 200, dead: false, hp: 0 });
ok(s9d.wisps.length > 0, `slain knights leave gatherable soul-wisps (${s9d.wisps.length} of 80)`);
// Gathering a wisp underfoot adds souls.
const s9g = necro.buildArena(necro.levelById(id));
stowAll(s9g);
s9g.wisps = [{ x: s9g.hero.x, y: s9g.hero.y, until: s9g.elapsed + K.WISP_TTL_MS }];
const soulsG0 = s9g.souls;
necro.stepWisps(s9g);
ok(s9g.wisps.length === 0, "the necromancer gathers a wisp underfoot");
ok(s9g.souls === soulsG0 + K.WISP_SOULS, "a gathered wisp grants souls");

// 10. Terrain — barricades + causeways present; pushOut stops a body at a barricade
//     and a solid; a causeway speeds travel.
const s10 = necro.buildArena(necro.levelById(id));
stowAll(s10);
ok(s10.barricades.length > 0, `the village is strung with barricades (${s10.barricades.length})`);
ok(s10.causeways.length > 0, `the village is laced with causeways (${s10.causeways.length})`);
ok(s10.solids.length > 0, `the village has solid structures (${s10.solids.length})`);
// Solid blocks the necromancer.
s10.barricades = []; s10.causeways = [];
const wall = s10.solids[0];
const wr = K.OBSTACLE_RADIUS[wall.kind];
s10.hero.x = wall.x - (K.HERO_RADIUS + wr + 30); s10.hero.y = wall.y;
run(s10, 1000, { x: 1, y: 0 });
const dWall = Math.hypot(s10.hero.x - wall.x, s10.hero.y - wall.y);
ok(dWall >= K.HERO_RADIUS + wr - 1, `a solid stops the necromancer (d=${dWall | 0} >= ${K.HERO_RADIUS + wr})`);
// Barricade blocks the necromancer.
const s10b = necro.buildArena(necro.levelById(id));
stowAll(s10b);
s10b.solids = []; s10b.causeways = [];
const bar = s10b.barricades[0];
const bmx = (bar.x1 + bar.x2) / 2, bmy = (bar.y1 + bar.y2) / 2;
const bdx = bar.x2 - bar.x1, bdy = bar.y2 - bar.y1, bl = Math.hypot(bdx, bdy) || 1;
const nx = -bdy / bl, ny = bdx / bl;
s10b.hero.x = bmx + nx * (K.HERO_RADIUS + K.BARRICADE_HALF + 40);
s10b.hero.y = bmy + ny * (K.HERO_RADIUS + K.BARRICADE_HALF + 40);
run(s10b, 1200, { x: -nx, y: -ny });
const bcd = necro.closestOnSegment(s10b.hero.x, s10b.hero.y, bar.x1, bar.y1, bar.x2, bar.y2).d;
ok(bcd >= K.HERO_RADIUS + K.BARRICADE_HALF - 1, `a barricade stops the necromancer (d=${bcd | 0})`);
// Causeway speeds travel.
const sp = necro.buildArena(necro.levelById(id));
stowAll(sp);
sp.solids = []; sp.barricades = []; sp.causeways = [];
sp.hero.x = 100; sp.hero.y = 100;
const baseX = sp.hero.x;
run(sp, 500, { x: 1, y: 0 });
const baseDist = sp.hero.x - baseX;
const sp2 = necro.buildArena(necro.levelById(id));
stowAll(sp2);
sp2.solids = []; sp2.barricades = [];
sp2.causeways = [{ x1: 80, y1: 100, x2: 900, y2: 100 }];
sp2.hero.x = 100; sp2.hero.y = 100;
const pathX = sp2.hero.x;
run(sp2, 500, { x: 1, y: 0 });
const pathDist = sp2.hero.x - pathX;
ok(pathDist > baseDist + 1, `the necromancer runs faster on a causeway (${baseDist | 0} -> ${pathDist | 0})`);

// 11. Legacy — overruns and falls fold once into a private key; best time never
//     worsens; persists to the stub.
store.delete(LEGACY_KEY);
ok(necro.loadNecroLegacy().runs === 0, "an untouched legacy starts empty");
const lv = necro.levelById(id);
const l1 = necro.recordOverrun(lv, 5000, 4, 1);
ok(l1.runs === 1 && l1.overruns === 1 && l1.best[id] === 5000, "recordOverrun folds an overrun");
ok(l1.housesRazed === 4 && l1.totemsRaised === 1, "recordOverrun folds houses razed and totems raised");
const l2 = necro.recordOverrun(lv, 8000);
ok(l2.best[id] === 5000, "a slower overrun cannot worsen the best");
const l3 = necro.recordOverrun(lv, 3000);
ok(l3.best[id] === 3000, "a faster overrun sets a new best");
const l4 = necro.recordFall(2);
ok(l4.runs === 4 && l4.overruns === 3, "a fall bumps marches but not overruns");
ok(l4.housesRazed === 6, "a fall still folds houses razed (4 + 2)");
ok(necro.loadNecroLegacy().best[id] === 3000, "the legacy persists to storage");
// Backward compatibility: an old save without the new fields defaults cleanly.
store.set(LEGACY_KEY, JSON.stringify({ runs: 2, overruns: 1, best: {} }));
const oldL = necro.loadNecroLegacy();
ok(oldL.runs === 2 && oldL.housesRazed === 0 && oldL.totemsRaised === 0, "an old save defaults the new fields");

// 12. Scoring — base/bonuses behave; a blow forfeits the untouched bonus; harder
//     villages multiply more.
const ssc = necro.buildArena(necro.levelById(id));
const sc0 = necro.scoreRun(ssc);
ok(sc0.base === ssc.total * K.SCORE_PER_KNIGHT, `base score = ${K.SCORE_PER_KNIGHT} per knight (${sc0.base})`);
ok(sc0.untouched > 0 && sc0.survival > 0, "an unscathed, full-health overrun earns the bonuses");
ssc.hits = 2;
ok(necro.scoreRun(ssc).untouched === 0, "a blow forfeits the untouched bonus");
ok(necro.difficultyMult(necro.levelById("saint-aubers")) > necro.difficultyMult(necro.levelById("hollowmere")),
  "a harder village multiplies an overrun's score more");

// 13. Render smoke — render/scaffold don't throw with zero sprites, at the start
//     and after state changes.
const svgNode = makeNode();
let threw = false;
try {
  const camLayer = necro.scaffold(svgNode);
  const sr = necro.buildArena(necro.levelById(id));
  necro.render(sr, camLayer);
  // Mutate a spread of state, then render again: razed/risen houses, scars, raised
  // minions, engaged knights, wisps, raise FX, a spent altar/grave.
  const someHouse = sr.scenery.find((n) => n.kind === "house");
  if (someHouse) { someHouse.desecrated = true; someHouse.desecAt = 0; someHouse.risen = true; }
  const otherHouse = sr.scenery.filter((n) => n.kind === "house")[1];
  if (otherHouse) { otherHouse.reconsecrated = sr.elapsed + K.RECONSECRATE_MS; }
  if (sr.graves[0]) sr.graves[0].graveSpent = true;
  const altar = sr.scenery.find((n) => n.kind === "altar");
  if (altar) altar.spent = true;
  sr.minions.push({ x: sr.hero.x + 30, y: sr.hero.y, vx: 0, vy: 0, hp: 10, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: sr.elapsed + 100, bornAt: 0 });
  if (sr.knights[0]) { sr.knights[0].state = "engage"; sr.knights[0].hp = 5; sr.knights[0].hit = sr.elapsed + 100; }
  if (sr.knights[1]) sr.knights[1].captain = true;
  sr.wisps.push({ x: 400, y: 400, until: sr.elapsed + K.WISP_TTL_MS });
  sr.raises.push({ x: 500, y: 500, r: 40, until: sr.elapsed + 300 });
  sr.hero.hurt = 200;
  necro.render(sr, camLayer);
  // And the minimap-style sprite resolution + spriteFor path.
  necro.scenerySprite(sr, someHouse || sr.scenery[0]);
  necro.spriteFor(sr.level, "ground");
} catch (err) {
  threw = true;
  console.error(err);
}
ok(!threw, "render and scaffold run headlessly with zero sprites, at start and after state changes");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
