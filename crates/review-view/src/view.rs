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

use std::{rc::Rc, sync::Arc, time::Duration};

use gpui::{
    AppContext as _, Context, Entity, EventEmitter, Focusable as _, IntoElement, ParentElement as _, Pixels, Render,
    SharedString, Styled as _, Subscription, Task, Window, div, px,
};
use gpui_component::{
    ActiveTheme as _, Side, h_flex,
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
        let stats = DiffStats::of(&hunks);
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
        self.summary = summary(&self.language, &stats).into();
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
        }
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
        self.model.set(hunks, &old_text, &new_text);
        self.refresh_sides(cx);
        let sides = [
            self.sides.state(DiffSide::Old, &old_text),
            self.sides.state(DiffSide::New, &new_text),
        ];
        self.summary = summary(&self.language, &stats).into();
        cx.notify();
        Shown {
            path: self.path.to_string(),
            stats,
            line_differ: Some(self.active.line_differ().name().to_owned()),
            compare_time: Some(compare_time),
            update_time: Some(started.elapsed()),
            cause,
            sides,
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

fn summary(language: &str, stats: &DiffStats) -> String {
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
        self.synchronize_scroll(cx);
        v_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(
                h_flex()
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
}
