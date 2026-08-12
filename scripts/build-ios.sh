#!/usr/bin/env bash
#
# Build the iOS app (Capacitor) from this repo — locally, on a Mac. There is
# deliberately no CI job for this: an iOS build needs Xcode and a signing
# identity, and the GitHub Actions workflow in this repo only ever publishes the
# web build to Pages.
#
# What it does, in order:
#   1. compiles the TypeScript game modules (tsc)
#   2. assembles www/ — the web payload (tools/build-www.mjs)
#   3. scaffolds ios/ the first time (npx cap add ios)
#   4. copies www/ + config into the native project (npx cap sync ios)
#   5. runs xcodebuild for the simulator, or archives for the App Store
#
# Usage:
#   scripts/build-ios.sh                 # build for the simulator (no signing needed)
#   scripts/build-ios.sh --open          # sync, then open Xcode and stop
#   scripts/build-ios.sh --run           # build, install and launch on a simulator/device
#   scripts/build-ios.sh --archive       # signed .xcarchive (needs a team — see below)
#   scripts/build-ios.sh --archive --export   # also export a distributable .ipa
#   scripts/build-ios.sh --device        # build for a real device (signing required)
#   scripts/build-ios.sh --full          # bundle every art asset (~305 MB — device installs only)
#   scripts/build-ios.sh --clean         # clean the Xcode build first
#   scripts/build-ios.sh --sync-only     # stop after the sync (no xcodebuild)
#
# Signing (only needed for --device / --archive):
#   export LB_TEAM_ID=ABCDE12345                       # Apple Developer team
#   export LB_EXPORT_OPTIONS=/path/ExportOptions.plist # required by --export
#
# Requirements: macOS with Xcode 16+ and its command line tools. Capacitor 8
# wires its native dependencies with Swift Package Manager, so CocoaPods is NOT
# needed (this script still handles a CocoaPods-shaped project — an .xcworkspace
# — for anyone who scaffolded ios/ with an older Capacitor).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OPEN=0 RUN=0 ARCHIVE=0 EXPORT=0 DEVICE=0 FULL=0 CLEAN=0 SYNC_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --open)      OPEN=1 ;;
    --run)       RUN=1 ;;
    --archive)   ARCHIVE=1 ;;
    --export)    EXPORT=1; ARCHIVE=1 ;;
    --device)    DEVICE=1 ;;
    --full)      FULL=1 ;;
    --clean)     CLEAN=1 ;;
    --sync-only) SYNC_ONLY=1 ;;
    -h|--help)   sed -n '2,36p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "build-ios: unknown option '$arg' (try --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;33m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31mbuild-ios:\033[0m %s\n' "$1" >&2; exit 1; }

# ---------------------------------------------------------------- preflight

[ "$(uname -s)" = "Darwin" ] || die "iOS builds only run on macOS (Xcode is required)."
command -v node >/dev/null || die "node not found — install Node 20+."
[ -d node_modules/@capacitor/cli ] || die "Capacitor is not installed — run 'npm install' first."
command -v xcodebuild >/dev/null || die "xcodebuild not found — install Xcode and run 'xcode-select --install'."
# CocoaPods is only required by the legacy (pre-SPM) project layout; if ios/ was
# scaffolded that way, `cap sync` will shell out to `pod install`.
if [ -f ios/App/Podfile ] && ! command -v pod >/dev/null; then
  die "ios/App/Podfile exists but CocoaPods is not installed — 'brew install cocoapods'."
fi

# ------------------------------------------------------------- web payload

say "Compiling the game modules (tsc)"
npm run --silent build

say "Assembling www/"
if [ "$FULL" -eq 1 ]; then node tools/build-www.mjs --full; else node tools/build-www.mjs; fi

# ---------------------------------------------------------- native project

if [ ! -d ios ]; then
  say "Scaffolding the iOS project (first run)"
  npx --no-install cap add ios
fi

say "Syncing web assets into ios/"
npx --no-install cap sync ios

if [ "$SYNC_ONLY" -eq 1 ]; then
  say "Synced. Stopping before xcodebuild (--sync-only)."
  exit 0
fi

if [ "$OPEN" -eq 1 ]; then
  say "Opening Xcode"
  npx --no-install cap open ios
  exit 0
fi

if [ "$RUN" -eq 1 ]; then
  say "Building and launching (cap run picks the target)"
  npx --no-install cap run ios
  exit 0
fi

# --------------------------------------------------------------- xcodebuild

# Capacitor 8 scaffolds a Swift Package Manager project (App.xcodeproj, no
# workspace); older versions used CocoaPods and produced App.xcworkspace. Build
# whichever this checkout has.
SCHEME="App"
if [ -f ios/App/App.xcworkspace/contents.xcworkspacedata ]; then
  XC=(xcodebuild -workspace ios/App/App.xcworkspace -scheme "$SCHEME")
elif [ -d ios/App/App.xcodeproj ]; then
  XC=(xcodebuild -project ios/App/App.xcodeproj -scheme "$SCHEME")
else
  die "no Xcode project under ios/App — did 'cap sync ios' fail?"
fi
[ -n "${LB_TEAM_ID:-}" ] && XC+=("DEVELOPMENT_TEAM=$LB_TEAM_ID")

if [ "$CLEAN" -eq 1 ]; then
  say "xcodebuild clean"
  "${XC[@]}" clean
fi

if [ "$ARCHIVE" -eq 1 ]; then
  ARCHIVE_PATH="$ROOT/build/ios/LightBringer.xcarchive"
  mkdir -p "$ROOT/build/ios"
  say "xcodebuild archive -> $ARCHIVE_PATH"
  "${XC[@]}" -configuration Release -destination 'generic/platform=iOS' \
    -archivePath "$ARCHIVE_PATH" archive

  if [ "$EXPORT" -eq 1 ]; then
    [ -n "${LB_EXPORT_OPTIONS:-}" ] || die "--export needs LB_EXPORT_OPTIONS pointing at an ExportOptions.plist."
    [ -f "$LB_EXPORT_OPTIONS" ] || die "LB_EXPORT_OPTIONS points at '$LB_EXPORT_OPTIONS', which does not exist."
    say "xcodebuild -exportArchive -> build/ios/export"
    xcodebuild -exportArchive -archivePath "$ARCHIVE_PATH" \
      -exportOptionsPlist "$LB_EXPORT_OPTIONS" \
      -exportPath "$ROOT/build/ios/export"
  fi
elif [ "$DEVICE" -eq 1 ]; then
  say "xcodebuild (device, Release)"
  "${XC[@]}" -configuration Release -destination 'generic/platform=iOS' build
else
  say "xcodebuild (simulator, Debug)"
  "${XC[@]}" -configuration Debug -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    CODE_SIGNING_ALLOWED=NO build
fi

# ------------------------------------------------------------------ output

say "Artifacts"
if [ -d "$ROOT/build/ios" ]; then
  find "$ROOT/build/ios" -maxdepth 2 \( -name '*.xcarchive' -o -name '*.ipa' \) \
    | while read -r f; do printf '  %s\n' "$f"; done
else
  echo "  (simulator build — open Xcode or use --run to launch it)"
fi
