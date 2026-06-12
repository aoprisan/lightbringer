# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The Light-Bringer is a contemplative inversion game shipped as an installable, offline-capable **PWA**. It is plain HTML/CSS + a single hand-written ES module rendering layered SVG. **There is no build step and no dependencies** — GitHub Pages serves the repo root as-is, so anything that requires transpilation or `node_modules` is out of scope.

## Commands

```sh
# Run locally — must be over HTTP, not file://, because the service worker needs a real origin
python3 -m http.server 8000      # then open http://localhost:8000/

node tools/smoke-test.mjs        # headless simulation test (the only test suite)
node tools/gen-icons.mjs         # regenerate icons/*.png from code
```

There is no single-test runner; `smoke-test.mjs` is one file of ~7 assertion groups run top to bottom. To narrow your work, edit/comment assertions locally — don't add a framework.

## Architecture

### `app.js` is the entire shipped game

Everything lives in `app.js`: tuning constants, city generation, simulation, SVG rendering, persistence, and the game shell. It is structured in clearly-commented sections (Tuning → Districts → City generation → Simulation → Persistence → Rendering → Game shell). Read it top-to-bottom before changing behavior — the constants block at the top is the design surface (flame economy, tick rate, Keeper radius, idle cap, etc.). Game balance changes should almost always be constant changes, not logic changes.

### The simulation is pure and headless-testable

The core sim functions (`generateCity`, `freshGame`, `simulateTicks`, `stepSpread`, `stepAwakened`, `stepKeepers`, `kindle`, `awaken`, `snuff`, `litStats`, `applyDawn`, `saveGame`, `loadGame`, …) take a plain `g` GameState object and never touch the DOM. Rendering (`render`) is a separate pass that reads `g` and rebuilds the SVG wholesale each frame. **Keep this split:** sim mutates state, render reads it. This is what lets `smoke-test.mjs` exercise the game with no browser.

The test seam is at the bottom of `app.js`: when `globalThis.__LB_TEST__` is set, the module exports its internals on `globalThis.__lb` *instead of* calling `start()`. `smoke-test.mjs` sets that flag and stubs a minimal `localStorage` before importing. If you add a sim function that tests need, export it through that `__lb` object.

### Key invariants in the simulation

- **Snuffing is irreversible and compounding.** A snuffed node never returns to neutral dark — its `veil` thickens, damps nearby relighting, and once `veil` crosses `VEIL_REINFORCE_AT` it breeds a *new Keeper* (`reinforceVeil`). This asymmetry is the whole strategic point; don't "fix" it into something reversible.
- **Only light connected to an awakened soul survives dawn.** `applyDawn` does a flood-fill from awakened nodes; unconnected `lit` nodes fade to dark. Awakened dwellings are the persistence layer.
- **Awakened souls are the idle layer.** `stepAwakened` makes them kindle on their own, including during the "while you were away" catch-up that runs `simulateTicks` on load (bounded by `IDLE_CAP_TICKS`).

### Persistence (save format v2)

`saveGame`/`loadGame` use `localStorage` key `lightbringer.save.v2`. Only per-node scalars are stored (position, kind, state, brightness, revealed, heat, veil) as compact arrays — **edges and adjacency are NOT saved**; `finalizeCity` rebuilds them deterministically from node positions/kinds on load. So edge/adjacency generation must stay a pure function of node geometry. If you change the save shape, bump the version (`v`, `SAVE_KEY`, and the guard in `loadGame`) so old saves are rejected rather than mis-parsed.

### Service worker cache versioning

`sw.js` is cache-first app-shell caching with an explicit `ASSETS` list and a `CACHE` version string. **When you add/rename a shipped asset, add it to `ASSETS` AND bump `CACHE`** (e.g. `lightbringer-v2` → `v3`), or returning users will be served stale files from the old cache forever.

### Reference-only prototypes — do not ship

`lightbringer.ts` and `the-light-bringer.html` are the original single-file TypeScript prototype, kept for reference only. They are **not** part of the deployed game and are not wired into anything. The shipped logic in `app.js` has diverged (presses, districts, frescoes, veil reinforcement, persistence, idle catch-up). Don't edit these to change game behavior, and don't assume they're in sync with `app.js`.

## Deploy

`.github/workflows/deploy.yml` publishes the repo root to GitHub Pages on every push to `main` (or manual `workflow_dispatch`). One-time setup is Settings → Pages → Source: "GitHub Actions". The site IS the repository root — there is no `dist/`.
