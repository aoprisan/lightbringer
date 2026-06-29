// Headless hunt test for The Moon's Hunger (the werewolf spinoff). No browser, no
// deps. Stubs just enough storage (and a minimal SVG document for the render smoke
// test) so werewolf.js loads, then drives the sim.
globalThis.__WW_TEST__ = true;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// A minimal SVG document so render()/scaffold() run headlessly.
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

await import("../werewolf.js");
const ww = globalThis.__ww;
const K = ww.K;
const LEGACY_KEY = "werewolf.legacy.v1";
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok  -", msg); };

const still = { x: 0, y: 0 };
function run(s, ms, move = still, slice = 16) {
  for (let t = 0; t < ms; t += slice) ww.stepHunt(s, slice, move);
}
// Park a foe asleep (lurking) at a spot (its green too): used to isolate by stowing
// the rest far from the hero, out of aggro range.
const park = (e, x, y) => { e.state = "lurk"; e.x = x; e.y = y; e.homeX = x; e.homeY = y; };
const wake = (e) => { e.state = "hunt"; };
function stowAll(s, x = 5, y = 5) { for (const e of s.foes) park(e, x, y); }
// A fresh foe at (x,y) — the test's stock body.
const mkF = (x, y, v = "villager", hp = K.FOE_HP) => ({
  x, y, vx: 0, vy: 0, hp, maxHp: hp, dead: false, state: "hunt", variant: v,
  wanderAngle: 0, homeX: x, homeY: y, attackCd: 0, shootCd: 0, hit: 0, bornAt: 0,
});
// Force the hero into the beast (so the maw can rend) for a sim slice.
const beast = (s) => { s.hero.form = "wolf"; s.hero.fury = 1; };

const id = "thornwick";

// Make a clean legacy first (so the equipped pelt is the starter for the early tests).
ww.saveWwLegacy(ww.emptyWwLegacy());

// 1. Villages defined + arena generation knows known ids only.
ok(Array.isArray(ww.LEVELS) && ww.LEVELS.length >= 3, `villages are defined (${ww.LEVELS.length})`);
ok(new Set(ww.LEVELS.map((l) => l.id)).size === ww.LEVELS.length, "village ids are unique");
ok(ww.levelById(id) && !ww.levelById("nope"), "levelById resolves known ids only");

// 2. A fresh hunt dresses the village, musters a finite watch, centres the hero at
//    full HP as a MAN with no fury, hunting, the starter pelt, and no kills.
const gen = ww.generateWerewolf(ww.levelById(id));
ok(gen.nodes.length > 80, `arena dresses the village (${gen.nodes.length} nodes)`);
ok(gen.nodes.some((n) => n.kind === "cairn"), "cairns are present");
ok(gen.greens.length >= 4, `greens are present (${gen.greens.length})`);

const s = ww.buildArena(ww.levelById(id));
ok(s.cairns.length > 0 && s.cairns.every((c) => c.kind === "cairn"), `cairns are cached (${s.cairns.length})`);
ok(s.total === gen.greens.length * K.FOE_PER_GREEN || s.total === s.foes.length,
  `finite host (${s.total})`);
ok(s.foes.length === s.total && s.total > 0, "every foe is rostered");
ok(s.hero.x === s.w / 2 && s.hero.y === s.h / 2, "the hero starts at the village's heart");
ok(s.hero.hp === K.HERO_HP && s.hero.form === "human" && s.hero.fury === 0 && s.phase === "hunt",
  "the hero begins a man at full blood, no fury, hunting");
ok(s.pelt.id === "grey", "a fresh hunt wears the starter Grey Pelt");
ok(ww.aliveFoes(s) === s.total && ww.clearedPct(s) === 0, "all foes alive, none cut down yet");
ok(s.foes.every((e) => e.state === "lurk"), "the watch begins lurking, not hunting");

// 2b. The moon — daylight/moonlight are an inverse wheel; noon vs midnight.
ok(ww.daylight(0) > 0.95 && ww.daylight(0.5) < 0.05, "daylight peaks at noon (moon 0), dies at midnight (0.5)");
ok(Math.abs(ww.moonlightOf(0.5) - 1) < 0.05 && ww.moonlightOf(0) < 0.05, "moonlight is the inverse of daylight");

// 3. The maw rends — but ONLY as a wolf, and only when sufficiently traced. A man
//    cannot attack; a wolf's pulse damages every foe in reach.
const s2 = ww.buildArena(ww.levelById(id));
stowAll(s2);
s2.cairns = []; // isolate from any cairn the pulse might mark
s2.hero.x = 700; s2.hero.y = 700;
const near = mkF(700 + 40, 700);
const far = mkF(700 + K.MAW_RADIUS + 120, 700);
s2.foes = [near, far];
// As a MAN, a fully-traced stand does NOT rend.
s2.hero.form = "human"; s2.hero.charge = 1; s2.hero.mawCd = 0;
const nearHp0 = near.hp;
ww.stepMaw(s2, 16);
ok(near.hp === nearHp0, "a man cannot attack — no rending, whatever the stand");
// As a WOLF, the same stand rends: the near foe is hit, the far one spared.
s2.hero.form = "wolf"; s2.hero.charge = 1; s2.hero.mawCd = 0;
ww.stepMaw(s2, 16);
ok(near.hp < nearHp0, "the wolf's traced maw rends the foe in reach");
ok(far.hp === K.FOE_HP, "a foe outside the maw's reach is spared");
ok(s2.hero.mawCd > 0, "after a pulse the maw holds its cadence before the next");
// A faint (untraced) wolf-maw does not rend.
s2.hero.charge = K.MAW_BITE_AT - 0.01; s2.hero.mawCd = 0;
const nearHp1 = near.hp;
ww.stepMaw(s2, 16);
ok(near.hp === nearHp1, "a faint (untraced) maw does not rend");

// 3b. The blood-moon sigil geometry: two rings (the full moon), claw-rakes, radial
//     rays — a closed path.
const pp = ww.pentagramPath(100, 100, 50, 0);
ok(pp.startsWith("M") && pp.trimEnd().endsWith("Z"), "the sigil is a closed path");
ok((pp.match(/A/g) || []).length >= 4, "the sigil arcs the two moon-rings");
ok((pp.match(/L/g) || []).length >= 6, "the sigil rakes the claw-slashes and rays");

// 4. Killing — hurtFoe drives a foe to 0 and slay counts it; a dead foe is inert;
//    clearedPct tracks; a kill feeds the curse.
const s3 = ww.buildArena(ww.levelById(id));
const e3 = s3.foes[0];
const slain0 = s3.slain, fury0 = s3.hero.fury;
ww.hurtFoe(s3, e3, e3.hp + 5);
ok(e3.dead && s3.slain === slain0 + 1, "a foe driven to 0 hp is slain and counted");
ok(s3.hero.fury > fury0, "a kill feeds the curse (stokes fury)");
const slain1 = s3.slain;
ww.hurtFoe(s3, e3, 100);
ok(s3.slain === slain1, "a slain foe is inert (no double-count)");

// 5. THE SHAPE — under moonlight a man's fury swells to the crest and he TURNS; by
//    daylight a wolf's fury bleeds and he turns back.
const sT1 = ww.buildArena(ww.levelById(id));
stowAll(sT1); sT1.solids = []; sT1.walls = [];
sT1.hero.x = 700; sT1.hero.y = 700; sT1.moon = 0.5; sT1.hero.fury = 0.8; // deep night, near the crest
run(sT1, 1600, still);
ok(sT1.hero.form === "wolf" && sT1.hero.fury >= 0.99, "moonlight swells a man's fury until he turns beast");
const sT2 = ww.buildArena(ww.levelById(id));
stowAll(sT2); sT2.solids = []; sT2.walls = []; sT2.moonwells = []; // (foes stay stowed far, so no instant win)
sT2.hero.x = 700; sT2.hero.y = 700; sT2.moon = 0; beast(sT2); sT2.hero.fury = 0.1; // high noon
run(sT2, 1600, still);
ok(sT2.hero.form === "human", "daylight bleeds a wolf's fury until he turns back to a man");

// 5b. A moonwell holds the moon's light whatever the hour — fury swells inside it
//     even at noon, where outside it barely stirs.
const sWell = ww.buildArena(ww.levelById(id));
stowAll(sWell); sWell.solids = []; sWell.walls = []; // (foes stay stowed far, so no instant win)
sWell.hero.x = 700; sWell.hero.y = 700; sWell.moon = 0; sWell.hero.fury = 0;
sWell.moonwells = [{ x: 700, y: 700, kind: "moonwell" }];
ok(ww.inMoonwell(sWell, 700, 700) && !ww.inMoonwell(sWell, 50, 50), "inMoonwell reads a hero's footing");
run(sWell, 800, still);
const wellFury = sWell.hero.fury;
const sCtl = ww.buildArena(ww.levelById(id));
stowAll(sCtl); sCtl.solids = []; sCtl.walls = [];
sCtl.hero.x = 700; sCtl.hero.y = 700; sCtl.moon = 0; sCtl.hero.fury = 0; sCtl.moonwells = [];
run(sCtl, 800, still);
ok(wellFury > sCtl.hero.fury + 0.05, `a moonwell stokes fury at noon (${sCtl.hero.fury.toFixed(2)} -> ${wellFury.toFixed(2)})`);

// 6. The watch AI — rouses on the hero in aggro (sticky), closes, and strikes; the
//    strike sets i-frames, counts the hit, knocks back. Aggro is wider for the beast.
const s4 = ww.buildArena(ww.levelById(id));
stowAll(s4);
beast(s4); // a wolf draws full aggro
const eNear = s4.foes[0], eFar = s4.foes[1];
park(eNear, s4.hero.x + K.FOE_AGGRO - 40, s4.hero.y);
park(eFar, s4.hero.x + K.FOE_AGGRO + 140, s4.hero.y);
ww.stepFoes(s4, 16);
ok(eNear.state === "hunt", "a lurker rouses when the wolf is in aggro");
ok(eFar.state === "lurk", "a lurker beyond aggro keeps watching");
s4.hero.x = 40; s4.hero.y = 40; // flee far
ww.stepFoes(s4, 16);
ok(eNear.state === "hunt", "aggro is sticky — a roused foe never settles back");
// A man is harder to spot: a foe just inside the beast-aggro band stays lurking.
const sStealth = ww.buildArena(ww.levelById(id));
stowAll(sStealth);
sStealth.hero.form = "human";
const watcher = sStealth.foes[0];
park(watcher, sStealth.hero.x + K.FOE_AGGRO * 0.7, sStealth.hero.y); // inside beast aggro, outside man aggro
ww.stepFoes(sStealth, 16);
ok(watcher.state === "lurk", "the watch is slower to rouse to a man than to a beast");
// A foe glued to the hero strikes it, sets i-frames, counts the hit.
const s5 = ww.buildArena(ww.levelById(id));
stowAll(s5);
s5.solids = []; s5.walls = []; s5.cairns = [];
const biter = s5.foes[0];
biter.x = s5.hero.x; biter.y = s5.hero.y; wake(biter); biter.attackCd = 0;
const hp1Before = s5.hero.hp;
ww.stepFoes(s5, 16);
ok(s5.hero.hp < hp1Before, `a foe in contact strikes the hero (${hp1Before} -> ${s5.hero.hp})`);
ok(s5.hero.hurt > 0, "a strike sets i-frames");
ok(s5.hits === 1, "a landed strike is counted (for the flawless bonus)");
biter.x = s5.hero.x; biter.y = s5.hero.y; biter.attackCd = 0;
const hp2 = s5.hero.hp;
ww.stepFoes(s5, 16);
ok(s5.hero.hp === hp2, "i-frames spare the hero an immediate second strike");

// 6b. Huntsman — the ranged arm. It never melees: it holds a standoff and looses
//     silver bolts with line of sight; a wall stops the bolt; MIST hides the hero.
const sH = ww.buildArena(ww.levelById("greymoor"));
ok(sH.foes.some((e) => e.variant === "huntsman"), "greymoor musters a huntsman");
stowAll(sH); sH.solids = []; sH.walls = []; sH.cairns = []; sH.mists = [];
const hunter = sH.foes.find((e) => e.variant === "huntsman") ?? sH.foes[0];
hunter.variant = "huntsman"; wake(hunter); hunter.x = 800; hunter.y = 800; hunter.shootCd = 0;
sH.hero.x = 800 + (K.HUNTSMAN_RANGE - 40); sH.hero.y = 800;
sH.foes = [hunter]; sH.bolts = [];
ww.stepFoes(sH, 16);
ok(sH.bolts.length > 0, "a huntsman with line of sight looses a silver bolt");
// A bolt strikes the hero (and the bolt is consumed).
sH.bolts = [{ x: sH.hero.x - 60, y: sH.hero.y, vx: K.BOLT_SPEED, vy: 0, dead: false, bornAt: sH.elapsed }];
const bHp0 = sH.hero.hp;
for (let t = 0; t < 400; t += 16) ww.stepBolts(sH, 16); // fine steps (no tunnelling)
ok(sH.hero.hp < bHp0 && sH.bolts.length === 0, `a silver bolt strikes the hero (${bHp0} -> ${sH.hero.hp})`);
// A wall stops a bolt.
const sB = ww.buildArena(ww.levelById("greymoor"));
sB.walls = [{ x1: 700, y1: 760, x2: 700, y2: 840 }];
sB.hero.x = 760; sB.hero.y = 800;
sB.bolts = [{ x: 640, y: 800, vx: K.BOLT_SPEED, vy: 0, dead: false, bornAt: sB.elapsed }];
const wHp0 = sB.hero.hp;
ww.stepBolts(sB, 400);
ok(sB.hero.hp === wHp0 && sB.bolts.length === 0, "a wall stops a silver bolt short of the hero");
// MIST hides the hero — the huntsman holds fire.
const sMist = ww.buildArena(ww.levelById("greymoor"));
stowAll(sMist); sMist.solids = []; sMist.walls = []; sMist.cairns = [];
const hunter2 = sMist.foes.find((e) => e.variant === "huntsman") ?? sMist.foes[0];
hunter2.variant = "huntsman"; wake(hunter2); hunter2.x = 800; hunter2.y = 800; hunter2.shootCd = 0;
sMist.hero.x = 800 + (K.HUNTSMAN_RANGE - 40); sMist.hero.y = 800;
sMist.foes = [hunter2]; sMist.bolts = [];
sMist.mists = [{ x: sMist.hero.x, y: sMist.hero.y, r: 120, vx: 0, vy: 0 }];
ok(ww.inMist(sMist, sMist.hero.x, sMist.hero.y), "inMist reads a hero lost in the fog");
ww.stepFoes(sMist, 16);
ok(sMist.bolts.length === 0, "a huntsman holds fire when the hero is hidden in mist");
// It never melees: glued, but barred from shooting, it lands no blow.
const sH2 = ww.buildArena(ww.levelById("greymoor"));
stowAll(sH2); sH2.solids = []; sH2.walls = []; sH2.cairns = []; sH2.mists = [];
const hunter3 = sH2.foes.find((e) => e.variant === "huntsman") ?? sH2.foes[0];
hunter3.variant = "huntsman"; wake(hunter3); hunter3.x = sH2.hero.x; hunter3.y = sH2.hero.y; hunter3.shootCd = 1e9;
sH2.foes = [hunter3]; sH2.bolts = [];
const huHp0 = sH2.hero.hp;
ww.stepFoes(sH2, 600);
ok(sH2.hero.hp === huHp0 && sH2.hits === 0, "a huntsman never melees (no blow in contact)");

// 6c. Friar — the holy ward. It never melees: it bleeds the curse at range with
//     sight; a wall breaks it.
const sFr = ww.buildArena(ww.levelById("hollowby"));
ok(sFr.foes.some((e) => e.variant === "friar"), "hollowby musters a friar");
stowAll(sFr); sFr.solids = []; sFr.walls = []; sFr.cairns = [];
const friar = sFr.foes.find((e) => e.variant === "friar") ?? sFr.foes[0];
friar.variant = "friar"; wake(friar); friar.x = 800; friar.y = 800;
sFr.hero.x = 800 + (K.FRIAR_RANGE - 30); sFr.hero.y = 800; sFr.hero.fury = 0.6;
sFr.foes = [friar];
const frHp0 = sFr.hero.hp, frFury0 = sFr.hero.fury;
ww.stepFoes(sFr, 1000);
ok(sFr.hero.fury < frFury0, `a friar's consecration bleeds the curse (${frFury0} -> ${sFr.hero.fury.toFixed(2)})`);
ok(friar.channeling === true, "a friar channels its consecration");
ok(sFr.hero.hp === frHp0 && sFr.hits === 0, "a friar never melees (no HP loss, no hit)");
// A wall between breaks the consecration.
const sFr2 = ww.buildArena(ww.levelById("hollowby"));
stowAll(sFr2); sFr2.solids = []; sFr2.cairns = [];
const friar2 = sFr2.foes.find((e) => e.variant === "friar") ?? sFr2.foes[0];
friar2.variant = "friar"; wake(friar2); friar2.x = 800; friar2.y = 800;
sFr2.hero.x = 1000; sFr2.hero.y = 800; sFr2.hero.fury = 0.6;
sFr2.foes = [friar2];
sFr2.walls = [{ x1: 900, y1: 760, x2: 900, y2: 840 }];
const frFury2 = sFr2.hero.fury;
ww.stepFoes(sFr2, 1000);
ok(sFr2.hero.fury === frFury2, "a wall between breaks a friar's consecration");

// 6d. Variants — hounds fast & frail, knights slow, tough and heavy-hitting.
const sV = ww.buildArena(ww.levelById("hollowby"));
ok(sV.foes.some((e) => e.variant === "hound"), "hollowby musters hounds");
ok(sV.foes.some((e) => e.variant === "knight"), "hollowby musters knights");
const knight = sV.foes.find((e) => e.variant === "knight");
ok(knight.maxHp > K.FOE_HP * 2, `a knight stands with plated hp (${knight.maxHp})`);

// 7. Win on all-foes-cut-down — clearedPct 1, phase "won", no further sim.
const s6 = ww.buildArena(ww.levelById(id));
for (let i = 1; i < s6.foes.length; i++) ww.slay(s6, s6.foes[i]);
s6.motes = [];
const last = s6.foes[0];
last.hp = 1; last.x = 700; last.y = 700; wake(last);
s6.hero.x = 700; s6.hero.y = 700; s6.moon = 0.5; beast(s6); s6.hero.charge = 1; s6.hero.mawCd = 0;
run(s6, 1200, still);
ok(s6.foes.every((e) => e.dead), "the last foe falls to the maw");
ok(s6.phase === "won" && ww.clearedPct(s6) === 1, "cutting down every foe claims the village (won)");
const slainAtWin = s6.slain;
ww.stepHunt(s6, 100, still);
ok(s6.slain === slainAtWin && s6.phase === "won", "a claimed hunt does not keep simulating");

// 8. Lose on HP-0 — the watch brings the hero down.
const s7 = ww.buildArena(ww.levelById(id));
stowAll(s7);
s7.solids = []; s7.walls = []; s7.cairns = [];
const killer = s7.foes[0];
killer.variant = "knight"; killer.x = s7.hero.x; killer.y = s7.hero.y; wake(killer); killer.hp = 1e9;
run(s7, 20000, still, 8);
ok(s7.phase === "lost" && s7.hero.hp === 0, "enough blows bring the hero down (lost)");

// 9. Cairns — the maw marks a dark cairn in reach (stoking the curse); a marked
//    cairn's aura grants fury AND rends the host; a foe cleanses a marked cairn.
const sC = ww.buildArena(ww.levelById(id));
stowAll(sC);
const cairn = { x: 700, y: 700, kind: "cairn", lit: false };
sC.cairns = [cairn]; sC.scenery = [cairn]; sC.litCount = 0;
sC.hero.x = 700 + 20; sC.hero.y = 700; beast(sC); sC.hero.charge = 1; sC.hero.mawCd = 0;
sC.hero.fury = 0.5; sC.foes = [];
ww.firePulse(sC);
ok(cairn.lit && sC.litCount === 1, "a maw pulse marks a dark cairn in reach");
ok(sC.hero.fury > 0.5 - K.MAW_FURY_COST, "marking a cairn stokes the curse (offsets the pulse's cost)");
// A marked cairn's aura grants the hero fury.
const sC2 = ww.buildArena(ww.levelById(id));
stowAll(sC2);
const cairn2 = { x: 700, y: 700, kind: "cairn", lit: true, litAt: 0 };
sC2.cairns = [cairn2];
sC2.hero.x = 700 + 30; sC2.hero.y = 700; sC2.hero.fury = 0.4; sC2.foes = [];
ww.stepCairns(sC2, 1000);
ok(sC2.hero.fury > 0.4, "a marked cairn's aura grants the hero fury");
// …and rends a foe caught in it.
const sC3 = ww.buildArena(ww.levelById(id));
stowAll(sC3);
const cairn3 = { x: 700, y: 700, kind: "cairn", lit: true, litAt: 0 };
sC3.cairns = [cairn3]; sC3.hero.x = 5; sC3.hero.y = 5;
const rent = mkF(700 + 30, 700);
sC3.foes = [rent];
const rentHp0 = rent.hp;
ww.stepCairns(sC3, 600);
ok(rent.hp < rentHp0, "a marked cairn rends a foe in its aura (ally emitter)");
// A foe brushing a marked cairn cleanses it (dark + scar).
const sC4 = ww.buildArena(ww.levelById(id));
stowAll(sC4); sC4.solids = []; sC4.walls = [];
const cairn4 = { x: 700, y: 700, kind: "cairn", lit: true, litAt: 0 };
sC4.cairns = [cairn4]; sC4.scenery = [cairn4]; sC4.litCount = 1; sC4.hero.x = 5; sC4.hero.y = 5;
const cleanser = mkF(700 + 10, 700);
sC4.foes = [cleanser];
ww.stepFoes(sC4, 16);
ok(!cairn4.lit && sC4.litCount === 0 && sC4.cleansedCount === 1, "a foe brushing a marked cairn cleanses it");
ok(ww.nearScar(sC4, cairn4.x, cairn4.y), "a cleansed cairn scars the ground");
// A still-scarred cairn resists re-marking.
sC4.hero.x = 720; sC4.hero.y = 700; beast(sC4); sC4.hero.charge = 1; sC4.hero.mawCd = 0; sC4.foes = [];
ww.firePulse(sC4);
ok(!cairn4.lit && sC4.litCount === 0, "the scar bars re-marking until it fades");

// 10. Blood-motes — a felled foe may drop one; gathering it stokes the curse.
const sM = ww.buildArena(ww.levelById(id));
sM.motes = [];
for (let i = 0; i < 80; i++) ww.slay(sM, { x: 200 + i, y: 200, dead: false, hp: 0, variant: "villager" });
ok(sM.motes.length > 0, `felled foes leave gatherable blood-motes (${sM.motes.length} of 80)`);
const sM2 = ww.buildArena(ww.levelById(id));
stowAll(sM2);
sM2.motes = [{ x: sM2.hero.x, y: sM2.hero.y, until: sM2.elapsed + K.MOTE_TTL_MS }];
sM2.hero.fury = 0.5;
ww.stepMotes(sM2);
ok(sM2.motes.length === 0, "the hero gathers a blood-mote underfoot");
ok(Math.abs(sM2.hero.fury - (0.5 + K.MOTE_FURY)) < 1e-9, "a gathered blood-mote stokes the curse");

// 11. Overcharge — holding still PAST a full trace banks an overcharge; the next
//     pulse erupts (wider, terrifies the host, stokes fury), then resets. Moving spends it.
const sO = ww.buildArena(ww.levelById(id));
stowAll(sO); sO.solids = []; sO.walls = []; sO.cairns = [];
sO.hero.x = 700; sO.hero.y = 700; sO.moon = 0.5; beast(sO);
// A full trace already inscribed; mawCd parked far out so the auto-pulse doesn't fire
// and spend the bank while it accrues (a real pulse empties the overcharge).
sO.hero.charge = 1; sO.hero.mawCd = 1e9; sO.hero.overcharge = 0;
run(sO, K.OVERCHARGE_MS + 120, still);
ok(sO.hero.charge >= 1 && sO.hero.overcharge >= 1, "holding still past a full trace banks an overcharge");
// An empowered pulse: a foe just outside the BASE reach is caught by the wider ring,
// flung back, and fury is stoked.
sO.hero.overcharge = 1; sO.hero.charge = 1; sO.hero.fury = 0.5;
const justOut = mkF(700 + K.MAW_RADIUS + 30, 700); // beyond base reach, within the empowered ring
sO.foes = [justOut];
const oHp0 = justOut.hp, oX0 = justOut.x;
ww.firePulse(sO);
ok(justOut.hp < oHp0, "an empowered pulse's wider ring catches a foe beyond the base reach");
ok(justOut.x > oX0, "an empowered pulse terrifies (flings back) the host");
ok(sO.hero.fury > 0.5, "an empowered pulse stokes the curse");
ok(sO.hero.overcharge === 0, "an empowered pulse spends the banked overcharge");
// Moving spends a banked overcharge back to nothing.
const sO2 = ww.buildArena(ww.levelById(id));
beast(sO2); sO2.hero.charge = 1; sO2.hero.overcharge = 1;
ww.stepHunt(sO2, 16, { x: 1, y: 0 });
ok(sO2.hero.overcharge === 0, "moving spends the banked overcharge");

// 12. Terrain — walls + paths present; pushOut stops a body at a wall and a solid;
//     a path speeds travel.
const sTerr = ww.buildArena(ww.levelById(id));
stowAll(sTerr);
ok(sTerr.walls.length > 0, `the village is strung with hedgerows (${sTerr.walls.length})`);
ok(sTerr.paths.length > 0, `the village is laced with lanes (${sTerr.paths.length})`);
ok(sTerr.solids.length > 0, `the village has solid stones & cottages (${sTerr.solids.length})`);
// A solid blocks the hero.
sTerr.walls = []; sTerr.paths = [];
const solid = sTerr.solids[0];
const sr = K.OBSTACLE_RADIUS[solid.kind];
sTerr.hero.x = solid.x - (K.HERO_RADIUS + sr + 30); sTerr.hero.y = solid.y;
run(sTerr, 1000, { x: 1, y: 0 });
const dSolid = Math.hypot(sTerr.hero.x - solid.x, sTerr.hero.y - solid.y);
ok(dSolid >= K.HERO_RADIUS + sr - 1, `a solid stops the hero (d=${dSolid | 0} >= ${K.HERO_RADIUS + sr})`);
// A wall blocks the hero.
const sT2w = ww.buildArena(ww.levelById(id));
stowAll(sT2w);
sT2w.solids = []; sT2w.paths = [];
const wall = sT2w.walls[0];
const bmx = (wall.x1 + wall.x2) / 2, bmy = (wall.y1 + wall.y2) / 2;
const bdx = wall.x2 - wall.x1, bdy = wall.y2 - wall.y1, bl = Math.hypot(bdx, bdy) || 1;
const nx = -bdy / bl, ny = bdx / bl;
sT2w.hero.x = bmx + nx * (K.HERO_RADIUS + K.WALL_HALF + 40);
sT2w.hero.y = bmy + ny * (K.HERO_RADIUS + K.WALL_HALF + 40);
run(sT2w, 1200, { x: -nx, y: -ny });
const wcd = ww.closestOnSegment(sT2w.hero.x, sT2w.hero.y, wall.x1, wall.y1, wall.x2, wall.y2).d;
ok(wcd >= K.HERO_RADIUS + K.WALL_HALF - 1, `a wall stops the hero (d=${wcd | 0})`);
// Path speeds travel.
const sp = ww.buildArena(ww.levelById(id));
stowAll(sp);
sp.solids = []; sp.walls = []; sp.paths = [];
sp.hero.x = 100; sp.hero.y = 100;
const baseX = sp.hero.x;
run(sp, 500, { x: 1, y: 0 });
const baseDist = sp.hero.x - baseX;
const sp2 = ww.buildArena(ww.levelById(id));
stowAll(sp2);
sp2.solids = []; sp2.walls = [];
sp2.paths = [{ x1: 80, y1: 100, x2: 900, y2: 100 }];
sp2.hero.x = 100; sp2.hero.y = 100;
const pathX = sp2.hero.x;
run(sp2, 500, { x: 1, y: 0 });
const pathDist = sp2.hero.x - pathX;
ok(pathDist > baseDist + 1, `the hero runs faster on a lane (${baseDist | 0} -> ${pathDist | 0})`);

// 13. Legacy — hunts and falls fold once into a private key; best time never worsens.
store.delete(LEGACY_KEY);
ok(ww.loadWwLegacy().runs === 0, "an untouched legacy starts empty");
const lv = ww.levelById(id);
const l1 = ww.recordHunt(lv, 5000, 4, 1);
ok(l1.runs === 1 && l1.hunts === 1 && l1.best[id] === 5000, "recordHunt folds a claim");
ok(l1.cairnsMarked === 4, "recordHunt folds cairns marked");
const l2 = ww.recordHunt(lv, 8000);
ok(l2.best[id] === 5000, "a slower claim cannot worsen the best");
const l3 = ww.recordHunt(lv, 3000);
ok(l3.best[id] === 3000, "a faster claim sets a new best");
const l4 = ww.recordFall(2, 3);
ok(l4.runs === 4 && l4.hunts === 3, "a fall bumps hunts but not claims");
ok(l4.slain === 3, "a fall folds the host cut down");
ok(ww.loadWwLegacy().best[id] === 3000, "the legacy persists to storage");
// Backward compatibility: an old save without the new fields defaults cleanly.
store.set(LEGACY_KEY, JSON.stringify({ runs: 2, hunts: 1, best: {} }));
const oldL = ww.loadWwLegacy();
ok(oldL.runs === 2 && oldL.cairnsMarked === 0 && oldL.slain === 0 && oldL.unlocked.includes("grey"),
  "an old save defaults the new fields");

// 14. Scoring — base/bonuses behave; a blow forfeits the untouched bonus; harder
//     villages multiply more.
const ssc = ww.buildArena(ww.levelById(id));
const sc0 = ww.scoreRun(ssc);
ok(sc0.base === ssc.total * K.SCORE_PER_KILL, `base score = ${K.SCORE_PER_KILL} per foe (${sc0.base})`);
ok(sc0.untouched > 0 && sc0.survival > 0, "an unscathed claim earns the bonuses");
ssc.hits = 2;
ok(ww.scoreRun(ssc).untouched === 0, "a blow forfeits the untouched bonus");
ok(ww.difficultyMult(ww.levelById("wulfmere")) > ww.difficultyMult(ww.levelById("thornwick")),
  "a harder village multiplies a claim's score more");

// 15. Pelts — the unlockable wolf-form variants, bought with moonstones.
ok(Array.isArray(ww.PELT_TYPES) && ww.PELT_TYPES.length >= 3, `pelts are defined (${ww.PELT_TYPES.length})`);
ok(new Set(ww.PELT_TYPES.map((t) => t.id)).size === ww.PELT_TYPES.length, "pelt ids are unique");
const starter = ww.PELT_TYPES[0];
ok(starter.cost === 0, "the starter pelt costs nothing (always owned)");
ok(ww.peltTypeById("grey").id === "grey" && ww.peltTypeById("nope").id === starter.id,
  "peltTypeById resolves known ids, falls back to the starter");
ww.saveWwLegacy(ww.emptyWwLegacy());
const dire = ww.PELT_TYPES.find((t) => t.id === "dire");
let le = ww.unlockPelt("dire");
ok(!le.unlocked.includes("dire"), "a pelt can't be taken with no moonstones");
le = ww.loadWwLegacy(); le.moonstones = 1000; ww.saveWwLegacy(le);
le = ww.unlockPelt("dire");
ok(le.unlocked.includes("dire") && le.moonstones === 1000 - dire.cost, "taking a pelt deducts its moonstones");
le = ww.equipPelt("fell");
ok(le.equipped !== "fell", "an unowned pelt can't be worn");
le = ww.equipPelt("dire");
ok(le.equipped === "dire", "an owned pelt is worn");
const sD = ww.buildArena(ww.levelById(id));
ok(sD.pelt.id === "dire", "the worn pelt resolves onto the hunt");
// Moonstones bank from hunts: a claim banks score/MOONSTONE_SCORE_DIV, a fall per kill.
ww.saveWwLegacy(ww.emptyWwLegacy());
const ow = ww.recordHunt(ww.levelById(id), 1000, 0, 17);
ok(ow.moonstones === 17, "a claim banks its moonstones");
const fl = ww.recordFall(0, 4, 9);
ok(fl.moonstones === 17 + 9, "a fall banks its moonstones on top (17 + 9)");
ok(fl.slain === 4, "a fall folds the host cut down");

// 15b. The Fell pelt's MOONBLOOD power — each kill stokes extra fury.
ww.saveWwLegacy(ww.emptyWwLegacy());
{
  let lc = ww.loadWwLegacy(); lc.unlocked.push("fell"); lc.equipped = "fell"; ww.saveWwLegacy(lc);
  const sv = ww.buildArena(ww.levelById(id));
  ok(sv.pelt.power === "moonblood", "the Fell Pelt carries the moonblood power");
  sv.hero.fury = 0.2;
  const target = mkF(5, 5);
  sv.foes = [target];
  ww.slay(sv, target);
  ok(Math.abs(sv.hero.fury - (0.2 + K.FURY_PER_KILL + K.MOONBLOOD_FURY)) < 1e-9,
    "a moonblood kill stokes extra fury");
}
// 15c. The Dire pelt's FRENZY power — a kill leaps to the nearest foe.
{
  let lc = ww.loadWwLegacy(); lc.unlocked.push("dire"); lc.equipped = "dire"; ww.saveWwLegacy(lc);
  const sy = ww.buildArena(ww.levelById(id));
  ok(sy.pelt.power === "frenzy", "the Dire Pelt carries the frenzy power");
  const dying = mkF(700, 700), neighbour = mkF(700 + K.FRENZY_RANGE - 20, 700);
  sy.foes = [dying, neighbour];
  const nHp0 = neighbour.hp;
  ww.slay(sy, dying);
  ok(neighbour.hp < nHp0 || neighbour.dead, "a frenzy kill leaps damage to the nearest foe");
}
ww.saveWwLegacy(ww.emptyWwLegacy());

// 16. Render smoke — render/scaffold don't throw with zero sprites, at the start and
//     after a spread of state changes.
const svgNode = makeNode();
let threw = false;
try {
  const camLayer = ww.scaffold(svgNode);
  const srn = ww.buildArena(ww.levelById(id));
  ww.render(srn, camLayer);
  // Mutate a spread of state, then render again.
  const someCairn = srn.cairns[0];
  if (someCairn) { someCairn.lit = true; someCairn.litAt = 0; }
  const otherCairn = srn.cairns[1];
  if (otherCairn) { otherCairn.cleansed = srn.elapsed + K.CLEANSE_MS; }
  if (srn.foes[0]) { srn.foes[0].state = "hunt"; srn.foes[0].hp = 5; srn.foes[0].hit = srn.elapsed + 100; }
  if (srn.foes[1]) { srn.foes[1].variant = "huntsman"; srn.foes[1].aiming = true; }
  if (srn.foes[2]) { srn.foes[2].variant = "friar"; srn.foes[2].channeling = true; srn.foes[2].beamX = 50; srn.foes[2].beamY = 50; }
  if (srn.foes[3]) srn.foes[3].variant = "knight";
  if (srn.foes[4]) srn.foes[4].variant = "hound";
  srn.motes.push({ x: 400, y: 400, until: srn.elapsed + K.MOTE_TTL_MS });
  srn.bolts.push({ x: 450, y: 450, vx: 200, vy: 50, dead: false, bornAt: srn.elapsed });
  srn.pulses.push({ x: 500, y: 500, r: 80, until: srn.elapsed + 300 });
  srn.moon = 0.5; // deep night (the night wash)
  srn.hero.form = "wolf"; srn.hero.charge = 1; srn.hero.overcharge = 1; srn.hero.hurt = 200;
  ww.render(srn, camLayer);
  srn.hero.form = "human"; // render the man too
  ww.render(srn, camLayer);
  ww.scenerySprite(srn, someCairn || srn.scenery[0]);
  ww.spriteFor(srn.level, "ground");
} catch (err) {
  threw = true;
  console.error(err);
}
ok(!threw, "render and scaffold run headlessly with zero sprites, at start and after state changes");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
