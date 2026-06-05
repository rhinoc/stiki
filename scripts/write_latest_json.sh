#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-$(tr -d '[:space:]' <VERSION)}"
TAG="app-v${VERSION}"
REPO="${GITHUB_REPOSITORY:-rhinoc/stiki}"
SERVER_URL="${GITHUB_SERVER_URL:-https://github.com}"
RELEASE_URL="${RELEASE_URL:-${SERVER_URL}/${REPO}/releases/download/${TAG}}"

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
  const signaturePath = `dist/${updaterName}.sig`;
  if (!fs.existsSync(signaturePath)) {
    throw new Error(`Missing updater signature: ${signaturePath}`);
  }
  const signature = fs.readFileSync(signaturePath, 'utf8').trim();
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

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/latest.json', `${JSON.stringify(latest, null, 2)}\n`);
NODE
