# devtab-dev-extension

The code repository of devtab-dev (the project's code name; the domain is devtab.dev): a Chrome extension
(Manifest V3) with three parts:

- **Compare code**: two texts or two files side by side in a real code editor — the gpui-kit editor compiled to
  WebAssembly. Files are dropped or opened, text is pasted or typed; each side is read-only until switched to edit
  mode, and saved on request. The comparison itself runs in Rust inside the module, following the edits. Works
  offline, with nothing else installed.
- **Tools**: offline developer tools in React (JSON so far), each a pair of reusable packages (its logic and its
  component) that the extension finds by itself; what a tool keeps is in the local, optional tool history.
- **Live review**: reviewing local changes through a companion app on macOS. Not built yet; the page says so.

Its main page is also the browser's New Tab page: a start page with one field that finds the extension's tools,
opens pasted text in the tool that recognises it and otherwise searches the web through Chrome's search API, with
tiles for the user's shortcuts, the tools and (optional) most visited sites. Every part of it can be switched off in
Settings, which is also the extension's options page.

The extension's button on Chrome's toolbar opens a small menu: a new tab, Tools, Compare code, History and Settings. What the button does is
chosen in one line (`extension/src/toolbar/index.ts`); the other choice — a click opens a new tab, no menu — builds an
extension without the menu's page.

The name shown to users is DevTab.Dev. It lives in one place, `extension/product.json`.

## Layout

| Path | What |
|---|---|
| `extension/` | the extension itself: manifest source, the main page, the editor page, the toolbar menu's popup page, the service worker |
| `packages/` | workspace packages: `dna` (styles and tokens), `ui` (the components), `tools/logic/*` and `tools/ui/*` (each tool's logic and component, the shared tool code and the tools' host contract), `theme`, `review-wasm` (the editor module's host), `env`, `logger`, `hmr`, `tsconfig` |
| `crates/` | the Rust workspace: `review-view` (comparison and view) and `review-wasm` (the browser module) |
| `vendor/gpui-kit/` | patches on top of the pinned gpui-kit revision and the script that applies them |
| `vendor/openidea-server/` | the SHA-256 pin of the companion's server binary (the binary is not stored) |
| `scripts/`, `bash-scripts/` | build checks, packaging, e2e (a module per tool in `scripts/e2e-tools/`), icons, git hooks, the documents checkout, `new-tool.mjs` (starts a tool from the template) |

## Build and check

Node 22 and pnpm (through corepack, `packageManager` in `package.json`). Packages come only from the public npm
registry: the root `.npmrc` sets it.

```sh
crates/review-wasm/build.sh   # the editor module (Rust 1.100.0 with wasm32-unknown-unknown; a cold build takes minutes)
pnpm install
pnpm check                    # lint, format, type-check, build, unit tests, build checks (dist/)
pnpm e2e:setup                # once: Playwright and Chrome for Testing under .state/
pnpm test:e2e                 # the built extension in Chrome for Testing without a window
pnpm package                  # a checked zip in dist-zip/
```

`scripts/validate-build.sh` needs bash 4 or newer, `jq`, `node` and `unzip`. Load the extension from `dist/` in
`chrome://extensions` (developer mode, "Load unpacked").

## Developer documents

The project has three repositories: this one, `devtab-dev-docs` and the product site, `devtab-dev-site`.
Decisions, the plan, research, the tool specifications, screenshots and the experiments are `devtab-dev-docs`, a
private repository that lives in `docs/` and is not part of this one (`.gitignore`). Everything here installs, builds and
passes its checks without it; a `docs/…` or `spikes/…` path in a comment names a document of `devtab-dev-docs`.
`scripts/docs-checkout.sh` puts it in place once it has a remote.

## Contributing

Rules: [`AGENTS.md`](AGENTS.md). Run `scripts/install-hooks.sh` once per clone: the hooks refuse secrets, private
data and agent attribution in commits and pushes, and need [gitleaks](https://github.com/gitleaks/gitleaks).

## Licence

No licence has been chosen yet.
