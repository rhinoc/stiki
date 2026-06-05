#!/usr/bin/env bash
set -euo pipefail

IDENTITY="${STIKI_LOCAL_CODESIGN_IDENTITY:-Stiki Local Development}"
KEYCHAIN="${STIKI_LOCAL_CODESIGN_KEYCHAIN:-$HOME/Library/Keychains/stiki-local-signing.keychain-db}"
KEYCHAIN_PASSWORD="${STIKI_LOCAL_CODESIGN_KEYCHAIN_PASSWORD:-stiki-local-signing}"

existing_identity() {
  security find-identity -v -p codesigning 2>/dev/null \
    | awk -F'"' -v identity="$IDENTITY" '$2 == identity { print $2; exit }'
}

if [[ "$(existing_identity)" == "$IDENTITY" ]]; then
  echo "$IDENTITY"
  exit 0
fi

if [[ ! -f "$KEYCHAIN" ]]; then
  security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
fi

security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"

current_keychains="$(security list-keychains -d user | tr -d ' "')"
if ! grep -Fxq "$KEYCHAIN" <<<"$current_keychains"; then
  security list-keychains -d user -s "$KEYCHAIN" $current_keychains
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

cat >"$workdir/openssl.cnf" <<EOF
[req]
distinguished_name = subject
x509_extensions = extensions
prompt = no

[subject]
CN = $IDENTITY

[extensions]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF

openssl req \
  -new \
  -newkey rsa:2048 \
  -nodes \
  -x509 \
  -days 3650 \
  -sha256 \
  -config "$workdir/openssl.cnf" \
  -keyout "$workdir/codesign.key" \
  -out "$workdir/codesign.crt" >/dev/null 2>&1

security add-trusted-cert \
  -r trustRoot \
  -p codeSign \
  -k "$KEYCHAIN" \
  "$workdir/codesign.crt"

openssl pkcs12 \
  -export \
  -legacy \
  -inkey "$workdir/codesign.key" \
  -in "$workdir/codesign.crt" \
  -out "$workdir/codesign.p12" \
  -passout "pass:$KEYCHAIN_PASSWORD" >/dev/null 2>&1

security import "$workdir/codesign.p12" \
  -k "$KEYCHAIN" \
  -P "$KEYCHAIN_PASSWORD" \
  -A \
  -T /usr/bin/codesign >/dev/null

security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$KEYCHAIN_PASSWORD" \
  "$KEYCHAIN" >/dev/null

if [[ "$(existing_identity)" != "$IDENTITY" ]]; then
  echo "error: failed to create local code signing identity: $IDENTITY" >&2
  security find-identity -v -p codesigning "$KEYCHAIN" >&2 || true
  exit 1
fi

echo "$IDENTITY"
