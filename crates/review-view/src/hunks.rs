//! Hunks in OpenIDEA's `vcs_line_hunks` shape (0-based editor lines): what the view draws, whether a `LineDiffer`
//! computed them in the module or the server sent them (live review).

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HunkKind {
    Added,
    Modified,
    Deleted,
}

impl HunkKind {
    /// The kind of a hunk that replaces `old_lines` lines with `lines` lines (not both zero).
    pub fn of(old_lines: u32, lines: u32) -> Self {
        match (old_lines, lines) {
            (0, _) => Self::Added,
            (_, 0) => Self::Deleted,
            _ => Self::Modified,
        }
    }
}

/// One block of changed lines. For an empty side (`lines` or `old_lines` is 0) the start is the index of the line
/// that follows the gap on that side, which is the side's line count when the gap is after its last line.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineHunk {
    pub kind: HunkKind,
    /// First line in the new text.
    pub start: u32,
    /// Lines in the new text (0 for a pure deletion).
    pub lines: u32,
    pub old_start: u32,
    pub old_lines: u32,
    /// The removed lines, each followed by `\n`.
    #[serde(default)]
    pub old_text: String,
}

/// What a comparison changed, as the page shows it: hunks, added and removed lines.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct DiffStats {
    pub changes: usize,
    pub added: usize,
    pub removed: usize,
}

impl DiffStats {
    pub fn of(hunks: &[LineHunk]) -> Self {
        Self {
            changes: hunks.len(),
            added: hunks.iter().map(|h| h.lines as usize).sum(),
            removed: hunks.iter().map(|h| h.old_lines as usize).sum(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_follows_the_sides() {
        assert_eq!(HunkKind::of(0, 2), HunkKind::Added);
        assert_eq!(HunkKind::of(3, 0), HunkKind::Deleted);
        assert_eq!(HunkKind::of(1, 2), HunkKind::Modified);
    }

    #[test]
    fn reads_and_writes_the_vcs_line_hunks_shape() {
        let json = r#"{"kind":"modified","start":1,"lines":2,"oldStart":1,"oldLines":1,"oldText":"b\n"}"#;
        let hunk: LineHunk = serde_json::from_str(json).unwrap();
        assert_eq!(hunk.kind, HunkKind::Modified);
        assert_eq!(serde_json::to_string(&hunk).unwrap(), json);
        // The server may leave the removed text out.
        let bare: LineHunk =
            serde_json::from_str(r#"{"kind":"added","start":0,"lines":1,"oldStart":0,"oldLines":0}"#).unwrap();
        assert_eq!(bare.old_text, "");
    }

    #[test]
    fn stats_count_hunks_and_lines() {
        let hunk = |lines, old_lines| LineHunk {
            kind: HunkKind::of(old_lines, lines),
            start: 0,
            lines,
            old_start: 0,
            old_lines,
            old_text: String::new(),
        };
        assert_eq!(
            DiffStats::of(&[hunk(3, 0), hunk(2, 1), hunk(0, 5)]),
            DiffStats {
                changes: 3,
                added: 5,
                removed: 6
            }
        );
        assert_eq!(DiffStats::of(&[]), DiffStats::default());
    }
}
