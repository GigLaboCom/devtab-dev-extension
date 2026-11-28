//! How an editor indents and shows its text: what the host may say ([`EditorSettings`], data at the boundary) and what
//! one editor shows now ([`EditorLook`]). The host resolves its settings — the person's choice for a file, the
//! indentation detected from the text, a language's values, the general ones — and sends the result; the view applies
//! it to its editors (`ReviewView::set_editor_settings`) and keeps nothing else of it.
//!
//! Every field is optional: a field left out leaves that editor as it is, so a host may send one change alone. Values
//! are bounded here, whatever the host sends: gpui-kit builds an indent by repeating a space (`" ".repeat(size)`), so a
//! huge size would hang the page — [`INDENT_SIZE`] keeps it within 1…16, [`FONT_SIZE`] the code font within 8…32 px.
//! Free of gpui: `cargo test -p review-view --no-default-features` checks the parsing and the bounds.

use std::ops::RangeInclusive;

use serde::{Deserialize, Deserializer};

/// The indent sizes an editor takes; a size outside is brought to the nearest end.
pub const INDENT_SIZE: RangeInclusive<u64> = 1..=16;
/// The code font sizes (px) an editor takes; a size outside is brought to the nearest end.
pub const FONT_SIZE: RangeInclusive<f32> = 8.0..=32.0;

/// What Tab inserts and what one indent level is.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum IndentStyle {
    /// `size` spaces.
    #[default]
    Space,
    /// One tab character, drawn `size` spaces wide.
    Tab,
}

/// What the host says about one editor (or both); a field left out leaves the editor as it is.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorSettings {
    #[serde(default)]
    pub indent_style: Option<IndentStyle>,
    /// Spaces per indent level, and the width of a tab; kept within [`INDENT_SIZE`].
    #[serde(default)]
    pub indent_size: Option<u64>,
    /// Long lines wrap at the editor's width. Only one file alone wraps: side by side, a wrapped row on one side
    /// would have no row level with it on the other.
    #[serde(default)]
    pub soft_wrap: Option<bool>,
    /// Spaces and tabs drawn as `•` and `→`.
    #[serde(default)]
    pub whitespace: Option<bool>,
    #[serde(default)]
    pub indent_guides: Option<bool>,
    #[serde(default)]
    pub line_numbers: Option<bool>,
    /// The code font size in px; `null`: the theme's. Kept within [`FONT_SIZE`]. One size for the whole view.
    #[serde(default, deserialize_with = "present")]
    pub font_size: Option<Option<f64>>,
}

/// `null` is a value here ("the theme's"), not the field left out.
fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(deserializer: D) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

/// Settings for the two sides of a comparison (`compare_texts`, `show_diff`): each side's text has its own
/// indentation, so each may have its own values.
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SideEditorSettings {
    #[serde(default)]
    pub old: Option<EditorSettings>,
    #[serde(default)]
    pub new: Option<EditorSettings>,
}

/// What one editor shows now. The default is what the view's editors start with (gpui-kit's defaults: two spaces,
/// indent guides and line numbers on, no wrapping, no visible whitespace) until a host says otherwise.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EditorLook {
    pub indent_style: IndentStyle,
    pub indent_size: usize,
    pub soft_wrap: bool,
    pub whitespace: bool,
    pub indent_guides: bool,
    pub line_numbers: bool,
}

impl Default for EditorLook {
    fn default() -> Self {
        Self {
            indent_style: IndentStyle::Space,
            indent_size: 2,
            soft_wrap: false,
            whitespace: false,
            indent_guides: true,
            line_numbers: true,
        }
    }
}

impl EditorLook {
    /// This look with what `settings` says, within the bounds.
    pub fn merged(self, settings: &EditorSettings) -> Self {
        Self {
            indent_style: settings.indent_style.unwrap_or(self.indent_style),
            indent_size: settings
                .indent_size
                .map(|size| size.clamp(*INDENT_SIZE.start(), *INDENT_SIZE.end()) as usize)
                .unwrap_or(self.indent_size),
            soft_wrap: settings.soft_wrap.unwrap_or(self.soft_wrap),
            whitespace: settings.whitespace.unwrap_or(self.whitespace),
            indent_guides: settings.indent_guides.unwrap_or(self.indent_guides),
            line_numbers: settings.line_numbers.unwrap_or(self.line_numbers),
        }
    }
}

/// The code font size after `settings`: `current` when they leave it out, `None` (the theme's) for `null` or a size
/// that is not a number, otherwise the size within [`FONT_SIZE`].
pub fn font_size_after(current: Option<f32>, settings: &EditorSettings) -> Option<f32> {
    match settings.font_size {
        None => current,
        Some(None) => None,
        Some(Some(size)) if size.is_finite() => Some((size as f32).clamp(*FONT_SIZE.start(), *FONT_SIZE.end())),
        Some(Some(_)) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> EditorSettings {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn every_field_is_optional_and_a_left_out_field_keeps_the_editor_as_it_is() {
        assert_eq!(parse("{}"), EditorSettings::default());
        let look = EditorLook::default().merged(&parse(r#"{"indentSize": 4}"#));
        assert_eq!(
            look,
            EditorLook {
                indent_size: 4,
                ..EditorLook::default()
            }
        );
        let tabs = look.merged(&parse(
            r#"{"indentStyle": "tab", "softWrap": true, "whitespace": true}"#,
        ));
        assert_eq!(
            (tabs.indent_style, tabs.indent_size, tabs.soft_wrap, tabs.whitespace),
            (IndentStyle::Tab, 4, true, true)
        );
        let plain = tabs.merged(&parse(r#"{"indentGuides": false, "lineNumbers": false}"#));
        assert!(!plain.indent_guides && !plain.line_numbers && plain.soft_wrap);
    }

    #[test]
    fn the_indent_size_stays_within_one_to_sixteen() {
        let size = |n: u64| {
            EditorLook::default()
                .merged(&EditorSettings {
                    indent_size: Some(n),
                    ..EditorSettings::default()
                })
                .indent_size
        };
        assert_eq!([size(0), size(1), size(8), size(16), size(17)], [1, 1, 8, 16, 16]);
        assert_eq!(size(1_000_000_000_000), 16);
        // What does not parse is refused, not guessed.
        assert!(serde_json::from_str::<EditorSettings>(r#"{"indentSize": -1}"#).is_err());
        assert!(serde_json::from_str::<EditorSettings>(r#"{"indentSize": 2.5}"#).is_err());
    }

    #[test]
    fn the_font_size_is_left_out_null_or_bounded() {
        let after = |json: &str| font_size_after(Some(14.0), &parse(json));
        assert_eq!(after("{}"), Some(14.0));
        assert_eq!(after(r#"{"fontSize": null}"#), None);
        assert_eq!(after(r#"{"fontSize": 16}"#), Some(16.0));
        assert_eq!(after(r#"{"fontSize": 2}"#), Some(8.0));
        assert_eq!(after(r#"{"fontSize": 1e9}"#), Some(32.0));
    }

    #[test]
    fn unknown_fields_and_styles_are_refused() {
        assert!(serde_json::from_str::<EditorSettings>(r#"{"tabSize": 4}"#).is_err());
        assert!(serde_json::from_str::<EditorSettings>(r#"{"indentStyle": "banana"}"#).is_err());
        assert!(serde_json::from_str::<SideEditorSettings>(r#"{"left": {}}"#).is_err());
        let sides: SideEditorSettings =
            serde_json::from_str(r#"{"old": {"indentStyle": "tab"}, "new": {"indentSize": 2}}"#).unwrap();
        assert_eq!(sides.old.unwrap().indent_style, Some(IndentStyle::Tab));
        assert_eq!(sides.new.unwrap().indent_size, Some(2));
    }
}
