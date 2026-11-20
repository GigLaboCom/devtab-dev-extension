# Shared by the hooks (sourced, not run): the private pattern list and the gitleaks binary.

common="$(git rev-parse --path-format=absolute --git-common-dir)"
root="$(git rev-parse --show-toplevel)"

# The private patterns, one extended regular expression per line, from <git common dir>/info/privacy-patterns.
# The file lives inside .git and is never committed, so the patterns themselves stay private.
private_patterns() {
  local list="$common/info/privacy-patterns"
  if [[ -f "$list" ]]; then grep -vE '^[[:space:]]*(#|$)' "$list" | awk '!seen[$0]++' || true; fi
}

# The always-on patterns: absolute home paths (/Users/Shared/ names no one and is allowed; callers strip it first)
# and the address of the global git identity. The home-path patterns are split so that this file does not match
# itself. Fills the arrays `patterns` and `labels`.
builtin_patterns() {
  patterns=("/Us""ers/[^/[:space:]]+/" "/ho""me/[^/[:space:]]+/")
  labels=("an absolute macOS home path" "an absolute Linux home path")
  global_email="$(git config --global user.email || true)"
  if [[ -n "$global_email" ]]; then
    patterns+=("$(printf '%s' "$global_email" | sed 's/[][\.*^$()+?{}|]/\\&/g')")
    labels+=("the global git address")
  fi
}

# Prints the gitleaks binary: $GITLEAKS, on PATH, or Homebrew's (a GUI client may run hooks with a short PATH).
find_gitleaks() {
  local bin
  for bin in "${GITLEAKS:-}" "$(command -v gitleaks 2>/dev/null || true)" /opt/homebrew/bin/gitleaks \
    /usr/local/bin/gitleaks; do
    if [[ -n "$bin" && -x "$bin" ]] && "$bin" version >/dev/null 2>&1; then
      echo "$bin"
      return 0
    fi
  done
  return 1
}

gitleaks_missing() {
  echo "gitleaks is not installed. Install it (brew install gitleaks, or a release from"
  echo "https://github.com/gitleaks/gitleaks/releases after checking its checksums) or point GITLEAKS at it,"
  echo "or skip this hook deliberately with --no-verify."
}
