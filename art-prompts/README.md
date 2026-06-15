# Art prompts — one file per prompt (copy-paste ready)

Each `.txt` file here is a single, self-contained prompt for **Gemini 2.5 Flash
Image ("Nano Banana")**. The house style is already baked into every file, so
you can open one on your phone and copy-paste the whole thing — no assembling
pieces. The full guide with integration notes lives in `../ART_PROMPTS.md`.

| File | What it makes |
| --- | --- |
| `01-app-icon.txt` | App icon — stolen flame (512 + 192) |
| `01b-app-icon-maskable.txt` | Maskable icon variant (safe-zone padding) |
| `02-favicon-apple-touch.txt` | Favicon / apple-touch (180) |
| `03-social-share-card.txt` | Social / share card (og-image, 1200x630) |
| `04-title-intro-backdrop.txt` | Title / intro backdrop (portrait 9:16) |
| `05-keeper-sigil.txt` | Keeper sigil / threat marker (transparent) |
| `06a-fresco-sun-and-faces.txt` | Fresco — sun and upturned faces |
| `06b-fresco-printing-press.txt` | Fresco — printing press in flame |
| `06c-fresco-child-and-candle.txt` | Fresco — child reaching for a candle |
| `06d-fresco-veil-curtain.txt` | Fresco — veil as a lifted curtain |
| `06e-fresco-sunrise.txt` | Fresco — sunrise over a sleeping city |
| `07a-texture-vellum-whitewash.txt` | Texture — vellum / whitewash grain |
| `07b-texture-ink-veil.txt` | Texture — ink veil (thickening dark) |
| `08a-city-old.txt` | City card — The Old City (`art/city-old.jpg`) |
| `08b-city-ashfold.txt` | City card — Ashfold (`art/city-ashfold.jpg`) |
| `08c-city-drowned.txt` | City card — The Drowned Quarter (`art/city-drowned.jpg`) |
| `08d-city-glassworks.txt` | City card — The Glassworks (`art/city-glassworks.jpg`) |
| `08e-city-vesper.txt` | City card — Vesper Row (`art/city-vesper.jpg`) |
| `09a-sprites-ashfold.txt` | Per-city sprite set — Ashfold (`art/ashfold/*.png`) |
| `09b-sprites-drowned.txt` | Per-city sprite set — The Drowned Quarter (`art/drowned/*.png`) |
| `09c-sprites-glassworks.txt` | Per-city sprite set — The Glassworks (`art/glassworks/*.png`) |
| `09d-sprites-vesper.txt` | Per-city sprite set — Vesper Row (`art/vesper/*.png`) |
| `10-pentagram-sigil.txt` | Pentagram sigil — the spinoff's weapon (procedural, no PNG) |
| `11-sprites-vigil-states.txt` | Burning Vigil scenery states — charged conduit, spent press, consecrated shrine (`art/*.png`) |
| `12a-walkway.txt` | Burning Vigil walkway / speed-lane tile — tiled down each pathway (`art/pathway.png`) |
| `12b-fence.txt` | Burning Vigil obstacle / fence-barricade tile — tiled down each fence (`art/fence.png`) |

Aspect ratios and transparent-background notes are already written into each
prompt where they apply.

The `08*` city cards are the **establishing illustration for each city** on the
choose-a-city intro (`g.level.art`). They are strictly optional — the picker
falls back to text alone when a card is absent, so these are **not** listed in
`sw.js` `ASSETS`. Drop the generated `art/city-*.jpg` files in and they appear;
no code change needed.

The `09*` files re-skin the **built world per city** so the boards actually look
different — ground + the four dwelling states + conduit + press + shrine, eight
sprites each, on the same silhouettes as the base set. The **Keepers, the
player-lantern, the veil-scar, and the flame-spark stay shared** across all
cities (universal forces), so each city only needs those eight. Each set drops
into a city subfolder: `art/ashfold/`, `art/drowned/`, `art/glassworks/`,
`art/vesper/` (The Old City keeps the base `art/*.png`).

**The loader is already wired** (`spriteFor` / `loadCitySprites` in `app.ts`): the
render prefers `art/<cityId>/<name>.png` and silently falls back to the base
`art/<name>.png` when a city sprite is absent. So you can drop any subset of a
city's PNGs in and they appear immediately — no code change. The only follow-up
when you ship a set is **offline**: add the new `art/<cityId>/*.png` files to
`sw.js` `ASSETS` and bump `CACHE`, or returning offline users keep the base
look (they're fetched/cached opportunistically online in the meantime).

The `12*` files are **tiled terrain** for the Burning Vigil: `art/pathway.png`
(the swift walkway lanes) and `art/fence.png` (the linear obstacle barricades).
Unlike the point sprites, these are laid as an **SVG pattern tiled down each
segment**, so they must be **seamless left-to-right tiles** (the left edge wraps
into the right). **The loader is already wired** (`pathway`/`fence` in
`SPRITE_NAMES`, the `walkwayPat`/`fencePat` patterns in `scaffold`): when a PNG
is present the render tiles it down the lane/wall, and when absent it silently
falls back to the procedural lines — so you can drop either file in and it
appears, no code change. Like the city sprites they are **optional and so NOT in
`sw.js` `ASSETS`** (a 404 there breaks the whole offline install); when you ship
them, add `./art/pathway.png` / `./art/fence.png` to `ASSETS` and bump `CACHE`.
