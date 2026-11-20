#!/usr/bin/env bash
# Builds the editor module (wasm + its wasm-bindgen JS) into crates/review-wasm/pkg/, where
# packages/review-wasm/scripts/sync.sh takes it from.
#
#   ./build.sh            # release profile (gpui-kit's own settings)
#   ./build.sh small      # size-first profile: opt-level=s, fat LTO, panic=abort
#
# wasm-bindgen's CLI must be the exact version of the `wasm-bindgen` crate in Cargo.lock. It is installed into
# crates/.tools/ on first use, so a different global version stays untouched.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
crates="$(cd "$here/.." && pwd -P)"
cd "$crates"

profile="${1:-release}"
# gpui-kit at the pinned revision with the fixes not yet on `land-next` (the [patch] of crates/Cargo.toml).
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

# The editor's render tree needs more than wasm-ld's default 1 MiB stack
# (same flag as gpui-kit's crates/story-web/scripts/build-wasm.sh).
# CARGO_FLAGS=--no-default-features builds without the syntect highlighter.
cargo rustc -p review-wasm --lib --target wasm32-unknown-unknown --profile "$profile" ${CARGO_FLAGS:-} -- \
    -C link-arg=-zstack-size=8388608

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
