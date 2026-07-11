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

// 3. Raising from graves — only beneath an inscribed pentagram (stand still). Souls
//    drop by RAISE_COST, 1–3 minions, raisesLeft--; a not-yet-inscribed sigil / spent
//    grave / no souls / a full horde no-op.
const s2 = necro.buildArena(necro.levelById(id));
stowAll(s2);
const grave = s2.graves[0];
s2.hero.x = grave.x; s2.hero.y = grave.y; // stand on the grave
// A grave underfoot but a fading sigil (charge below the raise threshold) raises nothing.
s2.hero.charge = K.PENTA_RAISE_AT - 0.01;
necro.stepRaise(s2);
ok(s2.minions.length === 0, "a faint (uninscribed) sigil raises nothing, even on a grave");
s2.hero.charge = 1; // sigil fully inscribed (the necromancer held still)
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
s2b.hero.charge = 1; // sigil inscribed — so the cap, not the sigil, is what holds it back
const capCount = s2b.minions.length;
necro.stepRaise(s2b);
ok(s2b.minions.length === capCount, "a full horde raises nothing (MINION_CAP)");

// 3b. The stand-still gate end-to-end through stepMarch: marching past a grave with
//     a steady input never inscribes the sigil (charge stays low), so the dead don't
//     rise; halting over a grave inscribes it and then raises.
const sMarch = necro.buildArena(necro.levelById(id));
stowAll(sMarch);
const gMarch = sMarch.graves[0];
sMarch.hero.x = gMarch.x; sMarch.hero.y = gMarch.y; sMarch.souls = 99;
const marching = { x: 1, y: 0 }; // a full-tilt march
run(sMarch, 600, marching);      // sweeps off the grave, sigil never inscribes
ok(sMarch.hero.charge < K.PENTA_RAISE_AT, `a marching necromancer's sigil stays faint (${sMarch.hero.charge.toFixed(2)})`);
const sHold = necro.buildArena(necro.levelById(id));
stowAll(sHold);
const gHold = sHold.graves[0];
sHold.hero.x = gHold.x; sHold.hero.y = gHold.y; sHold.souls = 99;
run(sHold, 1200, still);         // hold still over the grave
ok(sHold.hero.charge >= K.PENTA_RAISE_AT, `holding still inscribes the sigil (${sHold.hero.charge.toFixed(2)})`);
ok(sHold.minions.length >= K.RAISE_MIN, `an inscribed sigil over a grave raises the dead (${sHold.minions.length})`);

// 3c. The pentagram geometry: five points, closed path, distinct vertices.
const pp = necro.pentagramPath(100, 100, 50, 0);
ok(pp.startsWith("M") && pp.trimEnd().endsWith("Z"), "pentagramPath is a closed path");
ok((pp.match(/L/g) || []).length === 4, "pentagramPath strings the five star points");

// 4. Minion auto-target — a minion flips to attack a knight in aggro and closes the
//    distance; with none in range it follows within FOLLOW_DIST.
const s3 = necro.buildArena(necro.levelById(id));
stowAll(s3);
s3.solids = []; s3.barricades = []; // clear scattered terrain so the lone minion's path is deterministic
const target = s3.knights[0];
target.x = 700; target.y = 700; wake(target); target.hp = K.KNIGHT_HP;
// Start the minion inside aggro with a clear gap to close — comfortably reachable
// within the run window once the path is unobstructed.
const m1 = { x: 700 + 180, y: 700, vx: 0, vy: 0, hp: K.MINION_HP, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0 };
s3.minions = [m1];
s3.hero.x = 60; s3.hero.y = 60; // hero far away so follow can't muddy the test
const dM0 = Math.hypot(m1.x - target.x, m1.y - target.y);
const hpK0 = target.hp;
run(s3, 2000, still);
const dM1 = Math.hypot(m1.x - target.x, m1.y - target.y);
ok(m1.state === "attack", "a minion with a knight in range flips to attack");
ok(dM1 < dM0, `a minion closes on its quarry (${dM0 | 0} -> ${dM1 | 0})`);
ok(target.hp < hpK0 || target.dead, "a minion swings at the knight it reaches");
// With no knight in range it follows the necromancer.
const s3b = necro.buildArena(necro.levelById(id));
stowAll(s3b); // every knight far away and asleep, out of MINION_AGGRO
s3b.solids = []; s3b.barricades = []; // clear scattered terrain so the lone minion's follow path is deterministic
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

// 5b. Priests — a chantry caster that channels mana, then LOCKS a skeleton and a
//     beam builds (the windup telegraph) before the kill. Two counters break the
//     rite — crowding (slows the channel) and a body-block — and it never harms the
//     necromancer's own life.
const mkMinion = (x, y) => ({ x, y, vx: 0, vy: 0, hp: K.MINION_HP, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0, variant: "grave" });
const sP = necro.buildArena(necro.levelById("saint-aubers"));
ok(sP.knights.some((e) => e.priest), "the chantry-town musters priests");
stowAll(sP);
sP.scenery = []; sP.solids = []; sP.barricades = []; sP.causeways = [];
const priest = sP.knights.find((e) => e.priest) ?? sP.knights[0];
priest.priest = true; wake(priest); priest.x = 800; priest.y = 800; priest.mana = 0;
sP.hero.x = 50; sP.hero.y = 50; // necromancer far off, out of the way
const prey = mkMinion(800 + K.PRIEST_SMITE_RANGE - 20, 800);
sP.minions = [prey]; sP.elapsed = 0;
necro.stepKnights(sP, 16); // not yet charged
ok(!prey.dead && (priest.mana ?? 0) > 0, "an uncharged priest only channels — the skeleton lives");
priest.mana = 1; // fully charged
necro.stepKnights(sP, 16); // locks a target, the beam begins to build
ok(!prey.dead && priest.smiteUntil != null && priest.smiteTarget === prey,
  "a charged priest LOCKS the nearest skeleton — the smite doesn't land instantly");
necro.stepKnights(sP, 16); // still mid-windup (s.elapsed hasn't reached the deadline)
ok(!prey.dead, "the locked smite holds through its window — a reaction window to read");
sP.elapsed = priest.smiteUntil + 1; // the windup elapses
necro.stepKnights(sP, 16);
ok(prey.dead, "after the windup the priest unmakes the locked skeleton");
ok((priest.mana ?? 0) === 0 && priest.smiteUntil == null, "a landed smite spends the priest's mana (recharges from empty)");
ok(sP.smites.length >= 1, "a smite leaves a holy-flash FX");

// Body-block — the necromancer on the building beam foils the smite, sparing the
// skeleton at no cost to its own life.
const sPb = necro.buildArena(necro.levelById("saint-aubers"));
stowAll(sPb); sPb.scenery = []; sPb.solids = []; sPb.barricades = []; sPb.causeways = [];
const prB = sPb.knights.find((e) => e.priest) ?? sPb.knights[0];
prB.priest = true; wake(prB); prB.x = 800; prB.y = 800; prB.mana = 1;
const preyB = mkMinion(800 + K.PRIEST_SMITE_RANGE - 20, 800);
sPb.minions = [preyB]; sPb.elapsed = 0;
sPb.hero.x = 5000; sPb.hero.y = 5000; // off the beam while it locks
necro.stepKnights(sPb, 16); // locks
sPb.hero.x = 900; sPb.hero.y = 800; // step onto the beam (the priest→skeleton line)
sPb.elapsed = prB.smiteUntil + 1; // even past the deadline, a blocked beam fails
necro.stepKnights(sPb, 16);
ok(!preyB.dead && prB.smiteUntil == null && (prB.mana ?? 0) === 0,
  "the necromancer body-blocking the beam foils the smite (skeleton spared, rite spent)");
ok(sPb.hero.hp === K.HERO_HP, "body-blocking a smite costs the necromancer no life");

// A crowded priest channels slower than a lone one (its concentration breaks).
const mkPriestState = () => {
  const ss = necro.buildArena(necro.levelById("saint-aubers"));
  stowAll(ss); ss.scenery = []; ss.solids = []; ss.barricades = []; ss.causeways = [];
  const pr = ss.knights.find((e) => e.priest) ?? ss.knights[0];
  pr.priest = true; wake(pr); pr.x = 800; pr.y = 800; pr.mana = 0;
  ss.hero.x = 50; ss.hero.y = 50; ss.elapsed = 0;
  return { ss, pr };
};
const lone = mkPriestState(); lone.ss.minions = [];
const crowd = mkPriestState();
crowd.ss.minions = [mkMinion(800, 800), mkMinion(810, 805), mkMinion(795, 808), mkMinion(805, 795)];
necro.stepKnights(lone.ss, 16);
necro.stepKnights(crowd.ss, 16);
ok((crowd.pr.mana ?? 0) < (lone.pr.mana ?? 0) && (crowd.pr.mana ?? 0) > 0,
  "skeletons crowding a priest slow its channel (the 'mass and rush' counter is real)");

// A skeleton out of smite range survives a charged priest.
const sP3 = necro.buildArena(necro.levelById("saint-aubers"));
stowAll(sP3);
const pr3 = sP3.knights.find((e) => e.priest) ?? sP3.knights[0];
pr3.priest = true; wake(pr3); pr3.x = 800; pr3.y = 800; pr3.mana = 1;
sP3.hero.x = 50; sP3.hero.y = 50;
const farPrey = mkMinion(800 + K.PRIEST_SMITE_RANGE + 80, 800);
sP3.minions = [farPrey];
necro.stepKnights(sP3, 16);
ok(!farPrey.dead && (pr3.mana ?? 0) >= 1 && pr3.smiteUntil == null,
  "a priest holds its charge (and locks nothing) when no skeleton is in range");
// A priest never bites the necromancer, even glued to it.
const sP2 = necro.buildArena(necro.levelById("saint-aubers"));
stowAll(sP2);
sP2.scenery = []; sP2.solids = []; sP2.barricades = []; sP2.causeways = [];
const pr2 = sP2.knights.find((e) => e.priest) ?? sP2.knights[0];
pr2.priest = true; wake(pr2); pr2.mana = 1;
pr2.x = sP2.hero.x; pr2.y = sP2.hero.y; // glued to the necromancer
sP2.minions = [];
const hpBefore = sP2.hero.hp;
run(sP2, 600, still);
ok(sP2.hero.hp === hpBefore && sP2.hits === 0, "a priest never bites the necromancer (no HP loss, no hit)");

// 5b. Crossbowmen — the ranged arm. A crossbowman never melees: it holds a standoff
//     and looses a dodgeable bolt at the nearest threat. The counters are line of
//     sight (a barricade stops a bolt and makes it hold fire) and movement.
const sX = necro.buildArena(necro.levelById("saint-aubers"));
ok(sX.knights.some((e) => e.crossbow), "the chantry-town musters crossbowmen");
stowAll(sX); sX.scenery = []; sX.solids = []; sX.barricades = []; sX.causeways = []; sX.graves = [];
const xb = sX.knights.find((e) => e.crossbow) ?? sX.knights[0];
xb.crossbow = true; wake(xb); xb.x = 800; xb.y = 800; xb.shootCd = 0;
// At a holding range (between standoff and max range) it looses a bolt at the hero.
sX.hero.x = 800 + 250; sX.hero.y = 800; sX.minions = []; sX.elapsed = 0;
necro.stepMarch(sX, 16, still);
ok(sX.bolts.length === 1, "a crossbowman at range looses a bolt");
const hpX0 = sX.hero.hp;
run(sX, 900, still); // long enough for the bolt to land, short of the next reload
ok(sX.hero.hp < hpX0 && sX.hits >= 1, "a loosed bolt flies and strikes the necromancer");
ok(sX.bolts.length === 0, "a bolt is consumed when it strikes (or fades)");

// Standoff — a threat inside CROSSBOW_STANDOFF makes it kite away, never closing to
// melee; a threat past CROSSBOW_RANGE makes it close the gap.
const sX2 = necro.buildArena(necro.levelById("saint-aubers"));
stowAll(sX2); sX2.scenery = []; sX2.solids = []; sX2.barricades = []; sX2.causeways = [];
const xb2 = sX2.knights.find((e) => e.crossbow) ?? sX2.knights[0];
xb2.crossbow = true; wake(xb2); xb2.x = 800; xb2.y = 800; xb2.shootCd = 0;
sX2.hero.x = 800 + 40; sX2.hero.y = 800; sX2.minions = []; // well inside standoff
necro.stepKnights(sX2, 16);
ok(xb2.vx * (sX2.hero.x - xb2.x) + xb2.vy * (sX2.hero.y - xb2.y) < 0, "a crossbowman kites away from a near threat (no melee rush)");
xb2.x = 800; xb2.y = 800; sX2.hero.x = 800 + (K.CROSSBOW_RANGE + 120); // out past max range
necro.stepKnights(sX2, 16);
ok(xb2.vx * (sX2.hero.x - xb2.x) + xb2.vy * (sX2.hero.y - xb2.y) > 0, "a crossbowman closes on a far threat to bring it in range");

// A barricade between holds the crossbowman's fire, and physically stops a bolt.
const sX3 = necro.buildArena(necro.levelById("saint-aubers"));
stowAll(sX3); sX3.scenery = []; sX3.solids = []; sX3.causeways = []; sX3.graves = [];
const xb3 = sX3.knights.find((e) => e.crossbow) ?? sX3.knights[0];
xb3.crossbow = true; wake(xb3); xb3.x = 800; xb3.y = 800; xb3.shootCd = 0;
sX3.hero.x = 1000; sX3.hero.y = 800; sX3.minions = []; sX3.bolts = [];
sX3.barricades = [{ x1: 900, y1: 760, x2: 900, y2: 840 }]; // a wall on the line
necro.stepKnights(sX3, 16);
ok(sX3.bolts.length === 0, "a crossbowman holds fire when a barricade blocks line of sight");
sX3.bolts = [{ x: 800, y: 800, vx: K.BOLT_SPEED, vy: 0, dmg: K.BOLT_DMG, until: 1e9 }];
const hpX3 = sX3.hero.hp;
run(sX3, 1200, still);
ok(sX3.hero.hp === hpX3 && sX3.bolts.length === 0, "a bolt is stopped by a barricade (the necromancer behind it is spared)");

// A bolt passes through the necromancer during i-frames (no double-hit).
const sX4 = necro.buildArena(necro.levelById("saint-aubers"));
stowAll(sX4); sX4.scenery = []; sX4.solids = []; sX4.barricades = []; sX4.causeways = [];
sX4.minions = [];
sX4.hero.x = 900; sX4.hero.y = 900; sX4.hero.hurt = K.HERO_IFRAMES_MS;
sX4.bolts = [{ x: 900 - 20, y: 900, vx: K.BOLT_SPEED, vy: 0, dmg: K.BOLT_DMG, until: 1e9 }];
const hpX4 = sX4.hero.hp;
necro.stepBolts(sX4, 16);
ok(sX4.hero.hp === hpX4, "a bolt does not bite the necromancer mid-i-frames");

// 5c. Standard-bearers — the support. A bearer's banner rallies the watch around it:
//     rallied knights swing faster, bite harder, and slowly mend. Fell the bearer
//     and the buff collapses ("kill the support first").
const sB = necro.buildArena(necro.levelById("saint-aubers"));
ok(sB.knights.some((e) => e.banner), "the chantry-town musters standard-bearers");
stowAll(sB); sB.scenery = []; sB.solids = []; sB.barricades = []; sB.causeways = [];
sB.hero.x = 50; sB.hero.y = 50; sB.minions = [];
const bearer = sB.knights.find((e) => e.banner) ?? sB.knights[0];
bearer.banner = true; bearer.x = 800; bearer.y = 800;
const ally = sB.knights.find((e) => !e.banner && !e.priest && !e.crossbow && e !== bearer) ?? sB.knights[1];
ally.banner = false; ally.priest = false; ally.crossbow = false;
ally.x = 880; ally.y = 800; ally.hp = ally.maxHp - 10; wake(ally); // within BANNER_RADIUS, wounded
const allyHp0 = ally.hp;
necro.stepKnights(sB, 16);
ok(ally.rallied === true, "a knight in the bearer's aura is rallied");
ok(ally.hp > allyHp0, "a rallied knight slowly mends");
ok(bearer.rallied === false, "a bearer does not rally itself");
// Fell the bearer — the rally collapses.
bearer.dead = true;
necro.stepKnights(sB, 16);
ok(ally.rallied === false, "felling the bearer collapses the rally");

// A rallied swing bites harder and recovers faster than a plain one.
function bannerSwing(rallied) {
  const ss = necro.buildArena(necro.levelById("saint-aubers"));
  stowAll(ss); ss.scenery = []; ss.solids = []; ss.barricades = []; ss.causeways = [];
  ss.hero.x = 50; ss.hero.y = 50;
  const br = ss.knights.find((e) => e.banner) ?? ss.knights[0];
  br.banner = true; br.dead = !rallied; br.x = 800; br.y = 800; // a live bearer only when rallied
  const kn = ss.knights.find((e) => !e.banner && e !== br) ?? ss.knights[1];
  kn.banner = false; kn.priest = false; kn.crossbow = false; kn.captain = false;
  kn.x = 850; kn.y = 800; kn.attackCd = 0; wake(kn);
  const m = mkMinion(850, 800); ss.minions = [m]; // a target in reach
  necro.stepKnights(ss, 16);
  return { dmg: K.MINION_HP - m.hp, cd: kn.attackCd };
}
const plain = bannerSwing(false), buffed = bannerSwing(true);
ok(buffed.dmg > plain.dmg, "a rallied knight's swing bites harder");
ok(buffed.cd < plain.cd && plain.cd > 0, "a rallied knight recovers faster between swings");

// 5d. Menders — the backline chaplain. A mender never melees: it holds a standoff
//     and channels a strong single-target heal into the most-wounded knight in range.
const sM = necro.buildArena(necro.levelById("saint-aubers"));
ok(sM.knights.some((e) => e.mender), "the chantry-town musters menders");
stowAll(sM); sM.scenery = []; sM.solids = []; sM.barricades = []; sM.causeways = [];
sM.hero.x = 50; sM.hero.y = 50; sM.minions = [];
const md = sM.knights.find((e) => e.mender) ?? sM.knights[0];
md.mender = true; wake(md); md.x = 800; md.y = 800;
const wounded = sM.knights.find((e) => !e.mender && e !== md) ?? sM.knights[1];
wounded.mender = false; wounded.x = 800 + 150; wounded.y = 800; wounded.hp = wounded.maxHp - 30;
const woundedHp0 = wounded.hp;
necro.stepKnights(sM, 16);
ok(md.mending === true, "a mender channels into a wounded knight in range");
ok(wounded.hp > woundedHp0, "a mender heals its mark");
// It kites away from a near threat rather than closing to melee.
md.x = 800; md.y = 800; sM.hero.x = 840; sM.hero.y = 800; // inside MENDER_STANDOFF
necro.stepKnights(sM, 16);
ok(md.vx * (sM.hero.x - md.x) + md.vy * (sM.hero.y - md.y) < 0, "a mender kites from a near threat (no melee rush)");
// A mender never bites the necromancer, even glued to it.
const sM2 = necro.buildArena(necro.levelById("saint-aubers"));
stowAll(sM2); sM2.scenery = []; sM2.solids = []; sM2.barricades = []; sM2.causeways = []; sM2.graves = [];
sM2.minions = [];
const md2 = sM2.knights.find((e) => e.mender) ?? sM2.knights[0];
md2.mender = true; wake(md2); md2.x = sM2.hero.x; md2.y = sM2.hero.y;
const mHp0 = sM2.hero.hp;
run(sM2, 600, still);
ok(sM2.hero.hp === mHp0 && sM2.hits === 0, "a mender never bites the necromancer");

// 5e. Paladins — the wall. A paladin's plate shaves a flat amount off every blow
//     (to a floor, so it is still mortal); every other knight takes the blow whole.
const sPal = necro.buildArena(necro.levelById("saint-aubers"));
ok(sPal.knights.some((e) => e.paladin), "the chantry-town musters paladins");
const pal = sPal.knights.find((e) => e.paladin) ?? sPal.knights[0];
const com = sPal.knights.find((e) => !e.paladin) ?? sPal.knights[1];
pal.paladin = true; com.paladin = false;
pal.hp = 100; pal.maxHp = 100; pal.dead = false;
com.hp = 100; com.maxHp = 100; com.dead = false;
necro.hurtKnight(sPal, pal, 10);
necro.hurtKnight(sPal, com, 10);
ok(100 - pal.hp === 10 - K.PALADIN_ARMOR, "a paladin's plate shaves a flat amount off each blow");
ok(100 - com.hp === 10, "a common knight takes the blow whole");
pal.hp = 100;
necro.hurtKnight(sPal, pal, 2); // a blow under the armour
ok(100 - pal.hp === K.PALADIN_MIN_DMG, "even a blow under the armour still lands the floor (mortal)");
pal.hp = K.PALADIN_MIN_DMG;
necro.hurtKnight(sPal, pal, 3);
ok(pal.dead, "a paladin still falls when its plate is worn through");

// 5f. Marshals — the cavalry. Off cooldown and with a target in range, a marshal
//     locks a heading and DASHES; the impact deals heavy damage and a long knockback.
const sF = necro.buildArena(necro.levelById("gallows-fen"));
ok(sF.knights.some((e) => e.marshal), "gallows fen musters marshals");
stowAll(sF); sF.scenery = []; sF.solids = []; sF.barricades = []; sF.causeways = []; sF.graves = [];
sF.minions = [];
const mar = sF.knights.find((e) => e.marshal) ?? sF.knights[0];
mar.marshal = true; wake(mar); mar.x = 800; mar.y = 800; mar.chargeCd = 0; mar.chargeMs = 0;
sF.hero.x = 800 + 200; sF.hero.y = 800; sF.hero.hp = K.HERO_HP; sF.hero.hurt = 0;
necro.stepKnights(sF, 16);
ok((mar.chargeMs ?? 0) > 0, "a marshal off cooldown locks a charge at a target in range");
const hx0 = sF.hero.x, fhp0 = sF.hero.hp;
run(sF, 700, still); // the dash lands its impact
ok(sF.hero.hp <= fhp0 - K.MARSHAL_IMPACT_DMG, "a marshal's charge impact deals heavy damage");
ok(sF.hero.x > hx0, "a charge impact knocks the necromancer back");
ok((mar.chargeCd ?? 0) > 0 && (mar.chargeMs ?? 0) === 0, "after a charge the marshal recovers (on cooldown)");

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

// 12b. Raising-rites — the unlockable pentagrams, each calling up its own skeleton.
ok(Array.isArray(necro.RAISE_TYPES) && necro.RAISE_TYPES.length >= 3, `rites are defined (${necro.RAISE_TYPES.length})`);
ok(new Set(necro.RAISE_TYPES.map((t) => t.id)).size === necro.RAISE_TYPES.length, "rite ids are unique");
const starter = necro.RAISE_TYPES[0];
ok(starter.cost === 0, "the starter rite costs nothing (always owned)");
ok(necro.raiseTypeById("grave").id === "grave" && necro.raiseTypeById("nope").id === starter.id,
  "raiseTypeById resolves known ids, falls back to the starter");

// A fresh build equips the starter by default; the raised skeleton carries its variant.
necro.saveNecroLegacy(necro.emptyNecroLegacy());
const sg = necro.buildArena(necro.levelById(id));
ok(sg.rite.id === "grave", "a fresh march equips the starter rite by default");
stowAll(sg);
const gg = sg.graves[0]; sg.hero.x = gg.x; sg.hero.y = gg.y; sg.souls = 99; sg.hero.charge = 1;
necro.stepRaise(sg);
ok(sg.minions.length > 0 && sg.minions.every((m) => m.variant === "grave"), "the starter raises footsoldiers (variant grave)");

// Equipping a heavier rite changes the raise: tougher skeletons, dearer in souls.
const barrow = necro.RAISE_TYPES.find((t) => t.id === "barrow");
const l0 = necro.loadNecroLegacy();
l0.unlocked = ["grave", "barrow"]; l0.equipped = "barrow"; necro.saveNecroLegacy(l0);
const sb = necro.buildArena(necro.levelById(id));
ok(sb.rite.id === "barrow", "the equipped rite resolves onto the march");
stowAll(sb);
const gb = sb.graves[0]; sb.hero.x = gb.x; sb.hero.y = gb.y; sb.souls = 99; sb.hero.charge = 1;
const soulsB = sb.souls;
necro.stepRaise(sb);
const expectHp = Math.round(K.MINION_HP * barrow.hpMul);
ok(sb.minions.length > 0 && sb.minions.every((m) => m.variant === "barrow" && m.maxHp === expectHp),
  `the barrow rite raises tougher bone (hp ${expectHp} vs ${K.MINION_HP})`);
ok(soulsB - sb.souls === Math.max(1, Math.round(K.RAISE_COST * barrow.soulMul)),
  "a dearer rite spends more souls per raise pulse");

// Economy: learn a rite only when owned-less and affordable; equip only what's owned.
necro.saveNecroLegacy(necro.emptyNecroLegacy());
let le = necro.unlockRite("barrow");
ok(!le.unlocked.includes("barrow"), "a rite can't be learned with no relics");
le = necro.loadNecroLegacy(); le.relics = 1000; necro.saveNecroLegacy(le);
le = necro.unlockRite("barrow");
ok(le.unlocked.includes("barrow") && le.relics === 1000 - barrow.cost, "learning a rite deducts its relics");
le = necro.equipRite("cairn");
ok(le.equipped !== "cairn", "an unowned rite can't be equipped");
le = necro.equipRite("barrow");
ok(le.equipped === "barrow", "an owned rite equips");

// Relics bank from marches: an overrun banks score/RELIC_SCORE_DIV, a fall banks
// per knight felled.
necro.saveNecroLegacy(necro.emptyNecroLegacy());
const ow = necro.recordOverrun(necro.levelById(id), 1000, 0, 0, 17);
ok(ow.relics === 17, "an overrun banks its relics");
const fl = necro.recordFall(0, 0, 4);
ok(fl.relics === 21, "a fall banks the relics of the fallen on top");

// Restore a clean legacy so the render smoke-test below starts from the starter.
necro.saveNecroLegacy(necro.emptyNecroLegacy());

// 12c. Overcharge — standing still PAST a full inscription banks an overcharge; the
//      next raise spends extra souls to add a champion, then resets. Moving spends it.
necro.saveNecroLegacy(necro.emptyNecroLegacy()); // plain rite + No Pact
{
  const so = necro.buildArena(necro.levelById(id));
  stowAll(so); so.scenery = []; so.solids = []; so.barricades = []; so.causeways = [];
  const g = { kind: "grave", x: so.hero.x, y: so.hero.y, raisesLeft: K.GRAVE_RAISES, graveSpent: false, desecAt: undefined };
  so.graves = []; so.souls = 50; so.minions = []; // no grave yet, so nothing consumes the bank
  // A held stand past a full inscription banks the overcharge (over PENTA_OVERCHARGE_MS).
  run(so, K.PENTA_CHARGE_MS + K.PENTA_OVERCHARGE_MS + 200, still);
  ok(so.hero.charge >= 1 && so.hero.overcharge >= 1, "standing still past a full inscription banks an overcharge");
  // Empowered raise: spend the extra souls, add exactly one champion, reset overcharge.
  so.graves = [g]; g.desecAt = -1e9; so.minions = []; so.hero.overcharge = 1; so.hero.charge = 1;
  const souls0 = so.souls;
  necro.stepRaise(so);
  const champs = so.minions.filter((m) => m.champion);
  ok(champs.length === 1, "an overcharged raise calls up exactly one champion");
  ok(so.hero.overcharge === 0, "an empowered raise spends the banked overcharge");
  ok(souls0 - so.souls >= K.OVERCHARGE_EXTRA_COST + 1, "an empowered raise spends the extra souls");
  ok(champs[0].maxHp > K.MINION_HP, "a champion stands with leaned (higher) hp");
  // Control: no overcharge → an ordinary raise, no champion.
  g.desecAt = -1e9; so.hero.overcharge = 0; so.hero.charge = 1; so.minions = [];
  necro.stepRaise(so);
  ok(so.minions.length > 0 && !so.minions.some((m) => m.champion), "a raise without overcharge calls up no champion");
}
{
  // Marching spends a banked overcharge back to nothing.
  const sm = necro.buildArena(necro.levelById(id));
  sm.hero.charge = 1; sm.hero.overcharge = 1;
  necro.stepMarch(sm, 16, { x: 1, y: 0 });
  ok(sm.hero.overcharge === 0, "marching spends the banked overcharge");
}

// 12d. Death-mote frenzy — a felled knight may drop a death-mote; gathering it
//      frenzies the WHOLE horde (faster, harder swings) for a window, then it reverts.
{
  const sf = necro.buildArena(necro.levelById(id));
  sf.motes = [{ x: sf.hero.x, y: sf.hero.y, until: sf.elapsed + K.MOTE_TTL_MS }];
  necro.stepMotes(sf);
  ok(sf.hero.frenzyUntil > sf.elapsed, "gathering a death-mote frenzies the horde");
  ok(sf.motes.length === 0, "a gathered death-mote is consumed");
}
function minionSwing(frenzied) {
  const s = necro.buildArena(necro.levelById(id));
  stowAll(s); s.scenery = []; s.solids = []; s.barricades = []; s.causeways = []; s.graves = [];
  s.hero.frenzyUntil = frenzied ? s.elapsed + K.FRENZY_MS : 0;
  const e = s.knights[0]; wake(e); e.x = 800; e.y = 800; e.hp = 1000; e.maxHp = 1000; e.paladin = false;
  const m = { x: 800, y: 800, vx: 0, vy: 0, hp: K.MINION_HP, maxHp: K.MINION_HP, dead: false, state: "attack", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0, variant: "grave" };
  s.minions = [m];
  const hp0 = e.hp;
  necro.stepMinions(s, 16);
  return { dmg: hp0 - e.hp, cd: m.attackCd };
}
const calm = minionSwing(false), wild = minionSwing(true);
ok(wild.dmg > calm.dmg, "a frenzied minion bites harder");
ok(wild.cd < calm.cd && calm.cd > 0, "a frenzied minion swings faster (shorter cooldown)");

// 12e. Perks — one passive bargain per march, bought with relics; resolved at build.
necro.saveNecroLegacy(necro.emptyNecroLegacy());
{
  let lp = necro.loadNecroLegacy();
  ok(lp.perksUnlocked.includes("none") && lp.perkEquipped === "none", "a fresh legacy owns and equips No Pact");
  necro.unlockPerk("gravecaller");
  ok(!necro.loadNecroLegacy().perksUnlocked.includes("gravecaller"), "a perk can't be struck with no relics");
  lp = necro.loadNecroLegacy(); lp.relics = 1000; necro.saveNecroLegacy(lp);
  const gc = necro.PERKS.find((p) => p.id === "gravecaller");
  necro.unlockPerk("gravecaller");
  lp = necro.loadNecroLegacy();
  ok(lp.perksUnlocked.includes("gravecaller") && lp.relics === 1000 - gc.cost, "striking a pact deducts its relics");
  necro.equipPerk("gravecaller");
  ok(necro.loadNecroLegacy().perkEquipped === "gravecaller", "a struck perk equips");
  const sg = necro.buildArena(necro.levelById(id));
  ok(sg.souls === K.SOUL_START + 3, "Gravecaller starts the march with extra souls");
  // Swift Dead: the horde travels faster (resolved into perkMods).
  lp = necro.loadNecroLegacy(); lp.perksUnlocked.push("swift"); lp.perkEquipped = "swift"; necro.saveNecroLegacy(lp);
  ok(necro.buildArena(necro.levelById(id)).perkMods.minionSpeedMul > 1, "Swift Dead hastens the horde's travel");
  // Carrion Feast: razing wrings an extra soul and deepens the mend.
  lp = necro.loadNecroLegacy(); lp.perksUnlocked.push("carrion"); lp.perkEquipped = "carrion"; necro.saveNecroLegacy(lp);
  const sc = necro.buildArena(necro.levelById(id));
  sc.minions = [{ x: 0, y: 0, vx: 0, vy: 0, hp: 1, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0, variant: "grave" }];
  const house = sc.scenery.find((n) => n.kind === "house" && !n.desecrated);
  const csouls0 = sc.souls, chp0 = sc.minions[0].hp;
  necro.desecrateHouse(sc, house, K.DESEC_HEAL);
  ok(sc.souls - csouls0 === K.SOUL_PER_RAZE + 1, "Carrion Feast wrings an extra soul from a razing");
  ok(sc.minions[0].hp - chp0 > K.DESEC_HEAL, "Carrion Feast deepens the razing mend");
}
necro.saveNecroLegacy(necro.emptyNecroLegacy()); // clean again for the render smoke test

// 12f. Rites with on-death powers — a Plague skeleton bursts into a gnawing miasma
//      when it falls; the Bone Colossus rite raises a single towering minion.
{
  const sp = necro.buildArena(necro.levelById(id));
  stowAll(sp); sp.scenery = []; sp.solids = []; sp.barricades = []; sp.causeways = []; sp.graves = [];
  const plagueM = { x: 700, y: 700, vx: 0, vy: 0, hp: 5, maxHp: K.MINION_HP, dead: false, state: "attack", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0, variant: "plague" };
  sp.minions = [plagueM];
  necro.killMinion(sp, plagueM);
  ok(plagueM.dead && sp.miasmas.length === 1, "a fallen Plague skeleton bursts into a miasma");
  const plainM = { x: 700, y: 700, vx: 0, vy: 0, hp: 5, maxHp: K.MINION_HP, dead: false, state: "attack", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0, variant: "grave" };
  sp.minions = [plainM]; const before = sp.miasmas.length;
  necro.killMinion(sp, plainM);
  ok(sp.miasmas.length === before, "a plain skeleton leaves no miasma");
  // The miasma gnaws a knight standing in it; one outside is spared.
  const near = sp.knights[0]; near.dead = false; near.paladin = false; near.x = 700; near.y = 700; near.hp = 100; near.maxHp = 100;
  const far = sp.knights[1]; far.dead = false; far.x = 700 + K.PLAGUE_CLOUD_R + 50; far.y = 700; far.hp = 100; far.maxHp = 100;
  const nhp0 = near.hp, fhp0 = far.hp;
  necro.stepMiasma(sp, 200);
  ok(near.hp < nhp0, "a death-miasma gnaws a knight standing in it");
  ok(far.hp === fhp0, "a knight outside the miasma is spared");
}

// 12f½. The fallen are pruned — killMinion only flags a corpse (so on-death powers
//       fire once); the next march step drops it from the array, so a long march's
//       horde never grows into a boneyard.
{
  const spr = necro.buildArena(necro.levelById(id));
  stowAll(spr); spr.scenery = []; spr.solids = []; spr.barricades = []; spr.causeways = []; spr.graves = [];
  for (const e of spr.knights) e.dead = true; // an empty field: nothing swings back
  const mkm = (x) => ({ x, y: 700, vx: 0, vy: 0, hp: K.MINION_HP, maxHp: K.MINION_HP, dead: false, state: "follow", targetIdx: -1, attackCd: 0, hit: 0, bornAt: 0, variant: "grave" });
  const mA = mkm(700), mB = mkm(730);
  spr.minions = [mA, mB];
  necro.killMinion(spr, mA);
  ok(mA.dead && spr.minions.length === 2, "killMinion flags the corpse in place");
  necro.stepMarch(spr, 16, still);
  ok(spr.minions.length === 1 && spr.minions[0] === mB, "the next march step prunes the fallen from the horde");
}
{
  // The Bone Colossus rite raises a single towering minion (count forced to 1).
  const lc = necro.loadNecroLegacy(); lc.unlocked.push("colossus"); lc.equipped = "colossus"; necro.saveNecroLegacy(lc);
  const sc = necro.buildArena(necro.levelById(id));
  stowAll(sc); sc.scenery = []; sc.solids = []; sc.barricades = []; sc.causeways = [];
  const g = { kind: "grave", x: sc.hero.x, y: sc.hero.y, raisesLeft: K.GRAVE_RAISES, graveSpent: false, desecAt: -1e9 };
  sc.graves = [g]; sc.souls = 50; sc.minions = []; sc.hero.charge = 1; sc.hero.overcharge = 0;
  necro.stepRaise(sc);
  ok(sc.minions.length === 1, "the Bone Colossus rite raises a single minion");
  ok(sc.minions[0].maxHp > K.MINION_HP * 2, "the colossus stands with towering hp");
  necro.saveNecroLegacy(necro.emptyNecroLegacy());
}

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


// ---------- The Covenant — the cross-game boon (deeper soul-stores) ----------
const COV_KEY = "lightbringer.covenant.v1";
localStorage.removeItem(COV_KEY);
necro.saveNecroLegacy(necro.emptyNecroLegacy());
const sCov0 = necro.buildArena(necro.LEVELS[0]);
ok(sCov0.boon === 0 && sCov0.souls === K.SOUL_START,
  "a blank covenant leaves the starting souls at base");
for (let i = 0; i < 7; i++) necro.recordEcho("vigil", true, 100);
const sCov1 = necro.buildArena(necro.LEVELS[0]);
ok(sCov1.boon === 7 && sCov1.souls === K.SOUL_START + Math.floor(7 / K.COVENANT_SOULS_PER),
  "victories as the other natures deepen the necromancer's starting soul-stores");
const covEcho = necro.recordEcho("necro", true, 900);
ok(covEcho.firstOfCycle && necro.loadCovenant().echoes.necro.victories === 1,
  "an overrun echoes into the covenant and advances the crown cycle");
localStorage.removeItem(COV_KEY);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
