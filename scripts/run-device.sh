#!/usr/bin/env bash
#
# Build the release APK (JS bundle embedded), install it on a physical Android
# device and launch it.
#
# Release rather than debug because the bundle is baked in: the app then runs
# with no Metro server and no USB tether. The trade-off is no hot reload — run
# this again after changing JS.
#
# The device is discovered, not hardcoded, so swapping phones needs no edit.
# Emulators are skipped on purpose: the MCX server is only reachable from the
# real handset's network. Override with DEVICE=<serial> to force one.
#
# Usage:
#   npm run device
#   DEVICE=R58M66SC33Z npm run device     # pick a specific device
#   SKIP_BUILD=1 npm run device           # reinstall the last APK

set -euo pipefail

PACKAGE="com.testaar"
APK="android/app/build/outputs/apk/release/app-release.apk"

cd "$(dirname "$0")/.."

# ── Locate adb ────────────────────────────────────────────────────────────────
if command -v adb >/dev/null 2>&1; then
    ADB=adb
elif [ -x "$HOME/Library/Android/sdk/platform-tools/adb" ]; then
    ADB="$HOME/Library/Android/sdk/platform-tools/adb"
elif [ -x "${ANDROID_HOME:-}/platform-tools/adb" ]; then
    ADB="$ANDROID_HOME/platform-tools/adb"
else
    echo "adb not found. Install platform-tools or set ANDROID_HOME." >&2
    exit 1
fi

# ── Pick a device ─────────────────────────────────────────────────────────────
# `adb devices` lines look like "<serial>\tdevice"; anything not in state
# "device" (unauthorized, offline) is unusable, and emulator-* is excluded.
if [ -n "${DEVICE:-}" ]; then
    SERIAL="$DEVICE"
else
    SERIAL=$("$ADB" devices | awk '$2 == "device" && $1 !~ /^emulator-/ { print $1; exit }')
fi

if [ -z "$SERIAL" ]; then
    echo "No physical Android device connected." >&2
    echo "Connected targets:" >&2
    "$ADB" devices -l | tail -n +2 >&2
    echo >&2
    echo "Plug in a phone with USB debugging enabled, or set DEVICE=<serial>" >&2
    echo "(emulators are skipped — the MCX server is not reachable from them)." >&2
    exit 1
fi

MODEL=$("$ADB" -s "$SERIAL" shell getprop ro.product.model 2>/dev/null | tr -d '\r' || true)
echo "▶ Device: $SERIAL${MODEL:+ ($MODEL)}"

# ── Build ─────────────────────────────────────────────────────────────────────
if [ -n "${SKIP_BUILD:-}" ]; then
    echo "▶ Skipping build (SKIP_BUILD set)"
    [ -f "$APK" ] || { echo "No APK at $APK — run without SKIP_BUILD first." >&2; exit 1; }
else
    echo "▶ Building release APK…"
    (cd android && ./gradlew :app:assembleRelease)
fi

# ── Install & launch ──────────────────────────────────────────────────────────
echo "▶ Installing…"
"$ADB" -s "$SERIAL" install -r "$APK"

echo "▶ Launching ${PACKAGE}…"
"$ADB" -s "$SERIAL" shell monkey -p "$PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

echo
echo "✔ Running on $SERIAL"
echo "  Logs:   $ADB -s $SERIAL logcat -s SDK:V McSdkBridge:V ReactNativeJS:V"
echo "  Crash:  $ADB -s $SERIAL logcat -d -b crash | tail -40"
