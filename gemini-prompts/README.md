# Gemini prompts — one file per prompt (copy-paste ready)

Every `.txt` file in this folder (and its subfolders) is a single, self-contained
prompt for **Gemini 2.5 Flash Image ("Nano Banana")**. This is the **one home**
for all of the project's Gemini image-generation prompts. The house style is
already baked into every file, so you can open one on your phone and copy-paste
the whole thing — no assembling pieces. The two narrative guides with integration
notes live at `../ART_PROMPTS.md` (the Burning Vigil / icon set, this folder's
top level) and `../ART_PLAN.md` (the original-game base sprites, `base/`).

## Folder layout

| Path | What it holds |
| --- | --- |
| `gemini-prompts/*.txt` | The Burning Vigil + shared set: icons, frescoes, city cards, per-city sprite-set prompts, Vigil scenery, walkway/fence, Necromancer icons (the table below) |
| `gemini-prompts/base/` | The original Light-Bringer's base sprite prompts (ground, the four dwelling states, conduit/press/shrine, the Keepers, lantern, scar, flame, weather) — see `../ART_PLAN.md` |
| `gemini-prompts/necro/` | The Necromancer's March undead sprites + village art (and the walk-cycle image-edit scripts) |
| `gemini-prompts/{ashfold,drowned,glassworks,vesper}/` | The eight re-skinnable sprites per city (the split form of the `09*` prompts) |
| `gemini-prompts/werewolf/` | The Moon's Hunger sprites (man/wolf hero, watch, scenery) + village establishing art |

Raw, unoptimized PNGs that Gemini emits go in **`../art-prompts-output/`** (kept
out of this folder so prompts and outputs stay cleanly separated); the per-city
PNGs are dropped in `../art-prompts-output/<city>/` and optimized into
`art/<city>/` by `tools/process-city-sprites.py`.

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
| `06f-fresco-shrouded-mercy.txt` | Fresco — the dimness called mercy |
| `06g-fresco-morning-star.txt` | Fresco — pray for us, morning star |
| `06h-fresco-lit-window.txt` | Fresco — what is lit cannot be unseen |
| `06i-fresco-the-carrier.txt` | Fresco — the carrier burns |
| `06j-fresco-city-self-lighting.txt` | Fresco — the city wins itself |
| `06k-fresco-rumor-wick.txt` | Fresco — a rumor is oil, a name a wick |
| `06l-fresco-lamps-kept-low.txt` | Fresco — lamps kept low, dark called holy |
| `06m-fresco-secret-lamp.txt` | Fresco — a lamp lit in secret |
| `06n-fresco-scratched-whitewash.txt` | Fresco — scratch the whitewash, remember |
| `06o-fresco-answering-windows.txt` | Fresco — the windows that answered |
| `06p-fresco-remembered-ember.txt` | Fresco — the dark was never the enemy |
| `06q-fresco-two-flames.txt` | Fresco — two flames see farther |
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
| `10-pentagram-sigil.txt` | Pentagram sigil — The Burning Vigil's weapon (procedural, no PNG) |
| `11-sprites-vigil-states.txt` | Burning Vigil scenery states — charged conduit, spent press, consecrated shrine (`art/*.png`) |
| `12a-walkway.txt` | Burning Vigil walkway / speed-lane tile — tiled down each pathway (`art/pathway.png`) |
| `12b-fence.txt` | Burning Vigil obstacle / fence-barricade tile — tiled down each fence (`art/fence.png`) |
| `13-necro-app-icon.txt` | Necromancer's March app icon — skull crowned with green flame (512 + 192) |
| `13b-necro-app-icon-maskable.txt` | Necro maskable icon variant (safe-zone padding) |
| `13c-necro-favicon-apple-touch.txt` | Necro favicon / apple-touch (180) |
| `13d-necro-logo-emblem.txt` | Necro title logo / emblem — skull in a green raising-pentagram (transparent, `art/necro-logo.png`) |

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

The `werewolf/` folder covers The Moon's Hunger (`werewolf.ts`), which currently
ships with **zero gameplay PNGs** (only its procedurally-generated PWA icons are
in `sw.js`). It is the exact set `werewolf.ts`'s `SPRITE_NAMES` probes for, so
dropping any subset of these files into `art/` makes them appear immediately —
no code change needed, the loader (`loadSprites`/`spriteFor`) already silently
falls back to the procedural render for whatever's missing:

| File | What it makes |
| --- | --- |
| `ground.txt` | Village/track ground tile (seamless, `art/ground.png`) |
| `field.txt` | Small moor-scrub clutter, the most common scenery point (`art/field.png`) |
| `stone.txt` | Standing stone, a solid obstacle (`art/stone.png`) |
| `cottage.txt` | Thatched dwelling, a solid obstacle (`art/cottage.png`) |
| `cairn.txt` | Cairn — dormant/unclaimed state (`art/cairn.png`) |
| `cairn-marked.txt` | Cairn — claimed as the wolf's den (`art/cairn-marked.png`) |
| `cairn-cleansed.txt` | Cairn — scoured clean by a hunter (`art/cairn-cleansed.png`) |
| `moonwell.txt` | Moonwell — a pool the moon always reaches (`art/moonwell.png`) |
| `wall.txt` | Hedgerow/drystone wall tile (seamless, `art/wall.png`) |
| `path.txt` | Village lane tile (seamless, `art/path.png`) |
| `wolf-human.txt` | The hero, MAN form — the player avatar (`art/wolf-human.png`) |
| `wolf-beast.txt` | The hero, WOLF form — the player avatar (`art/wolf-beast.png`) |
| `villager.txt` | Fleeing villager, common prey (`art/villager.png`) |
| `hound.txt` | Fleeing watch-hound, fast/frail prey (`art/hound.png`) |
| `knight.txt` | Armed knight, the watch's heavy melee (`art/knight.png`) |
| `huntsman.txt` | Crossbowman, the watch's ranged threat (`art/huntsman.png`) |
| `friar.txt` | Friar, the watch's anti-werewolf caster (`art/friar.png`) |
| `village-thornwick.txt` | Village card — Thornwick (`art/village-thornwick.jpg`) |
| `village-greymoor.txt` | Village card — Greymoor (`art/village-greymoor.jpg`) |
| `village-hollowby.txt` | Village card — Hollowby (`art/village-hollowby.jpg`) |
| `village-wulfmere.txt` | Village card — Wulfmere (`art/village-wulfmere.jpg`) |

The house palette is its own identity, distinct from the Vigil's gold and Necro's
necrotic green: deep night-indigo (`#070912`) and pale ice-blue moonlight
(`#cfe0ff`), blood-curse red (`#c83344`/`#ff6a7a`) reserved for the wolf and its
mark, and warm hearth-amber (`#ffcf7a`) reserved for the human village and its
watch — a mortal warmth set against the cold curse. `wolf-human.png` and
`wolf-beast.png` are the same cursed character in two states and share a single
visual thread (a dark travelling cloak, intact on the man, torn to a scrap on the
wolf) so the transformation reads as one soul, not two creatures. The four
village cards cover the four villages whose `LevelDef` already sets an `art`
path (`thornwick`/`greymoor`/`hollowby`/`wulfmere`); the four Outlands villages
(`ashthorn`/`mirefen`/`galehead`/`direhollow`) don't yet have an `art` field
wired up, and the expanded terrain vocabulary (pyres, bogs, glades, woods, etc.)
is deliberately **procedural-only** per `werewolf.ts` — no PNGs are planned for
those. Like the other establishing cards, the village cards are optional and
**not** in `sw.js` `ASSETS`; the point sprites above ARE the game's only
gameplay art, so once you ship any of them, add the corresponding `art/*.png`
to `ASSETS` and bump `CACHE`.
