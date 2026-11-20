//! review-wasm: the review view (`review-view`) on a web page. A thin layer: it starts gpui on the page's canvas,
//! embeds the fonts and icons the browser does not have, and turns the exports' JSON into calls on the view. The
//! page owns transport and data; comparing and drawing happen in the view.
//!
//! Exports (wasm-bindgen):
//!
//! - `run(options_json)` — start: an empty view, drawn in the given theme;
//! - `set_theme(dark, name, theme_set_json)` — switch the theme at run time;
//! - `compare_texts(request_json)` — `{path, language, oldText, newText, options?}`: the view compares the two texts
//!   (`options` name built-in variants, e.g. `{"lineDiffer": "myers"}`) and shows them;
//! - `show_diff(payload_json)` — `{path, language, oldText, newText, hunks, diagnostics?}`: hunks computed elsewhere
//!   (OpenIDEA's `vcs_line_hunks` in live review), shown as given.
//!
//! A call the module refuses (bad JSON, an unknown option or variant, no window yet) throws a string. Outbound:
//! `globalThis.__reviewEvent(name, detail)` for `first-frame` (detail empty), `shown` (detail: JSON
//! `{path, changes, added, removed, lineDiffer, compareMs}`, the last two `null` for `show_diff`) and `error` (a
//! theme file that does not parse).
#![cfg(target_family = "wasm")]

use std::{borrow::Cow, cell::RefCell, rc::Rc, sync::Arc};

use gpui::*;
use gpui_component::{
    Root,
    highlighter::{Diagnostic, DiagnosticSeverity},
    theme::{Theme, ThemeMode, ThemeRegistry, ThemeSet},
};
use review_view::{CompareOptions, DiffDocument, LineHunk, ReviewEvent, ReviewView, Shown, Texts};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

#[cfg(feature = "probe")]
mod probe;

// The gutter markers of line decorations, plus what the editor's context menu can show.
gpui_kit_assets::icon_assets!(ReviewIcons, [Asterisk, Minus, Plus, Check, ChevronRight]);

const UI_FONT: &str = "IBM Plex Sans";
const MONO_FONT: &str = "JetBrains Mono";

thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static VIEW: RefCell<Option<(AnyWindowHandle, WeakEntity<ReviewView>)>> = const { RefCell::new(None) };
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

fn shown_detail(shown: &Shown) -> String {
    serde_json::json!({
        "path": shown.path,
        "changes": shown.stats.changes,
        "added": shown.stats.added,
        "removed": shown.stats.removed,
        "lineDiffer": shown.line_differ,
        "compareMs": shown.compare_time.map(|t| t.as_secs_f64() * 1000.0),
    })
    .to_string()
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

#[wasm_bindgen]
pub fn set_theme(dark: bool, name: Option<String>, source_json: Option<String>) {
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
    let document = DiffDocument {
        texts: payload.texts.into(),
        hunks: payload.hunks,
        diagnostics: payload.diagnostics.into_iter().map(Into::into).collect(),
    };
    let shown = with_view("show_diff", |view, window, cx| Ok(view.show(document, window, cx)))?;
    notify_host("shown", &shown_detail(&shown));
    Ok(())
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
        // on a Mac only Ctrl+C would copy.
        if matches!(cx.platform_info().os, OperatingSystem::Mac | OperatingSystem::Ios) {
            cx.bind_keys([
                KeyBinding::new("cmd-c", gpui_component::input::Copy, Some("Input")),
                KeyBinding::new("cmd-a", gpui_component::input::SelectAll, Some("Input")),
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

        cx.open_window(WindowOptions::default(), |window, cx| {
            // The composition root of the comparison: every seam at its default.
            let view = cx.new(|cx| ReviewView::builder().build(window, cx));
            cx.subscribe(&view, |_, event, _| match event {
                ReviewEvent::FirstFrame => notify_host_later("first-frame", String::new()),
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
