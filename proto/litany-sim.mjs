// litany-sim.mjs — pure simulation for the Litany-line PROTOTYPE (reference only, not shipped).
//
// Prototypes §3 of SIN_EATER_CONCEPT.md: walking lays a decaying salt line (the Litany);
// crossing your own line closes the circuit and JUDGES everything unshriven inside.
// Also carries the two knobs §12 called out against degenerate stutter-loops (minLoopArea,
// salt cost per meter) and the two line-interactions that matter most: prey BALK at fresh
// line (the ward) and gluttons CHEW it (the anti-circuit pressure).
//
// House discipline held even in the prototype: this module never touches the DOM. The shell
// (sineater-proto.html) renders; tools/sineater-proto-test.mjs drives it headlessly.
// Plain JS ESM on purpose — not wired into tsconfig, sw.js, or the hub.

export const TUNE = {
  heroSpeed: 150, // px/s
  stepDist: 9, // px walked between laid points
  lineTtl: 7000, // ms a laid point burns before guttering out
  wardFresh: 0.45, // fraction of lineTtl a segment still wards prey
  minLoopArea: 1200, // px^2 under which a closure fizzles (anti stutter-loop)
  saltMax: 100,
  saltPerPx: 0.03, // salt spent per px of line laid
  saltPerSoul: 14, // salt refunded per judged soul
  saltSeep: 3, // salt/s — trickles ONLY below saltSeepTo (the family anti-fountain)
  saltSeepTo: 30,
  preySpeed: 46,
  balkDist: 30, // prey balk this close to a fresh segment
  gluttonSpeed: 34,
  chewR: 15, // a glutton bite erases laid points within this radius
  chewCdMs: 500,
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -- geometry ---------------------------------------------------------------

// Proper crossing of segments AB and CD (endpoint touches excluded).
// Returns { x, y, u } with u the parameter along AB, or null.
export function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const v = ((cx - ax) * ry - (cy - ay) * rx) / den;
  const e = 1e-6;
  if (u <= e || u >= 1 - e || v <= e || v >= 1 - e) return null;
  return { x: ax + u * rx, y: ay + u * ry, u };
}

export function closestOnSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return { x: ax + t * dx, y: ay + t * dy };
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a) / 2;
}

// Even-odd ray cast.
export function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// -- state ------------------------------------------------------------------

function spawnFoe(s, kind) {
  const m = 40;
  return {
    x: m + s.rnd() * (s.w - 2 * m),
    y: m + s.rnd() * (s.h - 2 * m),
    kind, // "craven" | "glutton"
    dir: s.rnd() * Math.PI * 2,
    chewAt: 0,
    dead: false,
    deadAt: 0,
  };
}

export function freshState(opts = {}) {
  const w = opts.w ?? 900, h = opts.h ?? 600;
  const s = {
    w, h,
    elapsed: 0,
    rnd: mulberry32(opts.seed ?? 1),
    tune: { ...TUNE, ...(opts.tune || {}) },
    hero: { x: w / 2, y: h / 2 },
    penDown: false,
    // The Litany: strands of timed points, oldest first. Gluttons and empty salt can
    // split/sever it, so it is a LIST of polylines; only the current strand can close a
    // circuit (crossing an older severed strand is a §12 open question, not prototyped).
    strands: [],
    foes: [],
    salt: (opts.tune?.saltMax ?? TUNE.saltMax),
    judged: 0,
    total: 0,
    lastClosure: null, // { area, judged, fizzled } for the HUD
    events: [], // cleared each step; the shell reads these for fx/toasts
  };
  const prey = opts.prey ?? 14, gluttons = opts.gluttons ?? 2;
  for (let i = 0; i < prey; i++) s.foes.push(spawnFoe(s, "craven"));
  for (let i = 0; i < gluttons; i++) s.foes.push(spawnFoe(s, "glutton"));
  s.total = s.foes.length;
  return s;
}

// -- the litany -------------------------------------------------------------

function findClosure(s, cur, lx, ly, hx, hy) {
  // Test the would-be segment (last laid point -> hero) against the current strand,
  // excluding the two most recent segments (they share the endpoint).
  let best = null;
  for (let j = 0; j < cur.length - 3; j++) {
    const a = cur[j], b = cur[j + 1];
    const hit = segCross(lx, ly, hx, hy, a.x, a.y, b.x, b.y);
    if (hit && (!best || hit.u < best.u)) best = { j, x: hit.x, y: hit.y, u: hit.u };
  }
  return best;
}

function closeLoop(s, cur, hit) {
  const t = s.tune;
  // The circuit: X -> the points laid after it -> back to X via the closing segment.
  const poly = [{ x: hit.x, y: hit.y }, ...cur.slice(hit.j + 1)];
  const area = polyArea(poly);
  const fizzled = area < t.minLoopArea;
  let judged = 0;
  if (!fizzled) {
    for (const f of s.foes) {
      if (!f.dead && pointInPoly(f.x, f.y, poly)) {
        f.dead = true;
        f.deadAt = s.elapsed;
        judged++;
      }
    }
    s.judged += judged;
    s.salt = Math.min(t.saltMax, s.salt + judged * t.saltPerSoul);
  }
  // The looped stretch of line is spent by the closure, judged or fizzled.
  cur.length = hit.j + 1;
  cur.push({ x: hit.x, y: hit.y, t: s.elapsed });
  cur.push({ x: s.hero.x, y: s.hero.y, t: s.elapsed });
  s.lastClosure = { area, judged, fizzled };
  s.events.push({ kind: "closure", poly, area, judged, fizzled, saltGained: fizzled ? 0 : judged * t.saltPerSoul });
}

function stepLitany(s, moving) {
  const t = s.tune;
  if (s.salt <= 0) { s.penDown = false; return; }
  if (!s.penDown) {
    if (!moving) return; // the pen starts on the first step, never at a standstill
    s.strands.push([{ x: s.hero.x, y: s.hero.y, t: s.elapsed }]);
    s.penDown = true;
    return;
  }
  const cur = s.strands[s.strands.length - 1];
  if (!cur || !cur.length) { s.penDown = false; return; }
  const last = cur[cur.length - 1];
  const d = Math.hypot(s.hero.x - last.x, s.hero.y - last.y);
  // Closure is tested EVERY frame against the live segment (last laid point -> hero),
  // so a circuit closes the instant the walker crosses it — never a stepDist late.
  const hit = cur.length >= 4 ? findClosure(s, cur, last.x, last.y, s.hero.x, s.hero.y) : null;
  if (hit) {
    s.salt = Math.max(0, s.salt - d * t.saltPerPx);
    closeLoop(s, cur, hit);
  } else if (d >= t.stepDist) {
    s.salt = Math.max(0, s.salt - d * t.saltPerPx);
    cur.push({ x: s.hero.x, y: s.hero.y, t: s.elapsed });
  }
  if (s.salt <= 0) s.penDown = false;
}

function stepDecay(s) {
  const ttl = s.tune.lineTtl;
  const kept = [];
  for (let i = 0; i < s.strands.length; i++) {
    const st = s.strands[i];
    let cut = 0;
    while (cut < st.length && s.elapsed - st[cut].t > ttl) cut++;
    const rest = cut ? st.slice(cut) : st;
    const isCurrent = s.penDown && i === s.strands.length - 1;
    if (rest.length >= 2 || (isCurrent && rest.length >= 1)) kept.push(rest);
    else if (isCurrent) s.penDown = false;
  }
  s.strands = kept;
  if (s.penDown && !s.strands.length) s.penDown = false;
}

// -- the host ---------------------------------------------------------------

function nearestFreshSegment(s, px, py) {
  const freshMs = s.tune.lineTtl * s.tune.wardFresh;
  let best = null;
  for (const st of s.strands) {
    for (let i = 0; i + 1 < st.length; i++) {
      if (s.elapsed - st[i + 1].t > freshMs) continue;
      const c = closestOnSegment(px, py, st[i].x, st[i].y, st[i + 1].x, st[i + 1].y);
      const d = Math.hypot(px - c.x, py - c.y);
      if (!best || d < best.d) best = { d, x: c.x, y: c.y };
    }
  }
  return best;
}

function nearestLaidPoint(s, px, py) {
  let best = null;
  for (const st of s.strands) {
    for (const p of st) {
      const d = Math.hypot(px - p.x, py - p.y);
      if (!best || d < best.d) best = { d, x: p.x, y: p.y };
    }
  }
  return best;
}

function chew(s, gx, gy) {
  const r = s.tune.chewR;
  const out = [];
  let removed = 0;
  const curIdx = s.penDown ? s.strands.length - 1 : -1;
  for (let i = 0; i < s.strands.length; i++) {
    let run = [];
    for (const p of s.strands[i]) {
      if ((p.x - gx) ** 2 + (p.y - gy) ** 2 <= r * r) {
        removed++;
        if (run.length >= 2) out.push(run);
        run = [];
      } else run.push(p);
    }
    if (run.length >= 2 || (i === curIdx && run.length >= 1)) out.push(run);
  }
  s.strands = out;
  if (removed) s.events.push({ kind: "chew", x: gx, y: gy, removed });
  // If the bite severed the strand under the hero's pen, restart cleanly next step.
  if (s.penDown) {
    const cur = s.strands[s.strands.length - 1];
    const near = cur && cur.length &&
      Math.hypot(s.hero.x - cur[cur.length - 1].x, s.hero.y - cur[cur.length - 1].y) < s.tune.stepDist * 2;
    if (!near) s.penDown = false;
  }
}

function stepFoes(s, dt) {
  const t = s.tune;
  const sec = dt / 1000;
  const m = 20;
  for (const f of s.foes) {
    if (f.dead) continue;
    if (f.kind === "craven") {
      f.dir += (s.rnd() - 0.5) * 2.4 * sec;
      const ward = nearestFreshSegment(s, f.x, f.y);
      if (ward && ward.d < t.balkDist) {
        // The line is a wall to the small-sinned: turn square away from it.
        f.dir = Math.atan2(f.y - ward.y, f.x - ward.x);
      }
      f.x += Math.cos(f.dir) * t.preySpeed * sec;
      f.y += Math.sin(f.dir) * t.preySpeed * sec;
    } else {
      // Glutton: seek the line itself and eat it.
      const bite = nearestLaidPoint(s, f.x, f.y);
      if (bite) {
        f.dir = Math.atan2(bite.y - f.y, bite.x - f.x);
        f.x += Math.cos(f.dir) * t.gluttonSpeed * sec;
        f.y += Math.sin(f.dir) * t.gluttonSpeed * sec;
        if (bite.d <= t.chewR && s.elapsed >= f.chewAt) {
          chew(s, f.x, f.y);
          f.chewAt = s.elapsed + t.chewCdMs;
        }
      } else {
        f.dir += (s.rnd() - 0.5) * 2.0 * sec;
        f.x += Math.cos(f.dir) * t.gluttonSpeed * 0.6 * sec;
        f.y += Math.sin(f.dir) * t.gluttonSpeed * 0.6 * sec;
      }
    }
    if (f.x < m || f.x > s.w - m) { f.dir = Math.PI - f.dir; f.x = Math.max(m, Math.min(s.w - m, f.x)); }
    if (f.y < m || f.y > s.h - m) { f.dir = -f.dir; f.y = Math.max(m, Math.min(s.h - m, f.y)); }
  }
}

// -- the frame --------------------------------------------------------------

export function step(s, dt, move) {
  s.events.length = 0;
  s.elapsed += dt;
  const t = s.tune;
  const sec = dt / 1000;

  const mag = Math.min(1, Math.hypot(move.x, move.y));
  if (mag > 0.01) {
    const nx = move.x / (mag || 1), ny = move.y / (mag || 1);
    s.hero.x += nx * mag * t.heroSpeed * sec;
    s.hero.y += ny * mag * t.heroSpeed * sec;
    const mm = 14;
    s.hero.x = Math.max(mm, Math.min(s.w - mm, s.hero.x));
    s.hero.y = Math.max(mm, Math.min(s.h - mm, s.hero.y));
  }

  stepLitany(s, mag > 0.01);
  stepDecay(s);
  stepFoes(s, dt);

  // The anti-fountain seep: only ever trickles back up to the floor.
  if (s.salt < t.saltSeepTo) s.salt = Math.min(t.saltSeepTo, s.salt + t.saltSeep * sec);
  return s;
}

export function aliveFoes(s) {
  return s.foes.filter((f) => !f.dead).length;
}
