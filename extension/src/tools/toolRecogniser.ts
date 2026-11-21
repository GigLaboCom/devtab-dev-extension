/**
 * The default `PasteRecogniser` (recogniser.ts): the tools' `detect` in the tools' order, from their chunk
 * (detectors.ts), loaded on the first `ready()`. A module of its own, reached only from code that loads lazily (the
 * shell; the start page's "Open a tool for pasted text" part): the first chunk of a page that imports it would list the
 * detectors' chunks — one per tool — among what it preloads.
 *
 * Relative imports only (the start page's parts reach it; part.ts).
 */
import { deferredRecogniser, recogniserOf } from './recogniser';
import type { PasteRecogniser } from './recogniser';

export const toolRecogniser = (order: readonly string[]): PasteRecogniser =>
  deferredRecogniser(() =>
    import('./detectors').then(m => {
      // When the tools' `detect` arrived (the e2e check times it against the first paint).
      globalThis.performance?.mark?.('tool-detectors');
      return recogniserOf(m.recogniseIn(order));
    }),
  );
