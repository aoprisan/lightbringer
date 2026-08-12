#!/usr/bin/env bash
#
# Build the Android app (Capacitor) from this repo — locally, on your own
# machine. There is deliberately no CI job for this: mobile builds need an
# Android SDK (and, for iOS, a Mac), and the GitHub Actions workflow in this
# repo only ever publishes the web build to Pages.
#
# What it does, in order:
#   1. compiles the TypeScript game modules (tsc)
#   2. assembles www/ — the web payload (tools/build-www.mjs)
#   3. scaffolds android/ the first time (npx cap add android)
#   4. copies www/ + config into the native project (npx cap sync android)
#   5. runs Gradle to produce an APK or an AAB
#
# Usage:
#   scripts/build-android.sh                 # debug APK
#   scripts/build-android.sh --release       # release APK (signed if keystore env is set)
#   scripts/build-android.sh --bundle        # release AAB for Play (implies --release)
#   scripts/build-android.sh --open          # sync, then open Android Studio and stop
#   scripts/build-android.sh --run           # build, install and launch on a connected device
#   scripts/build-android.sh --full          # bundle every art asset (~305 MB — device installs only)
#   scripts/build-android.sh --clean         # gradle clean first
#   scripts/build-android.sh --sync-only     # stop after the sync (no Gradle)
#
# Release signing (optional — without it a release build is left unsigned):
#   export LB_KEYSTORE=/absolute/path/to/lightbringer.jks
#   export LB_KEYSTORE_PASSWORD=...
#   export LB_KEY_ALIAS=lightbringer
#   export LB_KEY_PASSWORD=...
#
# Requirements: Node 20+, a JDK 21 (Android Gradle Plugin 8.x), and the Android
# SDK with ANDROID_HOME (or ANDROID_SDK_ROOT) pointing at it. Android Studio
# installs all three; `scripts/build-android.sh --open` is the easy path.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RELEASE=0 BUNDLE=0 OPEN=0 RUN=0 FULL=0 CLEAN=0 SYNC_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --release)   RELEASE=1 ;;
    --bundle)    BUNDLE=1; RELEASE=1 ;;
    --open)      OPEN=1 ;;
    --run)       RUN=1 ;;
    --full)      FULL=1 ;;
    --clean)     CLEAN=1 ;;
    --sync-only) SYNC_ONLY=1 ;;
    -h|--help)   sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "build-android: unknown option '$arg' (try --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;33m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31mbuild-android:\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- preflight

command -v node >/dev/null || die "node not found — install Node 20+."
[ -d node_modules/@capacitor/cli ] || die "Capacitor is not installed — run 'npm install' first."

ANDROID_SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ "$OPEN" -eq 0 ] && [ "$SYNC_ONLY" -eq 0 ]; then
  [ -n "$ANDROID_SDK" ] || die "ANDROID_HOME (or ANDROID_SDK_ROOT) is not set — point it at your Android SDK, or use --open to build from Android Studio."
  [ -d "$ANDROID_SDK" ] || die "ANDROID_HOME points at '$ANDROID_SDK', which does not exist."
  command -v java >/dev/null || die "java not found — install a JDK 21 (Android Studio ships one)."
fi

# ------------------------------------------------------------- web payload

say "Compiling the game modules (tsc)"
npm run --silent build

say "Assembling www/"
if [ "$FULL" -eq 1 ]; then node tools/build-www.mjs --full; else node tools/build-www.mjs; fi

# ---------------------------------------------------------- native project

if [ ! -d android ]; then
  say "Scaffolding the Android project (first run)"
  npx --no-install cap add android
fi

say "Syncing web assets into android/"
npx --no-install cap sync android

if [ "$SYNC_ONLY" -eq 1 ]; then
  say "Synced. Stopping before Gradle (--sync-only)."
  exit 0
fi

if [ "$OPEN" -eq 1 ]; then
  say "Opening Android Studio"
  npx --no-install cap open android
  exit 0
fi

# ------------------------------------------------------------------ gradle

GRADLE_ARGS=()
if [ "$RELEASE" -eq 1 ] && [ -n "${LB_KEYSTORE:-}" ]; then
  [ -f "$LB_KEYSTORE" ] || die "LB_KEYSTORE points at '$LB_KEYSTORE', which does not exist."
  : "${LB_KEYSTORE_PASSWORD:?LB_KEYSTORE is set but LB_KEYSTORE_PASSWORD is not}"
  : "${LB_KEY_ALIAS:?LB_KEYSTORE is set but LB_KEY_ALIAS is not}"
  : "${LB_KEY_PASSWORD:?LB_KEYSTORE is set but LB_KEY_PASSWORD is not}"
  # Injected signing keeps the credentials out of the repo entirely — nothing is
  # written into android/app/build.gradle.
  GRADLE_ARGS+=(
    "-Pandroid.injected.signing.store.file=$LB_KEYSTORE"
    "-Pandroid.injected.signing.store.password=$LB_KEYSTORE_PASSWORD"
    "-Pandroid.injected.signing.key.alias=$LB_KEY_ALIAS"
    "-Pandroid.injected.signing.key.password=$LB_KEY_PASSWORD"
  )
elif [ "$RELEASE" -eq 1 ]; then
  echo "build-android: no LB_KEYSTORE set — the release artifact will be UNSIGNED." >&2
fi

if [ "$BUNDLE" -eq 1 ]; then TASK=bundleRelease
elif [ "$RELEASE" -eq 1 ]; then TASK=assembleRelease
else TASK=assembleDebug
fi

cd android
[ "$CLEAN" -eq 1 ] && { say "gradle clean"; ./gradlew --console=plain clean; }

say "gradle $TASK"
./gradlew --console=plain "$TASK" "${GRADLE_ARGS[@]}"
cd "$ROOT"

# ------------------------------------------------------------------ output

say "Artifacts"
find android/app/build/outputs \( -name '*.apk' -o -name '*.aab' \) 2>/dev/null \
  | while read -r f; do printf '  %s  (%s)\n' "$f" "$(du -h "$f" | cut -f1)"; done

if [ "$RUN" -eq 1 ]; then
  say "Installing and launching on the connected device"
  npx --no-install cap run android
fi
