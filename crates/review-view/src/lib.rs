//! The review view: two texts compared line by line and shown side by side in two aligned editors.
//!
//! One crate for the comparison and its display, built for the browser (`review-wasm`) and natively. Every behavior
//! that has, or may get, a second variant is a seam: a trait named after its role with the default implementation
//! next to it, injected through the view's builder (`ReviewView::builder().with_line_differ(…)`), the composition
//! root of the comparison. The table of seams is `docs/replaceable-behaviors.md`.
//!
//! - [`lines`]: what a line is (the editor's lines);
//! - [`hunks`]: the hunks the view draws, in OpenIDEA's `vcs_line_hunks` shape;
//! - [`line_differ`]: the `LineDiffer` seam and its built-in implementations;
//! - [`compare`]: the implementations one comparison runs with, and options naming built-ins as data;
//! - [`alignment`]: the blank rows that keep both sides level;
//! - [`sides`]: which side the user may edit and whether its text moved away from what was loaded or saved;
//! - `view` (feature `view`, gpui): the view itself — read-only by default, a side editable on request, the comparison
//!   following the edits;
//! - [`grammars`] (feature `grammar-files`): tree-sitter grammars that arrive as files while the page runs, checked,
//!   registered with gpui-kit's highlighter and repainted into the open text.
//!
//! Everything but the view is free of gpui: `cargo test --no-default-features` checks the seams without building it.

pub mod alignment;
pub mod compare;
pub mod hunks;
pub mod line_differ;
pub mod lines;
pub mod sides;

#[cfg(feature = "view")]
mod diff_view;
#[cfg(feature = "grammar-files")]
pub mod grammars;
#[cfg(feature = "view")]
mod view;

// The native platform is the `window` example's; naming it here keeps the manifest's unused-dependency lint quiet.
#[cfg(all(feature = "window-example", not(target_family = "wasm")))]
use gpui_platform as _;

pub use alignment::DiffSide;
pub use compare::{CompareOptions, Comparison, UnknownVariant};
pub use hunks::{DiffStats, HunkKind, LineHunk};
pub use line_differ::{HistogramLineDiffer, LineDiffer, MyersLineDiffer};
pub use sides::{SideState, Sides};
#[cfg(feature = "view")]
pub use view::{DiffDocument, RECOMPARE_DELAY, ReviewEvent, ReviewView, ReviewViewBuilder, Shown, ShownCause, Texts};
