//! The view: the old text on the left, the new text on the right, unchanged lines level, changed lines marked.
//!
//! [`ReviewView::builder`] is the composition root of the comparison: `with_<seam>(…)` injects an implementation,
//! anything not injected is the default. A request may still name a built-in variant as data ([`CompareOptions`]).
//! The sides are neutral — the two texts the host gave, with no labels of their own.
//!
//! Both sides are read-only by default. The host may make one editable ([`ReviewView::set_editable`]); the comparison
//! then follows the user's edits: a burst of typing is compared once it pauses for [`RECOMPARE_DELAY`], with the same
//! comparison the last request used, and reported as [`ReviewEvent::Recompared`]. No text crosses to the host on an
//! edit; it reads a side when it needs one ([`ReviewView::text`]).
//!
//! The view lays its texts out in one of two ways ([`Layout`]): both sides compared (the default), or one file — the
//! new side alone, read-only or editable ([`ReviewView::show_file`]). Switching keeps the texts and the edits
//! ([`ReviewView::set_layout`]); a file's old side holds the text as it was shown, so the diff layout then shows the
//! edits made since. The host may bring a line or a hunk of the new side into view ([`ReviewView::reveal_line`],
//! [`ReviewView::reveal_hunk`]); the editor scrolls once it has laid the text out.

use std::{ops::Range, rc::Rc, sync::Arc, time::Duration};

use gpui::{
    AppContext as _, Context, Entity, EventEmitter, Focusable as _, IntoElement, ParentElement as _, Pixels, Render,
    SharedString, Styled as _, Subscription, Task, Window, div, px,
};
use gpui_component::{
    ActiveTheme as _, Rope, RopeExt as _, Side, h_flex,
    highlighter::Diagnostic,
    input::{Editor, EditorState, InputEvent, LineDecorationCollection},
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
    sides::{SideState, Sides},
};

/// How long typing must pause before the sides are compared again: once per burst, never per keystroke. The same
/// pause as gpui-kit's highlighter waits before it parses an edited document.
pub const RECOMPARE_DELAY: Duration = Duration::from_millis(150);

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

/// One file for the view to show alone.
#[derive(Clone, Debug, Default)]
pub struct FileDocument {
    /// What the status line names.
    pub path: String,
    /// A highlighter name; empty = plain text.
    pub language: String,
    pub text: String,
    /// The user may not edit it.
    pub read_only: bool,
}

/// How the view lays out its texts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Layout {
    /// One pane: the new side alone, as a file.
    File,
    /// Both sides side by side, changed lines marked.
    #[default]
    Diff,
}

impl Layout {
    /// The name at the host boundary: `file` or `diff`.
    pub fn name(self) -> &'static str {
        match self {
            Layout::File => "file",
            Layout::Diff => "diff",
        }
    }

    pub fn from_name(name: &str) -> Option<Layout> {
        [Layout::File, Layout::Diff]
            .into_iter()
            .find(|layout| layout.name() == name)
    }
}

/// What to bring into view on the new side once the editor has laid its text out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Reveal {
    /// A 0-based line; with a column (UTF-16) the caret goes there, without one the line is selected.
    Line { line: u32, column: Option<u32> },
    /// The new-side lines of a hunk, selected; the caret at their start.
    Hunk { start: u32, lines: u32 },
}

/// Two texts and the hunks between them, computed elsewhere (the server's `vcs_line_hunks` in live review).
#[derive(Clone, Debug, Default)]
pub struct DiffDocument {
    pub texts: Texts,
    pub hunks: Vec<LineHunk>,
    /// On the new side.
    pub diagnostics: Vec<Diagnostic>,
}

/// What made the view show what it shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShownCause {
    /// A call of the host: texts, a side, the language, a swap.
    Request,
    /// The user's edit, compared once the typing paused.
    Edit,
}

impl ShownCause {
    pub fn name(self) -> &'static str {
        match self {
            ShownCause::Request => "request",
            ShownCause::Edit => "edit",
        }
    }
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
    /// The whole comparison: reading both sides, the differ, the new hunks in the view; `None` as above.
    pub update_time: Option<Duration>,
    pub cause: ShownCause,
    /// Each side, old first.
    pub sides: [SideState; 2],
    /// How the texts are laid out.
    pub layout: Layout,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ReviewEvent {
    /// The view has been drawn once; from now on it takes texts.
    FirstFrame,
    /// The user edited a side and the view compared the sides again.
    Recompared(Shown),
}

pub struct ReviewView {
    comparison: Comparison,
    /// The comparison of the last request, with the variants it named; edits are compared with it too.
    active: Comparison,
    editors: [Entity<EditorState>; 2],
    sides: Sides,
    model: Rc<DiffModel>,
    path: SharedString,
    language: SharedString,
    summary: SharedString,
    /// Each side's vertical offset after the last synchronization.
    scroll_y: [Pixels; 2],
    first_frame_reported: bool,
    /// The comparison waiting for the typing to pause; replacing it cancels the one before.
    pending_recompare: Option<Task<()>>,
    layout: Layout,
    /// The hunks of the last comparison, whatever the layout draws (the file layout draws none).
    hunks: Vec<LineHunk>,
    /// What to bring into view after the next frame.
    pending_reveal: Option<Reveal>,
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

        let mut subscriptions = vec![
            // Wheel scrolling notifies the scrolled editor; re-render to carry it to the other side.
            cx.observe(&editor, |_, _, cx| cx.notify()),
            cx.observe(&old_editor, |_, _, cx| cx.notify()),
            // Spacers keep the fill they were created with; a new theme needs new ones.
            cx.observe_global::<Theme>(|view, cx| {
                for editor in &view.editors {
                    editor.update(cx, |state, cx| state.refresh_spacers(cx));
                }
            }),
        ];
        // The user's edits (a host's `set_value` emits no change).
        for (side, state) in [(DiffSide::Old, &old_editor), (DiffSide::New, &editor)] {
            subscriptions.push(
                cx.subscribe_in(state, window, move |view, _, event: &InputEvent, window, cx| {
                    if matches!(event, InputEvent::Change) {
                        view.edited(side, window, cx);
                    }
                }),
            );
        }

        Self {
            active: comparison.clone(),
            comparison,
            editors: [old_editor, editor],
            sides: Sides::default(),
            model,
            path: SharedString::default(),
            language: "text".into(),
            summary: SharedString::default(),
            scroll_y: [px(0.); 2],
            first_frame_reported: false,
            pending_recompare: None,
            layout: Layout::default(),
            hunks: Vec::new(),
            pending_reveal: None,
            _collections: [old_collection, new_collection],
            _subscriptions: subscriptions,
        }
    }

    fn editor(&self, side: DiffSide) -> &Entity<EditorState> {
        &self.editors[side.index()]
    }

    /// Compares two texts with this view's comparison, or with the built-in variants `options` names, and shows them.
    /// An option naming no built-in variant is refused and the view keeps what it showed. Both texts become the sides'
    /// baselines; which side is editable stays as it was.
    pub fn compare(
        &mut self,
        texts: Texts,
        options: &CompareOptions,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Shown, UnknownVariant> {
        self.active = self.comparison.with_options(options)?;
        self.layout = Layout::Diff;
        let Texts {
            path,
            language,
            old_text,
            new_text,
        } = texts;
        self.path = path.into();
        self.set_language_of_editors(language, cx);
        self.load(DiffSide::Old, old_text, window, cx);
        self.load(DiffSide::New, new_text, window, cx);
        Ok(self.recompare(ShownCause::Request, cx))
    }

    /// Replaces one side's text (a file the user dropped, the clipboard, …) and compares it with the other side as it
    /// is now — edits included.
    pub fn set_text(
        &mut self,
        side: DiffSide,
        text: String,
        path: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Shown {
        if let Some(path) = path {
            self.path = path.into();
        }
        self.load(side, text, window, cx);
        // Both sides start at the top again, level.
        self.editor(side.other()).update(cx, |state, cx| {
            let mut offset = state.scroll_offset();
            offset.y = px(0.);
            state.set_scroll_offset(offset, cx);
        });
        self.recompare(ShownCause::Request, cx)
    }

    /// Highlights both sides as `language` (a highlighter name; empty = plain text).
    pub fn set_language(&mut self, language: String, cx: &mut Context<Self>) -> Shown {
        self.set_language_of_editors(language, cx);
        self.recompare(ShownCause::Request, cx)
    }

    /// The sides trade places — texts, baselines and edit permission. Each editor starts a new history.
    pub fn swap(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Shown {
        let [old, new] = DiffSide::BOTH.map(|side| self.text(side, cx));
        self.sides.swap();
        for (side, text) in [(DiffSide::Old, new), (DiffSide::New, old)] {
            let editable = self.sides.editable(side);
            self.editor(side).update(cx, |state, cx| {
                state.set_value(text, window, cx);
                state.set_cursor_position(lsp_types::Position::default(), window, cx);
                state.set_readonly(!editable, cx);
            });
        }
        self.recompare(ShownCause::Request, cx)
    }

    /// Lets the user edit a side, or makes it read-only again (the text stays). With `focus`, the keyboard goes to it.
    pub fn set_editable(
        &mut self,
        side: DiffSide,
        editable: bool,
        focus: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.sides.set_editable(side, editable);
        self.editor(side).update(cx, |state, cx| {
            state.set_readonly(!editable, cx);
            if focus {
                state.focus(window, cx);
            }
        });
        cx.notify();
    }

    /// The host saved `text` for the side: it is the side's baseline from now on.
    pub fn mark_saved(&mut self, side: DiffSide, text: String, cx: &mut Context<Self>) -> Shown {
        self.sides.saved(side, text);
        self.recompare(ShownCause::Request, cx)
    }

    /// A side's text as it is now, edits included.
    pub fn text(&self, side: DiffSide, cx: &gpui::App) -> String {
        self.editor(side).read(cx).text().to_string()
    }

    /// The side whose editor has the keyboard, if any.
    pub fn focused_side(&self, window: &Window, cx: &gpui::App) -> Option<DiffSide> {
        DiffSide::BOTH
            .into_iter()
            .find(|side| self.editor(*side).read(cx).focus_handle(cx).is_focused(window))
    }

    /// Gives a side the keyboard.
    pub fn focus(&self, side: DiffSide, window: &mut Window, cx: &mut Context<Self>) {
        self.editor(side).update(cx, |state, cx| state.focus(window, cx));
    }

    /// Shows two texts with the hunks between them as given.
    pub fn show(&mut self, document: DiffDocument, window: &mut Window, cx: &mut Context<Self>) -> Shown {
        self.pending_recompare = None;
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
        self.set_language_of_editors(language, cx);
        self.layout = Layout::Diff;
        let stats = DiffStats::of(&hunks);
        self.hunks = hunks.clone();
        self.model.set(hunks, &old_text, &new_text);
        // Both texts become the baselines: nothing is modified yet.
        let empty = [old_text.is_empty(), new_text.is_empty()];

        self.load(DiffSide::New, new_text, window, cx);
        self.editor(DiffSide::New).update(cx, |state, _| {
            // `set_value` clears the previous text's diagnostics, so they go in afterwards.
            if let Some(set) = state.diagnostics_mut() {
                set.clear();
                set.extend(diagnostics);
            }
        });
        self.load(DiffSide::Old, old_text, window, cx);
        self.refresh_sides(cx);
        self.summary = summary(&self.language, &stats, self.layout).into();
        self.path = path.clone().into();
        cx.notify();
        let sides = DiffSide::BOTH.map(|side| SideState {
            editable: self.sides.editable(side),
            modified: false,
            empty: empty[side.index()],
        });
        Shown {
            path,
            stats,
            line_differ: None,
            compare_time: None,
            update_time: None,
            cause: ShownCause::Request,
            sides,
            layout: self.layout,
        }
    }

    /// Shows one file alone: the new side holds its text, editable unless `read_only`; the old side holds the same
    /// text, so the diff layout ([`Self::set_layout`]) shows the edits made since. Nothing is modified yet.
    pub fn show_file(&mut self, document: FileDocument, window: &mut Window, cx: &mut Context<Self>) -> Shown {
        let FileDocument {
            path,
            language,
            text,
            read_only,
        } = document;
        self.layout = Layout::File;
        self.active = self.comparison.clone();
        self.path = path.into();
        self.set_language_of_editors(language, cx);
        self.load(DiffSide::Old, text.clone(), window, cx);
        self.load(DiffSide::New, text, window, cx);
        self.set_editable(DiffSide::Old, false, false, window, cx);
        self.set_editable(DiffSide::New, !read_only, false, window, cx);
        self.recompare(ShownCause::Request, cx)
    }

    /// Lays the texts out as one file or as both sides compared. The texts, the edits and the hunks stay; switching to
    /// the diff layout puts the old side level with the new one.
    pub fn set_layout(&mut self, layout: Layout, cx: &mut Context<Self>) -> Shown {
        if layout == Layout::Diff && self.layout == Layout::File {
            let y = self.editor(DiffSide::New).read(cx).scroll_offset().y;
            self.editor(DiffSide::Old).update(cx, |state, cx| {
                let mut offset = state.scroll_offset();
                offset.y = y;
                state.set_scroll_offset(offset, cx);
            });
        }
        self.layout = layout;
        let [old_text, new_text] = DiffSide::BOTH.map(|side| self.text(side, cx));
        self.model.set(self.drawn_hunks(), &old_text, &new_text);
        self.refresh_sides(cx);
        let stats = DiffStats::of(&self.hunks);
        self.summary = summary(&self.language, &stats, self.layout).into();
        cx.notify();
        Shown {
            path: self.path.to_string(),
            stats,
            line_differ: None,
            compare_time: None,
            update_time: None,
            cause: ShownCause::Request,
            sides: [
                self.sides.state(DiffSide::Old, &old_text),
                self.sides.state(DiffSide::New, &new_text),
            ],
            layout,
        }
    }

    /// How the texts are laid out now.
    pub fn layout(&self) -> Layout {
        self.layout
    }

    /// Brings a 0-based line of the new side into view once the editor has laid it out: with a column (UTF-16) the
    /// caret goes there, without one the line is selected. A line past the end is the last line.
    pub fn reveal_line(&mut self, line: u32, column: Option<u32>, cx: &mut Context<Self>) {
        self.pending_reveal = Some(Reveal::Line { line, column });
        cx.notify();
    }

    /// Brings the `index`-th hunk of the last comparison into view, its new-side lines selected. An index past the
    /// hunks is refused.
    pub fn reveal_hunk(&mut self, index: usize, cx: &mut Context<Self>) -> Result<(), String> {
        let hunk = self.hunks.get(index).ok_or_else(|| match self.hunks.len() {
            0 => format!("no hunk {index}: the view shows no changes"),
            n => format!("no hunk {index}: the view shows {n} (0 to {})", n - 1),
        })?;
        self.pending_reveal = Some(Reveal::Hunk {
            start: hunk.start,
            lines: hunk.lines,
        });
        cx.notify();
        Ok(())
    }

    /// The hunks of the last comparison.
    pub fn hunks(&self) -> &[LineHunk] {
        &self.hunks
    }

    /// The hunks the layout draws: all of them side by side, none in a file.
    fn drawn_hunks(&self) -> Vec<LineHunk> {
        match self.layout {
            Layout::Diff => self.hunks.clone(),
            Layout::File => Vec::new(),
        }
    }

    fn apply_reveal(&mut self, reveal: Reveal, cx: &mut Context<Self>) {
        self.editor(DiffSide::New).update(cx, |state, cx| {
            let (range, reversed) = reveal_range(state.text(), reveal);
            state.set_selected_range_with_direction(range, reversed, cx);
        });
    }

    /// A grammar arrived at run time (feature `grammar-files`, [`crate::grammars`]): both sides are highlighted again
    /// if the text is shown in that language or in one that injects it. Whether they were.
    #[cfg(feature = "grammar-files")]
    pub fn grammar_arrived(&mut self, id: &str, cx: &mut Context<Self>) -> bool {
        if !crate::grammars::colours(&self.language, id) {
            return false;
        }
        // Setting the same language again drops each editor's highlighter; the next frame builds one with the grammar.
        self.set_language_of_editors(self.language.to_string(), cx);
        cx.notify();
        true
    }

    /// The two editors, old side first (feature `inspect`): for probes and examples that look inside the view.
    #[cfg(feature = "inspect")]
    pub fn editors(&self) -> [&Entity<EditorState>; 2] {
        [&self.editors[0], &self.editors[1]]
    }

    fn set_language_of_editors(&mut self, language: String, cx: &mut Context<Self>) {
        let language: SharedString = if language.is_empty() {
            "text".into()
        } else {
            language.into()
        };
        for editor in &self.editors {
            editor.update(cx, |state, cx| state.set_highlighter(language.clone(), cx));
        }
        self.language = language;
    }

    /// Puts a host's text into a side: it becomes the side's baseline, the editor starts a new history at the top.
    fn load(&mut self, side: DiffSide, text: String, window: &mut Window, cx: &mut Context<Self>) {
        self.pending_recompare = None;
        self.sides.loaded(side, &text);
        self.editor(side).update(cx, |state, cx| {
            state.set_value(text, window, cx);
            // `set_value` leaves the caret at the end; start at the top instead.
            state.set_cursor_position(lsp_types::Position::default(), window, cx);
            cx.notify();
        });
    }

    /// An edit of the user: compare once the typing pauses. A newer edit replaces the waiting task, which cancels it.
    fn edited(&mut self, _side: DiffSide, window: &mut Window, cx: &mut Context<Self>) {
        self.pending_recompare = Some(cx.spawn_in(window, async move |view, cx| {
            cx.background_executor().timer(RECOMPARE_DELAY).await;
            view.update(cx, |view, cx| {
                view.pending_recompare = None;
                let shown = view.recompare(ShownCause::Edit, cx);
                cx.emit(ReviewEvent::Recompared(shown));
            })
            .ok();
        }));
    }

    /// Compares the sides as the editors hold them now and shows the hunks.
    fn recompare(&mut self, cause: ShownCause, cx: &mut Context<Self>) -> Shown {
        let started = Instant::now();
        let [old_text, new_text] = DiffSide::BOTH.map(|side| self.text(side, cx));
        let differ_started = Instant::now();
        let hunks = self.active.line_hunks(&old_text, &new_text);
        let compare_time = differ_started.elapsed();
        let stats = DiffStats::of(&hunks);
        self.hunks = hunks;
        self.model.set(self.drawn_hunks(), &old_text, &new_text);
        self.refresh_sides(cx);
        let sides = [
            self.sides.state(DiffSide::Old, &old_text),
            self.sides.state(DiffSide::New, &new_text),
        ];
        self.summary = summary(&self.language, &stats, self.layout).into();
        cx.notify();
        Shown {
            path: self.path.to_string(),
            stats,
            line_differ: Some(self.active.line_differ().name().to_owned()),
            compare_time: Some(compare_time),
            update_time: Some(started.elapsed()),
            cause,
            sides,
            layout: self.layout,
        }
    }

    /// New hunks: both sides' spacer rows again, and the scroll positions they settle at.
    fn refresh_sides(&mut self, cx: &mut Context<Self>) {
        for editor in &self.editors {
            editor.update(cx, |state, cx| state.refresh_spacers(cx));
        }
        self.scroll_y = DiffSide::BOTH.map(|side| self.editor(side).read(cx).scroll_offset().y);
    }

    /// Padded level, both sides have the same rows, so one vertical offset suits both: whichever side moved since
    /// the last frame leads.
    fn synchronize_scroll(&mut self, cx: &mut Context<Self>) {
        let current = DiffSide::BOTH.map(|side| self.editor(side).read(cx).scroll_offset().y);
        // A file: the old side is not drawn, so it never moves and must not lead.
        if self.layout == Layout::File {
            self.scroll_y = current;
            return;
        }
        let source = if current[0] != self.scroll_y[0] {
            0
        } else if current[1] != self.scroll_y[1] {
            1
        } else {
            return;
        };
        let y = current[source];
        if current[1 - source] != y {
            self.editors[1 - source].update(cx, |state, cx| {
                let mut offset = state.scroll_offset();
                offset.y = y;
                state.set_scroll_offset(offset, cx);
            });
        }
        self.scroll_y = [y; 2];
    }
}

/// The new-side byte range a reveal selects, and whether the caret is at its start.
fn reveal_range(text: &Rope, reveal: Reveal) -> (Range<usize>, bool) {
    let last = text.lines_len().saturating_sub(1);
    let row = |line: u32| (line as usize).min(last);
    match reveal {
        Reveal::Line {
            line,
            column: Some(column),
        } => {
            let at = text.position_to_offset(&lsp_types::Position::new(row(line) as u32, column));
            (at..at, false)
        }
        Reveal::Line { line, column: None } => {
            let row = row(line);
            (text.line_start_offset(row)..text.line_end_offset(row), true)
        }
        Reveal::Hunk { start, lines: 0 } => {
            let at = text.line_start_offset(row(start));
            (at..at, false)
        }
        Reveal::Hunk { start, lines } => (
            text.line_start_offset(row(start))..text.line_end_offset(row(start + lines - 1)),
            true,
        ),
    }
}

fn summary(language: &str, stats: &DiffStats, layout: Layout) -> String {
    if layout == Layout::File {
        return language.to_owned();
    }
    let changes = match stats.changes {
        0 => "no differences".to_owned(),
        1 => format!("1 change · +{} −{}", stats.added, stats.removed),
        n => format!("{n} changes · +{} −{}", stats.added, stats.removed),
    };
    format!("{language} · {changes}")
}

fn editor_pane(state: &Entity<EditorState>, editable: bool) -> impl IntoElement {
    div()
        .flex_1()
        .min_w_0()
        .h_full()
        .child(Editor::new(state).readonly(!editable).bordered(false).size_full())
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
        if let Some(reveal) = self.pending_reveal.take() {
            // After the frame that lays the text out: the editor scrolls only within a layout it has.
            let view = cx.entity().downgrade();
            window.on_next_frame(move |_, cx| {
                let _ = view.update(cx, |view, cx| view.apply_reveal(reveal, cx));
            });
        }
        self.synchronize_scroll(cx);
        let panes = match self.layout {
            Layout::File => h_flex().flex_1().min_h_0().child(editor_pane(
                self.editor(DiffSide::New),
                self.sides.editable(DiffSide::New),
            )),
            Layout::Diff => h_flex()
                .flex_1()
                .min_h_0()
                .child(editor_pane(
                    self.editor(DiffSide::Old),
                    self.sides.editable(DiffSide::Old),
                ))
                .child(div().w_px().h_full().bg(cx.theme().border))
                .child(editor_pane(
                    self.editor(DiffSide::New),
                    self.sides.editable(DiffSide::New),
                )),
        };
        v_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(panes)
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
        assert_eq!(
            summary("rust", &stats(4, 17, 6), Layout::Diff),
            "rust · 4 changes · +17 −6"
        );
        assert_eq!(
            summary("text", &stats(1, 0, 2), Layout::Diff),
            "text · 1 change · +0 −2"
        );
        assert_eq!(
            summary("python", &stats(0, 0, 0), Layout::Diff),
            "python · no differences"
        );
        assert_eq!(summary("rust", &stats(4, 17, 6), Layout::File), "rust");
    }

    #[test]
    fn layouts_have_names_at_the_host_boundary() {
        for layout in [Layout::File, Layout::Diff] {
            assert_eq!(Layout::from_name(layout.name()), Some(layout));
        }
        assert_eq!(Layout::default(), Layout::Diff);
        assert_eq!(Layout::from_name("split"), None);
    }

    #[test]
    fn a_reveal_selects_the_line_or_the_hunk_on_the_new_side() {
        let text = Rope::from("zero\none\ntwo\nthree\n");
        let line = |line, column| reveal_range(&text, Reveal::Line { line, column });
        let hunk = |start, lines| reveal_range(&text, Reveal::Hunk { start, lines });
        // A line: selected, the caret at its start; with a column, the caret there.
        assert_eq!(line(1, None), (5..8, true));
        assert_eq!(line(2, Some(1)), (10..10, false));
        // Past the end: the last line (the empty one after the final newline).
        assert_eq!(line(99, None), (19..19, true));
        // A hunk of two lines, and a deletion (no new lines): the caret where the lines were.
        assert_eq!(hunk(1, 2), (5..12, true));
        assert_eq!(hunk(3, 0), (13..13, false));
    }
}

/// The view in gpui's test app (feature `view-tests`): read-only by default, the comparison following the user's
/// edits once the typing pauses, and the host's calls keeping or replacing what the user typed.
#[cfg(all(test, feature = "view-tests"))]
mod editing_tests {
    use std::{cell::RefCell, rc::Rc};

    use gpui::{TestAppContext, VisualTestContext};

    use super::*;

    #[cfg(target_os = "macos")]
    const UNDO: &str = "cmd-z";
    #[cfg(not(target_os = "macos"))]
    const UNDO: &str = "ctrl-z";

    struct Opened<'a> {
        view: Entity<ReviewView>,
        cx: &'a mut VisualTestContext,
        recompared: Rc<RefCell<Vec<Shown>>>,
    }

    impl Opened<'_> {
        fn draw(&mut self) {
            VisualTestContext::update(self.cx, |window, cx| window.draw(cx).clear(cx));
        }

        fn compare(&mut self, old: &str, new: &str) -> Shown {
            let texts = Texts {
                path: "a.txt".into(),
                language: "text".into(),
                old_text: old.into(),
                new_text: new.into(),
            };
            let shown = self
                .view
                .update_in(self.cx, |view, window, cx| {
                    view.compare(texts, &CompareOptions::default(), window, cx)
                })
                .unwrap();
            self.draw();
            shown
        }

        fn editable(&mut self, side: DiffSide, editable: bool) {
            self.view.update_in(self.cx, |view, window, cx| {
                view.set_editable(side, editable, true, window, cx)
            });
            self.draw();
        }

        fn focus(&mut self, side: DiffSide) {
            self.view
                .update_in(self.cx, |view, window, cx| view.focus(side, window, cx));
            self.draw();
        }

        fn text(&mut self, side: DiffSide) -> String {
            self.cx.read(|cx| self.view.read(cx).text(side, cx))
        }

        /// Lets time pass, as the user pausing.
        fn pause(&mut self, time: Duration) {
            self.cx.executor().advance_clock(time);
            self.cx.run_until_parked();
        }
    }

    fn open(cx: &mut TestAppContext) -> Opened<'_> {
        cx.update(gpui_component::init);
        let (view, cx) = cx.add_window_view(|window, cx| ReviewView::builder().build(window, cx));
        let recompared = Rc::new(RefCell::new(Vec::new()));
        let sink = recompared.clone();
        cx.update(|_, cx| {
            cx.subscribe(&view, move |_, event: &ReviewEvent, _| {
                if let ReviewEvent::Recompared(shown) = event {
                    sink.borrow_mut().push(shown.clone());
                }
            })
            .detach()
        });
        let mut opened = Opened { view, cx, recompared };
        opened.draw();
        opened
    }

    #[gpui::test]
    fn both_sides_are_read_only_until_made_editable(cx: &mut TestAppContext) {
        let mut o = open(cx);
        let shown = o.compare("a\nb\n", "a\nb\n");
        assert_eq!(shown.stats.changes, 0);
        assert!(shown.sides.iter().all(|side| !side.editable && !side.modified));
        o.focus(DiffSide::New);
        o.cx.simulate_input("x");
        o.pause(RECOMPARE_DELAY * 2);
        assert_eq!(o.text(DiffSide::New), "a\nb\n");
        assert!(o.recompared.borrow().is_empty());
    }

    #[gpui::test]
    fn edits_are_compared_once_the_typing_pauses(cx: &mut TestAppContext) {
        let mut o = open(cx);
        o.compare("a\nb\n", "a\nb\n");
        o.editable(DiffSide::New, true);
        // A burst of typing: nothing is compared while it goes on.
        for key in ["x", "y", "z"] {
            o.cx.simulate_input(key);
            o.pause(RECOMPARE_DELAY / 3);
        }
        assert!(o.recompared.borrow().is_empty(), "compared before the typing paused");
        o.pause(RECOMPARE_DELAY);
        let recompared = o.recompared.borrow().clone();
        assert_eq!(recompared.len(), 1, "one comparison per burst");
        let shown = &recompared[0];
        assert_eq!(shown.cause, ShownCause::Edit);
        assert_eq!(shown.stats.changes, 1);
        assert_eq!(
            shown.sides,
            [
                SideState {
                    editable: false,
                    modified: false,
                    empty: false
                },
                SideState {
                    editable: true,
                    modified: true,
                    empty: false
                }
            ]
        );
        assert_eq!(o.text(DiffSide::New), "xyza\nb\n");
        // Undo back to the loaded text: compared again, not modified any more.
        o.cx.simulate_keystrokes(UNDO);
        o.pause(RECOMPARE_DELAY);
        let last = o.recompared.borrow().last().cloned().unwrap();
        assert_eq!(o.text(DiffSide::New), "a\nb\n");
        assert_eq!((last.stats.changes, last.sides[1].modified), (0, false));
        // Read-only again: the text stays, typing is refused.
        o.editable(DiffSide::New, false);
        o.cx.simulate_input("q");
        o.pause(RECOMPARE_DELAY);
        assert_eq!(o.text(DiffSide::New), "a\nb\n");
    }

    #[gpui::test]
    fn a_host_call_keeps_the_edits_of_the_other_side_and_cancels_a_waiting_comparison(cx: &mut TestAppContext) {
        let mut o = open(cx);
        o.compare("a\n", "a\n");
        o.editable(DiffSide::New, true);
        o.cx.simulate_input("b");
        // The host replaces the old side before the typing paused: compared now, with the edit, and only once.
        let shown = o.view.update_in(o.cx, |view, window, cx| {
            view.set_text(DiffSide::Old, "c\n".into(), None, window, cx)
        });
        assert_eq!((shown.cause, shown.stats.changes), (ShownCause::Request, 1));
        assert!(shown.sides[1].modified && !shown.sides[0].modified);
        o.pause(RECOMPARE_DELAY * 2);
        assert!(
            o.recompared.borrow().is_empty(),
            "the waiting comparison was not cancelled"
        );
        assert_eq!([o.text(DiffSide::Old), o.text(DiffSide::New)], ["c\n", "ba\n"]);
    }

    #[gpui::test]
    fn a_swap_carries_texts_baselines_and_permission(cx: &mut TestAppContext) {
        let mut o = open(cx);
        o.compare("left\n", "right\n");
        o.editable(DiffSide::New, true);
        o.cx.simulate_input("!");
        o.pause(RECOMPARE_DELAY);
        let shown = o.view.update_in(o.cx, |view, window, cx| view.swap(window, cx));
        assert_eq!([o.text(DiffSide::Old), o.text(DiffSide::New)], ["!right\n", "left\n"]);
        assert!(shown.sides[0].editable && shown.sides[0].modified);
        assert!(!shown.sides[1].editable && !shown.sides[1].modified);
        // Saved: the new baseline.
        let saved = o.view.update_in(o.cx, |view, _, cx| {
            view.mark_saved(DiffSide::Old, "!right\n".into(), cx)
        });
        assert!(!saved.sides[0].modified);
    }

    fn show_file(o: &mut Opened<'_>, text: &str, read_only: bool) -> Shown {
        let document = FileDocument {
            path: "a.txt".into(),
            language: "text".into(),
            text: text.into(),
            read_only,
        };
        let shown = o
            .view
            .update_in(o.cx, |view, window, cx| view.show_file(document, window, cx));
        o.draw();
        shown
    }

    #[gpui::test]
    fn a_file_is_shown_alone_and_the_diff_layout_shows_its_edits(cx: &mut TestAppContext) {
        let mut o = open(cx);
        let shown = show_file(&mut o, "a\nb\n", false);
        assert_eq!((shown.layout, shown.stats.changes), (Layout::File, 0));
        assert!(shown.sides[1].editable && !shown.sides[0].editable);
        o.focus(DiffSide::New);
        o.cx.simulate_input("x");
        o.pause(RECOMPARE_DELAY);
        let edited = o.recompared.borrow().last().cloned().unwrap();
        assert_eq!(
            (edited.layout, edited.stats.changes, edited.sides[1].modified),
            (Layout::File, 1, true)
        );
        // The diff layout: the text as shown on the left, the edit on the right; and back.
        let diff = o.view.update(o.cx, |view, cx| view.set_layout(Layout::Diff, cx));
        assert_eq!((diff.layout, diff.stats.changes), (Layout::Diff, 1));
        assert_eq!([o.text(DiffSide::Old), o.text(DiffSide::New)], ["a\nb\n", "xa\nb\n"]);
        let file = o.view.update(o.cx, |view, cx| view.set_layout(Layout::File, cx));
        assert_eq!((file.layout, file.sides[1].modified), (Layout::File, true));
        // A read-only file refuses typing.
        let shown = show_file(&mut o, "c\n", true);
        assert!(!shown.sides[1].editable && !shown.sides[1].modified);
        o.focus(DiffSide::New);
        o.cx.simulate_input("q");
        o.pause(RECOMPARE_DELAY);
        assert_eq!(o.text(DiffSide::New), "c\n");
        // Two texts compared: the diff layout again.
        assert_eq!(o.compare("a\n", "b\n").layout, Layout::Diff);
    }

    #[gpui::test]
    fn a_hunk_or_a_line_is_revealed_once_the_text_is_laid_out(cx: &mut TestAppContext) {
        let mut o = open(cx);
        o.compare("a\nb\nc\n", "a\nB\nc\nd\n");
        let refused = o.view.update(o.cx, |view, cx| view.reveal_hunk(2, cx));
        assert_eq!(refused, Err("no hunk 2: the view shows 2 (0 to 1)".to_owned()));
        // The reveal waits for the frame after the next draw (gpui's test window runs no frame callbacks); then it
        // selects on the new side.
        let reveal = |o: &mut Opened<'_>, ask: &dyn Fn(&mut ReviewView, &mut Context<ReviewView>)| {
            o.view.update(o.cx, |view, cx| {
                ask(view, cx);
                let reveal = view.pending_reveal.take();
                if let Some(reveal) = reveal {
                    view.apply_reveal(reveal, cx);
                }
                (reveal, view.editors[1].read(cx).selected_range())
            })
        };
        assert_eq!(
            reveal(&mut o, &|view, cx| view.reveal_hunk(1, cx).unwrap()),
            (Some(Reveal::Hunk { start: 3, lines: 1 }), 6..7)
        );
        assert_eq!(
            reveal(&mut o, &|view, cx| view.reveal_line(1, None, cx)),
            (Some(Reveal::Line { line: 1, column: None }), 2..3)
        );
    }

    /// A grammar that arrives after its text is shown (feature `grammar-files`): the view highlights again when the
    /// text is in that language, and leaves it alone otherwise.
    #[cfg(feature = "grammar-files")]
    #[gpui::test]
    fn a_grammar_that_arrives_repaints_only_the_text_in_its_language(cx: &mut TestAppContext) {
        use gpui_component::highlighter::LanguageRegistry;

        use crate::grammars::{GrammarFile, register};

        let mut o = open(cx);
        let texts = Texts {
            path: "a.late".into(),
            language: "test-late".into(),
            old_text: "[1]\n".into(),
            new_text: "[2]\n".into(),
        };
        o.view
            .update_in(o.cx, |view, window, cx| {
                view.compare(texts, &CompareOptions::default(), window, cx)
            })
            .unwrap();
        o.draw();
        let json = LanguageRegistry::singleton()
            .language("json")
            .and_then(|config| config.language)
            .unwrap();
        let file = GrammarFile {
            id: "test-late".into(),
            abi: json.abi_version(),
            injects: vec![],
            highlights: "(number) @number".into(),
            injections: String::new(),
            locals: String::new(),
        };
        register(&file, json).unwrap();
        assert!(
            !o.view
                .update(o.cx, |view, cx| view.grammar_arrived("test-elsewhere", cx))
        );
        assert!(o.view.update(o.cx, |view, cx| view.grammar_arrived("test-late", cx)));
        o.draw();
        assert_eq!(o.text(DiffSide::New), "[2]\n");
    }
}
