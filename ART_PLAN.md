# Art Plan — real-looking city sprites

Replace the abstract SVG primitives in `render()` with painted sprites for every
entity the sim actually has (`app.ts`): node kinds `dwelling | conduit | press |
shrine | keeper`, node states `dark | lit | awakened | snuffed`, patrolling
Keepers, weather overlays, and the player — who is a disembodied lantern/hand
cursor, not a character on the map.

## Generation rules (read before prompting Gemini)

- **No transparency.** Gemini can't output transparent PNGs. Every sprite is
  generated isolated on a flat solid `#0B0E1A` (the game's night indigo), then
  either composited as-is or chroma-keyed. Never use white backgrounds — flame
  glow will halo.
- **Consistency.** Prepend the same STYLE BLOCK to every prompt and generate
  all assets in one Gemini session if possible. Always request **1024×1024,
  square, single centered subject, no text, no watermark**.
- **Silhouette continuity for dwelling states.** Generate `dwelling-dark`
  first, then use Gemini's *image-editing* mode ("edit this image: now lit
  from within…") for lit/awakened/snuffed, so all four states share one
  silhouette. The game swaps states on the same node, so continuity beats
  per-image beauty.
- Output files go in `art/` at the repo root.

## STYLE BLOCK (prepend to every prompt)

> Style: hand-painted dark-fantasy game asset, medieval city at night,
> ink-and-gilt illuminated-manuscript feel. Palette: deep night indigo
> (#0B0E1A), slate blues, charcoal stone; warm candle-gold (#F5C66B) and ember
> orange for any light. Soft painterly edges, subtle grain, no outlines, no
> photorealism. View: three-quarter top-down (about 60°), consistent light
> from the object's own flame only. Single centered subject, isolated on a
> flat solid #0B0E1A background, 1024×1024, no text, no watermark, no border.

## Asset prompts

### 1. `ground.png` — city ground texture (the one non-sprite)

> Seamless tileable texture of medieval city ground seen from above at night:
> worn cobblestones, patches of dirt, faint cart ruts, occasional drain grate,
> all in very dark slate blue and charcoal so it reads as background.
> Extremely low contrast, no focal point, no light sources, edges must tile
> seamlessly. 1024×1024.

### 2. `dwelling-dark.png`

> A small, humble medieval row-house dwelling — steep tiled roof, timber
> frame, shuttered windows — completely unlit and asleep. Cold blue-grey tones
> only, almost silhouette, a thin line of moonlight on the roof ridge.

### 3. `dwelling-lit.png`

> The same small medieval row-house dwelling, now lit from within: warm
> candle-gold glow spilling from one window and under the door, faint smoke
> from the chimney, gentle warm light pooling on the ground at its base. The
> house itself stays dark; only the light is warm.

### 4. `dwelling-awakened.png`

> The same medieval dwelling transfigured: every window blazing steady gold, a
> small clear flame hovering just above the chimney like a beacon, thin gold
> filigree lines tracing the timber frame, a calm radiant halo on the ground
> around it. Serene and sacred, not burning — this is a soul awake, not a
> house on fire.

### 5. `dwelling-snuffed.png`

> The same medieval dwelling smothered and scarred: windows boarded with rough
> black planks, dark grey ash-soot staining the walls upward, a heavy
> translucent black-violet veil of smoke hanging over and around it like a
> shroud, faint wisps still rising. No warm color anywhere. It should look
> permanently silenced, worse than merely dark.

### 6. `conduit.png` — the rumor/oil channels that carry fire fast

> A narrow medieval alley structure seen from above: an open stone channel or
> gutter running through a cramped passage between walls, slick with lamp-oil
> sheen, hanging laundry lines and message-strings overhead. Dark and quiet,
> with the faintest cold reflection along the wet channel hinting it would
> carry flame instantly.

### 7. `press.png` — the printing press, word made many

> A medieval print-shop building, slightly larger than a dwelling: wide
> workshop doors ajar, a heavy wooden printing press visible inside in shadow,
> loose printed pages scattered and pinned around the doorway, a paper-strewn
> yard. Unlit, ink-stained, expectant.

### 8. `shrine.png` — lights its whole quarter when kindled

> A small open-air street shrine: weathered stone niche with a carved figure
> worn featureless, melted old candle stubs in tiers, dried flowers, hanging
> votive chains. Dark, but the wax and chains catch a faint cold gleam.
> Intimate, devotional, pre-Christian-feeling.

### 9. `keeper-node.png` — the static Keeper post

> A grim watch-post of the Order of Keepers: a tall narrow black-iron
> brazier-tower on a stone base, its cage holding not fire but a dense sphere
> of darkness that bends the faint light around it, snuffing-hooks and long
> candle-snuffer poles racked against it, a black banner with a single
> eye-and-extinguisher sigil. Cold violet-black accents, absolutely no warm
> light.

### 10. `keeper-patrol.png` — the moving Keeper figure

> A single patrolling Keeper seen from three-quarter top-down: a tall figure
> in heavy hooded black-violet robes that pool like smoke, carrying a long
> brass candle-snuffer staff like a halberd, face hidden, a small caged
> void-lantern at the belt that emits darkness instead of light. Slight
> forward motion in the robes. Menacing, ecclesiastical, silent.

### 11. `player-lantern.png` — the player's presence/cursor

> The Light-Bringer's presence: a disembodied hand emerging from soft
> darkness, cupped protectively around a single small candle flame, gold light
> glowing through the fingers, a few drifting sparks. Tender and defiant. This
> is a cursor/avatar mark, so keep the silhouette readable at small sizes.

### 12. `veil-scar.png` — overlay decal for thickened veil

> A flat ground-decal seen from directly above: a roughly circular stain of
> black-violet smoke and ash soaked into cobblestones, denser at the center,
> wisping to nothing at the edges, faint suppressed-ember flecks of dull
> grey-gold deep inside it. Painted as a soft-edged blot suitable as an
> overlay.

### 13. `flame-spark.png` — generic flame for effects

> A single small candle flame with no candle: teardrop of layered gold, amber
> and white-hot core, a couple of rising sparks, soft glow falloff. Painted,
> not photoreal, on the flat #0B0E1A background for easy additive compositing.

### 14. (optional) `rain-overlay.png` / `wind-overlay.png`

> Rain: a full-frame overlay of thin slanted silver-blue rain streaks and tiny
> splash rings on darkness, sparse and subtle, even density edge to edge.
>
> Wind: faint horizontal streaks of pale dust and a few torn leaves streaming
> in one direction across darkness, very low opacity.

## Integration plan (once PNGs exist in `art/`)

1. **Render pass** — in `render()` in `app.ts`, swap the SVG primitives for
   `<image>` elements per node (kind + state picks the file); use an SVG
   `<pattern>` for `ground.png`; keep the existing glow/heat effects layered
   on top so sim-driven brightness still reads.
2. **Keeper radius stays drawn** — sprites replace the node marks, not the
   `keeperRadius` threat circle (`stepKeepers` and `render` must stay in
   sync per CLAUDE.md).
3. **Service worker** — add every shipped `art/*.png` to `ASSETS` in `sw.js`
   AND bump `CACHE`, or returning users get the old shell forever.
4. **No save-format impact** — art is render-only; sim state and
   `lightbringer.save.v3` are untouched.
5. **Verify** — `npm test` (sim unaffected), then `npm start` and eyeball all
   five kinds × four states, a patrol, a snuff scar, and both weathers.
