#!/bin/bash
# RUSTC_WRAPPER: Cargo calls this as: <wrapper> <rustc> [rustc-args...]
# After compilation, fixes proc-macro dylib alignment for macOS 27 beta.
# Apple LD 1328.2 produces 4-byte-aligned LINKEDIT string pools at opt>0,
# but dyld requires 8-byte alignment.

RUSTC="$1"
shift
"$RUSTC" "$@"
STATUS=$?
[ $STATUS -ne 0 ] && exit $STATUS

# Only patch proc-macro dylibs
IS_PROC_MACRO=false
OUT_DIR=""
EXTRA_FILENAME=""
CRATE_NAME=""
PREV=""
for arg in "$@"; do
  case "$PREV" in
    --out-dir) OUT_DIR="$arg" ;;
    --crate-name) CRATE_NAME="$arg" ;;
  esac
  case "$arg" in
    proc-macro) IS_PROC_MACRO=true ;;
    -Cextra-filename=*) EXTRA_FILENAME="${arg#-Cextra-filename=}" ;;
    extra-filename=*) EXTRA_FILENAME="${arg#extra-filename=}" ;;
  esac
  PREV="$arg"
done

if $IS_PROC_MACRO && [ -n "$OUT_DIR" ] && [ -n "$CRATE_NAME" ]; then
  DYLIB="$OUT_DIR/lib${CRATE_NAME}${EXTRA_FILENAME}.dylib"
  if [ -f "$DYLIB" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    python3 "$SCRIPT_DIR/fix-proc-macro-dylib.py" "$DYLIB" 2>/dev/null || true
  fi
fi

exit 0
