//! The blank rows that keep both sides of the view level: every hunk takes as many rows on both sides, so an
//! unchanged line stands on the same row left and right, and both sides end on the same row.
//!
//! Soft wrap is off in the view, so one editor line is one row and the hunks alone decide the padding. Plain data,
//! so the alignment is testable without a window.

use crate::hunks::LineHunk;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiffSide {
    Old,
    New,
}

/// Blank rows next to one line of one side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pad {
    pub line: usize,
    pub rows: usize,
    pub above: bool,
}

/// The blank rows one side needs. A block the other side has more of is padded below this side's last line of the
/// block; a block this side lacks entirely gets the rows above the line that follows the gap, or below the last line
/// when the gap is at the end of the text.
pub fn pads(hunks: &[LineHunk], side: DiffSide, line_count: usize) -> Vec<Pad> {
    hunks
        .iter()
        .filter_map(|h| {
            let (start, own, theirs) = match side {
                DiffSide::Old => (h.old_start as usize, h.old_lines as usize, h.lines as usize),
                DiffSide::New => (h.start as usize, h.lines as usize, h.old_lines as usize),
            };
            let rows = theirs.checked_sub(own).filter(|rows| *rows > 0)?;
            Some(if own > 0 {
                Pad {
                    line: start + own - 1,
                    rows,
                    above: false,
                }
            } else if start < line_count {
                Pad {
                    line: start,
                    rows,
                    above: true,
                }
            } else {
                Pad {
                    line: line_count.saturating_sub(1),
                    rows,
                    above: false,
                }
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        hunks::HunkKind,
        line_differ::built_ins,
        lines::{editor_line_count, editor_lines},
    };

    fn hunk(kind: HunkKind, old: (u32, u32), new: (u32, u32)) -> LineHunk {
        LineHunk {
            kind,
            start: new.0,
            lines: new.1,
            old_start: old.0,
            old_lines: old.1,
            old_text: String::new(),
        }
    }

    /// The row each line starts at once the pads are applied, and the side's total rows.
    fn layout(pads: &[Pad], line_count: usize) -> (Vec<usize>, usize) {
        let mut row = 0;
        let starts = (0..line_count)
            .map(|line| {
                row += pads
                    .iter()
                    .filter(|p| p.above && p.line == line)
                    .map(|p| p.rows)
                    .sum::<usize>();
                let start = row;
                row += 1 + pads
                    .iter()
                    .filter(|p| !p.above && p.line == line)
                    .map(|p| p.rows)
                    .sum::<usize>();
                start
            })
            .collect();
        (starts, row)
    }

    #[test]
    fn insertion_pads_the_old_side_above_the_next_line() {
        let hunks = [hunk(HunkKind::Added, (2, 0), (2, 3))];
        assert_eq!(
            pads(&hunks, DiffSide::Old, 6),
            [Pad {
                line: 2,
                rows: 3,
                above: true
            }]
        );
        assert!(pads(&hunks, DiffSide::New, 9).is_empty());
    }

    #[test]
    fn deletion_pads_the_new_side_and_modification_pads_the_shorter_side() {
        let hunks = [
            hunk(HunkKind::Deleted, (4, 2), (4, 0)),
            hunk(HunkKind::Modified, (10, 1), (8, 3)),
        ];
        assert_eq!(
            pads(&hunks, DiffSide::New, 20),
            [Pad {
                line: 4,
                rows: 2,
                above: true
            }]
        );
        assert_eq!(
            pads(&hunks, DiffSide::Old, 20),
            [Pad {
                line: 10,
                rows: 2,
                above: false
            }]
        );
    }

    #[test]
    fn append_at_end_of_file_stands_beside_the_trailing_line() {
        // "a\nb\n" → "a\nb\nc\n": the editor shows 3 and 4 lines.
        let hunks = [hunk(HunkKind::Added, (2, 0), (2, 1))];
        assert_eq!(
            pads(&hunks, DiffSide::Old, 3),
            [Pad {
                line: 2,
                rows: 1,
                above: true
            }]
        );
        // Without a trailing line, the rows go below the last one.
        assert_eq!(
            pads(&hunks, DiffSide::Old, 2),
            [Pad {
                line: 1,
                rows: 1,
                above: false
            }]
        );
    }

    /// The hunks of every built-in differ keep the view level on the cases of the differ's contract — the trailing
    /// newline, CRLF, empty texts and edits at both ends included.
    #[test]
    fn computed_hunks_keep_both_sides_level() {
        let pairs = [
            ("", ""),
            ("", "x\ny\n"),
            ("x\ny\n", ""),
            ("", "x"),
            ("a\nb", "a\nb\n"),
            ("a\nb\n", "a\nb"),
            ("a\nb", "a\nc\n"),
            ("a\r\nb\r\n", "a\nb\n"),
            ("a\rb\n", "a\nb\n"),
            ("b\nc\n", "a\nb\nc\n"),
            ("a\nb\nc", "A\nb\nC"),
            ("a\nb\nc\nd\ne\nf\ng\n", "a\nX\nY\nc\nd\nf\ng\nh\n"),
            ("привет\nмир\n", "привет\nмир 🌍\nновая\n"),
            (include_str!("../fixtures/old.rs"), include_str!("../fixtures/new.rs")),
        ];
        for differ in built_ins() {
            for (old, new) in pairs {
                let hunks = differ.line_hunks(old, new);
                let (old_n, new_n) = (editor_line_count(old), editor_line_count(new));
                let (old_rows, old_total) = layout(&pads(&hunks, DiffSide::Old, old_n), old_n);
                let (new_rows, new_total) = layout(&pads(&hunks, DiffSide::New, new_n), new_n);
                let context = format!("{} on {old:?} → {new:?}", differ.name());
                assert_eq!(old_total, new_total, "both sides end on the same row: {context}");
                // Unchanged lines pair up in order between the hunks; each pair stands on one row.
                let (old_lines, new_lines): (Vec<&str>, Vec<&str>) =
                    (editor_lines(old).collect(), editor_lines(new).collect());
                let (mut o, mut n) = (0usize, 0usize);
                let check = |o_end: usize, n_end: usize, o: &mut usize, n: &mut usize| {
                    while *o < o_end && *n < n_end {
                        assert_eq!(old_lines[*o], new_lines[*n], "{context}");
                        assert_eq!(
                            old_rows[*o], new_rows[*n],
                            "line {:?} is level: {context}",
                            old_lines[*o]
                        );
                        *o += 1;
                        *n += 1;
                    }
                };
                for h in &hunks {
                    check(h.old_start as usize, h.start as usize, &mut o, &mut n);
                    o = (h.old_start + h.old_lines) as usize;
                    n = (h.start + h.lines) as usize;
                }
                check(old_n, new_n, &mut o, &mut n);
            }
        }
    }
}
