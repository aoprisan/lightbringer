# Art prompts — The Light-Bringer (Gemini "Nano Banana")

Prompts for generating game art with **Gemini 2.5 Flash Image ("Nano Banana")**.
Every prompt is tuned to the game's existing palette and tone so output drops in
without a re-skin. Keep the world coherent: a city taught that *light burns*,
lit by a single stolen gold flame, patrolled by cold-blue Keepers.

## House style (paste at the top of any prompt)

> Contemplative, reverent, illuminated-manuscript meets minimal poster art.
> Deep indigo night `#080a14`, warm gold light `#e8b34b` and `#ffd87a` with a
> near-white hot core `#fff2cf`, cold steel-blue accents `#9fc4e8`. High
> contrast, lots of negative darkness, soft volumetric glow, subtle film grain.
> No text, no watermark, no logos, no people's faces unless asked. Painterly but
> restrained — sacred, quiet, a little melancholy.

When you want a transparent asset, add: *"on a transparent background, isolated
subject, no backdrop."* Nano Banana honors aspect-ratio requests — state it
explicitly (e.g. *"square 1:1"*, *"portrait 9:16"*, *"wide 1.91:1"*).

---

## 1. App icon — the stolen flame (replaces `icons/icon-512.png`)

> [House style]. App icon: a single small teardrop flame of warm gold light
> floating in the center, glowing against deep indigo night. The flame has a
> bright near-white core, a gold body, and a soft radial halo fading into the
> dark. Minimal, iconic, centered, symmetrical. Square 1:1. No text. Subtle
> vignette at the corners.

Export at 512×512 and 192×192. Generate a **maskable** variant by adding:
*"keep all important detail within the centered 60% safe zone, generous even
padding on all sides, the glow may extend to the edges."* (→ `maskable-512.png`)

## 2. Favicon / apple-touch (180×180)

> [House style]. Same gold teardrop flame as the app icon but simplified for a
> tiny size: bolder core, thicker glow, minimal fine detail so it reads at
> 32px. Centered, square 1:1, deep indigo background.

## 3. Social / share card (`og-image`, 1200×630)

> [House style]. Wide cinematic banner, 1.91:1. A dark medieval city seen from
> above as a sparse constellation of warm gold pinpoints of light connected by
> faint glowing threads, most of the city still drowned in indigo darkness. One
> light is brightest, with a soft bloom. Cold blue diamond sentinels watch from
> the shadows at the edges. Empty space in the upper third for a title to be
> added later. Moody, atmospheric, volumetric glow, film grain.

Wire it in `index.html` `<head>`:
```html
<meta property="og:image" content="./icons/og-image.png">
<meta name="twitter:card" content="summary_large_image">
```

## 4. Title / intro backdrop (portrait, optional)

Decorative art behind the intro overlay. Generate dark enough that gold text
stays legible on top.

> [House style]. Vertical 9:16 poster. A lone hooded figure seen from behind,
> small at the bottom, cupping one tiny gold flame in their hands, looking up at
> a vast dark cathedral-city of unlit towers and rooftops above them. The flame
> is the only warm light; everything else is deep indigo and shadow. Negative
> space and darkness fill the top two-thirds. Reverent, lonely, painterly,
> volumetric god-rays from the flame. No text.

To use it, set it as a low-opacity layer behind `#overlay` (z-index below the
panel) and keep `backdrop-filter` so text stays readable.

## 5. Keeper sigil / threat marker

> [House style]. A cold heraldic emblem: a steel-blue diamond (rotated square)
> with a single dark vertical slit like a watchful eye at its center, faint icy
> glow, surrounded by a thin dashed patrol ring. Symmetrical, minimal, ominous,
> on a transparent background. Square 1:1. Cold palette only — no gold.

Useful for a how-to-play screen or store listing; the in-game Keeper is drawn in
SVG and needs no asset.

## 6. Frescoes "beneath the whitewash" (a matched set)

The game reveals painted lines as the city lights (see `FRESCOES` in `app.ts`).
Generate small illustrations to accompany the most quotable ones. Keep them a
**consistent series** — same technique, same cracked-plaster ground.

Base recipe:

> [House style]. A faded medieval fresco fragment painted on cracked whitewashed
> plaster, the whitewash partly scraped away to reveal warm ochre-and-gold
> imagery glowing softly beneath. Weathered, sacred, aged, hairline cracks, gold
> leaf catching light. Square 1:1. No modern elements, no text. SUBJECT: {…}

Swap `{SUBJECT}` per fresco:

- *"a radiant sun, and beneath it rows of small upturned human faces"*
  (for "Beneath the whitewash: a sun, and under it, our faces.")
- *"a printing press wreathed in flame, pages turning into birds of light"*
  (for "Here a press once ran…")
- *"a child reaching toward a candle while a robed figure pulls the hand back"*
  (for "Every Keeper was, once, a child…")
- *"a thin curtain of grey gauze being lifted at one corner to let gold light
  spill through"* (for "The Veil is not a wall. It is a habit.")
- *"a sunrise over a sleeping city, no judgment, only morning"*
  (for "The morning is not coming to judge you. It is only morning.")

## 7. Seamless textures (overlays)

These replace the procedural CSS grain with hand-feel texture. Generate **small
and tileable**, then apply at low opacity / `mix-blend-mode: soft-light`.

**Vellum / whitewash grain** (for overlay panels):
> [House style]. A seamless tileable texture of aged whitewashed plaster and
> vellum, very subtle, mostly dark indigo with faint lighter mottling and fine
> grain. Flat, even lighting, no focal point, fully tileable, square 1:1.

**Ink veil** (the thickening dark):
> [House style]. A seamless tileable texture of black ink bleeding and feathering
> into wet paper, deep blue-black `#01020a`, soft organic edges, no focal point,
> fully tileable, square 1:1. Ominous, smothering.

---

## Integration checklist

When you bring a generated raster asset into the shipped game:

1. Drop the file in `icons/` (or a new `art/` folder).
2. Reference it from `index.html` / `manifest.webmanifest` as needed.
3. **Add the path to `ASSETS` in `sw.js` AND bump `CACHE`** (e.g. `v5` → `v6`),
   or returning PWA users get stale files forever.
4. Keep raster art *decorative* — the city itself is live SVG drawn in `app.ts`
   and must stay procedural so the headless smoke test keeps working.

### Refinement tips for Nano Banana

- Iterate conversationally: generate, then say *"darker, more negative space,
  push the glow warmer, remove the extra flames."* It edits in place.
- For a matched set (frescoes, icons), generate one you like, then feed it back:
  *"same style and palette as this, but the subject is …"* for consistency.
- Ask for the exact hex values in the prompt — it tracks named colors well.
- If glow blows out to white, add *"restrained glow, deep shadows, not
  overexposed."*
