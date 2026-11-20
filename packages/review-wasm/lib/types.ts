/**
 * The editor module's data contract (crates/review-wasm/src/lib.rs over crates/review-view). Two routes into the
 * view: `compare_texts` takes two texts and the module compares them (the comparison lives in Rust, D13);
 * `show_diff` takes hunks computed elsewhere — openidea-server's `vcs_line_hunks` in live review (D8).
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
  /** How long the comparison took inside the module; null for `show_diff`. */
  compareMs: number | null;
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

/** The four exports, as the host wrapper calls them. A refused call throws. */
export interface ReviewModule {
  run: (optionsJson: string) => void;
  set_theme: (dark: boolean, name: string | undefined, sourceJson: string | undefined) => void;
  compare_texts: (requestJson: string) => void;
  show_diff: (payloadJson: string) => void;
}
