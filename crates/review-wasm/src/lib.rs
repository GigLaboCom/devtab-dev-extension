//! review-wasm: the review view (`review-view`) on a web page. A thin layer: it starts gpui on the page's canvas,
//! embeds the fonts and icons the browser does not have, and turns the exports' JSON into calls on the view. The
//! page owns transport and data; comparing and drawing happen in the view.
//!
//! Exports (wasm-bindgen):
//!
//! - `run(options_json)` — start: an empty view, drawn in the given theme;
//! - `set_theme(dark, name, theme_set_json)` — switch the theme at run time; called after `run()` but before gpui has
//!   finished launching (the browser's graphics start asynchronously), it is kept and applied at launch;
//! - `compare_texts(request_json)` — `{path, language, oldText, newText, options?, editor?}`: the view compares the two
//!   texts (`options` name built-in variants, e.g. `{"lineDiffer": "myers"}`) and shows them;
//! - `show_diff(payload_json)` — `{path, language, oldText, newText, hunks, diagnostics?, editor?}`: hunks computed
//!   elsewhere (OpenIDEA's `vcs_line_hunks` in live review), shown as given;
//! - `set_side(request_json)` — `{side, text, path?}`: one side's new text (`side` is `old` or `new`), compared with the
//!   other side as it is now;
//! - `set_language(language)` — highlight both sides as another language;
//! - `swap_sides()` — the sides trade places;
//! - `set_editable(side, editable, focus)` — let the user edit a side, or make it read-only again (default);
//! - `side_text(side)` — a side's text as it is now, edits included;
//! - `mark_saved(side, text)` — the host saved `text` for the side: no longer modified;
//! - `focused_side()` / `focus_side(side)` — which side has the keyboard; give it to one;
//! - `show_file(request_json)` — `{path, language, text, readOnly, editor?}`: one file alone (the new side; editable
//!   unless `readOnly`), its old side the same text — edits then show in the diff layout;
//! - `set_editor_settings(settings_json, side?)` — how a side's editor (both without `side`) indents and shows its text
//!   from now on: `{indentStyle?, indentSize?, softWrap?, whitespace?, indentGuides?, lineNumbers?, fontSize?}`, a field
//!   left out stays as it is (review-view's `editor_settings`). The requests that replace what is shown take the same
//!   values as `editor` — `show_file` one set for its file, `compare_texts` and `show_diff` `{old?, new?}` — so a text
//!   opens with its indentation, not a frame later;
//! - `set_mode(mode)` — `file` (the new side alone) or `diff` (both sides compared): the texts and edits stay;
//! - `reveal_line(line, column?)` — bring a 0-based line of the new side into view: the caret at the UTF-16 column, or
//!   the line selected without one; `reveal_hunk(index)` — the `index`-th hunk of what is shown, selected;
//! - `run_command(side, command)` — one of the editor's commands (`undo`, `redo`, `cut`, `copy`, `selectAll`, `indent`,
//!   `outdent`, `find`; review-view's `editor_commands`) on a side, as its key runs it: the side's editor takes the
//!   keyboard and gpui-kit's action is dispatched to it. What Copy and Cut write goes to the platform's clipboard
//!   synchronously, inside this call (the editor page hands it to the main page); `paste_text(side, text)` — the text
//!   the page read from the clipboard, inserted over the selection as one edit;
//! - with the feature `grammar-files` (the mixed highlighter build), `grammar_abi()`, `register_grammar(entry_json,
//!   language)` and `function_table()`: grammars that arrive as files while the page runs (src/grammars.rs).
//!
//! A call the module refuses (bad JSON, an unknown option, variant or side, no window yet) throws a string. Outbound:
//! `globalThis.__reviewEvent(name, detail)` for `first-frame` (detail empty), `shown` (detail: JSON
//! `{path, changes, added, removed, lineDiffer, compareMs, updateMs, cause, sides, mode}` — `lineDiffer`, `compareMs`
//! and `updateMs` `null` for `show_diff` and `set_mode`; `cause` `request` for a call above, `edit` when the user's edit
//! was compared once the typing paused; `sides.old` / `sides.new` = `{editable, modified, empty}`; `mode` `file` or
//! `diff`), `standing` (detail: JSON `{old, new}` = `{editable, empty, selection}`, whenever one of them changes: what
//! the sides offer the editor's commands — flags, never text) and `error` (a theme file that does not parse).
#![cfg(target_family = "wasm")]

use std::{
    borrow::Cow,
    cell::{Cell, RefCell},
    rc::Rc,
    sync::Arc,
};

use gpui::*;
use gpui_component::{
    Root,
    highlighter::{Diagnostic, DiagnosticSeverity},
    theme::{Theme, ThemeMode, ThemeRegistry, ThemeSet},
};
use review_view::{
    CommandStanding, CompareOptions, DiffDocument, DiffSide, EditorCommand, EditorSettings, FileDocument, Layout,
    LineHunk, ReviewEvent, ReviewView, Shown, SideEditorSettings, Texts,
};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[cfg(feature = "grammar-files")]
mod grammars;
#[cfg(feature = "probe")]
mod probe;

// The gutter markers of line decorations, plus what the editor's context menu can show.
gpui_kit_assets::icon_assets!(ReviewIcons, [Asterisk, Minus, Plus, Check, ChevronRight]);

const UI_FONT: &str = "IBM Plex Sans";
const MONO_FONT: &str = "JetBrains Mono";

thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static VIEW: RefCell<Option<(AnyWindowHandle, WeakEntity<ReviewView>)>> = const { RefCell::new(None) };
    /// A theme chosen while gpui is still launching: `run()` returns before the browser's graphics are up, and gpui-kit
    /// (its `ThemeRegistry`) exists only once `launch` has run. `launch` applies it; `None` once launched.
    static PENDING_THEME: RefCell<Option<PendingTheme>> = const { RefCell::new(None) };
    static LAUNCHED: Cell<bool> = const { Cell::new(false) };
}

// ---- host page boundary -------------------------------------------------------------------

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct RunOptions {
    dark: bool,
    theme_name: Option<String>,
    /// A gpui-kit theme file (`ThemeSet`) as text.
    theme_json: Option<String>,
    /// The page's root font size; becomes the window's rem.
    font_size: Option<f32>,
    /// `webgpu`, `webgl` or anything else for "WebGPU, then WebGL2".
    backend: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextsPayload {
    path: String,
    #[serde(default)]
    language: String,
    old_text: String,
    new_text: String,
}

impl From<TextsPayload> for Texts {
    fn from(p: TextsPayload) -> Self {
        Texts {
            path: p.path,
            language: p.language,
            old_text: p.old_text,
            new_text: p.new_text,
        }
    }
}

/// `compare_texts`: two texts and, optionally, built-in variants by name.
#[derive(Deserialize)]
struct CompareRequest {
    #[serde(flatten)]
    texts: TextsPayload,
    #[serde(default)]
    options: Option<CompareOptions>,
    #[serde(default)]
    editor: Option<SideEditorSettings>,
}

/// `show_diff`: two texts and their hunks.
#[derive(Deserialize)]
struct DiffPayload {
    #[serde(flatten)]
    texts: TextsPayload,
    #[serde(default)]
    hunks: Vec<LineHunk>,
    #[serde(default)]
    diagnostics: Vec<DiagnosticPayload>,
    #[serde(default)]
    editor: Option<SideEditorSettings>,
}

/// LSP positions (0-based line, UTF-16 column) on the new side.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticPayload {
    start: lsp_types::Position,
    end: lsp_types::Position,
    message: String,
    #[serde(default)]
    severity: String,
}

impl From<DiagnosticPayload> for Diagnostic {
    fn from(d: DiagnosticPayload) -> Self {
        Diagnostic::new(d.start..d.end, d.message).with_severity(match d.severity.as_str() {
            "warning" => DiagnosticSeverity::Warning,
            "info" => DiagnosticSeverity::Info,
            "hint" => DiagnosticSeverity::Hint,
            _ => DiagnosticSeverity::Error,
        })
    }
}

/// `set_side`: one side's new text.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SidePayload {
    side: String,
    text: String,
    #[serde(default)]
    path: Option<String>,
}

/// `show_file`: one file alone.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FilePayload {
    path: String,
    #[serde(default)]
    language: String,
    text: String,
    #[serde(default)]
    read_only: bool,
    #[serde(default)]
    editor: Option<EditorSettings>,
}

impl From<FilePayload> for FileDocument {
    fn from(p: FilePayload) -> Self {
        FileDocument {
            path: p.path,
            language: p.language,
            text: p.text,
            read_only: p.read_only,
        }
    }
}

/// Puts the settings a replacing request carries into the editors, before the texts arrive.
fn apply_sides(
    view: &mut ReviewView,
    editor: Option<&SideEditorSettings>,
    window: &mut Window,
    cx: &mut Context<ReviewView>,
) {
    let Some(editor) = editor else { return };
    for (side, settings) in [(DiffSide::Old, &editor.old), (DiffSide::New, &editor.new)] {
        if let Some(settings) = settings {
            view.set_editor_settings(Some(side), settings, window, cx);
        }
    }
}

fn side_named(export: &str, name: &str) -> Result<DiffSide, JsValue> {
    DiffSide::from_name(name)
        .ok_or_else(|| JsValue::from_str(&format!("{export}: unknown side \"{name}\"; the sides are old, new")))
}

fn shown_detail(shown: &Shown) -> String {
    let side = |side: DiffSide| {
        let state = shown.sides[side.index()];
        serde_json::json!({ "editable": state.editable, "modified": state.modified, "empty": state.empty })
    };
    serde_json::json!({
        "path": shown.path,
        "changes": shown.stats.changes,
        "added": shown.stats.added,
        "removed": shown.stats.removed,
        "lineDiffer": shown.line_differ,
        "compareMs": shown.compare_time.map(|t| t.as_secs_f64() * 1000.0),
        "updateMs": shown.update_time.map(|t| t.as_secs_f64() * 1000.0),
        "cause": shown.cause.name(),
        "sides": { "old": side(DiffSide::Old), "new": side(DiffSide::New) },
        "mode": shown.layout.name(),
    })
    .to_string()
}

fn standing_detail(standing: &[CommandStanding; 2]) -> String {
    let side = |side: DiffSide| {
        let state = standing[side.index()];
        serde_json::json!({ "editable": state.editable, "empty": state.empty, "selection": state.selection })
    };
    serde_json::json!({ "old": side(DiffSide::Old), "new": side(DiffSide::New) }).to_string()
}

fn notify_host(event: &str, detail: &str) {
    let global = js_sys::global();
    let Ok(callback) = js_sys::Reflect::get(&global, &JsValue::from_str("__reviewEvent")) else {
        return;
    };
    if let Some(callback) = callback.dyn_ref::<js_sys::Function>() {
        let _ = callback.call2(&JsValue::NULL, &JsValue::from_str(event), &JsValue::from_str(detail));
    }
}

/// Notifies the host once the current call into the module has returned. From inside gpui (a frame callback, an
/// event) the app is borrowed, and a host that answers synchronously with another export would borrow it again.
fn notify_host_later(event: &'static str, detail: String) {
    let task = Closure::once_into_js(move || notify_host(event, &detail));
    let global = js_sys::global();
    if let Ok(queue) = js_sys::Reflect::get(&global, &JsValue::from_str("queueMicrotask"))
        && let Some(queue) = queue.dyn_ref::<js_sys::Function>()
    {
        let _ = queue.call1(&JsValue::NULL, &task);
    }
}

/// Runs `f` on the view inside its window; the error is what the export throws.
fn with_view<R>(
    export: &str,
    f: impl FnOnce(&mut ReviewView, &mut Window, &mut Context<ReviewView>) -> Result<R, String>,
) -> Result<R, JsValue> {
    let fail = |message: String| JsValue::from_str(&format!("{export}: {message}"));
    let Some((window, view)) = VIEW.with(|slot| slot.borrow().clone()) else {
        return Err(fail("the window is not open yet".into()));
    };
    APPLICATION.with(|application| {
        let application = application.borrow();
        let handle = application
            .as_ref()
            .ok_or_else(|| fail("run() was not called".into()))?;
        handle.update(
            |cx| match window.update(cx, |_, window, cx| view.update(cx, |view, cx| f(view, window, cx))) {
                Ok(Ok(result)) => result.map_err(fail),
                Ok(Err(err)) | Err(err) => Err(fail(err.to_string())),
            },
        )
    })
}

// ---- theme --------------------------------------------------------------------------------

/// Applies a theme and restores the bundled fonts: a theme file may name system fonts, and the browser has none.
fn apply_theme(mode: ThemeMode, name: Option<&str>, source_json: Option<&str>, font_size: Option<f32>, cx: &mut App) {
    let registry = ThemeRegistry::global(cx);
    let source_config = source_json
        .and_then(|json| match serde_json::from_str::<ThemeSet>(json) {
            Ok(set) => Some(set),
            Err(err) => {
                notify_host_later("error", format!("theme json: {err}"));
                None
            }
        })
        .and_then(|set| set.themes.into_iter().find(|theme| Some(theme.name.as_ref()) == name))
        .map(Rc::new);
    let config = source_config
        .or_else(|| name.and_then(|name| registry.themes().get(name).cloned()))
        .unwrap_or_else(|| match mode {
            ThemeMode::Dark => registry.default_dark_theme().clone(),
            ThemeMode::Light => registry.default_light_theme().clone(),
        });
    Theme::update(cx, |theme| {
        theme.apply_config(&config);
        theme.font_family = UI_FONT.into();
        theme.mono_font_family = MONO_FONT.into();
        if let Some(size) = font_size {
            theme.font_size = px(size);
        }
    });
}

fn theme_mode(dark: bool) -> ThemeMode {
    if dark { ThemeMode::Dark } else { ThemeMode::Light }
}

// ---- exports ------------------------------------------------------------------------------

/// The arguments of a `set_theme` that came before gpui had launched.
struct PendingTheme {
    dark: bool,
    name: Option<String>,
    source_json: Option<String>,
}

#[wasm_bindgen]
pub fn set_theme(dark: bool, name: Option<String>, source_json: Option<String>) {
    if !LAUNCHED.get() {
        // The latest choice wins; `launch` applies it before the first window.
        PENDING_THEME.with(|pending| {
            *pending.borrow_mut() = Some(PendingTheme {
                dark,
                name,
                source_json,
            });
        });
        return;
    }
    APPLICATION.with(|application| {
        if let Some(handle) = application.borrow().as_ref() {
            handle.update(|cx| {
                apply_theme(theme_mode(dark), name.as_deref(), source_json.as_deref(), None, cx);
            });
        }
    });
}

#[wasm_bindgen]
pub fn compare_texts(request_json: String) -> Result<(), JsValue> {
    let request: CompareRequest =
        serde_json::from_str(&request_json).map_err(|err| JsValue::from_str(&format!("compare_texts: {err}")))?;
    let options = request.options.unwrap_or_default();
    let shown = with_view("compare_texts", |view, window, cx| {
        apply_sides(view, request.editor.as_ref(), window, cx);
        view.compare(request.texts.into(), &options, window, cx)
            .map_err(|err| err.to_string())
    })?;
    notify_host("shown", &shown_detail(&shown));
    Ok(())
}

#[wasm_bindgen]
pub fn show_diff(payload_json: String) -> Result<(), JsValue> {
    let payload: DiffPayload =
        serde_json::from_str(&payload_json).map_err(|err| JsValue::from_str(&format!("show_diff: {err}")))?;
    let editor = payload.editor;
    let document = DiffDocument {
        texts: payload.texts.into(),
        hunks: payload.hunks,
        diagnostics: payload.diagnostics.into_iter().map(Into::into).collect(),
    };
    let shown = with_view("show_diff", |view, window, cx| {
        apply_sides(view, editor.as_ref(), window, cx);
        Ok(view.show(document, window, cx))
    })?;
    notify_host("shown", &shown_detail(&shown));
    Ok(())
}

#[wasm_bindgen]
pub fn set_side(request_json: String) -> Result<(), JsValue> {
    let request: SidePayload =
        serde_json::from_str(&request_json).map_err(|err| JsValue::from_str(&format!("set_side: {err}")))?;
    let side = side_named("set_side", &request.side)?;
    let shown = with_view("set_side", |view, window, cx| {
        Ok(view.set_text(side, request.text, request.path, window, cx))
    })?;
    notify_host("shown", &shown_detail(&shown));
    Ok(())
}

#[wasm_bindgen]
pub fn set_language(language: String) -> Result<(), JsValue> {
    let shown = with_view("set_language", |view, _, cx| Ok(view.set_language(language, cx)))?;
    notify_host("shown", &shown_detail(&shown));
    Ok(())
}

#[wasm_bindgen]
pub fn swap_sides() -> Result<(), JsValue> {
    let shown = with_view("swap_sides", |view, window, cx| Ok(view.swap(window, cx)))?;
    notify_host("shown", &shown_detail(&shown));
    Ok(())
}

#[wasm_bindgen]
pub fn set_editable(side: String, editable: bool, focus: bool) -> Result<(), JsValue> {
    let side = side_named("set_editable", &side)?;
    with_view("set_editable", |view, window, cx| {
        view.set_editable(side, editable, focus, window, cx);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn side_text(side: String) -> Result<String, JsValue> {
    let side = side_named("side_text", &side)?;
    with_view("side_text", |view, _, cx| Ok(view.text(side, cx)))
}

#[wasm_bindgen]
pub fn mark_saved(side: String, text: String) -> Result<(), JsValue> {
    let side = side_named("mark_saved", &side)?;
    let shown = with_view("mark_saved", |view, _, cx| Ok(view.mark_saved(side, text, cx)))?;
    notify_host("shown", &shown_detail(&shown));
    Ok(())
}

#[wasm_bindgen]
pub fn focused_side() -> Result<Option<String>, JsValue> {
    with_view("focused_side", |view, window, cx| {
        Ok(view.focused_side(window, cx).map(|side| side.name().to_owned()))
    })
}

#[wasm_bindgen]
pub fn focus_side(side: String) -> Result<(), JsValue> {
    let side = side_named("focus_side", &side)?;
    with_view("focus_side", |view, window, cx| {
        view.focus(side, window, cx);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn show_file(request_json: String) -> Result<(), JsValue> {
    let request: FilePayload =
        serde_json::from_str(&request_json).map_err(|err| JsValue::from_str(&format!("show_file: {err}")))?;
    let editor = request.editor.clone();
    let shown = with_view("show_file", |view, window, cx| {
        if let Some(settings) = &editor {
            view.set_editor_settings(None, settings, window, cx);
        }
        Ok(view.show_file(request.into(), window, cx))
    })?;
    notify_host("shown", &shown_detail(&shown));
    Ok(())
}

#[wasm_bindgen]
pub fn set_mode(mode: String) -> Result<(), JsValue> {
    let layout = Layout::from_name(&mode)
        .ok_or_else(|| JsValue::from_str(&format!("set_mode: unknown mode \"{mode}\"; the modes are file, diff")))?;
    let shown = with_view("set_mode", |view, window, cx| Ok(view.set_layout(layout, window, cx)))?;
    notify_host("shown", &shown_detail(&shown));
    Ok(())
}

#[wasm_bindgen]
pub fn set_editor_settings(settings_json: String, side: Option<String>) -> Result<(), JsValue> {
    let settings: EditorSettings = serde_json::from_str(&settings_json)
        .map_err(|err| JsValue::from_str(&format!("set_editor_settings: {err}")))?;
    let side = side.map(|name| side_named("set_editor_settings", &name)).transpose()?;
    with_view("set_editor_settings", |view, window, cx| {
        view.set_editor_settings(side, &settings, window, cx);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn reveal_line(line: u32, column: Option<u32>) -> Result<(), JsValue> {
    with_view("reveal_line", |view, _, cx| {
        view.reveal_line(line, column, cx);
        Ok(())
    })
}

#[wasm_bindgen]
pub fn reveal_hunk(index: u32) -> Result<(), JsValue> {
    with_view("reveal_hunk", |view, _, cx| view.reveal_hunk(index as usize, cx))
}

#[wasm_bindgen]
pub fn run_command(side: String, command: String) -> Result<(), JsValue> {
    let side = side_named("run_command", &side)?;
    let command = EditorCommand::from_name(&command).ok_or_else(|| {
        JsValue::from_str(&format!(
            "run_command: unknown command \"{command}\"; the commands are undo, redo, cut, copy, selectAll, indent, outdent, find"
        ))
    })?;
    with_view("run_command", |view, window, cx| {
        view.run_command(side, command, window, cx)
    })
}

#[wasm_bindgen]
pub fn paste_text(side: String, text: String) -> Result<(), JsValue> {
    let side = side_named("paste_text", &side)?;
    with_view("paste_text", |view, window, cx| view.paste_text(side, text, window, cx))
}

#[wasm_bindgen]
pub fn run(options_json: Option<String>) -> Result<(), JsValue> {
    console_error_panic_hook::set_once();
    gpui_web::init_logging();

    let options: RunOptions = match options_json.as_deref() {
        Some(json) => serde_json::from_str(json).map_err(|err| JsValue::from_str(&format!("run: {err}")))?,
        None => RunOptions::default(),
    };

    use gpui_web::{CanvasFontFallback, WebBackendPreference, WebPlatform};
    let platform = Rc::new(WebPlatform::new_with_backend_and_font_fallback(
        false,
        match options.backend.as_deref() {
            Some("webgpu") => WebBackendPreference::WebGpu,
            Some("webgl") => WebBackendPreference::WebGl,
            _ => WebBackendPreference::Auto,
        },
        CanvasFontFallback::EmojiAndCjk,
    ));
    let http_client = Arc::new(platform.fetch_http_client());
    let app = Application::with_platform(platform)
        .with_http_client(http_client)
        // gpui-kit's wasm asset source downloads every icon on first use; the view needs three, so they are
        // embedded instead and the page makes no icon requests.
        .with_assets(ReviewIcons);

    let launch = move |cx: &mut App| {
        gpui_component::init(cx);

        // gpui-kit picks its key bindings at compile time and wasm is never `target_os = "macos"`, so in a browser
        // on a Mac only the Ctrl bindings would work. The editor commands' keys come from their one table
        // (review-view's `editor_commands`: clipboard, undo and redo, select all, indent, outdent, find; Paste stays
        // the browser's `paste` event on every platform); the rest an editable side needs — moving and deleting by line
        // and by word — as gpui-kit binds them on macOS.
        let mac = matches!(cx.platform_info().os, OperatingSystem::Mac | OperatingSystem::Ios);
        review_view::bind_module_keys(mac, cx);
        if mac {
            use gpui_component::input::{
                DeleteToBeginningOfLine, DeleteToEndOfLine, DeleteToNextWordEnd, DeleteToPreviousWordStart, MoveEnd,
                MoveHome, MoveToEnd, MoveToNextWord, MoveToPreviousWord, MoveToStart, SelectToEnd, SelectToEndOfLine,
                SelectToNextWordEnd, SelectToPreviousWordStart, SelectToStart, SelectToStartOfLine,
            };
            let input = Some("Input");
            cx.bind_keys([
                KeyBinding::new("cmd-left", MoveHome, input),
                KeyBinding::new("cmd-right", MoveEnd, input),
                KeyBinding::new("cmd-up", MoveToStart, input),
                KeyBinding::new("cmd-down", MoveToEnd, input),
                KeyBinding::new("alt-left", MoveToPreviousWord, input),
                KeyBinding::new("alt-right", MoveToNextWord, input),
                KeyBinding::new("shift-cmd-left", SelectToStartOfLine, input),
                KeyBinding::new("shift-cmd-right", SelectToEndOfLine, input),
                KeyBinding::new("cmd-shift-up", SelectToStart, input),
                KeyBinding::new("cmd-shift-down", SelectToEnd, input),
                KeyBinding::new("alt-shift-left", SelectToPreviousWordStart, input),
                KeyBinding::new("alt-shift-right", SelectToNextWordEnd, input),
                KeyBinding::new("cmd-backspace", DeleteToBeginningOfLine, input),
                KeyBinding::new("cmd-delete", DeleteToEndOfLine, input),
                KeyBinding::new("alt-backspace", DeleteToPreviousWordStart, input),
                KeyBinding::new("alt-delete", DeleteToNextWordEnd, input),
            ]);
        }

        // The browser platform has no font database, and `.SystemUIFont` resolves to IBM Plex Sans there: it must
        // be loaded before the first window.
        cx.text_system()
            .add_fonts(vec![
                Cow::Borrowed(include_bytes!("../fonts/IBMPlexSans-Regular.ttf").as_slice()),
                Cow::Borrowed(include_bytes!("../fonts/JetBrainsMono-Regular.ttf").as_slice()),
            ])
            .expect("load the bundled fonts");

        // Before the first frame, so the canvas never shows another theme.
        apply_theme(
            theme_mode(options.dark),
            options.theme_name.as_deref(),
            options.theme_json.as_deref(),
            options.font_size,
            cx,
        );
        // A theme chosen while the graphics were starting is newer than the one `run()` was given.
        if let Some(theme) = PENDING_THEME.with(|pending| pending.borrow_mut().take()) {
            apply_theme(
                theme_mode(theme.dark),
                theme.name.as_deref(),
                theme.source_json.as_deref(),
                None,
                cx,
            );
        }
        LAUNCHED.set(true);

        cx.open_window(WindowOptions::default(), |window, cx| {
            // The composition root of the comparison: every seam at its default.
            let view = cx.new(|cx| ReviewView::builder().build(window, cx));
            cx.subscribe(&view, |_, event, _| match event {
                ReviewEvent::FirstFrame => notify_host_later("first-frame", String::new()),
                // The user's edit, compared once the typing paused: the page learns the counts and which side is
                // modified; the text stays here until the page asks for it.
                ReviewEvent::Recompared(shown) => notify_host_later("shown", shown_detail(shown)),
                // A selection made or gone, a side made editable, a text emptied: the page greys its buttons by it.
                ReviewEvent::Standing(standing) => notify_host_later("standing", standing_detail(standing)),
            })
            .detach();
            VIEW.with(|slot| *slot.borrow_mut() = Some((window.window_handle(), view.downgrade())));
            cx.new(|cx| Root::new(view, window, cx))
        })
        .expect("open the window");
        cx.activate(true);
    };

    APPLICATION.with(|application| {
        *application.borrow_mut() = Some(app.run_embedded(launch));
    });
    Ok(())
}
