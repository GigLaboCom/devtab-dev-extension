#!/bin/bash
# e2e-setup.sh — Playwright and Chrome for Testing for `pnpm test:e2e`, OUTSIDE the workspace (as the second sibling
# extension keeps them: Playwright is not a workspace dependency).
#
#   .state/e2e/node/node_modules/playwright     Playwright 1.65.1 (the version spikes/extension-e2e ran with)
#   .state/extension-e2e/browsers               Chrome for Testing (~380 MB), shared with spikes/extension-e2e/run.sh
#
# Packages come from the public npm registry only (see .npmrc); the browser from Playwright's own download host.
# Usage: bash scripts/e2e-setup.sh            (idempotent: does nothing when both are there)

set -euo pipefail
cd "$(dirname "$0")/.."

STATE=".state/e2e"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$PWD/.state/extension-e2e/browsers}"
mkdir -p "$STATE/node"

if [ ! -d "$STATE/node/node_modules/playwright" ]; then
  [ -f "$STATE/node/package.json" ] || echo '{ "private": true }' > "$STATE/node/package.json"
  npm install --prefix "$STATE/node" --registry=https://registry.npmjs.org/ --cache "$PWD/$STATE/npm-cache" \
    --no-audit --no-fund playwright@1.65.1
fi

if ! ls "$PLAYWRIGHT_BROWSERS_PATH" 2>/dev/null | grep -q '^chromium-'; then
  "$STATE/node/node_modules/.bin/playwright" install --no-shell chromium
fi

echo "Playwright: $STATE/node; browsers: $PLAYWRIGHT_BROWSERS_PATH"
