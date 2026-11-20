//! A probe, not the feature (cargo feature `probe`, never in the shipped module): can the editor paint a background
//! behind a range of characters inside a line, as the changed words of a changed line? Findings:
//! docs/research/inline-range-background.md; the page that drives it: docs/research/inline-range-background/probe.mjs.
//!
//! One export, `probe_ranges(scenario)`. Texts and ranges are hard-coded; nothing here computes a word diff.
//!
//! - `show-geometry`, `show-wrap`, `show-large`: compare a built-in pair (through the view, as `compare_texts` does);
//! - `fill-geometry`, `text-geometry`: the geometry cases as `Fill` range decorations or as text decorations with a
//!   background colour; `fill-wrap`, `text-wrap` the same over a soft-wrapped line;
//! - `fill-many`, `text-many`: 5 000 ranges per side over the large pair (every tenth line);
//! - `wrap-on`, `wrap-off`: soft wrap of both editors; `select`: a selection over part of a range on the new side,
//!   with the new side focused;
//! - `offsets`: each side's vertical scroll offset; `scroll-end`, `scroll-top`: scroll the new side to an end;
//! - `inspect`: what each collection holds now; `clear`: empty every collection.
//!
//! Colours: a word is the colour of its line's background at 30 % instead of 12 % (what gpui-kit's own diff
//! component does for inline changes).

use std::{cell::RefCell, ops::Range};

use gpui::{App, Context, Entity, HighlightStyle, Hsla, Window};
use gpui_component::{
    ActiveTheme as _,
    input::{
        EditorState, RangeDecoration, RangeDecorationCollection, RangeDecorationStyle, TextDecoration,
        TextDecorationCollection,
    },
};
use review_view::{CompareOptions, ReviewView, Texts};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;

use crate::with_view;

thread_local! {
    /// One collection of each kind per editor, old side first; created on first use.
    static FILLS: RefCell<[Option<RangeDecorationCollection>; 2]> = const { RefCell::new([None, None]) };
    static TEXTS: RefCell<[Option<TextDecorationCollection>; 2]> = const { RefCell::new([None, None]) };
}

const GEOMETRY_OLD: &str = "fn main() {
    let total = compute(alpha, beta);
    let name = \"привет, 世界 🙂\";
\tlet tabbed\t= old_value;
    let first = 1;
    let second = 2;
    println!(\"{total} {name}\");
}
";

const GEOMETRY_NEW: &str = "fn main() {
    let total = compute(gamma, beta, delta);
    let name = \"привет, 世界 🙃 мир\";
\tlet tabbed\t= new_value;
    let first = 10;
    let second = 20;
    println!(\"{total} {name}!\");
}
";

/// The geometry cases: (what, the text the range covers, or for an empty range the text it follows).
const OLD_CASES: &[(&str, &str)] = &[
    ("middle of a line", "alpha"),
    ("empty range (an insertion point) after", "beta"),
    ("CJK and an emoji", "世界 🙂"),
    ("from the line start, over a tab", "\tlet"),
    ("over two lines", "1;\n    let second = 2"),
    ("to the end of the line", "{name}\");"),
    ("on an unchanged line", "main"),
];
const NEW_CASES: &[(&str, &str)] = &[
    ("middle of a line", "gamma"),
    ("middle of a line, second range", ", delta"),
    ("an emoji and Cyrillic", "🙃 мир"),
    ("across a tab", "\t= new"),
    ("over two lines", "10;\n    let second = 20"),
    ("from the line start", "    println"),
    ("to the end of the line and its newline", "!\");\n"),
    ("on an unchanged line", "main"),
];

const WRAP_OLD: &str = "fn wrapped() {
    let message = \"the quick brown fox jumps over the lazy dog, then the quick brown fox jumps over the lazy dog once more, and a third time the fox jumps over the sleepy dog before it rests\";
}
";
const WRAP_NEW: &str = "fn wrapped() {
    let message = \"the quick brown fox jumps over the lazy dog, then the quick brown fox leaps across the lazy dog once more, and a third time the fox jumps over the sleepy dog before it rests\";
}
";

fn large_pair(line_count: usize) -> (String, String) {
    let base = |i: usize| format!("    let value_{i} = compute({i}, \"row {i}\");");
    let (mut old, mut new) = (Vec::new(), Vec::new());
    for i in 0..line_count {
        old.push(base(i));
        match i % 1000 {
            100 => new.push(format!("    let value_{i} = compute({i}, \"row {i}\") + 1;")),
            400 => {}
            700 => {
                new.push(base(i));
                new.push(format!("    log(\"inserted after {i}\");"));
            }
            _ => new.push(base(i)),
        }
    }
    (old.join("\n") + "\n", new.join("\n") + "\n")
}

/// Which background a word gets: the line's colour, stronger.
fn word_color(cx: &App) -> Hsla {
    cx.theme().info.opacity(0.3)
}

fn ranges_of(text: &str, cases: &[(&str, &str)]) -> Vec<(String, Range<usize>)> {
    cases
        .iter()
        .filter_map(|(what, needle)| {
            let start = text.find(needle)?;
            let range = if what.starts_with("empty range") {
                start + needle.len()..start + needle.len()
            } else {
                start..start + needle.len()
            };
            Some(((*what).to_owned(), range))
        })
        .collect()
}

/// Every tenth line: the word `compute`.
fn many_ranges(text: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut offset = 0;
    for (row, line) in text.split('\n').enumerate() {
        if row % 10 == 0
            && let Some(at) = line.find("compute")
        {
            out.push(offset + at..offset + at + "compute".len());
        }
        offset += line.len() + 1;
    }
    out
}

fn fills(editor: &Entity<EditorState>, side: usize, cx: &mut App) -> RangeDecorationCollection {
    FILLS.with(|slot| {
        slot.borrow_mut()[side]
            .get_or_insert_with(|| editor.update(cx, |state, cx| state.create_range_decorations_collection(vec![], cx)))
            .clone()
    })
}

fn texts(editor: &Entity<EditorState>, side: usize, cx: &mut App) -> TextDecorationCollection {
    TEXTS.with(|slot| {
        slot.borrow_mut()[side]
            .get_or_insert_with(|| editor.update(cx, |state, cx| state.create_decorations_collection(vec![], cx)))
            .clone()
    })
}

#[derive(Clone, Copy, PartialEq)]
enum Route {
    Fill,
    Text,
}

fn set(route: Route, editor: &Entity<EditorState>, side: usize, ranges: Vec<Range<usize>>, color: Hsla, cx: &mut App) {
    match route {
        Route::Fill => fills(editor, side, cx).set(
            ranges
                .into_iter()
                .map(|range| {
                    RangeDecoration::new(range)
                        .with_style(RangeDecorationStyle::Fill)
                        .with_color(color)
                })
                .collect(),
            cx,
        ),
        Route::Text => texts(editor, side, cx).set(
            ranges
                .into_iter()
                .map(|range| {
                    TextDecoration::new(
                        range,
                        HighlightStyle {
                            background_color: Some(color),
                            ..Default::default()
                        },
                    )
                })
                .collect(),
            cx,
        ),
    }
}

fn show(
    view: &mut ReviewView,
    old: &str,
    new: &str,
    path: &str,
    window: &mut Window,
    cx: &mut Context<ReviewView>,
) -> Value {
    let texts = Texts {
        path: path.into(),
        language: "rust".into(),
        old_text: old.into(),
        new_text: new.into(),
    };
    match view.compare(texts, &CompareOptions::default(), window, cx) {
        Ok(shown) => {
            json!({ "changes": shown.stats.changes, "added": shown.stats.added, "removed": shown.stats.removed })
        }
        Err(err) => json!({ "error": err.to_string() }),
    }
}

fn run(
    scenario: &str,
    view: &mut ReviewView,
    window: &mut Window,
    cx: &mut Context<ReviewView>,
) -> Result<Value, String> {
    let editors: [Entity<EditorState>; 2] = view.editors().map(Clone::clone);
    let text = |side: usize, cx: &App| editors[side].read(cx).value().to_string();
    let route = |name: &str| {
        if name.starts_with("fill") {
            Route::Fill
        } else {
            Route::Text
        }
    };
    Ok(match scenario {
        "show-geometry" => show(view, GEOMETRY_OLD, GEOMETRY_NEW, "geometry.rs", window, cx),
        "show-wrap" => show(view, WRAP_OLD, WRAP_NEW, "wrap.rs", window, cx),
        "show-large" => {
            let (old, new) = large_pair(50_000);
            show(view, &old, &new, "large.rs", window, cx)
        }
        "fill-geometry" | "text-geometry" => {
            let color = word_color(cx);
            let mut placed = Vec::new();
            for (side, cases) in [OLD_CASES, NEW_CASES].into_iter().enumerate() {
                let ranges = ranges_of(&text(side, cx), cases);
                placed.push(json!(
                    ranges
                        .iter()
                        .map(|(what, r)| json!({ "what": what, "range": [r.start, r.end] }))
                        .collect::<Vec<_>>()
                ));
                set(
                    route(scenario),
                    &editors[side],
                    side,
                    ranges.into_iter().map(|(_, r)| r).collect(),
                    color,
                    cx,
                );
            }
            json!({ "old": placed[0], "new": placed[1] })
        }
        "fill-wrap" | "text-wrap" => {
            let color = word_color(cx);
            for (side, editor) in editors.iter().enumerate() {
                let value = text(side, cx);
                // Across the place where the line wraps at the probe's width, and the changed words.
                let ranges = [
                    "brown fox jumps over",
                    "brown fox leaps across",
                    "the fox jumps over the sleepy",
                ]
                .iter()
                .filter_map(|needle| value.rfind(needle).map(|at| at..at + needle.len()))
                .collect();
                set(route(scenario), editor, side, ranges, color, cx);
            }
            json!({})
        }
        "fill-many" | "text-many" => {
            let color = word_color(cx);
            let mut counts = Vec::new();
            for (side, editor) in editors.iter().enumerate() {
                let ranges = many_ranges(&text(side, cx));
                counts.push(ranges.len());
                set(route(scenario), editor, side, ranges, color, cx);
            }
            json!({ "ranges": counts })
        }
        "wrap-on" | "wrap-off" => {
            for editor in &editors {
                editor.update(cx, |state, cx| state.set_soft_wrap(scenario == "wrap-on", window, cx));
            }
            json!({})
        }
        "select" => {
            let value = text(1, cx);
            let at = value.find("gamma, beta").ok_or("no geometry text on the new side")?;
            editors[1].update(cx, |state, cx| {
                state.set_selected_range(at + 2..at + 9, cx);
                state.focus(window, cx);
            });
            json!({ "selected": [at + 2, at + 9] })
        }
        "offsets" => json!(
            editors
                .iter()
                .map(|e| f32::from(e.read(cx).scroll_offset().y))
                .collect::<Vec<_>>()
        ),
        "scroll-end" | "scroll-top" => {
            editors[1].update(cx, |state, cx| {
                let mut offset = state.scroll_offset();
                offset.y = gpui::px(if scenario == "scroll-end" { -1.0e9 } else { 0. });
                state.set_scroll_offset(offset, cx);
                cx.notify();
            });
            json!({})
        }
        "inspect" => {
            let mut sides = Vec::new();
            for (side, editor) in editors.iter().enumerate() {
                let len = editor.read(cx).value().len();
                let fill = FILLS.with(|slot| slot.borrow()[side].as_ref().map(|c| c.get_ranges(cx)));
                let text_ranges = TEXTS.with(|slot| slot.borrow()[side].as_ref().map(|c| c.get_ranges(cx)));
                let sample = |ranges: &Option<Vec<Range<usize>>>| {
                    ranges.as_ref().map(|r| {
                        json!({
                            "count": r.len(),
                            "first": r.iter().take(3).map(|r| [r.start, r.end]).collect::<Vec<_>>(),
                            "wholeText": r.iter().filter(|r| r.start == 0 && r.end >= len.saturating_sub(1)).count(),
                        })
                    })
                };
                sides.push(json!({ "textLen": len, "fill": sample(&fill), "text": sample(&text_ranges) }));
            }
            json!({ "old": sides[0], "new": sides[1] })
        }
        "clear" => {
            for side in 0..2 {
                if let Some(c) = FILLS.with(|slot| slot.borrow()[side].clone()) {
                    c.clear(cx);
                }
                if let Some(c) = TEXTS.with(|slot| slot.borrow()[side].clone()) {
                    c.clear(cx);
                }
            }
            json!({})
        }
        other => return Err(format!("unknown scenario {other:?}")),
    })
}

/// Runs one hard-coded scenario on the view; the answer is JSON.
#[wasm_bindgen]
pub fn probe_ranges(scenario: String) -> Result<String, JsValue> {
    with_view("probe_ranges", |view, window, cx| run(&scenario, view, window, cx)).map(|value| value.to_string())
}
