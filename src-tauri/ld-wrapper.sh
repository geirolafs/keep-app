#!/bin/bash
# Custom linker wrapper: calls cc then fixes proc-macro dylib alignment.
# Workaround for Apple LD 1328.2 / macOS 27 beta: string pool 4-byte aligned
# instead of 8-byte aligned at opt-level > 0.

cc "$@"
STATUS=$?
[ $STATUS -ne 0 ] && exit $STATUS

PREV=""
OUTPUT=""
for arg in "$@"; do
  [ "$PREV" = "-o" ] && OUTPUT="$arg"
  PREV="$arg"
done

# Only fix proc-macro dylibs (in deps/ directories)
if [[ "$OUTPUT" == *"/deps/"*.dylib ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  python3 "$SCRIPT_DIR/fix-proc-macro-dylib.py" "$OUTPUT" 2>/dev/null || true
fi

exit 0
