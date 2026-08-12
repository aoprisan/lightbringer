// Assemble www/ — the web-asset payload Capacitor wraps into the native apps.
//
// The site IS the repo root (GitHub Pages serves it in place), so there is no
// dist/ to point Capacitor at. This script builds one: it copies the shipped
// files into www/, which capacitor.config.json names as `webDir`.
//
// The manifest of "what ships" is not re-invented here — it is read straight out
// of sw.js's ASSETS list, the same list that defines what the PWA caches for
// offline play. One source of truth: add a file there (as CLAUDE.md already
// requires) and the native apps pick it up too.
//
// Size is the one place the native build must diverge from the web build. The
// full ASSETS payload is ~305 MB of painted art — far past what an app store
// will accept (Google Play caps an AAB at 200 MB; nobody wants a 300 MB game
// download either). Every sprite in this repo has a procedural vector fallback,
// so heavy art is *optional*: by default any single asset over --max-asset-mb is
// left out and the games draw those things from vector primitives instead. Pass
// --full to bundle everything anyway (useful for a local device install).
//
// Usage:
//   node tools/build-www.mjs                  # lean bundle (default, ~11 MB)
//   node tools/build-www.mjs --full           # every asset sw.js lists (~305 MB)
//   node tools/build-www.mjs --max-asset-mb=5 # custom per-file ceiling
//   node tools/build-www.mjs --out=www-lite   # write somewhere else
//
// Plain Node ESM, zero dependencies, like every other script in tools/.

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
};

const FULL = has("--full");
const OUT_DIR = join(ROOT, valueOf("out", "www"));
const MAX_ASSET_BYTES = FULL ? Infinity : Number(valueOf("max-asset-mb", "2")) * 1e6;
const QUIET = has("--quiet");

if (!FULL && !Number.isFinite(MAX_ASSET_BYTES)) {
  console.error("build-www: --max-asset-mb must be a number");
  process.exit(1);
}

// The shell — the pages and the compiled game modules. These are the app; a
// missing one is a hard error, not a skipped asset. (The .js files are build
// artifacts, so this doubles as the "did you run npm run build?" check.)
const SHELL = [
  "index.html",
  "manifest.webmanifest",
  "pentagram.html", "pentagram.js", "pentagram.webmanifest",
  "necro.html", "necro.js", "necro.webmanifest",
  "eldritch.html", "eldritch.js", "eldritch.webmanifest",
  "werewolf.html", "werewolf.js", "werewolf.webmanifest",
  "bomber.html", "bomber.js", "bomber.webmanifest",
];

// -------------------------------------------------------- the shipped list

// Pull the ASSETS array out of sw.js. A regex is enough and stays zero-dep: the
// list is a plain array of string literals with comments between them, and the
// tests already guard its contents.
function readShippedAssets(swSource) {
  const block = swSource.match(/const ASSETS = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error("build-www: could not find the ASSETS array in sw.js");
  return [...block[1].matchAll(/"([^"]+)"/g)]
    .map((m) => m[1].replace(/^\.\//, ""))
    .filter((p) => p !== "" && !p.endsWith("/")); // drop the "./" root entry
}

const shipped = readShippedAssets(readFileSync(join(ROOT, "sw.js"), "utf8"));

// Union of shell + everything sw.js caches, deduped, shell first.
const wanted = [...new Set([...SHELL, ...shipped])];

// -------------------------------------------------------------- the copy

const missingShell = SHELL.filter((p) => !existsSync(join(ROOT, p)));
if (missingShell.length) {
  console.error("build-www: missing shell files:\n  " + missingShell.join("\n  "));
  if (missingShell.some((p) => p.endsWith(".js"))) {
    console.error("\nThe compiled game modules are build artifacts — run `npm run build` first.");
  }
  process.exit(1);
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

let copied = 0, copiedBytes = 0;
const skippedHeavy = [];
const missing = [];

for (const rel of wanted) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) { missing.push(rel); continue; }

  const size = statSync(src).size;
  // The shell always ships whatever it weighs — the game cannot run without it.
  if (!SHELL.includes(rel) && size > MAX_ASSET_BYTES) {
    skippedHeavy.push([rel, size]);
    continue;
  }

  const dest = join(OUT_DIR, rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  copied++;
  copiedBytes += size;
}

// -------------------------------------------------------------- the report

const mb = (n) => (n / 1e6).toFixed(1) + " MB";

if (!QUIET) {
  console.log(`build-www: ${copied} files -> ${OUT_DIR.replace(ROOT, "")} (${mb(copiedBytes)})`);
  if (skippedHeavy.length) {
    const bytes = skippedHeavy.reduce((a, [, s]) => a + s, 0);
    console.log(
      `build-www: left out ${skippedHeavy.length} heavy assets (${mb(bytes)}) over ` +
      `${mb(MAX_ASSET_BYTES)} — those draw from their procedural fallbacks. ` +
      `Pass --full to bundle them.`
    );
  }
}

// sw.js lists files that must exist (addAll() rejects the whole install on a
// single 404), so a missing one is a real bug in the shipped list — surface it
// loudly here rather than letting it 404 silently inside the app.
if (missing.length) {
  console.error(
    `build-www: ${missing.length} file(s) listed in sw.js ASSETS do not exist:\n  ` +
    missing.join("\n  ")
  );
  process.exit(1);
}

// Store ceilings, as a courtesy warning rather than a failure — a local device
// install has no such limit.
if (copiedBytes > 150e6) {
  console.warn(
    `build-www: WARNING — ${mb(copiedBytes)} of web assets. Google Play caps an ` +
    `AAB at 200 MB and App Store review flags very large binaries. Consider ` +
    `dropping --full.`
  );
}
