# The Moon's Hunger — review & roadmap

A working review of the werewolf spinoff (`werewolf.ts`) plus the brainstorm that came out of it:
five near-term improvements, five challenging directions, and the one picked and shipped.

## Implementation review (state as of this pass)

The core loop is sound and true to its design brief: the sim is pure and headless-testable
(`stepHunt(s, dt, move)`), render only reads state, and the whole verb set really is pure joystick —
the maul, the pounce, the bay and the stalk all fall out of position and speed. The alarm model
(radiate → spread → decay, two-phase so it's order-free) is the most interesting system in the repo's
five games, and the prey/hunter split gives it teeth.

Findings from this review:

- **Bug (fixed):** `recordHunt` never folded the hunt's kills into the lifetime `WwLegacy.slain` —
  only losses (`recordFall`) counted them, so a player who always wins showed a lifetime kill count
  of zero. `recordHunt` now takes `slainN` and banks it.
- **Perf watch-item (not changed):** `terrainSpeedMul` → `inNodeAura` scans all scenery per body per
  frame; with `CONTENT_SCALE = 9` (tripled villages) that is O(foes × scenery) ≈ hundreds of
  thousands of distance checks per frame on Direhollow. Fine today, but a per-kind node cache (the
  way `s.cairns`/`s.moonwells` are cached) is the first thing to reach for if frame time slips.
- **Legibility (fixed via the art pass):** the five watch kinds were near-identical circles; the
  alarm level — the game's one social meter — was invisible on the bodies that carry it.
- **Naming nit (left alone):** the HUD element id `souls` is inherited from Necro's shell; it shows
  the fury readout here. Harmless, but a rename would read better.
- **Structure:** the sim/AI is disciplined about single damage/death paths (`hurtFoe`/`slay`), which
  is what made the quarry feature below a ~10-line sim hook instead of a rewrite.

## Art update (shipped in this pass)

All procedural, zero PNGs, in the repo's render-fallback ethos:

- **The watch reads by silhouette now** (`drawFoe`): hooded villager; coursing hound (body stretched
  along its run, pricked ears, tail); knight with great helm, kite shield and drawn sword; huntsman
  with deep hood, bow + string and quiver; friar with tonsure, cowl and a raised cross that glows
  while it channels.
- **Panic is visible:** a prey past its flee threshold cries a gold `!` — the alarm layer at a glance.
- **The beast got a body:** wedge muzzle, streaming tail (streams harder with momentum), spine ridge.
- **The man telegraphs the turn:** cloak + hood, and his eyes kindle amber as fury crests past 0.75.
- **The moon's quarry** (below) draws a pulsing gold halo + crescent, and a gold ring on the minimap.

## Five near-term improvements

1. **A moon dial on the HUD** — the day/night wheel drives everything, but the hour is only a word
   in the readout; a small crescent-to-full dial would make the rhythm plannable.
2. **Bolt telegraphs** — huntsmen fire instantly on cooldown with line of sight; a brief aim-line
   wind-up would make silver bolts dodgeable by reaction, not just by cover.
3. **Score breakdown on a loss too** — `onLost` shows kills/dens but not the score table; showing it
   (zeroed win-bonuses and all) teaches the scoring language earlier.
4. **Sound** — a WebAudio layer (bay, bite, alarm bell, the friar's chant) would carry the fog-bound
   mood; the repo is already comfortable shipping zero-dep generated assets.
5. **Per-village art re-skins** — `loadCitySprites` machinery exists but no `art/<villageId>/` sets
   ship; even one establishing card per Outlands village (the first four have them) would help the
   picker.

## Five challenging directions

1. **The Night's Quarry** *(selected — shipped, see below)* — each true night the moon marks one of
   the watch; run it down before dawn for a blood-price. A bounty-board with no new inputs.
2. **The ghost-pack** — feed enough and fallen hounds rise to run with you (2–3 spectral wolves that
   flank and herd but can't kill), Necro's command verb re-themed to the pack the curse remembers.
3. **The Silver Lord** — a final armored wolf-hunter who arrives when the village fully rouses and
   *tracks by scent* (follows your path history, not your position): the hunter who cannot be
   out-stealthed, only out-run or ambushed.
4. **Scent itself** — the hero leaves a decaying scent trail; hounds course it (not you), rain and
   water break it. Turns stealth from a radius check into a spatial resource you manage.
5. **Asynchronous ghost hunts** — record an input trace per hunt (the sim is deterministic given the
   arena), share a code, and race a friend's ghost through the same village; the repo's stated
   multiplayer direction with no backend needed beyond a share string.

## The one implemented: The Night's Quarry

Each **true night** (daylight < `QUARRY_NIGHT_DL`) the moon **marks one living soul** of the watch —
a hunter while any stands, else a prey (`pickQuarry`). The mark is a pulsing gold halo + crescent in
the world and a gold ring on the minimap; the HUD readout says `QUARRY marked`. **Run it down before
dawn** and the kill pays a **blood-price** in `slay`: `QUARRY_FURY` fury, `QUARRY_HEAL` HP, a full
head of wolf momentum, and `SCORE_QUARRY` banked per claim (`scoreRun` breakdown row + win overlay
line). At dawn an unclaimed mark **fades** — the moon does not wait — and the next nightfall marks
anew (one mark per night; a claim doesn't re-roll).

Why this one: it gives every night a *direction* (the sandbox's biggest gap), it deepens the
day/night twist rather than adding a parallel system, it stays pure joystick (no new inputs), and it
lands entirely in the sim (`stepQuarry` + a `slay` hook), so it's headless-testable — see the Q1–Q6
group in `tools/werewolf-test.mjs`.
