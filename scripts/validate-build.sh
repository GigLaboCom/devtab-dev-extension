#!/usr/bin/env bash

# validate-build.sh
# Validates that a build of the extension (dist/ directory or .zip) is a clean production build AND that the built
# manifest stays inside the extension's declared surface, permissions and CSP.
#
# Taken from the second sibling extension's scripts/validate-build.sh (itself from the first one's, migrated from the
# reference boilerplate's build validator). The generic checks (1–8c: dev artifacts, HMR leaks, sources, manifest
# references, built asset references, icons) are kept as they were, made portable to macOS (no `realpath -m`). The
# product checks are this extension's own:
#   9   the surface: a module service worker + the main page (the New Tab page when the build overrides it, and the
#       options page at its ?options#/settings route — both exactly as their chosen definitions say:
#       extension/src/newTab/index.ts and extension/src/options/index.ts, read by scripts/entry-pages.mjs) + the editor
#       page + the toolbar button exactly as its chosen definition says
#       (extension/src/toolbar/index.ts, read by scripts/toolbar-button.mjs): `action.default_popup` is its popup page or
#       absent, and the shipped pages are exactly these — without a popup no popup page ships and no script nothing
#       loads; no side panel, other overrides, content scripts, web-accessible resources…
#   10  permissions: `storage` plus exactly what the start page's parts declare (required and optional — read from
#       their definitions by scripts/start-parts.mjs; an optional one is never required), no host permissions — in particular no
#       `nativeMessaging` while live review is a stub
#   11  no remote hosts in the built JS beyond a short allowlist (Chrome Web Store: no remotely hosted code)
#   12  CSP exactly the one manifest.config.ts declares (spikes/extension-e2e's minimum + the iframe pair); no inline
#       scripts or styles; a service worker that loads no DOM code; no Native Messaging code
#   13  the editor module: exactly one .wasm — the one packages/review-wasm/pkg holds (sha256) — loaded by the editor
#       page only; the main page's chunks stay free of it (D3: the wasm loads lazily, the tools never wait for it)
#   14  the licences of what the editor module embeds (gpui-kit and imara-diff Apache-2.0, the fonts' OFL) ship with it
#   15  the start route's initial load — what a new tab loads before its first paint: the boot scripts, the main page's
#       script with its static imports, its stylesheet — stays within a byte budget, and loads none of the chunks the
#       page imports lazily (the shell, the parts, the tools, the editor's theme files)
#   16  the toolbar popup, when the chosen button has one, stays light: everything it loads within a byte budget, none
#       of the main page's or the editor page's own scripts, no React, no wasm
#
# Widening the extension (a new permission, a new page, content scripts) is intentional work: update manifest.config.ts
# AND the allowlists below in the same change. The start page's permissions and the toolbar button are not lists here:
# they come from their definitions, which manifest.config.ts reads too.
#
# Needs bash ≥ 4, jq, node, unzip (for a zip). Usage: scripts/validate-build.sh <dist-directory-or-zip>  (default: dist)

set -u

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PRODUCT_JSON="$ROOT/extension/product.json"
# The expected name and description: the one place they live.
EXPECTED_NAME="$(jq -r '.name' "$PRODUCT_JSON")"
# Manifest permissions: `storage` (the page's own) plus what the start page's parts declare as required; optional
# permissions: exactly what the parts declare as optional (each with an install warning, asked for when the user turns
# its part on). The parts' definitions (extension/src/start/parts, with the reason for each permission) are the one
# source; scripts/start-parts.mjs reads them. A manifest permission no part declares, or a declared one the manifest
# lacks, fails Check 10.
START_PARTS_JSON="$(node "$ROOT/scripts/start-parts.mjs")" || { echo -e "${RED}ERROR: scripts/start-parts.mjs failed${NC}"; exit 1; }
ALLOWED_PERMISSIONS="storage $(jq -r '.required | join(" ")' <<<"$START_PARTS_JSON")"
ALLOWED_OPTIONAL_PERMISSIONS="$(jq -r '.optional | join(" ")' <<<"$START_PARTS_JSON")"
# The toolbar button the build must carry: the definition chosen in extension/src/toolbar/index.ts — its popup page, or
# none (a click goes to the service worker). Checks 9 and 16.
TOOLBAR_JSON="$(node "$ROOT/scripts/toolbar-button.mjs")" || { echo -e "${RED}ERROR: scripts/toolbar-button.mjs failed${NC}"; exit 1; }
TOOLBAR_ID="$(jq -r '.id' <<<"$TOOLBAR_JSON")"
TOOLBAR_POPUP="$(jq -r '.popup // empty' <<<"$TOOLBAR_JSON")"
# Manifest host_permissions must stay within this set (space-separated; empty = none allowed).
ALLOWED_HOST_PERMISSIONS=""
# Every http(s) host literal allowed to appear inside built JS (text only — nothing is fetched from them):
#   www.w3.org             SVG/XHTML/MathML namespace strings in React output
#   reactjs.org, react.dev minified React error/docs links
#   example.com            a reserved example domain (RFC 2606) in a tool's placeholder (url: §8)
#   www.npmjs.com          the licence banner of hash-wasm (the Hash tool's wasm hashes), kept as its MIT notice
ALLOWED_JS_HOSTS='^(www\.w3\.org|reactjs\.org|react\.dev|example\.com|www\.npmjs\.com)$'
# The two extension pages (not manifest entries; vite.config.ts builds them as inputs).
APP_PAGE="src/app/index.html"
VIEWER_PAGE="src/viewer/index.html"
# Whether the build is the New Tab page and how its options page opens: the definitions chosen in
# extension/src/newTab/index.ts and extension/src/options/index.ts. Check 9.
ENTRY_JSON="$(node "$ROOT/scripts/entry-pages.mjs")" || { echo -e "${RED}ERROR: scripts/entry-pages.mjs failed${NC}"; exit 1; }
NEWTAB_ID="$(jq -r '.newTab.id' <<<"$ENTRY_JSON")"
EXPECTED_OVERRIDES="$(jq -c 'if .newTab.newtab then { newtab: .newTab.newtab } else null end' <<<"$ENTRY_JSON")"
EXPECTED_OPTIONS="$(jq -c '{ page: .options.page, open_in_tab: .options.openInTab }' <<<"$ENTRY_JSON")"
# What a new tab loads before its first paint (Check 15), in bytes: JS + CSS + the boot scripts, fonts aside. Measured
# 466 353 at the start (docs/decisions.md D16: 20 opens, first paint 52 ms median in Chrome for Testing); the budget is
# that plus about 10 %. Growing past it is a decision: raise it here with the reason.
START_ROUTE_BUDGET=512000
# What the toolbar popup loads (Check 16), in bytes: its HTML, JS, CSS and the theme boot script, fonts aside. Measured
# 105 661 for the menu (2026-11-20; about 95 KB of it the 30 themes' variables); the budget is that plus about 10 %.
POPUP_BUDGET=116000
# The editor module the build must ship (packages/review-wasm/scripts/sync.sh puts it there).
REVIEW_WASM="$ROOT/packages/review-wasm/pkg/review_wasm_bg.wasm"
# Licence files that must ship under licenses/ (packages/review-wasm/licenses and the IBM Plex OFL of packages/dna,
# emitted by vite.config.ts).
REQUIRED_LICENSES="GPUI-KIT-LICENSE-APACHE.txt IMARA-DIFF-LICENSE-APACHE.txt OFL-fonts.txt OFL-IBMPlex.txt"
# The Chrome Web Store's limit on the description.
MAX_DESCRIPTION=132

pass() { echo -e "${GREEN}✓ PASSED: $1${NC}"; }
fail() { echo -e "${RED}✗ FAILED: $1${NC}"; ERRORS=$((ERRORS + 1)); }
warn() { echo -e "${YELLOW}⚠ WARNING: $1${NC}"; WARNINGS=$((WARNINGS + 1)); }

# An absolute, normalized path also for a file that does not exist (macOS has no `realpath -m`).
norm() {
    local d
    d="$(dirname "$1")"
    if [ -d "$d" ]; then printf '%s/%s\n' "$(cd "$d" && pwd -P)" "$(basename "$1")"; else printf '%s\n' "$1"; fi
}
sha256() { if command -v sha256sum &> /dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

if ! command -v jq &> /dev/null; then
    echo -e "${RED}ERROR: jq is required but not installed (brew install jq / apt-get install jq).${NC}"
    exit 1
fi
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    echo -e "${RED}ERROR: bash ≥ 4 is required (macOS: brew install bash; run it as \`bash scripts/validate-build.sh\`).${NC}"
    exit 1
fi

BUILD_PATH="${1:-dist}"
TEMP_DIR=""
CLEANUP=false

if [ ! -e "$BUILD_PATH" ]; then
    echo -e "${RED}ERROR: Path does not exist: $BUILD_PATH (run pnpm build first)${NC}"
    exit 1
fi

if [ -f "$BUILD_PATH" ]; then
    if ! command -v unzip &> /dev/null; then
        echo -e "${RED}ERROR: unzip is required to inspect archives.${NC}"
        exit 1
    fi
    TEMP_DIR=$(mktemp -d)
    CLEANUP=true
    INSPECT_DIR="$TEMP_DIR"
    echo "Extracting archive to temporary directory..."
    unzip -q "$BUILD_PATH" -d "$TEMP_DIR"
elif [ -d "$BUILD_PATH" ]; then
    INSPECT_DIR="$(cd "$BUILD_PATH" && pwd -P)"
else
    echo -e "${RED}ERROR: Path is neither a file nor a directory${NC}"
    exit 1
fi

cleanup() {
    if [ "$CLEANUP" = true ] && [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

MANIFEST="$INSPECT_DIR/manifest.json"

echo ""
echo "=============================================="
echo "$EXPECTED_NAME — production build validation"
echo "=============================================="
echo "Inspecting: $BUILD_PATH"
echo ""

# Check 0: manifest.json must exist and parse — everything else reads it
if [ ! -f "$MANIFEST" ]; then
    echo -e "${RED}✗ FATAL: manifest.json not found${NC}"
    exit 1
fi
if ! jq empty "$MANIFEST" 2>/dev/null; then
    echo -e "${RED}✗ FATAL: manifest.json is not valid JSON${NC}"
    exit 1
fi

# Check 1: no source maps
echo "Check 1: Source maps (.map files)..."
MAP_FILES=$(find "$INSPECT_DIR" -name "*.map" 2>/dev/null || true)
if [ -n "$MAP_FILES" ]; then
    fail "source map files found (dev artifact):"
    echo "$MAP_FILES" | sed 's/^/  /'
else
    pass "no source map files"
fi

# Check 2: no crxjs/Vite dev-server artifacts (a dev-server build points at localhost:5173)
echo "Check 2: Dev-server artifacts..."
DEV_REFS=$(grep -rlE 'localhost:5173|@vite/client|vite/dist/client' "$INSPECT_DIR" 2>/dev/null || true)
if [ -n "$DEV_REFS" ]; then
    fail "files reference the Vite dev server:"
    echo "$DEV_REFS" | sed 's/^/  /'
else
    pass "no dev-server references"
fi

# Check 3: no @extension/hmr reload-client injections (dev-only watchRebuildPlugin output — a prod dist must never
# open ws://localhost:<port> or carry __HMR_ID / __HMR_URL markers), and no dev CSP
echo "Check 3: HMR reload-client injections..."
HMR_REFS=$(grep -rlE '__HMR_ID|__HMR_URL|ws://localhost' "$INSPECT_DIR" --include='*.js' --include='*.json' 2>/dev/null || true)
if [ -n "$HMR_REFS" ]; then
    fail "files carry the dev reload client or the dev CSP (built with pnpm dev, not pnpm build):"
    echo "$HMR_REFS" | sed 's/^/  /'
else
    pass "no HMR reload-client injections"
fi

# Check 4: no node/git/config artifacts
echo "Check 4: Node/Git artifacts..."
NODE_ARTIFACTS=(node_modules package.json pnpm-lock.yaml pnpm-workspace.yaml .git .gitignore .env .npmrc
                tsconfig.json vite.config.ts vitest.config.ts manifest.config.ts product.json)
FOUND_ARTIFACTS=()
for artifact in "${NODE_ARTIFACTS[@]}"; do
    [ -e "$INSPECT_DIR/$artifact" ] && FOUND_ARTIFACTS+=("$artifact")
done
if [ ${#FOUND_ARTIFACTS[@]} -gt 0 ]; then
    fail "node/git artifacts found: ${FOUND_ARTIFACTS[*]}"
else
    pass "no node/git artifacts"
fi

# Check 5: no uncompiled TypeScript sources
echo "Check 5: TypeScript source files..."
TS_FILES=$(find "$INSPECT_DIR" \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null || true)
if [ -n "$TS_FILES" ]; then
    fail "TypeScript source files found:"
    echo "$TS_FILES" | head -10 | sed 's/^/  /'
else
    pass "no TypeScript source files"
fi

# Check 6: extension name, description, version format (manifest_version 3)
echo "Check 6: Manifest name, description, version & MV3..."
ACTUAL_NAME=$(jq -r '.name' "$MANIFEST")
MANIFEST_VERSION=$(jq -r '.version' "$MANIFEST")
DESCRIPTION=$(jq -r '.description // ""' "$MANIFEST")
if [ "$ACTUAL_NAME" = "$EXPECTED_NAME" ]; then
    pass "extension name is '$ACTUAL_NAME' (extension/product.json)"
else
    fail "extension name is '$ACTUAL_NAME', expected '$EXPECTED_NAME' (extension/product.json)"
fi
if [ -n "$DESCRIPTION" ] && [ "${#DESCRIPTION}" -le "$MAX_DESCRIPTION" ]; then
    pass "description is ${#DESCRIPTION} characters (max $MAX_DESCRIPTION)"
else
    fail "description is ${#DESCRIPTION} characters (must be 1…$MAX_DESCRIPTION)"
fi
if [[ "$MANIFEST_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    pass "version format is valid ($MANIFEST_VERSION)"
else
    fail "invalid version format '$MANIFEST_VERSION' (expected X.Y.Z)"
fi
if [ "$(jq -r '.manifest_version' "$MANIFEST")" = "3" ]; then
    pass "manifest_version is 3"
else
    fail "manifest_version is not 3"
fi

# Check 8: every file the manifest references must exist
echo "Check 8: Manifest file references..."
MISSING_FILES=()
check_ref() {  # $1 = label, $2 = relative path (may be empty)
    if [ -n "$2" ] && [ ! -f "$INSPECT_DIR/$2" ]; then
        MISSING_FILES+=("$1: $2")
    fi
}
check_ref "action.default_popup" "$(jq -r '.action.default_popup // empty' "$MANIFEST")"
check_ref "options_page"         "$(jq -r '.options_page // empty' "$MANIFEST")"
check_ref "options_ui.page"      "$(jq -r '.options_ui.page // empty | split("#")[0] | split("?")[0]' "$MANIFEST")"
check_ref "chrome_url_overrides.newtab" "$(jq -r '.chrome_url_overrides.newtab // empty' "$MANIFEST")"
check_ref "background.service_worker" "$(jq -r '.background.service_worker // empty' "$MANIFEST")"
check_ref "side_panel.default_path" "$(jq -r '.side_panel.default_path // empty' "$MANIFEST")"
check_ref "main page" "$APP_PAGE"
check_ref "editor page" "$VIEWER_PAGE"
# .icons and action.default_icon are size→path maps
while IFS= read -r icon; do
    check_ref "icon" "$icon"
done < <(jq -r '[(.icons // {}) | .[]] + [(.action.default_icon // {}) | if type == "object" then .[] else . end] | .[]' "$MANIFEST")
while IFS= read -r js_file; do
    check_ref "content_scripts.js" "$js_file"
done < <(jq -r '.content_scripts[]?.js[]?' "$MANIFEST")
if [ ${#MISSING_FILES[@]} -gt 0 ]; then
    fail "files referenced in manifest.json are missing:"
    printf '  - %s\n' "${MISSING_FILES[@]}"
else
    pass "all manifest-referenced files exist"
fi

# Check 8b: every local asset referenced from inside the built files must exist —
#   HTML src/href (script, modulepreload, stylesheet…), relative JS imports between chunks, the preload lists of lazy
#   chunks (`__vite__mapDeps`), CSS url().
# A missing chunk loads as a blank page with no build error, so catch it here.
echo "Check 8b: Built asset references (HTML / JS imports / CSS url)..."
BROKEN_REFS=()
REFERENCED=()
resolve_ref() {  # $1 = referencing file, $2 = reference → prints the absolute path, or nothing if not local
    local ref="${2%%[?#]*}"
    case "$ref" in
        ''|http://*|https://*|data:*|blob:*|chrome:*|chrome-extension:*|//*|mailto:*) return ;;
        /*) echo "$INSPECT_DIR$ref" ;;
        *) echo "$(dirname "$1")/$ref" ;;
    esac
}
check_asset_ref() {  # $1 = referencing file, $2 = reference
    local target
    target=$(resolve_ref "$1" "$2")
    [ -n "$target" ] || return 0
    if [ -f "$target" ]; then
        REFERENCED+=("$(norm "$target")")
    else
        BROKEN_REFS+=("${1#"$INSPECT_DIR"/} -> $2")
    fi
}
while IFS= read -r -d '' html; do
    while IFS= read -r ref; do
        check_asset_ref "$html" "$ref"
    done < <(grep -oE '(src|href)="[^"]*"' "$html" | sed -E 's/^(src|href)="(.*)"$/\2/')
done < <(find "$INSPECT_DIR" -name '*.html' -print0)
while IFS= read -r -d '' js; do
    while IFS= read -r ref; do
        check_asset_ref "$js" "$ref"
    done < <(grep -oE '(from|import)[[:space:]]*\(?[[:space:]]*["'"'"']\.{1,2}/[^"'"'"']+["'"'"']' "$js" \
        | sed -E 's/^.*["'"'"'](\.{1,2}\/[^"'"'"']+)["'"'"']$/\1/')
    # Workers and other assets would be referenced as root-relative asset strings
    # (`new URL("/assets/…", import.meta.url)`), not as imports.
    while IFS= read -r ref; do
        check_asset_ref "$js" "$ref"
    done < <(grep -oE '["'"'"']/assets/[^"'"'"']+["'"'"']' "$js" | tr -d "\"'" | sort -u)
    # What a lazy chunk needs besides itself, as the bundler lists it for its preload helper: the
    # `__vite__mapDeps` array names chunks and stylesheets relative to the extension's root ("assets/x.css"; the helper
    # prepends "/"). A stylesheet that only a lazy chunk needs (the shell's) is referenced nowhere else.
    while IFS= read -r ref; do
        check_asset_ref "$js" "/$ref"
    done < <(grep -oE '__vite__mapDeps=[^;]*' "$js" | grep -oE '["'"'"']assets/[^"'"'"']+["'"'"']' | tr -d "\"'" | sort -u)
done < <(find "$INSPECT_DIR" -name '*.js' -print0)
while IFS= read -r -d '' css; do
    while IFS= read -r ref; do
        check_asset_ref "$css" "$ref"
    done < <(grep -oE 'url\([^)]*\)' "$css" | sed -E 's/^url\(["'"'"']?([^"'"'"')]*)["'"'"']?\)$/\1/')
done < <(find "$INSPECT_DIR" -name '*.css' -print0)
if [ ${#BROKEN_REFS[@]} -gt 0 ]; then
    fail "built files reference missing assets:"
    printf '  - %s\n' "${BROKEN_REFS[@]}"
else
    pass "all HTML/JS/CSS asset references resolve (${#REFERENCED[@]} refs)"
fi
# Orphans: files under assets/ that nothing references are dead weight in the shipped zip.
ORPHANS=()
REFERENCED_LIST=$(printf '%s\n' "${REFERENCED[@]:-}" | sort -u)
while IFS= read -r -d '' asset; do
    grep -qxF "$(norm "$asset")" <<<"$REFERENCED_LIST" || ORPHANS+=("${asset#"$INSPECT_DIR"/}")
done < <(find "$INSPECT_DIR/assets" -type f -print0 2>/dev/null)
if [ ${#ORPHANS[@]} -gt 0 ]; then
    warn "unreferenced files in assets/:"
    printf '  - %s\n' "${ORPHANS[@]}"
fi

# Check 8c: icons are real PNGs whose pixel size matches the size key they are declared under
echo "Check 8c: Icon format & dimensions..."
ICON_ERRORS=()
while IFS=$'\t' read -r size icon; do
    file="$INSPECT_DIR/$icon"
    [ -f "$file" ] || continue  # missing files are reported by Check 8
    if [ "$(od -An -tx1 -N8 "$file" | tr -d ' \n')" != "89504e470d0a1a0a" ]; then
        ICON_ERRORS+=("$icon: not a PNG")
        continue
    fi
    read -r w1 w2 w3 w4 h1 h2 h3 h4 < <(od -An -tu1 -j16 -N8 "$file")
    width=$(( (w1 << 24) | (w2 << 16) | (w3 << 8) | w4 ))
    height=$(( (h1 << 24) | (h2 << 16) | (h3 << 8) | h4 ))
    if [ "$width" != "$size" ] || [ "$height" != "$size" ]; then
        ICON_ERRORS+=("$icon: declared as $size but is ${width}x${height}")
    fi
done < <(jq -r '[(.icons // {}), (.action.default_icon // {} | if type == "object" then . else {} end)] | .[] | to_entries[] | "\(.key)\t\(.value)"' "$MANIFEST" | sort -u)
if [ ${#ICON_ERRORS[@]} -gt 0 ]; then
    fail "icon problems:"
    printf '  - %s\n' "${ICON_ERRORS[@]}"
else
    pass "icons are PNGs matching their declared sizes"
fi
if [ "$(jq -r '.icons["128"] // empty' "$MANIFEST")" = "" ]; then
    warn "no 128px icon in .icons (required for the Chrome Web Store listing)"
fi


# The JS files a starting set loads statically, transitively (relative `import … from "./x.js"` between chunks).
# Prints one absolute path per line. Dynamic import() of a relative chunk counts too — over-approximating is safe here.
walk_chunks() {
    local -a queue=("$@")
    local -A seen=()
    local f ref
    while [ ${#queue[@]} -gt 0 ]; do
        f="${queue[0]}"; queue=("${queue[@]:1}")
        [ -n "${seen[$f]:-}" ] && continue
        seen[$f]=1
        [ -f "$f" ] || continue
        printf '%s\n' "$f"
        while IFS= read -r ref; do
            queue+=("$(norm "$(dirname "$f")/$ref")")
        done < <(grep -oE '(from|import)[[:space:]]*\(?[[:space:]]*["'"'"']\.{1,2}/[^"'"'"']+\.js["'"'"']' "$f" \
            | sed -E 's/^.*["'"'"'](\.{1,2}\/[^"'"'"']+)["'"'"']$/\1/')
        # A worker a chunk loads from its own file (a tool's, D14): `new Worker(new URL("/assets/x.js", import.meta.url))`.
        while IFS= read -r ref; do
            case "$ref" in
                /*) queue+=("$(norm "$INSPECT_DIR$ref")") ;;
                *) queue+=("$(norm "$(dirname "$f")/$ref")") ;;
            esac
        done < <(grep -oE 'new URL\([[:space:]]*["'"'"'][^"'"'"']+\.js["'"'"'][[:space:]]*,[[:space:]]*import\.meta\.url' "$f" \
            | sed -E 's/^new URL\([[:space:]]*["'"'"']([^"'"'"']+)["'"'"'].*$/\1/')
    done
}
# The scripts a page loads (its <script src> and modulepreload <link>s), as absolute paths.
page_scripts() {
    local html="$1" ref
    while IFS= read -r ref; do
        case "$ref" in
            /*) norm "$INSPECT_DIR$ref" ;;
            *) norm "$(dirname "$html")/$ref" ;;
        esac
    done < <(grep -oE '<(script|link)[^>]*(src|href)="[^"]+\.js"' "$html" | sed -E 's/^.*(src|href)="([^"]+)"$/\2/')
}

# Check 9: surface scope — a module service worker + the main page (New Tab page, options) + the editor page
echo "Check 9: Extension surfaces (service worker + main page as New Tab ('$NEWTAB_ID') and options + editor page)..."
SURFACE_ERRORS=()
[ -n "$(jq -r '.background.service_worker // empty' "$MANIFEST")" ] || SURFACE_ERRORS+=("background.service_worker is missing")
[ "$(jq -r '.background.type // empty' "$MANIFEST")" = "module" ] || SURFACE_ERRORS+=("background.type is not 'module'")
# The toolbar button as its definition says: its popup page, or none — then the click reaches the service worker.
[ "$(jq -r 'has("action")' "$MANIFEST")" = "true" ] || SURFACE_ERRORS+=("no 'action' (the toolbar button)")
ACTUAL_POPUP="$(jq -r '.action.default_popup // empty' "$MANIFEST")"
[ "$ACTUAL_POPUP" = "$TOOLBAR_POPUP" ] \
    || SURFACE_ERRORS+=("action.default_popup is '${ACTUAL_POPUP}', the toolbar button '$TOOLBAR_ID' says '${TOOLBAR_POPUP}'")
# The pages shipped are exactly the main page, the editor page and the button's popup page, if it has one.
EXPECTED_PAGES=$(printf '%s\n' "$APP_PAGE" "$VIEWER_PAGE" ${TOOLBAR_POPUP:+"$TOOLBAR_POPUP"} | sort)
ACTUAL_PAGES=$(cd "$INSPECT_DIR" && find . -name '*.html' | sed 's#^\./##' | sort)
for page in $(comm -23 <(echo "$EXPECTED_PAGES") <(echo "$ACTUAL_PAGES")); do SURFACE_ERRORS+=("$page is not shipped"); done
for page in $(comm -13 <(echo "$EXPECTED_PAGES") <(echo "$ACTUAL_PAGES")); do SURFACE_ERRORS+=("unexpected page $page"); done
# Every script ships for something: the service worker, a page or what they import (a page's script without its
# page — the popup's when the button has none — is dead weight that says the build and the definition disagree).
SW_FILE=$(jq -r '.background.service_worker // empty' "$MANIFEST")
mapfile -t REACHED < <({
    [ -n "$SW_FILE" ] && walk_chunks "$(norm "$INSPECT_DIR/$SW_FILE")"
    while IFS= read -r page; do
        [ -f "$INSPECT_DIR/$page" ] && walk_chunks $(page_scripts "$INSPECT_DIR/$page")
    done <<<"$EXPECTED_PAGES"
} | sort -u)
while IFS= read -r -d '' js; do
    printf '%s\n' "${REACHED[@]}" | grep -qxF "$(norm "$js")" || SURFACE_ERRORS+=("a script nothing loads: ${js#"$INSPECT_DIR"/}")
done < <(find "$INSPECT_DIR" -name '*.js' -not -path "$INSPECT_DIR/licenses/*" -print0)
# The New Tab override as its definition says: the main page and nothing else (no bookmarks or history override), or
# none at all.
NTP=$(jq -c '.chrome_url_overrides // null' "$MANIFEST")
[ "$NTP" = "$EXPECTED_OVERRIDES" ] || SURFACE_ERRORS+=("chrome_url_overrides is $NTP, the New Tab override '$NEWTAB_ID' says $EXPECTED_OVERRIDES")
[ "$EXPECTED_OVERRIDES" = "null" ] || [ "$EXPECTED_OVERRIDES" = "{\"newtab\":\"$APP_PAGE\"}" ] \
    || SURFACE_ERRORS+=("the New Tab override '$NEWTAB_ID' names $EXPECTED_OVERRIDES, not the main page")
# The options entry is the main page's settings route (with the options flag), as its definition says.
OPTIONS=$(jq -c '.options_ui // null' "$MANIFEST")
[ "$OPTIONS" = "$EXPECTED_OPTIONS" ] || SURFACE_ERRORS+=("options_ui is $OPTIONS, the options page says $EXPECTED_OPTIONS")
[[ "$(jq -r '.page' <<<"$EXPECTED_OPTIONS")" == "$APP_PAGE?options"*"#/settings" ]] \
    || SURFACE_ERRORS+=("the options page is not the main page's settings route with the options flag: $EXPECTED_OPTIONS")
for key in options_page side_panel content_scripts devtools_page web_accessible_resources \
           sandbox externally_connectable key; do
    if [ "$(jq --arg k "$key" 'has($k)' "$MANIFEST")" = "true" ]; then
        SURFACE_ERRORS+=("unexpected manifest key '$key'")
    fi
done
if [ ${#SURFACE_ERRORS[@]} -gt 0 ]; then
    fail "surface scope violated (update manifest.config.ts AND this validator together to widen it):"
    printf '  - %s\n' "${SURFACE_ERRORS[@]}"
else
    pass "only a module service worker, the toolbar button '$TOOLBAR_ID' (${TOOLBAR_POPUP:-no popup}), $APP_PAGE (New Tab: $NTP; options: $OPTIONS) and $VIEWER_PAGE"
fi

# Check 10: permission model must not widen
echo "Check 10: Permission model..."
BAD_PERMS=()
while IFS= read -r perm; do
    case " $ALLOWED_PERMISSIONS " in
        *" $perm "*) ;;
        *) BAD_PERMS+=("$perm") ;;
    esac
done < <(jq -r '(.permissions // [])[]' "$MANIFEST")
BAD_OPTIONAL=()
while IFS= read -r perm; do
    case " $ALLOWED_OPTIONAL_PERMISSIONS " in
        *" $perm "*) ;;
        *) BAD_OPTIONAL+=("$perm") ;;
    esac
done < <(jq -r '(.optional_permissions // [])[], (.optional_host_permissions // [])[]' "$MANIFEST")
REQUIRED_OPTIONAL=()
while IFS= read -r perm; do
    case " $ALLOWED_OPTIONAL_PERMISSIONS " in
        *" $perm "*) REQUIRED_OPTIONAL+=("$perm") ;;
    esac
done < <(jq -r '(.permissions // [])[]' "$MANIFEST")
MISSING_DECLARED=""
for perm in $ALLOWED_PERMISSIONS; do
    jq -e --arg p "$perm" '(.permissions // []) | index($p)' "$MANIFEST" > /dev/null || MISSING_DECLARED+="$perm "
done
for perm in $ALLOWED_OPTIONAL_PERMISSIONS; do
    jq -e --arg p "$perm" '(.optional_permissions // []) | index($p)' "$MANIFEST" > /dev/null \
        || MISSING_DECLARED+="$perm (optional) "
done
if [ ${#BAD_PERMS[@]} -gt 0 ]; then
    fail "permissions outside the allowed set {$ALLOWED_PERMISSIONS}: ${BAD_PERMS[*]}"
elif [ ${#REQUIRED_OPTIONAL[@]} -gt 0 ]; then
    fail "required permissions that must stay optional (they warn at install): ${REQUIRED_OPTIONAL[*]}"
elif [ ${#BAD_OPTIONAL[@]} -gt 0 ]; then
    fail "optional permissions no start-page part declares (allowed {$ALLOWED_OPTIONAL_PERMISSIONS}): ${BAD_OPTIONAL[*]}"
elif [ -n "$MISSING_DECLARED" ]; then
    fail "permissions the start page's parts declare but the manifest lacks: $MISSING_DECLARED"
else
    pass "permissions within {$ALLOWED_PERMISSIONS}, optional within {$ALLOWED_OPTIONAL_PERMISSIONS}"
fi
BAD_HOSTS=()
while IFS= read -r host; do
    case " $ALLOWED_HOST_PERMISSIONS " in
        *" $host "*) ;;
        *) BAD_HOSTS+=("$host") ;;
    esac
done < <(jq -r '(.host_permissions // [])[]' "$MANIFEST")
if [ ${#BAD_HOSTS[@]} -gt 0 ]; then
    fail "host_permissions outside the allowed set {${ALLOWED_HOST_PERMISSIONS:-none}}: ${BAD_HOSTS[*]}"
else
    pass "host_permissions within {${ALLOWED_HOST_PERMISSIONS:-none}}"
fi

# Check 11: no unexpected remote hosts embedded in the built JS or HTML (no remotely hosted code)
echo "Check 11: Remote endpoints in built JS / HTML..."
UNEXPECTED_HOSTS=$(grep -rhoE 'https?://[a-zA-Z0-9.-]+' "$INSPECT_DIR" --include='*.js' 2>/dev/null \
    | sed -E 's#https?://##' | sort -u | grep -vE "$ALLOWED_JS_HOSTS" || true)
REMOTE_IN_HTML=$(grep -rlE '(src|href)="(https?:)?//' "$INSPECT_DIR" --include='*.html' 2>/dev/null || true)
if [ -n "$UNEXPECTED_HOSTS" ] || [ -n "$REMOTE_IN_HTML" ]; then
    fail "unexpected remote references (allowed in JS: w3.org namespaces, React docs links, example.com):"
    [ -n "$UNEXPECTED_HOSTS" ] && echo "$UNEXPECTED_HOSTS" | sed 's/^/  js: /'
    [ -n "$REMOTE_IN_HTML" ] && echo "$REMOTE_IN_HTML" | sed 's/^/  html: /'
else
    pass "no unexpected remote hosts in built JS; no remote src/href in HTML"
fi

# Check 12: CSP, inline code, the service worker, no Native Messaging yet
echo "Check 12: CSP, no inline scripts or styles, a DOM-free service worker, no Native Messaging..."
BUILD_ERRORS=()
EXPECTED_CSP="$(cd "$ROOT/extension" && node --input-type=module -e '
  const src = (await import("node:fs")).readFileSync("manifest.config.ts", "utf8");
  const hashes = [...src.matchAll(/"(\x27sha256-[^"]+\x27)"/g)].map(m => m[1]);
  console.log([
    "default-src \x27none\x27",
    "script-src \x27self\x27 \x27wasm-unsafe-eval\x27",
    "style-src \x27self\x27",
    "style-src-attr \x27unsafe-hashes\x27 " + hashes.join(" "),
    "img-src \x27self\x27",
    "font-src \x27self\x27",
    "connect-src \x27self\x27",
    "frame-src \x27self\x27",
    "object-src \x27none\x27",
    "base-uri \x27none\x27",
    "form-action \x27none\x27",
    "frame-ancestors \x27self\x27",
  ].join("; "));
')"
ACTUAL_CSP=$(jq -r '.content_security_policy.extension_pages // empty' "$MANIFEST")
if [ "$ACTUAL_CSP" != "$EXPECTED_CSP" ]; then
    BUILD_ERRORS+=("content_security_policy.extension_pages is \"$ACTUAL_CSP\", expected \"$EXPECTED_CSP\"")
fi
[ "$(grep -o "'sha256-" <<<"$ACTUAL_CSP" | wc -l | tr -d ' ')" = "4" ] \
    || BUILD_ERRORS+=("the CSP must carry exactly the four safe-area probe hashes of spikes/extension-e2e")
if [ "$(jq '.content_security_policy | has("sandbox")' "$MANIFEST")" = "true" ]; then
    BUILD_ERRORS+=("unexpected content_security_policy.sandbox")
fi
# Inline <script> (without src) is refused by `script-src 'self'`; inline <style> and style="" by `style-src 'self'`.
while IFS= read -r -d '' html; do
    if grep -oE '<script[^>]*>' "$html" | grep -qv 'src='; then
        BUILD_ERRORS+=("${html#"$INSPECT_DIR"/}: inline <script>")
    fi
    if grep -qiE '<style|[[:space:]]style=' "$html"; then
        BUILD_ERRORS+=("${html#"$INSPECT_DIR"/}: inline style")
    fi
done < <(find "$INSPECT_DIR" -name '*.html' -print0)
# The service worker and every chunk it imports must not touch the DOM: a module service worker that evaluates
# `document.…` throws at registration.
SW=$(jq -r '.background.service_worker // empty' "$MANIFEST")
if [ -n "$SW" ] && [ -f "$INSPECT_DIR/$SW" ]; then
    while IFS= read -r f; do
        if grep -qE '\bdocument\.|createRoot|innerHTML' "$f"; then
            BUILD_ERRORS+=("the service worker loads DOM code: ${f#"$INSPECT_DIR"/}")
        fi
    done < <(walk_chunks "$(norm "$INSPECT_DIR/$SW")")
fi
# Live review is a stub: no Native Messaging code may ship before the permission and the companion exist.
NM_REFS=$(grep -rlE 'connectNative|sendNativeMessage|nativeMessaging' "$INSPECT_DIR" --include='*.js' 2>/dev/null || true)
[ -z "$NM_REFS" ] || BUILD_ERRORS+=("Native Messaging code shipped: $(echo "$NM_REFS" | tr '\n' ' ')")
if [ ${#BUILD_ERRORS[@]} -gt 0 ]; then
    fail "build invariants:"
    printf '  - %s\n' "${BUILD_ERRORS[@]}"
else
    pass "CSP as declared (default-src 'none' + the iframe pair); no inline scripts/styles; DOM-free service worker; no Native Messaging code"
fi

# Check 13: the editor module — one .wasm, the expected one, loaded by the editor page only
echo "Check 13: Editor module (one wasm, pinned by sha256, only in the editor page)..."
WASM_ERRORS=()
WASMS=()
while IFS= read -r -d '' w; do WASMS+=("$w"); done < <(find "$INSPECT_DIR" -name '*.wasm' -print0)
if [ ${#WASMS[@]} -ne 1 ]; then
    WASM_ERRORS+=("${#WASMS[@]} .wasm files shipped, expected exactly 1 (the editor module)")
elif [ ! -f "$REVIEW_WASM" ]; then
    WASM_ERRORS+=("$REVIEW_WASM is missing — cannot compare (run: pnpm --filter @extension/review-wasm ready)")
elif [ "$(sha256 "${WASMS[0]}")" != "$(sha256 "$REVIEW_WASM")" ]; then
    WASM_ERRORS+=("${WASMS[0]#"$INSPECT_DIR"/} is not packages/review-wasm/pkg/review_wasm_bg.wasm")
fi
GLUE_MARK='__wbindgen'
VIEWER_HAS=false
if [ -f "$INSPECT_DIR/$VIEWER_PAGE" ]; then
    while IFS= read -r f; do
        grep -q "$GLUE_MARK" "$f" && VIEWER_HAS=true
    done < <(walk_chunks $(page_scripts "$INSPECT_DIR/$VIEWER_PAGE"))
fi
$VIEWER_HAS || WASM_ERRORS+=("the editor page does not load the module's JS")
if [ -f "$INSPECT_DIR/$APP_PAGE" ]; then
    while IFS= read -r f; do
        if grep -q "$GLUE_MARK" "$f"; then WASM_ERRORS+=("the main page loads the editor module: ${f#"$INSPECT_DIR"/}"); fi
    done < <(walk_chunks $(page_scripts "$INSPECT_DIR/$APP_PAGE"))
fi
if [ ${#WASM_ERRORS[@]} -gt 0 ]; then
    fail "editor module:"
    printf '  - %s\n' "${WASM_ERRORS[@]}"
else
    pass "one wasm ($(wc -c < "${WASMS[0]}" | tr -d ' ') bytes, sha256 as packages/review-wasm/pkg); only the editor page loads it"
fi

# Check 14: licences of what the editor module embeds
echo "Check 14: Licences (gpui-kit, imara-diff, the fonts in the wasm, the pages' IBM Plex)..."
MISSING_LICENSES=()
for file in $REQUIRED_LICENSES; do
    [ -s "$INSPECT_DIR/licenses/$file" ] || MISSING_LICENSES+=("licenses/$file")
done
if [ ${#MISSING_LICENSES[@]} -gt 0 ]; then
    fail "missing licence files: ${MISSING_LICENSES[*]}"
else
    pass "licenses/: $REQUIRED_LICENSES"
fi

# Check 15: the start route's initial load — what a new tab loads before its first paint
echo "Check 15: Start route initial load (budget $START_ROUTE_BUDGET bytes, no lazy chunk)..."
START_ERRORS=()
static_chunks() {  # like walk_chunks, but static imports only: `import(` (a lazy chunk) is not followed
    local -a queue=("$@")
    local -A seen=()
    local f ref
    while [ ${#queue[@]} -gt 0 ]; do
        f="${queue[0]}"; queue=("${queue[@]:1}")
        [ -n "${seen[$f]:-}" ] && continue
        seen[$f]=1
        [ -f "$f" ] || continue
        printf '%s\n' "$f"
        while IFS= read -r ref; do
            queue+=("$(norm "$(dirname "$f")/$ref")")
        done < <(grep -oE '(from|import)[[:space:]]*["'"'"']\.{1,2}/[^"'"'"']+\.js["'"'"']' "$f" \
            | sed -E 's/^.*["'"'"'](\.{1,2}\/[^"'"'"']+)["'"'"']$/\1/')
    done
}
if [ -f "$INSPECT_DIR/$APP_PAGE" ]; then
    mapfile -t START_JS < <(static_chunks $(page_scripts "$INSPECT_DIR/$APP_PAGE") | sort -u)
    mapfile -t START_OTHER < <(grep -oE '<(script|link)[^>]*(src|href)="[^"]+\.(js|css)"' "$INSPECT_DIR/$APP_PAGE" \
        | sed -E 's/^.*(src|href)="([^"]+)"$/\2/' | while IFS= read -r ref; do
            case "$ref" in /*) norm "$INSPECT_DIR$ref" ;; *) norm "$(dirname "$INSPECT_DIR/$APP_PAGE")/$ref" ;; esac
        done | sort -u)
    mapfile -t START_FILES < <(printf '%s\n' "${START_JS[@]}" "${START_OTHER[@]}" | sort -u)
    START_BYTES=0
    for f in "${START_FILES[@]}"; do
        [ -f "$f" ] && START_BYTES=$((START_BYTES + $(wc -c < "$f")))
    done
    [ "$START_BYTES" -le "$START_ROUTE_BUDGET" ] \
        || START_ERRORS+=("the start route loads $START_BYTES bytes before its first paint, over the budget of $START_ROUTE_BUDGET")
    # Every chunk something imports lazily (`import("./x.js")`) must stay out of the initial load.
    mapfile -t LAZY < <(find "$INSPECT_DIR" -name '*.js' -print0 | xargs -0 grep -ohE 'import\([[:space:]]*["'"'"']\.{1,2}/[^"'"'"']+\.js["'"'"']' \
        | sed -E 's/^.*\/([^/"'"'"']+\.js)["'"'"']$/\1/' | sort -u)
    for f in "${START_FILES[@]}"; do
        for lazy in "${LAZY[@]}"; do
            [ "$(basename "$f")" = "$lazy" ] && START_ERRORS+=("the start route loads a lazy chunk up front: ${f#"$INSPECT_DIR"/}")
        done
        grep -q '__wbindgen' "$f" 2>/dev/null && START_ERRORS+=("the start route loads the editor module: ${f#"$INSPECT_DIR"/}")
    done
else
    START_ERRORS+=("$APP_PAGE is missing")
fi
if [ ${#START_ERRORS[@]} -gt 0 ]; then
    fail "start route:"
    printf '  - %s\n' "${START_ERRORS[@]}"
else
    pass "the start route loads ${#START_FILES[@]} files, $START_BYTES bytes (budget $START_ROUTE_BUDGET), no lazy chunk (${#LAZY[@]} kept lazy)"
fi

# Check 16: the toolbar popup stays light — it opens on every click of the button
if [ -n "$TOOLBAR_POPUP" ]; then
    echo "Check 16: Toolbar popup (budget $POPUP_BUDGET bytes; no main-page or editor script, no React, no wasm)..."
    POPUP_ERRORS=()
    POPUP_HTML="$INSPECT_DIR/$TOOLBAR_POPUP"
    if [ -f "$POPUP_HTML" ]; then
        mapfile -t POPUP_JS < <(walk_chunks $(page_scripts "$POPUP_HTML") | sort -u)
        mapfile -t POPUP_FILES < <({
            printf '%s\n' "${POPUP_JS[@]}" "$(norm "$POPUP_HTML")"
            grep -oE '<(script|link)[^>]*(src|href)="[^"]+\.(js|css)"' "$POPUP_HTML" \
                | sed -E 's/^.*(src|href)="([^"]+)"$/\2/' | while IFS= read -r ref; do
                    case "$ref" in /*) norm "$INSPECT_DIR$ref" ;; *) norm "$(dirname "$POPUP_HTML")/$ref" ;; esac
                done
        } | sort -u)
        POPUP_BYTES=0
        for f in "${POPUP_FILES[@]}"; do
            [ -f "$f" ] && POPUP_BYTES=$((POPUP_BYTES + $(wc -c < "$f")))
        done
        [ "$POPUP_BYTES" -le "$POPUP_BUDGET" ] \
            || POPUP_ERRORS+=("the popup loads $POPUP_BYTES bytes, over the budget of $POPUP_BUDGET")
        # The other pages' own entry scripts (shared small chunks — the theme store, the logger — are fine).
        OTHER_ENTRIES=$(for page in "$APP_PAGE" "$VIEWER_PAGE"; do
            grep -oE '<script[^>]*src="[^"]+\.js"' "$INSPECT_DIR/$page" 2>/dev/null | grep 'type="module"' \
                | sed -E 's/^.*src="([^"]+)"$/\1/' | while IFS= read -r ref; do norm "$INSPECT_DIR$ref"; done
        done)
        for f in "${POPUP_JS[@]}"; do
            grep -qxF "$f" <<<"$OTHER_ENTRIES" && POPUP_ERRORS+=("the popup loads another page's script: ${f#"$INSPECT_DIR"/}")
            grep -q '__wbindgen' "$f" && POPUP_ERRORS+=("the popup loads the editor module: ${f#"$INSPECT_DIR"/}")
            grep -q 'react.transitional.element' "$f" && POPUP_ERRORS+=("the popup loads React: ${f#"$INSPECT_DIR"/}")
        done
    else
        POPUP_ERRORS+=("$TOOLBAR_POPUP is missing")
    fi
    if [ ${#POPUP_ERRORS[@]} -gt 0 ]; then
        fail "toolbar popup:"
        printf '  - %s\n' "${POPUP_ERRORS[@]}"
    else
        pass "the popup loads ${#POPUP_FILES[@]} files, $POPUP_BYTES bytes (budget $POPUP_BUDGET); no main-page or editor script, no React, no wasm"
    fi
else
    echo "Check 16: Toolbar popup — the button '$TOOLBAR_ID' has none (Check 9 holds that none ships)"
fi

# Summary
echo ""
echo "=============================================="
echo "Summary"
echo "=============================================="
echo "Build: $BUILD_PATH"
echo "Extension: $ACTUAL_NAME $MANIFEST_VERSION"
echo ""
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ BUILD VALIDATION PASSED${NC}"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ BUILD VALIDATION PASSED WITH WARNINGS ($WARNINGS)${NC}"
    exit 0
else
    echo -e "${RED}✗ BUILD VALIDATION FAILED — errors: $ERRORS, warnings: $WARNINGS${NC}"
    echo "Do not load or ship this build. Rebuild with: pnpm build"
    exit 1
fi
