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
# The module is checked before it is used, also when a copy already in pkg/ is kept: the JS must export every function
# of the host wrapper's contract (lib/host.ts and lib/glue.d.ts; the list is `exports` below). pkg/SOURCE
# records where it came from and the sha256 of both files; scripts/validate-build.sh checks that the extension ships
# exactly this wasm. Files are copied only when they differ, so a rebuild keeps their mtime.
#
# The mixed highlighter build (DEVTAB_VARIANT=highlighter:treeSitter) has a module of its own and its grammar files:
# `bash scripts/sync.sh tree-sitter` puts them into pkg-tree-sitter/ (the module, grammars/ with index.json, and
# licenses/ — the tree-sitter runtime's and every shipped grammar crate's licence, made by the same build) from
# $REVIEW_WASM_TREE_SITTER_PKG or crates/review-wasm/pkg-tree-sitter (`HIGHLIGHTER=tree-sitter build.sh`). Its module
# must export the grammar functions as well, every grammar file must be the one its index.json states (size, sha256),
# and grammars/ holds nothing else; SOURCE records the index's sha256 too. Without an argument the module is the one
# the highlighter's root chooses as written (extension/src/highlighter/index.ts): `syntect` today, so pkg/.
#
# Usage: bash scripts/sync.sh            (turbo runs it as this package's `ready`)
#        bash scripts/sync.sh tree-sitter  (pnpm --filter @extension/review-wasm ready:tree-sitter)

set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd -P)"
repo="$(cd "$here/../.." && pwd -P)"
exports="run set_theme compare_texts show_diff set_side set_language swap_sides set_editable side_text mark_saved focused_side focus_side"
mode="${1:-}"
if [ -z "$mode" ] && grep -qE "^export \{ treeSitter as highlighter \}" "$repo/extension/src/highlighter/index.ts"; then
  mode=tree-sitter
fi
case "$mode" in
  "")
    out="$here/pkg"
    pkg_env="REVIEW_WASM_PKG"
    built="crates/review-wasm/pkg"
    build="crates/review-wasm/build.sh"
    grammars=false
    ;;
  tree-sitter)
    out="$here/pkg-tree-sitter"
    pkg_env="REVIEW_WASM_TREE_SITTER_PKG"
    built="crates/review-wasm/pkg-tree-sitter"
    build="HIGHLIGHTER=tree-sitter crates/review-wasm/build.sh"
    grammars=true
    exports="$exports grammar_abi register_grammar function_table"
    ;;
  *)
    echo "[review-wasm] usage: sync.sh [tree-sitter]" >&2
    exit 2
    ;;
esac

# Fails unless the module's JS exports every function of the contract.
check_exports() {
  local name
  for name in $exports; do
    if ! grep -qE "^export function $name\(" "$1/review_wasm.js"; then
      echo "[review-wasm] $1/review_wasm.js does not export $name() — not the module the host expects." >&2
      echo "[review-wasm] Build it: $build, then run this again." >&2
      exit 1
    fi
  done
}

candidates=()
[ -n "${!pkg_env:-}" ] && candidates+=("${!pkg_env}")
candidates+=("$repo/$built")

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
    echo "[review-wasm] no source found; keeping the copy in ${out#"$here"/}/ ($(head -1 "$out/SOURCE" 2>/dev/null || echo unknown))"
    exit 0
  fi
  echo "[review-wasm] the editor module is missing. Build it: $build" >&2
  echo "[review-wasm] or point $pkg_env at a directory with review_wasm.js + review_wasm_bg.wasm." >&2
  exit 1
fi

check_exports "$src"

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# The grammar files: exactly what the index lists, each as it states.
check_grammars() {
  local dir="$1/grammars" listed file
  [ -f "$dir/index.json" ] || { echo "[review-wasm] $dir/index.json is missing — build: $build" >&2; exit 1; }
  listed="$(jq -r '[.grammars[] | "\(.file) \(.size) \(.sha256)"] | unique | .[]' "$dir/index.json")"
  while read -r file size digest; do
    [ -f "$dir/$file" ] || { echo "[review-wasm] $dir/$file (in index.json) is missing" >&2; exit 1; }
    if [ "$(wc -c < "$dir/$file" | tr -d ' ')" != "$size" ] || [ "$(sha "$dir/$file")" != "$digest" ]; then
      echo "[review-wasm] $dir/$file is not the file index.json states" >&2
      exit 1
    fi
  done <<< "$listed"
  for file in "$dir"/*; do
    file="${file##*/}"
    [ "$file" = index.json ] || grep -q "^$file " <<< "$listed" || {
      echo "[review-wasm] $dir/$file is not in index.json" >&2
      exit 1
    }
  done
}
$grammars && check_grammars "$src"

mkdir -p "$out"
for file in review_wasm.js review_wasm_bg.wasm; do
  cmp -s "$src/$file" "$out/$file" || cp "$src/$file" "$out/$file"
done
# A directory's files as the source has them: new and changed ones copied, the ones it no longer has removed.
mirror() {
  local file
  [ -d "$src/$1" ] || { echo "[review-wasm] $src/$1 is missing — build: $build" >&2; exit 1; }
  mkdir -p "$out/$1"
  for file in "$out/$1"/*; do
    if [ -e "$file" ] && [ ! -e "$src/$1/${file##*/}" ]; then rm "$file"; fi
  done
  for file in "$src/$1"/*; do
    cmp -s "$file" "$out/$1/${file##*/}" || cp "$file" "$out/$1/${file##*/}"
  done
}
if $grammars; then
  mirror grammars
  # The licences of the tree-sitter runtime and of every grammar it ships (vite.config.ts emits them).
  mirror licenses
fi

{
  echo "${src#"$repo"/}"
  echo "review_wasm.js $(sha "$out/review_wasm.js")"
  echo "review_wasm_bg.wasm $(sha "$out/review_wasm_bg.wasm")"
  if $grammars; then echo "grammars/index.json $(sha "$out/grammars/index.json")"; fi
} > "$out/SOURCE.tmp"
cmp -s "$out/SOURCE.tmp" "$out/SOURCE" 2>/dev/null && rm "$out/SOURCE.tmp" || mv "$out/SOURCE.tmp" "$out/SOURCE"

echo "[review-wasm] ${out#"$here"/}/ from ${src#"$repo"/} ($(wc -c < "$out/review_wasm_bg.wasm" | tr -d ' ') bytes of wasm$($grammars && echo ", $(ls "$out/grammars" | grep -c '\.wasm$') grammar files"))"
