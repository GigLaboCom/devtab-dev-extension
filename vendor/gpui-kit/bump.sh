#!/usr/bin/env bash
# Moves the gpui-kit base forward: a commit of upstream `main` with the commits of our not-yet-merged pull requests
# rebased on top (docs/editor-base.md, docs/extension-structure.md §11.8).
#
#   vendor/gpui-kit/bump.sh --check      # changes nothing: is a bump due; where the pull requests and the fork's
#                                        # branch stand; would the rebase onto the tip of main be clean (tried in a
#                                        # temporary clone)
#   vendor/gpui-kit/bump.sh              # rebase onto the tip of upstream main and pin it
#   vendor/gpui-kit/bump.sh <commit>     # the same onto that commit of main (40 hex)
#
# The centre is a local rebase. In the generated clone vendor/gpui-kit/checkout, the commits of every pull request of
# patches/manifest (refs/pull/<n>/head, fetched into that clone only, merge commits left out) are cherry-picked onto
# the commit of main, in the manifest's order, each keeping its author and its committer's name, address and date —
# so the same commits on the same base give the same commit ids, whoever runs it. git rerere is on, with the
# resolutions recorded under vendor/gpui-kit/rr-cache/. The result is the local branch `base`; everything else is
# derived from it, by the manifest's mode:
#   patch   crates/Cargo.toml pins upstream main; each pull request's rebased commits become its patch file, which
#           prepare.sh applies to the checkout the [patch] section builds from (needs nothing pushed);
#   branch  crates/Cargo.toml pins the fork's branch (manifest line `branch <url> <name>`) at its current commit, only
#           if that commit has exactly the tree built here (compared by tree id); no patches, no [patch] section.
#
# In order — nothing in the tree changes until the rebase is done:
#   1. the pull requests, from the GitHub API: merged → its patch, note and manifest line are dropped; closed without
#      merging → stop; open → rebased;
#   2. the rebase (above). A conflict without a recorded resolution stops here: the clone is left mid-cherry-pick with
#      instructions, and the text for the pull request is printed;
#   3. patches and notes (patch mode), or the check of the fork's branch (branch mode);
#   4. crates/Cargo.toml: repository, rev (both crates), the `# Pinned:` line, the gpui-pre / lsp-types versions
#      gpui-kit pins at that commit, the checkout block; prepare.sh (patch mode);
#   5. crates/Cargo.lock again from gpui-kit's own lock at the rebased commit, the rest resolved by cargo, our own
#      dependencies kept at their versions where they still fit;
#   6. prints what changed upstream since the previous pin, the commands that would publish `base` as the fork's
#      branch with a dated pin (and refresh the pull request's branch), and which checks to run.
# It never builds, commits in this repository or pushes, and it writes nothing to GitHub.
#
# GPUI_KIT_UPSTREAM=<url> uses another repository as upstream (default https://github.com/longbridge/gpui-kit).
set -euo pipefail
# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd -P)/lib.sh"

upstream="${GPUI_KIT_UPSTREAM:-https://github.com/longbridge/gpui-kit}"
slug="$(kit_github_slug "$upstream")"
# Dependencies whose versions must equal gpui-kit's own pins: their types cross the boundary with gpui-component.
aligned="gpui-pre gpui-pre-platform gpui-pre-web lsp-types"
# The identity of what this script itself commits in the clone (patches of our own; the commits of the --check
# simulation). Pull requests' commits keep their own.
own_identity=(GIT_AUTHOR_NAME=gpui-kit-bump GIT_AUTHOR_EMAIL=gpui-kit-bump@localhost
    GIT_COMMITTER_NAME=gpui-kit-bump GIT_COMMITTER_EMAIL=gpui-kit-bump@localhost)

mode=bump
target=""
for arg in "$@"; do
    case "$arg" in
    --check) mode=check ;;
    -h | --help)
        sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'
        exit 0
        ;;
    -*) kit_die "unknown option $arg (see --help)" ;;
    *) target="$arg" ;;
    esac
done
command -v jq >/dev/null || kit_die "jq is required"

tip_of_main() {
    local tip
    tip="$(git ls-remote "$upstream" refs/heads/main | cut -f1)"
    [[ "$tip" =~ ^[0-9a-f]{40}$ ]] || kit_die "cannot read the tip of $upstream main (offline?)"
    echo "$tip"
}

# `state merged head updated head-ref head-repository` of a pull request, from the API.
pr_info() {
    local json
    json="$(kit_api_get "repos/$slug/pulls/$1")" || kit_die "cannot read pull request #$1 from the GitHub API"
    jq -r '[.state, (.merged|tostring), .head.sha, .updated_at, .head.ref, (.head.repo.html_url // "-")] | join(" ")' <<<"$json"
}

# The commits of a pull request's head that upstream main does not have, oldest first, merges left out.
pr_commits() { git -C "$1" rev-list --reverse --no-merges "$2" ^origin/main; }

# Runs a cherry-pick of $2 in clone $1 as the commit's own committer (name, address, date).
pick() {
    local name email date
    IFS=$'\t' read -r name email date < <(git -C "$1" log -1 --format=$'%cn\t%ce\t%cI' "$2")
    GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" GIT_COMMITTER_DATE="$date" GIT_EDITOR=true \
        git -C "$1" "${@:3}"
}

# The version gpui-kit's [workspace.dependencies] gives a package (by `package = "…"` or by its key), from stdin.
kit_version_of() {
    awk -v pkg="$1" '
        /^\[/ { inside = ($0 == "[workspace.dependencies]") }
        inside && $0 ~ "^[A-Za-z0-9_-]+ = " {
            key = $1; name = key
            if (match($0, /package = "[^"]+"/)) name = substr($0, RSTART + 11, RLENGTH - 12)
            if (name != pkg) next
            if (match($0, /version = "[^"]+"/)) print substr($0, RSTART + 11, RLENGTH - 12)
            exit
        }'
}

# Sets the version of a package in crates/Cargo.toml's [workspace.dependencies] (written in place).
set_version_of() {
    local tmp
    tmp="$(mktemp)"
    awk -v pkg="$1" -v ver="$2" '
        /^\[/ { inside = ($0 == "[workspace.dependencies]") }
        inside && $0 ~ "^[A-Za-z0-9_-]+ = " {
            key = $1; name = key
            if (match($0, /package = "[^"]+"/)) name = substr($0, RSTART + 11, RLENGTH - 12)
            if (name == pkg) sub(/version = "[^"]+"/, "version = \"" ver "\"")
        }
        { print }' "$kit_cargo_toml" >"$tmp"
    cat "$tmp" >"$kit_cargo_toml"
    rm -f "$tmp"
}

# `name version` of every package in a Cargo.lock, sorted.
lock_packages() {
    awk '/^name = /{gsub(/"/,"",$3); n=$3} /^version = /{gsub(/"/,"",$3); print n, $3}' "$1" | LC_ALL=C sort -u
}

# crates.io publication date of a crate version (a read; empty when offline).
published() {
    curl -fsSL --max-time 15 -A "gpui-kit-bump (vendor/gpui-kit/bump.sh)" "https://crates.io/api/v1/crates/$1/$2" 2>/dev/null |
        jq -r '.version.created_at // empty' 2>/dev/null | cut -c1-10
}

# Replaces the lines between the block markers of crates/Cargo.toml with the file $1.
write_block() {
    grep -qxF "$kit_block_begin" "$kit_cargo_toml" && grep -qxF "$kit_block_end" "$kit_cargo_toml" ||
        kit_die "crates/Cargo.toml has no gpui-kit checkout block (the lines '$kit_block_begin' … '$kit_block_end')"
    awk -v begin="$kit_block_begin" -v end="$kit_block_end" -v blockfile="$1" '
        $0 == begin { print; while ((getline line < blockfile) > 0) print line; skip = 1; next }
        $0 == end { skip = 0 }
        !skip { print }' "$kit_cargo_toml" >"$kit_cargo_toml.tmp"
    mv "$kit_cargo_toml.tmp" "$kit_cargo_toml"
}

# ---------------------------------------------------------------------------------------------------------------------
# --check: a glance, no changes to the tree
# ---------------------------------------------------------------------------------------------------------------------
if [[ "$mode" == check ]]; then
    kit_read_pin
    kit_read_manifest
    echo "== consistency (vendor/gpui-kit/check.sh)"
    "$kit_here/check.sh" || true
    echo
    tip="${target:-$(tip_of_main)}"
    # A throwaway clone with a working tree: the same replay as a bump, with a copy of rr-cache, so the answer is the
    # one a bump would give — clean, resolved by a recorded resolution, or stopped.
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    w="$work/kit"
    git clone --quiet --filter=blob:none --no-checkout "$upstream" "$w"
    git -C "$w" cat-file -e "$tip^{commit}" 2>/dev/null || git -C "$w" fetch --quiet --filter=blob:none origin "$tip"
    for setting in "rerere.enabled true" "rerere.autoUpdate true" "gc.auto 0" "maintenance.auto false" "commit.gpgsign false"; do
        # shellcheck disable=SC2086
        git -C "$w" config $setting
    done
    [[ -d "$kit_rr_cache" ]] && cp -R "$kit_rr_cache" "$w/.git/rr-cache"
    git -C "$w" -c advice.detachedHead=false checkout --quiet --detach "$tip"
    base="$kit_rev"
    [[ "$kit_mode" == branch ]] && base="$(kit_note_field "${kit_files[0]:-none}" base)"
    echo "== upstream $slug (mode: $kit_mode)"
    echo "pinned base:  ${base:0:12}  $(git -C "$w" log -1 --format='%cs  %s' "$base" 2>/dev/null || echo '(not in upstream history)')"
    echo "main:         ${tip:0:12}  $(git -C "$w" log -1 --format='%cs  %s' "$tip")"
    due=false
    if [[ -n "$base" ]] && git -C "$w" merge-base --is-ancestor "$base" "$tip" 2>/dev/null; then
        ahead="$(git -C "$w" rev-list --count "$base..$tip")"
        echo "main is $ahead commit(s) ahead of the pinned base"
        [[ "$ahead" -gt 0 ]] && due=true
    else
        echo "the pinned base is NOT on main's history: bump to put it on main"
        due=true
    fi
    replay_clean=true
    patches_apply=true
    for i in ${kit_files[@]+"${!kit_files[@]}"}; do
        file="${kit_files[$i]}"
        pr="${kit_prs[$i]}"
        echo
        echo "== patches/$file$([[ "$pr" != "-" ]] && echo " (pull request #$pr)")"
        if git -C "$w" apply --check --whitespace=nowarn "$kit_patches/$file" 2>/dev/null; then
            echo "the patch as it is applies to main@${tip:0:12}"
        else
            echo "the patch as it is does NOT apply to main@${tip:0:12} (a bump remakes it from the pull request)"
            patches_apply=false
        fi
        $replay_clean || { echo "(not replayed: an earlier entry stopped)"; continue; }
        if [[ "$pr" == "-" ]]; then
            git -C "$w" apply --index --3way --whitespace=nowarn "$kit_patches/$file" >/dev/null 2>&1 &&
                env "${own_identity[@]}" git -C "$w" commit --quiet -m "patch: $file" || {
                echo "  does not apply even three-way: a bump stops"
                replay_clean=false
            }
            continue
        fi
        read -r state merged head updated head_ref head_repo <<<"$(pr_info "$pr")"
        echo "pull request: $state$([[ "$merged" == true ]] && echo ', merged'), head ${head:0:12} on ${head_repo#https://github.com/}:$head_ref (updated $updated)"
        if [[ "$merged" == true ]]; then
            echo "  merged: a bump drops this patch"
            due=true
            continue
        elif [[ "$state" != open ]]; then
            echo "  closed without merging: a bump stops here — decide what to do with the change first"
            replay_clean=false
            continue
        fi
        git -C "$w" fetch --quiet --filter=blob:none origin "refs/pull/$pr/head"
        if [[ "$head" == "$(kit_note_field "$file" head)" ]]; then
            echo "  the base was made from this head"
        else
            echo "  the head moved since the base was made from $(kit_note_field "$file" head | cut -c1-12): a bump takes the new head"
            due=true
        fi
        echo "  its branch is $(git -C "$w" rev-list --count "$head..$tip") commit(s) behind main;" \
            "$(git -C "$w" merge-tree --write-tree "$tip" "$head" >/dev/null 2>&1 && echo "merges into main cleanly" || echo "does NOT merge into main cleanly")"
        commits="$(git -C "$w" rev-list --reverse --no-merges "$head" "^$tip")"
        echo "  rebasing its $(wc -w <<<"$commits" | tr -d ' ') commit(s) onto main@${tip:0:12}:"
        for c in $commits; do
            pick "$w" "$c" cherry-pick --empty=drop "$c" >"$work/pick.log" 2>&1 && continue
            conflicted="$(sed -nE 's/^CONFLICT \([^)]*\): .* in (.*)$/\1/p' "$work/pick.log" | sort -u | tr '\n' ' ')"
            if [[ -n "$conflicted" && -z "$(git -C "$w" diff --name-only --diff-filter=U)" ]]; then
                pick "$w" "$c" cherry-pick --continue >/dev/null
                echo "    ${c:0:12} conflicts in ${conflicted% }: a recorded resolution (rr-cache) resolves it"
                continue
            fi
            echo "    ${c:0:12} \"$(git -C "$w" log -1 --format=%s "$c")\" CONFLICTS in ${conflicted:-?} and no recorded resolution covers it:"
            echo "    a bump stops there for a resolution by hand. Text for the pull request: \"#$pr: rebasing it onto main at ${tip:0:12} conflicts in ${conflicted% }\""
            replay_clean=false
            break
        done
        $replay_clean && echo "    done: the rebase onto main@${tip:0:12} needs no hand"
    done
    if [[ -n "$kit_branch" ]]; then
        echo
        fork_sha="$(git ls-remote "$kit_branch_url" "refs/heads/$kit_branch" | cut -f1)"
        echo "== the fork's branch $(kit_github_slug "$kit_branch_url"):$kit_branch at ${fork_sha:0:12}"
        if [[ -n "$fork_sha" ]] && $replay_clean; then
            git -C "$w" fetch --quiet --filter=blob:none "$kit_branch_url" "$fork_sha" 2>/dev/null || true
            if [[ "$(git -C "$w" rev-parse "$fork_sha^{tree}" 2>/dev/null)" == "$(git -C "$w" rev-parse 'HEAD^{tree}')" ]]; then
                echo "  it has exactly main@${tip:0:12} + the pull requests (same tree)"
            else
                echo "  it is not main@${tip:0:12} + the pull requests (another tree): a bump prints the commands that publish it"
                [[ "$kit_mode" == branch ]] && due=true
            fi
        fi
    fi
    echo
    if $due; then
        echo "verdict: a bump is due — vendor/gpui-kit/bump.sh${target:+ $tip}"
    else
        echo "verdict: up to date — the base is the tip of main and the pull requests' heads are the ones it was made from"
    fi
    $replay_clean || echo "note: the rebase onto the tip stops for a resolution by hand (above)"
    $patches_apply || echo "note: the patches as they are would fail on the tip; a bump remakes them from the pull requests"
    exit 0
fi

# ---------------------------------------------------------------------------------------------------------------------
# bump
# ---------------------------------------------------------------------------------------------------------------------
kit_read_pin
kit_read_manifest
old_url="$kit_url"
old_rev="$kit_rev"
# The previous base on main: the pin itself in patch mode, the base its note records in branch mode.
old_base="$old_rev"
if [[ "$old_url" != "$upstream" ]]; then
    recorded_base="$(kit_note_field "${kit_files[0]:-none}" base)"
    [[ -n "$recorded_base" ]] && old_base="$recorded_base"
fi
if [[ -z "$target" ]]; then
    new_rev="$(tip_of_main)"
    kit_say "tip of $slug main: $new_rev"
elif [[ "$target" =~ ^[0-9a-f]{40}$ ]]; then
    new_rev="$target"
else
    kit_die "give a full 40-hex commit of main, or nothing for the tip"
fi

# 1. Where the pull requests stand.
keep_prs=()
keep_files=()
keep_heads=()
keep_refs=()
keep_repos=()
dropped=()
for i in ${kit_files[@]+"${!kit_files[@]}"}; do
    pr="${kit_prs[$i]}"
    file="${kit_files[$i]}"
    if [[ "$pr" == "-" ]]; then
        keep_prs+=("-") keep_files+=("$file") keep_heads+=("") keep_refs+=("") keep_repos+=("")
        continue
    fi
    read -r state merged head updated head_ref head_repo <<<"$(pr_info "$pr")"
    if [[ "$merged" == true ]]; then
        kit_say "pull request #$pr is merged: dropping patches/$file and its note"
        dropped+=("$file")
    elif [[ "$state" != open ]]; then
        kit_die "pull request #$pr ($file) is closed without being merged. Nothing was changed. Decide what happens to the change (docs/editor-base.md), then bump again."
    else
        kit_say "pull request #$pr is open, head ${head:0:12} on ${head_repo#https://github.com/}:$head_ref (updated $updated)"
        keep_prs+=("$pr") keep_files+=("$file") keep_heads+=("$head") keep_refs+=("$head_ref") keep_repos+=("$head_repo")
    fi
done

# 2. The rebase, in the clone: upstream main fetched, the new commit checked out, the pull requests replayed.
co="$kit_checkout"
# (the configured address, not `remote get-url`: a global insteadOf may rewrite https to ssh)
if [[ -d "$co/.git" ]] && [[ "$(git -C "$co" config --get remote.origin.url 2>/dev/null)" == "$upstream" ]]; then
    git -C "$co" cherry-pick --abort 2>/dev/null || true
    git -C "$co" merge --abort 2>/dev/null || true
    git -C "$co" fetch --quiet --filter=blob:none origin "+refs/heads/main:refs/remotes/origin/main"
else
    rm -rf "$co"
    kit_say "cloning $upstream into ${co#"$kit_repo"/}"
    git clone --quiet --filter=blob:none --no-checkout "$upstream" "$co"
fi
git -C "$co" cat-file -e "$new_rev^{commit}" 2>/dev/null ||
    git -C "$co" fetch --quiet --filter=blob:none origin "$new_rev" ||
    kit_die "$upstream has no commit $new_rev"
git -C "$co" merge-base --is-ancestor "$new_rev" origin/main ||
    kit_die "$new_rev is not on upstream main's history; the base is always a commit of main"
git -C "$co" config rerere.enabled true
git -C "$co" config rerere.autoUpdate true
# Resolutions are kept ten years (a larger number of days overflows in git), and no automatic gc runs here: a
# detached `git maintenance` would prune rr-cache behind the script's back.
git -C "$co" config gc.rerereResolved 3650
git -C "$co" config gc.rerereUnresolved 3650
git -C "$co" config gc.auto 0
git -C "$co" config maintenance.auto false
# Unsigned, whatever the global configuration says: a signature would make the commit ids differ run to run, and
# whoever publishes the branch decides how it is signed.
git -C "$co" config commit.gpgsign false
mkdir -p "$kit_rr_cache"
if [[ ! -L "$co/.git/rr-cache" ]]; then
    rm -rf "$co/.git/rr-cache"
    ln -s ../../rr-cache "$co/.git/rr-cache"
fi
git -C "$co" -c advice.detachedHead=false checkout --quiet --force --detach "$new_rev"
git -C "$co" clean -fdxq

made="$(mktemp -d)"
trap 'rm -rf "$made"' EXIT
statuses=()
counts=()
tips=()
for i in ${keep_files[@]+"${!keep_files[@]}"}; do
    pr="${keep_prs[$i]}"
    file="${keep_files[$i]}"
    before="$(git -C "$co" rev-parse HEAD)"
    status="clean"
    if [[ "$pr" == "-" ]]; then
        # A patch of our own: applied with a three-way fallback and committed under the script's identity.
        git -C "$co" apply --index --3way --whitespace=nowarn "$kit_patches/$file" ||
            kit_die "patches/$file (no pull request) does not apply to $new_rev, even three-way: fix it in ${co#"$kit_repo"/} or delete it. Nothing in the tree was changed."
        env "${own_identity[@]}" GIT_AUTHOR_DATE="$(git -C "$co" log -1 --format=%cI "$new_rev")" \
            GIT_COMMITTER_DATE="$(git -C "$co" log -1 --format=%cI "$new_rev")" \
            git -C "$co" commit --quiet -m "patch: ${file%.patch}"
        counts+=(1)
    else
        git -C "$co" fetch --quiet --filter=blob:none origin "refs/pull/$pr/head"
        head="$(git -C "$co" rev-parse FETCH_HEAD)"
        [[ "$head" == "${keep_heads[$i]}" ]] || kit_say "note: #$pr's head moved while reading (API ${keep_heads[$i]:0:12}, fetched ${head:0:12}); using the fetched one"
        keep_heads[i]="$head"
        commits="$(pr_commits "$co" "$head")"
        n="$(wc -w <<<"$commits" | tr -d ' ')"
        counts+=("$n")
        kit_say "rebasing #$pr: $n commit(s) of ${head:0:12} ($(git -C "$co" rev-list --count "$head..$new_rev") commit(s) of main not in its branch) onto ${before:0:12}"
        resolved=()
        for c in $commits; do
            log="$made/pick.log"
            if pick "$co" "$c" cherry-pick --empty=drop "$c" >"$log" 2>&1; then
                continue
            fi
            conflicted="$(sed -nE 's/^CONFLICT \([^)]*\): .* in (.*)$/\1/p' "$log" | sort -u | tr '\n' ' ')"
            unmerged="$(git -C "$co" diff --name-only --diff-filter=U | tr '\n' ' ')"
            if [[ -n "$conflicted" && -z "$unmerged" ]]; then
                pick "$co" "$c" cherry-pick --continue >/dev/null
                kit_say "  ${c:0:12} conflicted in ${conflicted% }; resolved by the recorded resolution (rr-cache)"
                resolved+=("${conflicted% } (${c:0:12})")
                continue
            fi
            sed 's/^/    /' "$log" >&2
            files="${unmerged:-$conflicted}"
            if git -C "$co" merge-tree --write-tree --name-only "$new_rev" "$head" >/dev/null 2>&1; then
                pr_text="#$pr merges cleanly into main at ${new_rev:0:12} (its branch has merged main), but rebasing its commits onto it conflicts in ${files% } at \"$(git -C "$co" log -1 --format=%s "$c")\""
            else
                pr_text="#$pr conflicts with main at ${new_rev:0:12} in ${files% }"
            fi
            cat >&2 <<EOF

[gpui-kit] STOPPED: commit ${c:0:12} "$(git -C "$co" log -1 --format=%s "$c")" of pull request #$pr does not apply
[gpui-kit] cleanly onto main@${new_rev:0:12}, and no recorded resolution covers it.
[gpui-kit] The clone is left mid-cherry-pick: ${co#"$kit_repo"/}
[gpui-kit] Conflicting files: ${unmerged:-$conflicted}
[gpui-kit] Nothing in the tree (crates/, the patches, the manifest) was changed.

To resolve by hand (git rerere records the resolution in vendor/gpui-kit/rr-cache/ when the cherry-pick is
continued, and the next run reuses it):
    cd ${co#"$kit_repo"/}
    # edit the files above, remove the conflict markers
    git add <the files> && GIT_EDITOR=true git -c user.name=gpui-kit-bump -c user.email=gpui-kit-bump@localhost cherry-pick --continue
    cd - && vendor/gpui-kit/bump.sh $new_rev
Then commit vendor/gpui-kit/rr-cache/ with the result. Or pin an older commit of main, or wait for the pull
request's branch to be updated.

Text for the pull request (the owner posts it; this script writes nothing to GitHub):
    $pr_text
EOF
            exit 2
        done
        if [[ ${#resolved[@]} -gt 0 ]]; then
            status="resolved by the recorded resolution: ${resolved[*]}"
        fi
    fi
    statuses+=("$status")
    tips+=("$(git -C "$co" rev-parse HEAD)")
    git -C "$co" diff --binary --full-index "$before" HEAD >"$made/$file"
    [[ -s "$made/$file" ]] || kit_say "warning: patches/$file changes nothing on main@${new_rev:0:12} (merged under another commit?)"
done
tip="$(git -C "$co" rev-parse HEAD)"
tree="$(git -C "$co" rev-parse "$tip^{tree}")"
git -C "$co" branch --quiet --force base "$tip"
# rerere's working copy of a resolution it just replayed; only preimage and postimage are the record.
find "$kit_rr_cache" -name thisimage -delete 2>/dev/null || true
kit_say "rebased: branch 'base' in ${co#"$kit_repo"/} at ${tip:0:12} (tree ${tree:0:12}), $(git -C "$co" rev-list --count "$new_rev..$tip") commit(s) on main@${new_rev:0:12}"

# 3 (branch mode). The fork's branch must have exactly this tree before it is pinned.
fork_sha=""
if [[ -n "$kit_branch" ]]; then
    fork_sha="$(git ls-remote "$kit_branch_url" "refs/heads/$kit_branch" | cut -f1)"
    fork_same=false
    if [[ -n "$fork_sha" ]]; then
        git -C "$co" cat-file -e "$fork_sha^{commit}" 2>/dev/null ||
            git -C "$co" fetch --quiet --filter=blob:none "$kit_branch_url" "$fork_sha" 2>/dev/null || true
        [[ "$(git -C "$co" rev-parse "$fork_sha^{tree}" 2>/dev/null)" == "$tree" ]] && fork_same=true
    fi
fi
print_publish() {
    local fork_slug pin_name pin_sha
    fork_slug="$(kit_github_slug "$kit_branch_url")"
    pin_name="pin/$kit_branch-$(date -u +%Y-%m-%d)"
    local pinned_commit="$tip"
    [[ "${fork_same:-false}" == true ]] && pinned_commit="$fork_sha"
    pin_sha="$(git ls-remote "$kit_branch_url" "refs/heads/$pin_name" | cut -f1)"
    if [[ -n "$pin_sha" && "$pin_sha" != "$pinned_commit" ]]; then
        pin_name="$pin_name-${pinned_commit:0:7}"
        pin_sha="$(git ls-remote "$kit_branch_url" "refs/heads/$pin_name" | cut -f1)"
    fi
    echo
    echo "---- to publish 'base' as $fork_slug:$kit_branch (the owner runs these; this script pushes nothing)"
    if [[ "${fork_same:-false}" == true ]]; then
        echo "  the fork's $kit_branch (${fork_sha:0:12}) already has exactly this tree: nothing to push for the branch"
    fi
    echo "  cd ${co#"$kit_repo"/}"
    [[ "${fork_same:-false}" == true ]] ||
        echo "  git push --force-with-lease=refs/heads/$kit_branch:${fork_sha} $kit_branch_url $tip:refs/heads/$kit_branch"
    if [[ "$pin_sha" == "$pinned_commit" ]]; then
        echo "  # the dated pin $pin_name already points at ${pinned_commit:0:12}"
    else
        echo "  git push $kit_branch_url $pinned_commit:refs/heads/$pin_name"
    fi
    echo "  # the dated pin keeps the pinned commit reachable after later force-pushes of $kit_branch"
    if [[ ${#keep_prs[@]} -eq 1 && "${keep_prs[0]}" != "-" && "${keep_repos[0]}" == "$kit_branch_url" ]]; then
        echo "  # pull request #${keep_prs[0]} refreshed with the same commits (its branch ${keep_refs[0]}, a force-push: the PR then shows"
        echo "  # these rebased commits instead of its merges of main):"
        echo "  git push --force-with-lease=refs/heads/${keep_refs[0]}:${keep_heads[0]} $kit_branch_url $tip:refs/heads/${keep_refs[0]}"
    elif [[ ${#keep_prs[@]} -gt 1 ]]; then
        echo "  # with several pull requests the base carries all of them: each pull request's own branch is rebased separately"
    fi
    [[ "$kit_mode" == branch ]] ||
        echo "  then, to build from the branch: 'mode branch' in vendor/gpui-kit/patches/manifest and vendor/gpui-kit/bump.sh $new_rev"
}
if [[ "$kit_mode" == branch && "$fork_same" != true ]]; then
    print_publish >&2
    kit_die "branch mode: the fork's $kit_branch (${fork_sha:-missing}) does not have the tree built here (${tree:0:12}). Publish it (above) or set 'mode patch'. Nothing in the tree was changed."
fi

# From here on the tree changes.
for file in ${dropped[@]+"${dropped[@]}"}; do
    rm -f "$kit_patches/$file" "$kit_patches/${file%.patch}.md"
done
today="$(date -u +%Y-%m-%d)"
for i in ${keep_files[@]+"${!keep_files[@]}"}; do
    file="${keep_files[$i]}"
    pr="${keep_prs[$i]}"
    cp "$made/$file" "$kit_patches/$file"
    note="$kit_patches/${file%.patch}.md"
    [[ -f "$note" ]] || printf '# %s\n\nWhat it is, which upstream pull request it mirrors and when it can be deleted: write it here.\n' "$file" >"$note"
    block="$(mktemp)"
    {
        echo "$kit_note_begin"
        if [[ "$pr" != "-" ]]; then
            echo "- pull request: \`$pr\` $upstream/pull/$pr"
            echo "- head: \`${keep_heads[$i]}\` — the pull request's head its commits were taken from"
        fi
        echo "- base: \`$new_rev\` — the commit of upstream main they were rebased onto"
        echo "- rebase: \`${statuses[$i]}\`"
        echo "- commits: \`${counts[$i]}\` — rebased onto the base (merge commits of the pull request's branch left out)"
        echo "- tip: \`${tips[$i]}\` — the rebased branch after them, tree \`$(git -C "$co" rev-parse "${tips[$i]}^{tree}")\`"
        echo "- made: \`$today\` by vendor/gpui-kit/bump.sh"
        echo "$kit_note_end"
    } >"$block"
    if grep -qxF "$kit_note_begin" "$note"; then
        awk -v begin="$kit_note_begin" -v end="$kit_note_end" -v blockfile="$block" '
            $0 == begin { while ((getline line < blockfile) > 0) print line; skip = 1; next }
            $0 == end { skip = 0; next }
            !skip { print }' "$note" >"$note.tmp"
        mv "$note.tmp" "$note"
    else
        { echo; cat "$block"; } >>"$note"
    fi
    rm -f "$block"
done
if [[ -f "$kit_manifest" ]]; then
    {
        grep -E '^(#|mode |branch )' "$kit_manifest" || true
        for i in ${keep_files[@]+"${!keep_files[@]}"}; do echo "${keep_prs[$i]} ${keep_files[$i]}"; done
    } >"$kit_manifest.tmp"
    mv "$kit_manifest.tmp" "$kit_manifest"
fi

# 4. crates/Cargo.toml.
kit_version="$(git -C "$co" show "$tip:crates/component/Cargo.toml" | sed -nE 's/^version = "([^"]+)"$/\1/p' | head -1)"
commit_date="$(git -C "$co" log -1 --format=%cs "$new_rev")"
n_total="$(git -C "$co" rev-list --count "$new_rev..$tip")"
block="$made/block"
if [[ "$kit_mode" == branch ]]; then
    pin_url="$kit_branch_url"
    pin_rev="$fork_sha"
    pinned="$(kit_github_slug "$kit_branch_url"):$kit_branch, main of $commit_date + $n_total commit(s) of pull requests, as of $today (gpui-kit $kit_version)."
    cat >"$block" <<EOF
# Branch mode (../vendor/gpui-kit/patches/manifest): the pinned commit is the fork's branch itself, upstream main plus
# the pull requests' commits, built as a git dependency: no checkout, no patches, no [patch] section.
EOF
else
    pin_url="$upstream"
    pin_rev="$new_rev"
    pinned="main as of $today (gpui-kit $kit_version, commit of $commit_date)."
    cat >"$block" <<EOF
# Patch mode: the pinned commit of upstream main plus the patches of ../vendor/gpui-kit/patches/manifest, prepared by
# ../vendor/gpui-kit/prepare.sh (crates/review-wasm/build.sh runs it; run it once by hand before \`cargo test\` or
# \`cargo run\`). gpui-base and gpui-component-macros come along as path dependencies of gpui-component.
[patch."$upstream"]
gpui-component = { path = "../vendor/gpui-kit/checkout/crates/component" }
gpui-kit-assets = { path = "../vendor/gpui-kit/checkout/crates/assets" }
EOF
fi
write_block "$block"
sed -i.bak -E \
    -e "s#^(gpui-component|gpui-kit-assets) = \\{ git = \"[^\"]+\", rev = \"[0-9a-f]{40}\" \\}\$#\\1 = { git = \"$pin_url\", rev = \"$pin_rev\" }#" \
    -e "s#^\\# Pinned: .*\$#\\# Pinned: $pinned#" \
    "$kit_cargo_toml"
rm -f "$kit_cargo_toml.bak"
kit_toml="$made/kit-Cargo.toml"
git -C "$co" show "$tip:Cargo.toml" >"$kit_toml"
changed_versions=()
for pkg in $aligned; do
    want="$(kit_version_of "$pkg" <"$kit_toml")"
    have="$(kit_version_of "$pkg" <"$kit_cargo_toml")"
    [[ -z "$want" || -z "$have" ]] && continue
    if [[ "$want" != "$have" ]]; then
        set_version_of "$pkg" "$want"
        changed_versions+=("$pkg $have → $want")
    fi
done
kit_rust="$(sed -nE 's/^rust-version = "([^"]+)"$/\1/p' "$kit_toml" | head -1)"
if [[ "$kit_mode" == patch ]]; then
    "$kit_here/prepare.sh"
    [[ "$(git -C "$co" rev-parse 'HEAD^{tree}')" == "$tree" ]] || git -C "$co" add -A >/dev/null 2>&1 || true
fi

# 5. crates/Cargo.lock from gpui-kit's own lock at the rebased commit, the rest resolved by cargo.
old_lock="$made/Cargo.lock.old"
cp "$kit_repo/crates/Cargo.lock" "$old_lock"
git -C "$co" show "$tip:Cargo.lock" >"$kit_repo/crates/Cargo.lock"
git -C "$co" show "$tip:Cargo.lock" >"$made/kit.lock"
if ! (cd "$kit_repo/crates" && cargo metadata --format-version 1 >"$made/metadata.json"); then
    cp "$old_lock" "$kit_repo/crates/Cargo.lock"
    kit_die "cargo could not resolve crates/ with gpui-kit's lock (above). crates/Cargo.lock is back as it was; crates/Cargo.toml, the patches and the notes are already the new ones."
fi
lock_packages "$made/kit.lock" >"$made/kit.pkgs"
lock_packages "$old_lock" >"$made/old.pkgs"
# Our own dependencies (not in gpui-kit's lock) go back to the versions the previous lock had, where they still fit.
while read -r name version; do
    grep -q "^$name " "$made/kit.pkgs" && continue
    prev="$(awk -v n="$name" '$1 == n { print $2 }' "$made/old.pkgs")"
    [[ -n "$prev" && "$(wc -l <<<"$prev" | tr -d ' ')" == 1 && "$prev" != "$version" ]] || continue
    (cd "$kit_repo/crates" && cargo update --quiet -p "$name@$version" --precise "$prev" 2>/dev/null) &&
        kit_say "kept $name $prev (cargo had picked $version)" || true
done < <(lock_packages "$kit_repo/crates/Cargo.lock")
(cd "$kit_repo/crates" && cargo metadata --format-version 1 >"$made/metadata.json")
lock_packages "$kit_repo/crates/Cargo.lock" >"$made/new.pkgs"

# 6. What changed, and how to publish.
echo
echo "================ gpui-kit base: ${old_rev:0:12} ($(kit_github_slug "$old_url")) → ${pin_rev:0:12} ($(kit_github_slug "$pin_url"), mode $kit_mode)"
echo "main@${new_rev:0:12} of $commit_date + $n_total rebased commit(s); gpui-kit $kit_version; rust-version gpui-kit asks for: ${kit_rust:-none} (crates/rust-toolchain.toml: $(sed -nE 's/^channel = "([^"]+)"/\1/p' "$kit_repo/crates/rust-toolchain.toml"))"
for line in ${changed_versions[@]+"${changed_versions[@]}"}; do echo "aligned with gpui-kit: $line"; done
for pkg in $aligned; do
    ver="$(kit_version_of "$pkg" <"$kit_toml" | tr -d '=^~ ')"
    [[ -n "$ver" ]] && echo "  $pkg $ver published $(published "$pkg" "$ver")"
done
for file in ${dropped[@]+"${dropped[@]}"}; do echo "dropped (merged upstream): patches/$file"; done
for i in ${keep_files[@]+"${!keep_files[@]}"}; do
    echo "pull request ${keep_prs[$i]}: ${counts[$i]} commit(s) from head ${keep_heads[$i]:0:12}, rebase: ${statuses[$i]}; patches/${keep_files[$i]}"
done
git -C "$co" log --oneline --no-decorate "$new_rev..$tip" | sed 's/^/  /'
echo
echo "---- crates/Cargo.lock (name: before → after)"
LC_ALL=C join -a1 -a2 -e '-' -o 0,1.2,2.2 \
    <(awk '{a[$1]=a[$1] (a[$1]?",":"") $2} END{for(k in a) print k, a[k]}' "$made/old.pkgs" | LC_ALL=C sort) \
    <(awk '{a[$1]=a[$1] (a[$1]?",":"") $2} END{for(k in a) print k, a[k]}' "$made/new.pkgs" | LC_ALL=C sort) |
    awk '$2 != $3 { printf "  %-40s %s → %s\n", $1, $2, $3 }'

# The kit's crates this workspace builds (no registry source in our lock), found by name in the rebased tree.
paths=""
while read -r name; do
    dir="$(git -C "$co" grep -l -E "^name = \"$name\"$" "$tip" -- '*Cargo.toml' 2>/dev/null | sed -n '1{s#^[0-9a-f]*:##; s#/*Cargo.toml$##; p;}' || true)"
    [[ -n "$dir" ]] && paths="$paths $dir"
done < <(awk '/^\[\[package\]\]/{n=""; s=""} /^name = /{gsub(/"/,"",$3); n=$3} /^source = /{s=$3} /^$/{ if (n != "" && (s == "" || s ~ /^"git\+/)) print n; n="" }' "$kit_repo/crates/Cargo.lock" | sort -u)
if ! git -C "$co" cat-file -e "$old_base^{commit}" 2>/dev/null; then
    git -C "$co" fetch --quiet --filter=blob:none "$old_url" "$old_base" 2>/dev/null || true
fi
echo
if git -C "$co" cat-file -e "$old_base^{commit}" 2>/dev/null; then
    from="$(git -C "$co" merge-base "$old_base" "$new_rev")"
    [[ "$from" != "$old_base" ]] && echo "the previous base ${old_base:0:12} is not on main; main is compared from their merge base ${from:0:12}"
    echo "---- upstream main since the previous base: $(git -C "$co" rev-list --count "$from..$new_rev") commit(s)"
    git -C "$co" log --oneline --no-decorate "$from..$new_rev" | sed 's/^/  /'
    echo
    echo "---- of them, touching the crates this workspace builds (${paths# }) and the workspace manifest:"
    # shellcheck disable=SC2086
    git -C "$co" log --oneline --no-decorate "$from..$new_rev" -- $paths Cargo.toml | sed 's/^/  /'
    if [[ "$from" != "$old_base" ]]; then
        echo
        echo "---- on the previous base but not on main (landed upstream as other commits, or not at all):"
        git -C "$co" log --oneline --no-decorate "$from..$old_base" | sed 's/^/  /'
    fi
else
    echo "(the previous base ${old_base:0:12} could not be fetched from $old_url: no log)"
fi
[[ -n "$kit_branch" ]] && print_publish
cat <<EOF

Nothing was built, committed or pushed. Next (docs/editor-base.md):
  vendor/gpui-kit/check.sh
  crates/review-wasm/build.sh && pnpm --filter @extension/review-wasm ready
  (cd crates && cargo test && cargo test -p review-view --features view-tests && cargo test -p review-view --no-default-features)
  pnpm build && pnpm validate:build
  pnpm test:e2e -- --only=compare   and   pnpm test:e2e -- --only=themes,shell,text-diff
If the build fails on gpui-kit's API, adapt crates/ (the log above names the commits).
EOF
