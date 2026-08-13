# The Sin-Eater's Round — a concept for the family's most dynamic game

*A design concept only — no code. Companion to `DIFFERENTIATION.md` and `FEATURE_IDEAS.md`. Where those
docs deepen the shipped games, this one extracts the family's occult-horror atmosphere into a **new
sibling** built for constant motion. Date: August 2026.*

---

## 1. The pitch

**You are the Sin-Eater. The rite is the walk. The sigil is your wake.**

After the Vigil burned the risen watch out of the city, something was left behind: the **Unshriven** — the
dead who died with their sins uneaten, too heavy to rise as shades and too stained to lie still. The Church
will not touch them. So the parish pays the old price: bread and salt eaten off a corpse's chest, and a
figure nobody thanks who walks the streets at night with a censer of burning tallow, **drawing the rite
with their own footsteps**.

Every step you take lays a guttering line of salt and tallow-light behind you — the **Litany**. Cross your
own line and the circuit **closes**: everything unshriven caught inside is **judged** — devoured in a rush
of ash, its sin whispered aloud as it goes. The pentagram, the Elder Sign, the bombsight reticle: in this
game the sigil is not something you stand inside. **It is the shape your body writes on the city, at a
dead run, while the dead close in.**

One sentence: *Vampire Survivors' motion, Qix's geometry, the Vigil's liturgy of light — a folk-horror
game where drawing the circle IS the combat, and stopping is how you die.*

---

## 2. Why this game — the extraction

The family's five games share one moat: **the ritual verb under pressure**. Four of them express it as
*stillness* (stand to inscribe / raise / trace / hold the run steady); the werewolf breaks it into
locomotion but trades the ritual away for a predator fantasy. Nobody in the family — and nobody in the
genre — has shipped the third answer:

> **Keep the ritual. Make it out of motion.**

| Family DNA | Kept? | How the Sin-Eater expresses it |
| --- | --- | --- |
| The ritual verb as the whole weapon | **Kept** | The Litany line + circuit closure — no attack button, ever |
| Stand-still risk model | **Inverted** | *Stillness* is the death state (the Quiet, §6); the risk is the *length of the circuit you dare* |
| Charge time (`PENTA_CHARGE_MS`) | **Transposed** | The line's decay (`LINE_TTL`) — a big loop must be closed before its far end gutters out |
| Overcharge (hold past full) | **Transposed** | Overreach (§4): every extra second a loop stays open past "closable" banks a harder Judgment |
| AoE pulse | **Transposed** | Judgment fires *once per closure*, area = the polygon **you actually drew** |
| Second bar with teeth (Sanity / Fury / Moon) | **Kept** | The Hunger (§5) — eating sins empowers and corrupts |
| Scars / snuffing / reconsecration | **Kept** | Judged ground stays **hallowed** briefly; the Unshriven can *blight* it back, barring re-drawing |
| The Tolling pacing engine | **Kept, made spatial** | Corteges (§7) — the bell doesn't rouse a cohort, it *marches processions down the streets* |
| Anti-fountain economy | **Kept** | Salt (§8) — the line is *paid for per meter*; sins devoured refill it |
| Finite host, clear-to-win | **Kept** | Shrive every Unshriven soul in the parish to win |
| Zero-dep SVG, pure sim, seeded duels | **Kept** | See §11 — the polyline fits the codebase better than anything since the pentagram |

The result is the **most dynamic possible member** of the family that is still recognizably *of* the
family: the same city, the same liturgy-of-light horror, the same "one verb, endlessly deepened" ethos —
at full sprint, all the time.

---

## 3. The core verb — the Litany and the Closure

- **Walking lays the line.** The hero trails a polyline of burning salt (`s.litany`, an array of timed
  segments). No button. The line is the only weapon in the game.
- **The line decays.** Each segment gutters out after `LINE_TTL` (~6–9s, tuned per parish). The visible
  decay — bright tallow-gold at your heels, dimming to ember, to ash, to gone — is the game's clock, drawn
  right on the ground.
- **Crossing your own line closes the circuit.** Segment-intersection against your own tail (the family's
  `segsCross`, reused verbatim) detects closure; the enclosed polygon is computed and **Judgment** fires:
  every Unshriven inside takes the closure's full force; dark dwellings inside are shriven (the family's
  relight, kept); the ground inside is briefly **hallowed**.
- **Size is the skill dial, speed is the resource.** A tight stutter-loop around one straggler costs two
  seconds and a pinch of salt. A whole-street circuit around a cortege is a fifteen-second gamble that the
  far end of your line survives, that nothing chews through it, and that you don't meet something worse
  coming the other way. The charge-time tension of the siblings, rebuilt out of geometry and nerve.
- **The line is a triple tool** (this is the depth that replaces the siblings' terrain-verb interactions):
  1. **Ward** — a fresh, bright segment is a wall to most of the Unshriven: they balk and mill at it.
     Lay a line *behind* you to cut off a chase; lay it *beside* a fleeing pack to steer them.
  2. **Bait** — some sins are *drawn* to the light (moths to the tallow). The line herds by attraction
     as well as fear: you can charm a pack into the killing-ground before you turn and seal it.
  3. **Blade** — the closure itself. Ward + bait + blade means every loop is a small plan: *what do I
     let in, what do I fence out, when do I close.*

**No attack button, no dash button.** Pure joystick, like the wolf — but where the wolf's depth is
pursuit, the Sin-Eater's is **penmanship under terror**.

## 4. Overreach — risk/reward on the verb (the family's overcharge, transposed)

The moment your tail first becomes *closable* (long enough to enclose anything), an **Overreach** meter
begins to bank. Every second you keep the loop open past that point, the eventual Judgment grows — wider
scorch past the drawn edge, harder bite, and at full bank a **Great Shriving**: the closure detonates
outward, hallows every dwelling on the polygon's rim, and hurls survivors back. But an open loop is an
old loop: its far end is guttering, the Gluttons (§7) are chewing it, and the Quiet (§6) is listening for
the moment you hesitate. Exactly the siblings' hold-past-full trade — *drawn across the map instead of
stood in place.*

## 5. The Hunger — the horror twist (the second bar)

Eating sins is not free. Every Judgment feeds the Sin-Eater, and the **Hunger** bar (`hero.hunger`) is the
game's occult heart, a push-your-luck corruption meter:

- **Feeding empowers.** Hunger heats the line: brighter, wider ward-authority, harder Judgments. The
  fantasy: the more of the parish's sin you carry, the more terrible your rite becomes.
- **Hunger betrays.** A hungry Sin-Eater is *conspicuous* — the Unshriven smell what you carry, aggro
  radii swell, and the sins you have eaten begin to **whisper back** (HUD text, audio hiss: the actual
  sins, in first person — *"I let her drown." "The grain was mine."*). Atmosphere delivered by mechanics.
- **At full: the Gnawing.** The bar tips and the sins eat *you* for a spell — the line runs **black**, it
  no longer wards (the dead walk it like a road, straight at you), and closures during the Gnawing judge
  *nothing* but still hallow ground. You must survive your own fast until the Hunger burns down.
- **Two deaths** (the Watcher's dyad, kept): torn apart (`hp ≤ 0`, **"rent"**) — or ending a run with the
  Hunger past its final notch too long: the Sin-Eater sits down at last, and eats, and does not get up
  (**"consumed"**). Both are loss ends on `s.lossCause`.

The **strategic loop** this creates: feed to grow strong → strength makes you loud → loudness forces
bigger, riskier circuits → bigger circuits feed you more. The snowball and the noose are the same rope.

## 6. The Quiet — stillness is death (the inversion that guarantees "dynamic")

The family's four sigil games make stillness powerful. The Sin-Eater makes it **fatal, and makes that the
horror**: in this city, the dark listens for footsteps, and it notices when they stop.

- Stand still and the **Quiet** pools around you — a visible dimming, sound draining out of the mix (the
  footstep-drum that is the score literally stops, see §10), and after a grace the nearest Unshriven turn
  their heads *all at once* toward where the walking stopped.
- Mechanically a stillness meter (`s.quiet`): below threshold, nothing; past it, aggro spikes and a
  creeping HP/salt drain. It resets the moment you move.
- There is **no safe camp anywhere** — shrines in this game (lych-gates, §9) reduce the Quiet's ramp,
  they never stop it. The design guarantee: *the player is in motion for effectively 100% of a run*,
  and motion is never aimless because motion is literally the act of drawing the weapon.

## 7. The host — the Unshriven, a taxonomy of sin

The variant roster (the family's elite/spitter/darter/healer slots) themed as the **seven deadly sins** —
each one an interaction with the *line*, not just a stat block:

- **The Craven** *(common host)* — the mass of small-sinned dead. Balk at fresh line; herdable; the
  material every circuit is built to catch.
- **Gluttons** — *chew the line.* Waddling horrors that eat your tail segment by segment, opening your
  loop from behind. The anti-circuit pressure; kill them first or draw around them.
- **Wrathful** — *chargers that cross.* The only common sin that crosses a bright line — at a run,
  taking scorch damage but breaking your geometry and forcing the loop early. Punishes greed (the
  spitter's role: pressure on the long, patient version of the verb).
- **Misers** — *hoard and flee.* Never approach; scuttle away hugging their strongboxes. Worth chasing:
  judged Misers burst into **salt** (the economy, §8). The game's moving treasure, placed to lure you
  off your plan.
- **Envious** — *mimic the line.* Trail their own cold, grey-green counterfeit litany that *looks* like
  yours in the fog. Close a circuit against a counterfeit segment and the Judgment **misfires** (feeds
  your Hunger, judges nothing). The fog-of-war horror: you must know your own handwriting.
- **The Proud** — *will not cross, will not kneel.* Stand at your line and **wail**, waking the Craven
  in a radius and stiffening them against the ward. A support/banner role; the wail is also the game's
  most frightening sound.
- **Liars (False Tongues)** — *speak with the voices you've eaten.* Cloaked shapes that whisper in the
  first-person voices of sins you're carrying; being near them **feeds the Hunger without feeding you**.
  The sanity-drain role (the gazer/friar slot), rebuilt as intimacy instead of a beam.
- **Sloth** *(the one boss-shaped thing, one per parish)* — a vast, sessile accretion of the parish's
  unconfessed weight. It never moves. It cannot be killed by any small circuit — its bulk is wider than a
  cheap loop — so it forces the run's one **mandatory Great Shriving**: a full, huge, Overreach-banked
  circuit drawn around it while everything else in the parish converges. The genre-switch moment (M3)
  without a mode switch: the boss is a *drawing test*.

## 8. Salt — the anti-fountain economy

The line is **paid for by the meter**. `s.salt` drains as you draw (faster when Hunger heats the line);
judged sins refund it (`SALT_PER_SOUL`), Misers burst with it, and a slow seep trickles **only while
below a floor** — the family's exact anti-idle clause. Run dry and you still walk, but you trail nothing:
unarmed, unwarded, loud. The economy asks the family's question in new words: *not "can I afford to raise"
but "can I afford this shape."*

## 9. Terrain — the parish as an instrument

All pure, rebuilt at `buildArena`, never persisted — the family's terrain grammar, re-fictioned:

- **Lych-gates** *(shrine slot)* — covered corpse-gates; under the roof the Quiet ramps slower and the
  line laid beneath never decays (a permanent stitch — anchor one end of a huge circuit here).
- **Bier-roads** *(pathway slot)* — the corpse-ways to the churchyard: speed the hero **and** halve the
  line's salt cost along them; the parish's natural circuit-edges, begging to be built into loops.
- **Charnel wells** *(font slot, inverted)* — the line laid within the aura is *bright twice as long*.
- **Blightground** *(scar slot)* — where the Unshriven mass long enough, ground blights: line drawn
  across it gutters in half the time. The living-arena tug-of-war: hallow vs blight, drawn in territory.
- **The fog** *(mist slot)* — the family's fog with one cruelty added: it hides the **age** of your own
  line (everything looks equally bright inside), and it is where the Envious wait.
- **Solids** — leaning headstones, plague-carts, the gibbet: `pushOut` cover that also breaks *your*
  line of sight to your own tail. Drawing blind behind the charnel-house is the expert's shortcut.

## 10. Atmosphere — the direction (the user's ask, made concrete)

The fiction sits in the shared city, **after** the Vigil: not the blaze of the pentagram but what's left
when the fire has passed — cold hearths, salt on doorsteps, a paid pariah doing the work the righteous
won't. Folk-horror, liturgical, intimate. Concretely:

- **Palette:** bone-white and tallow-gold on wet slate and peat-black; the only saturated color in the
  world is the line itself and the sin-glow of the Unshriven (each sin a sickly signature hue). Judgment
  is not a fireball — it is a **rushing dimness**, then ash falling upward inside the circle.
- **Sound is footsteps.** The score is built on the hero's own pace — walk and the drum walks with you;
  sprint and it doubles; **stop and the entire mix dies to room tone**, which is the Quiet's true
  telegraph. Bells toll flat and cracked. Judgments resolve into a single exhaled choral tone. The
  whispers (§5, §7) are the loudest thing in the game and they are barely audible. (Shell-side WebAudio
  synth, diffing sim state — the wolf's proven zero-dep pattern.)
- **Words as art.** The family's epigraph/story campaign voice, leaned harder: every judged soul prints
  its sin in one line of period prose; every parish opens with a *rubric* from the (invented) Office of
  the Eaten — the reliquary equivalent is a **Book of Sins**, filling across runs with every distinct
  confession you've devoured. Collection as liturgy (the fresco system, re-inked, `sinsEaten` in the
  legacy).
- **The hero reads wrong on purpose.** Hunched, coated, censer smoking at the hip; drawn *smaller* than
  the dead he judges. The horror stance of the family kept: you are never the monster and never safe —
  you are the professional standing in the doorway between.

## 11. Codebase fit — honest and cheap

- `sineater.ts` → `sineater.js` + `sineater.html`, TS module (`export {};`), hub tile, sibling links —
  the established sixth-game checklist (webmanifest, `sw.js` ASSETS + `CACHE` bump, icons via a
  `tools/gen-se-icons.mjs`: a salt circle broken by a single bite).
- **Pure sim:** `stepRound(s, dt, move)` runs `stepLitany → stepClosure → stepHunger → stepQuiet →
  stepUnshriven → stepCorteges → stepFields`. The litany is a plain timed polyline; closure is
  `segsCross` against own tail + a point-in-polygon test (~20 lines, even-odd rule) — **less** exotic
  math than the QR encoder the Vigil already ships. All headless-testable: `__SE_TEST__` → `__se`,
  `tools/sineater-test.mjs` (closure detection, decay, Hunger tips, Quiet ramp, seeded-arena
  fingerprint).
- **Duels work unchanged:** seeded `buildArena`, `judge()` as the centralized kill path pushing
  `s.killTimes` — the echo, token, and verdict blocks port verbatim (`GAME_TAG: "SE"`).
- **Legacy:** `sineater.legacy.v1` — runs, shrivings, `best` per parish, `sinsEaten` (the Book), salt…
  plus `unlocked`/`equipped` for the shop: four **Rounds** (line-rites) mirroring the four-item shops —
  *the Salt Round* (free, balanced), *the Tallow Round* (slow decay, long circuits; power `linger` —
  hallow persists), *the Ash Round* (fast decay, cheap tight loops; power `chain` — a judgment arcs),
  *the Marrow Round* (power `indraw` — the closing line drags the caught inward; the black-line
  capstone).
- **Art:** fully playable in procedural vector from day one (the family guarantee) — the line, the
  polygon flash, and the sin-hues are *better* as pure SVG than as sprites. Establishing scenes via a
  `tools/gen-se-art.mjs` later.
- **The heartbeat port:** the Tolling becomes cortege dispatch (§7's processions re-routed each toll);
  fervor becomes a **shriving-streak** stoked in `judge()` (same `TOLL_*`/`FERVOR_*` names, family
  convention held).

## 12. Risks & open questions

- **Loop legibility on a phone:** the tail must read at thumb-scale — decay states need strong shape
  language (solid → dashed → dotted), not just alpha. Prototype this first.
- **Degenerate stutter-loops:** tiny instant circles must not trivialize the game — minimum enclosed
  area for any Judgment, and salt cost per closure, are the two knobs.
- **Point-in-polygon cost:** trivial at this entity count (≤ ~80 bodies, one test per closure event, not
  per frame).
- **Envious counterfeits** are the most novel and least proven idea — ship the parish roster without
  them first; add once the base fog reads well.
- **Name:** *The Sin-Eater's Round* is the working title; alternates kept: *The Unquiet Round*, *The
  Long Litany*, *Salt for the Dead*.

## 13. The prototype (§3, playable)

The core verb is now prototyped: `proto/sineater-proto.html` + `proto/litany-sim.mjs` (pure sim, plain JS
ESM — deliberately outside tsconfig), headless-tested by `tools/sineater-proto-test.mjs` (run by hand; not
part of `npm test`). It proves the line laying + decay shape-language (solid → dashed → dotted), per-frame
closure detection + polygon judgment, both anti-stutter-loop knobs (`minLoopArea`, salt per px), the
anti-fountain seep, prey balk (the ward) and glutton chew (the severed strand), and seeded determinism —
with live tuning sliders and a hands-free `?demo` drive. The hub links it as "a rite under trial"
(a dashed full-width card under the class grid), and both files ship network-first via `sw.js`.
One finding already: a severed strand cannot close a circuit across the cut — the glutton is a sharper
counter than §7 guessed, and cross-strand closure (§12) is worth deciding early.

---

*The extraction, restated in one line: the family's occult liturgy — light, salt, bells, scars, the paid
outsider — with the ritual rebuilt out of pure motion, so that the drawing of the circle, the reading of
your own fading handwriting in the fog, and the hunger you feed by finishing it ARE the game.*
