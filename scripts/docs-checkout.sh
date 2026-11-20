#!/usr/bin/env bash
#
# Puts the developer documents, the repository devtab-dev-docs, at docs/: decisions, the plan, research, the
# tool specifications, screenshots and the experiments (docs/spikes/). They are a private repository of their
# own; this one ignores docs/ and builds, tests and checks without it. Also makes spikes a link to docs/spikes, so
# the paths spikes/… in comments and documents resolve.
#
# In the main working copy it clones the documents once. In a linked worktree it makes docs a link to the main
# working copy's docs/, so every worktree reads the same documents and a change to them is made, and committed, in
# one place. Run again, it changes nothing.
#
# devtab-dev-docs has no remote yet: until the owner creates one, there is nothing to clone, and the script says
# so and stops. Give the address with DEVTAB_DEV_DOCS_URL once it exists:
#
#   DEVTAB_DEV_DOCS_URL=<url> scripts/docs-checkout.sh
#   scripts/docs-checkout.sh                        # in a linked worktree: links the main copy's docs/

set -euo pipefail

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
docs="$root/docs"
url="${DEVTAB_DEV_DOCS_URL:-}"

link_spikes() {
  if [[ -d "$docs/spikes" && ! -e "$root/spikes" && ! -L "$root/spikes" ]]; then
    ln -s docs/spikes "$root/spikes"
    echo "spikes → docs/spikes"
  fi
}

if [[ -e "$docs" ]]; then
  echo "docs/ is already there: $(cd "$docs" && pwd -P)"
  link_spikes
  exit 0
fi

# The first worktree git lists is the main working copy.
main="$(git -C "$root" worktree list --porcelain | awk '/^worktree / && !seen++ {print substr($0, 10)}')"
if [[ "$main" != "$root" && -d "$main/docs/.git" ]]; then
  ln -s "$main/docs" "$docs"
  echo "docs → $main/docs"
  link_spikes
  exit 0
fi

if [[ -z "$url" ]]; then
  echo "The developer documents (devtab-dev-docs) have no remote repository yet: nothing to clone." >&2
  echo "Once the owner creates one: DEVTAB_DEV_DOCS_URL=<url> scripts/docs-checkout.sh" >&2
  echo "Without docs/ everything here still installs, builds and passes its checks." >&2
  exit 1
fi

git clone "$url" "$docs"
# Commits there carry the same identity as commits here, and are checked by the documents' own hooks.
for key in user.name user.email; do
  value="$(git -C "$root" config --local "$key" || true)"
  if [[ -n "$value" ]]; then
    git -C "$docs" config "$key" "$value"
  fi
done
git -C "$docs" config commit.gpgsign false
git -C "$docs" config tag.gpgsign false
if [[ -x "$docs/scripts/install-hooks.sh" ]]; then
  "$docs/scripts/install-hooks.sh"
fi
echo "docs/ cloned from $url"
link_spikes
