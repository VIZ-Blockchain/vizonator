#!/bin/sh
set -e

BROWSER="${1:-chrome}"
OUTPUT="${2:-/tmp/vizonator.zip}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

VERSION=$(grep '"version"' manifest.json | cut -d'"' -f4)
echo "Building Vizonator v${VERSION} for ${BROWSER}..."

# Select manifest file based on browser
if [ "$BROWSER" = "firefox" ]; then
    MANIFEST_SRC="manifest-firefox.json"
    MANIFEST_DST="manifest.json"
    EXCLUDE_MANIFEST="manifest-chrome.json"
else
    MANIFEST_SRC="manifest.json"
    MANIFEST_DST="manifest.json"
    EXCLUDE_MANIFEST="manifest-firefox.json"
fi

python3 -c "
import zipfile, os, json, shutil, tempfile

exclude = {'.git', '.github', 'bin', 'screenshot', 'tests', '.gitignore', '.gitattributes', 'DEPLOY.md'}
exclude_ext = ('.sh', '.md')
browser = '$BROWSER'
manifest_src = '$MANIFEST_SRC'
exclude_manifest = '$EXCLUDE_MANIFEST'

with zipfile.ZipFile('$OUTPUT', 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in exclude and not d.startswith('.')]
        for f in files:
            if f in exclude:
                continue
            if any(f.endswith(e) for e in exclude_ext):
                continue
            # Exclude the other browser's manifest
            if f == exclude_manifest:
                continue
            # For Firefox: use manifest-firefox.json as manifest.json
            if browser == 'firefox' and f == 'manifest.json':
                zf.write('manifest-firefox.json', 'manifest.json')
                continue
            # Skip manifest-firefox.json from being included as itself
            if f == 'manifest-firefox.json':
                continue
            filepath = os.path.join(root, f)
            arcname = filepath[2:] if filepath.startswith('./') else filepath
            zf.write(filepath, arcname)
"

SIZE=$(stat -c%s "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT")
echo "Created: $OUTPUT ($SIZE bytes) for ${BROWSER}"
