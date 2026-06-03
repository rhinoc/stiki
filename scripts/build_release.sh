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

build_arch aarch64-apple-darwin aarch64
build_arch x86_64-apple-darwin x64

VERSION="$VERSION" \
RELEASE_URL="$RELEASE_URL" \
node <<'NODE'
const fs = require('node:fs');

const version = process.env.VERSION;
const releaseUrl = process.env.RELEASE_URL;

const artifacts = {
  'darwin-aarch64': 'aarch64',
  'darwin-aarch64-app': 'aarch64',
  'darwin-x86_64': 'x64',
  'darwin-x86_64-app': 'x64'
};

const platforms = {};
for (const [platform, arch] of Object.entries(artifacts)) {
  const updaterName = `stiki-${version}-${arch}.app.tar.gz`;
  const signature = fs.readFileSync(`dist/${updaterName}.sig`, 'utf8').trim();
  platforms[platform] = {
    signature,
    url: `${releaseUrl}/${updaterName}`
  };
}

const latest = {
  version,
  notes: 'Open the DMG and drag stiki.app to Applications.',
  pub_date: new Date().toISOString(),
  platforms
};

fs.writeFileSync('dist/latest.json', `${JSON.stringify(latest, null, 2)}\n`);
NODE

echo "Built dist/stiki-${VERSION}-aarch64.dmg"
echo "Built dist/stiki-${VERSION}-x64.dmg"
