# The Burning Vigil — Gemini prompts for city-map references

Reference art prompts for **Google Gemini** image generation (Imagen / "Nano Banana"). These produce
**top-down city-map references** for the seven cities of *The Burning Vigil* (`pentagram.ts`). They are
**design references** — mood + layout inspiration for tuning each `LevelDef` and for establishing-image
art (`art/city-*.jpg`) — not assets the renderer reads. The runtime map is still procedural
(`generateCity` / `buildArena`); these just give a human a target to read the dials against.

## What the map has to show

The arena is **portrait, 3:4** (the sim is `W=1500 × H=2000`). Every city is laid out as **five named
quarters**, each clustered around an **open plaza** at its heart, with **lanes** threading between them.
The world's conceit: *a city taught that light burns* — so it reads grim, shadowed, cold, and the only
flame is forbidden/heretical.

The recurring map vocabulary (use this as a shared legend so the layouts stay legible):

| Map element | What it is in the game | How to draw it |
| --- | --- | --- |
| **Quarter / district** | one of five named neighbourhoods | a dense cluster of rooftops/blocks |
| **Plaza** | open shrine-square at each quarter's heart | a clear circular/oval void in the cluster |
| **Keeper-post** | enemy spawn point (the risen watch) | a guard-tower / gibbet / muster-point marker |
| **Shrine** | consecrated safe ground | a small chapel/standing-stone on a plaza |
| **Font** | lightwell — passable, glows | a glowing wellspring / molten pool |
| **Obelisk** | ward-stone, shields nearby enemies | a tall dark monolith with a cold halo |
| **Fence** | low wall, blocks bodies | short stone wall segments between blocks |
| **Pathway** | open lane the hero runs fast | a bright processional street / causeway |
| **Press / press-burst** | one-shot cascade trap | an oil-press / cistern / machine block |
| **Conduit** | fuse linking dwellings | a thin line of lamps/runnels between roofs |
| **Veil pool** | drifting dark patch | an inky shadow-pool with no detail |

## How to use these prompts

1. Paste a per-city prompt below into Gemini's image generator.
2. Keep the **shared style block** — it's what makes the seven read as one world.
3. Ask for **3:4 portrait, top-down / bird's-eye orthographic**.
4. Iterate: "make the five quarters more distinct", "open up the central plaza", "more lanes connecting
   the north and south quarters", etc.

---

## Shared style block (prepend or keep consistent across all seven)

> Top-down bird's-eye orthographic map of a medieval-gothic city quarter, **3:4 portrait** aspect ratio.
> Grim dark-fantasy world *where light is forbidden and taught to burn* — the city is shadowed, cold,
> desaturated, lit only by a sickly moon. Hand-inked cartographer's map crossed with a stylized video-game
> level overview: readable building footprints, clear streets, no text labels. Composition is **five
> distinct neighbourhood clusters**, each built around **one open plaza**, joined by a few **bright lit
> lanes**. The only warm colour is forbidden flame — sparse, deliberate. Muted palette, high readability,
> clean negative space in the plazas.

---

## 1. The Old City — `old-city`

*"Where you first stole the flame. The watch is even — a fair first descent."* (fair, balanced; one lightwell, no veils/elites)

> [Shared style block.] **The Old City**: the oldest, fairest quarter — worn cobbled streets, even rows of
> stone houses, five balanced neighbourhoods of similar density around five tidy plazas. A handful of
> guard-towers spread **evenly**, one small chapel-shrine per plaza, and a **single glowing lightwell** in
> a courtyard. Six lit processional lanes lace the quarters together. Calm, legible, archetypal — the
> tutorial city. No dark pools, no monoliths. Cold moonlit greys and slate blues, a lone ember of stolen
> flame at the centre.

## 2. Ashfold — `ashfold`

*"Dry tinder that remembers fire. The watch is many and quick to rise."* (motion-heavy; 9 lanes, 2 lightwells, drifting veils, elites, darters)

> [Shared style block.] **Ashfold**: a tinder-dry timber district of ash-grey roofs and scorched beams, as
> if it has burned before and remembers. **Many crowded guard-posts**, the watch dense and restless.
> **Nine** wide open lanes cut through for constant movement — this is a running city. **Two glowing
> lightwells** in soot-stained courtyards. A couple of **inky drifting shadow-pools** smear across the
> streets. Warm ember-orange embers flickering against charcoal and ash-white; smoke haze over the
> rooftops.

## 3. The Drowned Quarter — `drowned`

*"The water took the low streets. Few shades here — but they wake patient and far."* (sparse, large, flooded; 4 dark pools, one ward-stone)

> [Shared style block.] **The Drowned Quarter**: the largest, sparsest, **flooded** low city — half the
> streets are under black water, houses on stilts and islands, narrow stone causeways between distant
> quarters. Few, **far-apart** guard-posts. A **single tall dark ward-obelisk** stands alone on a
> waterlogged plaza — a deliberate detour. **Four wide inky water-shadow pools**. Six chapel-shrines on
> the dry high ground. Drowned, patient, spacious; deep teal-black water, cold pale stone, faint reflected
> moonlight, one distant ember.

## 4. The Glassworks — `glassworks`

*"Everything here is bright and breaks. The watch is thick and tightly packed."* (tight, packed; 8 shrines, 2 ward-stones, 13 fences, elites/darters/spitters)

> [Shared style block.] **The Glassworks**: a tight, densely-packed artisans' district of glasshouses,
> kilns and mirrored roofs — everything bright and brittle. The five quarters are **cramped and close**,
> short streets, **many low stone fence-walls** chopping the blocks into cover. **Thick clusters of
> guard-posts**, packed tight. **Eight small shrines**, **two dark ward-monoliths**, one glowing
> lightwell. Sharp, faceted, glittering — pale silver-blue glass catching cold light, fractured reflections,
> a single forbidden flame reflected many times.

## 5. Vesper Row — `vesper`

*"The watch is thickest where the faithful sleep. The hardest descent."* (hardest; densest watch, 2 ward-stones, elites/spitters/darters, few lanes)

> [Shared style block.] **Vesper Row**: the cathedral district where the faithful sleep — solemn,
> oppressive, the **densest watch of all**. Tall churches and cloisters loom over narrow lanes; the five
> quarters press close around grand shrine-plazas. **The most guard-posts of any city**, ranged and
> elite. **Two tall ward-obelisks** harden the watch; only **one glowing lightwell** as the lone mercy.
> Few lanes, claustrophobic. Funereal violet-greys and candle-black, gold reliquary glints, the single
> stolen flame defiant against a wall of devotion.

## 6. The Ember Foundry — `foundry`

*"Molten light wells up from the deep moulds. Burn on the run — and don't stand to be mended."* (signature: 7 lightwells, 10 lanes; darters + healers)

> [Shared style block.] **The Ember Foundry**: an industrial casting district of furnaces, moulds and
> channels of **molten light**. Its signature: **seven glowing molten lightwells** dotted across the
> quarters — wellsprings you can work beside on the move. **Ten broad lanes / casting-channels** for
> constant motion. Guard-posts among the foundries, plus pale acolyte-menders. Few fences. Deep iron-black
> and slag-grey shot through with rivers of orange-white molten glow; heat-shimmer over the moulds, sparks
> rising.

## 7. The Pale Bastion — `bastion`

*"Ward-stones keep the watch immortal and acolytes keep it whole. Crack the stone, kill the kindness."* (signature: 5 ward-stones; dense watch, healers, fences)

> [Shared style block.] **The Pale Bastion**: a pale fortified citadel-district, walls within walls. Its
> signature: **five tall dark ward-obelisks**, each with a cold halo, standing over the quarters and
> keeping the watch immortal. **Dense guard-posts** flanked by pale acolyte-menders; **many low fortified
> fence-walls** segmenting the bastion. Few lanes, hard angles, defensive geometry. Bleached bone-white
> stone against cold shadow, faint cyan ward-light haloing the monoliths, one warm ember held against the
> pale.

---

## Optional add-ons to any prompt

- **Establishing-image variant** (for `art/city-*.jpg`): replace "top-down bird's-eye orthographic map"
  with *"low three-quarter establishing shot looking across the quarter at night"* — same style block,
  same per-city flavour, for a mood plate instead of a layout map.
- **Annotated-legend variant**: add *"include a small hand-drawn map legend in one corner keying the
  guard-towers, shrines, lightwells and lanes"* if you want a readable design reference.
- **Palette lock**: append *"limited palette: cold slate-grey and moonlit blue, one accent of forbidden
  ember-orange"* to keep the seven cohesive.
- **Negative prompt** (if Gemini supports it): *"no modern buildings, no cars, no text, no people in
  foreground, not photorealistic, no bright daylight."*
