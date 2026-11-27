//! What the two editors read from the comparison: blank rows that keep them level and the markers of changed lines.
//!
//! Built on the controls of gpui-kit's line decorations: spacer rows, a gutter facing the center on the old side
//! (`gutter_side(Side::Right)`), and line decorations with a gutter icon and a tinted background.

use std::{
    cell::{Cell, Ref, RefCell},
    ops::Range,
    rc::Rc,
};

use gpui::App;
use gpui_component::{
    ActiveTheme as _, IconName, IconNamed as _,
    input::{LineDecoration, LineDecorationProvider, Spacer, SpacerProvider},
};

use crate::{
    alignment::{DiffSide, pads},
    hunks::{HunkKind, LineHunk},
    lines::editor_line_count,
};

/// What both sides read: the hunks and each side's line count.
#[derive(Default)]
pub(crate) struct DiffModel {
    hunks: RefCell<Vec<LineHunk>>,
    line_counts: Cell<[usize; 2]>,
}

impl DiffModel {
    pub fn set(&self, hunks: Vec<LineHunk>, old_text: &str, new_text: &str) {
        *self.hunks.borrow_mut() = hunks;
        self.line_counts
            .set([editor_line_count(old_text), editor_line_count(new_text)]);
    }

    pub fn hunks(&self) -> Ref<'_, Vec<LineHunk>> {
        self.hunks.borrow()
    }

    fn line_count(&self, side: DiffSide) -> usize {
        self.line_counts.get()[side as usize]
    }
}

pub(crate) struct DiffSpacers {
    pub model: Rc<DiffModel>,
    pub side: DiffSide,
}

impl SpacerProvider for DiffSpacers {
    fn spacers(&self, lines: Range<usize>, cx: &App) -> Vec<Spacer> {
        let fill = cx.theme().muted.opacity(0.5);
        pads(&self.model.hunks(), self.side, self.model.line_count(self.side))
            .into_iter()
            .filter(|pad| lines.contains(&pad.line))
            .map(|pad| {
                let spacer = if pad.above {
                    Spacer::above(pad.line, pad.rows)
                } else {
                    Spacer::below(pad.line, pad.rows)
                };
                spacer.with_background(fill)
            })
            .collect()
    }
}

/// Markers of one side: removed lines in red on the old side, added lines in green on the new side, both halves of
/// a modification in blue; the gutter icon (minus, plus, asterisk) in the colours gpui-kit gave its diff markers. A
/// side shows nothing for the lines it does not have.
pub(crate) struct ChangedLines {
    pub model: Rc<DiffModel>,
    pub side: DiffSide,
}

impl LineDecorationProvider for ChangedLines {
    fn line_decorations(&self, rows: Range<usize>, cx: &App) -> Vec<LineDecoration> {
        let theme = cx.theme();
        let mut out = Vec::new();
        for h in self.model.hunks().iter() {
            let (icon, icon_color, color) = match (h.kind, self.side) {
                (HunkKind::Added, DiffSide::Old) | (HunkKind::Deleted, DiffSide::New) => continue,
                (HunkKind::Added, DiffSide::New) => (IconName::Plus, theme.success, theme.success),
                (HunkKind::Deleted, DiffSide::Old) => (IconName::Minus, theme.danger, theme.danger),
                (HunkKind::Modified, _) => (IconName::Asterisk, theme.warning, theme.info),
            };
            let icon = icon.path();
            let (start, lines) = match self.side {
                DiffSide::Old => (h.old_start, h.old_lines),
                DiffSide::New => (h.start, h.lines),
            };
            let span = start as usize..(start + lines) as usize;
            for row in span.start.max(rows.start)..span.end.min(rows.end) {
                out.push(
                    LineDecoration::new(row)
                        .with_gutter_icon(icon.clone(), icon_color)
                        .with_background(color.opacity(0.12)),
                );
            }
        }
        out
    }

    fn has_gutter_icons(&self) -> bool {
        true
    }
}
