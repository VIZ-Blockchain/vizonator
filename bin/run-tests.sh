#!/bin/sh
# Runs the whole tests/ suite. Verdict = exit code (0 = all passed).
# CHROMIUM_BIN overrides the browser binary for the headless UI tests.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

PASS=0
FAIL=0
FAILED=""

for t in tests/*.mjs; do
    printf '=== %s\n' "$t"
    if node "$t"; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
        FAILED="$FAILED $t"
    fi
done

echo "SUITE: pass=$PASS fail=$FAIL"
if [ "$FAIL" -ne 0 ]; then
    echo "failed:$FAILED"
    exit 1
fi
