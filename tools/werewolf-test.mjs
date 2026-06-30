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
  wanderAngle: 0, homeX: x, homeY: y, attackCd: 0, shootCd: 0, hit: 0, bornAt: 0, alarm: 0,
});
// Force the hero into the beast (so the maul can rend) for a sim slice.
const beast = (s) => { s.hero.form = "wolf"; s.hero.fury = 1; };
// Force the wolf to a full sprint's momentum (so a contact bite hits at full force).
const sprint = (s) => { s.hero.form = "wolf"; s.hero.fury = 1; s.hero.momentum = 1; };

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

// 3. The maul rends — but ONLY as a wolf, on CONTACT, with the force scaling by
//    MOMENTUM. A man cannot fight; a wolf bites the nearest foe in reach; a foe out of
//    contact reach is spared; the bite holds a cadence.
const s2 = ww.buildArena(ww.levelById(id));
stowAll(s2);
s2.cairns = []; // isolate from any den a bite might claim
s2.hero.x = 700; s2.hero.y = 700;
const reach2 = K.HERO_RADIUS + K.FOE_RADIUS + K.MAUL_REACH;
const near = mkF(700 + reach2 - 8, 700);
const far = mkF(700 + reach2 + 120, 700);
s2.foes = [near, far];
// As a MAN, contact is no threat — the maul never fires.
s2.hero.form = "human"; s2.hero.momentum = 1; s2.hero.biteCd = 0;
const nearHp0 = near.hp;
ww.stepMaul(s2, 16);
ok(near.hp === nearHp0, "a man cannot fight — no bite, whatever the speed");
// As a WOLF, the same contact rends: the near foe is bitten, the far one spared.
s2.hero.form = "wolf"; s2.hero.momentum = 1; s2.hero.biteCd = 0;
ww.stepMaul(s2, 16);
ok(near.hp < nearHp0, "the wolf's maul rends the foe in contact reach");
ok(far.hp === K.FOE_HP, "a foe beyond the maul's reach is spared");
ok(s2.hero.biteCd > 0, "after a bite the maul holds its cadence before the next");

// 3a. The bite scales with MOMENTUM — a full-run bite out-bites a near-standing graze.
function biteDmg(mom) {
  const sb = ww.buildArena(ww.levelById(id));
  stowAll(sb); sb.cairns = [];
  sb.hero.x = 700; sb.hero.y = 700; sb.hero.form = "wolf"; sb.hero.momentum = mom; sb.hero.lunge = 0;
  const t = mkF(700 + reach2 - 6, 700, "villager", 1e6);
  sb.foes = [t];
  ww.bite(sb, t);
  return 1e6 - t.hp;
}
ok(biteDmg(1) > biteDmg(0) + 1, `a full-run bite out-bites a standing graze (${biteDmg(0).toFixed(1)} -> ${biteDmg(1).toFixed(1)})`);
ok(Math.abs(biteDmg(0) - K.MAUL_DMG * K.MAUL_MIN_MUL) < 1e-6, "a standing bite is the MAUL_MIN_MUL fraction");

// 3b. The blood-moon sigil geometry (kept as a cosmetic flourish): two rings (the full
//     moon), claw-rakes, radial rays — a closed path.
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
sT1.hero.x = 700; sT1.hero.y = 700; sT1.moon = 0.5; sT1.hero.fury = 0.9; // deep night, near the crest
run(sT1, 400, still);
ok(sT1.hero.form === "wolf", "moonlight swells a man's fury until he turns beast");
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

// 6. The predator-hunt AI. PREY flee a near wolf (and FLOCK); ALARM radiates, spreads
//    prey→prey, decays; a roused village sends the HUNTERS converging; a calm MAN is
//    unseen (stealth). The villager/hound are prey; the knight/huntsman/friar hunt.
ok(ww.isPrey("villager") && ww.isPrey("hound") && !ww.isPrey("knight")
  && !ww.isPrey("huntsman") && !ww.isPrey("friar"), "prey are the villager & hound; the rest hunt");

// A wolf near a prey raises its alarm and it flees (moves away from the beast).
const s4 = ww.buildArena(ww.levelById(id));
stowAll(s4); s4.solids = []; s4.walls = []; s4.scenery = []; s4.mists = []; s4.cairns = [];
sprint(s4); // a wolf at full sprint reads loudest
s4.hero.x = 700; s4.hero.y = 700;
const flee1 = mkF(700 + 120, 700); flee1.state = "lurk"; flee1.alarm = 0;
s4.foes = [flee1];
const fx0 = flee1.x;
ww.stepFoes(s4, 100);
ok(flee1.alarm > 0, "a wolf nearby drives a prey's alarm up");
ok(flee1.state === "hunt" && flee1.x > fx0, "an alarmed prey breaks and FLEES (away from the wolf)");

// Alarm spreads prey→prey: a calm prey beside a terrified one catches the panic.
const sSpread = ww.buildArena(ww.levelById(id));
stowAll(sSpread); sSpread.solids = []; sSpread.walls = []; sSpread.scenery = []; sSpread.cairns = [];
sSpread.hero.form = "human"; sSpread.hero.x = 5; sSpread.hero.y = 5; // hero far & calm: no radiation
const scared = mkF(700, 700); scared.alarm = 1;
const calm = mkF(700 + K.ALARM_SPREAD_R - 30, 700); calm.alarm = 0;
sSpread.foes = [scared, calm];
ww.stepFoes(sSpread, 200);
ok(calm.alarm > 0, "alarm spreads from a terrified prey to a near calm one");
// …and decays when nothing feeds it.
const sDecay = ww.buildArena(ww.levelById(id));
stowAll(sDecay); sDecay.solids = []; sDecay.walls = []; sDecay.scenery = []; sDecay.cairns = [];
sDecay.hero.form = "human"; sDecay.hero.x = 5; sDecay.hero.y = 5;
const lone = mkF(700, 700); lone.alarm = 0.8;
sDecay.foes = [lone];
ww.stepFoes(sDecay, 300);
ok(lone.alarm < 0.8, "alarm decays when nothing feeds it");

// A roused village (high average alarm) sends a DISTANT hunter converging.
const sRouse = ww.buildArena(ww.levelById("hollowby"));
stowAll(sRouse); sRouse.solids = []; sRouse.walls = []; sRouse.scenery = []; sRouse.cairns = [];
sRouse.hero.form = "human"; sRouse.hero.x = 5; sRouse.hero.y = 5;
const knightR = sRouse.foes.find((e) => e.variant === "knight") ?? sRouse.foes[0];
knightR.variant = "knight";
park(knightR, 1400, 1400); // far from the hero — proximity alone would not wake it
const mob = [knightR];
for (let i = 0; i < 6; i++) { const p = mkF(300 + i * 10, 300); p.alarm = 1; mob.push(p); }
sRouse.foes = mob; sRouse.total = 100; // high total so the cleanup sweep can't be the cause
ww.stepFoes(sRouse, 16);
ok(knightR.state === "hunt", "a roused village (high alarm) sends the hunters converging from afar");

// Stealth: a calm MAN beside a prey radiates nothing — it stays lurking and calm.
// (Keep the full roster stowed so the cleanup sweep never rouses the village.)
const sStealth = ww.buildArena(ww.levelById(id));
stowAll(sStealth); sStealth.solids = []; sStealth.walls = []; sStealth.scenery = []; sStealth.mists = []; sStealth.cairns = [];
sStealth.hero.form = "human"; sStealth.hero.x = 700; sStealth.hero.y = 700; sStealth.hero.vx = 0; sStealth.hero.vy = 0;
const unseen = sStealth.foes[0];
park(unseen, 700 + 80, 700); unseen.alarm = 0;
ww.stepFoes(sStealth, 200);
ok(unseen.state === "lurk" && unseen.alarm === 0, "a calm man passes unseen — a prey beside him never stirs");

// A cornered prey flails at the WOLF on top of it: a hit, i-frames, the flawless lost.
const s5 = ww.buildArena(ww.levelById(id));
stowAll(s5); s5.solids = []; s5.walls = []; s5.cairns = [];
sprint(s5);
const corner = s5.foes[0];
corner.variant = "villager"; corner.x = s5.hero.x; corner.y = s5.hero.y; corner.alarm = 1; corner.attackCd = 0;
corner.hp = 1e9; // don't let the maul fell it before it flails
s5.foes = [corner];
const hp1Before = s5.hero.hp;
ww.stepFoes(s5, 16);
ok(s5.hero.hp < hp1Before, `a cornered prey flails at the wolf (${hp1Before} -> ${s5.hero.hp})`);
ok(s5.hero.hurt > 0 && s5.hits === 1, "the flail sets i-frames and forfeits the flawless bonus");

// 6b. Huntsman — the ranged arm. It never melees: it holds a standoff and looses
//     silver bolts with line of sight; a wall stops the bolt; MIST hides the hero.
const sH = ww.buildArena(ww.levelById("greymoor"));
ok(sH.foes.some((e) => e.variant === "huntsman"), "greymoor musters a huntsman");
stowAll(sH); sH.solids = []; sH.walls = []; sH.cairns = []; sH.mists = []; sH.scenery = []; // woods would hide the hero too
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
s6.hero.x = 700; s6.hero.y = 700; s6.moon = 0.5; sprint(s6); s6.hero.biteCd = 0;
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

// 9. Dens — a KILL beside a dark den (a bite within reach of it) claims it; a claimed
//    den's aura grants fury/momentum, rends the host AND panics prey; a hunter cleanses it.
const sC = ww.buildArena(ww.levelById(id));
stowAll(sC);
const den = { x: 700, y: 700, kind: "cairn", lit: false };
sC.cairns = [den]; sC.scenery = [den]; sC.litCount = 0;
sC.hero.x = 700 + 40; sC.hero.y = 700; sprint(sC); sC.hero.fury = 0.5;
const victim = mkF(700 + 40 + (K.HERO_RADIUS + K.FOE_RADIUS + K.MAUL_REACH - 6), 700);
sC.foes = [victim];
ww.bite(sC, victim); // a bite beside the dark den
ok(den.lit && sC.litCount === 1, "a bite beside a dark den claims it");
ok(sC.hero.fury > 0.5, "claiming a den stokes the curse");
// A claimed den's aura grants the hero fury and tops up the wolf's momentum.
const sC2 = ww.buildArena(ww.levelById(id));
stowAll(sC2);
const den2 = { x: 700, y: 700, kind: "cairn", lit: true, litAt: 0 };
sC2.cairns = [den2];
sC2.hero.x = 700 + 30; sC2.hero.y = 700; sC2.hero.form = "wolf"; sC2.hero.fury = 0.4; sC2.hero.momentum = 0.2; sC2.foes = [];
ww.stepCairns(sC2, 1000);
ok(sC2.hero.fury > 0.4, "a claimed den's aura grants the hero fury");
ok(sC2.hero.momentum > 0.2, "a claimed den's aura tops up the wolf's momentum");
// …rends a foe caught in it, AND panics a prey (alarm up + shoved outward).
const sC3 = ww.buildArena(ww.levelById(id));
stowAll(sC3);
const den3 = { x: 700, y: 700, kind: "cairn", lit: true, litAt: 0 };
sC3.cairns = [den3]; sC3.hero.x = 5; sC3.hero.y = 5;
const rent = mkF(700 + 30, 700); rent.alarm = 0;
sC3.foes = [rent];
const rentHp0 = rent.hp, rentX0 = rent.x;
ww.stepCairns(sC3, 600);
ok(rent.hp < rentHp0, "a claimed den rends a foe in its aura (ally emitter)");
ok(rent.alarm > 0 && rent.x > rentX0, "a claimed den panics prey in its aura (alarm up, shoved out)");
// A HUNTER brushing a claimed den cleanses it (dark + scar).
const sC4 = ww.buildArena(ww.levelById(id));
stowAll(sC4); sC4.solids = []; sC4.walls = [];
const den4 = { x: 700, y: 700, kind: "cairn", lit: true, litAt: 0 };
sC4.cairns = [den4]; sC4.scenery = [den4]; sC4.litCount = 1; sC4.hero.x = 5; sC4.hero.y = 5;
const cleanser = mkF(700 + 10, 700, "knight"); wake(cleanser);
sC4.foes = [cleanser];
ww.stepFoes(sC4, 16);
ok(!den4.lit && sC4.litCount === 0 && sC4.cleansedCount === 1, "a hunter brushing a claimed den cleanses it");
ok(ww.nearScar(sC4, den4.x, den4.y), "a cleansed den scars the ground");
// A still-scarred den resists re-claiming.
sC4.hero.x = 720; sC4.hero.y = 700; sprint(sC4);
const v2 = mkF(720 + (K.HERO_RADIUS + K.FOE_RADIUS + K.MAUL_REACH - 6), 700);
sC4.foes = [v2];
ww.bite(sC4, v2);
ok(!den4.lit && sC4.litCount === 0, "the scar bars re-claiming until it fades");

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

// 11. Momentum & the pounce — the predator's weapon. Momentum BUILDS while the wolf
//     runs and BLEEDS while it stands; a moonwell holds it; at POUNCE_AT a frontal foe
//     is auto-pounced (a locked lunge), spending the momentum.
const sMo = ww.buildArena(ww.levelById(id));
stowAll(sMo); sMo.solids = []; sMo.walls = []; sMo.paths = []; sMo.cairns = []; sMo.moonwells = []; sMo.scenery = [];
sMo.hero.x = 700; sMo.hero.y = 700; beast(sMo); sMo.moon = 0.5; sMo.hero.momentum = 0;
run(sMo, 700, { x: 1, y: 0 }); // a full run east
ok(sMo.hero.momentum > 0.5, `momentum builds while the wolf runs (${sMo.hero.momentum.toFixed(2)})`);
const moRun = sMo.hero.momentum;
run(sMo, 700, still); // now stand
ok(sMo.hero.momentum < moRun, "momentum bleeds while the wolf stands still");
// A moonwell holds momentum even at a standstill.
const sMw = ww.buildArena(ww.levelById(id));
stowAll(sMw); sMw.solids = []; sMw.walls = []; sMw.paths = []; sMw.cairns = []; sMw.scenery = [];
sMw.hero.x = 700; sMw.hero.y = 700; beast(sMw); sMw.hero.momentum = 0.8;
sMw.moonwells = [{ x: 700, y: 700, kind: "moonwell" }];
run(sMw, 600, still);
ok(sMw.hero.momentum >= 0.8 - 1e-6, "a moonwell holds the wolf's momentum at a standstill");
// The pounce: full momentum + a frontal foe → a locked lunge fires, spending momentum.
const sP = ww.buildArena(ww.levelById(id));
stowAll(sP); sP.solids = []; sP.walls = []; sP.cairns = [];
sP.hero.x = 700; sP.hero.y = 700; sP.hero.form = "wolf"; sP.hero.fury = 1;
sP.hero.facing = 0; sP.hero.momentum = 1; sP.hero.pounceCd = 0; sP.hero.lunge = 0; sP.hero.biteCd = 1e9;
const ahead = mkF(700 + K.POUNCE_RANGE - 40, 700); // straight ahead, within pounce range
sP.foes = [ahead];
ww.stepMaul(sP, 16);
ok(sP.hero.lunge > 0, "a frontal foe at full momentum triggers a pounce-lunge");
ok(sP.hero.pounceCd > 0 && sP.hero.momentum <= K.POUNCE_SPEND + 1e-6, "the pounce sets its cooldown and spends momentum");
// A foe BEHIND the wolf is not pounced (the cone is frontal).
const sPb = ww.buildArena(ww.levelById(id));
stowAll(sPb); sPb.solids = []; sPb.walls = []; sPb.cairns = [];
sPb.hero.x = 700; sPb.hero.y = 700; sPb.hero.form = "wolf"; sPb.hero.fury = 1;
sPb.hero.facing = 0; sPb.hero.momentum = 1; sPb.hero.pounceCd = 0; sPb.hero.lunge = 0; sPb.hero.biteCd = 1e9;
const behind = mkF(700 - (K.POUNCE_RANGE - 40), 700); // directly behind the heading
sPb.foes = [behind];
ww.stepMaul(sPb, 16);
ok(sPb.hero.lunge === 0, "a foe behind the wolf is outside the pounce cone");
// A mid-lunge bite hits harder than the same standing bite (POUNCE_DMG_MUL).
function lungeBite(lunge) {
  const sl = ww.buildArena(ww.levelById(id));
  stowAll(sl); sl.cairns = [];
  sl.hero.x = 700; sl.hero.y = 700; sl.hero.form = "wolf"; sl.hero.momentum = 0; sl.hero.lunge = lunge;
  const t = mkF(700 + (K.HERO_RADIUS + K.FOE_RADIUS + K.MAUL_REACH - 6), 700, "villager", 1e6);
  sl.foes = [t];
  ww.bite(sl, t);
  return 1e6 - t.hp;
}
ok(lungeBite(K.POUNCE_MS) > lungeBite(0) + 1, "a bite landed mid-lunge hits harder (the pounce-bite)");

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
  srn.hero.form = "wolf"; srn.hero.momentum = 1; srn.hero.lunge = 120; srn.hero.facing = 0.6; srn.hero.hurt = 200;
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

// === The expanded maps — four further villages + the new terrain vocabulary ===

// N1. The four new villages resolve and generate their signature terrain/obstacles.
ok(ww.LEVELS.length === 8, `the maps now run to eight villages (${ww.LEVELS.length})`);
ok(["ashthorn", "mirefen", "galehead", "direhollow"].every((vid) => ww.levelById(vid)),
  "the four new villages resolve by id");
const ntAsh = ww.buildArena(ww.levelById("ashthorn"));
ok(ntAsh.scenery.some((n) => n.kind === "marshfire") && ntAsh.scenery.some((n) => n.kind === "bramble")
  && ntAsh.solids.some((n) => n.kind === "pyre"),
  "Ashthorn has marsh-fire, brambles, and (solid) pyres");
const ntMire = ww.buildArena(ww.levelById("mirefen"));
ok(ntMire.scenery.some((n) => n.kind === "bog") && ntMire.scenery.some((n) => n.kind === "wolfsbane")
  && ntMire.scenery.some((n) => n.kind === "spring"),
  "Mirefen has bog, wolfsbane, and springs");
const ntGale = ww.buildArena(ww.levelById("galehead"));
ok(ntGale.scenery.some((n) => n.kind === "gale") && ntGale.scenery.some((n) => n.kind === "glade")
  && ntGale.scenery.some((n) => n.kind === "hoard"),
  "Galehead has gales, glades, and hoards");
const ntDire = ww.buildArena(ww.levelById("direhollow"));
ok(ntDire.scenery.some((n) => n.kind === "geyser") && ntDire.scenery.some((n) => n.kind === "wisp"),
  "Direhollow gathers geysers and wisps");
ok(ntDire.solids.some((n) => n.kind === "dolmen"), "a dolmen is a solid (blocks bodies)");
ok(ww.difficultyMult(ww.levelById("wulfmere")) > ww.difficultyMult(ww.levelById("thornwick")),
  "the difficulty ordering still holds with the new villages");

// N2. Emitter ground — pyre, wisp, and marsh-fire burn the watch in their auras.
for (const [kind, aura] of [["pyre", K.PYRE_AURA], ["wisp", K.WISP_AURA], ["marshfire", K.MARSHFIRE_AURA]]) {
  const sfl = ww.buildArena(ww.levelById("thornwick"));
  stowAll(sfl);
  const node = { x: 700, y: 700, kind };
  sfl.scenery = [node];
  const burn = sfl.foes[0]; burn.dead = false; burn.x = node.x; burn.y = node.y; burn.hp = K.FOE_HP;
  const hp0 = burn.hp;
  ww.stepFields(sfl, 1000);
  ok(burn.hp < hp0, `a ${kind} burns a foe in its aura (${hp0} -> ${burn.hp.toFixed(1)})`);
  const safe = sfl.foes[1]; safe.dead = false; safe.x = node.x + aura + 60; safe.y = node.y;
  const safe0 = safe.hp;
  ww.stepFields(sfl, 1000);
  ok(safe.hp === safe0, `a foe beyond a ${kind}'s aura is unharmed`);
}

// N3. Bogs slow every body; brambles slow only the watch.
const ntStm = ww.buildArena(ww.levelById("thornwick"));
ntStm.scenery = [{ x: 400, y: 400, kind: "bog" }];
ok(ww.terrainSpeedMul(ntStm, 400, 400, false) === K.BOG_SLOW, "a bog slows the hero");
ok(ww.terrainSpeedMul(ntStm, 400, 400, true) === K.BOG_SLOW, "a bog slows a foe too");
ok(ww.terrainSpeedMul(ntStm, 9000, 9000, false) === 1, "open ground does not slow");
ntStm.scenery = [{ x: 400, y: 400, kind: "bramble" }];
ok(ww.terrainSpeedMul(ntStm, 400, 400, false) === 1, "a bramble leaves the hero unslowed");
ok(ww.terrainSpeedMul(ntStm, 400, 400, true) === K.BRAMBLE_SLOW, "a bramble snares only a foe");
ok(K.BOG_SLOW < 1 && K.BRAMBLE_SLOW < 1, "the slows are real (multiplier < 1)");

// N4. Glades — a lesser moonwell: moonlit footing that HOLDS the wolf's momentum at a
//     standstill, and (for a man) swells fury at the night rate even by day.
const ntGl = ww.buildArena(ww.levelById("thornwick"));
stowAll(ntGl); ntGl.solids = []; ntGl.walls = []; ntGl.paths = []; ntGl.moonwells = [];
ntGl.scenery = [{ x: 1000, y: 1000, kind: "glade" }];
ok(ww.inGlade(ntGl, 1000, 1000), "inGlade reports the clearing");
ntGl.hero.x = 1000; ntGl.hero.y = 1000; ntGl.hero.form = "wolf"; ntGl.hero.fury = 1; ntGl.hero.momentum = 0.8;
run(ntGl, 500, still);
ok(ntGl.hero.momentum >= 0.8 - 1e-6, `a glade holds the wolf's momentum at a standstill (${ntGl.hero.momentum.toFixed(2)})`);
const ntGl2 = ww.buildArena(ww.levelById("thornwick"));
stowAll(ntGl2); ntGl2.solids = []; ntGl2.walls = []; ntGl2.paths = []; ntGl2.moonwells = []; ntGl2.scenery = [];
ntGl2.hero.x = 1000; ntGl2.hero.y = 1000; ntGl2.hero.form = "wolf"; ntGl2.hero.fury = 1; ntGl2.hero.momentum = 0.8;
run(ntGl2, 500, still);
ok(ntGl2.hero.momentum < 0.8, "off any glade, a standing wolf's momentum bleeds");

// N5. Springs — slowly mend the hero, but only to the cap.
const ntSp = ww.buildArena(ww.levelById("thornwick"));
stowAll(ntSp); ntSp.solids = []; ntSp.walls = []; ntSp.paths = [];
ntSp.scenery = [{ x: ntSp.hero.x, y: ntSp.hero.y, kind: "spring" }];
ntSp.hero.hp = 30;
run(ntSp, 1000, still);
ok(ntSp.hero.hp > 30, `a spring mends the hero (30 -> ${ntSp.hero.hp.toFixed(1)})`);
const ntSpC = ww.buildArena(ww.levelById("thornwick"));
stowAll(ntSpC); ntSpC.solids = []; ntSpC.walls = []; ntSpC.paths = [];
ntSpC.scenery = [{ x: ntSpC.hero.x, y: ntSpC.hero.y, kind: "spring" }];
const ntCap = ntSpC.hero.maxHp * K.SPRING_HEAL_CAP;
ntSpC.hero.hp = ntCap - 2;
run(ntSpC, 3000, still);
ok(ntSpC.hero.hp <= ntCap + 1e-6, `a spring mends only to the cap (${ntSpC.hero.hp.toFixed(1)} <= ${ntCap})`);

// N6. Geysers erupt on their cadence, burning the watch in reach.
const ntGy = ww.buildArena(ww.levelById("thornwick"));
stowAll(ntGy);
const ntGyN = { x: 700, y: 700, kind: "geyser" };
ntGy.scenery = [ntGyN];
const ntGyF = ntGy.foes[0]; ntGyF.dead = false; ntGyF.x = ntGyN.x; ntGyF.y = ntGyN.y; ntGyF.hp = K.FOE_HP;
ww.stepGeysers(ntGy, 16); // seeds the clock; no eruption on the first tick
ok(ntGyF.hp === K.FOE_HP, "a geyser does not erupt before its cadence");
ntGy.elapsed += K.GEYSER_CD + 1;
ww.stepGeysers(ntGy, 16);
ok(ntGyF.hp < K.FOE_HP, "a geyser erupts on its cadence and burns the watch");

// N7. Gales — a moor-wind holds a foe off (it closes less than over open ground).
function ntGaleClose(withGale) {
  const sg = ww.buildArena(ww.levelById("thornwick"));
  stowAll(sg); sg.solids = []; sg.walls = []; sg.paths = [];
  const node = { x: 900, y: 900, kind: "gale" };
  sg.scenery = withGale ? [node] : [];
  sg.hero.x = node.x; sg.hero.y = node.y; // hero at the gale's heart
  const f = sg.foes[0]; f.dead = false; f.variant = "villager"; f.x = node.x + 90; f.y = node.y; f.state = "hunt";
  for (let t = 0; t < 300; t += 16) { ww.stepFoes(sg, 16); ww.stepGale(sg, 16); }
  return Math.hypot(f.x - node.x, f.y - node.y);
}
ok(ntGaleClose(true) > ntGaleClose(false) + 5, "a gale holds a foe off — it closes less than over open ground");

// N8. Wolfsbane — bleeds the hero's fury (less than without, over the same stand).
function ntFuryAfter(withBane) {
  const s = ww.buildArena(ww.levelById("thornwick"));
  stowAll(s); s.solids = []; s.walls = []; s.paths = []; s.moonwells = [];
  s.moon = 0.5; // night, so a standing man's fury swells
  s.scenery = withBane ? [{ x: s.hero.x, y: s.hero.y, kind: "wolfsbane" }] : [];
  s.hero.form = "human"; s.hero.fury = 0.3;
  run(s, 400, still);
  return s.hero.fury;
}
ok(ntFuryAfter(true) < ntFuryAfter(false), "wolfsbane bleeds the hero's fury (less than without it)");

// N9. Barrow-hoards — cracking one surges the curse, once.
const ntHo = ww.buildArena(ww.levelById("thornwick"));
stowAll(ntHo);
ntHo.scenery = [{ x: ntHo.hero.x, y: ntHo.hero.y, kind: "hoard" }];
ntHo.hero.fury = 0.2;
ww.stepHoards(ntHo);
ok(ntHo.scenery[0].spent, "the hero cracks a barrow-hoard underfoot");
ok(ntHo.hero.fury > 0.2, "a cracked hoard surges the curse (fury)");
const ntHoF = ntHo.hero.fury;
ww.stepHoards(ntHo);
ok(ntHo.hero.fury === ntHoF, "a spent hoard surges nothing more");

// N10. Render handles a new-terrain village headlessly (exercises renderNewTerrain).
let ntThrew = false;
try { ww.render(ww.buildArena(ww.levelById("direhollow")), makeNode()); }
catch (err) { ntThrew = true; console.error(err); }
ok(!ntThrew, "render draws the new terrain/obstacles headlessly with zero sprites");

// N11. Woods — concealing cover (the static cousin of mist): the wolf melts into
//      the trees — huntsmen hold fire, and the watch is slower to rouse.
const ntWd = ww.buildArena(ww.levelById("thornwick"));
stowAll(ntWd); ntWd.solids = []; ntWd.walls = []; ntWd.paths = []; ntWd.mists = [];
ntWd.scenery = [{ x: ntWd.hero.x, y: ntWd.hero.y, kind: "woods" }];
beast(ntWd); // a wolf is normally NOT stealthy — the woods hide it anyway
ok(ww.inWoods(ntWd, ntWd.hero.x, ntWd.hero.y), "inWoods reports the canopy");
ok(!ww.inWoods(ntWd, ntWd.hero.x + K.WOODS_AURA + 40, ntWd.hero.y), "a stand of woods is finite");
const wdH = ntWd.foes[0];
wdH.variant = "huntsman"; wdH.dead = false; wdH.shootCd = 0; wdH.hp = Math.round(K.FOE_HP * K.HUNTSMAN_HP_MUL);
wdH.x = ntWd.hero.x + (K.HUNTSMAN_RANGE - 40); wdH.y = ntWd.hero.y; wdH.state = "hunt";
wdH.homeX = wdH.x; wdH.homeY = wdH.y;
const wdHp0 = ntWd.hero.hp;
run(ntWd, K.HUNTSMAN_SHOOT_CD * 2 + 200, still);
ok(ntWd.bolts.length === 0 && ntWd.hero.hp === wdHp0, "a huntsman holds fire while the wolf hides in the woods");
const ntWd2 = ww.buildArena(ww.levelById("thornwick"));
stowAll(ntWd2); ntWd2.mists = [];
beast(ntWd2); // full beast aggro
const wdW = ntWd2.foes[0];
park(wdW, ntWd2.hero.x + K.FOE_AGGRO * 0.8, ntWd2.hero.y); // inside full aggro, outside the woods-dulled one
ntWd2.scenery = [{ x: ntWd2.hero.x, y: ntWd2.hero.y, kind: "woods" }];
ww.stepFoes(ntWd2, 16);
ok(wdW.state === "lurk", "the woods dull aggro — a foe that would rouse stays lurking");
ok(ww.buildArena(ww.levelById("ashthorn")).scenery.some((n) => n.kind === "woods"),
  "Ashthorn is forested (woods seed as tactical cover)");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
