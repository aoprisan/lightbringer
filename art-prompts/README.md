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
`art/vesper/` (The Old City keeps the base `art/*.png`). These DO need a small
loader change — the render must try `art/<cityId>/<name>.png` and fall back to
`art/<name>.png` — and once shipped, every file must be added to `sw.js` `ASSETS`
with a `CACHE` bump. Until that wiring lands the sprites sit unused; the game
stays fully playable on the shared base set.
