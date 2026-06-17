# The Burning Vigil — Priority Features & City-Design Re-Evaluation

*Synthesizes the three prior analyses on this branch — `VIGIL_COMPETITOR_RESEARCH.md` (genre table-stakes we
lack), `DIFFERENTIATION.md` (our moats + which table-stakes would erode them), and `FEATURE_IDEAS.md`
(grounded invented features) — into one ranked priority list for The Burning Vigil, plus a fresh look at the
seven-city design grounded in the actual `LEVELS` dials and `difficultyMult` in `pentagram.ts`.
Date: June 2026.*

---

## Part 1 — Priority feature list

Ranked into tiers by **(value × identity-fit) ÷ effort**, reconciling the three docs. "Identity-safe" means
it deepens our moats (stand-still commitment, the living arena, the genre-switch boss) rather than pulling
toward generic survivors-like motion or borrowed gear (see `DIFFERENTIATION.md`'s tension table).

### P0 — do first (cheap, high impact, fixes a live imbalance)

| # | Feature | Why now | Source | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Fix `difficultyMult` to price in the variant/terrain load** | The reward currently ignores veils/elites/spitters/darters/healers/obelisks — so harder cities pay less (see Part 2). This is a balance bug, not a feature, and it undercuts the whole embers economy. | City re-eval | XS |
| 2 | **Consecration rings** (full charge sears a fading ward ring: chip-damages shades, bars snuff inside it) | The purest expression of the stand-still + living-arena moats; reuses the `inShrineAura`/`SHRINE_AURA` bubble and the snuff-scar deadline pattern. No save/asset change. | FEATURE_IDEAS #1 | S |
| 3 | **Decide the Veilwarden duel: finish or cut** | It's a signature genre-switch climax but currently **disabled** — clearing the host wins outright (code intact behind the commented `startBoss`). Shipping with it off means our most distinctive feature is dark. Either re-enable + polish, or formally cut it and reclaim the code. | DIFFERENTIATION (M3) | M (re-enable) |

### P1 — next (deepens build variety the identity-safe way; the replay layer)

| # | Feature | Why | Source | Effort |
| --- | --- | --- | --- | --- |
| 4 | **Constellations** — relit-dwelling adjacency shapes grant in-run boons | The **identity-safe substitute for the survivors-like in-run draft**: makes *where* you relight matter (positioning), not generic kiting power. Rides the conduit adjacency already built in `buildArena` + `litCount`. | COMPETITOR (draft) + DIFFERENTIATION + FEATURE_IDEAS #4 | M |
| 5 | **Ascension / curse modifiers** per city (stacking dials for more embers) | The genre's proven post-clear replay layer; identity-neutral. Rides `difficultyMult` + a `perkMods`-style modifier object. Directly addresses "win-once-per-city" thinness (Part 2). | COMPETITOR + FEATURE_IDEAS | M |
| 6 | **Overcharge bloom** — hold past full charge to bank a release nova, at the cost of faster aggro | Pure risk/reward depth on the core verb; reuses the existing Wrath nova. One tuning constant. | FEATURE_IDEAS #2 | S |

### P2 — later (retention & meta; some need the planned backend)

| # | Feature | Why | Source | Effort |
| --- | --- | --- | --- | --- |
| 7 | **Daily seeded descent + offline personal-best** (online leaderboard later) | Cities are already deterministic from id, so a daily seed is cheap; scoring exists. Ship the offline PB first; the online board waits on the planned backend. | COMPETITOR + DIFFERENTIATION | M (offline) / L (online) |
| 8 | **Map-state meta axis** — a persistent reclaimed-city layer across runs | Our signature progression instead of borrowed gear (the #2 recommendation in `DIFFERENTIATION.md`). Bigger design; the standout long-term differentiator. | DIFFERENTIATION | L |
| 9 | **Encroaching veil (dark tide)** — unlit ground pushes toward your lit dwellings on a clock | Turns the living arena into an active front; per-`LevelDef` rate dial. | FEATURE_IDEAS #3 | M |
| 10 | **Achievements/quests folded into `PgLegacy`** | Lightweight retention reading the existing `recordClear`/`recordDeath` fold points. | COMPETITOR | S |

### Explicitly de-prioritized (would erode the moat)
- **Generic VS-style "pick more power" draft** — pulls toward kiting; replaced by **Constellations** (#4).
- **Generic gear/loot grind** — off-identity; the second axis should be **map-state** (#8).

**Recommended sprint:** P0 (#1 → #2 → decide #3), then #4 and #5. That ships a balance fix, our most
on-identity new mechanic, a climax decision, identity-safe build variety, and a replay layer — without
touching the save format or adding assets.

---

## Part 2 — City-design re-evaluation

Grounded in the real `LEVELS` (`pentagram.ts:518`) and `difficultyMult` (`pentagram.ts:853`):
`mult = 0.6 + 0.4 × (keeperCount / 6) × sizeScale`.

### The computed picture

| Order | City | keepers (host) | sizeScale | veil/elite/spit/dart/heal | signature | **difficultyMult** |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | The Old City | 6 | 0.9 | — | clean baseline | **0.96** |
| 2 | Ashfold | 7 | 1.0 | 2/2/0/3/0 | dry tinder | **1.07** |
| 3 | The Drowned Quarter | 4 | 1.15 | **4**/1/2/0/0 | sparse + veils | **0.91** |
| 4 | The Glassworks | 9 | 1.0 | 2/3/2/4/0 | dense | **1.20** |
| 5 | Vesper Row | 11 | 1.1 | 3/4/3/3/0 | "the hardest" | **1.41** |
| 6 | The Ember Foundry | 8 | 1.0 | 2/0/0/4/3 | **fonts** | **1.13** |
| 7 | The Pale Bastion | 11 | 1.15 | 3/4/2/0/4 | **obelisks** | **1.44** |

### Findings

1. **The reward multiplier is decoupled from real difficulty (the big one).** `difficultyMult` reads only
   `keeperCount × sizeScale`. It ignores **every threat dial** — veils, elites, spitters, darters, healers,
   obelisks. So a city can pile on menace and pay nothing extra. (→ P0 #1.)

2. **The Drowned Quarter is mispriced and out of place.** It has the **most veils in the game (4)**, plus
   spitters, an elite, and the largest sparse map — yet it scores **0.91, below the 0.96 tutorial**, because
   its host is only 4 keepers. A player beating the game's heaviest veil city earns *less* than clearing the
   Old City. It also sits **3rd** in the order while being mechanically a mid/late challenge.

3. **The difficulty curve has a cliff at city #2.** Ashfold (2nd) introduces **veils + elites + darters all
   at once**, immediately after a tutorial that deliberately has none. Three new threat systems in one step
   is a steep teach.

4. **The helpful mechanic ships last; the curve isn't a clean teach.** **Fonts** (Foundry, 6th) are
   *player-favorable* (inscribe while moving) and would make a great early relief/teaching beat, but appear
   2nd-to-last. **Obelisks** (Bastion, 7th) are correctly a capstone puzzle. First-appearances are scattered
   (darter 2nd, elite 2nd, veil 2nd, spitter 3rd, healer 6th) rather than one-new-thing-per-city.

5. **Sparse-but-big can feel empty.** Drowned: 4 keepers on a 1.15 map = lots of walking between fights,
   which can read as slow rather than tense.

6. **Frescoes partition cleanly** (indices 0–22 across the seven cities) — this part of the design is healthy
   and should be preserved by any reordering.

### Recommendations

- **R1 — Reprice difficulty (P0 #1).** Fold the variant/terrain load into `difficultyMult` (a weighted sum of
  veil/elite/spitter/darter/healer/obelisk counts, plus the existing host × size term). Keep it normalized so
  the Old City ≈ 1.0 and the hardest ≈ 1.5, but ensure Drowned, Foundry, and Bastion rise to reflect what
  they actually ask of the player. This is constants-not-logic, fully test-coverable.
- **R2 — Resequence the teach.** Aim for roughly one new system per city. A cleaner order:
  **Old City → The Ember Foundry (fonts: a friendly mechanic) → Ashfold (darters) → The Drowned Quarter
  (veils + spitters, repositioned later than 3rd of difficulty) → The Glassworks (elites, density) → Vesper
  Row → The Pale Bastion (obelisks + healers, capstone).** Spread elites/veils so Ashfold doesn't stack three
  at once.
- **R3 — Firm up Drowned.** Either nudge its host up (5–6 keepers) so the map doesn't read as empty, or lean
  fully into "few but lethal, ranged, patient" and let R1 pay it accordingly. Pick one identity.
- **R4 — Make ascension the replay spine (P1 #5).** "Seven cities, clear each once" is thin next to
  Hades/VS. Per-city stacking modifiers give the 7 cities long-tail depth and reuse `difficultyMult`.
- **R5 — Seed the daily off a city (P2 #7).** Since each city is deterministic from its id, a daily descent
  is a near-free reuse of `generateCity`/`buildArena`.

### How the two parts connect
The city re-eval is *why* several roadmap items rank where they do: R1 = P0 #1 (a live imbalance), R4 = P1 #5
(replay depth the cities currently lack), R5 = P2 #7. Fixing the reward curve first makes every later
progression feature (embers, ascension, dailies) sit on honest numbers.
