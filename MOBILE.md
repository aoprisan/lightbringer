# Mobile apps — Android & iOS (Capacitor)

The five games already ship as installable PWAs. This is the second wrapper:
[Capacitor](https://capacitorjs.com) packages the exact same HTML/JS/art into a
native **Android** and **iOS** app, so the games can go to the Play Store and the
App Store without a second codebase.

**Everything here runs locally, on your machine.** There is deliberately **no CI
job for mobile** — the GitHub Actions workflow in this repo still only builds and
publishes the web site to Pages. Native builds need an Android SDK, a Mac with
Xcode, and signing identities, none of which belong in a public workflow.

---

## Quick start

```sh
npm install                     # one-time (installs the Capacitor CLI + platforms)

npm run android                 # debug APK
npm run ios                     # simulator build (Mac only)

npm run android:open            # or: sync, then hand off to Android Studio
npm run ios:open                # or: sync, then hand off to Xcode
```

The first run of either scaffolds the native project (`android/` or `ios/`) for
you. Both directories are git-ignored — see *Committing the native projects*
below.

---

## How it works

The site **is** the repository root (that is how Pages serves it), so there is no
`dist/` for Capacitor to point at. `tools/build-www.mjs` builds one:

```
*.ts ──tsc──▶ *.js ─┐
                    ├─▶ www/ ──cap sync──▶ android/app/src/main/assets/public
art/, icons/, ... ──┘                      ios/App/App/public
```

`capacitor.config.json` names `www` as its `webDir`; `index.html` — the
class-select hub — is the app's entry point, exactly as on the web.

**What goes into `www/` is read from `sw.js`'s `ASSETS` list**, the same list
that defines what the PWA caches for offline play. One source of truth: add a
shipped file there (as `CLAUDE.md` already requires) and the native apps pick it
up automatically. The script *fails* if a listed file is missing, mirroring the
service worker's `addAll()`, so it doubles as a check on that list.

### Why the default bundle leaves art out

The full `ASSETS` payload is **~305 MB** of painted art. Google Play caps an AAB
at 200 MB and the App Store frowns on far less, so bundling all of it is not an
option for a store build.

It does not have to be. Every sprite in this repo has a **procedural vector
fallback** — the games are designed to be fully playable with zero PNGs. So the
default build keeps every file **≤ 2 MB** and leaves the heavy paintings out:

| Build | Files | Size | What you lose |
| --- | --- | --- | --- |
| `npm run www` (default) | 127 | **~12 MB** | the big painted sprites & establishing scenes — those draw procedurally instead |
| `npm run www:full` | 174 | ~305 MB | nothing (device installs only — too big for either store) |

```sh
node tools/build-www.mjs                   # default, ≤2 MB per asset
node tools/build-www.mjs --max-asset-mb=5  # a fatter cut (134 files, ~44 MB)
node tools/build-www.mjs --full            # everything sw.js lists
```

Both build scripts take `--full` and pass it through.

### The service worker is skipped in the app

The shells register `sw.js` only when `window.Capacitor` is undefined. Inside the
app the shell **is** the bundle, so a service worker would just add a second,
staler copy of it — and iOS's WKWebView has no service worker at all. Nothing
else about the pages changes between web and native.

---

## Android

**Requirements:** Node 20+, JDK 21, and the Android SDK with `ANDROID_HOME` (or
`ANDROID_SDK_ROOT`) set. Installing Android Studio gets you all three.

```sh
npm run android                          # debug APK
npm run android:run                      # build, install & launch on a device
npm run android:open                     # open the project in Android Studio
npm run android:release                  # release AAB for Play

scripts/build-android.sh --release       # release APK
scripts/build-android.sh --clean --full  # clean build, all art bundled
scripts/build-android.sh --sync-only     # just refresh android/ (no Gradle)
scripts/build-android.sh --help
```

Artifacts land under `android/app/build/outputs/` and the script prints their
paths and sizes when it finishes.

### Signing a release

Signing credentials never enter the repo — the script passes them to Gradle as
injected properties, straight from the environment:

```sh
export LB_KEYSTORE=/absolute/path/to/lightbringer.jks
export LB_KEYSTORE_PASSWORD=…
export LB_KEY_ALIAS=lightbringer
export LB_KEY_PASSWORD=…
npm run android:release
```

Create the keystore once with
`keytool -genkey -v -keystore lightbringer.jks -keyalg RSA -keysize 2048 -validity 10000 -alias lightbringer`,
and keep it (and its passwords) somewhere safe and out of git — losing it means
never updating the Play listing again. Without `LB_KEYSTORE` a release build
still runs, but the artifact is **unsigned**.

---

## iOS

**Requirements:** macOS with Xcode 16+ and its command line tools. Capacitor 8
wires native dependencies with **Swift Package Manager**, so CocoaPods is *not*
needed.

```sh
npm run ios                              # simulator build (no signing needed)
npm run ios:run                          # build, install & launch
npm run ios:open                         # open the project in Xcode
npm run ios:archive                      # signed .xcarchive in build/ios/

scripts/build-ios.sh --device            # Release build for a real device
scripts/build-ios.sh --archive --export  # …and export an .ipa
scripts/build-ios.sh --help
```

Signing, when you need it:

```sh
export LB_TEAM_ID=ABCDE12345                        # Apple Developer team
export LB_EXPORT_OPTIONS=/path/ExportOptions.plist  # required by --export
```

Simulator builds pass `CODE_SIGNING_ALLOWED=NO`, so they need neither.

---

## App icons and splash screens

The native icon is the same stolen-flame mark the PWA uses — `tools/gen-icons.mjs`
now exports its renderer, and `tools/gen-cap-assets.mjs` redraws it at the sizes
the native generator wants (`assets/icon.png` 1024², `assets/splash.png` and
`assets/splash-dark.png` 2732²):

```sh
npm run cap:assets    # redraw assets/, then generate every native density
```

That second half shells out to `npx @capacitor/assets`, which is fetched on
demand rather than added to `package.json` — it pulls in ~400 packages, and this
repo keeps its dependency tree small. Run it once after scaffolding a platform,
and again whenever the mark changes.

---

## Committing the native projects

`android/`, `ios/`, `www/` and `build/` are git-ignored. They are all
regenerated: the build scripts run `cap add` on first use and `cap sync` on every
build, so a fresh clone needs nothing but `npm install`.

Once you start editing the native projects by hand — signing config, version
codes, permissions, native tweaks — **commit them**: drop those lines from
`.gitignore`, `git add android ios`, and from then on `cap sync` updates them in
place rather than recreating them.

Version numbers live in the native projects, not in `package.json`:
`android/app/build.gradle` (`versionCode` / `versionName`) and
`ios/App/App.xcodeproj` (Xcode's *Version* / *Build*).

---

## Known gaps

- **No deep links.** A duel or share link opens the *web* build, never the
  installed app. Wiring Android App Links / iOS Universal Links needs verified
  domain files (`.well-known/assetlinks.json`,
  `apple-app-site-association`) served from the Pages site plus native intent /
  entitlement config — worth doing, not done here.
- **Links shared from the app point at the public site.** Inside the app the
  origin is `https://localhost`, which is meaningless to a recipient, so
  `gameUrl()` in all five games falls back to
  `https://aoprisan.github.io/lightbringer/`. Change that constant if the site
  ever moves.
- **No native plugins.** No haptics, no immersive/full-screen mode, no orientation
  lock, no in-app purchases. The apps are the web games in a shell; Capacitor's
  plugin catalog is there when any of that is wanted.
- **Save data does not migrate.** The apps have their own `localStorage`, so a
  legacy earned in the browser does not follow you into the installed app.
