# Spin-off directions: making The Light-Bringer more dynamic

The current game is deliberately still: the city breathes only when the player
acts, every system (spread, Keepers, weather, dawn) resolves in one `stepCity`
breath, and the whole sim is a pure, headless function of `GameState`. That
purity is the asset every option below builds on — the sim already runs without
a browser (`smoke-test.mjs` proves it), the Keepers already have a working
agent loop (`px/py` patrol, target selection, leash), and the weather system
already shows how to roll a nightly modifier that bends every rule at once.

"More dynamic" can mean three different things, and the options are grouped
that way:

- **time** — the city moves while you watch (options 1–2)
- **agency** — more things in the city have intentions (options 3–4)
- **variety** — each night/run is structurally different (options 5–6)

---

## Option 1 — *The Living Night* (real-time mode)

**One line:** restore the clock. The city breathes on its own at `TICK_MS`;
you act amid a moving world instead of trading turns with it.

**Why it's cheap:** the architecture was real-time once and still remembers
it. `TICK_MS` survives as the idle-catch-up conversion factor, and
`breathe()` is already the single choke point — a `setInterval` that calls
`stepCity` + `draw` is most of the work. The render pass rebuilds the SVG
wholesale each frame, so nothing about drawing changes.

**What it changes in feel:** Keepers visibly stalking toward your light while
you decide is genuinely tense — the patrol drift (`KEEPER_SPEED`) was tuned
for this and reads beautifully in motion. Decoys become real-time plays: bait,
*watch* the Keeper walk out, kindle behind it.

**The tone risk and its fix:** raw real-time kills contemplation. Two variants
keep it:

- **Held-breath time** (recommended): time flows only while the player's
  finger is on the map (Superhot-style). Lift your thumb and the night holds
  its breath. Contemplative *and* dynamic; touch-native.
- **Slow ticks with a pause:** one breath every ~2–3 s, with the dawn overlay
  as the only pause. Closer to a classic idle/strategy hybrid.

**Engineering notes:** one loop in the shell; throttle `saveGame` (every N
ticks, not every tick); no save-format change. Ship as a mode toggle first —
it can live in the same codebase before becoming its own spin-off.

**Effort:** small (days). **Reuse:** ~95% of the sim untouched.

---

## Option 2 — *Embertide* (continuous fire physics)

**One line:** light stops being a per-node state machine and becomes a flow —
brightness diffuses along edges every breath, pools in dense quarters, gutters
in thin ones, and the player shepherds a moving front rather than placing
points.

**Mechanics sketch:**

- `brightness` becomes a conserved-ish quantity: each breath, a fraction flows
  along each edge proportional to `conductivity`, decays per node, and a node
  is "lit" above a threshold. `stepSpread`'s probabilistic catch becomes a
  deterministic flow with noise.
- Wind becomes a directional bias on the flow (the `WIND_BOOST` dot-product
  math transfers directly); rain becomes global decay; veil becomes local
  decay. The weather system gets *more* expressive for free.
- Keepers snuff by draining brightness in their reach rather than a binary
  snuff — a Keeper parked on your supply line visibly dims everything
  downstream. Awakened souls become *pumps* (constant brightness sources),
  hearths stronger pumps.

**Why it's interesting:** placement strategy deepens (you're routing a fluid
through a graph, around drains), and the board is alive even between actions —
flicker, ebb, guttering — which is dynamism that *serves* the atmosphere
instead of fighting it. Works in the existing turn-based shell or on top of
option 1.

**Engineering notes:** rewrites `stepSpread`/`snuff`/`applyDawn` semantics;
the irreversible-veil and dawn-flood-fill invariants need re-deriving in flow
terms (e.g. dawn keeps any node above threshold with a path of above-threshold
nodes to a soul). Save format bump (continuous brightness already stored, but
balance constants shift). The headless test seam makes tuning this tractable.

**Effort:** medium (1–2 weeks of sim work + heavy tuning). **Reuse:** graph,
rendering, shell, weather, persistence all stay.

---

## Option 3 — *The Lamplighters* (wandering souls — an agent layer)

**One line:** awakened souls get up and walk. The city fills with moving
people: lamplighters who roam and kindle, Keepers who hunt them, and a player
who guides rather than micromanages.

**Why the code is already half-written:** Keepers are the template. They have
a patrol position distinct from their anchor (`px/py`), a target-selection
loop, movement with a leash, and act-every-N-ticks cadence (`stepKeepers`).
A wandering soul is the same machine with an inverted objective: seek the
nearest reachable dark node *outside* every Keeper ring (`keeperRadius` is
already a pure shared helper), walk there, kindle, move on. `stepAwakened`
currently teleport-kindles an adjacent node; this makes that act *embodied*.

**Player verbs shift from placing to shepherding:**

- Tap a soul, then tap ground: a beckon (set its destination).
- Souls flee rings they wander into; a soul caught mid-street gets snuffed
  *where it stands* — chases happen, and the decoy becomes a way to save a
  soul mid-pursuit, not just tempo.
- Hearths stay home (the aged settle) and become safehouses wandering souls
  retreat to at dawn — `nights` progression gets a spatial meaning.

**Why this is the most "alive" option per unit of risk:** nothing about the
economy, dawn, veil, or weather changes; the city simply acquires inhabitants.
It is also the best pairing with option 1's held-breath time.

**Engineering notes:** add `px/py` use for awakened dwellings (fields already
exist on every node and are already saved — likely *no* save bump, or a soft
v5); extend `stepKeepers`' targeting to moving souls (target the soul's
patrol position, as decoys already special-case position). Rendering needs a
walking-figure mark; the sprite pipeline (`SPRITE_NAMES`) extends trivially.

**Effort:** medium (a week-ish). **Reuse:** very high.

---

## Option 4 — *The Other Hand* (play the Keeper, or both)

**One line:** invert the premise — or set two hands against each other. The
sim is headless and pure, so the carrier can be an AI and the player can hold
the snuffer.

**Three escalating scopes:**

1. **Keeper solitaire:** you place Keeper posts, lay veil, and call sweeps on
   a budget; an AI carrier (a planner over `kindle`/`awaken`/`placeDecoy` —
   essentially a smarter `stepAwakened`) tries to outlive you. The existing
   smoke test already drives the game headlessly; the AI carrier is that test
   grown a value function. Thematically rich: the frescoes read very
   differently from the other side ("Every Keeper was, once, a child…").
2. **Hot-seat duel:** carrier and Keeper alternate breaths on one device.
   Zero networking; the turn-based shell already is a turn structure.
3. **Async duel by save-string:** `saveGame` already serializes the whole
   city to a compact JSON blob; export it as a pasteable code, play your
   night, send it back. Asymmetric correspondence chess, still
   zero-dependency and offline-capable — true to the PWA's soul.

**Engineering notes:** Keeper-side verbs are new but small (place post =
`reinforceVeil` made manual; sweep = temporary `KEEPER_SPEED`/radius boost).
The AI carrier is the real work and the real fun — and it's pure-sim work,
fully testable headlessly. Fog must invert (the Keeper sees veil and heat,
not frescoes).

**Effort:** medium for scope 1, large for 2–3. **Reuse:** the entire sim,
verbatim; new shell + AI.

---

## Option 5 — *The Procession* (roguelike campaign across many cities)

**One line:** the run already ends by design ("you will not finish the
city") — make that the loop. Each carrier's death seeds the next: new city,
escalating Veil, meta-progression through recovered frescoes.

**Mechanics sketch:**

- **Seeded generation:** swap `Math.random` in `generateCity`/`rollWeather`
  for a seeded PRNG (the codebase note that edges/adjacency must stay a pure
  function of geometry means determinism is already a design value).
  Immediately enables a **daily city** — everyone carries the same flame
  through the same streets, compare dawns. Hugely dynamic at zero sim cost.
- **Edicts:** per-night/per-city mutators, rolled like weather
  (`rollWeather` is the exact template): *Curfew* (Keepers +1 ring), *Festival
  of Lamps* (dwellings self-kindle in one district), *Informers* (a marked
  dwelling raises `heat` when lit near it — finally a use for the stored but
  fallow `heat` field), *The Magistrate* (one boss Keeper with no leash).
- **Meta-progression:** frescoes become collectibles across runs (a
  `localStorage` codex beside the save). Collected sets unlock new node kinds
  for future cities — a bellfounder (one-use city-wide reveal), a lamplighter's
  guild (cheaper awakens in its district), an oilworks (conduit booster).
  `NodeKind` + `COND` + `finalizeCity` extend cleanly for new kinds.

**Why it fits the fiction perfectly:** the carrier was always going to burn
out; a procession of carriers, each inheriting a darker world plus the
frescoes the last one uncovered, *is* the story the game already tells.

**Engineering notes:** seeded PRNG is a small, contained change with big
payoff (do it first regardless of spin-off). Edicts are weather-shaped.
Meta-codex is a second storage key, no save-format break. Effort scales with
how many edicts/unlocks you write.

**Effort:** medium, very incremental. **Reuse:** near-total; mostly additive.

---

## Option 6 — *The Ember Holds* (one shared persistent city)

**One line:** a single slow city lit by many hands — each player gets a few
breaths a day, awakened souls work between visits (the idle layer already
exists), dawn happens on a real-world clock for everyone.

This is the most dynamic possible version — the city changes while you sleep
because *other people* changed it — and the only option that breaks the
"zero-dependency, offline PWA" constitution: it needs a server (even a tiny
one; the save blob is small and the sim is pure, so the server can be the
referee by just running `simulateTicks`). Listed for completeness as the
ambitious end-state; everything in options 1, 3, and 5 feeds it.

**Effort:** large. **Reuse:** the pure sim is the server.

---

## Comparison

| | Dynamism gained | Tone risk | Effort | Sim reuse | Standalone spin-off or mode? |
|---|---|---|---|---|---|
| 1. Living Night | time moves | medium (fixed by held-breath) | S | ~95% | mode first |
| 2. Embertide | board is alive | low | M | high | spin-off |
| 3. Lamplighters | inhabitants | low | M | very high | mode or spin-off |
| 4. The Other Hand | an opponent | medium | M–L | total | spin-off |
| 5. The Procession | run variety | none | M | total | grows in place |
| 6. Ember Holds | other players | low | L | sim = server | spin-off + server |

## Recommendation

The strongest *single* spin-off is **option 3 + option 1's held-breath
variant**: a city of wandering lamplighters and stalking Keepers where time
flows only under your finger. It is the largest perceived leap in dynamism
("the city is alive") for the smallest invariant damage — economy, dawn,
veil, and hearths all survive untouched — and the Keeper patrol code means
half the agent layer already exists.

Independently and immediately worth doing regardless of direction: **seeded
city generation** (option 5's first step). It's a contained change, it makes
every future balance experiment reproducible in the headless harness, and it
unlocks a shareable daily city for free.
