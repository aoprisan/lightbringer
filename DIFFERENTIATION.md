# What We Have That's Different — Vigil & Necro Differentiation Analysis

*Companion to `VIGIL_COMPETITOR_RESEARCH.md` and `NECRO_COMPETITOR_RESEARCH.md`. Those docs listed the
genre **table-stakes we lack**. This one answers the opposite, more valuable question: **what already makes
these games genuinely different from the field, and where should we lean in instead of chasing me-too
features?** Research date: June 2026.*

---

## 1. The thesis — inversion as the moat

The project isn't one survivors-like; it's a **triptych built on inversion**:

- a frozen *contemplative* ancestor (`app.ts` / `index.html`) — the original "carry light into a dark city"
  meditation, now code-frozen but still shipping;
- **The Burning Vigil** (`pentagram.ts`) — that world made into an action descent: **carry light**;
- **The Necromancer's March** (`necro.ts`) — its literal mirror: **carry death**.

Few studios ship a game *and its mechanical mirror* in the same world, on the same engine and art pipeline.
And the inversion is not skin-deep theming — it's mechanical, point for point:

| The Burning Vigil (light) | The Necromancer's March (death) |
| --- | --- |
| Relight dark dwellings | Raze standing houses |
| Lighting a dwelling **heals** you | Razing a house **heals** the horde |
| Lit dwelling **awakens** into an ally emitter | Razed house becomes an allied **bone-totem** |
| Shades **snuff** your lights (scar the ground) | Knights **reconsecrate** razed houses (scar the ground) |
| You *are* the weapon (stand-still sigil) | You *command* the weapon (raised horde) |

That dyad — and the option to later complete it as a trilogy of stances on the same city — is a brand moat
no single competitor can copy without building two games. **Everything below is downstream of protecting and
amplifying this inversion identity.**

---

## 2. The Burning Vigil's moats

Each: *what it is → why it cuts against the genre → how to lean in.*

### Stand-still-to-attack inverts the genre's core verb
Every survivors-like — Vampire Survivors, Brotato, Megabonk, Death Must Die — is built on **perpetual
motion**: you kite forever, the weapon fires itself, standing still is death. Vigil inverts the risk model:
`penta.charge` ramps **while you hold still** and fades when you move, so the skill is *committed stillness*
in a closing swarm. That is a genuinely different verb, not a reskin.
- **Lean in:** make commitment-and-positioning the headline skill. The terrain already exists to support
  "where do I dare to plant myself" — fences as cover, shrines as snuff-proof stands, presses as
  hold-still-to-detonate smart-bombs. Add depth *there*, not by bolting on generic kiting power.
- **Seam:** `stepPentagram` / `stepCombat`, the `PENTA_*` constants, `inShrineAura`, `pushOut` against
  fences/solids.

### The arena is a living second front, not static score
In most survivors-likes the map is inert wallpaper. Vigil's city is a combatant: dwellings **heal** when lit,
**awaken** into autonomous ally emitters if held, and are **snuffed and scarred** by shades — a relit block
can be lost and the scar bars relighting. The map state pushes back in real time.
- **Lean in:** make reclaimed map-state matter to the *outcome* and *across runs*, not just the HUD counter.
- **Seam:** `kindleDwelling` / `stepDwellings` / `snuffDwelling`, conduit fuses (`stepSpread`),
  `SNUFF_VEIL_MS` scars.

### The boss is a genre switch, not a bigger enemy
Clearing the host doesn't spawn a damage-sponge — it **flips the genre**. The Veilwarden duel drops
real-time action for a **turn-based, finger-traced ritual seal** (a procedural Goetic star, bound strand by
strand, with a quickening bite and drifting veils to avoid). A tactile penmanship climax is something no
competitor ships.
- **Lean in:** grow this into a *recognizable signature* — more ritual verbs, distinct per-city seals, the
  thing people screenshot.
- **Seam:** `makeSeal` / `submitTrace` / `traceScore` / `renderBossScene`, `s.boss`.

### Compounding, irreversible scarring
Inherited from the contemplative parent: snuffing is permanent and *compounds* (veil thickens, damps
relighting, eventually breeds a new Keeper). This asymmetry runs against the forgiving, always-recoverable
roguelite grain and gives losses real weight.

### Zero-dependency, offline, instantly shareable
A distribution/tech moat rather than a gameplay one, but real: it's an installable PWA that runs fully
**offline with zero third-party runtime deps**, art has **procedural SVG/QR fallbacks**, and the game shares
itself via a **from-scratch offline QR encoder** (`qrEncode`) and native share sheet. No store, no download
gate, no network required — a competitor on Unity/Steam cannot match the friction profile.

---

## 3. The Necromancer's March's moats

### The souls "anti-fountain" seep
Idle-summoner and minion-ARPG economies trend toward fountains — stand around, accrue resource, flood the
field. Necro deliberately refuses this: souls seep **only while below a floor**, and the real fuel is
**aggression** (felling knights, razing houses each grant souls). The economy *forces forward motion and
risk* to keep raising. That's a pointed inversion of the genre's passivity.
- **Seam:** the souls grant sites in the raise/step loop; the sub-floor seep guard.

### You command an army, yet your own body still matters
Commander games usually make the avatar irrelevant once minions are out. Necro keeps **you** in the fight via
the **Priest**: a caster that locks-and-smites a skeleton, with *two* active counters — **crowd it** with
bodies to break its concentration, or **interpose your own body** on the beam to save the minion. Personal
positioning inside a commander shell is distinctive.

### Razing-as-creation — the mirror loop
Destroying the village is *constructive*: razed houses heal the horde and rise as allied **bone-totems**.
It's the exact mechanical mirror of Vigil's relight, which is what makes the dyad legible.

### Action-shell commander hybrid
ARPG-summoner army depth (variant skeletons, composition, knight types) delivered at **survivors-like pace**
on a real-time joystick — between the slow tactics of Undead Horde and the twitch of a survivors-like.

---

## 4. The tension table — moat vs. table-stakes

The earlier research recommended popular features. Some help; some would **sand off the very things above.**
Reconciled:

| Table-stakes feature | Verdict | Why |
| --- | --- | --- |
| VS-style in-run upgrade draft | **Adopt only if reframed** | A generic "pick more power" draft pulls toward kiting and dilutes stand-still / commander identity. If added, gate choices so they deepen **commitment & positioning** (e.g. reward stillness duration, totem/shrine play), not raw DPS-while-moving. |
| Generic gear / loot grind | **Avoid** | Borrowed from Diablo, off-identity. Our second progression axis should be **map-state** (relight / raze), which is uniquely ours. |
| Difficulty ascension / curses | **Adopt** | Orthogonal to identity; rides existing `difficultyMult`. |
| Dailies / leaderboards | **Adopt (later)** | Retention layer, identity-neutral. Needs the planned backend; ship offline personal-best first. |
| Boss duel & reliquary for Necro | **Adopt** | These are *our* patterns (already built in Vigil), not the field's — porting them deepens the dyad. |

**Rule of thumb:** adopt table-stakes that are *orthogonal* to the core verb (retention, difficulty,
parity); resist any that quietly push us back toward generic survivors-like motion or borrowed loot.

---

## 5. Recommendations — where to double down (ranked)

1. **Make commitment & positioning the headline skill.** Invest in the stand-still verb and the terrain that
   makes "where do I stand" a decision (shrines, presses, fences, veils). Lean *into* the inversion, not away.
2. **Make map-state the signature meta axis** — a persistent reclaimed/razed city across runs — instead of a
   borrowed gear treadmill. This is a progression system literally no competitor has, because it's downstream
   of our living-arena moat.
3. **Grow the genre-switch boss into a recognizable signature** — more ritual verbs, distinct per-city seals
   for both games (Necro gets a parity duel themed as a consecration/ward, not a Goetic seal).
4. **Market the light↔death dyad as the brand.** The triptych and the point-for-point inversion table are the
   pitch; cross-link and cross-promote the two games as mirrors, not as two unrelated entries.

---

## Sources

Differentiator claims are anchored against the same competitor set surveyed in the two research docs:

- [Best Survivors-Like Games on Mobile (2025) — MiniReview](https://minireview.io/collections/best-survivors-like-games-on-mobile-as-of-2025)
- [The Secret Sauce of Vampire Survivors — The Arcade Artificer](https://jboger.substack.com/p/the-secret-sauce-of-vampire-survivors)
- [Evolution — Vampire Survivors Wiki](https://vampire.survivors.wiki/w/Evolution)
- [Roguelite Games With The Best Progression Systems — GameRant](https://gamerant.com/roguelite-games-with-best-progression-systems/)
- [Undead Horde 2: Necropolis — Steam](https://store.steampowered.com/app/2065810/Undead_Horde_2_Necropolis/)
- [Undead Horde 2 presskit — 10tons](https://presskit.10tons.com/sheet.php?p=undead_horde_2)
- [Death Must Die — Steam](https://store.steampowered.com/app/2334730/Death_Must_Die/)
- [Winning with Live Ops (2025) — Sensor Tower](https://sensortower.com/blog/top-grossing-mobile-games-live-ops-strategies-2025-report)
