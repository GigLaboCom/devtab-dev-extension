# highlighter: tree-sitter 0.27, built for WebAssembly

`tree-sitter-wasm.patch` is upstream pull request
[longbridge/gpui-kit#4006](https://github.com/longbridge/gpui-kit/pull/4006), "highlighter: Bump tree-sitter to 0.27
and build it for WebAssembly" (branch `glani:tree-sitter-wasm`), as it applies to the pinned commit of `main`.

## What it changes

- `tree-sitter` 0.26 → 0.27.2 (`QueryMatch::captures` became a method; `tree-sitter-md` 0.5.4), and the portable
  clock (`instant::Instant`) for the highlighter's parse budgets.
- On `wasm32-unknown-unknown`: the language registry is kept per thread, the Diff component prepares highlighting on
  the foreground executor, and `tree-sitter` with 27 of its 35 grammars is available. Eight grammars stay native-only
  because their crates do not build for wasm: bash, c, c-sharp, cmake, cpp, lua, sequel (SQL), swift.
- A build for wasm with tree-sitter needs a C compiler with the wasm32 target and `llvm-ar`; the pull request adds
  `script/wasm-cc-env` to set them up. Builds without the `tree-sitter` feature (ours ships `syntect`) need nothing.
- Also in the pull request, unused here: a CI job, documentation, the web gallery's `tree-sitter` feature, and a
  `[patch.crates-io]` for `tree-sitter-navi` in gpui-kit's own workspace (it does not reach this workspace).

## How it is made

Not the pull request's diff as GitHub shows it: `vendor/gpui-kit/bump.sh` fetches the pull request's head
(`refs/pull/4006/head`) into the generated checkout, merges it onto the pinned commit there (conflicts resolved once are
replayed from `vendor/gpui-kit/rr-cache/`), and writes the difference that merge made. So the patch is the pull
request's change rebased onto our `main` commit whatever its branch is based on; the block below records how it went.
One patch, not one per commit: the branch carries merges of `main`, so its commits replayed one by one would meet the
conflicts those merges already resolved.

## When to delete it

When #4006 is merged into `main`: `bump.sh` sees it merged and drops this file, its note and its manifest line by
itself. If #4006 is closed without merging, `bump.sh` stops and the change needs a decision (docs/editor-base.md).

<!-- bump.sh: generated, do not edit by hand -->
- pull request: `4006` https://github.com/longbridge/gpui-kit/pull/4006
- head: `83eab95de85f1affa7988b8833d12dc8e4be25ca` — the pull request's head its commits were taken from
- base: `f807c1b2c49ef25ddfbe73e465e33b8a5fa5632e` — the commit of upstream main they were rebased onto
- rebase: `resolved by the recorded resolution: crates/component/src/highlighter/highlighter.rs (891deea2bb62)`
- commits: `8` — rebased onto the base (merge commits of the pull request's branch left out)
- tip: `e1c1cfad0a5b22b350870a35bc5529c8dc0b585b` — the rebased branch after them, tree `58065d2bd450bf348b85da5df7b7db345836d101`
- made: `2026-11-26` by vendor/gpui-kit/bump.sh
<!-- /bump.sh -->
