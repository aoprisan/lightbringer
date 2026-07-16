// Headless raid test for The Iron Rain spinoff. No browser, no deps. Stubs just
// enough storage (and a minimal SVG document for the render smoke test) so
// bomber.js loads, then drives the sim.
globalThis.__BOMBER_TEST__ = true;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// A minimal SVG document so render()/scaffold() run headlessly (the same shape
// the sibling tests use).
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

await import("../bomber.js");
const bb = globalThis.__bomber;
const K = bb.K;
const LEGACY_KEY = "bomber.legacy.v1";
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok  -", msg); };

const still = { x: 0, y: 0 };
function run(s, ms, move = still, slice = 16) {
  for (let t = 0; t < ms; t += slice) bb.stepRaid(s, slice, move);
}
// Strip a raid of everything that could interfere with an isolated assertion:
// no guns, no fighters, no clouds, no balloons, no streams, no fires.
function calm(s) {
  s.flak = []; s.flakTotal = 0;
  s.planes = s.planes.filter((p) => !p.axis);
  s.clouds = []; s.balloons = []; s.streams = []; s.fires = [];
}
// Park every escort far away too (a fully empty sky).
function emptySky(s) {
  calm(s);
  s.planes = [];
}
// A fresh axis fighter at (x,y), already scrambled.
const mkFighter = (x, y) => ({
  x, y, vx: 0, vy: 0, hp: K.FIGHTER_HP, maxHp: K.FIGHTER_HP, dead: false,
  axis: true, state: "fly", fieldIdx: -1, slot: 0, attackCd: 0, hit: 0,
});
// A fresh escort at (x,y).
const mkEscort = (x, y, slot = 0) => ({
  x, y, vx: 0, vy: 0, hp: K.ESCORT_HP, maxHp: K.ESCORT_HP, dead: false,
  axis: false, state: "fly", fieldIdx: -1, slot, attackCd: 0, hit: 0,
});
// Replace the target list with one unkillable work parked in a far corner — so a
// long isolated run can't accidentally WIN (an empty list ends the raid on the
// first stepRaid) and stray bombs can't reach it.
function farTarget(s) {
  const t = { x: 30, y: 30, kind: "factory", hp: 1e9, maxHp: 1e9, dead: false, hit: 0 };
  s.structures = [t]; s.columns = []; s.total = 1;
  return t;
}

const id = "channel";

// Make a clean legacy first (so the equipped airframe is the starter for the
// early tests).
bb.saveBomberLegacy(bb.emptyBomberLegacy());

// 1. Theatres defined + level lookup knows known ids only.
ok(Array.isArray(bb.LEVELS) && bb.LEVELS.length >= 3, `theatres are defined (${bb.LEVELS.length})`);
ok(new Set(bb.LEVELS.map((l) => l.id)).size === bb.LEVELS.length, "theatre ids are unique");
ok(bb.levelById(id) && !bb.levelById("nope"), "levelById resolves known ids only");

// 2. A fresh raid lays the country, rosters a finite target list, brings the
//    bomber in over the southern edge at full HP with the starter airframe and
//    its escorts in formation.
const s = bb.buildArena(bb.levelById(id));
ok(s.scenery.length > 60, `the country is laid (${s.scenery.length} scenery nodes)`);
ok(s.structures.length > 0 && s.columns.length > 0, `works and columns are rostered (${s.structures.length}+${s.columns.length})`);
ok(s.total === s.structures.length + s.columns.length, `the target list is finite (${s.total})`);
ok(s.hero.y > s.h * 0.8 && Math.abs(s.hero.x - s.w / 2) < 2, "the bomber enters over the southern edge");
ok(s.hero.hp === K.HERO_HP && s.phase === "raid", "the bomber begins at full strength, raiding");
ok(s.loadout.id === "lanc", "a fresh raid flies the starter Lancaster");
ok(bb.aliveTargets(s) === s.total && bb.clearedPct(s) === 0, "every target stands, none silenced yet");
ok(bb.escortsAlive(s) === s.level.escortCount, `the escorts fly formation (${bb.escortsAlive(s)})`);
const fielded = s.planes.filter((p) => p.axis);
ok(fielded.length === s.level.airfieldCount * K.FIGHTER_PER_FIELD, `each airfield holds a grounded squadron (${fielded.length})`);
ok(fielded.every((p) => p.state === "base"), "the squadrons begin on the ground, not aloft");
ok(s.flak.length === s.level.flakCount && s.flakTotal === s.flak.length, `the guns are dug in (${s.flak.length})`);

// 3. The bomber can never stop — no input still flies it on at cruise.
const sFly = bb.buildArena(bb.levelById(id));
emptySky(sFly);
const y0 = sFly.hero.y;
run(sFly, 500, still);
ok(sFly.hero.y < y0 - 50, `no input still flies the bomber on at cruise (${(y0 - sFly.hero.y) | 0} units)`);

// 3b. The bomb run — a steady course arms the sight; a hard turn bleeds it and
//     spends the overcharge.
const sArm = bb.buildArena(bb.levelById(id));
emptySky(sArm);
farTarget(sArm); // keep the raid live; isolate the sight
sArm.hero.x = 200; sArm.hero.y = sArm.h / 2; sArm.hero.heading = 0;
run(sArm, K.SIGHT_CHARGE_MS + 400, { x: 1, y: 0 });
ok(sArm.hero.charge >= K.SIGHT_ARM_AT, `a held straight run arms the sight (${sArm.hero.charge.toFixed(2)})`);
// A hard turn (the stick swung perpendicular) bleeds it.
const sTurn = bb.buildArena(bb.levelById(id));
emptySky(sTurn);
sTurn.hero.x = sTurn.w / 2; sTurn.hero.y = sTurn.h / 2; sTurn.hero.heading = 0;
sTurn.hero.charge = 1; sTurn.hero.overcharge = 1;
run(sTurn, 400, { x: 0, y: 1 }); // swing the nose hard
ok(sTurn.hero.charge < 1, `a hard turn bleeds the sight (${sTurn.hero.charge.toFixed(2)})`);
ok(sTurn.hero.overcharge === 0, "a hard turn spends the banked overcharge");

// 3c. The sight releases only once armed, and on its cadence; the bomb falls,
//     then bursts on the works below (in reach hit, out of reach spared).
const s2 = bb.buildArena(bb.levelById(id));
emptySky(s2);
s2.hero.x = 700; s2.hero.y = 700; s2.hero.heading = 0;
const near = { x: 700 + K.BOMB_CARRY + 30, y: 700, kind: "factory", hp: 110, maxHp: 110, dead: false, hit: 0 };
const far = { x: 700 + K.BOMB_CARRY + K.BOMB_RADIUS + 300, y: 700, kind: "factory", hp: 110, maxHp: 110, dead: false, hit: 0 };
s2.structures = [near, far]; s2.columns = []; s2.total = 2;
// A faint (unarmed) sight with the cadence ready still does NOT release.
s2.hero.charge = K.SIGHT_ARM_AT - 0.01; s2.hero.bombCd = 0;
bb.stepSight(s2, 16);
ok(s2.bombs.length === 0, "a faint (unarmed) sight does not release");
// An armed sight releases: the bomb is laid BOMB_CARRY ahead of the nose.
s2.hero.charge = 1; s2.hero.bombCd = 0;
bb.stepSight(s2, 16);
ok(s2.bombs.length === 1, "an armed sight releases a bomb on its cadence");
ok(Math.abs(s2.bombs[0].x - (700 + K.BOMB_CARRY)) < 1, "the bomb is laid ahead of the nose");
ok(s2.hero.bombCd > 0, "after a release the sight holds its cadence before the next");
// The bomb falls, then bursts — near hit, far spared, the alert rises.
const alert0 = s2.alert;
s2.elapsed += K.BOMB_FALL_MS + 20;
bb.stepBombs(s2);
ok(s2.bombs.length === 0, "a matured bomb bursts");
ok(near.hp < 110, "the burst wounds the work in reach");
ok(far.hp === 110, "a work outside the burst is spared");
ok(s2.alert > alert0, "a burst raises the alert");

// 4. Silencing — hurtTarget drives a work to 0 and destroyTarget counts it; a
//    dead target is inert; clearedPct tracks.
const s3 = bb.buildArena(bb.levelById(id));
const t3 = s3.structures[0];
const dn0 = s3.destroyed;
bb.hurtTarget(s3, t3, t3.hp + 5);
ok(t3.dead && s3.destroyed === dn0 + 1, "a work driven to 0 hp is silenced and counted");
const dn1 = s3.destroyed;
bb.hurtTarget(s3, t3, 100);
ok(s3.destroyed === dn1, "a silenced work is inert (no double-count)");

// 4b. Bombing an airfield burns its grounded squadron with it.
const sAf = bb.buildArena(bb.levelById(id));
const af = sAf.structures.find((t) => t.kind === "airfield");
ok(af, "the theatre has an airfield");
const afIdx = sAf.structures.indexOf(af);
const grounded = sAf.planes.filter((p) => p.axis && p.fieldIdx === afIdx);
ok(grounded.length === K.FIGHTER_PER_FIELD, "the airfield holds its squadron");
bb.hurtTarget(sAf, af, af.hp + 5);
ok(grounded.every((p) => p.dead), "bombing the field burns its grounded squadron");
// …but a scrambled fighter is already aloft and survives its field.
const sAf2 = bb.buildArena(bb.levelById(id));
const af2 = sAf2.structures.find((t) => t.kind === "airfield");
const af2Idx = sAf2.structures.indexOf(af2);
const aloft = sAf2.planes.find((p) => p.axis && p.fieldIdx === af2Idx);
aloft.state = "fly";
bb.hurtTarget(sAf2, af2, af2.hp + 5);
ok(!aloft.dead, "a fighter already scrambled survives its burning field");

// 5. FLAK — a battery with the bomber in range lays a telegraphed shell, led by
//    the bomber's velocity; a hidden (cloud) bomber draws no fire; the shell's
//    burst wounds a bomber inside and spares one outside; guns are bombable.
const sF = bb.buildArena(bb.levelById(id));
emptySky(sF);
sF.hero.x = 700; sF.hero.y = 700; sF.hero.vx = K.SPEED_CRUISE; sF.hero.vy = 0;
sF.flak = [{ x: 700, y: 700 + 100, hp: K.FLAK_HP, maxHp: K.FLAK_HP, dead: false, hit: 0, cd: 0 }];
sF.flakTotal = 1;
bb.stepFlak(sF, 16);
ok(sF.shells.length === 1, "a battery with the bomber in range lays a shell");
const led = sF.shells[0];
const predicted = 700 + K.SPEED_CRUISE * (K.FLAK_FUSE_MS / 1000);
ok(Math.abs(led.x - predicted) <= K.FLAK_SCATTER + 1, `the shell leads the bomber's line (laid ${led.x | 0} ~ predicted ${predicted | 0})`);
ok(sF.flak[0].cd > 0, "after a lay the battery reloads");
// Out of range: no shell.
const sF2 = bb.buildArena(bb.levelById(id));
emptySky(sF2);
sF2.hero.x = 200; sF2.hero.y = 200;
sF2.flak = [{ x: 200 + K.FLAK_RANGE + 200, y: 200, hp: K.FLAK_HP, maxHp: K.FLAK_HP, dead: false, hit: 0, cd: 0 }];
bb.stepFlak(sF2, 16);
ok(sF2.shells.length === 0, "a battery beyond its range holds fire");
// Hidden in cloud: no shell even in range.
const sF3 = bb.buildArena(bb.levelById(id));
emptySky(sF3);
sF3.hero.x = 700; sF3.hero.y = 700;
sF3.clouds = [{ x: 700, y: 700, r: 150, vx: 0, vy: 0 }];
sF3.flak = [{ x: 700, y: 800, hp: K.FLAK_HP, maxHp: K.FLAK_HP, dead: false, hit: 0, cd: 0 }];
bb.stepFlak(sF3, 16);
ok(sF3.shells.length === 0, "a bomber hidden in cloud draws no flak");
// The burst: inside wounded (and i-framed), outside spared.
const sF4 = bb.buildArena(bb.levelById(id));
emptySky(sF4);
sF4.hero.x = 700; sF4.hero.y = 700;
sF4.shells = [{ x: 700, y: 700, at: 0 }];
const hpF0 = sF4.hero.hp;
bb.stepShells(sF4);
ok(sF4.hero.hp === hpF0 - K.FLAK_DMG, `a burst wounds the bomber inside it (${hpF0} -> ${sF4.hero.hp})`);
ok(sF4.hero.hurt > 0 && sF4.hits === 1, "a flak hit sets i-frames and is counted");
const sF5 = bb.buildArena(bb.levelById(id));
emptySky(sF5);
sF5.hero.x = 700; sF5.hero.y = 700;
sF5.shells = [{ x: 700 + K.FLAK_BURST_R + K.HERO_RADIUS + 40, y: 700, at: 0 }];
const hpF1 = sF5.hero.hp;
bb.stepShells(sF5);
ok(sF5.hero.hp === hpF1, "a burst spares a bomber outside it");
// Flak is indiscriminate: a fighter in the burst is wounded too.
const sF6 = bb.buildArena(bb.levelById(id));
emptySky(sF6);
const caught = mkFighter(500, 500);
sF6.planes = [caught];
sF6.hero.x = 50; sF6.hero.y = 50;
sF6.shells = [{ x: 500, y: 500, at: 0 }];
bb.stepShells(sF6);
ok(caught.hp < K.FIGHTER_HP, "the flak is indiscriminate — a fighter in the burst is wounded");
// Guns are bombable: a burst on a battery silences it and counts.
const sF7 = bb.buildArena(bb.levelById(id));
emptySky(sF7);
const gun = { x: 600, y: 600, hp: 10, maxHp: K.FLAK_HP, dead: false, hit: 0, cd: 0 };
sF7.flak = [gun]; sF7.flakTotal = 1;
bb.burstBomb(sF7, { x: 600, y: 600, at: 0, master: false });
ok(gun.dead && sF7.flakDown === 1, "a burst silences a battery (secondary objective counted)");

// 5b. ALERT — bursts raise it, time bleeds it, and a roused defence reloads faster.
const sAl = bb.buildArena(bb.levelById(id));
emptySky(sAl);
farTarget(sAl);
sAl.alert = 0.5;
run(sAl, 2000, { x: 0, y: 1 }); // fly on (turning, so no bombs release)
ok(sAl.alert < 0.5, `time bleeds the alert (0.5 -> ${sAl.alert.toFixed(2)})`);
// A roused defence reloads faster: compare a battery's cd after a lay.
const cdCalm = bb.buildArena(bb.levelById(id));
emptySky(cdCalm);
cdCalm.hero.x = 700; cdCalm.hero.y = 700; cdCalm.alert = 0;
cdCalm.flak = [{ x: 700, y: 800, hp: K.FLAK_HP, maxHp: K.FLAK_HP, dead: false, hit: 0, cd: 0 }];
bb.stepFlak(cdCalm, 16);
const cdHot = bb.buildArena(bb.levelById(id));
emptySky(cdHot);
cdHot.hero.x = 700; cdHot.hero.y = 700; cdHot.alert = 1;
cdHot.flak = [{ x: 700, y: 800, hp: K.FLAK_HP, maxHp: K.FLAK_HP, dead: false, hit: 0, cd: 0 }];
bb.stepFlak(cdHot, 16);
ok(cdHot.flak[0].cd < cdCalm.flak[0].cd, `a roused defence reloads faster (${cdHot.flak[0].cd | 0} < ${cdCalm.flak[0].cd | 0})`);

// 6. FIGHTERS — a grounded squadron scrambles when the bomber comes inside its
//    radar reach; a scrambled fighter closes and fires (i-framed, counted); an
//    escort tangling with it pulls it off the bomber.
const s4 = bb.buildArena(bb.levelById(id));
calm(s4); s4.planes = [];
const parked = mkFighter(700, 700); parked.state = "base";
const farParked = mkFighter(100, s4.h - 100); farParked.state = "base"; // far from the hero
s4.planes = [parked, farParked];
s4.hero.x = 700 + K.SCRAMBLE_RANGE - 60; s4.hero.y = 700;
bb.stepPlanes(s4, 16);
ok(parked.state === "fly", "a squadron scrambles when the bomber is inside its radar reach");
ok(farParked.state === "base", "a squadron beyond radar keeps to the ground");
// A fighter glued to the bomber fires: damage, i-frames, the hit counted.
const s5 = bb.buildArena(bb.levelById(id));
calm(s5);
const biter = mkFighter(s5.hero.x + 40, s5.hero.y);
s5.planes = [biter];
const hp1Before = s5.hero.hp;
bb.stepPlanes(s5, 16);
ok(s5.hero.hp < hp1Before, `a fighter in range fires on the bomber (${hp1Before} -> ${s5.hero.hp})`);
ok(s5.hero.hurt > 0 && s5.hits === 1, "a fighter's burst sets i-frames and is counted");
biter.attackCd = 0;
const hp2 = s5.hero.hp;
bb.stepPlanes(s5, 16);
ok(s5.hero.hp === hp2, "i-frames spare the bomber an immediate second burst");
// A hidden bomber draws no fighter fire.
const s5b = bb.buildArena(bb.levelById(id));
calm(s5b);
s5b.clouds = [{ x: s5b.hero.x, y: s5b.hero.y, r: 150, vx: 0, vy: 0 }];
const blindF = mkFighter(s5b.hero.x + 40, s5b.hero.y);
s5b.planes = [blindF];
const hpHid = s5b.hero.hp;
bb.stepPlanes(s5b, 16);
ok(s5b.hero.hp === hpHid, "a bomber hidden in cloud draws no fighter fire");
// The tangle: an escort beside the fighter pulls its fire off the bomber.
const s6 = bb.buildArena(bb.levelById(id));
calm(s6); s6.planes = [];
const tangler = mkEscort(800, 800);
const tangled = mkFighter(800 + 60, 800);
s6.planes = [tangler, tangled];
s6.hero.x = 800; s6.hero.y = 800; // bomber ALSO in range — the escort must win the pick
s6.hero.hurt = 0;
const escHp0 = tangler.hp, heroHp0 = s6.hero.hp;
bb.stepPlanes(s6, 16);
ok(tangler.hp < escHp0, "a tangling escort pulls the fighter's fire onto itself");
ok(s6.hero.hp === heroHp0, "…and the bomber is spared that burst");

// 6b. ESCORTS — they engage the nearest axis fighter in the fray and fire; with
//     an empty sky they hold the formation ring.
const s7 = bb.buildArena(bb.levelById(id));
calm(s7); s7.planes = [];
const guard = mkEscort(700, 700);
const raider = mkFighter(700 + K.ESCORT_RANGE - 20, 700);
raider.attackCd = 1e9; // hold its fire; watch the escort's
s7.planes = [guard, raider];
s7.hero.x = 700; s7.hero.y = 700; s7.hero.hurt = 1e9; // shrug the raider off the assert
const raiderHp0 = raider.hp;
bb.stepPlanes(s7, 16);
ok(raider.hp < raiderHp0, "an escort engages and fires on the fighter in the fray");
// Formation: with no threat, an escort turns toward its ring slot.
const s8 = bb.buildArena(bb.levelById(id));
calm(s8); s8.planes = [];
const former = mkEscort(s8.hero.x + 400, s8.hero.y);
s8.planes = [former]; s8.escortsTotal = 1;
bb.stepPlanes(s8, 400);
const dForm = Math.hypot(former.x - s8.hero.x, former.y - s8.hero.y);
ok(dForm < 400, `an idle escort closes on its formation ring (${dForm | 0} < 400)`);

// 6c. The air war ends planes properly: hurtPlane downs at 0 and counts each side.
const s9 = bb.buildArena(bb.levelById(id));
calm(s9); s9.planes = [];
const victim = mkFighter(500, 500);
s9.planes = [victim];
bb.hurtPlane(s9, victim, victim.hp + 5);
ok(victim.dead && s9.fightersDown === 1, "a fighter driven to 0 is downed and counted");
const down1 = s9.fightersDown;
bb.hurtPlane(s9, victim, 100);
ok(s9.fightersDown === down1, "a downed fighter is inert (no double-count)");
// Chutes: downed fighters may leave one; catching it patches the airframe.
const sCh = bb.buildArena(bb.levelById(id));
calm(sCh); sCh.planes = [];
for (let i = 0; i < 80; i++) bb.downPlane(sCh, mkFighter(200 + i, 200));
ok(sCh.chutes.length > 0, `downed fighters leave supply chutes (${sCh.chutes.length} of 80)`);
const sCh2 = bb.buildArena(bb.levelById(id));
emptySky(sCh2);
sCh2.chutes = [{ x: sCh2.hero.x, y: sCh2.hero.y, until: sCh2.elapsed + K.CHUTE_TTL_MS }];
sCh2.hero.hp = 50;
bb.stepChutes(sCh2);
ok(sCh2.chutes.length === 0, "the bomber catches a chute it flies over");
ok(sCh2.hero.hp === 50 + K.PATCH_HEAL, "a caught chute patches the airframe");

// 7. Overcharge — holding the run PAST a full arm banks a blockbuster; the next
//    release is master (wider ring catches beyond base reach, heavier), then resets.
const sO = bb.buildArena(bb.levelById(id));
emptySky(sO);
farTarget(sO);
sO.hero.x = 200; sO.hero.y = sO.h / 2; sO.hero.heading = 0;
sO.hero.charge = 1; sO.hero.bombCd = 1e9; // parked cadence: bank without spending
run(sO, K.SIGHT_OVERCHARGE_MS + 200, { x: 1, y: 0 });
ok(sO.hero.charge >= 1 && sO.hero.overcharge >= 1, "holding the run past a full arm banks an overcharge");
sO.hero.overcharge = 1; sO.hero.x = 700; sO.hero.y = 700; sO.hero.heading = 0;
bb.releaseBomb(sO);
ok(sO.bombs.length === 1 && sO.bombs[0].master, "the next release is a blockbuster");
ok(sO.hero.overcharge === 0, "the blockbuster spends the banked overcharge");
const justOut = {
  x: 700 + K.BOMB_CARRY + K.BOMB_RADIUS + 40, y: 700, kind: "factory",
  hp: 110, maxHp: 110, dead: false, hit: 0,
};
sO.structures = [justOut]; sO.total = 1;
sO.elapsed += K.BOMB_FALL_MS + 20;
bb.stepBombs(sO);
ok(justOut.hp < 110, "the blockbuster's wider ring catches a work beyond the base reach");

// 8. Terrain of the sky — a balloon blocks the bomber; a stream speeds it; a
//    cloud blinds the sight (charge bleeds inside).
const sB = bb.buildArena(bb.levelById(id));
emptySky(sB);
sB.balloons = [{ x: 700, y: 700 }];
sB.hero.x = 700 - (K.HERO_RADIUS + K.BALLOON_RADIUS + 60); sB.hero.y = 700; sB.hero.heading = 0;
run(sB, 700, { x: 1, y: 0 });
const dBal = Math.hypot(sB.hero.x - 700, sB.hero.y - 700);
ok(dBal >= K.HERO_RADIUS + K.BALLOON_RADIUS - 1, `a balloon blocks the bomber (d=${dBal | 0})`);
// Stream: the same run covers more ground on the lane.
const sSt = bb.buildArena(bb.levelById(id));
emptySky(sSt);
sSt.hero.x = 200; sSt.hero.y = 1000; sSt.hero.heading = 0;
const baseX = sSt.hero.x;
run(sSt, 500, { x: 1, y: 0 });
const baseDist = sSt.hero.x - baseX;
const sSt2 = bb.buildArena(bb.levelById(id));
emptySky(sSt2);
sSt2.streams = [{ x1: 100, y1: 1000, x2: 1400, y2: 1000 }];
sSt2.hero.x = 200; sSt2.hero.y = 1000; sSt2.hero.heading = 0;
const streamX = sSt2.hero.x;
run(sSt2, 500, { x: 1, y: 0 });
const streamDist = sSt2.hero.x - streamX;
ok(streamDist > baseDist + 1, `the bomber rides a stream faster (${baseDist | 0} -> ${streamDist | 0})`);
// Cloud: the charge bleeds inside even on a straight run.
const sCl = bb.buildArena(bb.levelById(id));
emptySky(sCl);
farTarget(sCl);
sCl.clouds = [{ x: sCl.w / 2, y: sCl.h / 2, r: 100000, vx: 0, vy: 0 }]; // the whole sky
sCl.hero.charge = 1;
run(sCl, 600, { x: 1, y: 0 });
ok(sCl.hero.charge < 1, `cloud blinds the sight — the charge bleeds inside (${sCl.hero.charge.toFixed(2)})`);

// 9. Columns crawl; the Firestorm's ground burns them.
const sCo = bb.buildArena(bb.levelById(id));
emptySky(sCo);
const col = sCo.columns[0];
col.x = 500; col.y = 500; col.wpX = 900; col.wpY = 500;
bb.stepColumns(sCo, 1000);
ok(col.x > 500, `a column crawls toward its waypoint (${col.x | 0})`);
// Fires (the incendiary power's ground) gnaw a column inside them.
const sFi = bb.buildArena(bb.levelById(id));
emptySky(sFi);
const burnee = sFi.columns[0];
burnee.x = 600; burnee.y = 600; burnee.wpX = 600; burnee.wpY = 600;
sFi.fires = [{ x: 600, y: 600, until: sFi.elapsed + K.FIRE_TTL_MS }];
const colHp0 = burnee.hp;
bb.stepFires(sFi, 1000);
ok(burnee.hp < colHp0, "incendiary ground gnaws a column inside it");

// 10. Win and lose — silencing every target completes the raid (and it stops
//     simulating); a spent airframe goes down.
const sW = bb.buildArena(bb.levelById(id));
emptySky(sW);
for (const t of sW.structures) bb.hurtTarget(sW, t, t.hp + 5);
for (let i = 1; i < sW.columns.length; i++) bb.hurtTarget(sW, sW.columns[i], 1e9);
const lastCol = sW.columns[0];
bb.hurtTarget(sW, lastCol, lastCol.hp + 5);
bb.stepRaid(sW, 16, still);
ok(sW.phase === "won" && bb.clearedPct(sW) === 1, "silencing every target completes the raid (won)");
const dAtWin = sW.destroyed;
bb.stepRaid(sW, 100, still);
ok(sW.destroyed === dAtWin && sW.phase === "won", "a completed raid does not keep simulating");
// Shot down: enough flak brings the bomber down.
const sL = bb.buildArena(bb.levelById(id));
emptySky(sL);
sL.hero.hp = 5;
sL.shells = [{ x: sL.hero.x, y: sL.hero.y, at: 0 }];
bb.stepRaid(sL, 16, still);
ok(sL.phase === "lost", "a spent airframe goes down (lost)");

// 11. Legacy — raids and downs fold once into a private key; best never worsens.
store.delete(LEGACY_KEY);
ok(bb.loadBomberLegacy().runs === 0, "an untouched legacy starts empty");
const lv = bb.levelById(id);
const l1 = bb.recordRaid(lv, 5000, 4, 1, 2);
ok(l1.runs === 1 && l1.raids === 1 && l1.best[id] === 5000, "recordRaid folds a completed raid");
ok(l1.targetsDestroyed === 4 && l1.fightersDowned === 2, "recordRaid folds the tallies");
const l2 = bb.recordRaid(lv, 8000);
ok(l2.best[id] === 5000, "a slower raid cannot worsen the best");
const l3 = bb.recordRaid(lv, 3000);
ok(l3.best[id] === 3000, "a faster raid sets a new best");
const l4 = bb.recordDown(2, 1, 3);
ok(l4.runs === 4 && l4.raids === 3, "a shoot-down bumps raids flown but not completed");
ok(l4.targetsDestroyed === 6 && l4.medals === 1 + 3, "a shoot-down folds its tallies and medals");
ok(bb.loadBomberLegacy().best[id] === 3000, "the legacy persists to storage");
// Backward compatibility: an old save without the new fields defaults cleanly.
store.set(LEGACY_KEY, JSON.stringify({ runs: 2, raids: 1, best: {} }));
const oldL = bb.loadBomberLegacy();
ok(oldL.runs === 2 && oldL.targetsDestroyed === 0 && oldL.unlocked.includes("lanc"),
  "an old save defaults the new fields");

// 12. Scoring — base/bonuses behave; a hit forfeits the untouched bonus; a lost
//     escort costs the wing bonus; harder theatres multiply more.
const ssc = bb.buildArena(bb.levelById(id));
const sc0 = bb.scoreRun(ssc);
ok(sc0.base === ssc.total * K.SCORE_PER_TARGET, `base score = ${K.SCORE_PER_TARGET} per target (${sc0.base})`);
ok(sc0.untouched > 0 && sc0.survival > 0 && sc0.escorts > 0, "an unscathed raid with the wing home earns the bonuses");
ssc.hits = 2;
ok(bb.scoreRun(ssc).untouched === 0, "a hit forfeits the untouched bonus");
const lostEsc = ssc.planes.find((p) => !p.axis);
bb.hurtPlane(ssc, lostEsc, 1e9);
ok(bb.scoreRun(ssc).escorts < sc0.escorts, "a lost escort costs the wing bonus");
ok(bb.difficultyMult(bb.levelById("ruhr")) > bb.difficultyMult(bb.levelById("channel")),
  "a harder theatre multiplies a raid's score more");

// 13. Airframes — the unlockable bombers, bought with medals.
ok(Array.isArray(bb.BOMBER_TYPES) && bb.BOMBER_TYPES.length >= 3, `airframes are defined (${bb.BOMBER_TYPES.length})`);
ok(new Set(bb.BOMBER_TYPES.map((t) => t.id)).size === bb.BOMBER_TYPES.length, "airframe ids are unique");
const starter = bb.BOMBER_TYPES[0];
ok(starter.cost === 0, "the starter airframe costs nothing (always owned)");
ok(bb.bomberTypeById("lanc").id === "lanc" && bb.bomberTypeById("nope").id === starter.id,
  "bomberTypeById resolves known ids, falls back to the starter");
bb.saveBomberLegacy(bb.emptyBomberLegacy());
const fortress = bb.BOMBER_TYPES.find((t) => t.id === "fortress");
let le = bb.unlockBomber("fortress");
ok(!le.unlocked.includes("fortress"), "an airframe can't be commissioned with no medals");
le = bb.loadBomberLegacy(); le.medals = 1000; bb.saveBomberLegacy(le);
le = bb.unlockBomber("fortress");
ok(le.unlocked.includes("fortress") && le.medals === 1000 - fortress.cost, "commissioning deducts its medals");
le = bb.equipBomber("mosquito");
ok(le.equipped !== "mosquito", "an unowned airframe can't be equipped");
le = bb.equipBomber("fortress");
ok(le.equipped === "fortress", "an owned airframe equips");
const sEq = bb.buildArena(bb.levelById(id));
ok(sEq.loadout.id === "fortress", "the equipped airframe resolves onto the raid");
ok(sEq.hero.maxHp > K.HERO_HP, "the Fortress flies with a heavier airframe (hpMul)");

// 13b. The Fortress's GUNNERS power — its turrets rake a fighter pressing close.
{
  const sg = bb.buildArena(bb.levelById(id));
  calm(sg); sg.planes = [];
  ok(sg.loadout.power === "gunners", "the Fortress carries the gunners power");
  const presser = mkFighter(sg.hero.x + K.GUNNER_R - 20, sg.hero.y);
  sg.planes = [presser];
  const pHp0 = presser.hp;
  bb.stepGunners(sg, 1000);
  ok(presser.hp < pHp0, "the turrets rake a fighter pressing the bomber");
}
// 13c. The Mosquito's EVASIVE power widens the flak's scatter envelope (the shells
//      may land farther from the true lead).
{
  let lc = bb.loadBomberLegacy(); lc.unlocked.push("mosquito"); lc.equipped = "mosquito"; bb.saveBomberLegacy(lc);
  const sm = bb.buildArena(bb.levelById(id));
  ok(sm.loadout.power === "evasive", "the Mosquito carries the evasive power");
  emptySky(sm);
  sm.hero.x = 700; sm.hero.y = 700; sm.hero.vx = 0; sm.hero.vy = 0;
  let maxOff = 0;
  for (let i = 0; i < 60; i++) {
    sm.shells = [];
    sm.flak = [{ x: 700, y: 800, hp: K.FLAK_HP, maxHp: K.FLAK_HP, dead: false, hit: 0, cd: 0 }];
    bb.stepFlak(sm, 16);
    const sh = sm.shells[0];
    maxOff = Math.max(maxOff, Math.hypot(sh.x - 700, sh.y - 700));
  }
  ok(maxOff > K.FLAK_SCATTER, `evasive widens the flak's scatter (worst lay ${maxOff | 0} > ${K.FLAK_SCATTER})`);
}
// 13d. The Firestorm's INCENDIARY power — a burst leaves burning ground.
{
  let lc = bb.loadBomberLegacy(); lc.unlocked.push("firestorm"); lc.equipped = "firestorm"; bb.saveBomberLegacy(lc);
  const sf = bb.buildArena(bb.levelById(id));
  ok(sf.loadout.power === "incendiary", "the Firestorm carries the incendiary power");
  emptySky(sf);
  bb.burstBomb(sf, { x: 400, y: 400, at: 0, master: false });
  ok(sf.fires.length === 1, "a Firestorm burst leaves the ground burning");
}
bb.saveBomberLegacy(bb.emptyBomberLegacy());

// 13e. The bomber's own SHOOTING POSTS — three defensive turrets that rake the
//      interceptors so the bomber can answer them itself. Driven directly so the
//      mark can't fly in or out of range under us.
{
  const sp = bb.buildArena(bb.levelById(id));
  ok(sp.hero.posts.length === 3, "the bomber flies with three defensive gun posts");
  sp.planes = [];
  sp.hero.x = 700; sp.hero.y = 700; sp.hero.heading = 0;
  const bogey = mkFighter(sp.hero.x + K.TURRET_RANGE - 30, sp.hero.y); // dead ahead, in range
  sp.planes = [bogey];
  const hp0 = bogey.hp;
  bb.stepPosts(sp, K.TURRET_CD); // one full cadence — the ready posts fire
  ok(bogey.hp < hp0, "a post rakes a fighter within range and arc");
  ok(sp.hero.posts.some((p) => p.attackCd > 0), "a fired post is on cooldown after its burst");
  ok(sp.hero.posts.some((p) => p.firing), "a firing post lights a tracer for the render");
}
// 13f. A post ignores a fighter out of range, and (for the sector guns) out of arc.
{
  const sp = bb.buildArena(bb.levelById(id));
  sp.planes = [];
  sp.hero.x = 700; sp.hero.y = 700; sp.hero.heading = 0;
  const farBogey = mkFighter(sp.hero.x + K.TURRET_RANGE + 120, sp.hero.y);
  sp.planes = [farBogey];
  const hp0 = farBogey.hp;
  bb.stepPosts(sp, K.TURRET_CD);
  ok(farBogey.hp === hp0, "a fighter beyond TURRET_RANGE is not raked");
  ok(sp.hero.posts.every((p) => !p.firing), "no post fires with nothing in reach");
  // Directly astern: only the all-round dorsal turret bears — the nose gun can't.
  const nose = sp.hero.posts[0];
  const astern = Math.abs(bb.angleDiff(Math.PI, nose.sector)) > nose.arc;
  ok(astern, "the nose post cannot bear directly astern (sector arc holds)");
}

// 14. The reticle and silhouette geometry.
const bp = bb.bombsightPath(100, 100, 50, 0);
ok(bp.startsWith("M") && bp.trimEnd().endsWith("Z"), "bombsightPath is a closed path");
ok((bp.match(/A/g) || []).length >= 4, "bombsightPath arcs its rings");
ok((bp.match(/L/g) || []).length >= 12, "bombsightPath strokes the crosshairs and ticks");
const pp = bb.planePath(100, 100, 0, 20, true);
ok(pp.startsWith("M") && pp.trimEnd().endsWith("Z"), "planePath is a closed silhouette");
ok((pp.match(/L/g) || []).length >= 20, "planePath traces both mirrored halves");

// 15. Render smoke — render/scaffold don't throw with zero sprites, at the start
//     and after a spread of state changes.
const svgNode = makeNode();
let threw = false;
try {
  const camLayer = bb.scaffold(svgNode);
  const sr = bb.buildArena(bb.levelById("ruhr"));
  bb.render(sr, camLayer);
  // Mutate a spread of state, then render again.
  if (sr.structures[0]) { sr.structures[0].hp = 5; sr.structures[0].hit = sr.elapsed + 100; }
  if (sr.structures[1]) sr.structures[1].dead = true;
  if (sr.flak[0]) sr.flak[0].tracking = true;
  if (sr.flak[1]) sr.flak[1].dead = true;
  if (sr.columns[0]) { sr.columns[0].vx = 10; sr.columns[0].hp = 5; }
  const anyF = sr.planes.find((p) => p.axis);
  if (anyF) { anyF.state = "fly"; anyF.firing = true; anyF.fireX = sr.hero.x; anyF.fireY = sr.hero.y; anyF.hp = 5; }
  sr.shells.push({ x: 500, y: 500, at: sr.elapsed + 400 });
  sr.bombs.push({ x: 520, y: 520, at: sr.elapsed + 400, master: true });
  sr.bursts.push({ x: 540, y: 540, r: 80, until: sr.elapsed + 300, flak: false });
  sr.bursts.push({ x: 560, y: 560, r: 60, until: sr.elapsed + 300, flak: true });
  sr.fires.push({ x: 580, y: 580, until: sr.elapsed + 3000 });
  sr.chutes.push({ x: 600, y: 600, until: sr.elapsed + 3000 });
  sr.hero.charge = 1; sr.hero.overcharge = 1; sr.hero.hurt = 200;
  bb.render(sr, camLayer);
  bb.spriteFor(sr.level, "ground");
} catch (err) {
  threw = true;
  console.error(err);
}
ok(!threw, "render and scaffold run headlessly with zero sprites, at start and after state changes");


// ---------- The Covenant — the cross-game boon (extra airframe plating) ----------
const COV_KEY = "lightbringer.covenant.v1";
localStorage.removeItem(COV_KEY);
bb.saveBomberLegacy(bb.emptyBomberLegacy());
const sCov0 = bb.buildArena(bb.LEVELS[0]);
ok(sCov0.boon === 0 && sCov0.hero.maxHp === K.HERO_HP, "a blank covenant flies the base airframe");
for (let i = 0; i < 4; i++) bb.recordEcho("necro", true, 100);
const sCov1 = bb.buildArena(bb.LEVELS[0]);
ok(sCov1.boon === 4 && sCov1.hero.maxHp === K.HERO_HP + 4 * K.COVENANT_HP_PER_BOON,
  "victories as the other natures rivet extra plating on (+airframe HP, after hpMul)");
const covEcho = bb.recordEcho("bomber", true, 600);
ok(covEcho.firstOfCycle && bb.loadCovenant().echoes.bomber.victories === 1,
  "a completed raid echoes into the covenant and advances the crown cycle");
localStorage.removeItem(COV_KEY);
// Rival duels — seeded arenas, the token codec, the echo's pace, the verdict.
// Zero-backend: the same seed must raise the identical theatre on any device,
// and the URL token must round-trip a run and shrug off tampering.
{
  const fpr = (st) => JSON.stringify({
    n: st.scenery.map((n) => [n.kind, Math.round(n.x), Math.round(n.y), n.seed]),
    t: st.structures.map((t) => [t.kind, Math.round(t.x), Math.round(t.y)]),
    c: st.columns.map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.wpX), Math.round(c.wpY)]),
    f: st.flak.map((f) => [Math.round(f.x), Math.round(f.y)]),
    b: st.balloons.map((b) => [Math.round(b.x), Math.round(b.y)]),
    cl: st.clouds.map((c) => [Math.round(c.x), Math.round(c.y), Math.round(c.r)]),
  });
  const dA = bb.buildArena(bb.levelById("channel"), 123456);
  const dB = bb.buildArena(bb.levelById("channel"), 123456);
  const dC = bb.buildArena(bb.levelById("channel"), 654321);
  ok(dA.seed === 123456 && dB.seed === 123456, "a seeded build keeps its seed on the state");
  ok(fpr(dA) === fpr(dB), "the same seed rebuilds the identical theatre (works, guns, sky)");
  ok(fpr(dA) !== fpr(dC), "a different seed raises a different theatre");
  ok(Number.isInteger(bb.buildArena(bb.levelById("channel")).seed),
    "an unseeded raid still draws a seed — any run can become a challenge");
  ok(fpr(bb.buildArena(bb.levelById("ruhr"), 777)) === fpr(bb.buildArena(bb.levelById("ruhr"), 777)),
    "the hardest theatre is seed-stable too (flak alley through the seeded path)");

  const dK = bb.buildArena(bb.levelById("channel"));
  dK.elapsed = 4321;
  bb.destroyTarget(dK, dK.structures[0]);
  ok(dK.killTimes.length === 1 && dK.killTimes[0] === 4321, "each silenced target is timestamped for the echo");

  const runRec = { name: "Cheshire", level: "channel", seed: 123456, weapon: "lanc",
    result: "won", ms: 84200, score: 1234, kills: [1000, 2500, 2500, 60000] };
  const tok = bb.encodeDuel(runRec);
  ok(/^[A-Za-z0-9_-]+$/.test(tok), "the duel token is URL-safe base64url");
  const back = bb.decodeDuel(tok);
  ok(back && back.name === "Cheshire" && back.level === "channel" && back.seed === 123456
    && back.result === "won" && back.ms === 84200, "the token round-trips the run");
  ok(back.kills.length === 4 && back.kills.every((t, i) => Math.abs(t - runRec.kills[i]) <= 100),
    "kill times survive within a decisecond");
  ok(bb.decodeDuel("garbage!!") === null, "garbage tokens decode to null, never throw");
  ok(bb.decodeDuel(bb.encodeDuel({ ...runRec, level: "no-such-theatre" })) === null, "unknown theatres are rejected");
  const forged = Buffer.from(JSON.stringify({ v: 1, g: "eldritch", n: "x", l: "channel", s: 1, w: "", r: 1, t: 1, sc: 0, k: [] }))
    .toString("base64url");
  ok(bb.decodeDuel(forged) === null, "a sibling game's token never opens here (GAME_TAG guard)");
  ok(bb.decodeDuel(bb.encodeDuel({ ...runRec, name: "<b onload=x>" })).name.includes("<") === false,
    "names are stripped of markup on decode");

  ok(bb.rivalKillsAt(back, 0) === 0 && bb.rivalKillsAt(back, 2600) === 3 && bb.rivalKillsAt(back, 999999) === 4,
    "rivalKillsAt paces the echo");
  const mkRun = (result, ms, nKills) => ({ name: "", level: "channel", seed: 1, weapon: "",
    result, ms, score: 0, kills: Array.from({ length: nKills }, (_, i) => i * 100) });
  ok(bb.duelVerdict(mkRun("won", 50000, 18), mkRun("lost", 80000, 10)) === "win", "a completed raid beats going down");
  ok(bb.duelVerdict(mkRun("won", 50000, 18), mkRun("won", 40000, 18)) === "loss", "two completions race the clock");
  ok(bb.duelVerdict(mkRun("lost", 30000, 12), mkRun("lost", 90000, 9)) === "win", "two downed raids compare targets first");
  ok(bb.duelVerdict(mkRun("won", 50000, 18), mkRun("won", 50000, 18)) === "draw", "an exact tie stands unsettled");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
