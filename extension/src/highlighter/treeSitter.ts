import { createGrammarLoader, packageFile, subtleSha256, withGrammars } from '../viewer/grammars';
import { startReview } from '@extension/review-wasm/host-tree-sitter';
import type { Highlighter } from './highlighter';
import type { GrammarIndex } from '@extension/review-wasm';

/**
 * The mixed scheme: gpui-kit's tree-sitter with the common languages' grammars compiled into the module
 * (packages/review-wasm/pkg-tree-sitter) and the others grammar files of the package, `grammars/` beside the pages
 * (crates/review-wasm/grammars.json says which is which). The editor page reads `grammars/index.json` while the module
 * starts; every language name on its way to the module goes through the loader (../viewer/grammars.ts), which maps it
 * to the table's id and starts the grammar file's load when the language has one.
 */
export const treeSitter: Highlighter = {
  id: 'treeSitter',
  async start(options, hooks) {
    const base = new URL('/grammars/', location.origin);
    const index = fetch(new URL('index.json', base))
      .then(async response => {
        if (!response.ok) throw new Error(`grammars/index.json: HTTP ${response.status}`);
        return (await response.json()) as GrammarIndex;
      })
      .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    const { controller, grammars } = await startReview(options, hooks);
    const loader = createGrammarLoader({
      index: await index,
      host: grammars,
      fetchFile: packageFile(base),
      sha256: subtleSha256,
      onEvent: event => hooks.onGrammar?.(event),
      life: hooks.life,
    });
    return withGrammars(controller, loader);
  },
};
