#!/usr/bin/env bash
set -euo pipefail

APP="src-tauri/target/release/bundle/macos/keep.app"
BINARY="$APP/Contents/MacOS/keep"
FRAMEWORKS="$APP/Contents/Frameworks"

if [ ! -f "$BINARY" ]; then
  echo "Error: binary not found at $BINARY" >&2
  exit 1
fi

if ! command -v dylibbundler &>/dev/null; then
  echo "Error: dylibbundler not found — run: brew install dylibbundler" >&2
  exit 1
fi

mkdir -p "$FRAMEWORKS"

echo "Bundling dylibs into $FRAMEWORKS..."
dylibbundler -od -b \
  -x "$BINARY" \
  -d "$FRAMEWORKS" \
  -p @executable_path/../Frameworks/

echo "Done. Bundled libs:"
ls "$FRAMEWORKS"
