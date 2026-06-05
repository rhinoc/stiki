#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(tr -d '[:space:]' <VERSION)"
TAG="app-v${VERSION}"
REPO="${GITHUB_REPOSITORY:-rhinoc/stiki}"
SERVER_URL="${GITHUB_SERVER_URL:-https://github.com}"
RELEASE_URL="${SERVER_URL}/${REPO}/releases/download/${TAG}"

mkdir -p "$ROOT/dist"
rm -f "$ROOT"/dist/stiki-"$VERSION"-*.dmg \
  "$ROOT"/dist/stiki-"$VERSION"-*.app.tar.gz \
  "$ROOT"/dist/stiki-"$VERSION"-*.app.tar.gz.sig \
  "$ROOT/dist/latest.json"

build_arch() {
  local target="$1"
  local arch="$2"

  "$ROOT/scripts/prepare-native-transcriber-runtime.sh" "$arch"
  bun run tauri build --target "$target" --bundles app --ci

  local app="$ROOT/src-tauri/target/$target/release/bundle/macos/stiki.app"
  local updater_src="$ROOT/src-tauri/target/$target/release/bundle/macos/stiki.app.tar.gz"
  local updater_sig_src="$updater_src.sig"

  if [[ ! -d "$app" ]]; then
    echo "error: missing app bundle at $app" >&2
    exit 1
  fi
  if [[ ! -f "$updater_src" ]]; then
    echo "error: missing updater archive at $updater_src" >&2
    exit 1
  fi
  if [[ ! -f "$updater_sig_src" ]]; then
    echo "error: missing updater signature at $updater_sig_src" >&2
    exit 1
  fi

  local dmg="$ROOT/dist/stiki-${VERSION}-${arch}.dmg"
  local updater_name="stiki-${VERSION}-${arch}.app.tar.gz"

  "$ROOT/scripts/build-dmg.sh" "$app" "$dmg" stiki
  cp "$updater_src" "$ROOT/dist/$updater_name"
  cp "$updater_sig_src" "$ROOT/dist/$updater_name.sig"
}

default_arch="aarch64"
if [[ "$(uname -m)" == "x86_64" ]]; then
  default_arch="x64"
fi
release_arches="${STIKI_RELEASE_ARCHS:-$default_arch}"
for arch in $release_arches; do
  case "$arch" in
    aarch64)
      build_arch aarch64-apple-darwin aarch64
      ;;
    x64)
      build_arch x86_64-apple-darwin x64
      ;;
    *)
      echo "error: unsupported release arch: $arch" >&2
      exit 1
      ;;
  esac
done

if [[ -f "$ROOT/dist/stiki-${VERSION}-aarch64.app.tar.gz.sig" && -f "$ROOT/dist/stiki-${VERSION}-x64.app.tar.gz.sig" ]]; then
  "$ROOT/scripts/write_latest_json.sh"
fi

for arch in $release_arches; do
  echo "Built dist/stiki-${VERSION}-${arch}.dmg"
done
