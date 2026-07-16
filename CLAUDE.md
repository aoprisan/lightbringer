# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Light-Bringer is a set of action games shipped as installable, offline-capable **PWAs** in one
repository, unified behind a **class-select front door**: the site root (`index.html`) is a hub where the
player **chooses a class**, and that choice launches one of the games (for now each class simply *is* one of
the games). There are **five** games (the first two share one world — a city taught that *light burns*;
the third is a Lovecraftian sibling, the fourth a werewolf sibling, and the fifth a WW2 bomber sibling):

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
  fog-bound 13th-century Britain. **Unlike its four siblings it does NOT share the "stand still → AoE sigil"
  verb** — it is a **predator chase**: as a hunted **man** you stalk the village unseen and stand still only
  to **bay at the moon** and stoke **Fury**; a living **day/night moon cycle** drives your **Form** — by
  moonlight fury swells until you **turn beast**. The **wolf has no stand-and-channel attack** — it builds
  **Momentum** by running and **runs prey down**, mauling on contact (force scales with momentum) and
  auto-**pouncing** the straggler ahead. The village **flees and panics** (a spreading **alarm** rouses the
  armed hunters), and by daylight fury bleeds you back to a man — so feed (kill) to hold the change. The
  whole loop is **pure joystick** (no attack button). Cut down the finite watch to claim the village. See
  its full section below.
- **The Iron Rain** (`bomber.ts` / `bomber.html`) — a **WW2 bomber sibling spinoff** under the leaden skies
  of a world war. You captain a **heavy bomber that can never stop** (no input = cruise straight on); the
  family's stand-still verb is inverted into the **bomb run** — *hold a straight and level course* to arm
  the **bombsight**, and an armed sight releases bombs ahead of the nose. The counter-pressure is **flak**
  that *leads your predicted line* (a straight run is a predictable run) with telegraphed, dodgeable bursts,
  plus **fighter squadrons** that scramble from bombable **airfields** — bomb the field first and its
  grounded squadron burns. Your own **escort fighters** fly a formation ring and tangle with the
  interceptors. Silence the finite target list (**works** + **army columns**) to complete the raid. See its
  full section below.
> **Retired:** the original *contemplative* turn-based inversion game (`app.ts` / the old `index.html`
> content) has been **dropped**. Its source, its smoke-test (`tools/smoke-test.mjs`), and its build/cache/
> deploy wiring are gone; `index.html` is now the class-select hub. The four action games carry the shared
> lineage forward — comments in the spinoff modules still reference `app.ts` as the historical origin of
> their patterns (the pure-sim/render split, the per-node invariants, the cities-as-levels machinery).

The codebase is plain HTML/CSS + hand-written TypeScript modules rendering layered SVG. `tsc` compiles
`pentagram.ts` → `pentagram.js`, `necro.ts` → `necro.js`, `eldritch.ts` → `eldritch.js`, `werewolf.ts` →
`werewolf.js`, and `bomber.ts` → `bomber.js`; those `.js` files are what GitHub Pages serves. The hub (`index.html`) and each game
**cross-link**: every game's header has a **⌂ Class Select** link back to the hub plus quick links to its
siblings.

Today the shipped runtime has zero third-party dependencies (the only dependency is `typescript` itself, a
devDependency). Treat "zero dependencies" and "fully offline" as **guidelines, not hard rules** — worth
preserving where cheap, but no longer constraints that veto a feature. In particular, **multiplayer is an
intended future direction** (trading, async/PvP duels, shared profiles), and landing it will mean accepting
a backend and/or runtime dependencies. Weigh new dependencies on their merits.

> **The Burning Vigil (`pentagram.ts`) is the primary game; The Necromancer's March (`necro.ts`) is its
> active sibling spinoff.** New gameplay work happens in `pentagram.ts` or `necro.ts` (or the other three
> spinoffs). All five are reached from the class-select hub (`index.html`), which is a plain
> static page — picking a class navigates to that game's shell.

## Commands

```sh
npm install                      # one-time: install the TypeScript compiler

npm run build                    # compile covenant.ts + pentagram.ts/necro.ts/eldritch.ts/werewolf.ts/bomber.ts -> .js
npm run typecheck                # type-check only, no emit (tsc --noEmit)
npm test                         # build, then run all five headless tests
npm start                        # build, then serve over HTTP on :8000

# Run locally by hand — must be over HTTP, not file://, because the service
# worker needs a real origin. Build first so the .js files exist.
npm run build && python3 -m http.server 8000   # then open http://localhost:8000/ (the class-select hub)

node tools/pentagram-test.mjs    # The Burning Vigil combat test (against pentagram.js)
node tools/necro-test.mjs        # The Necromancer's March march test (against necro.js)
node tools/eldritch-test.mjs     # The Watcher at the Threshold watch test (against eldritch.js)
node tools/werewolf-test.mjs     # The Moon's Hunger hunt test (against werewolf.js)
node tools/bomber-test.mjs       # The Iron Rain raid test (against bomber.js)
node tools/gen-icons.mjs         # regenerate the parent icons/*.png from code
node tools/gen-ww-icons.mjs      # regenerate the werewolf icons/werewolf-*.png from code
node tools/gen-eld-icons.mjs     # regenerate the eldritch icons/eldritch-*.png from code
node tools/gen-bomber-icons.mjs  # regenerate the bomber icons/bomber-*.png from code
```

`npm test` runs `tsc && node tools/pentagram-test.mjs && node
tools/necro-test.mjs && node tools/eldritch-test.mjs && node tools/werewolf-test.mjs && node
tools/bomber-test.mjs` — compile, then all five suites in sequence.

The `.js` files (`pentagram.js`, `necro.js`, `eldritch.js`, `werewolf.js`, `bomber.js`) are **build artifacts** — git-ignored, regenerated by
`tsc`. Never edit them directly; edit the `.ts`. Each test imports its compiled `.js`, so always
`npm run build` (or `npm test`, which does it) before running a test by hand.

There is no single-test runner; each `tools/*-test.mjs` is one file of assertion groups run top to bottom.
To narrow your work, edit/comment assertions locally — don't add a framework. The `tools/*.mjs` scripts are
plain Node ESM, not part of the TS build.

`tsconfig.json` is `strict` with `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns`; keep all six
files compiling clean (`npm run typecheck`). Its `include` is `["covenant.ts", "pentagram.ts", "necro.ts",
"eldritch.ts", "werewolf.ts", "bomber.ts"]`; `lightbringer.ts` is excluded (reference-only prototype).
`covenant.ts` (→ `covenant.js`) is the **one shared module** — the cross-game Covenant meta-layer all five
games and the hub import (see its section under Architecture).

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
| `pentagram.ts` | `globalThis.__PG_TEST__` | `globalThis.__pg` |
| `necro.ts` | `globalThis.__NECRO_TEST__` | `globalThis.__necro` |
| `eldritch.ts` | `globalThis.__ELD_TEST__` | `globalThis.__eld` |
| `werewolf.ts` | `globalThis.__WW_TEST__` | `globalThis.__ww` |
| `bomber.ts` | `globalThis.__BOMBER_TEST__` | `globalThis.__bomber` |

If you add a sim function a test needs, export it through that object.

**Module vs global script — an important difference.** `pentagram.ts`, `necro.ts`, `eldritch.ts`,
`werewolf.ts` and `bomber.ts` **are TS modules** (each ends with `export {};`) loaded via `<script type="module">`. This is
required: all five are in `tsconfig.json`'s `include`, and scriptless files would collide on every top-level
name (`W`, `el`, `render`, `start`, …). Module scope keeps the five games isolated from each other — with
**one deliberate exception**: every game imports the shared `covenant.ts` (the cross-game meta-layer), and
nothing else. Don't remove the `export {};` or convert them, and don't add further cross-game imports —
covenant.ts IS the sanctioned connective tissue. (The removed original, `app.ts`, was the one classic global
script — which is why the modules' comments still note "no `import`/`export`, like `app.ts`": that contrast
is historical now.)

### The removed original (`app.ts`) — the lineage the games inherit

> `app.ts` (the original contemplative game) has been **removed** from the repo. The text below is kept as
> **historical lineage** — it documents the patterns and invariants the four action games copied and
> re-themed (Vigil's scar, Necro's reconsecration, the cities-as-levels machinery). There is no file to
> change; this is reference only.

Everything for the original lived in `app.ts`: types, tuning constants, city generation, simulation, SVG
rendering, persistence, and the game shell, in clearly-commented sections (Types → Tuning → Districts → City
generation → Simulation → Rendering → Game shell). The core sim functions (`generateCity`, `freshGame`,
`simulateTicks`, `stepSpread`, `stepAwakened`, `stepKeepers`, `kindle`, `awaken`, `snuff`, `litStats`,
`applyDawn`, `saveGame`, `loadGame`, …) were pure — the discipline the spinoffs carry forward.

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
| `pentagram.ts` | *no mid-combat save* | `pentagram.legacy.v1` (`PG_LEGACY_KEY`) |
| `necro.ts` | *no mid-march save* | `necromancer.legacy.v1` (`NECRO_LEGACY_KEY`) |
| `eldritch.ts` | *no mid-watch save* | `eldritch.legacy.v1` (`ELD_LEGACY_KEY`) |
| `werewolf.ts` | *no mid-hunt save* | `werewolf.legacy.v1` (`WW_LEGACY_KEY`) |
| `bomber.ts` | *no mid-raid save* | `bomber.legacy.v1` (`BOMBER_LEGACY_KEY`) |

The five action games have **no mid-run save at all** (runs are short), so their only persistence is the
cross-run **legacy** key. Those keys survive "Begin again", and each gains fields **defaulted on load with no
key bump**. They are write-once-per-run-end (fold in exactly once at each genuine end transition). The hub
(`index.html`) keeps only a tiny `lightbringer.lastClass` hint (which class was picked last) — pure
progressive enhancement, safe to ignore. All five games also share the tiny `lightbringer.rival.name` hint —
the signature a player signs duel challenges with (see Rival duels below), prompted once and reused across
the whole family. Beside the five legacies sits **one shared key**, `lightbringer.covenant.v1`
(`COVENANT_KEY` in `covenant.ts`) — the cross-game Covenant, below.

### The Covenant of Five — the cross-game meta-layer (`covenant.ts`)

`covenant.ts` (→ `covenant.js`) is the **one shared ES module** in the family: all five games import it
(`import { … } from "./covenant.js"`), and the hub loads it with a dynamic `import()` in a
`<script type="module">`. It is pure data + localStorage — **no DOM ever** — so the headless tests drive it
directly. It gives the five siloed games a reason to be one product:

- **Echoes** — each game calls `recordEcho(nature, won, score)` exactly once per genuine run-end, in the
  shell beside its own `record*` pair (`onWin`/`onLost`). The covenant folds `runs`/`victories`/`bestScore`
  per nature (`NATURES` = `["vigil","necro","watcher","werewolf","bomber"]`, matching the hub's
  `data-class` ids).
- **Boons** — at `buildArena` each game reads `boonStrength(loadCovenant(), <nature>)` = victories won as
  the **other four** natures, capped at `BOON_CAP` (10), and bakes its own idiom in (the strength lands on
  `s.boon`): Vigil **+2 max HP**/point (`COVENANT_HP_PER_BOON`), Necro **+1 starting soul per 3** points
  (`COVENANT_SOULS_PER`), Watcher **+2 max sanity**/point (`COVENANT_SANITY_PER_BOON`), Werewolf **+3%
  starting fury**/point (`COVENANT_FURY_PER_BOON` — capped well below the crest, it can never turn the beast
  alone), Bomber **+2 airframe HP**/point after the airframe's `hpMul` (`COVENANT_HP_PER_BOON`). Deliberately
  small: a head start, never a carry. If a game's dial moves, keep `BOON_HINTS` (the hub's prose) in step.
- **The Fivefold Crown** — a victory in a nature not yet counted this cycle advances `crown.done`; the fifth
  distinct nature **forges a crown**: `crowns++`, the cycle resets, and `CROWN_BOUNTY` (80) of **every**
  game's own currency is banked in `crown.bounty`. Each game's `showPicker` calls `claimBounty(<nature>)`
  first thing and folds the amount into its legacy currency — claiming zeroes the covenant side, so the
  transfer happens exactly once. Win screens surface `echo.crowned` / `echo.firstOfCycle` as a score row;
  pickers show a "The Covenant of Five" block via `covenantLine` (empty — hence invisible — until the player
  has victories elsewhere or a bounty due, so a one-game player never sees the meta-layer).
- **The hub panel** — `index.html` renders the whole profile (crown cycle dots, per-nature victories +
  currency read straight from the five legacy keys, boon strengths via `BOON_HINTS`, waiting bounties) plus
  a **Share your covenant** button (`navigator.share` → clipboard fallback). Pure progressive enhancement:
  the section stays `hidden` until echoes exist, and every failure path leaves the hub untouched.
- **Discipline** — one key, defaulted + validated on load with **no version bump** (`loadCovenant` clamps
  every field; a corrupt blob falls back to empty), every storage access behind try/catch, write-once folds.
  The covenant helpers are re-exported through every game's test seam; `tools/pentagram-test.mjs` carries the
  core suite (fold/boon/cap/crown/bounty/validation), each sibling suite asserts its own boon idiom.
- **Shipping** — `covenant.js` is a **shell asset** in `sw.js` (`ASSETS` + `isShell`, network-first): bump
  `CACHE` whenever its bytes change, exactly like the game modules.

### Rival duels — zero-backend async challenges (ALL FIVE games)

The family's first **multiplayer-shaped** feature, shipped with **no server**: any finished run can be folded
into a compact **URL token** and sent to a rival, whose game rebuilds the **identical arena** and races them
against the sender's **kill-pace echo**. The link IS the duel. Each game carries a verbatim-mirrored block
(same function names, same shapes — only `GAME_TAG` and flavor text differ), so a fix in one should usually
be ported to all five:

- **Seeded generation.** All *generation-path* randomness goes through a module-level `rnd` hook
  (`let rnd = Math.random`); `buildArena(level, …, seed?)` swaps in `mulberry32(arenaSeed)` for the build and
  restores `Math.random` before returning, so live-sim rolls (drops, AI jitter) stay truly random. An
  unseeded run draws a fresh seed anyway and keeps it on `s.seed` — **any run can become a challenge after
  the fact**. Shuffles use a Fisher–Yates `shuffle()` over `rnd()` (never `sort(() => random - 0.5)`, which
  leans on engine sort internals a cross-device seed can't afford). Each `*-test.mjs` asserts same-seed →
  identical arena fingerprint on both the fairest and the richest level.
- **The echo.** Each game's centralized kill path (`killShade` / `killKnight` / `banish` / `slay` /
  `destroyTarget`) pushes `s.elapsed` onto `s.killTimes`. A duel token carries the timeline delta-encoded in
  deciseconds; `rivalKillsAt(rival, elapsed)` paces it, and the HUD appends `⚔ <name> <count>` (✓/✝ once the
  rival's clock is out) to the foes readout when `s.rival` is set.
- **The token.** `DuelRun` { name, level, seed, weapon, result, ms, score, kills } ⇄ `encodeDuel`/`decodeDuel`
  (JSON → base64url, `?duel=<token>` on the game's own URL). Decode is **strict**: wrong version, wrong
  `GAME_TAG`, unknown level id, or malformed numbers ⇒ `null` (a bad link boots the normal title screen).
  Names are sanitized on decode (`sanitizeName`) because they land in overlay HTML.
- **The verdict.** `duelVerdict(mine, rival)` never reads `score` (it bends with shop unlocks): a win beats a
  loss; two wins race the clock; two losses compare kills, then survival time. The end screens render the
  verdict panel and always offer "⚔ Challenge a rival with this run" (`duelPanelHtml`/`wireDuelShare`,
  `shareDuelLink` mirrors `shareGameLink`'s share-sheet → clipboard → toast ladder). In the Vigil a duel pins
  **ascension 0** and acts as a guest pass into a not-yet-unlocked city (the legacy's own unlocks untouched).
- **Test seam**: `encodeDuel, decodeDuel, duelVerdict, rivalKillsAt, sanitizeName, mulberry32, GAME_TAG` are
  exported on each game's test object; `buildArena` takes the seed as its last parameter.

### Service worker cache versioning

`sw.js` is the offline app-shell cache for the **class-select hub and all five games**, with an explicit
`ASSETS` list and a `CACHE` version string (currently `lightbringer-v119`). It is **network-first for the
shells** (`isShell`: `/`, `index.html`, `covenant.js`, `pentagram.html`, `pentagram.js`, `necro.html`, `necro.js`,
`eldritch.html`, `eldritch.js`, `werewolf.html`, `werewolf.js`, `bomber.html`, `bomber.js`) so the freshest code always wins online, and **cache-first** for the heavy, slow-changing
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
- **Solid structures** (`OBSTACLE_KINDS` = press, shrine, **obelisk**, **bonfire**, **pillar**, **statue**,
  **barrow**; radii in `OBSTACLE_RADIUS`) block movement via `pushOut` (hero and shades) **and** bolts
  (`stepBolts`). Dwellings/conduits/fonts and the new passable terrain stay passable.
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
- **The expanded vocabulary (the maps' expansion).** Thirteen new node kinds + one drifting field, all
  default-off `LevelDef` count dials (e.g. `cinderCount`, `mistCount`), woven in `generateCity`/`buildArena`,
  pure and never persisted. **Four obstacles** (solids, above): **bonfire** (also a permanent ally emitter —
  see below), **pillar**/**statue**/**barrow** (small/medium/broad cover). **Ten terrain types:**
  - **Bonfires** (`BONFIRE_AURA`/`BONFIRE_DPS`) & **lanterns** (`LANTERN_*`, passable) — permanent ally
    emitters; `stepFields` burns shades in their aura continuously (charge-independent, the scorch ethos).
  - **Cinder-ground** (`CINDER_*`, `stepFields`) — burns shades that cross it; the hero walks it unharmed.
  - **Mires** (`MIRE_*`) slow **every** body; **thickets** (`THICKET_*`) slow **only shades** — both via
    `terrainSpeedMul(s, x, y, isShade)`, read in `stepCombat` (hero) and `stepShades` (shades).
  - **Hallows** (`HALLOW_AURA`, `inHallow`) — consecrated tiles: inscribe **while moving** (like a font)
    **and** on veiled/scarred ground (like a shrine).
  - **Springs** (`SPRING_*`, `inNodeAura`) — slowly mend the hero in `stepCombat`, gated by `HEAL_CAP`.
  - **Vents** (`VENT_*`, `stepVents`, `node.ventAt`) — erupt a burst on a cadence, burning unshielded shades.
  - **Gusts** (`GUST_*`) — shove shades out of the aura each frame (hero unmoved), applied in `stepShades`.
  - **Caches** (`CACHE_REACH`, `stepCaches`) — first-footing one grants the mote **surge** once, then `n.spent`.
  - **Mist** (`Mist`, `s.mists`, `MIST_*`, `weaveMists`/`stepMists`/`inMist`) — drifting fog (the only new
    non-node field): a hero inside is hidden from spitters (hold fire) and rouses wanderers from a shrunken
    aggro range (`MIST_AGGRO_MUL`).
  - **Groves** (`GROVE_AURA`/`GROVE_AGGRO_MUL`, `inGrove`) — **concealing cover**, the static cousin of mist
    and the maps' tactical heart: a hero under a copse's canopy is hidden from spitters **and** dulls the
    host's aggro (the most-concealing cover wins, in `stepShades`). Seeded in every city (`groveCount`).
    New kinds render procedurally (`renderNewTerrain`, trees drawn via a `tree()` helper; solids draw their
    body at the **collision radius** so visual == hitbox); no PNGs ship yet.
- **Frescoes & the reliquary** — the hero's *first-footing* (`FRESCO_REACH`, `node.seen`) reveals painted
  fragments (`maybeFresco`; the shell's `revealFresco` shows them non-modally so the swarm is never paused).
  Frescoes are a lifetime collection: `PgLegacy.frescoesFound`, folded in at each run-end by
  `recordFrescoes`; each `LevelDef` carries a signature subset `frescoes?: number[]` that **partition all
  indices across the cities** (asserted in the test), and completing a city's subset banks `FRESCO_SET_BONUS`
  embers. The reliquary is its own overlay (`showReliquary` → `frescoGalleryHtml`, per-city thumbnails;
  `showFresco` detail view) with **PNG sharing** (`shareReliquary`/`shareFresco` → `shareCanvas`, native
  share sheet or download). Render-layer only, drawn from already-cached fresco jpgs — no new assets.

### Cities (eleven) and per-city dials

`LEVELS` now holds **eleven** cities — the original seven plus the **Edge-Lands** expansion (the dark, broken
at the Bastion, fleeing to the city's outlying quarters): **The Old City**, **Ashfold**, **The Drowned
Quarter**, **The Glassworks**, **Vesper Row**, **The Ember Foundry**, **The Pale Bastion**, then **The
Emberwood** (cinder/thicket/bonfire/barrow), **The Mistmarket** (mire/mist/spring/statue), **Windward
Heights** (gust/hallow/pillar/vent/cache), and **The Last Vigil** (the culmination — the whole vocabulary at
once). Each `LevelDef` adds Vigil-specific dials on top of the parent's generation overrides:
`fenceCount`/`pathwayCount`, `fontCount`/`obeliskCount`, `veilCount`, the variant counts
(`eliteCount`/`spitterCount`/`darterCount`/`healerCount`), the **new terrain/obstacle counts** (see above),
plus `sizeScale` (arena size = `W/H × sizeScale`, which leans difficulty — `difficultyMult` is normalized so
The Old City sits near 1.0 and the hardest near 1.5–1.6, capped) and the `frescoes` subset (the four new
cities leave it undefined, falling back to the global pool, so the original seven still partition all
indices). The Old City is kept deliberately fair (no veils/elites). The eleven are one journey told in order
(`cityUnlocked`, each `story` naming the next); Cities may re-skin the built world via
`spriteFor`/`loadCitySprites` (`art/<cityId>/<name>.png`, silent fallback to the base).

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
fallbacks), so the game is **fully playable with zero gameplay PNGs** — and it currently ships that way:
**no gameplay PNG art of its own has shipped yet**, so the shell
(`eldritch.html`/`eldritch.js`/`eldritch.webmanifest`) is in `sw.js` `ASSETS` (network-first). Its **PWA
icons DO ship**, though — a glowing Elder Sign over the threshold generated zero-dep by
`tools/gen-eld-icons.mjs` (`icons/eldritch-icon-{192,512,180}.png` + maskable), listed in `sw.js` `ASSETS`.
When the Watcher/host/ward sprites ship, add them to `ASSETS` **and** bump `CACHE`. Sprite resolution
mirrors the siblings (`spriteFor`/`loadSprites`/`loadCitySprites`).

Shipping rules: `eldritch.html`/`eldritch.js`/`eldritch.webmanifest` are in `sw.js` `ASSETS` as shell
(network-first); bump `CACHE` when their bytes change.

---

## The Moon's Hunger — the werewolf spinoff (`werewolf.ts` / `werewolf.html`)

`werewolf.ts` (→ `werewolf.js`) + `werewolf.html` are a fifth action spinoff, set in a misty, fog-bound
**13th-century Britain** of thatch villages and standing stones. **It deliberately BREAKS the siblings'
shared "you ARE the weapon, stand still → AoE sigil" core** — it is a **predator chase** instead, the one
thing only a werewolf game would do. You walk a cursed soul through a sleeping village; when the moon swells
you **turn beast** and **run the watch down**. Clear the finite watch (`greenCount × FOE_PER_GREEN` + seeded
variants) to **claim the village** and win. Like its siblings it is a TS module (`export {};`,
`<script type="module">`), real-time per-frame (`stepHunt(s, dt, move)`), with the pure-sim/read-only-render
split and a test seam (`globalThis.__WW_TEST__` → `globalThis.__ww`, driven by `tools/werewolf-test.mjs`).
The whole loop is **pure joystick — there is no attack button**; the maul and the pounce both fall out of
where and how fast you steer (the locomotion the redesign kept).

### The defining twist — the MOON (a living day/night cycle that drives your FORM)

Nothing else in the repo has this. A hunt runs a continuous **day/night wheel**: `s.moon` (0..1) advances
every frame (`MOON_CYCLE_MS`); `daylight(moon)` is 1 at noon (moon 0/1) and 0 at midnight (0.5), and
`moonlightOf` is its inverse. The moon drives **Fury** (`hero.fury`, the curse-meter, the second bar), and
fury drives the **Form** (`hero.form`: `"human" | "wolf"`):
- As a **MAN** you cannot fight — frail, hunted, but able to **stalk unseen** (a calm/slow man radiates no
  alarm; see the watch below). Standing still **bays at the moon**: fury swells, fast under moonlight
  (`FURY_RISE_MS`, scaled by `moonlightOf`, ×1.85 while still), a crawl by daylight. At the crest you **turn
  beast** (`form → "wolf"`).
- As the **WOLF** you are the predator, and faster. Fury **bleeds** over time (`FURY_DRAIN_MS`, faster by
  daylight), so you must **feed** to hold the change — every kill stokes fury (`FURY_PER_KILL`) and mends a
  little (`KILL_HEAL`). Spent to nothing, you turn back to a man. The rhythm: **night is your hour to
  rampage; by day you are prey.**

HP is the only loss bar (lose your blood → `"lost"`); the moon/fury layer is the form gate, not a death.

### The wolf's weapon — MOMENTUM, the maul & the pounce (WOLF-only, pure joystick)

**The predator's weapon is motion — there is no stand-and-channel verb, and no attack button.** The wolf
builds **`hero.momentum`** (0..1) while it runs near top speed (`MOMENTUM_RISE_MS`, ×`speed/HERO_SPEED_WOLF`)
and bleeds it when it slows (`MOMENTUM_DECAY_MS`); a **moonwell/glade holds it** even at a standstill, and a
man carries none. `stepMaul` is the whole weapon (only while a WOLF — the gate that makes the form matter):
- **The maul** — a contact bite. On the `BITE_CD` cadence it rends the nearest foe in
  `HERO_RADIUS+FOE_RADIUS+MAUL_REACH` via **`bite(s,e)`** (the deterministic heart, the single-target inverse
  of the siblings' AoE pulse): damage `MAUL_DMG × (MAUL_MIN_MUL..1 by momentum) × pelt.dmgMul`, a knockback,
  and a **den claim** if a dark cairn is within `CAIRN_MARK_REACH`.
- **The pounce** — at `POUNCE_AT` momentum, if prey sits in a **frontal cone** (`frontalFoe`, `POUNCE_RANGE`/
  `POUNCE_ARC` of `hero.facing`) the wolf auto-**lunges**: a brief locked dash (`hero.lunge`/`lungeVx`/`lungeVy`,
  `POUNCE_MS`/`POUNCE_SPEED`, overriding joystick velocity in `stepHunt`) that lands a heavy bite
  (`POUNCE_DMG_MUL`), then `POUNCE_CD`/`POUNCE_SPEND`. The signature straggler-kill, all from your heading.

### Pelts — the weapon shop (`PELT_TYPES`, moonstones)

The hero dons **one** pelt per hunt (`s.pelt`, resolved from the legacy at build via `peltTypeById`), bought
with **moonstones** (the currency, mirror of the Vigil's embers / Necro's relics / the Watcher's lore). Four:
**The Grey Pelt** (`grey`, free, balanced), **The Dire Pelt** (`dire`, power `frenzy` — a kill leaps to the
next foe), **The Fell Pelt** (`fell`, power `moonblood` — each kill stokes extra fury, the fury pelt), and
**The Black Pelt** (`black`, power `terror` — every **bite** flings its prey). Each carries
`radiusMul` (maul reach & pounce range) / `chargeMul` (momentum-rise time) / `pulseMul` (bite cadence) /
`dmgMul` + a `PeltPower` (`"none"|"frenzy"|"moonblood"|"terror"`). `unlockPelt`/`equipPelt` buy and equip;
ids live in `WwLegacy` (`unlocked`/`equipped`, defaulted on load).

### The watch — PREY that flee/flock & HUNTERS that converge (the inverted AI)

The watch is split by role (`isPrey`). **Prey** — the common **villager** and the **hound** (fast, frail) —
do **not** hunt the wolf: they **flee** it and **flock** (`separate` + `cohesion`, so they break into a
herd), only **flailing** (`FOE_CONTACT`/`HOUND_CONTACT`) when a wolf is on top of a cornered one. The danger
is **ALARM** (`Foe.alarm`, 0..1): each frame it radiates from the hero's **conspicuousness** (a wolf reads
loud, `ALARM_RADIATE_WOLF`; a man only while **sprinting** past `MAN_SPRINT_SPEED`; **muffled** in mist/woods,
`ALARM_MUFFLE_MUL`), **spreads** prey→prey (`ALARM_SPREAD_R`/`_RATE`, two-phase so it's order-free), and
**decays** (`ALARM_DECAY`); a kill spikes nearby prey to full (`ALARM_KILL_SPIKE_R`, in `slay`). When the
**village average** (`villagePanic`) crosses `ALARM_ROUSE`, the armed **HUNTERS** converge: **knight** (slow,
plated, heavy melee), **huntsman** (the only projectile — never melees; standoff + **dodgeable silver
bolts**, `stepBolts`/`HUNTSMAN_SHOOT_CD`; every shot is **telegraphed** — a `BOLT_AIM_MS` aim wind-up
(`Foe.aimUntil`, drawn as a sharpening red sight-line) during which it plants its feet, and **breaking its
sight mid-aim spoils the shot**; a **wall** stops a bolt & makes it hold fire, **mist/woods hide the
hero**), and **friar** (the anti-werewolf — never melees; **consecration** that **bleeds fury** at range with
LoS; break LoS behind a wall, hide, or close and rend it). Hunters are **sticky** once roused; their
proximity-wake shrinks for a muffled/human hero (`STEALTH_AGGRO_MUL`). **Stealth as a man falls out for
free** — a calm man radiates nothing, so prey ignore him and the hunters sleep. The strategic core: **cull
the quiet and the isolated; a botched spook raises the alarm and brings the hunters.**

### Terrain — and two werewolf-specific innovations

All pure, rebuilt at `buildArena`, never persisted: **stones & cottages** (solids, block bodies via
`pushOut`), **cairns = the wolf's DENS** (claim one by making a **kill beside it** — `markCairn` fires from
`bite`; its aura grants fury + **momentum**, rends the host, AND **panics prey** outward, `stepCairns`/
`CAIRN_PANIC_PER_SEC`/`CAIRN_SHOVE` — a herding tool; a **hunter** brushing it cleanses it, scar bars
re-claiming via `nearScar`), **hedgerows** (`weaveSegments`, block bodies *and* stop bolts / break LoS),
**lanes** (`PATH_BOOST`, speed the hero & feed momentum). The two innovations make the day/night twist
spatial and atmospheric:
- **Moonwells** (`inMoonwell`, `MOONWELL_AURA`) — pools where the moon always reaches: fury swells at the
  **night rate whatever the hour**, AND the wolf's **momentum never bleeds** inside — the wolf's foothold
  against the day (it can wheel and stalk without going cold).
- **Mist** (drifting fog banks, `stepMists`/`inMist`) — the misty Britain made mechanical and the wolf's
  cover: inside a bank a huntsman can't see you (holds fire), the hero radiates far less alarm, and the watch
  is slower to rouse.

**The expanded vocabulary (the maps' expansion).** Fourteen new node kinds, all default-off `LevelDef` count
dials (e.g. `bogCount`, `geyserCount`), carved in `generateWerewolf`, pure and never persisted. **Four
obstacles** (solids in `OBSTACLE_KINDS`): **pyre** (also a permanent foe-emitter), **dolmen**/**gibbet**/
**cart** (broad/medium/small cover). **Ten terrain types:**
- **Pyres** (`PYRE_*`) & **corpse-candles/wisps** (`WISP_*`, passable) — permanent hazards; `stepFields`
  burns the watch in their auras continuously (the cairn-emitter ethos, ever-on).
- **Marsh-fire** (`MARSHFIRE_*`, `stepFields`) — burns the watch that crosses it; the hero wades it unharmed.
- **Bog** (`BOG_*`) slows **every** body; **bramble** (`BRAMBLE_*`) slows **only the watch** — both via
  `terrainSpeedMul(s, x, y, isFoe)`, read in `stepHunt` (hero) and `moveBody` (foes).
- **Glades** (`GLADE_AURA`, `inGlade`) — a lesser moonwell: moonlit footing that **holds the wolf's
  momentum** at a standstill and swells fury at the night rate.
- **Springs** (`SPRING_*`, `inNodeAura`) — slowly mend the hero in `stepHunt`, gated by `SPRING_HEAL_CAP`.
- **Geysers** (`GEYSER_*`, `stepGeysers`, `node.geyserAt`) — erupt a scalding burst on a cadence.
- **Gales** (`GALE_*`, `stepGale`) — shove the watch out of the aura each frame (the hero is unmoved).
- **Wolfsbane** (`WOLFSBANE_*`) — the one hazard to the hero: **bleeds his fury** while he stands in it
  (the friar's drain, made ground — it can tip a wolf back to a man).
- **Woods** (`WOODS_AURA`, `inWoods`) — **concealing cover**, the static cousin of mist and the most thematic
  terrain of the hunt: the wolf melts into the trees — huntsmen hold fire (no line through the boughs), the
  hero radiates far less alarm, and the watch is slower to rouse (`muffled`/`STEALTH_AGGRO_MUL` in `stepFoes`).
  Seeded in every village (`woodsCount`).
- (Plus **barrow-hoards** — `HOARD_*`/`stepHoards`: first-footing one **surges the curse** once, then
  `n.spent`; the Vigil's relic-cache re-themed.) New kinds render procedurally (`renderNewTerrain`, trees via
  a `tree()` helper; solids draw their body at the **collision radius** so visual == hitbox); no PNGs.

### Villages (eight) & sim loop

`LEVELS` holds **eight** villages — the original four plus the **Outlands** expansion (villages beyond the
dale, carrying the new terrain): **Thornwick** (fair first), **Greymoor** (moor; hounds & huntsmen),
**Hollowby** (walled market town; knights, friars, the abbey), **Wulfmere** (drowned fen), then **Ashthorn**
(pyre/marsh-fire/bramble), **Mirefen** (bog/wolfsbane/spring), **Galehead** (gale/glade/geyser/hoard), and
**Direhollow** (the last hollow — the whole vocabulary). Werewolf villages don't chain narratively (no
`story` field / unlock gate, unlike the Vigil) — just an `epigraph` each. Each `LevelDef` carries
`stoneCount`/`cottageCount`/`cairnCount`/`moonwellCount`, `greenCount`/`greenSpacing`,
`wallCount`/`pathCount`/`mistCount`, the variant counts
(`houndCount`/`knightCount`/`huntsmanCount`/`friarCount`), the **new terrain/obstacle counts** (above), and
`sizeScale`. `stepHunt` advances the moon, integrates the hero (with the pounce-lunge velocity override),
updates **momentum** & **facing**, resolves the form, runs `stepQuarry → stepMaul → stepFoes → stepBolts →
stepCairns → stepFields → stepGeysers → stepGale → stepMists → stepMotes → stepHoards`, then checks terminal
states (`hero.hp ≤ 0` → `"lost"`; all foes dead → `"won"`). Helpers mirror the siblings (`bite`/`slay`/`hurtFoe`/
`nearestFoe`/`frontalFoe`, `isPrey`/`villagePanic`, `aliveFoes`/`clearedPct`/`furyReadout`, `scoreRun`,
`difficultyMult`). **Blood-motes** (`stepMotes`) are the fury economy's heartbeat: a felled foe may drop one;
gathering it stokes the curse. **The Night's Quarry** (`stepQuarry`, `s.quarry`/`s.quarryNight`/`s.quarrySlain`)
is the moon's own bounty-board: each **true night** (daylight below `QUARRY_NIGHT_DL`) the moon **marks one
living soul** of the watch (a hunter while any stands, else a prey — `pickQuarry`), drawn with a pulsing gold
halo + crescent (and a gold ring on the minimap). **Run the quarry down before dawn** and `slay` pays the
**blood-price** (`QUARRY_FURY` fury, `QUARRY_HEAL`, a full head of wolf momentum, and `SCORE_QUARRY` per claim
in `scoreRun`); at dawn an unclaimed mark fades. One mark per night, no new input — every night gets a
direction without breaking the pure-joystick loop.

### Persistence & art

No mid-hunt save. The legacy is `werewolf.legacy.v1` (`WwLegacy`: `runs`, `hunts`, `best` per village,
`cairnsMarked`, `slain`, `moonstones`, `unlocked`, `equipped` — new fields defaulted on load with **no key
bump**), via `loadWwLegacy`/`saveWwLegacy`/`emptyWwLegacy` and the write-once-per-end `recordHunt`/
`recordFall`. Every sprite has a **procedural SVG fallback** (`scenerySprite`, `pentagramPath` — here a
blood-moon claw sigil, the render fallbacks: the man, the beast, the watch, the cairns/moonwells/cottages), so
the game is **fully playable with zero gameplay PNGs** — and it currently ships that way: **no gameplay PNG
art of its own has shipped yet**. Sound is likewise zero-dep: a **WebAudio synth** (`sfx`, `voice`/`noiseBurst`)
lives shell-side only — the frame loop **diffs observable sim state** across `stepHunt` and fires the matching
gesture, so the pure sim never touches audio and the headless tests never do either; the mute toggle persists
in the tiny `werewolf.sound` hint key (not the legacy). Its **PWA icons DO ship**, though — a blood-clawed full moon generated
zero-dep by `tools/gen-ww-icons.mjs` (`icons/werewolf-icon-{192,512,180}.png` + maskable), listed in `sw.js`
`ASSETS`. When the man/beast/watch sprites ship, add them to `ASSETS` **and** bump `CACHE`. Sprite resolution
mirrors the siblings (`spriteFor`/`loadSprites`/`loadCitySprites`).

Shipping rules: `werewolf.html`/`werewolf.js`/`werewolf.webmanifest` and the `icons/werewolf-*.png` are in
`sw.js` `ASSETS` (shell network-first, icons cache-first); bump `CACHE` when their bytes change.

---

## The Iron Rain — the WW2 bomber spinoff (`bomber.ts` / `bomber.html`)

`bomber.ts` (→ `bomber.js`) + `bomber.html` are a sixth action spinoff, set under the **leaden skies of a
world war**. Where the siblings walk the ground, this one **flies**: you captain a heavy bomber over
defended country and must **silence every target** — the static **works** (`Structure`: factory / depot /
hardened **pens** / **airfield**) and the moving **army columns** (`Column`, patrolling between waypoints) —
to complete the raid; lose your airframe (`hero.hp`) and you go down. Like its siblings it is a TS module
(`export {};`, `<script type="module">`), real-time per-frame (`stepRaid(s, dt, move)`), with the
pure-sim/read-only-render split and a test seam (`globalThis.__BOMBER_TEST__` → `globalThis.__bomber`,
driven by `tools/bomber-test.mjs`).

### The defining twist — a hero that can NEVER STOP, and the BOMB RUN

Nothing else in the repo has this. The bomber has `heading`/`speed` and **always flies**: the joystick
steers the nose (`TURN_RATE`) and opens the throttle (`SPEED_CRUISE`..`SPEED_MAX`); **no input means cruise,
straight on**. The family's stand-still verb is therefore inverted into the **bomb run**: holding a
**straight and level course** (angular velocity under `STEADY_TURN`) arms the **bombsight** (`hero.charge`
ramps over `SIGHT_CHARGE_MS`); a hard turn bleeds it, and **cloud blinds it** outright. Once armed past
`SIGHT_ARM_AT`, `stepSight` releases bombs on a cadence (`BOMB_CD_MS`) — each is laid `BOMB_CARRY` ahead of
the nose, falls `BOMB_FALL_MS` (telegraphed), then `burstBomb` deals AoE `BOMB_DMG` to every work, column
and battery in reach. **Overcharge** mirrors the siblings': hold the run *past* a full arm to bank one
(`SIGHT_OVERCHARGE_MS`); the next release is a **blockbuster** (`MASTER_RADIUS_MUL`/`MASTER_DMG_MUL`), and
any hard turn spends the bank.

### The counter-pressure — FLAK that leads a straight run, and the ALERT

The flak (`FlakGun`, `stepFlak`) is why the run is a *choice*: a battery with the (un-hidden) bomber in
`FLAK_RANGE` lays a shell at the bomber's **predicted position** (velocity-led over `FLAK_FUSE_MS`, plus
`FLAK_SCATTER`); the shell is **telegraphed** the whole fuse (a sharpening red reticle), then bursts
(`FLAK_BURST_R`/`FLAK_DMG`) — **indiscriminately** (any plane, either side, caught inside is hit too). Fly
straight and the lead is perfect; jink and it bursts behind you — the exact counter-pressure on what the
bombsight demands. Batteries are **bombable** (`hurtFlak`, `s.flakDown` — a secondary objective, scored) but
not part of the win gate. **ALERT** (`s.alert`, 0..1) is the defence's temper: every burst raises it
(`ALERT_PER_BURST`), time bleeds it (`ALERT_DECAY`); high alert quickens the flak (`ALERT_FLAK_HASTE`) and
stretches the fighters' scramble radius (`ALERT_SCRAMBLE_MUL`) — so a raid breathes: strike, slip away, let
the guns settle.

### The air war — squadrons, airfields, and YOUR OWN ESCORTS

One roster (`s.planes`, `Plane.axis` splits the sides), run by `stepPlanes`. Each **airfield** holds a
grounded squadron (`FIGHTER_PER_FIELD`, `state: "base"`) that **scrambles** when the un-hidden bomber comes
inside its alert-stretched radar reach (`SCRAMBLE_RANGE`) — or **burns on the ground** if you bomb the field
first (`destroyTarget` kills its `state: "base"` planes; a fighter already aloft survives). A flying axis
fighter runs the bomber down and fires in bursts (`FIGHTER_RANGE`/`FIGHTER_CD`/`FIGHTER_DMG`, i-framed) —
unless an **escort** within `FIGHTER_TANGLE_R` pulls it off. The bomber answers with its own **shooting
posts** — three defensive gun turrets (`Hero.posts`: a forward **nose** gun, an all-round **dorsal** turret,
a rearward **tail** gun) built in `buildArena`. Each bears on its own sector of the sky
(`Post.mount`/`sector`/`arc`) and, on `TURRET_CD`, `stepPosts` rakes the nearest flying axis fighter within
`TURRET_RANGE` **and** its arc for `TURRET_DMG` (a tracer from the muzzle to its mark) — so the bomber can
shoot the interceptors down itself, not merely outfly them. Universal defensive fire, distinct from the
Fortress's stronger continuous `gunners` rake. **Escorts** (the horde inverted into a wing)
hold a formation ring (`ESCORT_FORM_R`) around the bomber and peel off to engage any axis fighter within
`ESCORT_ENGAGE_R` of the fray. A downed axis fighter may leave a **supply chute** (`CHUTE_DROP_CHANCE`,
`stepChutes`) — catch it to patch the airframe (`PATCH_HEAL`, the mote analog). Bringing escorts home pays
(`SCORE_ESCORT_MAX`). Damage paths are centralized like the siblings': `hurtTarget`/`destroyTarget`,
`hurtFlak`, `hurtBomber` (i-framed), `hurtPlane`/`downPlane`.

### Terrain of the sky

All pure, rebuilt at `buildArena`, never persisted. **Barrage balloons** are the sky's only solids
(`BALLOON_RADIUS`, `pushOut` — nothing on the ground blocks a plane). **Clouds** (`Cloud`, `stepClouds`,
`inCloud`) are the mist analog with a real trade: inside one the bomber is **hidden** (flak can't lay on
it, fighters hold fire and won't scramble to it) but the sight is **blind** (charge bleeds). **Streams**
(`weaveSegments`, `STREAM_HALF`/`STREAM_BOOST`) are tailwind lanes that speed the bomber (the paths analog).
The cosmetic country — fields, woods, **towns (spared, never bombable)**, rivers — is scenery only.

### Airframes — the weapon shop (`BOMBER_TYPES`, medals)

The captain flies **one** airframe per raid (`s.loadout`, resolved from the legacy at build via
`bomberTypeById`), bought with **medals** (the currency mirror of embers/relics/lore/moonstones). Four:
**The Lancaster** (`lanc`, free, balanced), **The Fortress** (`fortress`, power `gunners` — turret gunners
rake any fighter within `GUNNER_R`; slow, heavy, `hpMul` 1.5), **The Mosquito** (`mosquito`, power
`evasive` — the flak's scatter doubles against it; fast, frail, quick sight), and **The Firestorm**
(`firestorm`, power `incendiary` — every burst leaves burning ground, `stepFires`, that gnaws ground targets
in `FIRE_R`). Each carries `radiusMul`/`chargeMul`/`pulseMul`/`dmgMul` **plus** `speedMul`/`hpMul` + a
`BomberPower` (`"none"|"gunners"|"evasive"|"incendiary"`). `unlockBomber`/`equipBomber` buy and equip; ids
live in `BomberLegacy` (`unlocked`/`equipped`, defaulted on load).

### Theatres (four) & sim loop

`LEVELS`: **The Channel Coast** (fair first raid), **The Marshalling Yards**, **The U-Boat Pens** (hardened
pens + thick balloons), **The Ruhr Valley** (hardest — flak alley). Dials: `sceneryCount`/`minDist`, the
target counts (`factoryCount`/`depotCount`/`pensCount`/`airfieldCount`/`columnCount`), the defence
(`flakCount`/`balloonCount`), the sky (`cloudCount`/`streamCount`), `escortCount`, `sizeScale`. Each carries
a `RaidTheme` (ground/field/wood/town/water hues + haze) so theatres read as distinct country in pure-vector
mode. `stepRaid` integrates the bomber, arms/bleeds the sight, then runs `stepSight → stepBombs →
stepColumns → stepFlak → stepShells → stepPlanes → stepGunners → stepFires → stepChutes → stepClouds`,
decays the alert, and checks terminal states. Helpers mirror the siblings (`aliveTargets`/`clearedPct`/
`escortsAlive`/`raidReadout`, `scoreRun` — base + speed + guns + escorts + survival + untouched ×
`difficultyMult`). The sigil analog is `bombsightPath` (a Norden-style reticle: two rings, gapped
crosshairs, tick marks); every plane renders via `planePath` (a mirrored top-down silhouette) when its
sprite is absent.

### Persistence & art

No mid-raid save. The legacy is `bomber.legacy.v1` (`BomberLegacy`: `runs`, `raids`, `best` per theatre,
`targetsDestroyed`, `fightersDowned`, `medals`, `unlocked`, `equipped` — new fields defaulted on load with
**no key bump**), via `loadBomberLegacy`/`saveBomberLegacy`/`emptyBomberLegacy` and the write-once-per-end
`recordRaid`/`recordDown`. Every sprite has a **procedural SVG fallback** (`planePath`, `bombsightPath`, the
per-kind work marks), so the game is **fully playable with zero gameplay PNGs** — and it currently ships
that way: **no gameplay PNG art of its own has shipped yet**. Its **PWA icons DO ship** — a bomber
silhouette caught in crossing searchlights, generated zero-dep by `tools/gen-bomber-icons.mjs`
(`icons/bomber-icon-{192,512,180}.png` + maskable), listed in `sw.js` `ASSETS`. When the bomber/fighter/
works sprites ship, add them to `ASSETS` **and** bump `CACHE`. Sprite resolution mirrors the siblings
(`spriteFor`/`loadSprites`/`loadCitySprites`).

Shipping rules: `bomber.html`/`bomber.js`/`bomber.webmanifest` and the `icons/bomber-*.png` are in `sw.js`
`ASSETS` (shell network-first, icons cache-first); bump `CACHE` when their bytes change.

## Deploy

`.github/workflows/deploy.yml` runs `npm ci && npm run build` (compiling all five `.ts` → `.js`), prunes
`node_modules`, then publishes the repo root to GitHub Pages on every push to `main` (or manual
`workflow_dispatch`). One-time setup: Settings → Pages → Source: "GitHub Actions". The site **is** the
repository root — there is no `dist/`.
