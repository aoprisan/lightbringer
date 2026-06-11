# The Light-Bringer

A contemplative inversion game — an installable browser **PWA**, playable offline.

> The world has been taught that the light burns. An order of Keepers maintains
> the Veil: a sanctioned dimness in which people live safe, obedient,
> half-asleep. You are the heretic who carries a stolen flame. The "demonic"
> figure of the setting is you, as described by your enemies. The actual
> experience of playing is illumination.

## Play

Tap to **kindle** light at a point — a dwelling, a printing press, a shrine.
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

## Tech

No build step, no dependencies. Plain HTML/CSS + a single ES module rendering
layered SVG (deep indigo world, light in warm icon-gold; Keepers in cold
fluorescent blue). Progress is saved to `localStorage`, and awakened souls keep
working offline via a bounded "while you were away" catch-up.

| File | Purpose |
| --- | --- |
| `index.html` | App shell, styling, PWA tags |
| `app.js` | Game logic + rendering (the whole game) |
| `sw.js` | Service worker — offline app-shell cache |
| `manifest.webmanifest` | Install metadata |
| `icons/` | Generated PWA icons (`tools/gen-icons.mjs`) |
| `tools/smoke-test.mjs` | Headless simulation test (`node tools/smoke-test.mjs`) |
| `lightbringer.ts`, `the-light-bringer.html` | Original single-file prototype, kept for reference |

### Local run

It's static — serve the folder over HTTP (a service worker needs a real origin):

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

### Regenerate icons / run tests

```sh
node tools/gen-icons.mjs    # rewrite icons/*.png
node tools/smoke-test.mjs   # exercise the simulation headlessly
```

## Deploy (GitHub Pages)

The site is the repository root. A workflow at
`.github/workflows/deploy.yml` publishes it on every push to `main`.

One-time setup: **Settings → Pages → Build and deployment → Source:
"GitHub Actions"**. Then merge to `main` (or run the workflow manually via
*Actions → Deploy to GitHub Pages → Run workflow*) and the PWA goes live at
`https://<user>.github.io/<repo>/`.

*Ora pro nobis, Lucifer.*
