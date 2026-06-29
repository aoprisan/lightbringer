# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Light-Bringer is a set of action games shipped as installable, offline-capable **PWAs** in one
repository. There are **five** games (the first three share one world — a city taught that *light burns*;
the fourth is a Lovecraftian sibling; the fifth is a werewolf sibling):

- **The Burning Vigil** (`pentagram.ts` / `pentagram.html`) — the **primary** game: an Archero-style
  action-combat descent. You stand still to inscribe a burning pentagram that scorches the city's risen
  watch; clear the finite host to cleanse the city. See its full section below.
- **The Necromancer's March** (`necro.ts` / `necro.html`) — a **sibling spinoff** that *inverts* the
  premise: you are the necromancer, raising a horde from a village's graves and overrunning the knights who
  defend it. See its full section below.
- **The Watcher at the Threshold** (`eldritch.ts` / `eldritch.html`) — a **Lovecraftian sibling spinoff**.
  You are an investigator who stands still to trace the **Elder Sign** (an AoE banish, the Vigil's verb
  re-themed); the twist is **Sanity**, a second life-bar that tracing the Sign *and* the host's nearness
  both drain — lose your HP and you are *slain*, lose your sanity and you go *mad*. See its full section below.
- **The Moon's Hunger** (`werewolf.ts` / `werewolf.html`) — a **werewolf sibling spinoff** set in a misty,
  fog-bound 13th-century Britain. You are a cursed soul who stands still to **bay at the moon** and stoke
  **Fury**; the twist is a living **day/night moon cycle** that drives your **Form** — by moonlight fury
  swells until you **turn beast** (the only form that can attack: standing still as the wolf traces a
  blood-moon **maw** that rends the village watch), and by daylight it bleeds you back to a hunted man. Cut
  down the finite watch to claim the village. See its full section below.
- **The Light-Bringer** (`app.ts` / `index.html`) — the original *contemplative* turn-based inversion game.
  It is **code-frozen**: it still ships and must keep building, but make **no code changes** to it.

The codebase is plain HTML/CSS + hand-written TypeScript modules rendering layered SVG. `tsc` compiles
`app.ts` → `app.js`, `pentagram.ts` → `pentagram.js`, `necro.ts` → `necro.js`, `eldritch.ts` →
`eldritch.js`, and `werewolf.ts` → `werewolf.js`; those `.js` files are what GitHub Pages serves. All five
games **cross-link** from each other's title/header.

Today the shipped runtime has zero third-party dependencies (the only dependency is `typescript` itself, a
devDependency). Treat "zero dependencies" and "fully offline" as **guidelines, not hard rules** — worth
preserving where cheap, but no longer constraints that veto a feature. In particular, **multiplayer is an
intended future direction** (trading, async/PvP duels, shared profiles), and landing it will mean accepting
a backend and/or runtime dependencies. Weigh new dependencies on their merits.

> **The Burning Vigil (`pentagram.ts`) is the primary game; The Necromancer's March (`necro.ts`) is its
> active sibling spinoff; the original (`app.ts` / `index.html`) is CODE-FROZEN.** New gameplay work happens
> in `pentagram.ts` or `necro.ts`. The original still **ships** — keep it building (it must compile clean
> and stay in `sw.js`/the deploy) — but make **no code changes** to `app.ts` / `index.html`: it is
> feature-frozen, not retired. All three share art and are cross-linked from each other's title screens.

## Commands

```sh
npm install                      # one-time: install the TypeScript compiler

npm run build                    # compile app.ts/pentagram.ts/necro.ts/eldritch.ts/werewolf.ts -> .js
npm run typecheck                # type-check only, no emit (tsc --noEmit)
npm test                         # build, then run all five headless tests
npm start                        # build, then serve over HTTP on :8000

# Run locally by hand — must be over HTTP, not file://, because the service
# worker needs a real origin. Build first so the .js files exist.
npm run build && python3 -m http.server 8000   # then open http://localhost:8000/

node tools/smoke-test.mjs        # original Light-Bringer sim test (against app.js)
node tools/pentagram-test.mjs    # The Burning Vigil combat test (against pentagram.js)
node tools/necro-test.mjs        # The Necromancer's March march test (against necro.js)
node tools/eldritch-test.mjs     # The Watcher at the Threshold watch test (against eldritch.js)
node tools/werewolf-test.mjs     # The Moon's Hunger hunt test (against werewolf.js)
node tools/gen-icons.mjs         # regenerate the parent icons/*.png from code
node tools/gen-ww-icons.mjs      # regenerate the werewolf icons/werewolf-*.png from code
```

`npm test` runs `tsc && node tools/smoke-test.mjs && node tools/pentagram-test.mjs && node
tools/necro-test.mjs && node tools/eldritch-test.mjs && node tools/werewolf-test.mjs` — compile, then all
five suites in sequence.

The `.js` files (`app.js`, `pentagram.js`, `necro.js`, `eldritch.js`, `werewolf.js`) are **build artifacts** — git-ignored, regenerated by
`tsc`. Never edit them directly; edit the `.ts`. Each test imports its compiled `.js`, so always
`npm run build` (or `npm test`, which does it) before running a test by hand.

There is no single-test runner; each `tools/*-test.mjs` is one file of assertion groups run top to bottom.
To narrow your work, edit/comment assertions locally — don't add a framework. The `tools/*.mjs` scripts are
plain Node ESM, not part of the TS build.

`tsconfig.json` is `strict` with `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns`; keep all five
files compiling clean (`npm run typecheck`). Its `include` is `["app.ts", "pentagram.ts", "necro.ts",
"eldritch.ts", "werewolf.ts"]`; `lightbringer.ts` is excluded (reference-only prototype).

## Architecture

### The pure-sim / read-only-render split (all five games)

Every game keeps the same discipline: the **simulation** functions take a plain state object and never touch
the DOM; **rendering** is a separate pass that reads the state and rebuilds the SVG. Sim mutates state,
render reads it. This is what lets each `*-test.mjs` exercise the game headlessly.

Each game has a **test seam** at the bottom of its module: when a test flag is set on `globalThis`, the
module exports its internals on a global object *instead of* calling `start()`. The harness sets the flag,
stubs a minimal `localStorage`/`document`, then imports the compiled `.js`:

| Game | Test flag | Exports object |
| --- | --- | --- |
| `app.ts` | `globalThis.__LB_TEST__` | `globalThis.__lb` |
| `pentagram.ts` | `globalThis.__PG_TEST__` | `globalThis.__pg` |
| `necro.ts` | `globalThis.__NECRO_TEST__` | `globalThis.__necro` |
| `eldritch.ts` | `globalThis.__ELD_TEST__` | `globalThis.__eld` |
| `werewolf.ts` | `globalThis.__WW_TEST__` | `globalThis.__ww` |

If you add a sim function a test needs, export it through that object.

**Module vs global script — an important difference.** `app.ts` has **no** `import`/`export` statements, so
`tsc` emits a plain classic script (loaded as `<script src>` and as a dynamic `import()` identically) — keep
it that way. `pentagram.ts`, `necro.ts`, `eldritch.ts` and `werewolf.ts` **are TS modules** (each ends with
`export {};`) loaded via `<script type="module">`. This is required: all five are in `tsconfig.json`'s
`include`, and scriptless files would collide on every top-level name (`W`, `el`, `render`, `start`, …).
Module scope keeps the four spinoffs isolated from `app.ts` and from each other. Don't remove the
`export {};` or convert them.

### `app.ts` — the original game (CODE-FROZEN)

Everything for the original lives in `app.ts`: types, tuning constants, city generation, simulation, SVG
rendering, persistence, and the game shell, in clearly-commented sections (Types → Tuning → Districts → City
generation → Simulation → Rendering → Game shell). The constants block near the top is the design surface.
The core sim functions (`generateCity`, `freshGame`, `simulateTicks`, `stepSpread`, `stepAwakened`,
`stepKeepers`, `kindle`, `awaken`, `snuff`, `litStats`, `applyDawn`, `saveGame`, `loadGame`, …) are pure.
**Do not change this file** — it's documented here only so you understand the shared lineage and invariants
the spinoffs inherit.

#### The city is turn-based: it breathes only when the player acts

`stepCity(g)` is the single unit of simulation time — one "breath": `tick += 1`, then `stepSpread` →
`stepAwakened` → `stepKeepers`. There is no wall-clock loop; the shell's `breathe()` runs exactly one
`stepCity` per player action or per deliberate **Wait**, then saves and repaints. `TICK_MS` survives only as
the conversion factor for the "while you were away" idle catch-up (`simulateTicks`, bounded by
`IDLE_CAP_TICKS`). (This is the original game's model; the two action spinoffs are real-time per-frame
instead — see below.)

#### Key invariants in the original simulation

- **Snuffing is irreversible and compounding.** A snuffed node's `veil` thickens, damps relighting, and once
  `veil` crosses `VEIL_REINFORCE_AT` it breeds a new Keeper (`reinforceVeil`). This asymmetry is the whole
  strategic point — both spinoffs inherit a version of it (Vigil's scar, Necro's reconsecration).
- **Only light connected to an awakened soul survives dawn.** `applyDawn` flood-fills from awakened nodes.
- **Awakened souls are the idle layer** (`stepAwakened`), including during the idle catch-up.
- **Hearths are aged souls that feed the carrier** (`nights >= HEARTH_NIGHTS`; `dawn()` refunds flame).
- **Decoys are transient, scar-free counterplay** (`placeDecoy`/`stepDecoys`, not persisted).
- **Awakened souls are beacons, not bunkers** — `stepKeepers` targets them before brighter lit ground.

#### Cities are levels — `generateCity` is parameterized, the rules are not

The procedural map is one of several hand-tuned **cities** (`LEVELS: LevelDef[]`). A `LevelDef` is a pure
bundle of *generation + economy* overrides; `generateCity(level)`/`freshGame(level)` read it, and **no rule
changes per city**, so each city is a different puzzle in the same language. `LEVELS[0]` ("The Old City") is
the original generation kept exactly. The five quarters live on `g.level.districts`. Each run carries its
resolved `LevelDef` on `g.level`. (The Burning Vigil reuses a copy of this `LEVELS`/`generateCity` machinery
— see its section.)

##### Terrain — canals & walls (`level.barriers`)

A `LevelDef` may carry `barriers: Barrier[]` — hand-authored line segments. A **canal** (`wall` falsy) only
*damps* conductivity (`CANAL_CROSS_DAMP`); a **wall** (`wall: true`) damps harder (`WALL_CROSS_DAMP`) **and**
blocks traversal (`wallBetween` in `applyDawn`/`runPress`, and the avatar's body via `pushOut`), but not the
Keepers (a universal force). Conductivity damp is baked in `finalizeCity`; wall-blocking is computed live.
Barriers are derived from the saved city id and never themselves saved.

##### Perks — the carrier's craft (embers, one per run)

`PERKS: Perk[]` is the catalog; each run the carrier may equip **one** perk (`g.perk`), resolved by
`perkMods(g)` into a modifier object read at a handful of sites. Perks bend the carrier's dials, never a
city's rules. **Embers** are the currency (`recordRun` banks a capped amount once per run); balance, owned
perk ids and equipped id live in the **legacy** key with no save bump. The equipped perk is re-derived from
the legacy on load, so the save format stays v5. *(This is the pattern the Vigil's sigil shop and Necro's
raising-rite shop both mirror.)*

### Persistence

| Game | Save key (per-run) | Legacy key (lifetime) |
| --- | --- | --- |
| `app.ts` | `lightbringer.save.v5` (`SAVE_KEY`) | `lightbringer.legacy.v1` (`LEGACY_KEY`) |
| `pentagram.ts` | *no mid-combat save* | `pentagram.legacy.v1` (`PG_LEGACY_KEY`) |
| `necro.ts` | *no mid-march save* | `necromancer.legacy.v1` (`NECRO_LEGACY_KEY`) |
| `eldritch.ts` | *no mid-watch save* | `eldritch.legacy.v1` (`ELD_LEGACY_KEY`) |
| `werewolf.ts` | *no mid-hunt save* | `werewolf.legacy.v1` (`WW_LEGACY_KEY`) |

`app.ts`'s `saveGame`/`loadGame` store the city id plus per-node scalars as compact arrays — **edges and
adjacency are NOT saved**; `finalizeCity` rebuilds them deterministically from node geometry + the city's
districts on load. Transient per-node fields (`decoy`) are not saved. If you change the save shape, bump the
version (`v`, `SAVE_KEY`, and the guard in `loadGame`).

The cross-run **legacy** keys are deliberately separate from the save: they survive "Begin again", and each
gains fields **defaulted on load with no key bump**. They are write-once-per-run-end (fold in exactly once at
each genuine end transition). The two action games have **no mid-run save at all** (runs are short), so their
only persistence is the legacy.

### Service worker cache versioning

`sw.js` is the offline app-shell cache for **all five games**, with an explicit `ASSETS` list and a `CACHE`
version string (currently `lightbringer-v96`). It is **network-first for the shells** (`isShell`: `/`,
`index.html`, `app.js`, `pentagram.html`, `pentagram.js`, `necro.html`, `necro.js`, `eldritch.html`,
`eldritch.js`, `werewolf.html`, `werewolf.js`) so the freshest code always wins online, and **cache-first** for the heavy, slow-changing
art/icons (what makes the game playable offline). `addAll()` rejects the whole install if any listed asset
404s, so every file in `ASSETS` must exist.

**When you add/rename a shipped asset, add it to `ASSETS` AND bump `CACHE`** (e.g. `v83` → `v84`).
Recompiling any `.ts` changes the bytes of the shipped `.js`, so **bump `CACHE` when a code change ships**.
The Necromancer's March art **has now shipped** (the four house states, well/altar/grave(+spent),
barricade/causeway, necromancer, both knight faces, the skeleton + three per-rite kinds, the priest, four
village establishing jpgs, and the Necro PWA icons/logo are all in `ASSETS`); render still falls back to
vector primitives when any are absent.

### Reference-only prototypes — do not ship

`lightbringer.ts` and `the-light-bringer.html` are the original single-file TypeScript prototype, kept for
reference only. They are **not** deployed, excluded from `tsconfig.json`, and not wired into anything. The
shipped logic has diverged; don't edit them and don't assume they're in sync.

---

## The Burning Vigil — the primary game (`pentagram.ts` / `pentagram.html`)

`pentagram.ts` (→ `pentagram.js`) + `pentagram.html` are the **primary** game, an Archero-style action
descent set in the same world. It reuses the parent's cities (a copied/trimmed `LEVELS`/`generateCity` — the
keeper nodes become enemy spawn-points) and the same art (scenery sprites for the built world,
`player-lantern` for the hero, the `keeper-*` sprites for the "shades"). The **only procedural art is the
pentagram itself** (`pentagramPath`, layered SVG).

**Combat is real-time per-frame**, not a turn-based breath: `stepCombat(s, dt, move)` integrates the hero,
shades, and pentagram pulses every RAF frame (dt-clamped). The weapon is *stand-still auto-inscribe*:
standing still ramps `penta.charge` (`PENTA_CHARGE_MS`) and the full sigil pulses AoE damage to shades in
`PENTA_RADIUS`; moving dodges and lets it fade. A city holds a **finite** host (`keeperCount *
SHADE_PER_KEEPER`) — **clear them all to win; lose your HP to fall.**

### Sigils — the weapon shop (`PENTA_TYPES`, embers)

The hero equips **one** sigil per descent (`s.type`, a `PentaType` resolved from the legacy at build via
`pentaTypeById`). `PENTA_TYPES` is the catalog of four, bought with **embers** and mirroring the parent's
perk shop:

- **The Vigil** (`vigil`, free) — the balanced baseline.
- **The Pyre** (`pyre`, 120) — wider, slower, harder-hitting; power `chain` (a kill arcs to nearby shades).
- **The Quick Ember** (`ember`, 160) — tight, fast pulses; power `scorch` (leaves burning ground patches).
- **The Wrath** (`wrath`, 240) — power `nova` (a full inscription erupts, knocking shades back).

Each `PentaType` carries `radiusMul`/`chargeMul`/`pulseMul`/`dmgMul` + a `PentaPower`
(`"none"|"chain"|"scorch"|"nova"`) + ring/star hues. Embers are banked by `recordClear`/`recordDeath`; the
owned/equipped ids live in `PgLegacy` (`unlocked`/`equipped`, defaulted on load — **no save format**, the
descent is unsaved). The intro picker buys and equips; equipping rerolls the not-yet-begun descent.

### The host is not homogeneous — shade variants

Per-city dials seed variant shades among the common host (each is a tuning block near the top, the design
surface):
- **Elite / champion** (`ELITE_HP_MUL`, `ELITE_CONTACT_DMG`) — tougher, may rise **veil-shielded** (only a
  full-charge pulse breaks the shield), seeded by `eliteCount`.
- **Spitter** (`SPITTER_*`) — holds standoff and lobs bolts; punishes standing still. `spitterCount`.
- **Darter** (`DARTER_HP`, `DARTER_SPEED_MUL`) — fast, frail melee that closes before the sigil ramps.
  `darterCount`.
- **Healer / mender** (`HEALER_*`) — holds standoff and mends wounded shades in range; kill it first.
  `healerCount`.

### Terrain & live-play layers

Mostly pure functions of node geometry, woven at build (`buildArena`) and held on `s.*` — **live-play state,
not persisted** (there's no mid-combat save), in the parent's decoys ethos. Tune per-city counts via the
`LevelDef` dials.
- **Solid structures** (`OBSTACLE_KINDS` = press, shrine, **obelisk**; radii in `OBSTACLE_RADIUS`) block
  movement via `pushOut` (hero and shades). Dwellings/conduits/fonts stay passable.
- **Fonts** (`"font"` node, `FONT_AURA`) — lightwells: the hero inscribes **even while moving** within the
  aura. A place to keep the sigil alive on the run.
- **Obelisks** (`"obelisk"` node, `OBELISK_AURA`/`OBELISK_REACH`) — solid ward-stones that **shield nearby
  shades** until cracked (hold a full inscription beside one to erupt and spend it; `n.spent`).
- **Fences** (`weaveSegments`, `FENCE_HALF`) — short walls that block **bodies, not the pentagram's flame**
  (capsule push-out). **Pathways** (`PATHWAY_HALF`, `PATHWAY_BOOST`) — longer lanes that speed the hero only;
  a lane is also a **processional** — walking it keeps the sigil inscribing at `PATHWAY_INSCRIBE_MUL` of the
  still-rate (the `onPath` charge branch, below still/`onFont`, above the plain fade), a third option between
  standing exposed and running cold without unseating "stand still on clean ground" as the fastest fill.
- **Lit dwellings** (a secondary objective, not a win gate). A dark dwelling caught in the charged ring
  kindles via `kindleDwelling` (sets `lit`/`litAt`, bumps `litCount`, mends the hero `DWELLING_HEAL`). The
  HUD (`litReadout`) shows `litCount / total` (+ `✦n` awakened). Winning is still clearing every shade.
  - **Awakened dwellings** (`stepDwellings`, `node.awoke` after `DWELLING_AWAKEN_MS`) become ally emitters,
    burning shades within `AWAKENED_RADIUS` for `AWAKENED_DMG` on each pulse.
  - **Snuffed dwellings** — a shade brushing a lit dwelling snuffs it (`snuffDwelling`): dark again,
    `litCount--`, and a `node.veil` scar (`SNUFF_VEIL_MS`) bars relighting that node (drawn as a scar; damps
    relighting, not the hero's own sigil). `nearScar` is the predicate.
- **Conduits — the fuse.** `buildArena` precomputes `s.conduitLinks`; `kindleDwelling` enqueues
  `s.spreadQueue` relays, and `stepSpread` kindles the far ends after `CONDUIT_DELAY`.
- **Presses — the one-shot cascade.** `stepPress` fires once when the hero stands within
  `PRESS_TRIGGER_REACH` at a full inscription: a `PRESS_BURST_R` burst, then `node.spent`.
- **Shrines — consecrated ground.** `SHRINE_AURA` (`inShrineAura`): dwellings inside can't be snuffed and the
  hero inscribes even on veiled/scarred ground.
- **Veil pools** (`stepCombat` drift): drifting dark patches that **unravel** the sigil (`VEIL_DRAIN_MUL`
  drains charge faster). `veilCount`.
- **Ember motes** (`MOTE_DROP_CHANCE`): slain shades may drop motes (`MOTE_TTL_MS`); gathering one triggers a
  damage **surge** (`MOTE_SURGE_MS`, `MOTE_SURGE_DMG`).
- **Frescoes & the reliquary** — the hero's *first-footing* (`FRESCO_REACH`, `node.seen`) reveals painted
  fragments (`maybeFresco`; the shell's `revealFresco` shows them non-modally so the swarm is never paused).
  Frescoes are a lifetime collection: `PgLegacy.frescoesFound`, folded in at each run-end by
  `recordFrescoes`; each `LevelDef` carries a signature subset `frescoes?: number[]` that **partition all
  indices across the cities** (asserted in the test), and completing a city's subset banks `FRESCO_SET_BONUS`
  embers. The reliquary is its own overlay (`showReliquary` → `frescoGalleryHtml`, per-city thumbnails;
  `showFresco` detail view) with **PNG sharing** (`shareReliquary`/`shareFresco` → `shareCanvas`, native
  share sheet or download). Render-layer only, drawn from already-cached fresco jpgs — no new assets.

### Cities (seven) and per-city dials

`LEVELS` now holds **seven** cities (the parent's five plus two): **The Old City**, **Ashfold**, **The
Drowned Quarter**, **The Glassworks**, **Vesper Row**, **The Ember Foundry**, **The Pale Bastion**. Each
`LevelDef` adds Vigil-specific dials on top of the parent's generation overrides:
`fenceCount`/`pathwayCount`, `fontCount`/`obeliskCount`, `veilCount`, and the variant counts
(`eliteCount`/`spitterCount`/`darterCount`/`healerCount`), plus `sizeScale` (arena size = `W/H × sizeScale`,
which leans difficulty — `difficultyMult` is normalized so The Old City sits near 1.0 and the hardest near
1.5) and the `frescoes` subset. The Old City is kept deliberately fair (no veils/elites). Cities may re-skin
the built world via `spriteFor`/`loadCitySprites` (`art/<cityId>/<name>.png`, silent fallback to the base).

### The Veilwarden duel — currently DISABLED (code intact)

> **Important:** the per-city seal-tracing boss duel is **disabled**. Clearing the host **wins outright** —
> there is a `NOTE` at the disable site in `pentagram.ts` (near the `startBoss(s)` call) saying the call is
> commented out and the duel can be re-enabled by restoring it.

The full duel code is still present and test-covered, so it can be turned back on: clearing the host would
flip `s.phase` `"fight"` → `"boss"` (`startBoss`), raising the city's master Keeper over a procedural Goetic
**seal** (`makeSeal`, deterministic from the city id) that the carrier **binds strand by strand** by tracing
(`traceScore` rates a stroke, `submitTrace` binds, `SEAL_EDGE_DONE` threshold). Difficulty is the seal's
size; the bite quickens (`BOSS_BITE_RAMP`); drifting veils (`makeBossVeils`) unravel sloppy strokes;
keyboard fallback (`cycleSel`/`keyBind`, `BOSS_KEY_COST`). When touching boss behavior, remember it does not
currently run — don't describe it to users as a live feature.

### Title screen & sharing

`start()` opens on a **title screen** (`showStart`) — the app icon as logo, a random fresco (preferring
uncovered ones), and "Enter the Vigil" → `showPicker`. Two buttons share the game itself: **Share game link**
(`shareGameLink`, native share → clipboard → toast) and **Show QR code** (`showQR`). The QR is generated
**offline, zero-dep** (`qrEncode` — a self-contained byte-mode/ECC-L encoder, versions 1–5; returns `null`
over its ceiling and the view shows the link only); `drawQR` paints it and "Share QR image" reuses
`shareCanvas`. The encoder is test-driven in `tools/pentagram-test.mjs` (geometry, RS roots, over-long
guard, a place+mask round-trip).

Shipping rules: `pentagram.html`/`pentagram.js`/`pentagram.webmanifest` are in `sw.js` `ASSETS` (shell,
network-first); bump `CACHE` when their bytes change.

---

## The Necromancer's March — the inversion spinoff (`necro.ts` / `necro.html`)

`necro.ts` (→ `necro.js`) + `necro.html` are a sibling spinoff that **mechanically inverts** The Burning
Vigil: instead of carrying light, you are the **necromancer** who carries death. It is real-time "commander"
play — you move the necromancer (joystick/WASD) and **stand still over a grave to inscribe a raising
pentagram**; once charged it **raises 1–3 skeletons** (paid in *souls*). Minions follow and auto-target the
nearest knight; **razing houses heals the horde**. **Defeat every knight to overrun the village; lose your
own HP to fall.** Like the Vigil it is a TS module (`export {};`, `<script type="module">`), real-time
per-frame, with the pure-sim/read-only-render split and its own test seam.

The inversion is mechanical, point for point:

| The Burning Vigil (light) | The Necromancer's March (death) |
| --- | --- |
| Relight dark dwellings | Raze standing houses (`desecrateHouse`) |
| Lighting a dwelling **heals** the hero | Razing a house **heals** the horde (`DESEC_HEAL`, `HEAL_CAP`) |
| Lit dwelling **awakens** into an ally emitter | Razed house **rises** into a bone-**totem** (`HOUSE_RISE_MS`, `TOTEM_*`) |
| Shades **snuff** lights and scar the ground | Knights **reconsecrate** houses and scar the ground (`reconsecrateHouse`, `RECONSECRATE_MS`, `nearScar`) |
| You **are** the weapon (stand-still sigil) | You **command** the weapon (the raised horde) |

### The raising mechanic & the souls economy

The pentagram is the gate on every raise: standing still (`HERO_STILL_MAXSPEED`) ramps `hero.charge`
(`PENTA_CHARGE_MS`, ×`rite.chargeMul`); the dead only rise at charge ≥ `PENTA_RAISE_AT`. `stepRaise` then
spends souls and spawns minions from a reachable grave.

**Overcharge — the risk/reward on the core verb.** Holding still *past* a full inscription banks
`hero.overcharge` (0→1 over `PENTA_OVERCHARGE_MS`); any movement spends it back to 0 (like charge fade). When
the next raise pulse fires with a full overcharge **and** souls to spare (`OVERCHARGE_EXTRA_COST`), it is
**empowered**: it raises one extra **champion** skeleton (`champion: true`, `CHAMPION_HP_MUL`/`CHAMPION_DMG_MUL`/
`CHAMPION_SIZE_MUL`) and resets the overcharge. Same stand-still verb — the deeper play is to hold the stand
longer over a grave (more power ⇄ more exposure). No new input.

**Souls** are a deliberate **anti-fountain** economy: a march starts with `SOUL_START` (9); a raise costs
`RAISE_COST` (×`rite.soulMul`); souls come from felling a knight (`SOUL_PER_KILL`), razing a house
(`SOUL_PER_RAZE`, the snowball), and a slow **seep** (`SOUL_REGEN_MS`) that **only trickles while below
`SOUL_REGEN_TO`** — so you can always raise again, but you can never farm souls by standing idle. Graves hold
`GRAVE_RAISES` (5) raises before `graveSpent`, with `GRAVE_COOLDOWN_MS` between pulses; the horde is capped at
`MINION_CAP` (40). Slain knights drop soul **wisps** the hero gathers (`stepWisps`).

**Death-motes & frenzy** (the snowball's heartbeat; mirror of the Vigil's ember surge, inverted to a horde
buff). A felled knight may *also* drop a hot **death-mote** (`MOTE_DROP_CHANCE`, rarer than and separate from
a wisp); gathering it (`stepMotes`, walk over it) sets `hero.frenzyUntil` — a `FRENZY_MS` window in which the
**whole horde** swings faster (`FRENZY_HASTE`) and bites harder (`FRENZY_DMG_MUL`), read once in `stepMinions`.
Rewards wading into the press. Motes grant **no souls** — frenzy is the only payoff.

### Raising-rites (the skeleton "shop") & relics

The hero equips **one** rite per march (`RAISE_TYPES`, resolved by `raiseTypeById`; each minion locks its
`variant`/stats/hue/sprite at raise time). Each carries a `power: PowerKind` (`"none"|"plague"|"colossus"`,
mirror of the Vigil's `PentaPower`) — a passive behaviour that fires automatically, so the only choice is
which rite to equip:
- **The Common Grave** (`grave`, free) — balanced (`none`).
- **The Barrow-Wall** (`barrow`, 120) — 2× HP, slow, hard-hitting (wall of the dead) (`none`).
- **The Quick Cairn** (`cairn`, 160) — frail, fast, **+2 count** (swarming wights), fast inscribe (`none`).
- **The Gallows Rite** (`gallows`, 240) — tough, fast revenants (capstone) (`none`).
- **The Plague Pit** (`plague`, 200) — power `plague`: a felled plague-skeleton bursts into a lingering
  **death-miasma** (`killMinion` → `s.miasmas`; `stepMiasma` gnaws knights in `PLAGUE_CLOUD_R` for
  `PLAGUE_CLOUD_DPS`, via `hurtKnight`). Punishes a watch that kills the horde.
- **The Bone Colossus** (`colossus`, 280) — power `colossus`: a raise calls up **one** towering minion
  (`stepRaise` forces count 1) instead of a host — slow, dear, and very hard to fell.

`killMinion(s, m)` is the centralized minion-death path (so every source — knight swing, bolt, smite, charge
impact — fires the rite's on-death power the same way), the inversion of `hurtKnight`/`killKnight`.

**Relics** are the unlock currency (`recordOverrun`/`recordFall` bank them: `score ÷ RELIC_SCORE_DIV` on a
win, `RELIC_PER_KILL` per kill even on a loss). `unlockRite`/`equipRite` buy and equip from the picker; ids
live in `NecroLegacy` (`unlocked`/`equipped`, defaulted on load).

### Perks (the necromancer's craft) & the second relic sink

The hero also equips **one** perk per march (`PERKS`, resolved by `perkById`; `perkMods` merges its bundle
over `PERK_DEFAULTS`) — a passive build choice made once at the picker, **never an in-march input** (mirror of
the parent's perk catalog and the Vigil's sigil shop). Bought with the same **relics** that buy rites:
- **No Pact** (`none`, free, always owned, default) — baseline.
- **Gravecaller** (120) — `soulStart +3`, `soulRegenTo +1`.
- **Swift Dead** (160) — `minionSpeedMul ×1.18`.
- **Carrion Feast** (240) — `desecHealMul ×1.6`, `soulPerRaze +1`.

`buildArena` resolves the equipped perk into `s.perk`/`s.perkMods`, read at exactly four sites: starting souls
+ seep floor (`stepMarch`), minion travel speed (`stepMinions`), and razing heal + soul (`desecrateHouse`).
`unlockPerk`/`equipPerk` buy/equip from the picker (a perk row beside the rite row, one handler branched on
`data-kind`); ids live in `NecroLegacy` (`perksUnlocked`/`perkEquipped`, defaulted on load — **no key bump**,
exactly like the rite fields).

### Knight variants (the defenders) & the priest

`stepKnights` runs the watch. **Common** (60 HP) and **Captain** (`×2.4` HP, harder swing, leads a post)
guard until roused, then chase the nearest threat (necromancer or minion) and swing on cooldown
(`KNIGHT_*`/`CAPTAIN_*`). The **Priest** (`×1.4` HP) **never melees**: it channels mana
(`PRIEST_CHARGE_MS`), locks the nearest skeleton in range (`PRIEST_SMITE_RANGE`), and after a windup beam
**kills it outright** — with **two counterplays**: crowd it with skeletons (each within `PRIEST_SWARM_RADIUS`
slows the channel by `PRIEST_SWARM_SLOW`), or **interpose the necromancer's own body** on the beam
(`PRIEST_BLOCK_HALF`) to foil the smite (costs no life). Five more defenders deepen the watch:
- **Crossbowman** (`CROSSBOW_*`) — the watch's **ranged** arm (mirror of the Vigil's spitter, and Necro's
  **only projectile**). It **never melees**: it holds a standoff (`CROSSBOW_STANDOFF`/`CROSSBOW_RANGE`,
  kiting near threats, closing far ones) and looses **dodgeable bolts** (`stepBolts`, a `Bolt` on `s.bolts`)
  on `CROSSBOW_SHOOT_CD`. A bolt is stopped by a **barricade** (`barricadeBetween`/`segsCross`) — which also
  makes it **hold fire** when one blocks line of sight — so the counters are cover, body-blocking with the
  horde, and movement (it punishes standing still to inscribe). `crossbowCount`.
- **Standard-Bearer** (`BANNER_*`) — the watch's **support**. It melees like a common knight but its banner
  emits a **rally aura** (`BANNER_RADIUS`): knights within it swing faster (`BANNER_HASTE`), hit harder
  (`BANNER_DMG_MUL`), and slowly mend (`BANNER_HEAL`) — a transient per-frame `rallied` flag recomputed in
  `stepKnights`. **Kill the bearer and the buff collapses.** `bannerCount`.
- **Mender / Chaplain** (`MENDER_*`) — a backline **healer** (direct port of the Vigil's mender). It **never
  melees**: it holds a standoff (`MENDER_STANDOFF`) and channels a **strong single-target heal**
  (`MENDER_HEAL`) into the most-wounded knight within `MENDER_RANGE` (drawn as a mend-beam). Kill it (or its
  mark) first. `menderCount`.
- **Paladin** (`PALADIN_*`) — a melee **wall**. Its plate shaves a **flat** amount off every blow it takes
  (`PALADIN_ARMOR`, to a `PALADIN_MIN_DMG` floor, so it is still mortal): chip damage barely scratches it,
  forcing the horde to focus-fire. Armour is applied in `hurtKnight` — the single damage path all knight
  damage (minion swing, totem pulse, altar burst) now routes through. `paladinCount`.
- **Marshal / Cavalry** (`MARSHAL_*`) — a **charging** skirmisher. Off cooldown (`MARSHAL_CHARGE_CD`) with a
  target in `MARSHAL_CHARGE_RANGE`, it locks a heading and **dashes** (`MARSHAL_CHARGE_SPEED`/`_MS`); the
  impact deals heavy damage (`MARSHAL_IMPACT_DMG`) and a long knockback (`MARSHAL_KNOCKBACK`) to whatever it
  strikes, then it recovers. Melees like a common knight between charges. Punishes a clumped horde.
  `marshalCount`.

`hurtKnight(s, e, dmg)` is the centralized knight-damage path (so paladin armour holds everywhere); the
crossbow/mender/marshal are **extra bodies** mustered per post (banner/mender/paladin/marshal never take a
fixed slot, the crossbow takes only the third common slot). Captain/priest/crossbow/banner/mender/paladin/
marshal counts are all per-`LevelDef` dials.

### Houses & terrain

- **Houses** (the dwelling inversion): `stepDesecrate` razes a standing, non-scarred house a minion reaches
  (`DESEC_REACH`) → `desecrateHouse` (heals the horde, +soul, `desecCount++`); held `HOUSE_RISE_MS` it
  `stepHouses` into a **bone-totem** pulsing knights in `TOTEM_RADIUS` for `TOTEM_DMG`. A knight in reach
  **reconsecrates** it (scar bars re-razing for `RECONSECRATE_MS`; `nearScar`/`SCAR_RADIUS`).
- **Solids** (`OBSTACLE_KINDS` = well, altar) block bodies via `pushOut`. **Barricades** (`weaveSegments`,
  `BARRICADE_HALF`) are walls that block bodies, not bursts. **Causeways** (`CAUSEWAY_HALF`,
  `CAUSEWAY_BOOST`) speed the necromancer only. **Graves** are the raise sites. **Altars** fire a one-shot
  burst (`stepAltar`) damaging knights and razing houses in reach. Geometry helpers: `closestOnSegment`,
  `pushOut`, `weaveSegments` — all pure, rebuilt at `buildArena`, never persisted.

### Sim loop, scoring, villages

`stepMarch(s, dt, move)` is the per-frame entry; it runs `stepRaise` → `stepWisps` → `stepMinions` →
`stepKnights` → `stepDesecrate` → `stepHouses` → `stepAltar`, then checks terminal states (`hero.hp ≤ 0` →
`"lost"`; all knights dead → `"won"`). Helpers: `nearestKnight`/`nearestMinion`, `aliveKnights`/
`aliveMinions`/`clearedPct`, `killKnight`, `scoreRun` (base + speed + houses + survival + untouched ×
`difficultyMult`), `houseReadout` (HUD). Render is a separate `render(s, layer)` pass the shell calls after
`stepMarch`.

Villages (`LEVELS`, via `generateNecroVillage`/`levelById`/`buildArena`): **Hollowmere** (fair first
march, no special defenders), **The Tithe Barrows** (graves plentiful; 2 captains/1 priest/2 crossbows/1
mender), **Saint Auber's Rest** (walled, hardest — 4 captains/3 priests/4 crossbows/2 bearers/2 menders/2
paladins), **Gallows Fen** (sparse houses, thick graves, open ground for cavalry; 2 captains/2 priests/3
crossbows/1 bearer/1 paladin/2 marshals). Dials: `nodeCount`, `houseFrac`, `postCount`,
`barricadeCount`/`causewayCount`,
`captainCount`/`priestCount`/`crossbowCount`/`bannerCount`/`menderCount`/`paladinCount`/`marshalCount`,
`sizeScale`.

### What Necro does NOT have (deferred)

Unlike the Vigil, Necro currently has **no boss/duel**, **no frescoes/reliquary collection**, and **no QR
encoder**. It does have a title screen (`showStart`), a village picker with the rite shop (`showPicker`), and
a share-link button (`shareGameLink`). These are reasonable parity ports to add later.

### Persistence & art

No mid-march save. The legacy is `necromancer.legacy.v1` (`NecroLegacy`: `runs`, `overruns`, `best` per
village, `housesRazed`, `totemsRaised`, `relics`, `unlocked`, `equipped`, plus `perksUnlocked`/`perkEquipped`
for the perk shop — all new fields defaulted on load with **no key bump**), via
`loadNecroLegacy`/`saveNecroLegacy`/`emptyNecroLegacy` and the write-once-per-end `recordOverrun`/
`recordFall`. Every sprite has a **procedural SVG fallback** (`scenerySprite`, `pentagramPath`, the render
fallbacks), so the game is fully playable with zero PNGs — though its PNG art **has now shipped** and is in
`sw.js`. Sprite resolution mirrors the Vigil (`spriteFor`/`loadSprites`/`loadCitySprites`). Test seam:
`globalThis.__NECRO_TEST__` → `globalThis.__necro`, driven headlessly by `tools/necro-test.mjs`.

Shipping rules: `necro.html`/`necro.js`/`necro.webmanifest` are in `sw.js` `ASSETS` as shell
(network-first); bump `CACHE` when their bytes change.

---

## The Watcher at the Threshold — the Lovecraftian spinoff (`eldritch.ts` / `eldritch.html`)

`eldritch.ts` (→ `eldritch.js`) + `eldritch.html` are a fourth action spinoff, set in **H. P. Lovecraft's
mythos**. It reuses the proven "you ARE the weapon, stand still" core of the Burning Vigil — re-themed: you
walk an **investigator** (the Watcher) through a doomed place and **stand still to trace the Elder Sign**, a
sigil that **banishes** the eldritch host pouring from the rifts. Clear the finite host (`riftCount ×
HORROR_PER_RIFT` + seeded variants) to **seal the threshold** and win. Like its siblings it is a TS module
(`export {};`, `<script type="module">`), real-time per-frame (`stepWatch(s, dt, move)`), with the
pure-sim/read-only-render split and a test seam (`globalThis.__ELD_TEST__` → `globalThis.__eld`, driven by
`tools/eldritch-test.mjs`).

### The defining twist — SANITY (a second life-bar)

Nothing else in the repo has this. The Watcher carries **two** bars: **HP** (corporeal) and **SANITY** (the
mind). Sanity is drained by three things — **DREAD** (`stepDread`: each *hunting* horror within
`DREAD_RADIUS` bleeds it, scaled by closeness and a per-kind `HORROR_DREAD` weight), a gazer's **GAZE**
(`GAZE_DPS` at range with line of sight), and the very act of **tracing the Sign** (`SIGN_SANITY_COST` per
pulse — channelling forbidden geometry frays the mind). It is restored at **sealed wards** (their aura) and
by **clue-motes** (dropped by the banished). **Lose your HP and you are SLAIN; lose your SANITY and you go
MAD** — two distinct loss ends (`s.lossCause`, `"slain"` | `"mad"`), both checked in `stepWatch`.

### The Elder Sign — the weapon (stand-still trace)

`HERO_STILL_MAXSPEED` gates tracing: standing still ramps `hero.charge` (`SIGN_CHARGE_MS`), moving fades it.
`stepSign` paces the pulses on a cadence once `charge ≥ SIGN_BANISH_AT`; `firePulse` is the deterministic
heart — AoE `SIGN_DMG` to every horror within `SIGN_RADIUS`, the sanity cost, sealing any dark ward caught,
the Sign's power, and an **overcharge** erupt. **Overcharge** mirrors the Necromancer's: hold still past a
full trace to bank it (`SIGN_OVERCHARGE_MS`), and the next pulse is **empowered** — a wider ring that REPELS
the host *and* restores sanity (`OVERCHARGE_SANITY`), then resets (an auto-pulse spends the bank, so it
oscillates while you hold).

### Signs — the weapon shop (`SIGN_TYPES`, lore)

The Watcher equips **one** Sign per watch (`s.sign`, resolved from the legacy at build via `signTypeById`),
bought with **lore** (the currency, mirror of the Vigil's embers / Necro's relics). Four: **The Elder Sign**
(`elder`, free, balanced), **The Yellow Sign** (`yellow`, power `chain` — a banishing arcs to the next
horror), **The Voorish Sign** (`voor`, power `calm` — each banishing steadies the mind, the sanity Sign), and
**The Naacal Glyph** (`naacal`, power `repel` — every pulse flings the host back). Each carries
`radiusMul`/`chargeMul`/`pulseMul`/`dmgMul`/`sanityCostMul` + a `SignPower` (`"none"|"chain"|"calm"|"repel"`).
`unlockSign`/`equipSign` buy and equip; ids live in `EldLegacy` (`unlocked`/`equipped`, defaulted on load).

### The host (variants) & terrain

Per-place dials seed variants among the common **shambler** (Deep One) host: **darter** (Byakhee — fast,
frail), **brute** (Star-Spawn — slow, tough, heavy), **gazer** (Nightgaunt — never melees; holds a standoff
and **lances sanity** at range with line of sight; broken by a **wall** between, via `wallBetween`/`segsCross`),
and **acolyte** (Cultist — never melees; mends the most-wounded horror). The watch's AI mirrors the siblings
(`stepHorrors`: lurk near a rift until aggro, then hunt, sticky, with a cleanup sweep). Terrain (all pure,
rebuilt at `buildArena`, never persisted): **menhirs** (solids, block bodies via `pushOut`), **wards**
(seal sites — `kindleWard`/`defileWard`, an ally emitter aura + a defile scar that bars resealing,
`nearScar`), **walls** (`weaveSegments`, block bodies *and* break a gaze), **paths** (`PATH_BOOST`, speed the
Watcher). Places (four, Lovecraftian): **Innsmouth** (fair first), **Dunwich**, **Kingsport**, **R'lyeh**
(hardest). `scoreRun` adds a **sanity-kept** bonus alongside speed/wards/survival/untouched × `difficultyMult`.

### Persistence & art

No mid-watch save. The legacy is `eldritch.legacy.v1` (`EldLegacy`: `runs`, `seals`, `best` per place,
`wardsSealed`, `banished`, `lore`, `unlocked`, `equipped` — new fields defaulted on load with **no key
bump**), via `loadEldLegacy`/`saveEldLegacy`/`emptyEldLegacy` and the write-once-per-end `recordSeal`/
`recordFall`. Every sprite has a **procedural SVG fallback** (`scenerySprite`, `pentagramPath`, the render
fallbacks), so the game is **fully playable with zero PNGs** — and it currently ships that way: **no PNG art
of its own has shipped yet**, so only the shell (`eldritch.html`/`eldritch.js`/`eldritch.webmanifest`) is in
`sw.js` `ASSETS` (network-first). Its webmanifest references PWA icons that don't exist yet; the browser
fetches those (not `addAll`), so the 404s are harmless. When the Watcher/host/ward sprites and icons ship,
add them to `ASSETS` **and** bump `CACHE`. Sprite resolution mirrors the siblings
(`spriteFor`/`loadSprites`/`loadCitySprites`).

Shipping rules: `eldritch.html`/`eldritch.js`/`eldritch.webmanifest` are in `sw.js` `ASSETS` as shell
(network-first); bump `CACHE` when their bytes change.

---

## The Moon's Hunger — the werewolf spinoff (`werewolf.ts` / `werewolf.html`)

`werewolf.ts` (→ `werewolf.js`) + `werewolf.html` are a fifth action spinoff, set in a misty, fog-bound
**13th-century Britain** of thatch villages and standing stones. It reuses the proven "you ARE the weapon,
stand still" core of the Burning Vigil — re-themed onto the **lycanthrope's curse**: you walk a cursed soul
through a sleeping village and, when the moon swells, **turn beast** and rend the watch that hunts you. Clear
the finite watch (`greenCount × FOE_PER_GREEN` + seeded variants) to **claim the village** and win. Like its
siblings it is a TS module (`export {};`, `<script type="module">`), real-time per-frame
(`stepHunt(s, dt, move)`), with the pure-sim/read-only-render split and a test seam
(`globalThis.__WW_TEST__` → `globalThis.__ww`, driven by `tools/werewolf-test.mjs`).

### The defining twist — the MOON (a living day/night cycle that drives your FORM)

Nothing else in the repo has this. A hunt runs a continuous **day/night wheel**: `s.moon` (0..1) advances
every frame (`MOON_CYCLE_MS`); `daylight(moon)` is 1 at noon (moon 0/1) and 0 at midnight (0.5), and
`moonlightOf` is its inverse. The moon drives **Fury** (`hero.fury`, the curse-meter, the second bar), and
fury drives the **Form** (`hero.form`: `"human" | "wolf"`):
- As a **MAN** you cannot attack — frail, hunted. Standing still **bays at the moon**: fury swells, fast
  under moonlight (`FURY_RISE_MS`, scaled by `moonlightOf`), a crawl by daylight. At the crest you **turn
  beast** (`form → "wolf"`).
- As the **WOLF** you are the weapon, and faster. Standing still traces the **maw** (below). Fury **bleeds**
  over time (`FURY_DRAIN_MS`, faster by daylight) and every rending **spends** a little (`MAW_FURY_COST`), so
  you must **feed** to hold the change — every kill stokes fury (`FURY_PER_KILL`). Spent to nothing, you turn
  back to a man. The rhythm: **night is your hour to rampage; by day you are prey.**

HP is the only loss bar (lose your blood → `"lost"`); the moon/fury layer is the form gate, not a death.

### The maw — the wolf's weapon (stand-still trace, WOLF-only)

`HERO_STILL_MAXSPEED` gates the trace: standing still ramps `hero.charge` (`CHARGE_MS`, scaled by moonlight),
moving fades it. `stepMaw` paces the pulses on a cadence once `charge ≥ MAW_BITE_AT` **and only while a
WOLF** (the gate that makes "attacks when wolf" literal — a man's stand only builds fury). `firePulse` is the
deterministic heart — AoE `MAW_DMG` to every foe within `MAW_RADIUS`, marking any dark cairn caught, the
pelt's power, the fury cost, and an **overcharge** erupt. **Overcharge** mirrors the siblings: hold still past
a full trace to bank it (`OVERCHARGE_MS`), and the next pulse is **empowered** — a wider ring that TERRIFIES
(flings the host back, `TERROR_KNOCK`) *and* stokes fury (`OVERCHARGE_FURY`), then resets.

### Pelts — the weapon shop (`PELT_TYPES`, moonstones)

The hero dons **one** pelt per hunt (`s.pelt`, resolved from the legacy at build via `peltTypeById`), bought
with **moonstones** (the currency, mirror of the Vigil's embers / Necro's relics / the Watcher's lore). Four:
**The Grey Pelt** (`grey`, free, balanced), **The Dire Pelt** (`dire`, power `frenzy` — a kill leaps to the
next foe), **The Fell Pelt** (`fell`, power `moonblood` — each kill stokes extra fury, the fury pelt), and
**The Black Pelt** (`black`, power `terror` — every pulse flings the host back). Each carries
`radiusMul`/`chargeMul`/`pulseMul`/`dmgMul` + a `PeltPower` (`"none"|"frenzy"|"moonblood"|"terror"`).
`unlockPelt`/`equipPelt` buy and equip; ids live in `WwLegacy` (`unlocked`/`equipped`, defaulted on load).

### The watch (variants) & projectiles

Per-village dials seed variants among the common **villager** host: **hound** (fast, frail), **knight**
(slow, plated, heavy), **huntsman** (the watch's ranged arm and **only projectile** — never melees; holds a
standoff and looses **dodgeable silver bolts**, `stepBolts`, on `HUNTSMAN_SHOOT_CD`; a **wall** stops a bolt
and makes it hold fire, and **MIST hides the hero** from it — punishes the stand-still trace), and **friar**
(the anti-werewolf — never melees; channels **consecration** that **bleeds the hero's fury** at range with
line of sight, threatening to force you back to a man; break LoS behind a wall, hide in mist, or close and
rend it). The watch's AI mirrors the siblings (`stepFoes`: lurk near a green until aggro, then hunt), with a
werewolf wrinkle: **the watch is slower to rouse to a MAN, or to a beast lost in the fog**
(`STEALTH_AGGRO_MUL`) — stealth as a man is real.

### Terrain — and two werewolf-specific innovations

All pure, rebuilt at `buildArena`, never persisted: **stones & cottages** (solids, block bodies via
`pushOut`), **cairns** (the mark sites — `markCairn`/`cleanseCairn`, an ally-emitter aura that grants fury +
rends the host, with a cleanse scar that bars re-marking, `nearScar`), **hedgerows** (`weaveSegments`, block
bodies *and* stop bolts / break LoS), **lanes** (`PATH_BOOST`, speed the hero). The two innovations make the
day/night twist spatial and atmospheric:
- **Moonwells** (`inMoonwell`, `MOONWELL_AURA`) — pools where the moon always reaches: fury swells and the
  maw traces at the **night rate whatever the hour**, the wolf's foothold against the day.
- **Mist** (drifting fog banks, `stepMists`/`inMist`) — the misty Britain made mechanical and the wolf's
  cover: inside a bank a huntsman can't see you (holds fire) and the watch is slower to rouse.

### Villages (four) & sim loop

`LEVELS` holds four villages: **Thornwick** (fair first), **Greymoor** (moor; hounds & huntsmen), **Hollowby**
(walled market town; knights, friars, the abbey), **Wulfmere** (drowned fen, hardest). Each `LevelDef` carries
`stoneCount`/`cottageCount`/`cairnCount`/`moonwellCount`, `greenCount`/`greenSpacing`,
`wallCount`/`pathCount`/`mistCount`, the variant counts
(`houndCount`/`knightCount`/`huntsmanCount`/`friarCount`), and `sizeScale`. `stepHunt` advances the moon,
integrates the hero, resolves the form, runs `stepMaw → stepFoes → stepBolts → stepCairns → stepMists →
stepMotes`, then checks terminal states (`hero.hp ≤ 0` → `"lost"`; all foes dead → `"won"`). Helpers mirror
the siblings (`slay`/`hurtFoe`/`nearestFoe`, `aliveFoes`/`clearedPct`/`furyReadout`, `scoreRun`,
`difficultyMult`). **Blood-motes** (`stepMotes`) are the fury economy's heartbeat: a felled foe may drop one;
gathering it stokes the curse.

### Persistence & art

No mid-hunt save. The legacy is `werewolf.legacy.v1` (`WwLegacy`: `runs`, `hunts`, `best` per village,
`cairnsMarked`, `slain`, `moonstones`, `unlocked`, `equipped` — new fields defaulted on load with **no key
bump**), via `loadWwLegacy`/`saveWwLegacy`/`emptyWwLegacy` and the write-once-per-end `recordHunt`/
`recordFall`. Every sprite has a **procedural SVG fallback** (`scenerySprite`, `pentagramPath` — here a
blood-moon claw sigil, the render fallbacks: the man, the beast, the watch, the cairns/moonwells/cottages), so
the game is **fully playable with zero gameplay PNGs** — and it currently ships that way: **no gameplay PNG
art of its own has shipped yet**. Its **PWA icons DO ship**, though — a blood-clawed full moon generated
zero-dep by `tools/gen-ww-icons.mjs` (`icons/werewolf-icon-{192,512,180}.png` + maskable), listed in `sw.js`
`ASSETS`. When the man/beast/watch sprites ship, add them to `ASSETS` **and** bump `CACHE`. Sprite resolution
mirrors the siblings (`spriteFor`/`loadSprites`/`loadCitySprites`).

Shipping rules: `werewolf.html`/`werewolf.js`/`werewolf.webmanifest` and the `icons/werewolf-*.png` are in
`sw.js` `ASSETS` (shell network-first, icons cache-first); bump `CACHE` when their bytes change.

## Deploy

`.github/workflows/deploy.yml` runs `npm ci && npm run build` (compiling all five `.ts` → `.js`), prunes
`node_modules`, then publishes the repo root to GitHub Pages on every push to `main` (or manual
`workflow_dispatch`). One-time setup: Settings → Pages → Source: "GitHub Actions". The site **is** the
repository root — there is no `dist/`.
