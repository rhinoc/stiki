#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/src-tauri/target/debug/bundle/macos/stiki.app}"

developer_identity() {
  security find-identity -v -p codesigning 2>/dev/null \
    | awk -F'"' '/Developer ID Application/ { print $2; exit }'
}

development_identity() {
  security find-identity -v -p codesigning 2>/dev/null \
    | awk -F'"' '/Apple Development/ { print $2; exit }'
}

IDENTITY="${STIKI_CODESIGN_IDENTITY:-$(developer_identity)}"
if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$(development_identity)"
fi
if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$("$ROOT/scripts/ensure-local-code-sign.sh")"
fi

if [[ ! -d "$APP" ]]; then
  echo "error: app bundle not found: $APP" >&2
  exit 1
fi

HELPER_SRC="$ROOT/src-tauri/native/transcriber/bundle/stiki-native-transcriber"
if [[ ! -x "$HELPER_SRC" ]]; then
  HELPER_SRC="$ROOT/src-tauri/native/transcriber/.build/debug/stiki-native-transcriber"
fi
if [[ ! -x "$HELPER_SRC" ]]; then
  HELPER_SRC="$ROOT/src-tauri/native/transcriber/.build/arm64-apple-macosx/debug/stiki-native-transcriber"
fi
if [[ -x "$HELPER_SRC" ]]; then
  cp "$HELPER_SRC" "$APP/Contents/MacOS/stiki-native-transcriber"
fi

echo "Signing $APP with: $IDENTITY"

sign_args=(--force --sign "$IDENTITY")
if [[ "$IDENTITY" == Developer\ ID* ]]; then
  sign_args+=(--options runtime --timestamp)
fi

if [[ -f "$APP/Contents/MacOS/stiki-native-transcriber" ]]; then
  codesign "${sign_args[@]}" "$APP/Contents/MacOS/stiki-native-transcriber"
fi
codesign "${sign_args[@]}" "$APP/Contents/MacOS/stiki"
codesign --force --deep --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"
