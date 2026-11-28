// Types of the module's wasm-bindgen JS (pkg/review_wasm.js, built with --no-typescript): the exports of
// crates/review-wasm/src/lib.rs and the init function.
declare module '*/pkg/review_wasm.js' {
  const init: (options?: { module_or_path?: string | URL | Request }) => Promise<unknown>;
  export default init;
  export const run: (optionsJson?: string | null) => void;
  export const set_theme: (dark: boolean, name?: string | null, sourceJson?: string | null) => void;
  export const compare_texts: (requestJson: string) => void;
  export const show_diff: (payloadJson: string) => void;
  export const set_side: (requestJson: string) => void;
  export const set_language: (language: string) => void;
  export const swap_sides: () => void;
  export const set_editable: (side: string, editable: boolean, focus: boolean) => void;
  export const side_text: (side: string) => string;
  export const mark_saved: (side: string, text: string) => void;
  export const focused_side: () => string | undefined;
  export const focus_side: (side: string) => void;
  export const show_file: (requestJson: string) => void;
  export const set_mode: (mode: string) => void;
  export const reveal_line: (line: number, column?: number | null) => void;
  export const reveal_hunk: (index: number) => void;
  export const set_editor_settings: (settingsJson: string, side?: string | null) => void;
  export const run_command: (side: string, command: string) => void;
  export const paste_text: (side: string, text: string) => void;
}

// The mixed highlighter build's module (pkg-tree-sitter/, feature `grammar-files`): the same exports and those of
// crates/review-wasm/src/grammars.rs.
declare module '*/pkg-tree-sitter/review_wasm.js' {
  const init: (options?: { module_or_path?: string | URL | Request }) => Promise<unknown>;
  export default init;
  export const run: (optionsJson?: string | null) => void;
  export const set_theme: (dark: boolean, name?: string | null, sourceJson?: string | null) => void;
  export const compare_texts: (requestJson: string) => void;
  export const show_diff: (payloadJson: string) => void;
  export const set_side: (requestJson: string) => void;
  export const set_language: (language: string) => void;
  export const swap_sides: () => void;
  export const set_editable: (side: string, editable: boolean, focus: boolean) => void;
  export const side_text: (side: string) => string;
  export const mark_saved: (side: string, text: string) => void;
  export const focused_side: () => string | undefined;
  export const focus_side: (side: string) => void;
  export const show_file: (requestJson: string) => void;
  export const set_mode: (mode: string) => void;
  export const reveal_line: (line: number, column?: number | null) => void;
  export const reveal_hunk: (index: number) => void;
  export const set_editor_settings: (settingsJson: string, side?: string | null) => void;
  export const run_command: (side: string, command: string) => void;
  export const paste_text: (side: string, text: string) => void;
  export const grammar_abi: () => string;
  export const register_grammar: (entryJson: string, language: number) => boolean;
  export const function_table: () => unknown;
}
