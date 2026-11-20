//! The `LineDiffer` seam: which lines changed between two texts.
//!
//! An implementation compares the editor's lines ([`crate::lines`]) byte for byte and returns the hunks in order:
//! a run of removed and/or added lines between two unchanged lines (or an end of the text) is one hunk. Every
//! implementation passes the same contract suite (`contract.rs`, run against each built-in).
//!
//! Built in: [`HistogramLineDiffer`] (the default) and [`MyersLineDiffer`], both from `imara-diff`. A variant that is
//! not built in is another implementation of the trait, injected through the view's builder.

use std::sync::Arc;

use imara_diff::{Algorithm, Diff, InternedInput};

use crate::{
    hunks::{HunkKind, LineHunk},
    lines::{editor_line_count, editor_lines},
};

pub trait LineDiffer: Send + Sync {
    /// The name the host uses to pick this implementation as data (`{"lineDiffer": "histogram"}`).
    fn name(&self) -> &str;

    /// The hunks that turn `old` into `new`, in order, in the editor's lines.
    fn line_hunks(&self, old: &str, new: &str) -> Vec<LineHunk>;
}

/// The default: the Histogram algorithm (git's `--histogram`, a patience diff that anchors on rare lines), which
/// tends to keep a changed block whole instead of matching stray braces and blank lines inside it.
#[derive(Clone, Copy, Debug, Default)]
pub struct HistogramLineDiffer;

impl LineDiffer for HistogramLineDiffer {
    fn name(&self) -> &str {
        "histogram"
    }

    fn line_hunks(&self, old: &str, new: &str) -> Vec<LineHunk> {
        imara_line_hunks(Algorithm::Histogram, old, new)
    }
}

/// Myers' algorithm with git's heuristics: git's default `diff`, the same hunks `git diff` gives in most files.
#[derive(Clone, Copy, Debug, Default)]
pub struct MyersLineDiffer;

impl LineDiffer for MyersLineDiffer {
    fn name(&self) -> &str {
        "myers"
    }

    fn line_hunks(&self, old: &str, new: &str) -> Vec<LineHunk> {
        imara_line_hunks(Algorithm::Myers, old, new)
    }
}

/// Every built-in implementation; the host names one of them in a request's options.
pub fn built_ins() -> [Arc<dyn LineDiffer>; 2] {
    [Arc::new(HistogramLineDiffer), Arc::new(MyersLineDiffer)]
}

fn imara_line_hunks(algorithm: Algorithm, old: &str, new: &str) -> Vec<LineHunk> {
    let mut input = InternedInput::default();
    input.reserve(editor_line_count(old) as u32, editor_line_count(new) as u32);
    input.update_before(editor_lines(old));
    input.update_after(editor_lines(new));
    let mut diff = Diff::compute(algorithm, &input);
    // Slides ambiguous hunks the way git's indent heuristic does, so that a block starts and ends where a reader
    // expects it to.
    diff.postprocess_lines(&input);
    diff.hunks()
        .map(|hunk| {
            let removed = &input.before[hunk.before.start as usize..hunk.before.end as usize];
            let mut old_text = String::new();
            for &token in removed {
                old_text.push_str(input.interner[token]);
                old_text.push('\n');
            }
            let old_lines = hunk.before.end - hunk.before.start;
            let lines = hunk.after.end - hunk.after.start;
            LineHunk {
                kind: HunkKind::of(old_lines, lines),
                start: hunk.after.start,
                lines,
                old_start: hunk.before.start,
                old_lines,
                old_text,
            }
        })
        .collect()
}

#[cfg(test)]
mod contract;
