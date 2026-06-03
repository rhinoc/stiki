#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT/VERSION"
current="$(tr -d '[:space:]' <"$VERSION_FILE")"

IFS='.' read -r major minor patch <<<"$current"
if [[ -z "${major:-}" || -z "${minor:-}" || -z "${patch:-}" ]]; then
  echo "VERSION must be semver x.y.z (got '$current')" >&2
  exit 1
fi

new="${major}.${minor}.$((patch + 1))"
printf '%s\n' "$new" >"$VERSION_FILE"

VERSION="$new" node <<'NODE'
const fs = require('node:fs');

const version = process.env.VERSION;
const packagePath = 'package.json';
const cargoTomlPath = 'src-tauri/Cargo.toml';
const cargoLockPath = 'src-tauri/Cargo.lock';

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = version;
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
cargoToml = cargoToml.replace(
  /(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
  `$1"${version}"`
);
fs.writeFileSync(cargoTomlPath, cargoToml);

let cargoLock = fs.readFileSync(cargoLockPath, 'utf8');
cargoLock = cargoLock.replace(
  /(\[\[package\]\]\nname = "stiki"\nversion = )"[^"]+"/,
  `$1"${version}"`
);
fs.writeFileSync(cargoLockPath, cargoLock);
NODE

printf '%s' "$new"
