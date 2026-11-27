#!/usr/bin/env bash
# Builds the editor module (wasm + its wasm-bindgen JS) into crates/review-wasm/pkg/, where
# packages/review-wasm/scripts/sync.sh takes it from.
#
#   ./build.sh            # release profile (gpui-kit's own settings)
#   ./build.sh small      # size-first profile: opt-level=s, fat LTO, panic=abort
#   CARGO_FLAGS="--no-default-features --features tree-sitter" OUT=<dir> ./build.sh
#                         # the tree-sitter highlighter instead of syntect, into another directory (not shipped)
#   HIGHLIGHTER=tree-sitter ./build.sh
#                         # the mixed highlighter (DEVTAB_VARIANT=highlighter:treeSitter): tree-sitter with the grammars
#                         # grammars.json marks builtIn compiled in, into pkg-tree-sitter/, and the others as grammar
#                         # files in pkg-tree-sitter/grammars/ with their index.json (grammars/build.mjs, needs node)
#
# A tree-sitter build compiles the grammars' C code for wasm: it needs clang with the wasm32 target, llvm-ar
# (`rustup component add llvm-tools`) and jq; tree-sitter-language's wasm headers are found below.
#
# wasm-bindgen's CLI must be the exact version of the `wasm-bindgen` crate in Cargo.lock. It is installed into
# crates/.tools/ on first use, so a different global version stays untouched.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
crates="$(cd "$here/.." && pwd -P)"
cd "$crates"

profile="${1:-release}"
# gpui-kit at the pinned commit of upstream main with the pull requests not yet merged (the [patch] of
# crates/Cargo.toml).
"$crates/../vendor/gpui-kit/prepare.sh"
crate_version="$(awk '/^name = "wasm-bindgen"$/{getline; gsub(/[^0-9.]/,"",$0); print; exit}' Cargo.lock)"
bindgen=".tools/bin/wasm-bindgen"
if [[ ! -x "$bindgen" ]] || [[ "$("$bindgen" --version | awk '{print $2}')" != "$crate_version" ]]; then
    echo "installing wasm-bindgen-cli $crate_version into crates/.tools/"
    cargo install wasm-bindgen-cli --version "$crate_version" --locked --root .tools
fi

# No absolute build paths in the module: panic locations and file!() of every crate built for the target (this
# workspace, the gpui-kit checkout, the registry and git sources) name /src, /cargo and /rustup instead of this
# machine's directories. rustc applies the last prefix that matches, so the home directory (~) is only the fallback.
# The flags go to target crates only (--target is given), so host build scripts and proc macros are not rebuilt.
root="$(cd "$crates/.." && pwd -P)"
remap=(
    "--remap-path-prefix=$HOME=~"
    "--remap-path-prefix=${RUSTUP_HOME:-$HOME/.rustup}=/rustup"
    "--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
    "--remap-path-prefix=$root=/src"
)
sep=$'\037'
flags="${CARGO_ENCODED_RUSTFLAGS:-}"
if [[ -z "$flags" && -n "${RUSTFLAGS:-}" ]]; then
    flags="$(printf '%s' "$RUSTFLAGS" | tr -s ' ' "$sep")"
fi
for flag in "${remap[@]}"; do
    flags="${flags:+$flags$sep}$flag"
done
export CARGO_ENCODED_RUSTFLAGS="$flags"
unset RUSTFLAGS

# The mixed highlighter: the built-in grammars' features come from the table, and the module is linked so that a
# grammar file can join it at run time — a function table that grows, and the shadow stack's pointer exported (the
# grammars' C code uses the module's stack). Nothing else differs from a tree-sitter build.
link_args=()
if [[ "${HIGHLIGHTER:-}" == "tree-sitter" ]]; then
    if [[ -n "${CARGO_FLAGS:-}" ]]; then
        echo "HIGHLIGHTER=tree-sitter chooses the features itself (grammars.json); leave CARGO_FLAGS unset" >&2
        exit 1
    fi
    CARGO_FLAGS="--no-default-features --features grammar-files,$(node "$here/grammars/build.mjs" features)"
    link_args=(-C link-arg=--growable-table -C link-arg=--export=__stack_pointer)
    OUT="${OUT:-$here/pkg-tree-sitter}"
elif [[ -n "${HIGHLIGHTER:-}" ]]; then
    echo "HIGHLIGHTER is tree-sitter or unset (syntect), not \"$HIGHLIGHTER\"" >&2
    exit 1
fi

# The tree-sitter highlighter: the C toolchain for the grammars, and the same remapping for the C sources' paths.
# What gpui-kit's script/wasm-cc-env (pull request #4006) does, with the features of this build: its own
# `cargo metadata` sees the default features only, which have no tree-sitter.
if [[ " ${CARGO_FLAGS:-} " == *tree-sitter* ]]; then
    host="$(rustc -vV | sed -n 's/^host: //p')"
    export CC_wasm32_unknown_unknown="${CC_wasm32_unknown_unknown:-clang}"
    if ! "$CC_wasm32_unknown_unknown" --print-targets 2>/dev/null | grep -q wasm32; then
        echo "tree-sitter: $CC_wasm32_unknown_unknown has no wasm32 target (clang from Xcode's tools or LLVM has it)" >&2
        exit 1
    fi
    export AR_wasm32_unknown_unknown="${AR_wasm32_unknown_unknown:-$(rustc --print sysroot)/lib/rustlib/$host/bin/llvm-ar}"
    if [[ ! -x "$AR_wasm32_unknown_unknown" ]]; then
        echo "tree-sitter: no llvm-ar at $AR_wasm32_unknown_unknown (rustup component add llvm-tools)" >&2
        exit 1
    fi
    headers="$(cargo metadata --format-version 1 --locked --all-features --filter-platform wasm32-unknown-unknown |
        jq -r 'first(.packages[] | select(.name == "tree-sitter-language") | .manifest_path) // empty')"
    [[ -n "$headers" ]] || { echo "tree-sitter: tree-sitter-language is not in the build (vendor/gpui-kit/patches/manifest)" >&2; exit 1; }
    CFLAGS_wasm32_unknown_unknown="${CFLAGS_wasm32_unknown_unknown:+$CFLAGS_wasm32_unknown_unknown }-I${headers%/Cargo.toml}/wasm/include"
    for map in "$root=/src" "${CARGO_HOME:-$HOME/.cargo}=/cargo" "${RUSTUP_HOME:-$HOME/.rustup}=/rustup"; do
        CFLAGS_wasm32_unknown_unknown="$CFLAGS_wasm32_unknown_unknown -ffile-prefix-map=$map"
    done
    export CFLAGS_wasm32_unknown_unknown
fi

# The editor's render tree needs more than wasm-ld's default 1 MiB stack
# (same flag as gpui-kit's crates/story-web/scripts/build-wasm.sh).
# CARGO_FLAGS=--no-default-features builds without the syntect highlighter; `--features tree-sitter` adds the other.
cargo rustc -p review-wasm --lib --target wasm32-unknown-unknown --profile "$profile" ${CARGO_FLAGS:-} -- \
    -C link-arg=-zstack-size=8388608 ${link_args[@]+"${link_args[@]}"}

target_dir="${CARGO_TARGET_DIR:-$crates/target}"
wasm="$target_dir/wasm32-unknown-unknown/$profile/review_wasm.wasm"
# OUT=<dir> keeps a second build next to the one the extension takes.
out="${OUT:-$here/pkg}"
rm -rf "$out"
"$bindgen" "$wasm" --out-dir "$out" --target web --no-typescript

size() {
    printf '%-22s wasm=%9s bytes  gzip=%8s bytes\n' "$1" \
        "$(wc -c < "$2" | tr -d ' ')" "$(gzip -9 -c "$2" | wc -c | tr -d ' ')"
}
size "profile=$profile" "$out/review_wasm_bg.wasm"
printf 'js=%s bytes\n' "$(wc -c < "$out/review_wasm.js" | tr -d ' ')"

# The grammar files of the mixed highlighter, built for this very module: a grammar may import only what it exports.
if [[ "${HIGHLIGHTER:-}" == "tree-sitter" ]]; then
    node "$here/grammars/build.mjs" files "$out/grammars" "$out/review_wasm_bg.wasm"
    node "$here/grammars/build.mjs" licenses "$out/licenses"
fi
