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
let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error("FAIL:", msg); } else console.log("ok  -", msg); };

const still = { x: 0, y: 0 };
// Run the sim for `ms` total in fixed slices, with a given input vector.
function run(s, ms, move = still, slice = 16) {
  for (let t = 0; t < ms; t += slice) pg.stepCombat(s, slice, move);
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
ok(s.hero.x === K.W / 2 && s.hero.y === K.H / 2, "hero starts at the city's heart");
ok(s.hero.hp === K.HERO_HP && s.phase === "fight", "hero begins at full health, fighting");
ok(pg.aliveShades(s) === s.total && pg.clearedPct(s) === 0, "all shades alive, nothing cleared yet");

// 3. The pentagram inscribes while still and burns a shade in its ring to death.
const s2 = pg.buildArena(pg.levelById("old-city"));
// Isolate one shade right beside the hero; park the rest far away and asleep.
const victim = s2.shades[0];
victim.x = s2.hero.x + 40; victim.y = s2.hero.y; victim.wakeAt = 0; victim.hp = K.SHADE_HP;
for (let i = 1; i < s2.shades.length; i++) {
  s2.shades[i].x = 5; s2.shades[i].y = 5; s2.shades[i].wakeAt = 1e9; // never wakes, far off
}
run(s2, K.PENTA_CHARGE_MS + 30, still); // inscribe fully
ok(s2.penta.charge > 0.9, `standing still inscribes the sigil (charge=${s2.penta.charge.toFixed(2)})`);
run(s2, K.PENTA_PULSE_MS * 4, still);   // let it pulse
ok(victim.dead, "the pentagram burns a shade in its ring to death");
ok(s2.kills === 1, "a kill is counted");

// 4. A shade outside the ring is untouched by the pulses.
const s3 = pg.buildArena(pg.levelById("old-city"));
const far = s3.shades[0];
far.x = s3.hero.x + K.PENTA_RADIUS + 60; far.y = s3.hero.y; far.wakeAt = 1e9; // out of range, asleep
const hpBefore = far.hp;
for (let i = 1; i < s3.shades.length; i++) s3.shades[i].wakeAt = 1e9;
run(s3, K.PENTA_PULSE_MS * 4, still);
ok(far.hp === hpBefore, "a shade beyond the ring takes no damage");

// 5. Moving decays the sigil.
const s4 = pg.buildArena(pg.levelById("old-city"));
for (const e of s4.shades) e.wakeAt = 1e9;
run(s4, K.PENTA_CHARGE_MS + 30, still);
const charged = s4.penta.charge;
run(s4, K.PENTA_CHARGE_MS, { x: 1, y: 0 }); // walk
ok(s4.penta.charge < charged, `moving lets the sigil fade (${charged.toFixed(2)} -> ${s4.penta.charge.toFixed(2)})`);

// 6. Clearing every shade wins the descent.
const s5 = pg.buildArena(pg.levelById("old-city"));
for (const e of s5.shades) { e.x = s5.hero.x; e.y = s5.hero.y; e.wakeAt = 0; e.hp = K.SHADE_HP; }
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
biter.x = s6.hero.x; biter.y = s6.hero.y; biter.wakeAt = 0; biter.hp = 1e9; // unkillable, for the test
for (let i = 1; i < s6.shades.length; i++) s6.shades[i].wakeAt = 1e9;
pg.stepCombat(s6, 16, still);
const hp1 = s6.hero.hp;
ok(hp1 < K.HERO_HP, `a shade in contact bites the hero (${K.HERO_HP} -> ${hp1})`);
ok(s6.hero.hurt > 0, "a blow sets i-frames");
// i-frames spare an immediate second blow.
biter.x = s6.hero.x; biter.y = s6.hero.y; // re-glue after knockback
pg.stepCombat(s6, 16, still);
ok(s6.hero.hp === hp1, "i-frames spare the hero an immediate second blow");
// Hammer it long enough and the hero falls.
biter.x = s6.hero.x; biter.y = s6.hero.y;
run(s6, K.HERO_IFRAMES_MS * (K.HERO_HP / K.SHADE_CONTACT_DMG + 4), still, 8);
ok(s6.phase === "lost", "enough blows bring the hero down");

// 8. Shades chase the hero (a woken shade closes the distance).
const s7 = pg.buildArena(pg.levelById("old-city"));
for (const e of s7.shades) e.wakeAt = 1e9;
const chaser = s7.shades[0];
chaser.wakeAt = 0;
chaser.x = s7.hero.x + 400; chaser.y = s7.hero.y;
const d0 = Math.hypot(chaser.x - s7.hero.x, chaser.y - s7.hero.y);
run(s7, 500, still); // hero stands; chaser should close in
const d1 = Math.hypot(chaser.x - s7.hero.x, chaser.y - s7.hero.y);
ok(d1 < d0, `a woken shade closes on the hero (${d0 | 0} -> ${d1 | 0})`);

// 9. Legacy: clears and deaths fold into a private key, best time never worsens.
store.delete("pentagram.legacy.v1");
ok(pg.loadPgLegacy().runs === 0, "an untouched legacy starts empty");
const lv = pg.levelById("old-city");
const l1 = pg.recordClear(lv, 5000);
ok(l1.runs === 1 && l1.clears === 1 && l1.best["old-city"] === 5000, "recordClear folds a cleansing");
const l2 = pg.recordClear(lv, 8000);
ok(l2.best["old-city"] === 5000, "a slower clear cannot worsen the best");
const l3 = pg.recordClear(lv, 3000);
ok(l3.best["old-city"] === 3000, "a faster clear sets a new best");
const l4 = pg.recordDeath();
ok(l4.runs === 4 && l4.clears === 3, "a death bumps runs but not clears");
ok(pg.loadPgLegacy().best["old-city"] === 3000, "the legacy persists to storage");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
