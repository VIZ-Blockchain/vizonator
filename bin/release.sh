#!/bin/sh
# One command per release: tests -> version bump in both manifests -> commit -> tag -> push.
# Everything after the push is done by .github/workflows/publish.yml
# (build, store upload, GitHub Release with both ZIPs).
#
#   bin/release.sh 0.76 "short release note"
#   bin/release.sh 0.76 "note" --dry-run   # do everything except commit/tag/push
set -e

VERSION="$1"
NOTE="$2"
DRY=""
for a in "$@"; do
    [ "$a" = "--dry-run" ] && DRY=1
done

if [ -z "$VERSION" ]; then
    echo "usage: bin/release.sh <version> [\"release note\"] [--dry-run]" >&2
    exit 2
fi
case "$VERSION" in
    v*) echo "version without the leading v, e.g. 0.76" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$BRANCH" = "main" ] || { echo "not on main (on $BRANCH)" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is dirty, commit or stash first" >&2; git status --short >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && { echo "tag v$VERSION already exists" >&2; exit 1; }

echo "=== tests"
sh bin/run-tests.sh

echo "=== bump to $VERSION"
for m in manifest.json manifest-firefox.json; do
    python3 - "$m" "$VERSION" <<'PY'
import re, sys
path, ver = sys.argv[1], sys.argv[2]
src = open(path).read()
new, n = re.subn(r'("version"\s*:\s*")[^"]+(")', r'\g<1>' + ver + r'\g<2>', src, count=1)
if n != 1:
    sys.exit('no version field in ' + path)
open(path, 'w').write(new)
PY
    echo "  $m -> $VERSION"
done

echo "=== build check"
sh bin/build-zip.sh chrome /tmp/vizonator-chrome-$VERSION.zip
sh bin/build-zip.sh firefox /tmp/vizonator-firefox-$VERSION.zip

if [ -n "$DRY" ]; then
    echo "dry run: manifests bumped locally, nothing committed. Revert with: git checkout -- manifest.json manifest-firefox.json"
    exit 0
fi

MSG="v$VERSION"
[ -n "$NOTE" ] && MSG="v$VERSION: $NOTE"
git add manifest.json manifest-firefox.json
git commit -m "$MSG"
git tag -a "v$VERSION" -m "$MSG"
git push origin main
git push origin "v$VERSION"

echo "pushed v$VERSION — publish.yml now builds, uploads to both stores and creates the GitHub Release"
