# editor: lay out the rows in view at the end of a document with spacer rows

`editor-scroll-end-with-spacers.patch` applies to `land-next` at `0209cf10e0270aeaf381895608432c5b954dab8e`
(`git apply`); the local branch `fix/editor-scroll-end-with-spacers` holds the same change.

## What was wrong

An editor with spacer rows, scrolled to the end of a long document, draws too few of its last lines, or none. The
fewer rows the viewport holds compared with the spacer rows, the more is missing: a viewport whose last screen is
covered by spacer rows anywhere in the document (above the first line, between lines, or near the end) shows a blank
editor at the end. Scrolling there by wheel, scroll bar or keyboard is the same; the scroll offset itself is right.

## Cause

`crates/base/src/input/base/element.rs`. Prepaint sizes the scroll height from every wrapped row **and every spacer
row** (`total_wrapped_lines`, line 3915 at the base revision), and `layout_cursors` clamps the scroll offset to that
height. `calculate_visible_range` clamps the same offset again, so that it lays out the rows it paints, but against a
height without the spacer rows (`let total_lines = state.display_map.wrap_row_count();`, line 1634). Near the end the
second clamp moves the offset up by the height of all the spacer rows, and the visible range is computed for a viewport
that many rows above the one painted: the rows painted at the bottom are never laid out.

Upstream `main`, which has no spacers, uses `wrap_row_count()` in both places; the spacer change added the spacer rows
to the scroll height only.

## Fix

One function, `scroll_rows`, gives the rows the scroll height is made of (wrapped rows plus spacer rows); prepaint and
`calculate_visible_range` both use it, so the two clamps cannot drift apart again. Without spacers nothing changes.

## How it was verified

- New test `the_rows_in_view_are_laid_out_at_the_end_past_many_spacer_rows`: an editor in a 240 x 140 window scrolled
  past the end, with twelve spacer rows above the first line, above a line near the end, below the last line, and
  split in two; soft wrap off and on. It checks that the line of every row in the viewport is laid out, the last line's
  included. Before the fix it fails in every case but spacers below the last line (for example spacers above the first
  line: lines 22-25 are in view, lines 11-18 are laid out); after it, it passes.
- `cargo test -p gpui-base`: 1 807 unit tests and the integration tests pass.
- `rustfmt --check` on the changed file: clean. `cargo clippy -p gpui-base --all-targets -- -D warnings` reports one
  `redundant_clone` in `crates/base/src/text/inline.rs:2180`, which the base revision has as well; nothing in the
  changed file.
- In an application with two editors kept level by spacers (50 000 lines, 150 changes), natively on macOS and in the
  browser (wasm): before the fix the end of the document is blank or stops 13 lines short; after it both editors draw
  their last line, level.
