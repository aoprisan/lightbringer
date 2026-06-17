# The Necromancer's March — Competitor Research & Missing Features

*Research date: June 2026. Scope: where The Necromancer's March sits in the necromancer / commander-summoner
action landscape, what comparable games do that players reward, and a prioritized list of popular features
it is missing — each tied to the code seam it would hook into. Shared survivors-like / live-ops findings are
summarized briefly here; see `VIGIL_COMPETITOR_RESEARCH.md` for the fuller treatment.*

---

## 1. What The Necromancer's March is today

`necro.ts` / `necro.html` are **fully coded but unshipped** — the thematic inversion of The Burning Vigil
(carry death instead of light). Current feature inventory from the code and `NECROMANCER_PLAN.md`:

- **Core loop — commander + auto-army.** Stand near an open **grave** to raise 1–3 skeletons (costs
  **souls**); minions auto-target the nearest knight; **razing houses** (minion proximity) heals the horde.
  Clear all knights to win, lose your HP to fall.
- **Souls economy.** Raises cost souls; souls come from felling knights (+1), razing houses (+1), and a
  patient seep while below a floor. Graves hold limited raises; the horde is capped (40).
- **Raising-rites (the "weapon").** Four unlockable skeleton types (Common Grave / Barrow-Wall /
  Quick Cairn / Gallows Rite) bought with **relics**, each a distinct HP/speed/damage/count/cost profile.
  One equipped per march, chosen pre-run.
- **Knight variants (the inversion of shades).** Common, Captain (tanky leader), and **Priest** — a caster
  that locks and smites a skeleton, with two counterplays (crowd it to break concentration, or body-block
  the beam).
- **Terrain (mirrors Vigil).** Houses (raze → heal → bone-totem ally emitter; knights can reconsecrate and
  scar the ground), barricades (walls), causeways (speed lanes), wells/altars (solid), altar one-shot
  cascade, graves.
- **Meta / legacy.** Relics economy + `necromancer.legacy.v1` (overruns, relics earned, houses razed).

**What it conspicuously does *not* have (deferred from first-playable):** the Veilwarden-style **boss
duel**, a **reliquary / collection**, **perks/meta tree**, share-as-PNG, daily/leaderboard live layer,
and any in-march upgrade choice. The Vigil sibling already has the first three — so Necro starts a feature
generation behind its own twin.

---

## 2. Genre & key competitors

Necro is a **necromancer / commander-summoner action game** — you don't fight directly so much as raise,
position, and snowball an auto-fighting army. It overlaps the survivors-like field (horde, run-based, meta)
but its closest comparables are summoner/minion-army titles.

| Game | What it's known for |
| --- | --- |
| **Undead Horde** (10tons) | The clearest comparable: raise an undead army from the slain and command it. Praised as "the best" in the niche. |
| **Undead Horde 2: Necropolis** | Command **100+ units**, ~**20 distinct unit types**, raise *any unlocked* unit from remains (real army-composition control), **loot + crafting**, and a **rebuild-the-Necropolis hub** with talents/upgrades/powers. The benchmark for depth here. |
| **Diablo IV / Last Epoch / Path of Exile** minion necromancers | Deep **build variety** (Last Epoch: up to ~32 minions; PoE zoomancer armies), gear-driven scaling, minion-type specialization. |
| **The Unliving** | Necromancer action-roguelite: raise fallen enemies as a churning horde, explosive corpse mechanics, run-based. |
| Survivors-like field (Vampire Survivors, Death Must Die, Megabonk) | Shared loop expectations: in-run draft, escalating difficulty, light meta. See the Vigil doc. |

Necro's genuine differentiators: the **souls economy with a deliberate anti-fountain seep**, the
**house-razing heal/totem** loop, and the **priest counterplay** are all distinctive. The gaps below are
about (a) reaching parity with its own Vigil twin and (b) matching summoner-genre table-stakes.

---

## 3. Popular features players reward (sourced)

- **Army composition & command depth.** The headline of Undead Horde 2: raise *any unlocked* unit (not just
  what you killed), ~20 unit types, 100+ armies — players love *composing* and *directing* the horde, not
  just spawning it. ([Undead Horde 2 on Steam](https://store.steampowered.com/app/2065810/Undead_Horde_2_Necropolis/),
  [10tons presskit](https://presskit.10tons.com/sheet.php?p=undead_horde_2))
- **Loot, equipment & a build/hub layer.** Undead Horde 2's items + crafting + Necropolis rebuild; Diablo/
  Last Epoch/PoE minion builds scale via gear and skill trees. ([Maxroll D4 minion necro](https://maxroll.gg/d4/build-guides/minion-necromancer-guide))
- **In-run build variety (the survivors-like draft + evolution/synergy).** The defining engagement hook of
  the adjacent genre. ([Secret sauce of Vampire Survivors](https://jboger.substack.com/p/the-secret-sauce-of-vampire-survivors),
  [Evolution wiki](https://vampire.survivors.wiki/w/Evolution))
- **Deep persistent meta-progression.** Megabonk / Grind Survivors trees, Archero permanent upgrades.
  ([Roguelite progression systems](https://gamerant.com/roguelite-games-with-best-progression-systems/))
- **Live-ops retention.** Daily/weekly quests, rotating challenges, **micro-leaderboards (50–100)**, and
  **collection/album events**. ([Sensor Tower live-ops 2025](https://sensortower.com/blog/top-grossing-mobile-games-live-ops-strategies-2025-report),
  [PocketGamer event types](https://www.pocketgamer.biz/albums-battle-passes-and-milestones-mobiles-top-event-types-to-introduce-this-summer/))

---

## 4. Missing-feature shortlist (prioritized)

Each item names the **existing code seam**. The first wins are *parity ports* from the already-built Vigil
sibling, which is the cheapest path to depth since the patterns exist.

### P1 — Army composition & command (the genre's headline gap)
Today minions all spawn from one equipped rite and auto-target nearest. Add (a) **multiple raisable unit
types within a march** and (b) light **commands** (hold / follow / attack-move toward a point). This is
exactly what lifted Undead Horde 2 over its predecessor. **Seam:** the four raising-rites already define
distinct unit profiles read at raise time; commands ride the existing minion auto-target step in the march
frame (the necro analogue of `stepShades`/`stepCombat`). Pure-sim, no save change (live-play state).

### P2 — Boss duel (parity with Vigil)
Necro ends abruptly on the last knight; Vigil ends with the Veilwarden seal-tracing duel. Port a per-village
**final defender** using the same proven pattern. **Seam:** Vigil's `boss`/`makeSeal`/`submitTrace`/
`renderBossScene` is a transparent, test-driven template; theme it as binding a consecration/ward instead
of a Goetic seal. Transient state (no mid-march save), exactly like Vigil's `s.boss`.

### P3 — Reliquary / collection (parity with Vigil)
Necro has no collectible lifetime layer; Vigil's fresco reliquary is its strongest retention feature.
Port a **relic/grimoire collection** (per-village fragments, gallery overlay, set bonuses, PNG share).
**Seam:** Vigil's `frescoGalleryHtml` / `recordFrescoes` / `shareReliquary` are directly adaptable; store
in `necromancer.legacy.v1`, which (like Vigil's) **gains fields defaulted on load with no key bump**.

### P4 — In-march upgrade draft + rite evolution
Mirror Vigil P1/P2: a mid-march **pick-1-of-3** (bigger horde cap, cheaper raises, tougher bone, +totem
radius) and a rite that **evolves** when prerequisites stack. **Seam:** the toast/overlay surface and the
raise/horde tuning constants already exist; drive choices off knights felled / houses razed.

### P5 — Loot / equipment + hub layer
A second progression axis (relic gear that modifies horde stats) and, longer term, an Undead-Horde-2-style
**Necropolis hub** of persistent upgrades. **Seam:** the `perkMods`-style modifier-object pattern (from the
parent) + legacy-key storage; the relics economy is already the currency.

### P6 — Branching meta tree + ascension difficulty
Deeper persistent tree (horde / economy / survivability branches) and post-clear village modifiers for
replay. **Seam:** per-`LevelDef` `difficultyMult` dial + the relics picker UI; same constants-not-logic
ethos as Vigil.

### P7 — Daily march + leaderboard / achievements
Shared-seed daily village (villages are deterministic from id) with a score board, plus quests reading the
write-once-per-run-end legacy. **Seam:** scoring already exists; leaderboard needs the **planned backend**,
with an **offline personal-best** fallback first.

### Cross-cutting prerequisite — actually ship Necro
Necro is coded but **not wired**: per `NECROMANCER_PLAN.md` it needs `tsconfig.json` `include`,
`package.json` test step, `sw.js` `ASSETS` + `CACHE` bump and `isShell`, and title-screen cross-links from
`index.html` / `pentagram.html`. It is fully playable on **procedural SVG fallbacks** (no PNGs required), so
shipping it is the precondition for any feature above mattering to players.

**Recommended first build:** **P2 + P3 (boss duel + reliquary parity)** — they close the gap with Necro's
own twin using patterns that already exist and are test-driven, then **P1 (army command)** to claim the
summoner genre's headline feature.

---

## Sources

- [Undead Horde 2: Necropolis — Steam](https://store.steampowered.com/app/2065810/Undead_Horde_2_Necropolis/)
- [Undead Horde 2 presskit — 10tons](https://presskit.10tons.com/sheet.php?p=undead_horde_2)
- [Undead Horde — Steam](https://store.steampowered.com/app/790850/Undead_Horde/)
- [Review: Undead Horde — Life is Xbox](https://www.lifeisxbox.eu/review-undead-horde/)
- [Minion Necromancer Endgame Build — Maxroll (Diablo IV)](https://maxroll.gg/d4/build-guides/minion-necromancer-guide)
- [The Unliving — Steam](https://store.steampowered.com/app/986040/The_Unliving/)
- [Death Must Die — Steam](https://store.steampowered.com/app/2334730/Death_Must_Die/)
- [The Secret Sauce of Vampire Survivors — The Arcade Artificer](https://jboger.substack.com/p/the-secret-sauce-of-vampire-survivors)
- [Evolution — Vampire Survivors Wiki](https://vampire.survivors.wiki/w/Evolution)
- [Roguelite Games With The Best Progression Systems — GameRant](https://gamerant.com/roguelite-games-with-best-progression-systems/)
- [Winning with Live Ops (2025) — Sensor Tower](https://sensortower.com/blog/top-grossing-mobile-games-live-ops-strategies-2025-report)
- [Albums, battle passes and milestones — PocketGamer.biz](https://www.pocketgamer.biz/albums-battle-passes-and-milestones-mobiles-top-event-types-to-introduce-this-summer/)
