//! Grammar files while the page runs (feature `grammar-files`): the exports the editor page's loader calls
//! (extension/src/viewer/grammars.ts). The page fetches a grammar file of the package, checks its sha256 against the
//! package's index, instantiates it over this module's memory and function table (that is why the module is linked
//! with a growable table and exports its stack pointer, build.sh) and calls the grammar's `tree_sitter_<name>()`,
//! which returns the address of its language in this module's memory. These take it from there.
//!
//! - `grammar_abi()` — `{"min", "max"}`: the ABI versions this module's tree-sitter takes; the page refuses an index
//!   made for another runtime before it instantiates anything;
//! - `register_grammar(entry_json, language)` — the index's entry (`{id, abi, injects, highlights, injections,
//!   locals}`) and the address: the language is checked and registered, and the open text is highlighted again when it
//!   is shown in that language (or one that injects it). Returns whether it was; throws a string when refused;
//! - `function_table()` — the table the page grows for a grammar's functions (wasm-bindgen removes the linker's
//!   `__indirect_function_table` export).

use review_view::grammars::{self, GrammarFile, tree_sitter};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn grammar_abi() -> String {
    let supported = grammars::supported_abi();
    serde_json::json!({ "min": supported.start(), "max": supported.end() }).to_string()
}

#[wasm_bindgen]
pub fn register_grammar(entry_json: String, language: u32) -> Result<bool, JsValue> {
    let fail = |message: String| JsValue::from_str(&format!("register_grammar: {message}"));
    let file: GrammarFile = serde_json::from_str(&entry_json).map_err(|err| fail(err.to_string()))?;
    // Nothing of the grammar is read unless the runtime can read its kind of language at all.
    grammars::check_abi(&file.id, file.abi).map_err(|err| fail(err.to_string()))?;
    if language == 0 {
        return Err(fail(format!("grammar {}: no language", file.id)));
    }
    // SAFETY: `language` is what the grammar's own `tree_sitter_<name>()` returned: the address of a `TSLanguage` the
    // tree-sitter CLI generated, inside this module's linear memory. The page instantiated the grammar over this
    // module's memory and table, with its data in a block of this module's allocator that is never freed and its
    // functions in table slots that are never reused, so the language stays valid for the page's lifetime. The file is
    // the package's own, its sha256 the one the package's index states, and its ABI version — the layout of that
    // structure — one this runtime reads (checked above, from the index; `register` compares the language's own).
    let language = unsafe { tree_sitter::Language::from_raw(language as usize as *const tree_sitter::ffi::TSLanguage) };
    grammars::register(&file, language).map_err(|err| fail(err.to_string()))?;
    // Not open yet: the first text shown is highlighted with the grammar anyway.
    Ok(crate::with_view("register_grammar", |view, _, cx| Ok(view.grammar_arrived(&file.id, cx))).unwrap_or(false))
}

#[wasm_bindgen]
pub fn function_table() -> JsValue {
    wasm_bindgen::function_table()
}
