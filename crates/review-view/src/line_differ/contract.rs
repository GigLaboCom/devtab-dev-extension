//! The contract of the `LineDiffer` seam: one suite, run against every implementation.
//!
//! Each case checks the exact hunks where any correct line diff gives the same answer, and every result goes through
//! [`assert_valid`]: hunks in order and maximal, ranges inside the editor's lines, the unchanged lines equal on both
//! sides, `old_text` exactly the removed lines. Cases ported from the shell's former `lineDiff.test.ts` (jsdiff) keep
//! their names.

use super::{LineDiffer, built_ins};
use crate::{
    hunks::{DiffStats, HunkKind, LineHunk},
    lines::{editor_line_count, editor_lines},
};

/// One `#[test]` per case and implementation, so a failure names both.
macro_rules! contract_tests {
    (implementations: [$($implementation:ident => $differ:expr),+ $(,)?], cases: $cases:tt $(,)?) => {
        /// The implementations the suite runs against, by name.
        const COVERED: &[&str] = &[$(stringify!($implementation)),+];
        $(
            mod $implementation {
                use super::cases;
                fn differ() -> impl crate::line_differ::LineDiffer {
                    $differ
                }
                contract_tests!(@cases $cases);
            }
        )+
    };
    (@cases [$($case:ident),+ $(,)?]) => {
        $(
            #[test]
            fn $case() {
                cases::$case(&differ())
            }
        )+
    };
}

contract_tests! {
    implementations: [
        histogram => crate::line_differ::HistogramLineDiffer,
        myers => crate::line_differ::MyersLineDiffer,
    ],
    cases: [
        both_texts_empty,
        identical_texts,
        one_side_empty,
        the_empty_text_is_one_empty_line,
        no_trailing_newline_on_either_side,
        only_the_trailing_newline_differs,
        no_trailing_newline_and_a_changed_last_line,
        crlf_against_lf,
        non_ascii_text,
        change_at_the_first_line,
        change_at_the_last_line,
        insertion_between_lines,
        deletion_keeps_the_removed_lines,
        removed_then_added_is_one_modification,
        same_hunks_as_git_on_the_example,
        large_input_with_scattered_changes,
    ],
}

#[test]
fn every_built_in_runs_the_contract() {
    let names: Vec<String> = built_ins().iter().map(|d| d.name().to_owned()).collect();
    assert_eq!(names, COVERED);
}

fn added(start: u32, lines: u32, old_start: u32) -> LineHunk {
    LineHunk {
        kind: HunkKind::Added,
        start,
        lines,
        old_start,
        old_lines: 0,
        old_text: String::new(),
    }
}

fn deleted(start: u32, old_start: u32, old_text: &str) -> LineHunk {
    LineHunk {
        kind: HunkKind::Deleted,
        start,
        lines: 0,
        old_start,
        old_lines: old_text.matches('\n').count() as u32,
        old_text: old_text.into(),
    }
}

fn modified(start: u32, lines: u32, old_start: u32, old_text: &str) -> LineHunk {
    LineHunk {
        kind: HunkKind::Modified,
        start,
        lines,
        old_start,
        old_lines: old_text.matches('\n').count() as u32,
        old_text: old_text.into(),
    }
}

/// The differ's hunks, after checking that they are a valid answer for these texts.
fn hunks(differ: &dyn LineDiffer, old: &str, new: &str) -> Vec<LineHunk> {
    let hunks = differ.line_hunks(old, new);
    assert_valid(old, new, &hunks);
    hunks
}

/// What every implementation's hunks must satisfy, whatever lines it chose to match.
fn assert_valid(old: &str, new: &str, hunks: &[LineHunk]) {
    let old_lines: Vec<&str> = editor_lines(old).collect();
    let new_lines: Vec<&str> = editor_lines(new).collect();
    assert_eq!(old_lines.len(), editor_line_count(old));
    let (mut old_at, mut new_at) = (0usize, 0usize);
    for (index, h) in hunks.iter().enumerate() {
        let (old_start, new_start) = (h.old_start as usize, h.start as usize);
        assert!(h.lines + h.old_lines > 0, "hunk {index} is empty: {h:?}");
        assert_eq!(h.kind, HunkKind::of(h.old_lines, h.lines), "hunk {index} kind");
        assert!(
            old_start >= old_at && new_start >= new_at,
            "hunk {index} out of order: {h:?}"
        );
        // The unchanged lines before this hunk pair up one to one, and there is at least one between two hunks:
        // a hunk is a maximal run of changed lines.
        assert_eq!(
            old_start - old_at,
            new_start - new_at,
            "hunk {index}: unchanged lines before it differ in number"
        );
        assert!(
            index == 0 || old_start > old_at,
            "hunk {index} touches the previous one"
        );
        for k in 0..old_start - old_at {
            assert_eq!(
                old_lines[old_at + k],
                new_lines[new_at + k],
                "unchanged line before hunk {index}"
            );
        }
        old_at = old_start + h.old_lines as usize;
        new_at = new_start + h.lines as usize;
        assert!(
            old_at <= old_lines.len() && new_at <= new_lines.len(),
            "hunk {index} past the end: {h:?}"
        );
        let removed: String = old_lines[old_start..old_at]
            .iter()
            .map(|line| format!("{line}\n"))
            .collect();
        assert_eq!(h.old_text, removed, "hunk {index}: old_text is not the removed lines");
    }
    assert_eq!(
        old_lines.len() - old_at,
        new_lines.len() - new_at,
        "unchanged lines after the last hunk"
    );
    assert_eq!(
        old_lines[old_at..],
        new_lines[new_at..],
        "unchanged lines after the last hunk"
    );
}

/// `git diff -U0`'s hunks (the editor's example was made with git). For an empty side git prints the 1-based number
/// of the preceding line, which is the 0-based index of the line that follows the gap.
fn parse_zero_context_diff(diff: &str, old_text: &str) -> Vec<LineHunk> {
    fn range(spec: &str) -> (u32, u32) {
        let (start, len) = match spec.split_once(',') {
            Some((s, l)) => (s.parse().unwrap(), l.parse().unwrap()),
            None => (spec.parse().unwrap(), 1),
        };
        (if len == 0 { start } else { start - 1 }, len)
    }
    let old_lines: Vec<&str> = editor_lines(old_text).collect();
    diff.lines()
        .filter_map(|line| line.strip_prefix("@@ "))
        .map(|spec| {
            let mut parts = spec.split(' ');
            let (old_start, old_len) = range(parts.next().unwrap().strip_prefix('-').unwrap());
            let (start, lines) = range(parts.next().unwrap().strip_prefix('+').unwrap());
            LineHunk {
                kind: HunkKind::of(old_len, lines),
                start,
                lines,
                old_start,
                old_lines: old_len,
                old_text: old_lines[old_start as usize..(old_start + old_len) as usize]
                    .iter()
                    .map(|l| format!("{l}\n"))
                    .collect(),
            }
        })
        .collect()
}

mod cases {
    use super::*;

    pub fn both_texts_empty(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "", ""), []);
    }

    pub fn identical_texts(d: &dyn LineDiffer) {
        for text in ["a\nb\n", "a\nb", "\n", "a\r\nb\r\n", "ünïcödé 🌍\n", "\n\n\n"] {
            assert_eq!(hunks(d, text, text), [], "{text:?}");
        }
    }

    /// Ported: "from empty and to empty".
    pub fn one_side_empty(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "", "x\ny\n"), [added(0, 2, 0)]);
        assert_eq!(hunks(d, "x\ny\n", ""), [deleted(0, 0, "x\ny\n")]);
    }

    /// The editor shows one empty line for the empty text; text without a final newline replaces that line.
    pub fn the_empty_text_is_one_empty_line(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "", "x"), [modified(0, 1, 0, "\n")]);
        assert_eq!(hunks(d, "x", ""), [modified(0, 1, 0, "x\n")]);
        assert_eq!(hunks(d, "", "\n"), [added(1, 1, 1)]);
    }

    /// Ported: "a last line without a newline still ends with one in oldText".
    pub fn no_trailing_newline_on_either_side(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "a\nb", "a\nc"), [modified(1, 1, 1, "b\n")]);
        assert_eq!(hunks(d, "a\nb", "a\nb\nc"), [added(2, 1, 2)]);
    }

    /// A trailing newline opens one more, empty, line in the editor: adding or removing it is that line.
    pub fn only_the_trailing_newline_differs(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "a\nb", "a\nb\n"), [added(2, 1, 2)]);
        assert_eq!(hunks(d, "a\nb\n", "a\nb"), [deleted(2, 2, "\n")]);
    }

    pub fn no_trailing_newline_and_a_changed_last_line(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "a\nb", "a\nc\n"), [modified(1, 2, 1, "b\n")]);
        assert_eq!(hunks(d, "a\nb\n", "a\nc"), [modified(1, 1, 1, "b\n\n")]);
    }

    /// Every byte is significant: a CRLF line differs from the LF line with the same words, and `\r` stays in the
    /// line (and in `old_text`), so the line counts — and the view's alignment — are unchanged.
    pub fn crlf_against_lf(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "a\r\nb\r\n", "a\nb\n"), [modified(0, 2, 0, "a\r\nb\r\n")]);
        assert_eq!(hunks(d, "a\nb\r\nc\n", "a\nb\nc\n"), [modified(1, 1, 1, "b\r\n")]);
        assert_eq!(hunks(d, "a\rb\n", "a\nb\n"), [modified(0, 2, 0, "a\rb\n")]);
    }

    pub fn non_ascii_text(d: &dyn LineDiffer) {
        let old = "привет\nмир\n日本語\n";
        let new = "привет\nмир 🌍\n日本語\ne\u{301}\n";
        assert_eq!(hunks(d, old, new), [modified(1, 1, 1, "мир\n"), added(3, 1, 3)]);
    }

    pub fn change_at_the_first_line(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "a\nb\nc\n", "A\nb\nc\n"), [modified(0, 1, 0, "a\n")]);
        assert_eq!(hunks(d, "b\nc\n", "a\nb\nc\n"), [added(0, 1, 0)]);
        assert_eq!(hunks(d, "a\nb\nc\n", "b\nc\n"), [deleted(0, 0, "a\n")]);
    }

    pub fn change_at_the_last_line(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "a\nb\nc", "a\nb\nC"), [modified(2, 1, 2, "c\n")]);
        // Appended after the last line: the gap is followed by the trailing empty line on the old side.
        assert_eq!(hunks(d, "a\nb\n", "a\nb\nc\n"), [added(2, 1, 2)]);
        assert_eq!(hunks(d, "a\nb\nc\n", "a\nb\n"), [deleted(2, 2, "c\n")]);
        assert_eq!(
            hunks(d, "a\nb\nc", "A\nb\nC"),
            [modified(0, 1, 0, "a\n"), modified(2, 1, 2, "c\n")]
        );
    }

    /// Ported: "an insertion between lines starts at the line that follows the gap on the old side".
    pub fn insertion_between_lines(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "a\nc\n", "a\nb\nc\n"), [added(1, 1, 1)]);
    }

    /// Ported: "a deletion keeps the removed lines, each ending with a newline".
    pub fn deletion_keeps_the_removed_lines(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "a\nb\nc\n", "a\nc\n"), [deleted(1, 1, "b\n")]);
    }

    /// Ported: "removed then added lines are one modification".
    pub fn removed_then_added_is_one_modification(d: &dyn LineDiffer) {
        assert_eq!(hunks(d, "a\nb\nc\n", "a\nB\nB2\nc\n"), [modified(1, 2, 1, "b\n")]);
    }

    /// Ported: "gives the same hunks as git for the editor's demo" and "counts the stats".
    pub fn same_hunks_as_git_on_the_example(d: &dyn LineDiffer) {
        let old = include_str!("../../fixtures/old.rs");
        let new = include_str!("../../fixtures/new.rs");
        let expected = parse_zero_context_diff(include_str!("../../fixtures/diff.patch"), old);
        let kinds: Vec<HunkKind> = expected.iter().map(|h| h.kind).collect();
        assert_eq!(
            kinds,
            [HunkKind::Added, HunkKind::Modified, HunkKind::Deleted, HunkKind::Added]
        );
        let actual = hunks(d, old, new);
        assert_eq!(actual, expected);
        assert_eq!(
            DiffStats::of(&actual),
            DiffStats {
                changes: 4,
                added: 3 + 3 + 11,
                removed: 1 + 5
            }
        );
    }

    /// 50 000 lines, a modification, a deletion and an insertion in every thousand. The lines are unique, so the
    /// answer is exact for any algorithm.
    pub fn large_input_with_scattered_changes(d: &dyn LineDiffer) {
        let (old, new, expected) = super::large_pair(50_000);
        let actual = hunks(d, &old, &new);
        assert_eq!(actual.len(), expected.len());
        assert_eq!(actual, expected);
    }
}

/// A large pair of texts with scattered changes and the hunks between them (`examples/measure.rs` times the same
/// pair).
pub(crate) fn large_pair(line_count: usize) -> (String, String, Vec<LineHunk>) {
    let base = |i: usize| format!("    let value_{i} = compute({i}, \"row {i}\");");
    let (mut old, mut new, mut expected) = (Vec::new(), Vec::new(), Vec::new());
    for i in 0..line_count {
        let line = base(i);
        old.push(line.clone());
        match i % 1000 {
            100 => {
                expected.push(modified(new.len() as u32, 1, i as u32, &format!("{line}\n")));
                new.push(format!("    let value_{i} = compute({i}, \"row {i}\") + 1;"));
            }
            400 => expected.push(deleted(new.len() as u32, i as u32, &format!("{line}\n"))),
            700 => {
                new.push(line);
                expected.push(added(new.len() as u32, 1, i as u32 + 1));
                new.push(format!("    log(\"inserted after {i}\");"));
            }
            _ => new.push(line),
        }
    }
    (old.join("\n") + "\n", new.join("\n") + "\n", expected)
}
