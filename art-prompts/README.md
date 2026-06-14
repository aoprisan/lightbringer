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
| `06f-fresco-mercy-veiled-candle.txt` | Fresco — mercy as a veiled candle (`art/fresco-mercy.jpg`) |
| `06g-fresco-prayer-to-the-morning-star.txt` | Fresco — prayer to the morning star (`art/fresco-prayer.jpg`) |
| `06h-fresco-the-one-lit-window.txt` | Fresco — the one lit window (`art/fresco-window.jpg`) |
| `06i-fresco-the-carrier-burns.txt` | Fresco — the carrier burns (`art/fresco-carrier.jpg`) |
| `06j-fresco-the-passing-of-the-flame.txt` | Fresco — the passing of the flame (`art/fresco-passing.jpg`) |
| `06k-fresco-oil-and-wick.txt` | Fresco — a rumour is oil, a name a wick (`art/fresco-wick.jpg`) |
| `06l-fresco-the-lamps-kept-low.txt` | Fresco — the lamps kept low (`art/fresco-lamps.jpg`) |
| `06m-fresco-a-lamp-lit-in-secret.txt` | Fresco — a lamp lit in secret (`art/fresco-secret.jpg`) |
| `06n-fresco-scraped-whitewash.txt` | Fresco — the scraped whitewash (`art/fresco-scrape.jpg`) |
| `06o-fresco-windows-answering.txt` | Fresco — the windows that answered (`art/fresco-windows.jpg`) |
| `06p-fresco-the-remembered-ember.txt` | Fresco — the remembered ember (`art/fresco-ember.jpg`) |
| `06q-fresco-two-flames.txt` | Fresco — two flames (`art/fresco-two-flames.jpg`) |
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
