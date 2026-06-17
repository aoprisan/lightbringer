# Movement animation for The Necromancer's March

Research note + art plan for making the necromancer, the skeleton horde, and the
knights *walk* instead of slide. Scoped to `necro.ts` / `necro.html` (the third
sibling spinoff). Companion to `NECROMANCER_PLAN.md`.

## Where we are today

Every moving figure is drawn as **one static PNG per frame**. The renderer
rebuilds the whole SVG each RAF tick and places each entity with a single call:

```ts
spriteImage(key, x, y, size, opacity)   // necro.ts:1186
```

- The necromancer (`necro.ts:1601`), the knights (`necro.ts:1470-1527`), and the
  minions (`necro.ts:1529-1569`) each resolve to **one** sprite key and stamp it
  at `(x,y)`. There is no facing, no walk cycle.
- The only motion the eye reads is **position changing** between frames plus a
  few procedural flourishes: the hit-flash scale (`flash * 0.18`), the per-rite
  aura ring, the pentagram pulse. So at rest the figures look fine, but in
  motion they **glide** — feet planted, body frozen, sliding across the ground.

The good news: the data we need is already on every entity. Each has a live
**velocity** updated every frame:

| entity | velocity written at | speed (u/s) |
| --- | --- | --- |
| necromancer (`Hero`) | `necro.ts:1071` (`h.vx`, `h.vy`) | `HERO_SPEED = 248` |
| minions (`Minion`) | `necro.ts:798` (`m.vx`, `m.vy`) | `MINION_SPEED = 150` |
| knights (`Knight`) | `necro.ts:917` (`e.vx`, `e.vy`) | `KNIGHT_SPEED = 120` |

So the render pass can read `(vx, vy)` to decide **which way a figure faces** and
**whether it is striding**, with zero new sim state and no break to the
pure-sim / read-only-render split.

## Constraints that shape the choice

1. **Whole-SVG-rebuild renderer.** There is no persistent sprite node to mutate
   over time — each frame is built from scratch. So "animation" means *picking
   what to draw this frame* from `(x, y, vx, vy, elapsed)`, not tweening a
   retained node. CSS/SMIL keyframes don't survive the rebuild; everything is
   recomputed per frame. (This is the same reason hit-flash is recomputed from
   `s.elapsed` each frame rather than animated.)
2. **Sprites are optional and fallback-safe.** The loader probes `art/<name>.png`
   and only marks a sprite present on a successful `img.onload`
   (`loadSprites`, `necro.ts:1159`); the render falls back to procedural vector
   when a key is absent. Any animation art must keep this property: **absent
   frames must degrade to today's static look, never error.**
3. **Tiny figures, many at once.** The horde is drawn small (`skeleton` size 30,
   `MINION_RADIUS = 13`); knights 44–58px; necromancer 46px. Sub-pixel leg
   detail is wasted — the animation must read as *gait silhouette* (lean, bob,
   stride extremes), not finger-level detail.
4. **Top-down ~60° three-quarter view.** Every sprite is authored at this angle.
   Omnidirectional movement is best served by **left/right horizontal flip**
   (not 8-directional sheets) — the established trick for 3/4-view mobile games,
   and one transform attribute here.
5. **Generation budget is the real cost.** Code is cheap; Gemini frames are the
   expense. Prefer a scheme that reuses the *already-shipped* base sprite and
   adds the fewest new images.

## The three approaches

### A. Procedural locomotion — free, no art
Read `(vx, vy, elapsed)` in the render pass and apply SVG transforms to the
existing single sprite: a vertical **bob** (`sin(elapsed·cadence)`), a small
**lean** into the heading, a step **squash/stretch**, and a **horizontal flip**
for facing. Costs nothing to generate and ships immediately.
*Limit:* the figure is one rigid image — no actual leg/arm motion. At this size
the bob+lean+flip alone already kills the "ice-skating" feel, so this is the
**floor we should ship regardless**.

### B. Frame-swap walk cycle — the art (recommended on top of A)
Author a couple of **stride frames** per mover and swap which key gets drawn,
keyed off `elapsed` and gated on speed. Real leg/arm motion. Costs a few PNGs.
Because the renderer already picks a *key string* per entity, this is the
**lowest-friction** animation the architecture supports — no sheet math, no clip
paths, just "which key this frame."

### C. Sprite-sheet (one PNG, N sub-frames) — rejected
A single strip and an SVG `clipPath` + per-frame translate. Saves a few HTTP
requests but adds clip/viewport math, fights the `spriteFade` radial mask
(which assumes a centered subject filling the tile), and Gemini is unreliable at
emitting an evenly-registered N-up strip. Not worth it here.

## Recommendation: **A + B**, with the base sprite as the shared mid-frame

Ship the procedural polish (A) for everything, and layer a **3-frame walk** on
the core movers using the cheapest possible art:

- **Frame 0 = the existing base sprite** (`necromancer.png`, `skeleton.png`,
  `knight-guard.png`, `knight-engage.png`) — the neutral *passing* pose. Already
  shipped, already cached.
- **`<name>-stepA.png`** — one contact extreme (e.g. left foot forward).
- **`<name>-stepB.png`** — the other contact extreme (right foot forward).

Walk order while moving: **stepA → base → stepB → base → …** — a natural
4-count gait from only **2 new images** (base reused as both passing frames).
Idle (speed below a threshold) just draws the base, i.e. today's behavior. If a
step frame is missing, draw the base — so it is **fully drop-in and fallback
safe**, exactly like every other necro sprite.

Authoring each step frame as a **Gemini image-edit of the base sprite** (not a
fresh generation) keeps the silhouette, scale, palette, and registration
identical between frames — the same continuity trick `09a` uses for the four
dwelling states. Identical registration is what stops the swap from jittering
under the centered `spriteFade` mask.

### Facing
Author each frame facing **screen-right**. In render, when `vx < 0`, wrap the
`<image>` in `transform="translate(2x,0) scale(-1,1)"` (flip about the sprite's
own center). The necromancer's robe and the knight's tabard are near-symmetric,
so the flip reads cleanly at size.

## Code integration (actionable; not yet applied)

Small, localized, and reversible — all in the render pass + the name list.

1. **A walk-frame helper** (render section of `necro.ts`):
   ```ts
   // Pick the walk frame for a mover. base = the neutral sprite key;
   // returns base + "-stepA"/"-stepB" while moving, base at rest. Absent
   // frame keys fall through to base (caller already null-checks the key).
   function walkKey(base: string, vx: number, vy: number, elapsed: number, phase: number): string {
     const sp = Math.hypot(vx, vy);
     if (sp < WALK_MIN_SPEED) return base;            // idle → neutral
     // 4-count: A, base, B, base — period shortens a little with speed.
     const period = WALK_STRIDE_MS * (1 - 0.3 * Math.min(1, sp / HERO_SPEED));
     const beat = Math.floor((elapsed + phase) / period) % 4;
     if (beat === 0 && sprites.has(base + "-stepA")) return base + "-stepA";
     if (beat === 2 && sprites.has(base + "-stepB")) return base + "-stepB";
     return base;
   }
   ```
   `phase` desyncs the horde (e.g. `m.bornAt` for minions, `e.homeX` for knights)
   so they don't march in lockstep. New tuning constants `WALK_MIN_SPEED` and
   `WALK_STRIDE_MS` go in the Tuning section (the design surface).

2. **Facing flip** — when stamping a mover, if `vx < 0` add the mirror transform
   to the `spriteImage` `<image>` (a `transform` attr, computed from `x` and
   `size`). Optionally apply the free procedural **bob/lean** here too (approach
   A) for figures with no step frames yet.

3. **Call sites** — swap the static key for `walkKey(...)`:
   - necromancer: `necro.ts:1601-1602` (`"necromancer"`, phase 0).
   - minions: `necro.ts:1547-1548` (currently `skKey`; phase `m.bornAt`).
   - knights: `necro.ts:1476-1478` (the chosen `useKey`; phase from home pos).

4. **Loader** — add the step-frame names to `SPRITE_NAMES` (`necro.ts:1133`) so
   `loadSprites` probes them. They are **not** city-reskinnable (leave
   `CITY_SPRITES` alone). Per-variant skeletons (`skeleton-brute/-wight/
   -revenant`) and the `priest` keep falling back to the base `skeleton` /
   knight frames — so they animate for free once the base frames exist, and can
   get bespoke frames later.

5. **Service worker** — frames are **optional art**, so do **not** add them to
   `sw.js` `ASSETS` until they actually exist (a 404 in `cache.addAll` fails the
   whole offline install — same rule as the city sprites and the not-yet-drawn
   necro PNGs). When the PNGs land, add them to `ASSETS` **and bump `CACHE`** in
   the same commit.

## The art to generate (Gemini "Nano Banana" scripts)

Three new prompt files under `gemini-prompts/necro/`, each an **image-edit of the
existing base sprite** so the frames stay registered. 8 frames total.

| script | base (frame 0, exists) | new frames |
| --- | --- | --- |
| `anim-necromancer-walk.txt` | `necromancer.png` | `necromancer-stepA.png`, `necromancer-stepB.png` |
| `anim-skeleton-walk.txt` | `skeleton.png` | `skeleton-stepA.png`, `skeleton-stepB.png` |
| `anim-knight-walk.txt` | `knight-guard.png`, `knight-engage.png` | `knight-guard-stepA/B.png`, `knight-engage-stepA/B.png` |

**Out of scope for the first pass** (cheap fallbacks already cover them): bespoke
walk frames for the three skeleton variants and the priest — they reuse the base
`skeleton` / knight frames via the existing fallback, and read fine. Add them
later if the variants need to feel distinct in motion.

## Verification when the frames land

```sh
npm run build && python3 -m http.server 8000   # open http://localhost:8000/necro.html
```
- With **no** `-stepA/-stepB` PNGs: figures look exactly as today (static base) —
  proves the fallback.
- Drop the PNGs into `art/`: movers stride; facing flips with travel direction;
  the horde is desynced (no lockstep). Then add the files to `sw.js` `ASSETS` and
  bump `CACHE`.
- `npm test` (smoke + pentagram + necro harnesses) stays green — the render-smoke
  group must still pass with zero sprites loaded.
