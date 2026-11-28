// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the generated module's ambient types must enter every program that imports this file
/// <reference path="./glue.d.ts" />
/**
 * The editor module of the mixed highlighter build (DEVTAB_VARIANT=highlighter:treeSitter): tree-sitter with the common
 * languages' grammars compiled in, the others as grammar files of the package (pkg-tree-sitter/grammars/, made by
 * `HIGHLIGHTER=tree-sitter crates/review-wasm/build.sh` and copied by `scripts/sync.sh tree-sitter`). The same start as
 * ./host.ts, plus what the editor page needs to link a grammar file into the module (`GrammarHost`). Import this only
 * from the editor page, and only in that build: the default build never reaches this file, so its module is not
 * bundled there.
 */
import { createReviewController } from './controller';
import { linkGrammar } from './link';
import init, {
  compare_texts,
  focus_side,
  focused_side,
  function_table,
  grammar_abi,
  mark_saved,
  register_grammar,
  reveal_hunk,
  reveal_line,
  run,
  set_editable,
  set_editor_settings,
  set_language,
  set_mode,
  set_side,
  set_theme,
  show_diff,
  show_file,
  side_text,
  swap_sides,
} from '../pkg-tree-sitter/review_wasm.js';
import wasmUrl from '../pkg-tree-sitter/review_wasm_bg.wasm?url';
import type { ControllerHooks, ReviewController } from './controller';
import type { AbiRange, GrammarHost, RunOptions } from './types';

declare global {
  // The module's outbound channel (crates/review-wasm/src/lib.rs `notify_host`).
  var __reviewEvent: ((name: string, detail: string) => void) | undefined;
}

export const startReview = async (
  options: RunOptions,
  hooks: ControllerHooks = {},
): Promise<{ controller: ReviewController; grammars: GrammarHost }> => {
  const controller = createReviewController(
    {
      run,
      set_theme,
      compare_texts,
      show_diff,
      set_side,
      set_language,
      swap_sides,
      set_editable,
      side_text,
      mark_saved,
      focused_side,
      focus_side,
      show_file,
      set_mode,
      reveal_line,
      reveal_hunk,
      set_editor_settings,
    },
    hooks,
  );
  globalThis.__reviewEvent = (name, detail) => controller.onModuleEvent(name, detail ?? '');
  const exports = (await init({ module_or_path: wasmUrl })) as Record<string, unknown>;
  run(JSON.stringify(options));
  const table = function_table();
  if (!(table instanceof WebAssembly.Table)) throw new Error('the editor module gives no function table');
  const abi = JSON.parse(grammar_abi()) as AbiRange;
  return {
    controller,
    grammars: {
      abi,
      link: (bytes, symbol) => linkGrammar({ exports, table }, bytes, symbol),
      register: (entry, language) =>
        register_grammar(
          JSON.stringify({
            id: entry.id,
            abi: entry.abi,
            injects: entry.injects,
            highlights: entry.highlights,
            injections: entry.injections,
            locals: entry.locals,
          }),
          language,
        ),
    },
  };
};
