#!/bin/bash
# Wrapper: call the real linker, then fix Mach-O string pool alignment for proc-macro dylibs.
# Needed on macOS 27 beta: Apple LD 1328.2 produces 4-byte-aligned string pools at opt>0,
# but dyld now requires 8-byte alignment.

cc "$@"
STATUS=$?
[ $STATUS -ne 0 ] && exit $STATUS

# Find -o <output> in args
PREV=""
OUTPUT=""
for arg in "$@"; do
  [ "$PREV" = "-o" ] && OUTPUT="$arg"
  PREV="$arg"
done

# Fix alignment only for proc-macro dylibs (in target/.../deps/)
if [[ "$OUTPUT" == *"/deps/"*.dylib ]]; then
  python3 "$(dirname "$0")/fix-proc-macro-dylib.py" "$OUTPUT" 2>/dev/null || true
fi

exit 0
