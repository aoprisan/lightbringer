# The Necromancer's March — a third sibling spinoff

## Context

The Light-Bringer repo already ships two games that share art and code patterns:
the contemplative parent (`app.ts` / `index.html`, code-frozen) and the
action-combat spinoff **The Burning Vigil** (`pentagram.ts` / `pentagram.html`).
This plan adds a **new spinoff that thematically inverts** the parent: instead of
a lightbringer kindling houses, a **necromancer desecrates graves to raise an army
of the dead and overruns a defended village**, fighting the knights who guard it.

Architecturally this fits as a **third self-contained sibling module**
(`necro.ts` / `necro.html`) mirroring `pentagram.ts` exactly — a TS *module*
(ends in `export {};`) so its top-level names (`W`, `render`, `start`, `LEVELS`)
don't collide with the other two scriptless files. It reuses the proven
pure-sim / read-only-render split, the test seam, the floating-joystick shell,
its own legacy key, and the sprite system's procedural fallbacks.

### Confirmed design decisions
- **Core loop:** real-time "commander + auto-fighting army." Move the necromancer
  with a joystick; standing near a **grave** raises 1–3 skeletons (costs *souls*);
  minions follow and auto-target the nearest **knight**; knights defend and fight
  back against both minions and the necromancer.
- **Objective:** *overrun the village* — defeat **all** knights to **win**;
  necromancer HP to 0 = **lose**. Razing **houses** is a secondary objective that
  **heals the horde** (not a win gate) — an inversion of Burning Vigil's lit-dwelling layer.
- **Art:** author a **new undead sprite set** (prompt `.txt` files + new sprite
  names in code). The renderer falls back to procedural SVG when a PNG is absent,
  so the game is **playable before any PNG exists**; artist generates the binaries later.
- **Scope:** focused first playable. **Defer** the boss duel, reliquary/frescoes,
  perks, share-as-PNG, and offline QR.

---

## What to build

### New files
- `necro.ts` → compiled `necro.js` (git-ignored build artifact — never edit `.js`)
- `necro.html` — page shell (clone of `pentagram.html`)
- `necro.webmanifest` — PWA manifest (clone of `pentagram.webmanifest`)
- `tools/necro-test.mjs` — headless harness (clone of `tools/pentagram-test.mjs`)
- `gemini-prompts/necro/*.txt` — new undead sprite prompts

### Changed files (wiring only)
- `tsconfig.json` — add `"necro.ts"` to `include`
- `package.json` — append `&& node tools/necro-test.mjs` to the `test` script
- `sw.js` — bump `CACHE` (`lightbringer-v72` → `v73`); add 3 shell assets; extend `isShell()`
- `index.html` + `pentagram.html` — header cross-link to `necro.html`
- (Deploy needs **no change** — `tsc` + repo-root publish picks up `necro.js` automatically)

---

## `necro.ts` structure (mirror `pentagram.ts` section order)

Keep scriptless body + trailing `export {};`. Same labelled sections:
**Types → Tuning → Levels → Arena gen → Simulation → Render → Shell → Legacy → Test seam.**

### Types
- `NodeKind = "house" | "well" | "altar" | "grave"` (grave replaces pentagram's `keeper`).
  Patrol **posts** are a separate placement role for knights (not a node kind).
- `Phase = "march" | "won" | "lost"` (no boss phase).
- `KnightState = "guard" | "engage"`; `MinionState = "follow" | "attack"`.
- `ArenaNode` (mirror pentagram's): house states via `desecrated`/`desecAt`/`risen`
  (razed→totem, the inversion of `lit`/`awoke`), `reconsecrated?: number`
  (knight re-blessed; bars re-desecration — inversion of the snuff scar), grave
  fields `raisesLeft`/`graveSpent`, `spent` for altars.
- `Hero` (the necromancer): `x,y,vx,vy,hp,maxHp,hurt`.
- **`Minion` (NEW):** `x,y,vx,vy,hp,maxHp,dead,state,targetIdx,attackCd,hit,bornAt`.
- `Knight` (mirror `Shade`, inverted role): position, `hp/maxHp/dead`, `state`,
  wander/leash fields, `homeX/homeY`, `attackCd`, `hit`, optional `captain?`/`archer?`.
- FX: **`Raise`** (bone-burst ring on a raise), **`Wisp`** (soul mote a slain knight
  drops, gathered for souls). `Segment` reused for barricades/causeways.
- `NecroState` — see below.

### `NecroState s`
```
level, w, h
scenery[], solids[] (wells+altars), graves[] (cached), barricades[], causeways[]
hero (necromancer), souls (the raise resource)
minions[], knights[]
wisps[], raises[]
elapsed, kills, hits, total (= postCount*KNIGHT_PER_POST),
housesTotal, desecCount, reconsecrated, raisedTotal
phase
```
No boss/penta/seal/scorch/veil state.

### Tuning constants (the design surface — balance = constants)
World `W=1500,H=2000`; necromancer move/HP/i-frames/knockback; **souls economy**
(`SOUL_START`, `RAISE_COST`, `RAISE_MIN/MAX`, `GRAVE_REACH`, `GRAVE_RAISES`,
`GRAVE_COOLDOWN_MS`, `SOUL_PER_KILL`, `WISP_*`); **minions** (`MINION_HP/SPEED/
RADIUS/DMG/ATTACK_CD/ATTACK_REACH/SEP/FOLLOW_DIST/AGGRO/CAP`); **knights**
(`KNIGHT_HP/SPEED/RADIUS/DMG/ATTACK_CD/ATTACK_REACH/SEP`, `KNIGHT_PER_POST=3`,
`AGGRO_RADIUS`, wander/leash, `CLEANUP_AGGRO_FRAC`); obstacles/barricades/causeways
(mirror FENCE/PATHWAY/OBSTACLE); house layer (`DESEC_HEAL`, `HEAL_CAP`,
`HOUSE_RISE_MS`, `TOTEM_RADIUS/DMG`, `RECONSECRATE_*`, `SCAR_RADIUS`); altar burst
(`ALTAR_*`); scoring (`SCORE_PER_KNIGHT` etc., trimmed of embers); `HIT_FLASH_MS`;
`NECRO_LEGACY_KEY = "necromancer.legacy.v1"`. **Drop** all PENTA/SEAL/BOSS/TRACE constants.

### Levels (villages)
`LevelDef` trimmed/renamed from pentagram's: `id,name,epigraph,art?`, `nodeCount`,
`minDist`, `houseFrac`, `wellCount`, `altarCount`, `graveCount`, `postCount`
(the host gate), `postSpacing`, `barricadeCount`, `causewayCount`, optional
`captainCount?`/`archerCount?`, `sizeScale?`. Author **3–4 villages** re-theming the
existing city dials (e.g. Hollowmere, The Tithe Barrows, Saint Auber's Rest).
`art` stays silent-fail and is **not** in sw.js. `levelById(id)` resolves known ids only.

### Arena generation (mirror `generateCity`/`buildArena`)
- `generateNecroVillage(level,w,h)` — Poisson-disc placement; most nodes `house`,
  a `houseFrac` slice plain ground, `wellCount` wells, `altarCount` altars; place
  **patrol posts** spaced by `postSpacing`, then **graves** spaced from posts/each other.
- Reuse verbatim: `clamp`, `closestOnSegment`, `weaveSegments` (barricades + causeways),
  `pushOut` (necromancer + minions + knights; solids = wells/altars, plus barricade segments).
- `buildArena(level): NecroState` — dress village, drop necromancer at `w/2,h/2`,
  raise the **finite host** from each post (`KNIGHT_PER_POST`, role slots),
  `souls=SOUL_START`, empty `minions`, `total=knights.length`, `housesTotal`, `phase:"march"`.
  `freshNecro = buildArena`.

### Simulation (pure, mutate `s` only) — `stepMarch(s,dt,move)` per frame
Order each frame (mirror `stepCombat`, no stand-still mechanic):
1. Integrate necromancer from `move` (causeway speed boost via `closestOnSegment`),
   `pushOut`, decay i-frames.
2. **`stepRaise(s)`** — for each grave within `GRAVE_REACH`, off cooldown, with
   `raisesLeft>0` and `souls>=RAISE_COST` and `minions.length<MINION_CAP`: deduct
   souls, decrement `raisesLeft` (→ `graveSpent`), spawn `RAISE_MIN..MAX` minions,
   push a `Raise` FX, set cooldown. Single raise path.
3. **`stepMinions(s,dt)`** — pick `targetIdx` = nearest live knight in `MINION_AGGRO`
   (or global during cleanup so a march always ends). With a target → `attack`: steer +
   separation, swing `MINION_DMG` on cooldown (`killKnight` at ≤0). No target → `follow`:
   trail necromancer, stop at `MINION_FOLLOW_DIST`. `pushOut`.
4. **`stepKnights(s,dt)`** (inverted `stepShades`) — wander post until necromancer
   **or any minion** in `AGGRO_RADIUS` → `engage`; target nearest threat (necromancer or
   a minion); swing on cooldown — minion takes `hit`/death; necromancer loses HP gated by
   i-frames (`hits++`, knockback). (Archers/`Bolt` optional — defer with boss.)
5. **House layer** — `desecrateHouse(s,n,heal)` (mirror `kindleDwelling`) on minion
   proximity to a standing, non-reconsecrated house: set desecrated, `desecCount++`,
   distribute `DESEC_HEAL` across the horde up to `HEAL_CAP`. `reconsecrateHouse(s,n)`
   (mirror `snuffDwelling`): knight near a desecrated house re-blesses it (`reconsecrated`
   deadline, scar bars re-desecration, `s.reconsecrated++`). `stepHouses(s)`: a house
   desecrated `HOUSE_RISE_MS` matures to a `risen` bone-totem pulsing `TOTEM_DMG` at
   knights in `TOTEM_RADIUS` (fires autonomously — no charge gate). `stepAltar(s)`
   (mirror `stepPress`): one-shot blood-burst when necromancer stands by an altar.
6. **`stepWisps(s,dt)`** (mirror `stepMotes`) — gather underfoot → `souls+=WISP_SOULS`; cull expired.
7. **`killKnight(s,e)`** (mirror `killShade`) — mark dead, `kills++`, `souls+=SOUL_PER_KILL`,
   chance to drop a `Wisp`. Single kill path so every damage source feeds souls identically.
8. Retire spent FX.
9. Terminal: `hp<=0 → "lost"`; else `knights.every(dead) → "won"` (win reached directly, no boss flip).

Helpers mirrored: `aliveKnights`, `clearedPct`, `houseReadout` (HUD "razed n/total · ⚑totems"),
`difficultyMult`, `scoreRun`/`ScoreBreakdown` (trimmed of embers).

### Render (mirror `scaffold`/`render`, read-only)
Wholesale SVG rebuild each frame: ground → causeways → barricades → scenery
(`houseSprite` resolves standing/desecrated/totem/reconsecrated; wells/altars as
solids; reconsecration scar) → soul-wisps → raise-burst FX → knights (HP bars,
role rings, hit-flash) → **minions** (the horde — small bone figures, hit-flash) →
necromancer last with a necrotic aura. **Every sprite has a vector fallback** (the
`key ? spriteImage(...) : el(...)` pattern) so it's playable with zero PNGs. Recolour the
warm `#penta` gradient to a necrotic green/violet `#necro`. Drop `renderBossScene`/`pentagramPath`.
Sprite plumbing (`el`, `SPRITE_NAMES`, `CITY_SPRITES`, `loadSprites`/`loadCitySprites`/
`spriteFor`/`spriteImage`/`tiledSegment`) reused near-verbatim — only the name lists change.

### Game shell (mirror `start`/`pgFrame`)
Reuse camera, floating-joystick + WASD input (**delete the boss-trace pointer branch**),
`showToast`, `repaint`, `hud` (HP + foes-remaining + houses-razed + **souls** stat), `minimap`.
`marchFrame(now)` ≡ `pgFrame`: RAF, dt-clamped, intro-hold toast, `stepMarch`, center camera,
render/hud/minimap, terminal → `onWin`/`onLost` (delete the `onBossRise` branch).
`startCity` with a necro tutorial toast. `showPicker` (village picker) + `showStart`
(title screen: logo + epigraph art + cross-link buttons). Keep `shareGameLink`/`gameUrl`;
**drop** QR + reliquary + perk pickers.

### Legacy / persistence (own key, mirror `PgLegacy`)
`necromancer.legacy.v1`: `runs`, `overruns` (clears), `best: Record<id,ms>`,
`housesRazed`, optional `totemsRaised`. `loadNecroLegacy`/`saveNecroLegacy`/
`recordOverrun` (in `onWin`)/`recordFall` (in `onLost`) — write-once-per-run-end,
new fields defaulted on load. **No mid-march save** (marches are short), so no save-version key.

### Test seam
`globalThis.__NECRO_TEST__` exposes internals on `globalThis.__necro` (sim funcs +
`LEVELS`/`levelById` + legacy funcs + `render`/`scaffold` + a `K` constants bag);
else `start()`. Trailing `export {};`.

---

## Wiring details

- **`tsconfig.json`**: `"include": ["app.ts", "pentagram.ts", "necro.ts"]`
- **`package.json`**: `"test": "tsc && node tools/smoke-test.mjs && node tools/pentagram-test.mjs && node tools/necro-test.mjs"`
- **`sw.js`**:
  - Bump `CACHE` → `"lightbringer-v73"`.
  - Add to `ASSETS` **only** the 3 shell files (next to the pentagram trio):
    `"./necro.html"`, `"./necro.js"`, `"./necro.webmanifest"`.
  - **DO NOT add not-yet-generated necro art PNGs.** `install` uses `cache.addAll(...)`,
    which rejects the **whole** install if any one Request 404s. The art PNGs get added
    (and `CACHE` re-bumped) as a **follow-up** once the artist drops them in `art/`.
    The render's procedural fallback + the loader's success-only `img.onload` mean
    missing PNGs never error at runtime.
  - Extend `isShell(url)` with `|| url.pathname.endsWith("/necro.html") || url.pathname.endsWith("/necro.js")`
    (necro.webmanifest stays cache-first, like pentagram's).
- **`necro.webmanifest`**: clone pentagram's; `start_url: "./necro.html"`, own
  `name`/`short_name`/`description`/`theme_color`, shared icons, `scope: "./"`.
- **Cross-links**: add a `necro.html` header link on `index.html` and `pentagram.html`;
  add back-links to `./index.html?classic` and `./pentagram.html` in `necro.html`.
  **Do not** change `index.html`'s redirect (default landing stays The Burning Vigil);
  the necro entry point is the header link + its own bookmarkable/installable page.

---

## New art prompts + sprite names

Author under `gemini-prompts/necro/` (per-asset convention; outputs to `art/<name>.png`),
same template/style block as existing prompts but **necrotic green / bone-white / cold
violet** instead of candle-gold. `SPRITE_NAMES` + matching prompts:

| sprite name (`art/<name>.png`) | depicts |
|---|---|
| `ground` | graveyard/village ground tile |
| `house-standing` | intact dwelling (inverts `dwelling-dark`) |
| `house-desecrated` | razed/cursed house, green glow (inverts `dwelling-lit`) |
| `house-totem` | bone-totem ally-emitter (inverts `dwelling-awakened`) |
| `house-reconsecrated` | re-blessed house, holy ward (inverts `dwelling-snuffed`/scar) |
| `well` | stone well — solid obstacle |
| `altar` | blood/bone altar — one-shot cascade solid |
| `grave` | open grave/barrow — the raise site (inverts `keeper-node`) |
| `grave-spent` | emptied grave (optional; falls back to `grave`) |
| `knight-guard` | village knight at watch (inverts `keeper-node`) |
| `knight-engage` | charging knight (inverts `keeper-patrol`) |
| `skeleton` | raised minion, readable small (NEW) |
| `necromancer` | hooded commander w/ green soul-staff (inverts `player-lantern`) |
| `barricade` | tiled palisade (inverts `fence`) |
| `causeway` | tiled road (inverts `pathway`) |

`CITY_SPRITES` (village-reskinnable): ground + the 4 house states + well + altar.
Soul-wisps, raise rings, and necromancer aura are **procedural-only** (no PNG).

---

## `tools/necro-test.mjs` — assertion groups

Clone the pentagram harness (`ok`, `run(s,ms,move,slice)`, in-memory `localStorage`,
`globalThis.__NECRO_TEST__`, import `../necro.js`, read `__necro`). Cover:
1. Villages defined (≥3, unique ids, `levelById` known-only).
2. Arena gen (graves + posts present; `total === livePosts*KNIGHT_PER_POST`; necromancer
   centered at full HP, `"march"`, `souls===SOUL_START`, minions empty).
3. Raising from graves (souls drop by `RAISE_COST`, 1–3 minions, `raisesLeft--`; spent
   grave/no-souls/`MINION_CAP` no-ops).
4. Minion auto-target (flips to `attack`, closes distance, deals dmg; else `follow`s within `FOLLOW_DIST`).
5. Knight AI (rouses on necromancer **or** minion in aggro; sticky; bites target; i-frames + `hits` + knockback on necromancer).
6. Win on all-knights-dead (`clearedPct===1`, `phase==="won"`, no further sim).
7. Lose on necromancer death (`phase==="lost"`).
8. House desecration + horde heal (`desecCount++`, `DESEC_HEAL` to horde capped; reconsecrate
   bars re-desecration; held house → `risen` totem damages a knight).
9. Souls economy (`killKnight` grants souls + may drop wisp; gathering adds `WISP_SOULS`).
10. Terrain (barricades + causeways > 0; `pushOut` stops at barricade/solid; causeway speeds travel).
11. Legacy (`recordOverrun`/`recordFall` fold once; best-time monotonic; persists to stub).
12. Scoring (`scoreRun` base/bonuses; untouched forfeited by a blow; difficulty ordering).
13. Render smoke (`render`/`scaffold` don't throw with zero sprites, at start and after state changes).
End with pass/fail tally + `process.exit(failures===0?0:1)`.

---

## Verification

```sh
npm install                  # one-time
npm run typecheck            # strict + noUnused*/noImplicitReturns must pass for necro.ts
npm run build                # tsc emits necro.js (+ app.js, pentagram.js)
npm test                     # runs smoke + pentagram + necro harnesses
node tools/necro-test.mjs    # iterate on the new harness alone

npm run build && python3 -m http.server 8000
# open http://localhost:8000/necro.html (HTTP, not file://)
# play: joystick/WASD move, march onto a grave to raise skeletons, watch them
# auto-fight knights, raze houses to heal the horde, clear all knights to WIN.
# Confirm fully playable with NO necro PNGs (procedural fallbacks), then again
# once the artist drops PNGs into art/ (then add them to sw.js ASSETS + bump CACHE).
```

Also confirm: `necro.js` is git-ignored (like the other compiled files); header
cross-links reach `necro.html` and back; after the `CACHE` bump the service worker
installs with no 404 (no missing PNGs in `ASSETS`) and serves `necro.html`/`necro.js`
network-first while still working offline.

### Follow-ups (out of this first-playable scope)
Generate the undead PNGs from the prompts → add to `sw.js` `ASSETS` + re-bump `CACHE`.
Later, optionally port the deferred meta-systems (boss duel = the village champion,
reliquary/frescoes, perks, share-as-PNG, offline QR).
