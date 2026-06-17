# The Light-Bringer

An action game set in a world taught that light burns — an installable browser
**PWA**. The primary game is **The Burning Vigil**, a real-time action descent.
The original *contemplative* inversion game ships alongside it as a code-frozen
companion.

### ▶ [**Play it now → The Burning Vigil**](https://aoprisan.github.io/lightbringer/pentagram.html)

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

### ✦ [**Play the original → The Light-Bringer**](https://aoprisan.github.io/lightbringer/)


The original game in the same world, now kept around: a slower, turn-based
contemplative inversion where you tend a stolen flame across a city. ([more
below](#the-original-light-bringer))

> The world has been taught that the light burns. An order of Keepers maintains
> the Veil: a sanctioned dimness in which people live safe, obedient,
> half-asleep. You are the heretic who carries a stolen flame. The "demonic"
> figure of the setting is you, as described by your enemies. The actual
> experience of playing is illumination.

## The original Light-Bringer

The original, code-frozen game — a contemplative, turn-based inversion. Tap to
**kindle** light at a point — a dwelling, a printing press, a shrine.
Each kindling reveals geometry that was always there but unrendered: hidden
streets, suppressed frescoes, the cold faces of the Keepers. Light spreads on
its own along anything that can carry it (oil, paper, rumor).

- **Kindle (1✦):** light a point. Light spreads to neighbours along conductive streets.
- **Awaken (3✦):** bank your flame into a *person*. An awakened soul becomes an
  autonomous light source who keeps kindling **while you are away** — the idle
  layer. But every banked flame is someone the Keepers can target.
- **The Keepers snuff** the brightest light in reach. Snuffed ground does not
  return to neutral dark — it *thickens*, resists relighting, and eventually
  breeds a new Keeper. So light is precious and **placement is the strategy**.
- **The carrier burns.** Each night your maximum flame shrinks, permanently.
  You will not finish the city. The end state isn't completion — it's whether
  what you lit keeps burning without you. The win screen is the city at dawn,
  rendered only from the lights that survived.

Unbanked light dies at dawn; only light connected to an awakened soul survives.

### Two ways to play

The default is the **contemplative night** — turn-based, the city breathing once
per act. There is also a real-time **Lamplighter Run**, where you *become* the
flame and walk the streets while the Keepers hunt you. Switch between them from
the **Lamplighter Run / Classic night** link in the header (the choice is
remembered). Both run the same underlying simulation.

### Five cities to carry the flame into

On a fresh start you choose a **city** — each the same rules under different
dials, so each is a distinct puzzle, not a different game:

- **The Old City** — where you first stole the flame; an even, indifferent watch.
- **Ashfold** — dry tinder under a near-constant wind; the fire runs fast and far,
  and turns on you just as fast.
- **The Drowned Quarter** — flooded, sparse, rain-drowned; the fire crawls and
  every light stands alone. A city of patience and hearths.
- **The Glassworks** — bright, brittle, crowded, scarce of flame, and thick with a
  quick watch. A city of precision and decoys.
- **Vesper Row** *(unlocks once you carry a flame to night 4)* — the watched city,
  where the fire will not run and you must place every light by hand.

Across runs the game keeps a quiet **legacy** — the furthest night you reached,
the brightest morning you held, the most hearths you settled — shown on the
title and the end screen so each new flame has something to outdo.

## The Burning Vigil — the primary game

[**The Burning Vigil**](https://aoprisan.github.io/lightbringer/pentagram.html)
is the primary game, shipped alongside the original Light-Bringer (and linked
from its title screen): an Archero-style action descent set in the *same* world,
reusing the same five cities and the same art. Instead of tending light, you walk a
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

## Tech

A single TypeScript module rendering layered SVG (deep indigo world, light in
warm icon-gold; Keepers in cold fluorescent blue). `tsc` compiles `app.ts` →
`app.js`, and `app.js` is what ships — the only dependency is the TypeScript
compiler itself (dev-only), so the deployed runtime stays dependency-free.
Progress is saved to `localStorage`, and awakened souls keep working offline via
a bounded "while you were away" catch-up.

| File | Purpose |
| --- | --- |
| `pentagram.ts` | **The Burning Vigil** (primary game) — combat sim + rendering — compiles to `pentagram.js` |
| `pentagram.html` | The Burning Vigil page shell |
| `necro.ts` | **The Necromancer's March** spinoff — march sim + rendering — compiles to `necro.js` |
| `necro.html` | The Necromancer's March page shell |
| `app.ts` | The original Light-Bringer — game logic + rendering — compiles to `app.js` |
| `index.html` | Original Light-Bringer shell, styling, PWA tags |
| `sw.js` | Service worker — offline app-shell cache (all three games) |
| `pentagram.webmanifest`, `necro.webmanifest`, `manifest.webmanifest` | Install metadata (The Burning Vigil / The Necromancer's March / the original) |
| `icons/` | Generated PWA icons (`tools/gen-icons.mjs`) |
| `gemini-prompts/` | All self-contained Gemini ("Nano Banana") image-generation prompts (icons, frescoes, city cards, scenery + `base/` original-game sprites, `necro/` undead + village art, and the per-city sprite folders) |
| `art-prompts-output/` | Raw multi-megabyte PNGs emitted by Gemini, before optimizing into `art/` (e.g. `tools/process-city-sprites.py`) |
| `tools/pentagram-test.mjs` | Headless combat test for The Burning Vigil (`npm test`) |
| `tools/necro-test.mjs` | Headless march test for The Necromancer's March (`npm test`) |
| `tools/smoke-test.mjs` | Headless simulation test for the original (`npm test`) |
| `lightbringer.ts`, `the-light-bringer.html` | Original single-file prototype, kept for reference |

### Local run

Install once, build, then serve over HTTP (a service worker needs a real origin):

```sh
npm install
npm run build && python3 -m http.server 8000
# open http://localhost:8000/
```

`app.js` is generated by the build and git-ignored — edit `app.ts`, not `app.js`.

### Regenerate icons / run tests

```sh
node tools/gen-icons.mjs    # rewrite icons/*.png
npm test                    # compile, then exercise the simulation headlessly
npm run typecheck           # type-check without emitting
```

## Deploy (GitHub Pages)

The site is the repository root. A workflow at
`.github/workflows/deploy.yml` installs deps, compiles the TypeScript
(`app.ts` → `app.js`, `pentagram.ts` → `pentagram.js`, `necro.ts` → `necro.js`),
and publishes on every push to `main`.

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
