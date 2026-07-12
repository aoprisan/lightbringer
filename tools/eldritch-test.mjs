// Headless watch test for The Watcher at the Threshold spinoff. No browser, no deps.
// Stubs just enough storage (and a minimal SVG document for the render smoke test) so
// eldritch.js loads, then drives the sim.
globalThis.__ELD_TEST__ = true;

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

// A minimal SVG document so render()/scaffold() run headlessly (the same shape the
// sibling necro test uses).
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

await import("../eldritch.js");
const eld = globalThis.__eld;
const K = eld.K;
const LEGACY_KEY = "eldritch.legacy.v1";
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok  -", msg); };

const still = { x: 0, y: 0 };
function run(s, ms, move = still, slice = 16) {
  for (let t = 0; t < ms; t += slice) eld.stepWatch(s, slice, move);
}
// Park a horror asleep (lurking) at a spot (its rift too): used to isolate by stowing
// the rest far from the Watcher, out of aggro range.
const park = (e, x, y) => { e.state = "lurk"; e.x = x; e.y = y; e.homeX = x; e.homeY = y; };
const wake = (e) => { e.state = "hunt"; };
function stowAll(s, x = 5, y = 5) { for (const e of s.horrors) park(e, x, y); }
// A fresh shambler at (x,y) — the test's stock horror.
const mkH = (x, y, v = "shambler", hp = K.HORROR_HP) => ({
  x, y, vx: 0, vy: 0, hp, maxHp: hp, dead: false, state: "hunt", variant: v,
  wanderAngle: 0, homeX: x, homeY: y, attackCd: 0, hit: 0, bornAt: 0,
});

const id = "innsmouth";

// Make a clean legacy first (so the equipped Sign is the starter for the early tests).
eld.saveEldLegacy(eld.emptyEldLegacy());

// 1. Places defined + arena generation knows known ids only.
ok(Array.isArray(eld.LEVELS) && eld.LEVELS.length >= 3, `places are defined (${eld.LEVELS.length})`);
ok(new Set(eld.LEVELS.map((l) => l.id)).size === eld.LEVELS.length, "place ids are unique");
ok(eld.levelById(id) && !eld.levelById("nope"), "levelById resolves known ids only");

// 2. A fresh watch dresses the place, musters a finite host, centres the Watcher at
//    full HP AND full SANITY, watching, with the starter Sign and no banishings.
const gen = eld.generateEldritch(eld.levelById(id));
ok(gen.nodes.length > 80, `arena dresses the place (${gen.nodes.length} nodes)`);
ok(gen.nodes.some((n) => n.kind === "ward"), "ward-stones are present");
ok(gen.rifts.length >= 4, `rifts are present (${gen.rifts.length})`);

const s = eld.buildArena(eld.levelById(id));
ok(s.wards.length > 0 && s.wards.every((w) => w.kind === "ward"), `wards are cached (${s.wards.length})`);
ok(s.total === gen.rifts.length * K.HORROR_PER_RIFT || s.total === s.horrors.length,
  `finite host >= rifts*${K.HORROR_PER_RIFT} (${s.total})`);
ok(s.horrors.length === s.total && s.total > 0, "every horror is rostered");
ok(s.hero.x === s.w / 2 && s.hero.y === s.h / 2, "the Watcher starts at the place's heart");
ok(s.hero.hp === K.HERO_HP && s.hero.sanity === K.HERO_SANITY && s.phase === "watch",
  "the Watcher begins at full health AND full sanity, watching");
ok(s.sign.id === "elder", "a fresh watch equips the starter Elder Sign");
ok(eld.aliveHorrors(s) === s.total && eld.clearedPct(s) === 0, "all horrors alive, none banished yet");
ok(s.horrors.every((e) => e.state === "lurk"), "the host begins lurking, not hunting");

// 3. The Elder Sign banishes — only when sufficiently traced (stand still). A pulse
//    damages every horror in reach, costs sanity, and an uninscribed sign does nothing.
const s2 = eld.buildArena(eld.levelById(id));
stowAll(s2);
s2.wards = []; // isolate the sanity cost from any ward the pulse might seal (which refunds sanity)
s2.hero.x = 700; s2.hero.y = 700;
const near = mkH(700 + 40, 700);
const far = mkH(700 + K.SIGN_RADIUS + 120, 700);
s2.horrors = [near, far];
// A faint (untraced) sign with the cadence ready still does NOT pulse.
s2.hero.charge = K.SIGN_BANISH_AT - 0.01; s2.hero.signCd = 0;
const sanBefore = s2.hero.sanity, nearHp0 = near.hp;
eld.stepSign(s2, 16);
ok(near.hp === nearHp0 && s2.hero.sanity === sanBefore, "a faint (untraced) sign does not pulse");
// A fully-traced sign pulses: the near horror is hit, the far one spared, sanity paid.
s2.hero.charge = 1; s2.hero.signCd = 0;
eld.stepSign(s2, 16);
ok(near.hp < nearHp0, "an inscribed Sign banishes the horror in reach");
ok(far.hp === K.HORROR_HP, "a horror outside the Sign's reach is spared");
ok(s2.hero.sanity < sanBefore, `tracing the Sign frays the mind (${sanBefore} -> ${s2.hero.sanity.toFixed(1)})`);
ok(s2.hero.signCd > 0, "after a pulse the Sign holds its cadence before the next");

// 3b. The stand-still gate end-to-end through stepWatch: moving past horrors never
//     traces the sign (charge stays low); halting traces it and then banishes.
const sMove = eld.buildArena(eld.levelById(id));
stowAll(sMove);
sMove.hero.x = 700; sMove.hero.y = 700;
run(sMove, 600, { x: 1, y: 0 });
ok(sMove.hero.charge < K.SIGN_BANISH_AT, `a moving Watcher's sign stays faint (${sMove.hero.charge.toFixed(2)})`);
const sHold = eld.buildArena(eld.levelById(id));
stowAll(sHold);
sHold.hero.x = 700; sHold.hero.y = 700;
sHold.horrors = [mkH(740, 700)]; // one horror in reach, set to hunt
const holdHp0 = sHold.horrors[0].hp;
run(sHold, 1400, still);
ok(sHold.hero.charge >= K.SIGN_BANISH_AT, `holding still traces the Sign (${sHold.hero.charge.toFixed(2)})`);
ok(sHold.horrors[0].dead || sHold.horrors[0].hp < holdHp0, "a traced Sign banishes the host that stands in it");

// 3c. The Sign geometry: the Necronomicon Sigil of the Gateway — a ring (arcs)
//     enclosing a straight-line lattice plus three binding loops, closed.
const pp = eld.pentagramPath(100, 100, 50, 0);
ok(pp.startsWith("M") && pp.trimEnd().endsWith("Z"), "pentagramPath is a closed path");
ok((pp.match(/A/g) || []).length >= 8, "pentagramPath arcs the ring and the binding loops");
ok((pp.match(/L/g) || []).length >= 9, "pentagramPath strings the gateway lattice");

// 4. Banishing — hurtHorror drives a horror to 0 and banish counts it; a dead horror
//    is inert; clearedPct tracks.
const s3 = eld.buildArena(eld.levelById(id));
const e3 = s3.horrors[0];
const ban0 = s3.banished;
eld.hurtHorror(s3, e3, e3.hp + 5);
ok(e3.dead && s3.banished === ban0 + 1, "a horror driven to 0 hp is banished and counted");
const ban1 = s3.banished;
eld.hurtHorror(s3, e3, 100);
ok(s3.banished === ban1, "a banished horror is inert (no double-count)");

// 5. SANITY — DREAD bleeds the mind from the host's nearness; a far host does not.
const sd = eld.buildArena(eld.levelById(id));
stowAll(sd);
sd.hero.x = 700; sd.hero.y = 700; sd.hero.charge = 0;
sd.horrors = [mkH(700 + 60, 700)]; // a hunting horror at the Watcher's elbow
const san0 = sd.hero.sanity;
eld.stepDread(sd, 1000);
ok(sd.hero.sanity < san0, `the host's nearness bleeds the mind (${san0} -> ${sd.hero.sanity.toFixed(1)})`);
// A lurking horror (not yet hunting) causes no dread.
const sd2 = eld.buildArena(eld.levelById(id));
stowAll(sd2);
sd2.hero.x = 700; sd2.hero.y = 700;
sd2.horrors = [{ ...mkH(760, 700), state: "lurk" }];
const san2 = sd2.hero.sanity;
eld.stepDread(sd2, 1000);
ok(sd2.hero.sanity === san2, "a lurking horror casts no dread (only a hunting one does)");
// A far hunting horror, beyond DREAD_RADIUS, casts none either.
const sd3 = eld.buildArena(eld.levelById(id));
stowAll(sd3);
sd3.hero.x = 700; sd3.hero.y = 700;
sd3.horrors = [mkH(700 + K.DREAD_RADIUS + 100, 700)];
const san3 = sd3.hero.sanity;
eld.stepDread(sd3, 1000);
ok(sd3.hero.sanity === san3, "a host beyond the dread radius casts no dread");

// 6. The host AI — rouses on the Watcher in aggro (sticky), closes, and claws; the
//    claw sets i-frames, counts the hit, knocks back.
const s4 = eld.buildArena(eld.levelById(id));
stowAll(s4);
const hNear = s4.horrors[0], hFar = s4.horrors[1];
park(hNear, s4.hero.x + K.HORROR_AGGRO - 40, s4.hero.y);
park(hFar, s4.hero.x + K.HORROR_AGGRO + 140, s4.hero.y);
s4.hero.charge = 0;
eld.stepHorrors(s4, 16);
ok(hNear.state === "hunt", "a lurker rouses when the Watcher is in aggro");
ok(hFar.state === "lurk", "a lurker beyond aggro keeps watching");
s4.hero.x = 40; s4.hero.y = 40; // flee far
eld.stepHorrors(s4, 16);
ok(hNear.state === "hunt", "aggro is sticky — a roused horror never settles back");
// A horror glued to the Watcher claws it, sets i-frames, counts the hit.
const s5 = eld.buildArena(eld.levelById(id));
stowAll(s5);
s5.solids = []; s5.walls = []; s5.wards = [];
const biter = s5.horrors[0];
biter.x = s5.hero.x; biter.y = s5.hero.y; wake(biter); biter.attackCd = 0;
const hp1Before = s5.hero.hp;
eld.stepHorrors(s5, 16);
ok(s5.hero.hp < hp1Before, `a horror in contact claws the Watcher (${hp1Before} -> ${s5.hero.hp})`);
ok(s5.hero.hurt > 0, "a claw sets i-frames");
ok(s5.hits === 1, "a landed claw is counted (for the flawless bonus)");
biter.x = s5.hero.x; biter.y = s5.hero.y; biter.attackCd = 0;
const hp2 = s5.hero.hp;
eld.stepHorrors(s5, 16);
ok(s5.hero.hp === hp2, "i-frames spare the Watcher an immediate second claw");

// 6b. Gazer — the standoff sanity-threat. It never claws: it holds a standoff and,
//     with line of sight, lances the mind. A wall breaks the gaze; a near threat is kited.
const sG = eld.buildArena(eld.levelById("dunwich"));
ok(sG.horrors.some((e) => e.variant === "gazer"), "dunwich musters a gazer");
stowAll(sG); sG.solids = []; sG.walls = []; sG.wards = [];
const gz = sG.horrors.find((e) => e.variant === "gazer") ?? sG.horrors[0];
gz.variant = "gazer"; wake(gz); gz.x = 800; gz.y = 800;
sG.hero.x = 800 + (K.GAZER_RANGE - 40); sG.hero.y = 800; sG.hero.charge = 0;
sG.horrors = [gz];
const gSan0 = sG.hero.sanity, gHp0 = sG.hero.hp;
eld.stepHorrors(sG, 1000);
ok(sG.hero.sanity < gSan0, `a gazer with line of sight lances the Watcher's mind (${gSan0} -> ${sG.hero.sanity.toFixed(1)})`);
ok(sG.hero.hp === gHp0 && sG.hits === 0, "a gazer never claws (no HP loss, no hit)");
// A wall between breaks the gaze.
const sG2 = eld.buildArena(eld.levelById("dunwich"));
stowAll(sG2); sG2.solids = []; sG2.wards = [];
const gz2 = sG2.horrors.find((e) => e.variant === "gazer") ?? sG2.horrors[0];
gz2.variant = "gazer"; wake(gz2); gz2.x = 800; gz2.y = 800;
sG2.hero.x = 1000; sG2.hero.y = 800; sG2.hero.charge = 0;
sG2.horrors = [gz2];
sG2.walls = [{ x1: 900, y1: 760, x2: 900, y2: 840 }]; // a wall on the line of sight
const gSan2 = sG2.hero.sanity;
eld.stepHorrors(sG2, 1000);
ok(sG2.hero.sanity === gSan2, "a wall between breaks a gazer's gaze (the mind is spared)");
// It kites away from a near threat rather than closing.
const sG3 = eld.buildArena(eld.levelById("dunwich"));
stowAll(sG3); sG3.solids = []; sG3.walls = []; sG3.wards = [];
const gz3 = sG3.horrors.find((e) => e.variant === "gazer") ?? sG3.horrors[0];
gz3.variant = "gazer"; wake(gz3); gz3.x = 800; gz3.y = 800;
sG3.hero.x = 800 + 40; sG3.hero.y = 800; // well inside the standoff
sG3.horrors = [gz3];
eld.stepHorrors(sG3, 16);
ok(gz3.vx * (sG3.hero.x - gz3.x) + gz3.vy * (sG3.hero.y - gz3.y) < 0, "a gazer kites away from a near threat (no claw rush)");

// 6c. Acolyte — the backline mender. It never claws: it holds back and mends the
//     most-wounded horror in range.
const sM = eld.buildArena(eld.levelById("kingsport"));
ok(sM.horrors.some((e) => e.variant === "acolyte"), "kingsport musters an acolyte");
stowAll(sM); sM.solids = []; sM.walls = []; sM.wards = [];
sM.hero.x = 50; sM.hero.y = 50; sM.hero.charge = 0;
const ac = sM.horrors.find((e) => e.variant === "acolyte") ?? sM.horrors[0];
ac.variant = "acolyte"; wake(ac); ac.x = 800; ac.y = 800;
const wounded = mkH(800 + 120, 800); wounded.hp = wounded.maxHp - 18;
sM.horrors = [ac, wounded];
const woundedHp0 = wounded.hp;
eld.stepHorrors(sM, 200);
ok(ac.mending === true, "an acolyte channels a mend into a wounded horror in range");
ok(wounded.hp > woundedHp0, "an acolyte heals its mark");
// An acolyte never claws the Watcher, even glued to it.
const sM2 = eld.buildArena(eld.levelById("kingsport"));
stowAll(sM2); sM2.solids = []; sM2.walls = []; sM2.wards = [];
const ac2 = sM2.horrors.find((e) => e.variant === "acolyte") ?? sM2.horrors[0];
ac2.variant = "acolyte"; wake(ac2); ac2.x = sM2.hero.x; ac2.y = sM2.hero.y;
sM2.horrors = [ac2];
const acHp0 = sM2.hero.hp;
eld.stepHorrors(sM2, 600);
ok(sM2.hero.hp === acHp0 && sM2.hits === 0, "an acolyte never claws the Watcher");

// 6d. Variants — darters are fast and frail, brutes slow, tough and heavy-hitting.
const sV = eld.buildArena(eld.levelById("kingsport"));
ok(sV.horrors.some((e) => e.variant === "darter"), "kingsport musters darters");
ok(sV.horrors.some((e) => e.variant === "brute"), "kingsport musters brutes");
const brute = sV.horrors.find((e) => e.variant === "brute");
ok(brute.maxHp > K.HORROR_HP * 2, `a brute stands with towering hp (${brute.maxHp})`);

// 7. Win on all-horrors-banished — clearedPct 1, phase "won", no further sim.
const s6 = eld.buildArena(eld.levelById(id));
for (let i = 1; i < s6.horrors.length; i++) eld.banish(s6, s6.horrors[i]);
s6.motes = [];
const last = s6.horrors[0];
last.hp = 1; last.x = 700; last.y = 700; wake(last);
s6.hero.x = 700; s6.hero.y = 700; s6.hero.charge = 1; s6.hero.signCd = 0;
run(s6, 1200, still);
ok(s6.horrors.every((e) => e.dead), "the last horror falls to the Sign");
ok(s6.phase === "won" && eld.clearedPct(s6) === 1, "banishing every horror seals the threshold (won)");
const banAtWin = s6.banished;
eld.stepWatch(s6, 100, still);
ok(s6.banished === banAtWin && s6.phase === "won", "a sealed watch does not keep simulating");

// 8. Lose two ways — SLAIN on HP-0, MAD on SANITY-0.
const s7 = eld.buildArena(eld.levelById(id));
stowAll(s7);
s7.solids = []; s7.walls = []; s7.wards = [];
s7.hero.sanity = 1e9; s7.hero.maxSanity = 1e9; // isolate the corporeal death from madness
const killer = s7.horrors[0];
killer.variant = "brute"; killer.x = s7.hero.x; killer.y = s7.hero.y; wake(killer); killer.hp = 1e9;
run(s7, 20000, still, 8);
ok(s7.phase === "lost" && s7.lossCause === "slain", "enough claws bring the Watcher down (lost — slain)");
// Madness: a hunting horror at the elbow bleeds a near-spent mind to nothing, ending
// the watch as MAD before its claws can slay (HP still to spare — a different death).
const s7b = eld.buildArena(eld.levelById(id));
stowAll(s7b);
s7b.solids = []; s7b.walls = []; s7b.wards = [];
s7b.hero.sanity = 1; s7b.hero.charge = 0;
const dreadH = s7b.horrors[0];
dreadH.x = s7b.hero.x; dreadH.y = s7b.hero.y; wake(dreadH); // glued & hunting → dread drains the mind
run(s7b, 600, still, 16);
ok(s7b.phase === "lost" && s7b.lossCause === "mad" && s7b.hero.hp > 0,
  "spent sanity unmakes the Watcher (lost — mad, with health to spare)");

// 9. Wards — the Sign seals a dark ward in reach (steadying the mind); a sealed
//    ward's aura restores sanity AND burns the host; a horror defiles a sealed ward.
const sW = eld.buildArena(eld.levelById(id));
stowAll(sW);
const ward = { x: 700, y: 700, kind: "ward", lit: false };
sW.wards = [ward]; sW.scenery = [ward]; sW.litCount = 0;
sW.hero.x = 700 + 20; sW.hero.y = 700; sW.hero.charge = 1; sW.hero.signCd = 0;
sW.hero.sanity = 50; sW.horrors = [];
eld.firePulse(sW);
ok(ward.lit && sW.litCount === 1, "a Sign pulse seals a dark ward in reach");
ok(sW.hero.sanity > 50 - K.SIGN_SANITY_COST, "sealing a ward steadies the mind (offsets the pulse's fray)");
// A sealed ward's aura restores sanity to a Watcher within it.
const sW2 = eld.buildArena(eld.levelById(id));
stowAll(sW2);
const ward2 = { x: 700, y: 700, kind: "ward", lit: true, litAt: 0 };
sW2.wards = [ward2];
sW2.hero.x = 700 + 30; sW2.hero.y = 700; sW2.hero.sanity = 40; sW2.horrors = [];
eld.stepWards(sW2, 1000);
ok(sW2.hero.sanity > 40, "a sealed ward's aura steadies the Watcher's mind");
// …and burns a horror caught in it.
const sW3 = eld.buildArena(eld.levelById(id));
stowAll(sW3);
const ward3 = { x: 700, y: 700, kind: "ward", lit: true, litAt: 0 };
sW3.wards = [ward3]; sW3.hero.x = 5; sW3.hero.y = 5;
const burned = mkH(700 + 30, 700);
sW3.horrors = [burned];
const burnHp0 = burned.hp;
eld.stepWards(sW3, 600);
ok(burned.hp < burnHp0, "a sealed ward burns a horror in its aura (ally emitter)");
// A horror brushing a sealed ward defiles it (dark + scar).
const sW4 = eld.buildArena(eld.levelById(id));
stowAll(sW4); sW4.solids = []; sW4.walls = [];
const ward4 = { x: 700, y: 700, kind: "ward", lit: true, litAt: 0 };
sW4.wards = [ward4]; sW4.scenery = [ward4]; sW4.litCount = 1; sW4.hero.x = 5; sW4.hero.y = 5;
const defiler = mkH(700 + 10, 700);
sW4.horrors = [defiler];
eld.stepHorrors(sW4, 16);
ok(!ward4.lit && sW4.litCount === 0 && sW4.defiledCount === 1, "a horror brushing a sealed ward defiles it");
ok(eld.nearScar(sW4, ward4.x, ward4.y), "a defiled ward scars the ground");
// A still-scarred ward resists resealing.
sW4.hero.x = 720; sW4.hero.y = 700; sW4.hero.charge = 1; sW4.hero.signCd = 0; sW4.horrors = [];
eld.firePulse(sW4);
ok(!ward4.lit && sW4.litCount === 0, "the scar bars resealing until it fades");

// 10. Clue-motes — a banished horror may drop one; gathering it steadies the mind.
const sC = eld.buildArena(eld.levelById(id));
sC.motes = [];
for (let i = 0; i < 80; i++) eld.banish(sC, { x: 200 + i, y: 200, dead: false, hp: 0, variant: "shambler" });
ok(sC.motes.length > 0, `banished horrors leave gatherable clue-motes (${sC.motes.length} of 80)`);
const sC2 = eld.buildArena(eld.levelById(id));
stowAll(sC2);
sC2.motes = [{ x: sC2.hero.x, y: sC2.hero.y, until: sC2.elapsed + K.MOTE_TTL_MS }];
sC2.hero.sanity = 50;
eld.stepMotes(sC2);
ok(sC2.motes.length === 0, "the Watcher gathers a clue-mote underfoot");
ok(sC2.hero.sanity === 50 + K.CLUE_SANITY, "a gathered clue-mote steadies the mind");

// 11. Overcharge — holding still PAST a full trace banks an overcharge; the next pulse
//     erupts (wider, repels the host, restores sanity), then resets. Moving spends it.
const sO = eld.buildArena(eld.levelById(id));
stowAll(sO); sO.solids = []; sO.walls = []; sO.wards = [];
sO.hero.x = 700; sO.hero.y = 700;
// A full trace already inscribed; signCd parked far out so the auto-pulse doesn't
// fire and spend the bank while it accrues (a real pulse empties the overcharge).
sO.hero.charge = 1; sO.hero.signCd = 1e9; sO.hero.overcharge = 0;
run(sO, K.SIGN_OVERCHARGE_MS + 120, still);
ok(sO.hero.charge >= 1 && sO.hero.overcharge >= 1, "holding still past a full trace banks an overcharge");
// An empowered pulse: a horror just outside the BASE reach is caught by the wider ring,
// repelled, and sanity is restored.
sO.hero.overcharge = 1; sO.hero.charge = 1; sO.hero.sanity = 50;
const justOut = mkH(700 + K.SIGN_RADIUS + 30, 700); // beyond base reach, within the empowered ring
sO.horrors = [justOut];
const oHp0 = justOut.hp, oX0 = justOut.x;
eld.firePulse(sO);
ok(justOut.hp < oHp0, "an empowered pulse's wider ring catches a horror beyond the base reach");
ok(justOut.x > oX0, "an empowered pulse repels the host");
ok(sO.hero.sanity > 50, "an empowered pulse steadies the mind (restores sanity)");
ok(sO.hero.overcharge === 0, "an empowered pulse spends the banked overcharge");
// Moving spends a banked overcharge back to nothing.
const sO2 = eld.buildArena(eld.levelById(id));
sO2.hero.charge = 1; sO2.hero.overcharge = 1;
eld.stepWatch(sO2, 16, { x: 1, y: 0 });
ok(sO2.hero.overcharge === 0, "moving spends the banked overcharge");

// 12. Terrain — walls + paths present; pushOut stops a body at a wall and a menhir;
//     a path speeds travel.
const sT = eld.buildArena(eld.levelById(id));
stowAll(sT);
ok(sT.walls.length > 0, `the place is strung with walls (${sT.walls.length})`);
ok(sT.paths.length > 0, `the place is laced with paths (${sT.paths.length})`);
ok(sT.solids.length > 0, `the place has solid menhirs (${sT.solids.length})`);
// A menhir blocks the Watcher.
sT.walls = []; sT.paths = [];
const menhir = sT.solids[0];
const mr = K.OBSTACLE_RADIUS[menhir.kind];
sT.hero.x = menhir.x - (K.HERO_RADIUS + mr + 30); sT.hero.y = menhir.y;
run(sT, 1000, { x: 1, y: 0 });
const dMenhir = Math.hypot(sT.hero.x - menhir.x, sT.hero.y - menhir.y);
ok(dMenhir >= K.HERO_RADIUS + mr - 1, `a menhir stops the Watcher (d=${dMenhir | 0} >= ${K.HERO_RADIUS + mr})`);
// A wall blocks the Watcher.
const sT2 = eld.buildArena(eld.levelById(id));
stowAll(sT2);
sT2.solids = []; sT2.paths = [];
const wall = sT2.walls[0];
const bmx = (wall.x1 + wall.x2) / 2, bmy = (wall.y1 + wall.y2) / 2;
const bdx = wall.x2 - wall.x1, bdy = wall.y2 - wall.y1, bl = Math.hypot(bdx, bdy) || 1;
const nx = -bdy / bl, ny = bdx / bl;
sT2.hero.x = bmx + nx * (K.HERO_RADIUS + K.WALL_HALF + 40);
sT2.hero.y = bmy + ny * (K.HERO_RADIUS + K.WALL_HALF + 40);
run(sT2, 1200, { x: -nx, y: -ny });
const wcd = eld.closestOnSegment(sT2.hero.x, sT2.hero.y, wall.x1, wall.y1, wall.x2, wall.y2).d;
ok(wcd >= K.HERO_RADIUS + K.WALL_HALF - 1, `a wall stops the Watcher (d=${wcd | 0})`);
// Path speeds travel.
const sp = eld.buildArena(eld.levelById(id));
stowAll(sp);
sp.solids = []; sp.walls = []; sp.paths = [];
sp.hero.x = 100; sp.hero.y = 100;
const baseX = sp.hero.x;
run(sp, 500, { x: 1, y: 0 });
const baseDist = sp.hero.x - baseX;
const sp2 = eld.buildArena(eld.levelById(id));
stowAll(sp2);
sp2.solids = []; sp2.walls = [];
sp2.paths = [{ x1: 80, y1: 100, x2: 900, y2: 100 }];
sp2.hero.x = 100; sp2.hero.y = 100;
const pathX = sp2.hero.x;
run(sp2, 500, { x: 1, y: 0 });
const pathDist = sp2.hero.x - pathX;
ok(pathDist > baseDist + 1, `the Watcher runs faster on a path (${baseDist | 0} -> ${pathDist | 0})`);

// 13. Legacy — seals and falls fold once into a private key; best time never worsens.
store.delete(LEGACY_KEY);
ok(eld.loadEldLegacy().runs === 0, "an untouched legacy starts empty");
const lv = eld.levelById(id);
const l1 = eld.recordSeal(lv, 5000, 4, 1);
ok(l1.runs === 1 && l1.seals === 1 && l1.best[id] === 5000, "recordSeal folds a seal");
ok(l1.wardsSealed === 4, "recordSeal folds wards sealed");
const l2 = eld.recordSeal(lv, 8000);
ok(l2.best[id] === 5000, "a slower seal cannot worsen the best");
const l3 = eld.recordSeal(lv, 3000);
ok(l3.best[id] === 3000, "a faster seal sets a new best");
const l4 = eld.recordFall(2, 3);
ok(l4.runs === 4 && l4.seals === 3, "a fall bumps watches but not seals");
ok(l4.banished === 3, "a fall folds the host banished");
const l5 = eld.recordSeal(lv, 9000, 0, 0, 5);
ok(l5.banished === 8, "a seal folds the host banished too (wins count)");
ok(eld.loadEldLegacy().best[id] === 3000, "the legacy persists to storage");
// Backward compatibility: an old save without the new fields defaults cleanly.
store.set(LEGACY_KEY, JSON.stringify({ runs: 2, seals: 1, best: {} }));
const oldL = eld.loadEldLegacy();
ok(oldL.runs === 2 && oldL.wardsSealed === 0 && oldL.banished === 0 && oldL.unlocked.includes("elder"),
  "an old save defaults the new fields");

// 14. Scoring — base/bonuses behave; a blow forfeits the untouched bonus; harder
//     places multiply more; lost sanity costs the sanity bonus.
const ssc = eld.buildArena(eld.levelById(id));
const sc0 = eld.scoreRun(ssc);
ok(sc0.base === ssc.total * K.SCORE_PER_BANISH, `base score = ${K.SCORE_PER_BANISH} per horror (${sc0.base})`);
ok(sc0.untouched > 0 && sc0.survival > 0 && sc0.sanity > 0, "an unscathed, sane seal earns the bonuses");
ssc.hits = 2;
ok(eld.scoreRun(ssc).untouched === 0, "a blow forfeits the untouched bonus");
ssc.hero.sanity = ssc.hero.maxSanity / 2;
ok(eld.scoreRun(ssc).sanity < sc0.sanity, "a frayed mind costs the sanity bonus");
ok(eld.difficultyMult(eld.levelById("rlyeh")) > eld.difficultyMult(eld.levelById("innsmouth")),
  "a harder place multiplies a seal's score more");

// 15. Signs — the unlockable Elder Sign variants, bought with lore.
ok(Array.isArray(eld.SIGN_TYPES) && eld.SIGN_TYPES.length >= 3, `signs are defined (${eld.SIGN_TYPES.length})`);
ok(new Set(eld.SIGN_TYPES.map((t) => t.id)).size === eld.SIGN_TYPES.length, "sign ids are unique");
const starter = eld.SIGN_TYPES[0];
ok(starter.cost === 0, "the starter Sign costs nothing (always owned)");
ok(eld.signTypeById("elder").id === "elder" && eld.signTypeById("nope").id === starter.id,
  "signTypeById resolves known ids, falls back to the starter");
// Economy: learn a Sign only when owned-less and affordable; equip only what's owned.
eld.saveEldLegacy(eld.emptyEldLegacy());
const yellow = eld.SIGN_TYPES.find((t) => t.id === "yellow");
let le = eld.unlockSign("yellow");
ok(!le.unlocked.includes("yellow"), "a Sign can't be learned with no lore");
le = eld.loadEldLegacy(); le.lore = 1000; eld.saveEldLegacy(le);
le = eld.unlockSign("yellow");
ok(le.unlocked.includes("yellow") && le.lore === 1000 - yellow.cost, "learning a Sign deducts its lore");
le = eld.equipSign("voor");
ok(le.equipped !== "voor", "an unowned Sign can't be equipped");
le = eld.equipSign("yellow");
ok(le.equipped === "yellow", "an owned Sign equips");
// The equipped Sign resolves onto the watch and shapes the banishing.
const sY = eld.buildArena(eld.levelById(id));
ok(sY.sign.id === "yellow", "the equipped Sign resolves onto the watch");
// Lore banks from watches: a seal banks score/LORE_SCORE_DIV, a fall banks per banish.
eld.saveEldLegacy(eld.emptyEldLegacy());
const ow = eld.recordSeal(eld.levelById(id), 1000, 0, 17);
ok(ow.lore === 17, "a seal banks its lore");
const fl = eld.recordFall(0, 4, 9);
ok(fl.lore === 17 + 9, "a fall banks its lore on top (17 + 9)");
ok(fl.banished === 4, "a fall folds the host banished");

// 15b. The Voorish Sign's CALM power — each banishing steadies the mind.
eld.saveEldLegacy(eld.emptyEldLegacy());
{
  let lc = eld.loadEldLegacy(); lc.unlocked.push("voor"); lc.equipped = "voor"; eld.saveEldLegacy(lc);
  const sv = eld.buildArena(eld.levelById(id));
  ok(sv.sign.power === "calm", "the Voorish Sign carries the calm power");
  sv.hero.sanity = 50;
  const target = mkH(5, 5);
  sv.horrors = [target];
  eld.banish(sv, target);
  ok(sv.hero.sanity === 50 + K.CALM_SANITY, "a Voorish banishing steadies the mind");
}
// 15c. The Yellow Sign's CHAIN power — a banishing arcs to the nearest horror.
{
  let lc = eld.loadEldLegacy(); lc.unlocked.push("yellow"); lc.equipped = "yellow"; eld.saveEldLegacy(lc);
  const sy = eld.buildArena(eld.levelById(id));
  ok(sy.sign.power === "chain", "the Yellow Sign carries the chain power");
  const dying = mkH(700, 700), neighbour = mkH(700 + K.CHAIN_RANGE - 20, 700);
  sy.horrors = [dying, neighbour];
  const nHp0 = neighbour.hp;
  eld.banish(sy, dying);
  ok(neighbour.hp < nHp0 || neighbour.dead, "a Yellow banishing arcs damage to the nearest horror");
}
eld.saveEldLegacy(eld.emptyEldLegacy());

// 16. Render smoke — render/scaffold don't throw with zero sprites, at the start and
//     after a spread of state changes.
const svgNode = makeNode();
let threw = false;
try {
  const camLayer = eld.scaffold(svgNode);
  const sr = eld.buildArena(eld.levelById(id));
  eld.render(sr, camLayer);
  // Mutate a spread of state, then render again.
  const someWard = sr.wards[0];
  if (someWard) { someWard.lit = true; someWard.litAt = 0; }
  const otherWard = sr.wards[1];
  if (otherWard) { otherWard.defiled = sr.elapsed + K.DEFILE_MS; }
  if (sr.horrors[0]) { sr.horrors[0].state = "hunt"; sr.horrors[0].hp = 5; sr.horrors[0].hit = sr.elapsed + 100; }
  if (sr.horrors[1]) { sr.horrors[1].variant = "gazer"; sr.horrors[1].gaze = true; }
  if (sr.horrors[2]) { sr.horrors[2].variant = "acolyte"; sr.horrors[2].mending = true; sr.horrors[2].mendX = 50; sr.horrors[2].mendY = 50; }
  if (sr.horrors[3]) sr.horrors[3].variant = "brute";
  sr.motes.push({ x: 400, y: 400, until: sr.elapsed + K.MOTE_TTL_MS });
  sr.pulses.push({ x: 500, y: 500, r: 80, until: sr.elapsed + 300 });
  sr.hero.charge = 1; sr.hero.overcharge = 1; sr.hero.hurt = 200; sr.hero.sanity = 10; // dread vignette
  eld.render(sr, camLayer);
  eld.scenerySprite(sr, someWard || sr.scenery[0]);
  eld.spriteFor(sr.level, "ground");
} catch (err) {
  threw = true;
  console.error(err);
}
ok(!threw, "render and scaffold run headlessly with zero sprites, at start and after state changes");

// Rival duels — seeded arenas, the token codec, the echo's pace, the verdict.
// Zero-backend: the same seed must raise the identical place on any device,
// and the URL token must round-trip a run and shrug off tampering.
{
  const fpr = (st) => JSON.stringify({
    n: st.scenery.map((n) => [n.kind, Math.round(n.x), Math.round(n.y)]),
    h: st.horrors.map((e) => [Math.round(e.x), Math.round(e.y), e.variant]),
    w: st.walls.map((g) => [Math.round(g.x1), Math.round(g.y1), Math.round(g.x2), Math.round(g.y2)]),
    p: st.pools.map((p) => [Math.round(p.x), Math.round(p.y), p.seed]),
  });
  const dA = eld.buildArena(eld.levelById("innsmouth"), 123456);
  const dB = eld.buildArena(eld.levelById("innsmouth"), 123456);
  const dC = eld.buildArena(eld.levelById("innsmouth"), 654321);
  ok(dA.seed === 123456 && dB.seed === 123456, "a seeded build keeps its seed on the state");
  ok(fpr(dA) === fpr(dB), "the same seed rebuilds the identical place (ruins, host, pools)");
  ok(fpr(dA) !== fpr(dC), "a different seed raises a different place");
  ok(Number.isInteger(eld.buildArena(eld.levelById("innsmouth")).seed),
    "an unseeded watch still draws a seed — any run can become a challenge");
  ok(fpr(eld.buildArena(eld.levelById("rlyeh"), 777)) === fpr(eld.buildArena(eld.levelById("rlyeh"), 777)),
    "the hardest place is seed-stable too (every horror kind through the seeded path)");

  const dK = eld.buildArena(eld.levelById("innsmouth"));
  dK.elapsed = 4321;
  eld.banish(dK, dK.horrors[0]);
  ok(dK.killTimes.length === 1 && dK.killTimes[0] === 4321, "each banishing is timestamped for the echo");

  const runRec = { name: "Carter", level: "innsmouth", seed: 123456, weapon: "elder",
    result: "won", ms: 84200, score: 1234, kills: [1000, 2500, 2500, 60000] };
  const tok = eld.encodeDuel(runRec);
  ok(/^[A-Za-z0-9_-]+$/.test(tok), "the duel token is URL-safe base64url");
  const back = eld.decodeDuel(tok);
  ok(back && back.name === "Carter" && back.level === "innsmouth" && back.seed === 123456
    && back.result === "won" && back.ms === 84200, "the token round-trips the run");
  ok(back.kills.length === 4 && back.kills.every((t, i) => Math.abs(t - runRec.kills[i]) <= 100),
    "kill times survive within a decisecond");
  ok(eld.decodeDuel("garbage!!") === null, "garbage tokens decode to null, never throw");
  ok(eld.decodeDuel(eld.encodeDuel({ ...runRec, level: "no-such-place" })) === null, "unknown places are rejected");
  const forged = Buffer.from(JSON.stringify({ v: 1, g: "werewolf", n: "x", l: "innsmouth", s: 1, w: "", r: 1, t: 1, sc: 0, k: [] }))
    .toString("base64url");
  ok(eld.decodeDuel(forged) === null, "a sibling game's token never opens here (GAME_TAG guard)");
  ok(eld.decodeDuel(eld.encodeDuel({ ...runRec, name: "<b onload=x>" })).name.includes("<") === false,
    "names are stripped of markup on decode");

  ok(eld.rivalKillsAt(back, 0) === 0 && eld.rivalKillsAt(back, 2600) === 3 && eld.rivalKillsAt(back, 999999) === 4,
    "rivalKillsAt paces the echo");
  const mkRun = (result, ms, nKills) => ({ name: "", level: "innsmouth", seed: 1, weapon: "",
    result, ms, score: 0, kills: Array.from({ length: nKills }, (_, i) => i * 100) });
  ok(eld.duelVerdict(mkRun("won", 50000, 18), mkRun("lost", 80000, 10)) === "win", "a seal beats a fall");
  ok(eld.duelVerdict(mkRun("won", 50000, 18), mkRun("won", 40000, 18)) === "loss", "two seals race the clock");
  ok(eld.duelVerdict(mkRun("lost", 30000, 12), mkRun("lost", 90000, 9)) === "win", "two falls compare banishings first");
  ok(eld.duelVerdict(mkRun("won", 50000, 18), mkRun("won", 50000, 18)) === "draw", "an exact tie stands unsettled");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
