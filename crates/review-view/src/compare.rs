//! One comparison: which implementation stands behind each seam, and the options with which a host picks a built-in
//! variant for a single request.
//!
//! The view's builder assembles a [`Comparison`] (the composition root); a request may name built-in variants as
//! data ([`CompareOptions`]), and [`Comparison::with_options`] is the one place where a name becomes an
//! implementation. An unknown name is an error, never a quiet fallback to the default.

use std::{fmt, sync::Arc};

use serde::Deserialize;

use crate::{
    hunks::LineHunk,
    line_differ::{self, HistogramLineDiffer, LineDiffer},
};

/// Built-in variants named by a request, as the host passes them (`{"lineDiffer": "myers"}`). A field left out keeps
/// the comparison's own choice; a field the module does not know is refused.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompareOptions {
    pub line_differ: Option<String>,
}

/// A name in [`CompareOptions`] that no built-in implementation of that seam answers to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnknownVariant {
    /// The option's name as the host writes it (`lineDiffer`).
    pub seam: &'static str,
    pub name: String,
    pub built_in: Vec<String>,
}

impl fmt::Display for UnknownVariant {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "unknown {} \"{}\"; built in: {}",
            self.seam,
            self.name,
            self.built_in.join(", ")
        )
    }
}

impl std::error::Error for UnknownVariant {}

/// The implementations one comparison runs with. Today one seam, [`LineDiffer`]; the later seams of the comparison
/// (`ComparisonPolicy`, `InlineDiffer`, …) join it here.
#[derive(Clone)]
pub struct Comparison {
    line_differ: Arc<dyn LineDiffer>,
}

impl Default for Comparison {
    /// The defaults: [`HistogramLineDiffer`].
    fn default() -> Self {
        Self {
            line_differ: Arc::new(HistogramLineDiffer),
        }
    }
}

impl fmt::Debug for Comparison {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Comparison")
            .field("line_differ", &self.line_differ.name())
            .finish()
    }
}

impl Comparison {
    pub fn with_line_differ(mut self, differ: Arc<dyn LineDiffer>) -> Self {
        self.line_differ = differ;
        self
    }

    pub fn line_differ(&self) -> &dyn LineDiffer {
        self.line_differ.as_ref()
    }

    /// This comparison with the built-in variants `options` names in place of its own.
    pub fn with_options(&self, options: &CompareOptions) -> Result<Self, UnknownVariant> {
        let mut comparison = self.clone();
        if let Some(name) = &options.line_differ {
            let built_ins = line_differ::built_ins();
            comparison.line_differ = built_ins
                .iter()
                .find(|differ| differ.name() == name)
                .cloned()
                .ok_or_else(|| UnknownVariant {
                    seam: "lineDiffer",
                    name: name.clone(),
                    built_in: built_ins.iter().map(|d| d.name().to_owned()).collect(),
                })?;
        }
        Ok(comparison)
    }

    /// Which lines changed between `old` and `new`.
    pub fn line_hunks(&self, old: &str, new: &str) -> Vec<LineHunk> {
        self.line_differ.line_hunks(old, new)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct EveryLine;

    impl LineDiffer for EveryLine {
        fn name(&self) -> &str {
            "every-line"
        }
        fn line_hunks(&self, _: &str, _: &str) -> Vec<LineHunk> {
            Vec::new()
        }
    }

    fn options(json: &str) -> Result<CompareOptions, serde_json::Error> {
        serde_json::from_str(json)
    }

    #[test]
    fn histogram_is_the_default() {
        assert_eq!(Comparison::default().line_differ().name(), "histogram");
        let same = Comparison::default().with_options(&options("{}").unwrap()).unwrap();
        assert_eq!(same.line_differ().name(), "histogram");
    }

    #[test]
    fn options_pick_a_built_in_by_name() {
        let myers = Comparison::default()
            .with_options(&options(r#"{"lineDiffer":"myers"}"#).unwrap())
            .unwrap();
        assert_eq!(myers.line_differ().name(), "myers");
        let back = myers
            .with_options(&options(r#"{"lineDiffer":"histogram"}"#).unwrap())
            .unwrap();
        assert_eq!(back.line_differ().name(), "histogram");
    }

    #[test]
    fn an_unknown_name_is_an_error_not_the_default() {
        let error = Comparison::default()
            .with_options(&options(r#"{"lineDiffer":"patience"}"#).unwrap())
            .unwrap_err();
        assert_eq!(error.name, "patience");
        assert_eq!(
            error.to_string(),
            "unknown lineDiffer \"patience\"; built in: histogram, myers"
        );
    }

    #[test]
    fn an_unknown_option_is_refused() {
        let error = options(r#"{"lineDifer":"myers"}"#).unwrap_err();
        assert!(error.to_string().contains("unknown field `lineDifer`"), "{error}");
        assert!(options(r#"{"lineDiffer":7}"#).is_err());
    }

    #[test]
    fn options_name_built_ins_only_and_keep_an_injected_default_otherwise() {
        let custom = Comparison::default().with_line_differ(Arc::new(EveryLine));
        assert_eq!(
            custom
                .with_options(&CompareOptions::default())
                .unwrap()
                .line_differ()
                .name(),
            "every-line"
        );
        let error = custom
            .with_options(&options(r#"{"lineDiffer":"every-line"}"#).unwrap())
            .unwrap_err();
        assert_eq!(error.built_in, ["histogram", "myers"]);
    }
}
