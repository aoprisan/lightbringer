// sineater-proto-test.mjs — headless assertions for the Litany-line prototype
// (proto/litany-sim.mjs). Not part of `npm test` — the prototype is reference
// only. Run by hand: node tools/sineater-proto-test.mjs
import {
  freshState, step, aliveFoes, segCross, pointInPoly, polyArea, mulberry32,
} from "../proto/litany-sim.mjs";

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}`); }
}

// Drive the hero through waypoints at a fixed dt, collecting closure events.
function drive(s, wps, maxMs = 20000) {
  const closures = [];
  let i = 0;
  for (let t = 0; t < maxMs && i < wps.length; t += 16) {
    const wp = wps[i];
    const dx = wp.x - s.hero.x, dy = wp.y - s.hero.y, d = Math.hypot(dx, dy);
    if (d < 6) { i++; continue; }
    step(s, 16, { x: dx / d, y: dy / d });
    for (const e of s.events) if (e.kind === "closure") closures.push(e);
  }
  return closures;
}

console.log("A. geometry");
{
  const hit = segCross(0, 0, 10, 10, 0, 10, 10, 0);
  ok(hit && Math.abs(hit.x - 5) < 1e-9 && Math.abs(hit.y - 5) < 1e-9, "crossing diagonals meet at (5,5)");
  ok(segCross(0, 0, 10, 0, 0, 5, 10, 5) === null, "parallel segments never cross");
  ok(segCross(0, 0, 10, 0, 10, 0, 20, 10) === null, "an endpoint touch is not a crossing");
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  ok(Math.abs(polyArea(sq) - 10000) < 1e-9, "shoelace area of a 100-square");
  ok(pointInPoly(50, 50, sq) === true, "centre is inside the square");
  ok(pointInPoly(150, 50, sq) === false, "beyond the wall is outside");
}

console.log("B. the walk lays the line, and the line decays");
{
  const s = freshState({ prey: 0, gluttons: 0, seed: 3 });
  drive(s, [{ x: s.hero.x + 200, y: s.hero.y }]);
  const laid = s.strands.reduce((n, st) => n + st.length, 0);
  ok(s.strands.length === 1 && laid > 15, `a straight walk lays one strand (${laid} points)`);
  ok(s.salt < s.tune.saltMax, "laying the line spends salt");
  for (let t = 0; t < s.tune.lineTtl + 1500; t += 16) step(s, 16, { x: 0, y: 0 });
  ok(s.strands.length === 0, "standing still, every point gutters out past lineTtl");
  ok(s.penDown === false, "the pen lifts when its strand has burned away");
}

console.log("C. closure judges what is inside — and only what is inside");
{
  const s = freshState({ prey: 0, gluttons: 0, seed: 3, tune: { preySpeed: 0 } });
  s.foes.push({ x: 400, y: 400, kind: "craven", dir: 0, chewAt: 0, dead: false, deadAt: 0 });
  s.foes.push({ x: 100, y: 100, kind: "craven", dir: 0, chewAt: 0, dead: false, deadAt: 0 });
  s.total = 2;
  s.hero.x = 300; s.hero.y = 300;
  const saltBefore = () => s.salt;
  const closures = drive(s, [
    { x: 500, y: 300 }, { x: 500, y: 500 }, { x: 310, y: 500 }, { x: 310, y: 280 },
  ]);
  ok(closures.length === 1, "the overshooting circuit closes exactly once");
  const c = closures[0];
  ok(c && !c.fizzled, "a full-street circuit does not fizzle");
  ok(c && Math.abs(c.area - 38000) < 6000, `the judged polygon is street-sized (${c && Math.round(c.area)} px²)`);
  ok(c && c.judged === 1, "one soul stood inside the circle");
  ok(s.foes[0].dead === true, "the soul inside is shriven");
  ok(s.foes[1].dead === false, "the soul outside is untouched");
  ok(s.judged === 1 && aliveFoes(s) === 1, "the tallies agree");
  ok(c.saltGained === s.tune.saltPerSoul, "judgment refunds salt per soul");
  void saltBefore;
}

console.log("D. the two anti-stutter-loop knobs");
{
  const s = freshState({ prey: 0, gluttons: 0, seed: 3 });
  s.hero.x = 300; s.hero.y = 300;
  // A contemptibly small circle: 30px across, overshot so it truly crosses itself.
  const closures = drive(s, [
    { x: 340, y: 300 }, { x: 340, y: 340 }, { x: 305, y: 340 }, { x: 305, y: 290 },
  ]);
  ok(closures.length === 1 && closures[0].fizzled, "a tiny loop closes but FIZZLES (minLoopArea)");
  ok(closures[0].judged === 0 && closures[0].saltGained === 0, "a fizzle judges nothing and pays nothing");

  const t = freshState({ prey: 0, gluttons: 0, seed: 3, tune: { saltMax: 10, saltPerPx: 0.5, saltSeep: 0 } });
  drive(t, [{ x: t.hero.x + 400, y: t.hero.y }]);
  const laidPx = t.strands.reduce((n, st) => n + st.length, 0) * t.tune.stepDist;
  ok(laidPx < 60, `an empty censer lays no line (≈${Math.round(laidPx)}px laid of 400 walked)`);
  ok(t.salt === 0 && t.penDown === false, "dry salt lifts the pen");
}

console.log("E. the anti-fountain seep");
{
  const s = freshState({ prey: 0, gluttons: 0, seed: 3, tune: { saltMax: 100 } });
  s.salt = 0; s.penDown = false;
  for (let t = 0; t < 60000; t += 16) step(s, 16, { x: 0, y: 0 });
  ok(Math.abs(s.salt - s.tune.saltSeepTo) < 0.5, `idle salt seeps only to the floor (${s.salt.toFixed(1)} / ${s.tune.saltSeepTo})`);
}

console.log("F. the host and the line — balk and chew");
{
  // A craven walking straight at a fresh line balks away from it.
  const s = freshState({ prey: 0, gluttons: 0, seed: 3, tune: { preySpeed: 60 } });
  s.hero.x = 200; s.hero.y = 300;
  drive(s, [{ x: 600, y: 300 }]);
  const f = { x: 400, y: 328, kind: "craven", dir: -Math.PI / 2, chewAt: 0, dead: false, deadAt: 0 };
  s.foes.push(f); s.total = 1;
  for (let t = 0; t < 900; t += 16) step(s, 16, { x: 0, y: 0 });
  ok(f.y > 328, `fresh line wards: the craven is pushed off it (y ${f.y.toFixed(0)} > 328)`);

  // A glutton dropped on the line bites points out of it, severing the strand.
  const g = freshState({ prey: 0, gluttons: 0, seed: 3 });
  g.hero.x = 200; g.hero.y = 300;
  drive(g, [{ x: 600, y: 300 }]);
  const before = g.strands.reduce((n, st) => n + st.length, 0);
  g.foes.push({ x: 400, y: 300, kind: "glutton", dir: 0, chewAt: 0, dead: false, deadAt: 0 });
  g.total = 1;
  let chewed = false;
  for (let t = 0; t < 300; t += 16) { step(g, 16, { x: 0, y: 0 }); if (g.events.some((e) => e.kind === "chew")) chewed = true; }
  const after = g.strands.reduce((n, st) => n + st.length, 0);
  ok(chewed, "the glutton bites the line");
  ok(after < before, `points are eaten (${before} -> ${after})`);
  ok(g.strands.length >= 2, `a mid-line bite severs the strand (${g.strands.length} strands)`);
}

console.log("G. determinism (the duel-seam prerequisite)");
{
  const snap = (s) => JSON.stringify({ h: s.hero, f: s.foes.map((f) => [f.x, f.y, f.dir, f.dead]) });
  const a = freshState({ seed: 77 }), b = freshState({ seed: 77 });
  for (let i = 0; i < 200; i++) {
    const mv = { x: Math.sin(i / 9), y: Math.cos(i / 13) };
    step(a, 16, mv); step(b, 16, mv);
  }
  ok(snap(a) === snap(b), "same seed + same inputs -> identical worlds");
  ok(mulberry32(1)() !== mulberry32(2)(), "different seeds diverge");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
