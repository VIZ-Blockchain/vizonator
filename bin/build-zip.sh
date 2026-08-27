#!/bin/sh
set -e

OUTPUT="${1:-/tmp/vizonator.zip}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

VERSION=$(grep '"version"' manifest.json | cut -d'"' -f4)
echo "Building Vizonator v${VERSION}..."

python3 -c "
import zipfile, os

exclude = {'.git', '.github', 'bin', 'screenshot', '.gitignore', '.gitattributes', 'DEPLOY.md'}
exclude_prefix = ('ltmp_',)
exclude_ext = ('.sh', '.md')

with zipfile.ZipFile('$OUTPUT', 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk('.'):
        dirs[:] = [d for d in dirs if d not in exclude and not d.startswith('.')]
        for f in files:
            if f in exclude:
                continue
            if any(f.startswith(p) for p in exclude_prefix):
                continue
            if any(f.endswith(e) for e in exclude_ext):
                continue
            filepath = os.path.join(root, f)
            arcname = filepath[2:] if filepath.startswith('./') else filepath
            zf.write(filepath, arcname)
"

SIZE=$(stat -c%s "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT")
echo "Created: $OUTPUT ($SIZE bytes)"
