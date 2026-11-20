#!/bin/bash
# sync.sh — put the prebuilt review editor (wasm + its wasm-bindgen JS) into packages/review-wasm/pkg/.
#
# The module is built from the Rust workspace in crates/ (crates/review-wasm over crates/review-view) by
# crates/review-wasm/build.sh (Rust 1.100.0; a cold build takes several minutes and several GB); the extension does not
# depend on cargo. Sources, first found wins:
#   1. $REVIEW_WASM_PKG          a directory with review_wasm.js + review_wasm_bg.wasm
#   2. crates/review-wasm/pkg    the release build of build.sh
# None found: build it (crates/review-wasm/build.sh) and run this again. The spike's module (spikes/review-wasm) is
# not a source any more: it lacks compare_texts.
#
# The module is checked before it is used, also when a copy already in pkg/ is kept: the JS must export run /
# set_theme / compare_texts / show_diff (the host wrapper's contract, lib/host.ts and lib/glue.d.ts). pkg/SOURCE
# records where it came from and the sha256 of both files; scripts/validate-build.sh checks that the extension ships
# exactly this wasm. Files are copied only when they differ, so a rebuild keeps their mtime.
#
# Usage: bash scripts/sync.sh            (turbo runs it as this package's `ready`)

set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd -P)"
repo="$(cd "$here/../.." && pwd -P)"
out="$here/pkg"
exports="run set_theme compare_texts show_diff"

# Fails unless the module's JS exports every function of the contract.
check_exports() {
  local name
  for name in $exports; do
    if ! grep -qE "^export function $name\(" "$1/review_wasm.js"; then
      echo "[review-wasm] $1/review_wasm.js does not export $name() — not the module the host expects." >&2
      echo "[review-wasm] Build it: crates/review-wasm/build.sh, then run this again." >&2
      exit 1
    fi
  done
}

candidates=()
[ -n "${REVIEW_WASM_PKG:-}" ] && candidates+=("$REVIEW_WASM_PKG")
candidates+=("$repo/crates/review-wasm/pkg")

src=""
for dir in "${candidates[@]}"; do
  if [ -f "$dir/review_wasm.js" ] && [ -f "$dir/review_wasm_bg.wasm" ]; then
    src="$(cd "$dir" && pwd -P)"
    break
  fi
done

if [ -z "$src" ]; then
  if [ -f "$out/review_wasm.js" ] && [ -f "$out/review_wasm_bg.wasm" ]; then
    check_exports "$out"
    echo "[review-wasm] no source found; keeping the copy in pkg/ ($(head -1 "$out/SOURCE" 2>/dev/null || echo unknown))"
    exit 0
  fi
  echo "[review-wasm] the editor module is missing. Build it: crates/review-wasm/build.sh" >&2
  echo "[review-wasm] or point REVIEW_WASM_PKG at a directory with review_wasm.js + review_wasm_bg.wasm." >&2
  exit 1
fi

check_exports "$src"

mkdir -p "$out"
for file in review_wasm.js review_wasm_bg.wasm; do
  cmp -s "$src/$file" "$out/$file" || cp "$src/$file" "$out/$file"
done

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
{
  echo "${src#"$repo"/}"
  echo "review_wasm.js $(sha "$out/review_wasm.js")"
  echo "review_wasm_bg.wasm $(sha "$out/review_wasm_bg.wasm")"
} > "$out/SOURCE.tmp"
cmp -s "$out/SOURCE.tmp" "$out/SOURCE" 2>/dev/null && rm "$out/SOURCE.tmp" || mv "$out/SOURCE.tmp" "$out/SOURCE"

echo "[review-wasm] pkg/ from ${src#"$repo"/} ($(wc -c < "$out/review_wasm_bg.wasm" | tr -d ' ') bytes of wasm)"
