#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRANSCRIBER_DIR="$ROOT/src-tauri/native/transcriber"
BUNDLE_DIR="$TRANSCRIBER_DIR/bundle"
RUNTIME_DIR="$BUNDLE_DIR/runtime"
REQUIREMENTS="$TRANSCRIBER_DIR/requirements.txt"
ARCH="${1:-$(uname -m)}"

case "$ARCH" in
  aarch64|arm64)
    EXPECTED_UNAME="arm64"
    ;;
  x64|x86_64)
    EXPECTED_UNAME="x86_64"
    ;;
  *)
    echo "error: unsupported native transcriber runtime arch: $ARCH" >&2
    exit 1
    ;;
esac

HOST_ARCH="$(uname -m)"
if [[ "$HOST_ARCH" != "$EXPECTED_UNAME" ]]; then
  echo "error: cannot prepare $ARCH Python runtime on $HOST_ARCH host; use a matching macOS runner" >&2
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "error: uv is required to prepare the SenseVoice Python runtime" >&2
  exit 1
fi

uv python install 3.12
PYTHON_BIN="$(uv python find 3.12)"
PYTHON_ROOT="$(cd "$(dirname "$PYTHON_BIN")/.." && pwd -P)"
PYTHON_VERSION="$("$PYTHON_BIN" - <<'PY'
import sys
print(f"{sys.version_info.major}.{sys.version_info.minor}")
PY
)"
SITE_PACKAGES="lib/python${PYTHON_VERSION}/site-packages"
READY_FILE="$RUNTIME_DIR/.stiki-runtime-ready"
REQUIREMENTS_HASH="$(shasum -a 256 "$REQUIREMENTS" | awk '{print $1}')"

if [[ ! -L "$RUNTIME_DIR" && -x "$RUNTIME_DIR/bin/python${PYTHON_VERSION}" && -f "$READY_FILE" ]] && grep -q "$REQUIREMENTS_HASH" "$READY_FILE"; then
  echo "Native transcriber Python runtime already prepared at $RUNTIME_DIR"
  exit 0
fi

TMP_DIR="$BUNDLE_DIR/runtime.tmp"
rm -rf "$TMP_DIR"
mkdir -p "$BUNDLE_DIR"
cp -R "$PYTHON_ROOT" "$TMP_DIR"
rm -rf "$TMP_DIR/$SITE_PACKAGES"
mkdir -p "$TMP_DIR/$SITE_PACKAGES"

uv pip install \
  --python "$TMP_DIR/bin/python${PYTHON_VERSION}" \
  --target "$TMP_DIR/$SITE_PACKAGES" \
  --requirements "$REQUIREMENTS" \
  --link-mode copy

find "$TMP_DIR" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "$TMP_DIR" -type f -name '*.pyc' -delete

rm -rf "$RUNTIME_DIR"
mv "$TMP_DIR" "$RUNTIME_DIR"
printf 'requirements=%s\npython=%s\narch=%s\n' "$REQUIREMENTS_HASH" "$PYTHON_VERSION" "$EXPECTED_UNAME" >"$READY_FILE"

echo "Prepared native transcriber Python runtime at $RUNTIME_DIR"
