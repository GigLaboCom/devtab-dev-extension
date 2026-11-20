#!/usr/bin/env bash
#
# Points git at the repository's hooks in .githooks/ (pre-commit: secrets, local-only files and private data;
# commit-msg: no agent attribution; pre-push: both again for what leaves the machine), and creates the private
# pattern list they read, if it is missing. core.hooksPath is local git config, so a clone does not carry it: run
# this once after cloning; linked worktrees share both. The developer documents (docs/, scripts/docs-checkout.sh)
# have hooks of their own: run docs/scripts/install-hooks.sh there.
#
#   scripts/install-hooks.sh

set -euo pipefail

root="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
common="$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)"

git -C "$root" config core.hooksPath .githooks
echo "Git hooks: .githooks/ (pre-commit, commit-msg, pre-push)"

list="$common/info/privacy-patterns"
if [[ ! -f "$list" ]]; then
  mkdir -p "$common/info"
  printf '%s\n' \
    '# Private patterns the hooks refuse in added lines, commit messages and the author: one extended regular' \
    '# expression per line, matched without case. This file lives inside .git and is never committed. Add your' \
    '# work domain, other addresses, machine names and names that must not be published.' \
    >"$list"
  echo "Created $list: add your own patterns to it."
fi

if [[ -z "$(git -C "$root" config --local user.email || true)" ]]; then
  echo "This clone has no identity of its own yet; the hooks refuse commits under the global address:"
  echo "  git config user.name '<name>'; git config user.email '<address>'"
fi

bin="${GITLEAKS:-$(command -v gitleaks 2>/dev/null || true)}"
for other in /opt/homebrew/bin/gitleaks /usr/local/bin/gitleaks; do
  [[ -z "$bin" && -x "$other" ]] && bin="$other"
done
if [[ -n "$bin" ]]; then
  echo "gitleaks: $bin"
else
  echo "gitleaks is not installed, and the hooks refuse commits and pushes until it is:"
  echo "  brew install gitleaks"
  echo "  or a release from https://github.com/gitleaks/gitleaks/releases (check its checksums), then GITLEAKS=<path>"
fi
