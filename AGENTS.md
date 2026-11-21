# AGENTS.md

Shared rules for coding agents working in this repository. Keep project rules here; `CLAUDE.md` imports this file.

What the product is, what is decided and what is open: `README.md`, `docs/decisions.md`, `docs/roadmap.md`. How the
extension workspace is laid out, built and checked: `docs/extension-structure.md`. The style package and its contract:
`packages/dna/README.md`. Do not change a decision recorded in `docs/decisions.md` without updating the document.

## Replaceable Behavior: Defaults Are Not Hard-Coded

Adopted from the owner's grid project (decision D13). An IDE treats "how to compare" and "what to highlight" as
policies the user or the product can switch — IntelliJ has a comparison policy, a highlight policy and several diff
tools behind one request. We build the same way: most behaviors of the comparison part were settled by accepting a
default, not by a final product decision. Treat every such default as **the first implementation of a replaceable
behavior**.

- **When it applies.** A behavior gets a seam if `docs/decisions.md` marks it as open or as an accepted default, or if
  a reviewer can name a second reasonable variant (another diff algorithm, another way to detect the language, another
  source of the texts).
- **Where a seam lives.** The comparison itself — which lines and words changed, what counts as equal, what is
  highlighted, folded or dimmed, how the sides are laid out, how code is coloured — lives in **Rust, inside the wasm
  module**: the editor owns the text, the syntax trees and the layout, and the same crate serves the native viewer.
  The TypeScript shell has seams only for what needs the browser: where the two texts come from, how a file of the
  package is fetched, where the theme choice is stored. The shell never re-implements a behavior that exists in Rust.
- **What the seam looks like.**
  - Rust: a trait named after the role and a default implementation next to it, injected through the builder of the
    review view (`with_<seam>(…)`); a `…Factory` trait when construction needs context. The builder is the composition
    root of the comparison.
  - TypeScript (shell seams only): an interface and a default implementation next to it. The choice is made in one
    place, the composition root of the part (a `behaviors.ts` in the part's directory, e.g.
    `extension/src/compare/behaviors.ts`, created with the part's first shell seam), and reaches components as a prop
    or an argument. A component imports the interface, never a concrete implementation.
  - Across the wasm boundary the shell passes **data**: the two texts and options that name built-in variants
    (`{ "lineDiffer": "histogram", "comparisonPolicy": "ignore-whitespace" }`). Never code, never a library's types. A
    variant that is not built in is written in Rust.
- **What is forbidden instead:**
  - hard-coded branches on "which variant";
  - boolean flags that grow into modes;
  - a `switch` / `match` on a mode enum spread across modules;
  - a component that imports a concrete implementation.
- **Built-in vs. pluggable.** The behavior people expect from an IDE is built in and is the default. Alternatives ship
  as more implementations of the same interface. A seam is not a setting: it becomes one only when a decision says the
  user chooses.
- **Patterns.** Strategy and Factory for behaviors; dependency injection through props, arguments and builders;
  composition over inheritance. One seam per behavior — do not build one "plugin registry" that knows everything.
- **Asynchronous from day one.** A seam whose implementation may live in wasm, in a worker or on the local server
  returns a `Promise` even when the first implementation is synchronous, and accepts an `AbortSignal` when the work can
  outlive the input that started it.
- **Hot path stays fast.** A strategy runs once per comparison, per file or per frame — not per line, token or
  character. Cross the wasm boundary in batches. In Rust, strategies called per line use static dispatch (a generic
  parameter, or an enum of built-ins plus `Custom(Arc<dyn …>)`).
- **Documented and tested.** Every seam is a row of `docs/replaceable-behaviors.md`; adding or changing one updates the
  table in the same change. The default implementation has tests. All implementations of one seam pass the same
  contract tests (one shared suite, run against each).
- **Names.** After the role, no `Kind` / `Mode` / `Type` suffix: `LineDiffer`, `InlineDiffer`, `ComparisonPolicy`,
  `LanguageDetector`, `GrammarSource`.

## Tools: Independent, Reusable Logic and Components

Decision D14. Every tool of the "Tools" section is built to be reused outside the extension, so a tool is never a part
of the extension app. The extension is one **host** of the tools; another application of the owner — the product site,
for example — can be a second one without changing a tool.

- **A tool is two independent workspace packages, in two folders by layer:**
  - `packages/tools/logic/<id>/` (`@workspace/tool-logic-<id>`) — pure TypeScript: no React, no `chrome.*`, no DOM
    unless the specification says the tool cannot work without one (then the `Document` comes in as a parameter). It
    depends on nothing of ours except `packages/tools/logic/shared/`. Unit tests run in Node.
  - `packages/tools/ui/<id>/` (`@workspace/tool-ui-<id>`) — the React component and the tool's definition (`id`,
    `title`, `summary`, `keywords`, `detect`). It imports its own logic package, the UI kit and the style package.
- **Shared packages:** `packages/tools/logic/shared/` (`@workspace/tools-shared`: randomness, time, hex, Base64, the
  JSON scanner, DER — pure code), `packages/tools/ui/host/` (`@workspace/tools-host`: the host contract and shared
  hooks), `packages/ui/` (`@workspace/ui`: the components), `packages/dna/` (`@workspace/dna`: styles).
- **What a tool never imports:** another tool, in either layer; anything from `extension/` or any `@extension/*`
  package (the logger, the theme store, the router included); `chrome.*`; a file of another package that is not one of
  its `exports`. A logic package never imports a `ui` package.
- **What comes from the host comes through an interface.** Persisting options, navigation to another section, logging
  — whatever depends on where the tool runs — is a member of the `ToolHost` interface in `@workspace/tools-host`, passed
  to the component, with a default that needs no host (in memory, no-op). This is the "Replaceable Behavior" rule
  applied to the host: the extension's composition root supplies the implementation. A tool rendered with no host at
  all must work.
- **The host owns** the list of tools, the routes, storage, the manifest and the content security policy. It finds the
  tools itself: `extension/src/tools/registry.ts` takes `definition` from every `packages/tools/ui/*/src/definition.ts`
  (the `ui` package's main export: `id`, `title`, `summary`, `keywords`, `order` — the tool's number in
  `docs/tools/README.md` — `detect`, its `history` declaration, and `load` for the component, a chunk of its own), so a
  new tool is new files only and edits no list. The host wraps every tool in the kit's `ToolPage` (title, summary, its
  history line); the tool's component renders the body from the kit's tool parts. A tool's worker, data file or wasm
  ships inside the tool's package and is loaded from a file, never from `blob:` or `data:`.
- **Scopes say who may use what:** `@workspace/*` packages are reusable and never depend on `@extension/*`;
  `@extension/*` packages belong to the extension.
- **Enforcement** is by folder: `no-restricted-imports` in `eslint.config.js` on `packages/tools/logic/**` (no React,
  no DOM or UI libraries, no DOM globals, no `ui`, no other tool, no `@extension/*`) and on each
  `packages/tools/ui/<id>/**` (its own logic only, no other tool, no `@extension/*`, no history core; the blocks are
  generated from the folders); a logic package's `tsconfig.json` leaves the DOM library out; and
  `extension/src/tools/shape.test.ts` fails when a tool package breaks the shape (names, exports, the definition, imports
  outside its package). The workspace stays on pnpm + Turborepo; Nx is not adopted (what it would take is recorded in
  `docs/tools/README.md`).
- **The site is a separate repository** and does not consume these packages yet. How they would reach it — the site
  joining this workspace as a second app, a git dependency on a subfolder, or publishing — is not chosen; nothing in a
  tool may assume one of them.
- **Adding a tool:** `node scripts/new-tool.mjs <id> --order=<n> …` creates both packages and the tool's e2e module
  (`scripts/e2e-tools/<id>.mjs`, run by `scripts/e2e-check.mjs` without an edit) from one template; the steps from a
  specification to a finished tool, the tests it needs and the shared files it may touch are `docs/tools/adding-a-tool.md`.
  The reference is the JSON tool: `packages/tools/logic/json/` and `packages/tools/ui/json/`.
- **Specifications written before this rule** name `extension/src/tools/<id>/` and `extension/src/tools/shared/`. Read
  `logic.ts` and its tests as `packages/tools/logic/<id>/src/`, the component as `packages/tools/ui/<id>/src/`, shared
  pure code (`shared/random.ts`, `time.ts`, `hex.ts`, `base64.ts`) as `@workspace/tools-shared/<module>`, the shared hook
  `useNow` as `@workspace/tools-host`, and the components of `extension/src/components/ui/` as `@workspace/ui/<name>`
  (`packages/ui/`). Where `docs/tools/README.md` resolves a disagreement between specifications, it wins.

## Dependencies

Install only from the public npm registry. The root `.npmrc` sets it; never remove it, never read or change the global
`~/.npmrc`, and run every install from the project directory. No git hooks manager (husky, lint-staged).

## No Agent Attribution

Commits, pull requests, tags and release notes carry no AI or agent attribution of any kind: no `Co-Authored-By:`
trailer for a model or an agent, no "Generated with …" line. Code and documents of the extension do not mention AI
tools.

## Repositories

Decision D15. The project's code name is `devtab-dev` (domain `devtab.dev`); it is three repositories named
after it, and a clone of this one has only the first:

- **This repository — `devtab-dev-extension`**: `extension/`, `packages/`, `crates/`, `vendor/gpui-kit/`, the
  scripts and the rules. It may become public: nothing private is ever committed here (see "Commits").
- **The developer documents, `devtab-dev-docs`** — decisions, the plan, research, the tool specifications,
  screenshots and the experiments (`docs/spikes/`) — are a private repository of their own that lives in `docs/`
  and is not part of this one. `.gitignore` keeps out `docs` and `spikes` (a link to `docs/spikes`, so the paths `spikes/…` resolve); the
  pre-commit hook refuses them too, so never `git add -f` them. Commit documents in `docs/` itself.
  `scripts/docs-checkout.sh` clones them once the repository has a remote (it has none yet; the script says so and
  stops) and, in a linked worktree, links `docs` to the main working copy's `docs/`.
- **The product site, `devtab-dev-site`,** is a separate repository and shares nothing with this one yet.

This repository installs, lints, type-checks, builds, tests and passes `pnpm test:e2e` without `docs/`. Nothing in
the build, the tests or the scripts reads or writes `docs/` or `spikes/` by default: screenshots go only where
`--shots=<dir>` says, and a check that compares with an experiment's output runs only when that output is there. A
`docs/…` or `spikes/…` path in a comment names a document you may not have.

## Commits

Adopted from the owner's grid project. The hooks are plain git hooks in `.githooks/`, no hooks manager:

- **Once per clone:** `scripts/install-hooks.sh` sets `core.hooksPath`, creates
  `<git common dir>/info/privacy-patterns` (one extended regular expression per line, matched without case; never
  committed) and tells whether gitleaks is there. Then set the clone's own identity: `git config user.name …`,
  `git config user.email …`, and `git config commit.gpgsign false`. Never commit under the global identity, never
  use `--author`, never enable signing with another key. The documents repository has the same hooks of its own
  (`docs/scripts/install-hooks.sh`).
- **pre-commit** refuses local-only files (`docs`, `spikes`, `.env`, `CLAUDE.local.md`, `.claude/settings*.json`),
  added lines with an absolute home path, the global git address or a private pattern, an author with the global
  address, and secrets (gitleaks with `.gitleaks.toml`; without gitleaks the commit is refused). **commit-msg**
  refuses agent attribution and private patterns. **pre-push** repeats the secret and private-data scan on every
  commit that leaves the machine.
- **Never committed here:** build output (`node_modules`, `dist`, every `target/`, `.state/`, the prebuilt module
  in `packages/review-wasm/pkg` and `crates/review-wasm/pkg`, logs), `.env`, personal agent settings, and private
  data: a person's name or address, an employer, a machine's name, a path into a home directory, the names of the
  owner's other products, the owner's own words.
- **Messages** are in English. The subject is `area: Sentence` — the area is a folder or part (`extension`,
  `crates`, `dna`, `scripts`, `agents`, …), the sentence starts with a capital letter and has no full stop. The body,
  when there is one, says why.
- **Language:** code, comments, `AGENTS.md`, `README.md` and commit messages are in English; the developer documents
  are in Russian.
