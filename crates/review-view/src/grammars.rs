//! Grammars that arrive while the page runs (feature `grammar-files`): the mixed highlighter build keeps the common
//! languages' grammars inside the module and ships the others as separate grammar files of the extension's package
//! (`crates/review-wasm/grammars.json`). The page fetches a file, checks it against the package's index, links it into
//! the module's memory and table and hands over the language; this checks the language and registers it with
//! gpui-kit's highlighter, the same registry its built-in grammars are in. [`crate::ReviewView::grammar_arrived`] then
//! repaints a text that is already shown in that language.
//!
//! What is refused: a grammar whose ABI version the tree-sitter runtime in the module does not take (the page asks
//! [`check_abi`] before it instantiates the file, with the version the index states, and the language itself is
//! checked again here); a language whose ABI differs from the index's; queries the grammar does not accept (gpui-kit
//! would otherwise build no highlighter and leave the text plain without a word); a second grammar for a language that
//! has one.

use std::{fmt, ops::RangeInclusive};

use gpui_component::highlighter::{LanguageConfig, LanguageRegistry};
use serde::Deserialize;

pub use tree_sitter;

/// One grammar file as the package's index describes it (`grammars/index.json`, entry `grammars.<id>` with its id).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrammarFile {
    /// The highlighter name the language is registered under.
    pub id: String,
    /// The ABI version the grammar was generated with (`LANGUAGE_VERSION` of its parser.c).
    pub abi: usize,
    /// Languages it injects (gpui-kit's list for it).
    #[serde(default)]
    pub injects: Vec<String>,
    pub highlights: String,
    #[serde(default)]
    pub injections: String,
    #[serde(default)]
    pub locals: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GrammarRefused {
    /// The runtime in the module cannot use a grammar of this ABI version.
    Abi {
        id: String,
        abi: usize,
        supported: RangeInclusive<usize>,
    },
    /// The language the file returned is of another ABI version than the index states.
    AbiMismatch { id: String, index: usize, language: usize },
    /// The grammar does not accept its own queries.
    Query { id: String, message: String },
    /// The language already has a grammar (built in, or a file registered before).
    AlreadyRegistered { id: String },
}

impl fmt::Display for GrammarRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Abi { id, abi, supported } => write!(
                f,
                "grammar {id}: ABI version {abi}, the module's tree-sitter takes {}–{}",
                supported.start(),
                supported.end()
            ),
            Self::AbiMismatch { id, index, language } => {
                write!(
                    f,
                    "grammar {id}: the index states ABI version {index}, the grammar is {language}"
                )
            }
            Self::Query { id, message } => write!(f, "grammar {id}: its queries do not compile: {message}"),
            Self::AlreadyRegistered { id } => write!(f, "grammar {id}: the language has a grammar already"),
        }
    }
}

impl std::error::Error for GrammarRefused {}

/// The ABI versions the tree-sitter runtime compiled into this build can use.
pub fn supported_abi() -> RangeInclusive<usize> {
    tree_sitter::MIN_COMPATIBLE_LANGUAGE_VERSION..=tree_sitter::LANGUAGE_VERSION
}

/// Whether a grammar of ABI version `abi` may be linked at all; asked before the file is instantiated.
pub fn check_abi(id: &str, abi: usize) -> Result<(), GrammarRefused> {
    let supported = supported_abi();
    if supported.contains(&abi) {
        Ok(())
    } else {
        Err(GrammarRefused::Abi {
            id: id.to_owned(),
            abi,
            supported,
        })
    }
}

/// Registers the language a grammar file returned under its id, with the index's queries.
pub fn register(file: &GrammarFile, language: tree_sitter::Language) -> Result<(), GrammarRefused> {
    check_abi(&file.id, file.abi)?;
    let actual = language.abi_version();
    if actual != file.abi {
        return Err(GrammarRefused::AbiMismatch {
            id: file.id.clone(),
            index: file.abi,
            language: actual,
        });
    }
    // The same concatenation gpui-kit's highlighter compiles (injections, locals, highlights).
    let source = format!("{}{}{}", file.injections, file.locals, file.highlights);
    tree_sitter::Query::new(&language, &source).map_err(|err| GrammarRefused::Query {
        id: file.id.clone(),
        message: err.to_string(),
    })?;
    let registry = LanguageRegistry::singleton();
    if registry.language(&file.id).is_some_and(|config| config.has_grammar()) {
        return Err(GrammarRefused::AlreadyRegistered { id: file.id.clone() });
    }
    registry.register(
        &file.id,
        &LanguageConfig::new(
            file.id.clone(),
            language,
            file.injects.iter().map(|name| name.clone().into()).collect(),
            &file.highlights,
            &file.injections,
            &file.locals,
        ),
    );
    Ok(())
}

/// Whether text shown as `shown` (a highlighter name) is coloured by the grammar `id`: it is that language, or one
/// that injects it.
pub(crate) fn colours(shown: &str, id: &str) -> bool {
    shown == id
        || LanguageRegistry::singleton().language(shown).is_some_and(|config| {
            config.name.as_ref() == id || config.injection_languages.iter().any(|name| name.as_ref() == id)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real grammar to register under other names: gpui-kit's JSON, part of its tree-sitter feature.
    fn json() -> tree_sitter::Language {
        LanguageRegistry::singleton()
            .language("json")
            .and_then(|config| config.language)
            .expect("gpui-kit's tree-sitter feature has JSON")
    }

    fn file(id: &str, abi: usize) -> GrammarFile {
        GrammarFile {
            id: id.to_owned(),
            abi,
            injects: vec!["json".into()],
            highlights: "(string) @string (number) @number".into(),
            injections: String::new(),
            locals: String::new(),
        }
    }

    #[test]
    fn a_grammar_file_is_registered_under_its_id_with_its_queries() {
        let language = json();
        let abi = language.abi_version();
        register(&file("test-registered", abi), language).unwrap();
        let config = LanguageRegistry::singleton().language("test-registered").unwrap();
        assert!(config.has_grammar());
        assert_eq!(config.name.as_ref(), "test-registered");
        assert_eq!(config.highlights.as_ref(), "(string) @string (number) @number");
        assert_eq!(
            config
                .injection_languages
                .iter()
                .map(AsRef::as_ref)
                .collect::<Vec<&str>>(),
            ["json"]
        );
        assert!(colours("test-registered", "test-registered"));
        assert!(colours("test-registered", "json"), "injected");
        assert!(!colours("json", "test-registered"));
    }

    #[test]
    fn the_index_is_parsed_with_its_defaults() {
        let file: GrammarFile = serde_json::from_str(
            r#"{"id":"go","abi":14,"highlights":"(x) @y","file":"go.wasm","size":1,"sha256":"00","symbol":"s"}"#,
        )
        .unwrap();
        assert_eq!((file.id.as_str(), file.abi), ("go", 14));
        assert!(file.injects.is_empty() && file.injections.is_empty() && file.locals.is_empty());
    }

    #[test]
    fn an_abi_outside_the_runtime_is_refused_before_linking() {
        let supported = supported_abi();
        assert!(check_abi("x", *supported.start()).is_ok() && check_abi("x", *supported.end()).is_ok());
        for abi in [supported.start() - 1, supported.end() + 1] {
            assert_eq!(
                check_abi("x", abi),
                Err(GrammarRefused::Abi {
                    id: "x".into(),
                    abi,
                    supported: supported.clone()
                })
            );
            assert!(matches!(
                register(&file("test-abi", abi), json()),
                Err(GrammarRefused::Abi { .. })
            ));
        }
        assert!(LanguageRegistry::singleton().language("test-abi").is_none());
    }

    #[test]
    fn a_language_of_another_abi_than_the_index_states_is_refused() {
        let language = json();
        let actual = language.abi_version();
        let claimed = if actual == *supported_abi().end() {
            actual - 1
        } else {
            actual + 1
        };
        assert_eq!(
            register(&file("test-mismatch", claimed), language),
            Err(GrammarRefused::AbiMismatch {
                id: "test-mismatch".into(),
                index: claimed,
                language: actual
            })
        );
        assert!(LanguageRegistry::singleton().language("test-mismatch").is_none());
    }

    #[test]
    fn queries_the_grammar_does_not_accept_are_refused() {
        let language = json();
        let mut bad = file("test-query", language.abi_version());
        bad.highlights = "(no_such_node) @keyword".into();
        let refused = register(&bad, language).unwrap_err();
        assert!(matches!(refused, GrammarRefused::Query { .. }), "{refused}");
        assert!(LanguageRegistry::singleton().language("test-query").is_none());
    }

    #[test]
    fn a_language_with_a_grammar_keeps_it() {
        let language = json();
        let abi = language.abi_version();
        assert_eq!(
            register(&file("json", abi), language.clone()),
            Err(GrammarRefused::AlreadyRegistered { id: "json".into() })
        );
        register(&file("test-twice", abi), language.clone()).unwrap();
        assert_eq!(
            register(&file("test-twice", abi), language),
            Err(GrammarRefused::AlreadyRegistered {
                id: "test-twice".into()
            })
        );
    }
}
