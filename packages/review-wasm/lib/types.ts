/**
 * The editor module's data contract (crates/review-wasm/src/lib.rs over crates/review-view). Three routes into the
 * view: `compare_texts` takes two texts and the module compares them (the comparison lives in Rust, D13);
 * `show_diff` takes hunks computed elsewhere — the companion's in the Projects section (D8, D29); `show_file` shows one
 * file alone, read-only or editable (`set_mode` switches between it and the diff of its edits).
 */

export type HunkKind = 'added' | 'modified' | 'deleted';

/**
 * One block of changed lines; 0-based editor lines (a trailing newline opens one more, empty line). For an empty
 * side (`lines` or `oldLines` is 0) the start is the index of the line that follows the gap on that side.
 */
export interface LineHunk {
  kind: HunkKind;
  /** First line in the new text. */
  start: number;
  /** Lines in the new text (0 for a pure deletion). */
  lines: number;
  oldStart: number;
  oldLines: number;
  /** The removed lines, each followed by "\n". */
  oldText: string;
}

/** LSP positions on the new side: 0-based line, UTF-16 column. */
export interface DiagnosticPayload {
  start: { line: number; character: number };
  end: { line: number; character: number };
  message: string;
  severity?: 'error' | 'warning' | 'info' | 'hint';
}

/** The two texts of a comparison and how to show them. */
export interface Texts {
  /** What the editor's status line names: a file name or anything else. */
  path: string;
  /** A highlighter name (`rust`, `typescript`, …); empty or `text` = no highlighting. */
  language: string;
  oldText: string;
  newText: string;
}

/**
 * Built-in variants of the comparison's seams, by name (docs/replaceable-behaviors.md). Data, not code: a name the
 * module does not know is refused, never replaced by the default. Left out = the module's default.
 */
export interface CompareOptions {
  /** Which lines changed: `histogram` (default) or `myers`. */
  lineDiffer?: string;
}

/** `compare_texts(request_json)`: the module compares the two texts. */
export interface CompareRequest extends Texts {
  options?: CompareOptions;
}

/** `show_diff(payload_json)`: hunks computed elsewhere, shown as given. */
export interface DiffPayload extends Texts {
  hunks: LineHunk[];
  diagnostics?: DiagnosticPayload[];
}

/** `show_file(request_json)`: one file alone — the new side, editable unless `readOnly`. */
export interface FileRequest {
  /** What the editor's status line names. */
  path: string;
  /** A highlighter name; empty or `text` = no highlighting. */
  language: string;
  text: string;
  readOnly: boolean;
}

/** How the view lays its texts out: `file` — the new side alone; `diff` — both sides compared. */
export type ViewMode = 'file' | 'diff';

/** A side of the view: `old` — the original, on the left; `new` — the changed text, on the right. */
export type Side = 'old' | 'new';

/** One side as the view reports it. */
export interface SideShown {
  /** The user may edit it (read-only otherwise, the default). */
  editable: boolean;
  /** Its text differs from what was loaded into it or last saved (`mark_saved`). */
  modified: boolean;
  empty: boolean;
}

/** `set_side(request_json)`: one side's new text, compared with the other side as it is now. */
export interface SideRequest {
  side: Side;
  text: string;
  /** What the editor's status line names from now on. */
  path?: string;
}

/** What the editor now shows: the `shown` event's detail. */
export interface DiffShown {
  path: string;
  /** Hunks. */
  changes: number;
  /** Lines on the new side that are added or modified. */
  added: number;
  /** Lines on the old side that are removed or modified. */
  removed: number;
  /** The differ that computed the hunks; null when they came with `show_diff`. */
  lineDiffer: string | null;
  /** How long the differ took inside the module; null for `show_diff`. */
  compareMs: number | null;
  /** The whole comparison inside the module: reading both sides, the differ, the new hunks in the view. */
  updateMs: number | null;
  /** `request`: a call of the page; `edit`: the user's edit, compared once the typing paused. */
  cause: 'request' | 'edit';
  sides: Record<Side, SideShown>;
  /** How the texts are laid out now. */
  mode: ViewMode;
}

/** `run(options_json)`. */
export interface RunOptions {
  dark: boolean;
  /** gpui-kit's theme name; with no `themeJson` the editor looks it up among its built-in themes. */
  themeName?: string;
  /** A gpui-kit theme file (`ThemeSet`) as text. */
  themeJson?: string;
  /** The page's root font size; becomes the window's rem. */
  fontSize?: number;
  /** `webgpu`, `webgl`, or nothing for "WebGPU, then WebGL2". */
  backend?: 'webgpu' | 'webgl';
}

/** What the module calls back through `globalThis.__reviewEvent(name, detail)`. */
export type ReviewEventName = 'first-frame' | 'shown' | 'error';

/** The module's events as the controller passes them on. */
export type ReviewEvent =
  { name: 'first-frame' } | { name: 'shown'; shown: DiffShown } | { name: 'error'; message: string };

/** The exports, as the host wrapper calls them. A refused call throws. */
export interface ReviewModule {
  run: (optionsJson: string) => void;
  set_theme: (dark: boolean, name: string | undefined, sourceJson: string | undefined) => void;
  compare_texts: (requestJson: string) => void;
  show_diff: (payloadJson: string) => void;
  set_side: (requestJson: string) => void;
  set_language: (language: string) => void;
  swap_sides: () => void;
  set_editable: (side: Side, editable: boolean, focus: boolean) => void;
  side_text: (side: Side) => string;
  mark_saved: (side: Side, text: string) => void;
  focused_side: () => string | undefined;
  focus_side: (side: Side) => void;
  show_file: (requestJson: string) => void;
  set_mode: (mode: ViewMode) => void;
  reveal_line: (line: number, column?: number | null) => void;
  reveal_hunk: (index: number) => void;
}

/**
 * The grammar files of the mixed highlighter build: `grammars/index.json` of the package, written by
 * crates/review-wasm/grammars/build.mjs from the table crates/review-wasm/grammars.json.
 */
export interface GrammarIndex {
  format: 1;
  /** The tree-sitter runtime the grammars were built for and the ABI versions it takes. */
  runtime: { crate: string; version: string; abi: AbiRange };
  /** Every language id and alias of the table → its id. */
  languages: Record<string, string>;
  /** Ids compiled into the module. */
  builtIn: string[];
  /** Ids with no grammar: plain text. */
  none: string[];
  /** Ids that are grammar files. */
  grammars: Record<string, GrammarEntry>;
}

export interface AbiRange {
  min: number;
  max: number;
}

/** One grammar file. Two ids may share a file (one grammar, other queries). */
export interface GrammarEntry {
  /** Its name under `grammars/`. */
  file: string;
  size: number;
  sha256: string;
  /** The ABI version it was generated with. */
  abi: number;
  /** The export that returns its language. */
  symbol: string;
  /** Languages it injects. */
  injects: string[];
  /** The queries, as gpui-kit's highlighter takes them. */
  highlights: string;
  injections: string;
  locals: string;
}

/** What the mixed highlighter build's module offers for grammar files. */
export interface GrammarHost {
  /** The ABI versions the module's tree-sitter takes. */
  abi: AbiRange;
  /** Instantiates a grammar file over the module's memory and table; the address of its language. */
  link: (bytes: Uint8Array<ArrayBuffer>, symbol: string) => Promise<number>;
  /**
   * Registers a linked language under `entry.id` with the entry's queries; the module highlights the open text again
   * when it is shown in that language. Whether it did. Throws when the module refuses the grammar.
   */
  register: (entry: GrammarEntry & { id: string }, language: number) => boolean;
}
