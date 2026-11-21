//! The review view in a native window: two files, or a generated pair, compared and shown side by side.
//!
//!   cargo run -p review-view --features window-example --example window [-- <old> <new>]
//!   cargo run -p review-view --features window-example --example window -- --large 50000
//!   cargo run -p review-view --features window-example --example window -- --case delete-end
//!
//! Without files it compares `fixtures/old.rs` with `fixtures/new.rs`. `--large <lines>` is the pair of
//! `examples/measure.rs` (in every thousand lines a modification, a deletion and an insertion). `--case <name>` is one
//! of the pairs around the end of a long file ([`CASES`]; docs/extension-structure.md §11.8).
//!
//! `REVIEW_SCROLL_Y=<px>` scrolls the new side down by that many pixels after the first frame, as a wheel does (the
//! editor's offset changes and the editor notifies); the view carries it to the old side. `REVIEW_INPUT=wheel|keys`
//! scrolls the new side to the end with input events instead: wheel events over it, or the keystroke that moves the
//! caret to the end. Each side's offset is then printed to stderr, so the level can be checked without looking at the
//! window. A drag of the scroll bar's thumb is checked in the browser (scripts/e2e-check.mjs): mouse events sent from
//! here did not move the thumb.

use std::{path::PathBuf, time::Duration};

use gpui::{
    AnyWindowHandle, App, AppContext as _, AsyncApp, Bounds, Entity, Keystroke, Modifiers, MouseMoveEvent,
    PlatformInput, ScrollDelta, ScrollEvent, TitlebarOptions, WindowBounds, WindowOptions, point, px, size,
};
use gpui_component::Root;
use review_view::{CompareOptions, ReviewEvent, ReviewView, Texts};

const WINDOW: (f32, f32) = (1280., 800.);

fn line(i: usize) -> String {
    format!("    let value_{i} = compute({i}, \"row {i}\");")
}

fn lines(range: std::ops::Range<usize>) -> Vec<String> {
    range.map(line).collect()
}

fn large_pair(line_count: usize) -> (String, String) {
    let (mut old, mut new) = (Vec::new(), Vec::new());
    for i in 0..line_count {
        old.push(line(i));
        match i % 1000 {
            100 => new.push(format!("    let value_{i} = compute({i}, \"row {i}\") + 1;")),
            400 => {}
            700 => {
                new.push(line(i));
                new.push(format!("    log(\"inserted after {i}\");"));
            }
            _ => new.push(line(i)),
        }
    }
    (old.join("\n") + "\n", new.join("\n") + "\n")
}

/// The pairs around the end of a long file, by name: where the blank rows that keep the sides level stand, and how
/// many there are.
const CASES: [&str; 7] = [
    "delete-near-end",
    "delete-end",
    "insert-end",
    "start",
    "end-block",
    "short",
    "no-spacers",
];

fn case_pair(name: &str) -> (String, String) {
    let text = |lines: Vec<String>| lines.join("\n") + "\n";
    match name {
        // 60 lines deleted 40 lines before the end: 60 blank rows near the end of the new side.
        "delete-near-end" => (
            text(lines(0..50_000)),
            text(lines(0..49_900).into_iter().chain(lines(49_960..50_000)).collect()),
        ),
        // The last 60 lines deleted: 60 blank rows at the end of the new side.
        "delete-end" => (text(lines(0..50_000)), text(lines(0..49_940))),
        // 60 lines appended: 60 blank rows at the end of the old side.
        "insert-end" => (text(lines(0..49_940)), text(lines(0..50_000))),
        // 60 lines inserted before the first one: 60 blank rows above the old side's first line.
        "start" => (
            text(lines(0..2_000)),
            text(
                (0..60)
                    .map(|i| format!("    // added {i}"))
                    .chain(lines(0..2_000))
                    .collect(),
            ),
        ),
        // No newline at the end, and 60 lines appended: the old side's 60 blank rows stand below its last line.
        "end-block" => (lines(0..2_000).join("\n"), lines(0..2_060).join("\n")),
        // Shorter than the window: a deletion and an insertion, blank rows on both sides.
        "short" => {
            let old = lines(0..10);
            let mut new = old.clone();
            new.remove(3);
            new.splice(6..6, (0..3).map(|i| format!("    // added {i}")));
            (text(old), text(new))
        }
        // Only modified lines: no blank rows on either side.
        "no-spacers" => {
            let old = lines(0..2_000);
            let new = old
                .iter()
                .enumerate()
                .map(|(i, l)| {
                    if i % 100 == 50 {
                        format!("{l} // changed")
                    } else {
                        l.clone()
                    }
                })
                .collect();
            (text(old), text(new))
        }
        _ => panic!("--case {name}: one of {}", CASES.join(", ")),
    }
}

fn texts() -> Texts {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let generated = |path: String, (old_text, new_text): (String, String)| Texts {
        path,
        language: "rust".into(),
        old_text,
        new_text,
    };
    match args.as_slice() {
        [flag, lines] if flag == "--large" => {
            return generated(
                format!("large-{lines}.rs"),
                large_pair(lines.parse().expect("--large <lines>")),
            );
        }
        [flag, name] if flag == "--case" => return generated(format!("{name}.rs"), case_pair(name)),
        _ => {}
    }
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures");
    let (old, new) = match args.as_slice() {
        [old, new] => (PathBuf::from(old), PathBuf::from(new)),
        _ => (fixtures.join("old.rs"), fixtures.join("new.rs")),
    };
    let read = |path: &PathBuf| std::fs::read_to_string(path).unwrap_or_else(|err| panic!("{}: {err}", path.display()));
    Texts {
        path: new
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        language: new
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| if e == "rs" { "rust" } else { e })
            .unwrap_or_default()
            .to_owned(),
        old_text: read(&old),
        new_text: read(&new),
    }
}

fn offsets(view: &Entity<ReviewView>, cx: &App) -> [f32; 2] {
    view.read(cx)
        .editors()
        .map(|editor| f32::from(editor.read(cx).scroll_offset().y))
}

/// Sends input events to the window, a frame apart, as a person would.
async fn send(window: AnyWindowHandle, events: Vec<PlatformInput>, cx: &mut AsyncApp) {
    for event in events {
        cx.background_executor().timer(Duration::from_millis(50)).await;
        let _ = cx.update_window(window, |_, window, cx| window.dispatch_event(event, cx));
    }
}

/// Scrolls the new side (the right half of the window) to the end with input events.
async fn scroll_to_end(input: &str, view: Entity<ReviewView>, window: AnyWindowHandle, cx: &mut AsyncApp) {
    match input {
        "wheel" => {
            let position = point(px(WINDOW.0 * 0.75), px(WINDOW.1 / 2.));
            let mut events = vec![PlatformInput::MouseMove(MouseMoveEvent {
                position,
                pressed_button: None,
                modifiers: Modifiers::default(),
            })];
            events.extend((0..40).map(|_| {
                PlatformInput::Scroll(ScrollEvent {
                    position,
                    delta: ScrollDelta::Pixels(point(px(0.), px(-40_000.))),
                    ..Default::default()
                })
            }));
            send(window, events, cx).await;
        }
        "keys" => {
            let new_side = cx.update(|cx| view.read(cx).editors()[1].clone());
            let keystroke = if cfg!(target_os = "macos") {
                "cmd-down"
            } else {
                "ctrl-end"
            };
            let _ = cx.update_window(window, |_, window, cx| {
                new_side.update(cx, |state, cx| state.focus(window, cx));
                window.dispatch_keystroke(Keystroke::parse(keystroke).expect("a keystroke"), cx);
            });
        }
        _ => panic!("REVIEW_INPUT={input}: one of wheel, keys"),
    }
}

fn main() {
    let texts = texts();
    let scroll_y = std::env::var("REVIEW_SCROLL_Y")
        .ok()
        .and_then(|v| v.parse::<f32>().ok());
    let input = std::env::var("REVIEW_INPUT").ok();

    gpui_platform::application()
        .with_assets(gpui_kit_assets::Assets)
        .run(move |cx| {
            gpui_component::init(cx);
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    point(px(80.), px(80.)),
                    size(px(WINDOW.0), px(WINDOW.1)),
                ))),
                titlebar: Some(TitlebarOptions {
                    title: Some("review-view".into()),
                    ..Default::default()
                }),
                ..Default::default()
            };
            cx.open_window(options, |window, cx| {
                let handle = window.window_handle();
                let view = cx.new(|cx| ReviewView::builder().build(window, cx));
                let shown = view.update(cx, |view, cx| {
                    view.compare(texts, &CompareOptions::default(), window, cx)
                });
                match shown {
                    Ok(shown) => eprintln!(
                        "shown {}: {} changes, +{} -{}, {} in {:?}",
                        shown.path,
                        shown.stats.changes,
                        shown.stats.added,
                        shown.stats.removed,
                        shown.line_differ.as_deref().unwrap_or("-"),
                        shown.compare_time.unwrap_or_default(),
                    ),
                    Err(err) => eprintln!("compare: {err}"),
                }
                cx.subscribe(&view, move |view, event, cx| match event {
                    ReviewEvent::FirstFrame => {
                        eprintln!("first frame; offsets old/new {:?}", offsets(&view, cx));
                        if scroll_y.is_none() && input.is_none() {
                            return;
                        }
                        let input = input.clone();
                        cx.spawn(async move |cx| {
                            // A frame later, once the view has settled where the first frame left each side.
                            cx.background_executor().timer(Duration::from_millis(200)).await;
                            if let Some(y) = scroll_y {
                                cx.update(|cx| {
                                    let new_side = view.read(cx).editors()[1].clone();
                                    new_side.update(cx, |state, cx| {
                                        let mut offset = state.scroll_offset();
                                        offset.y = px(-y);
                                        state.set_scroll_offset(offset, cx);
                                        cx.notify();
                                    });
                                });
                            }
                            if let Some(input) = input {
                                scroll_to_end(&input, view.clone(), handle, cx).await;
                            }
                            for _ in 0..3 {
                                cx.background_executor().timer(Duration::from_millis(400)).await;
                                cx.update(|cx| eprintln!("after scroll; offsets old/new {:?}", offsets(&view, cx)));
                            }
                        })
                        .detach();
                    }
                    // Both sides stay read-only here: no edits to follow.
                    ReviewEvent::Recompared(_) => {}
                })
                .detach();
                cx.new(|cx| Root::new(view, window, cx))
            })
            .expect("open the window");
            cx.activate(true);
        });
}
