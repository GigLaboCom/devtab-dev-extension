// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- the generated module's ambient types must enter every program that imports this file
/// <reference path="./glue.d.ts" />
/**
 * Starts the editor module on the current page (the viewer page, its own document: gpui-web appends one canvas to
 * <body> and stretches it). Import this only from that page — it pulls in the module's JS, and the wasm (~20 MB)
 * ships as a separate file the page fetches from the extension itself (`?url`: never inlined, never remote).
 */
import { createReviewController } from './controller';
import init, {
  compare_texts,
  focus_side,
  focused_side,
  mark_saved,
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
} from '../pkg/review_wasm.js';
import wasmUrl from '../pkg/review_wasm_bg.wasm?url';
import type { ControllerHooks, ReviewController } from './controller';
import type { RunOptions } from './types';

declare global {
  // The module's outbound channel (crates/review-wasm/src/lib.rs `notify_host`).
  var __reviewEvent: ((name: string, detail: string) => void) | undefined;
}

export const startReview = async (options: RunOptions, hooks: ControllerHooks = {}): Promise<ReviewController> => {
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
  await init({ module_or_path: wasmUrl });
  run(JSON.stringify(options));
  return controller;
};
