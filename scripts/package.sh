#!/bin/bash

# package.sh — produce a Chrome Web Store-ready zip of the production build.
#
# Taken from the second sibling extension; counterpart of `pnpm zip` in the reference boilerplate (packages/zipper) and
# of the first sibling's stub, implemented without an extra workspace package:
#   1. pnpm build                                   (skipped with --skip-build, e.g. in CI)
#   2. scripts/validate-build.sh dist               (refuse to package a failing build)
#   3. zip the CONTENTS of dist/ (manifest.json at the archive root, as Chrome expects) to
#      dist-zip/<zipPrefix from extension/product.json>-<version>-<yyyy-mm-dd-hh-mm>.zip  (+ .sha256)
#   4. scripts/validate-build.sh <the zip>          (validate the archive actually shipped)
#
# Uses `zip` when installed, otherwise falls back to python3's zipfile module.
#
# Usage: scripts/package.sh [--skip-build]

set -euo pipefail

cd "$(dirname "$0")/.."

SKIP_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    *) echo "usage: $0 [--skip-build]" >&2; exit 2 ;;
  esac
done

if [ "$SKIP_BUILD" -eq 0 ]; then
  pnpm build
fi

bash scripts/validate-build.sh dist

VERSION=$(jq -r '.version' dist/manifest.json)
DATE_SUFFIX=$(date -u +%Y-%m-%d-%H-%M)
OUT_DIR="dist-zip"
PREFIX=$(jq -r '.zipPrefix' extension/product.json)
FILENAME="$PREFIX-$VERSION-$DATE_SUFFIX.zip"
OUT="$OUT_DIR/$FILENAME"

mkdir -p "$OUT_DIR"
rm -f "$OUT"

if command -v zip &> /dev/null; then
  (cd dist && zip -q -r -X "../$OUT" .)
else
  python3 - "$OUT" <<'PY'
import os, sys, zipfile
out = os.path.abspath(sys.argv[1])
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk("dist"):
        dirs.sort()
        for name in sorted(files):
            path = os.path.join(root, name)
            zf.write(path, os.path.relpath(path, "dist"))
PY
fi

if command -v sha256sum &> /dev/null; then
  (cd "$OUT_DIR" && sha256sum "$FILENAME" > "$FILENAME.sha256")
else
  (cd "$OUT_DIR" && shasum -a 256 "$FILENAME" > "$FILENAME.sha256")
fi

bash scripts/validate-build.sh "$OUT"

echo ""
echo "Packaged: $OUT"
cat "$OUT.sha256"
