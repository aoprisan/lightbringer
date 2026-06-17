# Invented Features to Differentiate Us

*Companion to `DIFFERENTIATION.md`. Where that doc named our moats, this one proposes **new, original
features that amplify them** — not genre table-stakes. Scope: **grounded and buildable now** — every
feature maps to an existing code seam in `pentagram.ts` (The Burning Vigil) or `necro.ts` (The Necromancer's
March), needs no backend, no new art beyond procedural SVG, and respects the save-version / `sw.js`
discipline. Design only; no code yet. Date: June 2026.*

Our moats, restated, so each feature can point at one:
- **M1 — Stand-still-to-attack** (commitment as the core verb)
- **M2 — The living arena** (relight/raze that heals, awakens, scars)
- **M3 — The genre-switch boss** (the traced ritual seal)
- **M4 — The souls anti-fountain economy** (aggression fuels raising)
- **M5 — The body-matters commander** (your position matters even with an army)
- **M6 — The light↔death dyad** (two mechanical mirrors in one world)

---

## The Burning Vigil — deepen M1 (stand-still) and M2 (living arena)

### 1. Consecration rings — *the longer you stand, the more ground is yours* `[M1 + M2]`
A **full** charge doesn't only pulse damage; it sears a fading **ward ring** into the ground beneath your
feet. Inside the ring, shades take chip damage and **lit dwellings can't be snuffed** for its lifetime — so
holding a spot literally converts the map to your side, block by block. Chaining rings lets you carve a safe
corridor through a quarter.
- **Why it's ours:** every other survivors-like punishes standing still; this makes a *stationary footprint*
  the unit of progress. It turns M1's risk into spatial reward and feeds M2 directly.
- **Seam:** the full-charge branch of `stepPentagram` (pentagram.ts:1201). Reuse the
  `inShrineAura`/`SHRINE_AURA` bubble test (:922) for "inside a ring" and an `s.elapsed`-deadline list
  exactly like the snuff scars (`SNUFF_VEIL_MS`) for the fade.
- **Discipline:** transient live-play state (like decoys/scars) → **no save bump, no new assets** (procedural
  ring SVG, same as scars).

### 2. Overcharge bloom — *risk/reward on the core verb* `[M1]`
Hold still *past* full charge and you bank an **overcharge** meter instead of wasting the time. The next time
you move, it releases a one-shot nova scaled by how long you over-held — but over-holding also **quickens the
swarm's aggro** toward you. A clean "press your luck while planted" decision that exists only because the
weapon is stationary.
- **Seam:** the charge accumulation in `stepPentagram` (already clamps at full); the nova effect already
  exists as the Wrath sigil's power, so the release reuses it. One new tuning constant.
- **Discipline:** pure tuning + transient meter → no save/asset change.

### 3. The encroaching veil (the dark tide) — *the arena fights back on a clock* `[M2]`
Right now the city only darkens where shades reach. Add a slow **tide**: unlit ground periodically pushes
veil one edge toward your lit dwellings, and standing in light **holds the line**. The relit map becomes an
active front with a pulse, not a static counter — this is the lean-in from `DIFFERENTIATION.md` ("make
map-state consequential").
- **Seam:** `stepDwellings` (:992) / `stepSpread` (:979) for the propagation; `SNUFF_VEIL_MS`-style veil for
  the scar. Rate as a per-`LevelDef` dial so each city tunes its menace.
- **Discipline:** rides existing fields; per-city constant → no save bump.

### 4. Constellations — *where you relight matters, not just how many* `[M2 + M1]`
When relit dwellings form an adjacency line or cluster, the pattern grants an **in-run boon** (e.g. a triad
lights faster, a line widens the sigil). This is the **identity-safe version of the survivors-like draft**
that `DIFFERENTIATION.md` flagged: it deepens *positioning and commitment*, never generic kiting power.
- **Seam:** dwelling adjacency is already computed for conduits in `buildArena` (:741); `kindleDwelling`
  (:945) already tracks `litCount` — read the graph there to detect shapes. Boon surfaced via the existing
  non-modal toast/card path (`maybeFresco`/`showToast`).
- **Discipline:** live-play state → no save bump; procedural highlight only.

---

## The Necromancer's March — deepen M4 (economy) and M5 (commander)

### 5. Sacrifice the horde — *the army is a resource* `[M4 + M5]`
Stand among your own skeletons and **consume** the nearest few to instantly refund souls or **fuse a bigger
raise** (a single elite revenant). Deepens the anti-fountain economy: when graves run dry or a priest is
about to smite, you can cannibalize the swarm into a power play — a constant, body-present economic choice.
- **Seam:** `stepRaise` (:699) and the souls economy (`RAISE_COST`, :162); `aliveMinions` (:630) /
  `stepMinions` (:758) to pick the nearest minions to consume.
- **Discipline:** live state + tuning → no save bump.

### 6. Command verbs — Rally & Hold — *your presence directs the army* `[M5]`
Layer two light commands over auto-targeting: **Rally** (gather minions to you) and **Hold** (anchor them on
a point). The horde currently just chases nearest; commands make *where you stand and what you signal* the
tactic — the commander moat made interactive without turning into an RTS.
- **Seam:** `stepMinions` (:758) targeting logic; a command state toggled from the carrier (reuse the
  joystick/secondary-button input already wired in the march shell).
- **Discipline:** live state → no save bump.

### 7. Grave-tide — *razing momentum* `[M2-mirror + M4]`
Razing **clustered** houses chains a march buff — a free wight per cluster razed in quick succession. The
exact inversion of Vigil's Constellations (creation-by-destruction), reinforcing M6.
- **Seam:** `desecrateHouse` (:967) / `stepDesecrate` (:1032); `SOUL_PER_RAZE` (:170).
- **Discipline:** live state → no save bump.

---

## Cross-cutting — make the dyad itself a feature

### 8. The mirror boss verb — *the genre-switch boss, inverted* `[M3 + M6]`
Necro currently has no boss; rather than copy Vigil's seal duel outright, **invert its verb**: where the
Veilwarden makes you *bind* a Goetic seal strand by strand, the Necro warden makes you **unbind / desecrate**
a consecrated ward — same tactile ritual, mirrored win condition. This both gives Necro its climax and turns
M3 into a recognizable signature shared across the dyad.
- **Seam:** reuse `makeSeal`/`submitTrace`/`traceScore` (pentagram.ts:1584/:1795/:1528) with an inverted
  completion test, themed off the consecration art Necro already uses (`reconsecrateHouse`, :989).
- **Discipline:** transient duel state like Vigil's `s.boss`; procedural seal → no save/asset change. This is
  the one slightly larger "signature" pick — bigger than the others, still no new systems.

---

## Recommended build order

Cheapest high-identity wins first, escalating to the signature swing:

1. **Consecration rings** (#1) — purest expression of M1+M2, reuses scar + aura patterns wholesale.
2. **Constellations** (#4) — adds build variety the *identity-safe* way, on the conduit graph that's already
   built.
3. **Sacrifice the horde** (#5) — biggest deepening of Necro's economy for the least new surface.
4. then **Encroaching veil** (#3) / **Command verbs** (#6) as the two games' active-front layers,
5. and finally the **mirror boss verb** (#8) as Necro's climax and the dyad's signature.

Every item above is live-play state or pure tuning — none changes the save format or ships new art, so they
can land incrementally without `CACHE`/version churn (recompiling still bumps `CACHE` per the usual rule).
