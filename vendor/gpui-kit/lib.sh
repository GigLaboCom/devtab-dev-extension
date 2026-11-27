# Shared by prepare.sh, bump.sh and check.sh (sourced, not run). The pin is the gpui-component line of
# crates/Cargo.toml: upstream gpui-kit's repository and an exact commit of its `main`. patches/manifest lists the
# patches applied on top of it, in order, each with the upstream pull request it mirrors (`-` for none).

kit_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
kit_repo="$(cd "$kit_here/../.." && pwd -P)"
kit_cargo_toml="$kit_repo/crates/Cargo.toml"
kit_checkout="$kit_here/checkout"
kit_patches="$kit_here/patches"
kit_manifest="$kit_patches/manifest"
# Resolutions of merge conflicts git recorded (rerere) while bump.sh made a patch; kept here so that they survive
# regenerating the checkout.
kit_rr_cache="$kit_here/rr-cache"

kit_say() { echo "[gpui-kit] $*"; }
kit_die() {
    echo "[gpui-kit] $*" >&2
    exit 1
}

kit_sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# The pinned repository and commit: `kit_url`, `kit_rev`.
kit_read_pin() {
    local line
    line="$(grep -E '^gpui-component = \{ git = "[^"]+", rev = "[0-9a-f]{40}" \}$' "$kit_cargo_toml" || true)"
    [[ -n "$line" ]] || kit_die "no pinned gpui-component (git + 40-hex rev) in crates/Cargo.toml"
    kit_url="$(sed -E 's/^.*git = "([^"]+)".*$/\1/' <<<"$line")"
    kit_rev="$(sed -E 's/^.*rev = "([0-9a-f]{40})".*$/\1/' <<<"$line")"
}

# The manifest: `kit_mode` (patch | branch), `kit_branch_url` and `kit_branch` (the fork's branch built from the same
# commits), and the entries in order: arrays `kit_prs` (a number or `-`) and `kit_files`.
kit_read_manifest() {
    kit_prs=()
    kit_files=()
    kit_mode=patch
    kit_branch_url=""
    kit_branch=""
    [[ -f "$kit_manifest" ]] || return 0
    local pr file rest
    while read -r pr file rest; do
        [[ -z "$pr" || "$pr" == \#* ]] && continue
        if [[ "$pr" == mode ]]; then
            [[ "$file" == patch || "$file" == branch ]] || kit_die "patches/manifest: 'mode' is patch or branch, not '$file'"
            kit_mode="$file"
            continue
        fi
        if [[ "$pr" == branch ]]; then
            [[ -n "$file" && -n "$rest" && "$rest" != *" "* ]] || kit_die "patches/manifest: expected 'branch <repository url> <branch name>'"
            kit_branch_url="$file"
            kit_branch="$rest"
            continue
        fi
        [[ -n "$file" && -z "$rest" ]] || kit_die "patches/manifest: expected '<pull request|-> <file.patch>', got: $pr $file $rest"
        [[ "$pr" == "-" || "$pr" =~ ^[0-9]+$ ]] || kit_die "patches/manifest: '$pr' is not a pull request number or '-'"
        [[ "$file" == *.patch && "$file" != */* ]] || kit_die "patches/manifest: '$file' is not a file name ending in .patch"
        kit_prs+=("$pr")
        kit_files+=("$file")
    done <"$kit_manifest"
    [[ "$kit_mode" == patch || -n "$kit_branch" ]] || kit_die "patches/manifest: mode branch needs a 'branch <url> <name>' line"
}

# The block of crates/Cargo.toml bump.sh rewrites: the [patch] section in patch mode, a note in branch mode.
kit_block_begin='# ---- gpui-kit checkout: vendor/gpui-kit/bump.sh writes this block ----'
kit_block_end='# ---- end of the gpui-kit checkout block ----'

# What prepare.sh writes to checkout/.prepared: the source, the commit and every patch with its sha256, in order.
kit_stamp() {
    local i
    echo "url $kit_url"
    echo "rev $kit_rev"
    for i in ${kit_files[@]+"${!kit_files[@]}"}; do
        echo "${kit_files[$i]} $(kit_sha256 "$kit_patches/${kit_files[$i]}")"
    done
}

# owner/name of a GitHub repository URL (https or ssh form).
kit_github_slug() { sed -E 's#^(https://github\.com/|git@github\.com:)##; s#\.git$##; s#/$##' <<<"$1"; }

# GET from the GitHub REST API (a read): `gh api` when it is signed in, otherwise anonymous curl.
kit_api_get() {
    if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
        gh api "$1"
    else
        curl -fsSL --max-time 20 -H "Accept: application/vnd.github+json" "https://api.github.com/$1"
    fi
}

# The generated block of a patch's note: the lines between these markers are rewritten by bump.sh.
kit_note_begin='<!-- bump.sh: generated, do not edit by hand -->'
kit_note_end='<!-- /bump.sh -->'
# A field of that block, e.g. `kit_note_field tree-sitter-wasm.md base` → the 40-hex commit.
kit_note_field() {
    local note="$kit_patches/${1%.patch}.md"
    [[ -f "$note" ]] || return 0
    awk -v begin="$kit_note_begin" -v end="$kit_note_end" -v field="- $2: " '
        $0 == begin { inside = 1; next }
        $0 == end { inside = 0 }
        inside && index($0, field) == 1 {
            rest = substr($0, length(field) + 1)
            if (match(rest, /^`[^`]+`/)) { print substr(rest, 2, RLENGTH - 2); exit }
        }' "$note"
}
