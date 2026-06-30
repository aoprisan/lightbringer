#!/usr/bin/env python3
"""Process raw per-city sprite art into the shipped form.

Gemini ("Nano Banana") emits each per-city sprite as a 2048px, multi-megabyte
PNG with a transparent background. The shipped base set (art/*.png) is instead
512px, 8-bit palette, flattened onto the board's navy. This script makes the
city re-skins match that spec so a city's board reads consistently with the
shared Keeper / lantern / scar sprites (which are always the base art).

Per city it reads the eight CITY_SPRITES from art-prompts-output/<city>/<name>.png
and writes art/<city>/<name>.png, doing, for each:
  - flatten any alpha onto the base navy (#0f111e),
  - resize 2048 -> 512 (Lanczos),
  - quantize to a 256-color palette with dithering (matches the base weight).

Missing sources are skipped with a warning, so it is safe to run a city that is
only partly generated; rerun as more sprites arrive.

After shipping a city's set, wire it for offline: add the eight
art/<city>/*.png paths to sw.js ASSETS and bump CACHE. (The render loader,
spriteFor / loadCitySprites in pentagram.ts, needs no change — it falls back to the
base sprite for any city file that is absent.)

Requires Pillow (`pip install Pillow`).

Usage:
  python3 tools/process-city-sprites.py                 # all known cities
  python3 tools/process-city-sprites.py ashfold drowned # just these
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("This script needs Pillow: pip install Pillow")

# Board navy that the base sprites are flattened onto (sampled from art/*.png).
NAVY = (15, 17, 30)

# The eight re-skinnable sprites — must stay in sync with CITY_SPRITES in pentagram.ts.
SPRITES = [
    "ground",
    "dwelling-dark",
    "dwelling-lit",
    "dwelling-awakened",
    "dwelling-snuffed",
    "conduit",
    "press",
    "shrine",
]

# Cities that get a re-skin (The Old City keeps the base set, so it is absent).
CITIES = ["ashfold", "drowned", "glassworks", "vesper"]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def process_one(src, dst):
    im = Image.open(src)
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    if has_alpha:
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, NAVY)
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    im = im.resize((512, 512), Image.LANCZOS)
    im = im.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG)
    im.save(dst, optimize=True)
    return os.path.getsize(dst)


def process_city(city):
    src_dir = os.path.join(ROOT, "art-prompts-output", city)
    dst_dir = os.path.join(ROOT, "art", city)
    if not os.path.isdir(src_dir):
        print(f"{city}: no art-prompts-output/{city}/ — skipping")
        return
    os.makedirs(dst_dir, exist_ok=True)
    print(f"{city}:")
    done = 0
    for name in SPRITES:
        src = os.path.join(src_dir, name + ".png")
        if not os.path.isfile(src):
            print(f"  {name:18s} -- no source PNG yet (run the prompt)")
            continue
        size = process_one(src, os.path.join(dst_dir, name + ".png"))
        print(f"  {name:18s} {size // 1024}K")
        done += 1
    print(f"  -> {done}/{len(SPRITES)} sprites written to art/{city}/")


def main():
    cities = sys.argv[1:] or CITIES
    for city in cities:
        process_city(city)


if __name__ == "__main__":
    main()
