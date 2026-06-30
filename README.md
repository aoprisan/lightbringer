# The Light-Bringer

A set of action games set in a world taught that light burns — an installable
browser **PWA**. They are unified behind a **class-select front door**: open the
game, **choose a class**, and that choice launches one of the four games (for now
each class simply *is* one of the games). The primary game is **The Burning
Vigil**, a real-time action descent.

### ▶ [**Play it now → choose your class**](https://aoprisan.github.io/lightbringer/)

Pick a class on the front door, or jump straight to one below.

### ▶ [**The Burning Vigil**](https://aoprisan.github.io/lightbringer/pentagram.html)

The primary game: an Archero-style action descent. Stand still to inscribe a
burning pentagram that scorches the shades around you, move to dodge — clear
every shade to cleanse the city. ([more below](#the-burning-vigil--the-primary-game))
No install required — it runs in the browser; on mobile, use *Add to Home
Screen* to install it as an offline app.

### ☠ [**Play the spinoff → The Necromancer's March**](https://aoprisan.github.io/lightbringer/necro.html)

A real-time "commander" spinoff that **thematically inverts** the others: instead
of carrying light, you are a **necromancer** marching on a defended village. Stand
by a **grave** to raise skeletons (they cost *souls*); your horde auto-fights the
**knights** who guard the village; raze **houses** to heal the dead. Defeat every
knight to overrun the village; lose your own health and you fall. ([more
below](#the-necromancers-march--the-inversion-spinoff))

### 👁 [**Play the spinoff → The Watcher at the Threshold**](https://aoprisan.github.io/lightbringer/eldritch.html)

A **Lovecraftian** sibling spinoff. You are an **investigator** who stands
still to trace the **Elder Sign** — a sigil that **banishes** the eldritch host
pouring from the rifts. The twist is **Sanity**, a second life-bar: tracing the
Sign *and* the host's nearness both drain it. Seal the **ward-stones** and gather
the **clue-motes** the banished leave to steady your mind. Banish every horror to
seal the threshold — lose your health and you are *slain*, lose your sanity and
you go *mad*. ([more below](#the-watcher-at-the-threshold--the-lovecraftian-spinoff))

### 🌑 [**Play the spinoff → The Moon's Hunger**](https://aoprisan.github.io/lightbringer/werewolf.html)

A **werewolf** sibling spinoff in a misty 13th-century Britain. You are a **cursed
soul**: stand still to **bay at the moon** and stoke your **Fury**. The twist is a
living **day/night moon cycle** that drives your **Form** — by moonlight fury swells
until you **turn beast** (the only shape that can fight: stand still as the wolf to
trace a blood-moon **maw** that rends the village watch), and by daylight it bleeds
you back to a hunted man. Feed to hold the change, dodge the huntsmen's silver bolts,
and cut down every soul to claim the village. ([more
below](#the-moons-hunger--the-werewolf-spinoff))

> The world has been taught that the light burns. An order of Keepers maintains
> the Veil: a sanctioned dimness in which people live safe, obedient,
> half-asleep. You are the heretic who carries a stolen flame. The "demonic"
> figure of the setting is you, as described by your enemies. The actual
> experience of playing is illumination.

> *The original contemplative, turn-based Light-Bringer has been retired — the
> repo now ships only the four real-time action games above, reached from the
> class-select front door.*

## The Burning Vigil — the primary game

[**The Burning Vigil**](https://aoprisan.github.io/lightbringer/pentagram.html)
is the primary game, reached from the class-select front door: an Archero-style
action descent. Instead of tending light, you walk a
flame-hero through a city and **stand still to inscribe a pentagram** on the
ground — a burning sigil that pulses damage to every *shade* (the city's watch,
risen against you) in its ring. Move and the sigil fades and you dodge; stand and
it scorches. Each city holds a **finite** host of shades — clear them all and the
city is cleansed; lose your health and you fall. It is its own installable PWA
page, with its own quiet legacy (cities cleansed, best clear time).

## The Necromancer's March — the inversion spinoff

[**The Necromancer's March**](https://aoprisan.github.io/lightbringer/necro.html)
is a third sibling game (`necro.ts` / `necro.html`) that **inverts** the parent's
premise. Where the Light-Bringer kindles homes, here you are the **necromancer**:
you walk a village as its dead rise behind you, raising a horde of skeletons from
its **graves** and overrunning the **knights** who defend it. It is real-time
"commander" play — move with a joystick (or WASD); standing near a grave raises
1–3 skeletons for *souls*; your minions follow and auto-target the nearest knight;
the watch fights back against both the horde and you. **Razing houses** heals the
horde (a secondary objective that inverts the Vigil's lit-dwelling layer), and a
held razed house rises into a bone-**totem** that fires on the watch. Defeat every
knight to **overrun** the village; let your own health fall to zero and the march
ends. It shares the world, the cities (re-themed as villages), and the art system
— every undead sprite has a procedural SVG fallback, so it is **fully playable
before any of its PNGs exist**. Like the others it is its own installable PWA page
with its own legacy key (villages overrun, best clear time, houses razed).

## The Watcher at the Threshold — the Lovecraftian spinoff

[**The Watcher at the Threshold**](https://aoprisan.github.io/lightbringer/eldritch.html)
is a fourth sibling game (`eldritch.ts` / `eldritch.html`), set in **H. P.
Lovecraft's mythos**. It reuses the Burning Vigil's "you *are* the weapon, stand
still" core, re-themed: you walk an **investigator** through a doomed place and
**stand still to trace the Elder Sign** — a sigil that **banishes** the eldritch
host (Deep Ones, Byakhee, Star-Spawn, Nightgaunts, cultists) pouring from the
rifts. Clear the finite host to **seal the threshold**. The defining twist is
**Sanity**, a second life-bar nothing else here has: tracing the Sign frays the
mind, the host's nearness bleeds it (dread), and a Nightgaunt's gaze lances it at
range — restore it at **sealed ward-stones** and from **clue-motes**. Lose your
health and you are **slain**; lose your sanity and you go **mad** — two different
ends. Four places (Innsmouth, Dunwich, Kingsport, R'lyeh), an unlockable **Sign**
shop (Elder / Yellow / Voorish / Naacal) bought with *lore*, and its own legacy
key. Like the others it ships as its own installable PWA page, **fully playable
before any of its PNGs exist** — every sprite has a procedural SVG fallback.

## The Moon's Hunger — the werewolf spinoff

[**The Moon's Hunger**](https://aoprisan.github.io/lightbringer/werewolf.html)
is a fifth sibling game (`werewolf.ts` / `werewolf.html`), set in a misty,
fog-bound **13th-century Britain** of thatch villages and standing stones. It
reuses the Burning Vigil's "you *are* the weapon, stand still" core, re-themed
onto the **lycanthrope's curse**: you walk a cursed soul through a sleeping
village and cut down the watch (villagers, hounds, men-at-arms, huntsmen, friars)
to **claim the village**. The defining twist is the **moon** — a living day/night
cycle nothing else here has: it drives your **Fury**, and fury drives your
**Form**. You begin a **man**, frail and unable to fight; stand still to **bay at
the moon** and, under moonlight, fury swells until you **turn beast**. As the
**wolf** you stand still to trace a blood-moon **maw** that rends the watch — the
only shape that can attack. Feed (kill) to hold the change; daylight bleeds it
back to a hunted man. Innovations make the twist spatial: **moonwells** (pools
where the moon always reaches, so you can turn even by day) and drifting **mist
banks** (the wolf's cover — huntsmen can't see you, the watch is slow to rouse).
Four villages (Thornwick, Greymoor, Hollowby, Wulfmere), an unlockable **pelt**
shop (Grey / Dire / Fell / Black) bought with *moonstones*, and its own legacy
key. Ships as its own installable PWA page with a generated full-moon icon,
**fully playable before any of its gameplay PNGs exist** — every sprite has a
procedural SVG fallback.

## Tech

Hand-written TypeScript modules rendering layered SVG (deep indigo world, light in
warm icon-gold; foes in cold fluorescent blue). `tsc` compiles each game's `.ts`
→ `.js`, and those `.js` files are what ship — the only dependency is the
TypeScript compiler itself (dev-only), so the deployed runtime stays
dependency-free. The class-select hub (`index.html`) is plain static HTML/CSS.
Per-run progress and cross-run legacy are saved to `localStorage`.

| File | Purpose |
| --- | --- |
| `pentagram.ts` | **The Burning Vigil** (primary game) — combat sim + rendering — compiles to `pentagram.js` |
| `pentagram.html` | The Burning Vigil page shell |
| `necro.ts` | **The Necromancer's March** spinoff — march sim + rendering — compiles to `necro.js` |
| `necro.html` | The Necromancer's March page shell |
| `eldritch.ts` | **The Watcher at the Threshold** spinoff — watch sim + rendering — compiles to `eldritch.js` |
| `eldritch.html` | The Watcher at the Threshold page shell |
| `werewolf.ts` | **The Moon's Hunger** spinoff — hunt sim + rendering — compiles to `werewolf.js` |
| `werewolf.html` | The Moon's Hunger page shell |
| `index.html` | The class-select hub — the front door (pick a class, launch its game), styling, PWA tags |
| `sw.js` | Service worker — offline app-shell cache (the hub + all four games) |
| `pentagram.webmanifest`, `necro.webmanifest`, `eldritch.webmanifest`, `werewolf.webmanifest`, `manifest.webmanifest` | Install metadata (The Burning Vigil / The Necromancer's March / The Watcher at the Threshold / The Moon's Hunger / the class-select hub) |
| `icons/` | Generated PWA icons (`tools/gen-icons.mjs`) |
| `gemini-prompts/` | All self-contained Gemini ("Nano Banana") image-generation prompts (icons, frescoes, city cards, scenery + `base/` original-game sprites, `necro/` undead + village art, and the per-city sprite folders) |
| `art-prompts-output/` | Raw multi-megabyte PNGs emitted by Gemini, before optimizing into `art/` (e.g. `tools/process-city-sprites.py`) |
| `tools/pentagram-test.mjs` | Headless combat test for The Burning Vigil (`npm test`) |
| `tools/necro-test.mjs` | Headless march test for The Necromancer's March (`npm test`) |
| `tools/eldritch-test.mjs` | Headless watch test for The Watcher at the Threshold (`npm test`) |
| `tools/werewolf-test.mjs` | Headless hunt test for The Moon's Hunger (`npm test`) |
| `lightbringer.ts`, `the-light-bringer.html` | Original single-file prototype, kept for reference |

### Local run

Install once, build, then serve over HTTP (a service worker needs a real origin):

```sh
npm install
npm run build && python3 -m http.server 8000
# open http://localhost:8000/
```

The `.js` files are generated by the build and git-ignored — edit the `.ts`, not
the compiled `.js`.

### Regenerate icons / run tests

```sh
node tools/gen-icons.mjs    # rewrite the parent icons/*.png
node tools/gen-ww-icons.mjs # rewrite the werewolf icons/werewolf-*.png
npm test                    # compile, then exercise the simulation headlessly
npm run typecheck           # type-check without emitting
```

## Deploy (GitHub Pages)

The site is the repository root. A workflow at
`.github/workflows/deploy.yml` installs deps, compiles the TypeScript
(`pentagram.ts` → `pentagram.js`, `necro.ts` → `necro.js`,
`eldritch.ts` → `eldritch.js`, `werewolf.ts` → `werewolf.js`), and publishes on
every push to `main`.

One-time setup: **Settings → Pages → Build and deployment → Source:
"GitHub Actions"**. Then merge to `main` (or run the workflow manually via
*Actions → Deploy to GitHub Pages → Run workflow*) and the PWA goes live at
`https://<user>.github.io/<repo>/` — for this repository,
[`https://aoprisan.github.io/lightbringer/`](https://aoprisan.github.io/lightbringer/).

## License

**Proprietary — All Rights Reserved.** Copyright © 2026 Andrei Oprisan.

The source is public for demonstration only. It is **not** open source: no
permission is granted to use, copy, modify, distribute, or commercialize it.
See [`LICENSE`](LICENSE). For licensing inquiries, contact aoprisan@gmail.com.

*Ora pro nobis, Lucifer.*
