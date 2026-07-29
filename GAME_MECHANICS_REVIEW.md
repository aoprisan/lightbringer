# Game Mechanics Review — the Five-Game Family, Improvements, and the Most Promising Spinoff

*A family-wide review pass across all five shipped games — **The Burning Vigil** (`pentagram.ts`),
**The Necromancer's March** (`necro.ts`), **The Watcher at the Threshold** (`eldritch.ts`),
**The Moon's Hunger** (`werewolf.ts`), and **The Iron Rain** (`bomber.ts`). Companion to
`DIFFERENTIATION.md` / `FEATURE_IDEAS.md` (which covered only the Vigil–Necro dyad, June 2026),
`VIGIL_ROADMAP.md`, and `WEREWOLF_ROADMAP.md`. This doc does three things: (1) reviews each game's
mechanics as they exist in code today, (2) proposes concrete improvements anchored to real seams, and
(3) names the **most promising spinoff** and argues for it. Design review only; no code changes here.
Date: July 2026.*

---

## 1. The family, seen as one design

Every game is a variation on a single question: **what does the player's one verb cost them?** The family
is best understood as a spectrum of answers:

| Game | Core verb | What the verb costs | Second meter (the twist) |
| --- | --- | --- | --- |
| Burning Vigil | stand still → AoE sigil | exposure (you're a target) | — (the baseline) |
| Necromancer's March | stand still → raise horde | exposure + **souls** (anti-fountain) | souls economy |
| Watcher at the Threshold | stand still → banish sigil | exposure + **your own mind** | Sanity (second life-bar) |
| Moon's Hunger | **motion** → maul/pounce | stillness = weakness; feeding = obligation | Moon → Fury → Form |
| Iron Rain | **straight flight** → bomb run | predictability (flak leads your line) | Alert (defence temper) |

Three structural observations fall out of this table:

1. **The verb inversion is complete.** Vigil/Necro/Eldritch pay for power with *stillness*; Werewolf pays
   with *stillness being useless* (momentum is the weapon, `MOMENTUM_RISE_MS`, werewolf.ts:200); Bomber
   pays with *predictability* (`STEADY_TURN`, bomber.ts:210). The family has now explored the whole axis —
   stand still, stand still at a price, never stand still, never turn. New spinoffs should claim a *new
   axis* (see §7), not another point on this one.
2. **Every game has converged on the same meta-pattern**: one equipped loadout from a four-item shop
   (sigils/rites/signs/pelts/airframes), one lifetime currency, a per-frame pure sim with a centralized
   kill/damage path, overcharge on the core verb, a mote/pickup heartbeat, and the duel-token echo. This
   uniformity is a strength (a fix ports five ways; the duel block is verbatim-mirrored) and a risk
   (shops differ in *numbers*, rarely in *decisions* — see §6.1).
3. **The counter-pressure design is the family's quiet best work.** Each game has an enemy whose whole
   job is to punish the core verb: the Vigil's spitter, Necro's crossbowman, Eldritch's gazer, Werewolf's
   friar + wolfsbane, Bomber's flak-lead. Every one is telegraphed and has at least two counters
   (cover / body-block / movement). This discipline should be a stated invariant for all future enemies.

---

## 2. The Burning Vigil — review & improvements

**State:** the deepest game by content (eleven cities, thirteen-plus terrain kinds, four shade variants,
frescoes/reliquary, QR sharing) and the most polished onboarding. The terrain vocabulary
(fonts/hallows/pathways/groves/mist) has quietly turned "stand still" into "stand *somewhere*", which is
the right maturation of the verb — `PATHWAY_INSCRIBE_MUL` (pentagram.ts:332) is the exemplar: a third
option between standing exposed and running cold, without unseating the core verb.

**Weak points:**

- **The win condition has no crescendo.** The boss duel is disabled (the `startBoss` call is commented
  out, pentagram.ts:2629), so clearing the host ends the run on whichever stray shade happened to be
  last — often an anticlimactic mop-up walk across a cleared map.
- **Charge is nearly free.** `PENTA_CHARGE_MS = 360` (pentagram.ts:277) means full inscription in about
  a third of a second; the stand-still *cost* the whole identity rests on is mostly notional against the
  common host, and only variants (spitter, darter) actually tax it.
- **Late-city dial soup.** The Edge-Lands cities layer the full vocabulary at once; individually elegant
  terrains blur when six auras overlap, and nothing teaches which aura is which mid-swarm.

**Improvements (ranked):**

1. **Re-enable the seal duel as an *opt-in crescendo*.** Rather than restoring the mandatory boss,
   trigger it only when the last shade falls *while the sigil is fully inscribed* — an intentional,
   flavourful gate (finish the host from a planted stance to summon the master Keeper) that gives the
   duel a comeback without forcing the genre-switch on players who disliked it. Bonus embers for the
   bind. Seam: the disabled `startBoss` site; all duel code is intact and test-covered.
2. **The last-stand tide.** When ≤10% of the host remains, the survivors stop wandering and converge
   (reuse the cleanup-sweep aggro), so runs end in a wave, not a walk. One dial, `stepShades` only.
3. **Aura legibility pass.** Render-layer only: give every beneficial aura a shared visual grammar
   (soft gold ring = "you inscribe here", green = mend, red = hazard) so the Edge-Lands read at a glance.
   No sim change.
4. **Make charge time a real dial per city.** A `chargeMulCity` LevelDef dial (default 1) would let late
   cities tax the verb itself instead of only adding more bodies — difficulty pointed at the identity.

---

## 3. The Necromancer's March — review & improvements

**State:** the most complete *systems* game. The souls anti-fountain (`SOUL_REGEN_TO`, necro.ts:205) is
still the family's best economy — you can always raise again, you can never farm by idling. The watch is
the family's best enemy roster: nine defender roles, each with real counterplay (the priest's
swarm-slow/body-block pair, necro.ts:420 and `PRIEST_BLOCK_HALF`, is the single best counterplay design
in the repo). Overcharge → champion (`OVERCHARGE_EXTRA_COST`, necro.ts:225) deepens the verb with zero
new inputs. Art has shipped.

**Weak points:**

- **The horde is fire-and-forget.** Minions auto-target the nearest knight; after the raise, the
  necromancer's decisions shrink to positioning and grave-hopping. The "body-matters commander" moat
  (`DIFFERENTIATION.md` M5) is under-expressed — your body matters for *survival*, not for *command*.
- **Rite powers are thin.** Only two of six rites have a `power` (`plague`, `colossus`); the other four
  are stat lines. Compare the Vigil, where three of four sigils have powers.
- **No collection layer.** No frescoes-equivalent, no boss, no QR — acknowledged in CLAUDE.md as
  deferred parity, but it means Necro leans entirely on its (excellent) core loop for retention.

**Improvements (ranked):**

1. **One command verb: the Rally.** `FEATURE_IDEAS.md` §6 proposed Rally & Hold; ship only Rally, and
   make it *positional, not an input*: minions within a short radius of the necromancer retarget to
   *his* nearest knight and gain a small haste. Walking into the press to point the horde is exactly the
   M5 body-risk trade, and it needs no button. Seam: one branch in `stepMinions` reading hero distance.
2. **Give the four powerless rites cheap passive powers** reusing existing machinery: Barrow-Wall
   skeletons shove on hit (knockback exists via the marshal), Cairn wights splinter once on death into a
   half-HP wight (killMinion seam), Gallows revenants gain frenzy-lite on any mote pickup.
3. **Port the fresco pattern as "heresies"** — grave-side lore fragments first-footed at graves
   (`node.seen` pattern is already generic). The reliquary overlay is render-layer and directly portable.

---

## 4. The Watcher at the Threshold — review & improvements

**State:** the cleanest *single-twist* design in the family. Sanity is genuinely load-bearing: the verb
itself costs mind (`SIGN_SANITY_COST`, eldritch.ts:150), proximity costs mind (`DREAD_RADIUS`, :167),
the gazer taxes at range (`GAZE_DPS`, :269), and overcharge *restores* mind (`OVERCHARGE_SANITY`, :161) —
so the risk/reward loop closes on itself elegantly. Two distinct loss ends (`"slain"`/`"mad"`) is great
flavour for nearly free.

**Weak points:**

- **It is the least differentiated sibling.** Strip the sanity bar and it is the Vigil with four fewer
  terrain kinds, four fewer enemy variants, and seven fewer maps. The twist is excellent but it is *one*
  twist carried by the smallest content base (2,386 lines vs the Vigil's 5,385).
- **Sanity has no expression beyond a number.** Low sanity changes nothing about the world — no
  perceptual consequences, which is the one thing every Lovecraft game is expected to do and the one
  thing the sanity mechanic is *for*.
- **No gameplay art shipped**, and only four places.

**Improvements (ranked):**

1. **Low-sanity hallucinations, render-layer only.** Below a sanity threshold, `render` draws *phantom
   horrors* (visually near-identical, no sim entity, flicker on approach) and mutes the real host's
   tells. The sim stays pure — madness is strictly a *rendering* of the same state, which is both the
   cheapest possible implementation and thematically perfect (the world is fine; *you* aren't).
   Headless tests untouched.
2. **The bargain verb: spend sanity on purpose.** One new decision: standing on a *defiled* ward lets
   the Watcher trace anyway at double sanity cost (forbidden ground, forbidden geometry). Turns the
   scar system into a risk/reward site instead of pure denial.
3. **A fifth place with a sanity-inverted gimmick** — e.g. *Celephaïs* (the Dreamlands): sanity drains
   passively everywhere but dread heals near the host (the dream wants you to look). One LevelDef +
   two sign-flips in `stepDread`.

---

## 5. The Iron Rain — review & improvements

**State:** the boldest inversion — a hero that *cannot stop* — and the tightest counter-pressure loop in
the family: the bombsight demands a straight line (`SIGHT_CHARGE_MS`, bomber.ts:211), the flak leads
exactly that line (`FLAK_FUSE_MS` velocity-lead, :237/:1064), and Alert (`ALERT_PER_BURST`, :1018) makes
the whole raid breathe strike–slip–settle. The airfield pre-strike (bomb the field, the squadron burns
grounded) is the best *strategic ordering* decision in any of the five games. Turrets, escorts, and
tangles give it a real third dimension (the air war) the ground games lack.

**Weak points:**

- **Steering is the whole skill, and it's under-assisted.** With heading/throttle-only control, small
  course corrections near `STEADY_TURN` (0.9 rad/s) feel binary — either you hold the run or you dump
  the sight. There's no trim, so touch-joystick players bleed charge to noise.
- **Four theatres, no map-vocabulary expansion** — the sky has only balloons/clouds/streams while the
  ground siblings have ten-plus terrain kinds. The sky is legible but samey by theatre three.
- **The moving targets (columns) are mechanically identical to static works** except for motion; nothing
  shoots back from a column, so they're just slower factories.

**Improvements (ranked):**

1. **Sight trim / dead-zone forgiveness.** Angular velocity below `STEADY_TURN × 0.4` should count as
   steady (full charge rate) with a linear falloff to zero at `STEADY_TURN` — replacing the hard
   threshold. One expression in the charge branch; transforms feel on touch.
2. **Sky vocabulary, two kinds:** **searchlight cones** (night raids: a sweeping cone that, when it
   catches the un-hidden bomber, spikes Alert and lets flak fire fuse-free — the mist inversion) and
   **thermals** (rising columns that grant the `STREAM_BOOST` effect omnidirectionally — risk/reward
   placement near targets). Both are pure `buildArena` fields in the existing `stepClouds`/`inCloud`
   pattern.
3. **Give columns teeth**: a column's lead vehicle is a mobile light-flak (half range, half damage,
   same telegraph) — so strafing the army is a choice, not free score.

---

## 6. Cross-cutting improvements (all five)

### 6.1 Make the shops decide something

Every shop item is `radiusMul/chargeMul/pulseMul/dmgMul + maybe-power`. The numbers differentiate feel,
but rarely *strategy* — the dominant pick is usually "the one whose power you like". Cheap fix, per game:
have each catalog's capstone item **modify the game's second meter**, not the verb — e.g. a Vigil sigil
that inscribes on scarred ground; a pelt that slows fury-bleed by day; a sign that converts overkill
damage to sanity; an airframe whose Alert decays faster. The second meters are where each game's
identity lives; the shops should touch them.

### 6.2 A family-wide "daily seed"

The duel infrastructure already proves seeded arenas are identical cross-device (`mulberry32`,
`buildArena(seed)`). Derive one shared daily seed (UTC date → hash — no backend, no `Date.now()` in the
sim; the shell passes it in) and surface a "Today's <city/village/place/theatre>" button on each title
screen. Same-arena score-chasing turns the existing duel-echo plumbing into a lightweight community
feature for free, and is the natural stepping stone to the intended multiplayer direction.

### 6.3 State the counter-pressure invariant

Add to CLAUDE.md's architecture section: *every enemy that punishes the core verb must be telegraphed
and carry ≥2 counters.* The whole roster already complies (spitter/crossbow/gazer/huntsman/flak); making
it an invariant keeps future variants honest.

### 6.4 Port the Vigil's onboarding down-family

The Vigil's title-screen → picker → story-chained unlocks (`cityUnlocked`) is the only real progression
arc. Eldritch and Bomber (4 maps each, no chaining) would each gain a sense of campaign from the same
`story`/unlock-gate pattern — copy, don't invent.

---

## 7. The most promising spinoff: **The Moon's Hunger** (`werewolf.ts`)

**Verdict: The Moon's Hunger is the most promising spinoff**, with The Iron Rain the clear runner-up.

The criteria: (a) mechanical distance from the Vigil (can it stand alone?), (b) systemic depth already in
code (is the promise built, or hoped?), (c) market distinctiveness (does anything else play like this?),
and (d) headroom (does its design generate its own future?).

**(a) It is the only spinoff that escaped the parent's verb.** Necro and Eldritch are inversions/re-themes
of stand-still-to-attack; Bomber inverts it into hold-a-line. The Moon's Hunger *discarded* it: a
pure-joystick predator loop with **no attack button at all** — maul and pounce fall out of steering and
speed (`POUNCE_AT` frontal-cone auto-lunge, werewolf.ts:219/:1401). That is not a variation on the family
verb; it is a second family-founding verb. If any spinoff can grow into a standalone product rather than
a sibling, it is this one.

**(b) It already has the deepest interlocking systems in the repo.** Three coupled meters (moon → fury →
form, `MOON_CYCLE_MS`/`FURY_RISE_MS`, :249/:251; momentum as the wolf's weapon, :200), plus an emergent
**stealth layer nobody wrote as a stealth system**: alarm radiates from conspicuousness, spreads
prey-to-prey order-free, decays, and rouses the hunters at a village-average threshold (`ALARM_ROUSE`,
:241/:1523). "Stealth as a man falls out for free" is the highest praise a systems design can earn — the
mechanic is a consequence, not a feature. The Night's Quarry (:267/:1753) then gives every night a
direction without adding an input. No sibling has three systems this entangled; Eldritch has one twist,
Bomber has two.

**(c) It is the most distinctive against the market.** Stand-still survivors-likes have neighbours;
"reverse-horror stealth-predator where the day/night cycle *is* your class system and the whole game is
one joystick" effectively has none. Reverse-horror (playing the monster) is a proven, underserved
appetite, and the man-phase stealth / wolf-phase rampage rhythm is a genuine hook you can put in one
sentence of store copy.

**(d) Its design generates its own roadmap.** The moon wheel invites lunar phases (a monthly meta-cycle
over the nightly one); alarm invites village routines (doors, bells, refuges — prey with somewhere to
run); form invites a third, mid-fury shape; the pure-joystick constraint disciplines all of it. It
already has eight villages, the family's only audio layer (the shell-side WebAudio synth), a full
terrain vocabulary, and a prior roadmap (`WEREWOLF_ROADMAP.md`) whose top pick (the Quarry) shipped —
evidence the game rewards continued investment.

**Why not the others:** *Necro* is the most complete and the best economy, but it is deliberately the
dyad's second half — its value is highest *coupled to* the Vigil, not spun out. *Eldritch* has the best
single twist and the lowest build-out; it is a re-theme until sanity changes perception (§4.1). *Iron
Rain* is the runner-up: the never-stop constraint is as bold as the werewolf's, and flak-lead is the
family's smartest single mechanic — but it has one fewer interlocking system, half the maps, and its
feel problem (§5.1) is unsolved, where the werewolf's feel is its strength.

**Recommended investment order for The Moon's Hunger:**
1. Gameplay art (man/beast/watch sprites) — the sole spinoff with a shipped soundscape deserves parity
   in art; fallbacks are good but the theme sells on atmosphere.
2. A third form — the **Wretch**, a mid-fury shape (weak maul, keeps stealth radius): turns the fury
   meter's midband into a place you might *want* to hold, deepening the feed decision.
3. Lunar phases as the meta-cycle: each run rolls a phase (new → full) scaling `moonlightOf`'s amplitude
   — a free difficulty/mutator system from one multiplier, feeding the daily-seed idea (§6.2).
4. Village routines: give prey a refuge node they flee *toward* (the church), making herding — already
   possible via cairn-panic — the expert strategy the design is clearly reaching for.

---

*Summary: the family's mechanics are in strong health — five distinct answers to one design question,
uniformly disciplined counter-pressure, and a shared meta-pattern that keeps maintenance cheap. The
per-game gaps are crescendo (Vigil), command expression (Necro), perceptual consequence (Eldritch), and
feel-forgiveness plus sky vocabulary (Bomber). The Moon's Hunger is the spinoff to bet on: it alone
founded a second verb, its stealth emerges rather than being scripted, and its moon/fury/form engine
generates its own future.*
