//! The view: the old text on the left, the new text on the right, unchanged lines level, changed lines marked.
//!
//! [`ReviewView::builder`] is the composition root of the comparison: `with_<seam>(…)` injects an implementation,
//! anything not injected is the default. A request may still name a built-in variant as data ([`CompareOptions`]).
//! The sides are neutral — the two texts the host gave, with no labels of their own.

use std::{rc::Rc, sync::Arc, time::Duration};

use gpui::{
    AppContext as _, Context, Entity, EventEmitter, IntoElement, ParentElement as _, Pixels, Render, SharedString,
    Styled as _, Subscription, Window, div, px,
};
use gpui_component::{
    ActiveTheme as _, Side, h_flex,
    highlighter::Diagnostic,
    input::{Editor, EditorState, LineDecorationCollection},
    scroll::ScrollbarPlacement,
    theme::Theme,
    v_flex,
};
use web_time::Instant;

use crate::{
    alignment::DiffSide,
    compare::{CompareOptions, Comparison, UnknownVariant},
    diff_view::{ChangedLines, DiffModel, DiffSpacers},
    hunks::{DiffStats, LineHunk},
    line_differ::LineDiffer,
};

/// Assembles a [`ReviewView`]: the implementation behind each seam of the comparison.
#[derive(Default)]
pub struct ReviewViewBuilder {
    comparison: Comparison,
}

impl ReviewViewBuilder {
    /// Which lines changed. Default: [`crate::HistogramLineDiffer`].
    pub fn with_line_differ(mut self, differ: impl LineDiffer + 'static) -> Self {
        self.comparison = self.comparison.with_line_differ(Arc::new(differ));
        self
    }

    pub fn build(self, window: &mut Window, cx: &mut Context<ReviewView>) -> ReviewView {
        ReviewView::new(self.comparison, window, cx)
    }
}

/// Two texts for the view to compare.
#[derive(Clone, Debug, Default)]
pub struct Texts {
    /// What the status line names; a file path or anything the host chooses.
    pub path: String,
    /// A highlighter name (`rust`, `typescript`, …); empty = plain text.
    pub language: String,
    pub old_text: String,
    pub new_text: String,
}

/// Two texts and the hunks between them, computed elsewhere (the server's `vcs_line_hunks` in live review).
#[derive(Clone, Debug, Default)]
pub struct DiffDocument {
    pub texts: Texts,
    pub hunks: Vec<LineHunk>,
    /// On the new side.
    pub diagnostics: Vec<Diagnostic>,
}

/// What the view now shows.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub path: String,
    pub stats: DiffStats,
    /// The differ that computed the hunks; `None` when they came with the document.
    pub line_differ: Option<String>,
    /// How long the differ took; `None` when the hunks came with the document.
    pub compare_time: Option<Duration>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReviewEvent {
    /// The view has been drawn once; from now on it takes texts.
    FirstFrame,
}

pub struct ReviewView {
    comparison: Comparison,
    old_editor: Entity<EditorState>,
    editor: Entity<EditorState>,
    model: Rc<DiffModel>,
    path: SharedString,
    summary: SharedString,
    /// Each side's vertical offset after the last synchronization.
    scroll_y: [Pixels; 2],
    first_frame_reported: bool,
    _collections: [LineDecorationCollection; 2],
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ReviewEvent> for ReviewView {}

impl ReviewView {
    pub fn builder() -> ReviewViewBuilder {
        ReviewViewBuilder::default()
    }

    fn new(comparison: Comparison, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let model = Rc::new(DiffModel::default());

        let side_editor = |side: DiffSide, window: &mut Window, cx: &mut Context<Self>| {
            let editor = cx.new(|cx| {
                let state = EditorState::new(window, cx).line_number(true).soft_wrap(false);
                match side {
                    DiffSide::New => state,
                    // The old side's gutter faces the center, its scrollbar the outer (left) edge.
                    DiffSide::Old => state
                        .gutter_side(Side::Right)
                        .scrollbar_placement(ScrollbarPlacement::BottomLeft),
                }
            });
            let collection = editor.update(cx, |state, cx| {
                state.set_readonly(true, cx);
                state.set_spacer_provider(
                    Some(Rc::new(DiffSpacers {
                        model: model.clone(),
                        side,
                    })),
                    cx,
                );
                state.create_line_decorations_collection(
                    Rc::new(ChangedLines {
                        model: model.clone(),
                        side,
                    }),
                    cx,
                )
            });
            (editor, collection)
        };
        let (old_editor, old_collection) = side_editor(DiffSide::Old, window, cx);
        let (editor, new_collection) = side_editor(DiffSide::New, window, cx);

        let subscriptions = vec![
            // Wheel scrolling notifies the scrolled editor; re-render to carry it to the other side.
            cx.observe(&editor, |_, _, cx| cx.notify()),
            cx.observe(&old_editor, |_, _, cx| cx.notify()),
            // Spacers keep the fill they were created with; a new theme needs new ones.
            cx.observe_global::<Theme>(|view, cx| {
                for editor in [&view.editor, &view.old_editor] {
                    editor.update(cx, |state, cx| state.refresh_spacers(cx));
                }
            }),
        ];

        Self {
            comparison,
            old_editor,
            editor,
            model,
            path: SharedString::default(),
            summary: SharedString::default(),
            scroll_y: [px(0.); 2],
            first_frame_reported: false,
            _collections: [old_collection, new_collection],
            _subscriptions: subscriptions,
        }
    }

    /// Compares two texts with this view's comparison, or with the built-in variants `options` names, and shows them.
    /// An option naming no built-in variant is refused and the view keeps what it showed.
    pub fn compare(
        &mut self,
        texts: Texts,
        options: &CompareOptions,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Shown, UnknownVariant> {
        let comparison = self.comparison.with_options(options)?;
        let started = Instant::now();
        let hunks = comparison.line_hunks(&texts.old_text, &texts.new_text);
        let compare_time = started.elapsed();
        let mut shown = self.show(
            DiffDocument {
                texts,
                hunks,
                diagnostics: Vec::new(),
            },
            window,
            cx,
        );
        shown.line_differ = Some(comparison.line_differ().name().to_owned());
        shown.compare_time = Some(compare_time);
        Ok(shown)
    }

    /// Shows two texts with the hunks between them as given.
    pub fn show(&mut self, document: DiffDocument, window: &mut Window, cx: &mut Context<Self>) -> Shown {
        let DiffDocument {
            texts:
                Texts {
                    path,
                    language,
                    old_text,
                    new_text,
                },
            hunks,
            diagnostics,
        } = document;
        let language = if language.is_empty() {
            "text".to_owned()
        } else {
            language
        };
        let stats = DiffStats::of(&hunks);
        self.model.set(hunks, &old_text, &new_text);

        self.editor.update(cx, |state, cx| {
            state.set_highlighter(language.clone(), cx);
            // Clears the previous text's diagnostics, so they go in afterwards.
            state.set_value(new_text, window, cx);
            if let Some(set) = state.diagnostics_mut() {
                set.clear();
                set.extend(diagnostics);
            }
            // `set_value` leaves the caret at the end; start at the top instead.
            state.set_cursor_position(lsp_types::Position::default(), window, cx);
            cx.notify();
        });
        self.old_editor.update(cx, |state, cx| {
            state.set_highlighter(language.clone(), cx);
            state.set_value(old_text, window, cx);
            state.set_cursor_position(lsp_types::Position::default(), window, cx);
        });
        for editor in [&self.editor, &self.old_editor] {
            editor.update(cx, |state, cx| state.refresh_spacers(cx));
        }
        self.scroll_y = [
            self.old_editor.read(cx).scroll_offset().y,
            self.editor.read(cx).scroll_offset().y,
        ];

        self.summary = summary(&language, &stats).into();
        self.path = path.clone().into();
        cx.notify();
        Shown {
            path,
            stats,
            line_differ: None,
            compare_time: None,
        }
    }

    /// The two editors, old side first (feature `inspect`): for probes and examples that look inside the view.
    #[cfg(feature = "inspect")]
    pub fn editors(&self) -> [&Entity<EditorState>; 2] {
        [&self.old_editor, &self.editor]
    }

    /// Padded level, both sides have the same rows, so one vertical offset suits both: whichever side moved since
    /// the last frame leads.
    fn synchronize_scroll(&mut self, cx: &mut Context<Self>) {
        let current = [
            self.old_editor.read(cx).scroll_offset().y,
            self.editor.read(cx).scroll_offset().y,
        ];
        let source = if current[0] != self.scroll_y[0] {
            0
        } else if current[1] != self.scroll_y[1] {
            1
        } else {
            return;
        };
        let y = current[source];
        if current[1 - source] != y {
            let target = if source == 0 { &self.editor } else { &self.old_editor };
            target.update(cx, |state, cx| {
                let mut offset = state.scroll_offset();
                offset.y = y;
                state.set_scroll_offset(offset, cx);
            });
        }
        self.scroll_y = [y; 2];
    }
}

fn summary(language: &str, stats: &DiffStats) -> String {
    let changes = match stats.changes {
        0 => "no differences".to_owned(),
        1 => format!("1 change · +{} −{}", stats.added, stats.removed),
        n => format!("{n} changes · +{} −{}", stats.added, stats.removed),
    };
    format!("{language} · {changes}")
}

fn editor_pane(state: &Entity<EditorState>) -> impl IntoElement {
    div()
        .flex_1()
        .min_w_0()
        .h_full()
        .child(Editor::new(state).readonly(true).bordered(false).size_full())
}

impl Render for ReviewView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.first_frame_reported {
            self.first_frame_reported = true;
            let view = cx.entity().downgrade();
            window.on_next_frame(move |_, cx| {
                let _ = view.update(cx, |_, cx| cx.emit(ReviewEvent::FirstFrame));
            });
        }
        self.synchronize_scroll(cx);
        v_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .child(editor_pane(&self.old_editor))
                    .child(div().w_px().h_full().bg(cx.theme().border))
                    .child(editor_pane(&self.editor)),
            )
            .child(
                h_flex()
                    .px_3()
                    .py_1()
                    .gap_3()
                    .text_xs()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .text_color(cx.theme().muted_foreground)
                    .child(self.path.clone())
                    .child(self.summary.clone()),
            )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_status_line_counts_changes_without_naming_a_side() {
        let stats = |changes, added, removed| DiffStats {
            changes,
            added,
            removed,
        };
        assert_eq!(summary("rust", &stats(4, 17, 6)), "rust · 4 changes · +17 −6");
        assert_eq!(summary("text", &stats(1, 0, 2)), "text · 1 change · +0 −2");
        assert_eq!(summary("python", &stats(0, 0, 0)), "python · no differences");
    }
}
