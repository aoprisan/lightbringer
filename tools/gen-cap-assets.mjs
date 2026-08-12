// Dependency-free source art for the NATIVE apps (Capacitor).
//
// @capacitor/assets generates every Android/iOS icon and splash density from a
// small set of oversized source images in assets/. This script draws those
// sources — the same stolen-flame mark the PWA icons use, reusing the renderer
// in tools/gen-icons.mjs, so the web icon and the store icon can never drift.
//
//   assets/icon.png        1024x1024  the app icon (full-bleed)
//   assets/splash.png      2732x2732  launch screen (small flame, centred)
//   assets/splash-dark.png 2732x2732  dark-mode launch screen (the game is night either way)
//
// Then run the generator, which pulls itself in on demand (kept out of
// package.json so the repo's dependency tree stays small):
//
//   npm run cap:assets
//
// Usage: node tools/gen-cap-assets.mjs

import { writeFileSync, mkdirSync } from "node:fs";
import { renderIcon, encodePNG } from "./gen-icons.mjs";

const ICON = 1024;   // @capacitor/assets wants a 1024 square icon source
const SPLASH = 2732; // ...and a 2732 square splash source

const dir = new URL("../assets/", import.meta.url);
mkdirSync(dir, { recursive: true });
const out = (name) => new URL(name, dir);

// The icon: the flame nearly filling the frame, as on the web.
writeFileSync(out("icon.png"), encodePNG(ICON, renderIcon(ICON)));
console.log("assets/icon.png");

// The splash: the same flame small in the middle of the night field. A large
// pad shrinks the drawn flame while the indigo background still fills the
// canvas, which is exactly what a launch screen wants.
const splash = encodePNG(SPLASH, renderIcon(SPLASH, 0.74));
writeFileSync(out("splash.png"), splash);
console.log("assets/splash.png");

// The Light-Bringer is a night game — the dark splash is the same image, kept
// as its own file because @capacitor/assets expects the pair.
writeFileSync(out("splash-dark.png"), splash);
console.log("assets/splash-dark.png");
