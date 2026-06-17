# The Burning Vigil — Competitor Research & Missing Features

*Research date: June 2026. Scope: where The Burning Vigil sits in the survivors-like / Archero-like
action-roguelite landscape, what comparable games do that players reward, and a prioritized list of
popular features the game is missing — each tied to the code seam it would hook into.*

---

## 1. What The Burning Vigil is today

A self-contained, offline-capable PWA action descent (`pentagram.ts` / `pentagram.html`). The current
feature inventory, pulled from the code:

- **Core loop — stand-still auto-inscribe.** Standing still ramps `penta.charge`; a full sigil pulses AoE
  damage to "shades" within `PENTA_RADIUS` every ~320ms. Moving dodges and lets the charge fade. A city
  holds a **finite** host (`keeperCount * SHADE_PER_KEEPER`) — clear them all to win, lose your HP to fall.
- **Weapon progression (sigils).** Four unlockable sigils (The Vigil / Pyre / Quick Ember / Wrath) bought
  with **embers**, each with a distinct radius/charge/damage profile and a special power (chain, scorch,
  nova). One equipped per run, chosen pre-run.
- **Secondary objective — relight the city.** Charged pulses kindle dark dwellings (heal the hero), which
  can **awaken** into ally emitters or be **snuffed** by shades (scarring the ground). Conduits act as
  fuses; presses are one-shot cascade smart-bombs; shrines are snuff-proof safe ground; fences/pathways are
  cover and speed lanes.
- **Frescoes & the reliquary.** First-footing a place reveals painted fragments; a lifetime, per-city
  **collection** (17 across 5 cities) with set-completion ember bonuses, a gallery overlay, and PNG sharing.
- **The Veilwarden boss duel.** Clearing the host flips to a turn-based **seal-tracing** duel against a
  per-city master Keeper — a procedural Goetic seal bound strand-by-strand, with a quickening bite,
  drifting veils, and keyboard fallback.
- **Meta / legacy.** Embers economy + `pentagram.legacy.v1` (cities cleansed, best clear time, dwellings
  relit/awakened, reliquary progress). A title screen with game-link/QR sharing.

**What it conspicuously does *not* have:** any in-run upgrade/level-up choice, a branching meta tree, gear/
loot, post-clear replay difficulty, or any live/social layer (dailies, leaderboards).

---

## 2. Genre & key competitors

The Burning Vigil is a **survivors-like / Archero-like action roguelite**: one-stick movement, automatic/
positional attacking, a horde of enemies, a run that ends, and persistent progress between runs.

| Game | What it's known for |
| --- | --- |
| **Vampire Survivors** | The genre archetype. One-finger control, auto-attacking, level-up draft (pick 1 of 3), and **weapon evolution + union/synergy** combos. Light meta-progression so you never restart from zero. |
| **Archero** | Mobile progenitor of the "bullet heaven" wave. In-run ability draft each floor, plus heavy **permanent gear/equipment** and character progression. |
| **Brotato** | Tight loadout/build experiments per run, shop between waves, many characters as rule-modifiers. |
| **Death Must Die** | Survivors loop with **god/power picks** and game-breaking synergies; 91%+ positive on Steam. Strong build-craft identity. |
| **Halls of Torment** | Diablo-flavored survivors with loot drops and an explicit achievement/unlock web. |
| **Megabonk** | 3D survivors-like; ~1M sales in two weeks (late 2025). Subtle-but-meaningful meta-progression. |
| **Hades** | The run-based meta gold standard: boon drafting, escalating "Heat"/pact difficulty, and narrative threaded through repeated runs. |

The Burning Vigil's strongest *differentiators* vs. this field are real: the **stand-still weapon** is a
genuinely distinct verb, the **relight-the-city** layer is a richer secondary objective than most, and the
**seal-tracing boss** is unique. The gaps below are about meeting genre table-stakes, not copying.

---

## 3. Popular features players reward (sourced)

- **In-run build variety — the level-up draft + weapon evolution/synergy.** This is the single most-cited
  reason the genre is addictive: a constant stream of choices that compound into a build, with evolutions
  (base weapon + passive catalyst → stronger form) and union/synergy combos. ([Vampire Survivors evolution
  guide](https://www.pcgamesn.com/vampire-survivors/weapon-evolutions),
  [Evolution wiki](https://vampire.survivors.wiki/w/Evolution),
  [Secret sauce of Vampire Survivors](https://jboger.substack.com/p/the-secret-sauce-of-vampire-survivors))
- **Deep, branching meta-progression.** Megabonk's subtle-but-meaningful tree, Grind Survivors'
  pride/greed/wrath skill trees, Archero's permanent upgrades — persistent power that gives "just one more
  run" momentum. ([Rogueliker GOTY 2025](https://rogueliker.com/roguelike-game-of-the-year-2025/),
  [Roguelite progression systems](https://gamerant.com/roguelite-games-with-best-progression-systems/))
- **Multiple stages + escalating / ascension difficulty.** Replay depth after the first clear (Hades' Heat,
  VS stage variety). ([Best survivors-like mobile 2025](https://minireview.io/collections/best-survivors-like-games-on-mobile-as-of-2025))
- **Loot & equipment.** Archero's gear and Halls of Torment's drops give a second progression axis besides
  the weapon. ([Best roguelite games 2025](https://www.eneba.com/hub/games/best-roguelite-games/))
- **Live-ops retention loops** — daily/weekly quests, rotating challenges, **micro-leaderboards (groups of
  50–100)**, and **collection/album events** that motivate completion. ([Sensor Tower live-ops 2025](https://sensortower.com/blog/top-grossing-mobile-games-live-ops-strategies-2025-report),
  [PocketGamer event types](https://www.pocketgamer.biz/albums-battle-passes-and-milestones-mobiles-top-event-types-to-introduce-this-summer/))

Note: the reliquary already implements the **collection/album** retention pattern well — that's a strength
to build on, not a gap.

---

## 4. Missing-feature shortlist (prioritized)

Each item names the **existing code seam** so it's actionable later. No genre-cloning — these adapt the
proven pattern to the stand-still verb.

### P1 — In-run upgrade draft (the defining genre hook)
Today the loadout is *fixed pre-run* (one sigil). Add a mid-descent level-up that offers **pick 1 of 3**
boons (e.g. +radius, faster charge, an extra pulse arc, scorch-on-kill), letting a build emerge within a
run. **Seam:** drive choices off shade kills / `litCount`; surface the card via the existing non-modal
overlay pattern already used by `revealFresco` / `showToast` in `pgFrame` (must not hard-pause an action
fight). Pulse/charge values it would tune already live as `PENTA_*` constants read in `stepPentagram`/
`stepCombat`.

### P2 — Sigil "evolution" / synergy
Extend P1 with a Vampire-Survivors-style payoff: stacking the right boons **evolves** the equipped sigil
into a stronger form mid-run. **Seam:** the four sigils + their special powers (chain/scorch/nova) already
exist as a switchable profile in `stepPentagram`; evolution = swapping to an upgraded profile when boon
prerequisites are met.

### P3 — Branching meta tree
Replace/augment the single equipped item with a small persistent tree (radius / survivability / economy
branches). **Seam:** `pentagram.legacy.v1` already gains fields *defaulted on load with no key bump*;
the sigil-shop picker UI is the natural host. Mirror the parent's `perkMods(g)` modifier-object pattern so
balance stays "constants, not logic."

### P4 — Difficulty ascension / curse modifiers
Give cleared cities replay value with stacking modifiers (faster shades, denser host, fragile dwellings)
for greater ember payout. **Seam:** ride the existing per-`LevelDef` `difficultyMult` dial (already feeds
seal size / `maxHp`) and apply modifiers via the same modifier-object pattern as perks.

### P5 — Daily challenge run + leaderboard
A shared-seed daily descent with a score board. Cities are already **deterministic from their id**
(`generateCity` / `buildArena` rebuild identically), so a daily seed is cheap. **Seam:** score already
exists (base + speed + dwelling + survival + flawless). Leaderboard needs the **planned backend**
(CLAUDE.md flags multiplayer as an intended direction); ship an **offline personal-best** first as the
fallback, consistent with the zero-dep guideline.

### P6 — Loot / equipment axis
A second progression lane besides the sigil (charms/relics that modify stats), à la Archero/Halls of
Torment. **Seam:** same `perkMods`-style resolution + legacy-key storage; lowest priority because P1–P3
already deepen build variety with less UI surface.

### P7 — Achievements / quests feeding the legacy
Lightweight daily/weekly objectives ("relight a full city", "flawless clear") that read the already
write-once-per-run-end legacy tally. **Seam:** `recordClear` / `recordDeath` are the existing fold points.

**Recommended first build:** **P1 (in-run draft)** — it's the biggest genre gap, has the highest
engagement payoff per the sources, and slots cleanly into the existing non-modal overlay + `PENTA_*`
constant seams without touching the save format.

---

## Sources

- [Best Survivors-Like Games on Mobile (2025) — MiniReview](https://minireview.io/collections/best-survivors-like-games-on-mobile-as-of-2025)
- [Roguelike? Survivors-like is the New Wave — Lords of Gaming](https://lordsofgaming.net/2025/12/roguelike-thats-old-news-survivors-like-is-the-new-wave/)
- [Megabonk — Wikipedia](https://en.wikipedia.org/wiki/Megabonk)
- [Vampire Survivors weapon evolution guide — PCGamesN](https://www.pcgamesn.com/vampire-survivors/weapon-evolutions)
- [Evolution — Vampire Survivors Wiki](https://vampire.survivors.wiki/w/Evolution)
- [The Secret Sauce of Vampire Survivors — The Arcade Artificer](https://jboger.substack.com/p/the-secret-sauce-of-vampire-survivors)
- [Rogueliker's Game of the Year 2025](https://rogueliker.com/roguelike-game-of-the-year-2025/)
- [Roguelite Games With The Best Progression Systems — GameRant](https://gamerant.com/roguelite-games-with-best-progression-systems/)
- [16 Best Roguelite Games for 2025 — Eneba](https://www.eneba.com/hub/games/best-roguelite-games/)
- [Top Horde Survival Games / Death Must Die — ModDB](https://www.moddb.com/games/death-must-die/features/top-horde-survival-games)
- [Winning with Live Ops (2025) — Sensor Tower](https://sensortower.com/blog/top-grossing-mobile-games-live-ops-strategies-2025-report)
- [Albums, battle passes and milestones — PocketGamer.biz](https://www.pocketgamer.biz/albums-battle-passes-and-milestones-mobiles-top-event-types-to-introduce-this-summer/)
