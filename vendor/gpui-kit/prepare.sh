#!/usr/bin/env bash
# Prepares vendor/gpui-kit/checkout/: upstream gpui-kit at the commit of `main` crates/Cargo.toml pins, with the
# patches of vendor/gpui-kit/patches/manifest applied in the manifest's order (each an upstream pull request not yet
# merged). The [patch] section of crates/Cargo.toml builds the crates against this checkout instead of the git
# dependency (docs/extension-structure.md §11.8). The checkout is generated and ignored; the pin, the patches and the
# manifest are the record.
#
#   vendor/gpui-kit/prepare.sh      # does nothing when the checkout already matches the pin and the patches
#
# crates/review-wasm/build.sh runs it first; run it once by hand before `cargo test` / `cargo run` in crates/, and
# again after the pin or a patch changes. vendor/gpui-kit/bump.sh moves the pin and remakes the patches.
# GPUI_KIT_GIT=<url or path> clones from elsewhere, e.g. a local clone that has the commit; the default is the
# repository crates/Cargo.toml names.
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd -P)/lib.sh"

kit_read_pin
kit_read_manifest
source="${GPUI_KIT_GIT:-$kit_url}"
if [[ "$kit_mode" == branch ]]; then
    kit_say "branch mode: crates/Cargo.toml pins the fork's branch itself (${kit_rev:0:10}); nothing to prepare"
    exit 0
fi

# A patch on disk the manifest does not list would be silently left out: refuse it.
for patch in "$kit_patches"/*.patch; do
    [[ -e "$patch" ]] || continue
    listed=false
    for file in ${kit_files[@]+"${kit_files[@]}"}; do [[ "$file" == "$(basename "$patch")" ]] && listed=true; done
    $listed || kit_die "patches/$(basename "$patch") is not listed in patches/manifest (add it, or delete the file)"
done
for file in ${kit_files[@]+"${kit_files[@]}"}; do
    [[ -f "$kit_patches/$file" ]] || kit_die "patches/manifest lists $file, which is missing"
done

stamp="$(kit_stamp)"
if [[ -f "$kit_checkout/.prepared" ]] && [[ "$(cat "$kit_checkout/.prepared")" == "$stamp" ]]; then
    kit_say "checkout is up to date: ${kit_rev:0:10} + ${#kit_files[@]} patch(es)"
    exit 0
fi

# Reuse the clone when it has the commit (bump.sh leaves one with history); otherwise clone again. The clone has the
# whole history without file contents (--filter=blob:none): checking out one commit fetches its files only, and
# bump.sh can read the log and merge pull requests in it.
if [[ -d "$kit_checkout/.git" ]] && git -C "$kit_checkout" cat-file -e "$kit_rev^{commit}" 2>/dev/null; then
    kit_say "resetting the checkout to ${kit_rev:0:10}"
    git -C "$kit_checkout" merge --abort 2>/dev/null || true
    git -C "$kit_checkout" -c advice.detachedHead=false checkout --quiet --force --detach "$kit_rev"
    git -C "$kit_checkout" clean -fdxq
else
    rm -rf "$kit_checkout"
    kit_say "cloning ${kit_rev:0:10} from $source"
    git clone --quiet --filter=blob:none --no-checkout "$source" "$kit_checkout"
    if ! git -C "$kit_checkout" cat-file -e "$kit_rev^{commit}" 2>/dev/null; then
        git -C "$kit_checkout" fetch --quiet --filter=blob:none origin "$kit_rev" ||
            kit_die "$source has no commit $kit_rev"
    fi
    git -C "$kit_checkout" -c advice.detachedHead=false checkout --quiet --detach "$kit_rev"
fi
[[ "$(git -C "$kit_checkout" rev-parse HEAD)" == "$kit_rev" ]] || kit_die "the checkout is not at $kit_rev"

for i in ${kit_files[@]+"${!kit_files[@]}"}; do
    file="${kit_files[$i]}"
    pr="${kit_prs[$i]}"
    [[ "$pr" == "-" ]] && what="" || what=" (pull request #$pr)"
    kit_say "applying $file$what"
    if ! git -C "$kit_checkout" apply --whitespace=nowarn "$kit_patches/$file"; then
        {
            echo
            echo "[gpui-kit] FAILED: patches/$file does not apply to $(kit_github_slug "$kit_url")@$kit_rev."
            echo "[gpui-kit] What git rejects:"
            git -C "$kit_checkout" apply --check --verbose "$kit_patches/$file" 2>&1 | grep -E '^(error|Checking)' | sed 's/^/    /' | tail -25
            echo "[gpui-kit] The patch was made on main@$(kit_note_field "$file" base) (patches/${file%.patch}.md)."
            echo "[gpui-kit] Remake it for this commit: vendor/gpui-kit/bump.sh $kit_rev  (docs/editor-base.md)."
        } >&2
        git -C "$kit_checkout" checkout --quiet --force --detach "$kit_rev"
        git -C "$kit_checkout" clean -fdxq
        exit 1
    fi
done
echo "$stamp" >"$kit_checkout/.prepared"
kit_say "checkout ready: ${kit_rev:0:10} + ${#kit_files[@]} patch(es) in ${kit_checkout#"$kit_repo"/}"
