#!/usr/bin/env bash
# Is the gpui-kit base consistent? (docs/editor-base.md; scripts/validate-build.sh runs it as check 18)
#
#   vendor/gpui-kit/check.sh             # everything, the upstream part over the network
#   vendor/gpui-kit/check.sh --offline   # the same without the network (or GPUI_KIT_OFFLINE=1)
#
# Both modes of patches/manifest:
#   - crates/Cargo.toml pins gpui-component and gpui-kit-assets to the same repository and commit;
#   - every pull request of the manifest has its note (<name>.md) with the block bump.sh writes, made for this base;
# patch mode:
#   - the pin is upstream gpui-kit; the checkout block of crates/Cargo.toml is a [patch] section for that repository
#     pointing both crates at the checkout; every patch is there, made for the pinned commit; no patch on disk is
#     missing from the manifest;
#   - when the checkout exists (a build has run here): its .prepared stamp is the pin plus the patches as they are now,
#     and the gpui-pre / lsp-types versions of crates/Cargo.toml are the ones gpui-kit pins at that commit;
# branch mode:
#   - the pin is the manifest's fork and the commit the notes record as the rebased tip; no [patch] section;
# over the network (a warning when it cannot be reached, never a pass):
#   - patch mode: the pinned commit is on upstream main's history (GitHub's compare API);
#   - branch mode: the base the notes record is on upstream main's history, and the fork has the pinned commit.
# Prints `ok:`, `warning:` and `error:` lines; exits 1 when there is an error.
set -uo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd -P)/lib.sh"

offline="${GPUI_KIT_OFFLINE:-}"
[[ "${1:-}" == "--offline" ]] && offline=1
errors=0
ok() { echo "ok: $*"; }
warning() { echo "warning: $*"; }
error() {
    echo "error: $*"
    errors=$((errors + 1))
}
# The version a [workspace.dependencies] gives a package, from stdin.
version_of() {
    awk -v pkg="$1" '
        /^\[/ { inside = ($0 == "[workspace.dependencies]") }
        inside && $0 ~ "^[A-Za-z0-9_-]+ = " { name = $1; if (match($0, /package = "[^"]+"/)) name = substr($0, RSTART + 11, RLENGTH - 12)
            if (name == pkg && match($0, /version = "[^"]+"/)) { print substr($0, RSTART + 11, RLENGTH - 12); exit } }'
}
# Is commit $2 on the history of ref $3 in GitHub repository $1? Prints ok / error / warning itself.
on_history() {
    local json status
    if [[ -n "$offline" ]]; then
        warning "not verified (offline): that ${2:0:12} is on $1 $3"
        return
    fi
    if ! json="$(kit_api_get "repos/$1/compare/$2...$3" 2>/dev/null)"; then
        warning "not verified (GitHub API not reachable, or $1 has no ${2:0:12}): that it is on $1 $3"
        return
    fi
    status="$(jq -r '.status // empty' <<<"$json")"
    case "$status" in
    identical) ok "${2:0:12} is the tip of $1 $3" ;;
    # base...head = commit...ref: "ahead" means the ref has commits the commit lacks, i.e. the commit is on its history.
    ahead) ok "${2:0:12} is on $1 $3's history, $(jq -r '.ahead_by' <<<"$json") commit(s) behind its tip" ;;
    *) if [[ -n "${4:-}" ]]; then
        warning "${2:0:12} is no longer on $1 $3 (moved since); a dated pin ref of the fork must keep it reachable"
    else
        error "${2:0:12} is not on $1 $3's history (compare status: ${status:-unknown})"
    fi ;;
    esac
}

kit_read_pin
kit_read_manifest
slug="$(kit_github_slug "$kit_url")"
upstream_slug="longbridge/gpui-kit"

pins="$(grep -cE "^(gpui-component|gpui-kit-assets) = \\{ git = \"$kit_url\", rev = \"$kit_rev\" \\}\$" "$kit_cargo_toml")"
[[ "$pins" == 2 ]] && ok "mode $kit_mode: gpui-component and gpui-kit-assets pinned to $slug@${kit_rev:0:12}" ||
    error "crates/Cargo.toml: gpui-component and gpui-kit-assets must name the same repository and rev"
has_patch_section=false
grep -qE '^\[patch\.' "$kit_cargo_toml" && has_patch_section=true

# The notes: one per entry, with the generated block, all made for one base.
base=""
last_tip=""
for i in ${kit_files[@]+"${!kit_files[@]}"}; do
    file="${kit_files[$i]}"
    pr="${kit_prs[$i]}"
    note="${file%.patch}.md"
    [[ -f "$kit_patches/$note" ]] || { error "patches/$file has no note patches/$note"; continue; }
    this_base="$(kit_note_field "$file" base)"
    last_tip="$(kit_note_field "$file" tip)"
    if [[ -z "$this_base" || -z "$last_tip" ]]; then
        error "patches/$note has no generated block with the base and the tip (vendor/gpui-kit/bump.sh writes it)"
        continue
    fi
    [[ -z "$base" ]] && base="$this_base"
    [[ "$this_base" == "$base" ]] || error "patches/$note was made for ${this_base:0:12}, another entry for ${base:0:12}: run vendor/gpui-kit/bump.sh"
    if [[ "$pr" != "-" && "$(kit_note_field "$file" "pull request")" != "$pr" ]]; then
        error "patches/$note does not name pull request #$pr, which the manifest gives"
    fi
done

if [[ "$kit_mode" == patch ]]; then
    [[ "$slug" == "$upstream_slug" ]] || error "patch mode pins upstream $upstream_slug, not $slug"
    grep -qxF "[patch.\"$kit_url\"]" "$kit_cargo_toml" &&
        grep -qE '^gpui-component = \{ path = "\.\./vendor/gpui-kit/checkout/crates/component" \}$' "$kit_cargo_toml" &&
        grep -qE '^gpui-kit-assets = \{ path = "\.\./vendor/gpui-kit/checkout/crates/assets" \}$' "$kit_cargo_toml" &&
        ok "[patch.\"$kit_url\"] builds both against vendor/gpui-kit/checkout" ||
        error "crates/Cargo.toml: no [patch.\"$kit_url\"] pointing gpui-component and gpui-kit-assets at ../vendor/gpui-kit/checkout"
    for i in ${kit_files[@]+"${!kit_files[@]}"}; do
        file="${kit_files[$i]}"
        pr="${kit_prs[$i]}"
        if [[ ! -s "$kit_patches/$file" ]]; then
            error "patches/$file (manifest) is missing or empty"
        elif [[ "$(kit_note_field "$file" base)" != "$kit_rev" ]]; then
            error "patches/$file was made for $(kit_note_field "$file" base | cut -c1-12), the pin is ${kit_rev:0:12}: remake it with vendor/gpui-kit/bump.sh $kit_rev"
        else
            ok "patches/$file$([[ "$pr" != "-" ]] && echo " (pull request #$pr, head $(kit_note_field "$file" head | cut -c1-12), rebase: $(kit_note_field "$file" rebase))") made for the pin"
        fi
    done
    for patch in "$kit_patches"/*.patch; do
        [[ -e "$patch" ]] || continue
        listed=false
        for file in ${kit_files[@]+"${kit_files[@]}"}; do [[ "$file" == "$(basename "$patch")" ]] && listed=true; done
        $listed || error "patches/$(basename "$patch") is not in patches/manifest"
    done
    if [[ -d "$kit_checkout" ]]; then
        if [[ -f "$kit_checkout/.prepared" ]] && [[ "$(cat "$kit_checkout/.prepared")" == "$(kit_stamp)" ]]; then
            ok "checkout/.prepared matches the pin and the patches"
            for pkg in gpui-pre gpui-pre-platform gpui-pre-web lsp-types; do
                mine="$(version_of "$pkg" <"$kit_cargo_toml")"
                theirs="$(version_of "$pkg" <"$kit_checkout/Cargo.toml")"
                [[ -z "$mine" || -z "$theirs" ]] && continue
                [[ "$mine" == "$theirs" ]] && ok "$pkg $mine as gpui-kit pins it" ||
                    error "$pkg: crates/Cargo.toml has $mine, gpui-kit at the pin has $theirs (vendor/gpui-kit/bump.sh aligns them)"
            done
        else
            error "checkout/.prepared does not match the pin and the patches: run vendor/gpui-kit/prepare.sh (and rebuild)"
        fi
    else
        ok "no checkout here (nothing built in this clone): the stamp and the versions are checked when there is one"
    fi
    on_history "$upstream_slug" "$kit_rev" main
else
    [[ "$kit_url" == "$kit_branch_url" ]] || error "branch mode pins $kit_branch_url (the manifest's branch line), not $kit_url"
    $has_patch_section && error "branch mode: crates/Cargo.toml still has a [patch] section (vendor/gpui-kit/bump.sh removes it)"
    if [[ -n "$last_tip" && "$kit_rev" != "$last_tip" ]]; then
        # The fork's commit may be another commit with the same tree (pushed from elsewhere); bump.sh compared the trees.
        ok "the pin ${kit_rev:0:12} is not the commit the notes record (${last_tip:0:12}); bump.sh pinned it after comparing their trees"
    elif [[ -n "$last_tip" ]]; then
        ok "the pin is the rebased tip the notes record"
    fi
    [[ -n "$base" ]] && on_history "$upstream_slug" "$base" main
    on_history "$(kit_github_slug "$kit_branch_url")" "$kit_rev" "$kit_branch" soft
fi

exit $((errors > 0))
