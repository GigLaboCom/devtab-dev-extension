#!/usr/bin/env bash
# Prepares vendor/gpui-kit/checkout/: gpui-kit at the revision crates/Cargo.toml pins, with every patch of
# vendor/gpui-kit/patches/ applied (in name order). The [patch] section of crates/Cargo.toml builds the crates against
# this checkout instead of the git dependency (docs/extension-structure.md §11.8). The checkout is generated and
# ignored; the revision and the patches are the record.
#
#   vendor/gpui-kit/prepare.sh      # does nothing when the checkout already matches the revision and the patches
#
# crates/review-wasm/build.sh runs it first; run it once by hand before `cargo test` / `cargo run` in crates/, and
# again after the revision or a patch changes. GPUI_KIT_GIT=<url or path> clones from elsewhere, e.g. a local clone
# that has the revision; the default is the fork the revision comes from.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
repo="$(cd "$here/../.." && pwd -P)"
checkout="$here/checkout"
source="${GPUI_KIT_GIT:-https://github.com/glani/gpui-component}"

rev="$(sed -n 's/^gpui-component = { git = "[^"]*", rev = "\([0-9a-f]\{40\}\)" }$/\1/p' "$repo/crates/Cargo.toml")"
if [[ -z "$rev" ]]; then
    echo "[gpui-kit] no pinned rev of gpui-component in crates/Cargo.toml" >&2
    exit 1
fi

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
patches=()
for patch in "$here"/patches/*.patch; do
    [[ -e "$patch" ]] && patches+=("$patch")
done
stamp="$(
    echo "rev $rev"
    for patch in ${patches[@]+"${patches[@]}"}; do echo "$(basename "$patch") $(sha "$patch")"; done
)"
if [[ -f "$checkout/.prepared" ]] && [[ "$(cat "$checkout/.prepared")" == "$stamp" ]]; then
    echo "[gpui-kit] checkout is up to date: ${rev:0:10} + ${#patches[@]} patch(es)"
    exit 0
fi

rm -rf "$checkout"
echo "[gpui-kit] cloning ${rev:0:10} from $source"
# One commit when git can fetch it by id (2.49+); otherwise the history, then the commit.
if ! git clone --quiet --depth 1 --revision "$rev" "$source" "$checkout" 2>/dev/null; then
    rm -rf "$checkout"
    git clone --quiet --no-checkout --filter=blob:none "$source" "$checkout"
    git -C "$checkout" -c advice.detachedHead=false checkout --quiet "$rev"
fi
if [[ "$(git -C "$checkout" rev-parse HEAD)" != "$rev" ]]; then
    echo "[gpui-kit] the checkout is not at $rev" >&2
    exit 1
fi
for patch in ${patches[@]+"${patches[@]}"}; do
    echo "[gpui-kit] applying $(basename "$patch")"
    git -C "$checkout" apply "$patch"
done
echo "$stamp" > "$checkout/.prepared"
echo "[gpui-kit] checkout ready: ${rev:0:10} + ${#patches[@]} patch(es) in ${checkout#"$repo"/}"
