import type { GrammarEvent } from '../viewer/grammars';
import type { PageLife } from '../viewer/pageLife';
import type { ControllerHooks, ReviewController, RunOptions } from '@extension/review-wasm';

/**
 * Seam `Highlighter`, the shell's half (docs/replaceable-behaviors.md): which build of the editor module the editor
 * page starts — how code is coloured is the module's (Rust), but the build is chosen here, with what it needs on the
 * page. `syntect` (./syntect.ts): one module, every language inside. `treeSitter` (./treeSitter.ts): the mixed scheme —
 * the common languages compiled in, the others grammar files of the package loaded when a text needs one.
 */
export interface Highlighter {
  readonly id: string;
  /** Starts the editor module on this page; resolves once it runs (the first frame follows). */
  start: (options: RunOptions, hooks: HighlighterHooks) => Promise<ReviewController>;
}

export interface HighlighterHooks extends ControllerHooks {
  /** Whether the page is going away (../viewer/pageLife.ts): a load it interrupts is not reported. */
  life: PageLife;
  /** A grammar file arrived or could not be used (the builds that have grammar files). */
  onGrammar?: (event: GrammarEvent) => void;
}
