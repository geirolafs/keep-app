#!/usr/bin/env bash
set -euo pipefail

APP="src-tauri/target/release/bundle/macos/keep.app"
BINARY="$APP/Contents/MacOS/keep"
FRAMEWORKS="$APP/Contents/Frameworks"
DMG="src-tauri/target/release/bundle/dmg/keep_0.1.0_aarch64.dmg"

if [ ! -f "$BINARY" ]; then
  echo "Error: binary not found at $BINARY" >&2
  exit 1
fi

if ! command -v dylibbundler &>/dev/null; then
  echo "Error: dylibbundler not found — run: brew install dylibbundler" >&2
  exit 1
fi

rm -rf "$FRAMEWORKS"
mkdir -p "$FRAMEWORKS"

# Force-copy the fresh Rust binary before patching.
# Tauri's incremental bundler skips this copy when the .app binary mtime is
# newer than target/release/keep (which happens after dylibbundler modifies
# it in a previous release), causing subsequent releases to re-patch a stale
# dylibbundler-patched binary and produce an outdated DMG.
cp "src-tauri/target/release/keep" "$BINARY"

echo "Bundling dylibs..."
dylibbundler -od -b \
  -x "$BINARY" \
  -d "$FRAMEWORKS" \
  -p @executable_path/../Frameworks/

touch "$APP"

echo "Bundled libs:"
ls "$FRAMEWORKS"

CREATE_DMG="src-tauri/target/release/bundle/dmg/bundle_dmg.sh"

STAGING=$(mktemp -d)
cp -r "$APP" "$STAGING/"

echo "Creating DMG..."
rm -f "$DMG"
"$CREATE_DMG" \
  --volname "keep" \
  --window-size 600 400 \
  --icon-size 120 \
  --icon "keep.app" 150 185 \
  --app-drop-link 450 185 \
  --hide-extension "keep.app" \
  "$DMG" \
  "$STAGING"

rm -rf "$STAGING"
echo "Done: $DMG"
