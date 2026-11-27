import { parseVariants, writtenChoice } from './variants';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * The editor's highlighter as the build sees it (src/highlighter, seam `Highlighter`): the pair `highlighter:<variant>`
 * of DEVTAB_VARIANT, or the root's line as written. The mixed tree-sitter build ships more than its module: the grammar
 * files the editor page fetches from the extension itself (`grammars/<name>.wasm` and `grammars/index.json`) and the
 * licences of the tree-sitter runtime and of every grammar in it (`licenses/`), all from
 * packages/review-wasm/pkg-tree-sitter, where `pnpm --filter @extension/review-wasm ready:tree-sitter` put them. The
 * `syntect` build ships none of it.
 */
export const chosenHighlighter = (srcDir: string, spec: string | undefined = process.env.DEVTAB_VARIANT): string =>
  parseVariants(spec, srcDir).get('highlighter') ?? writtenChoice(resolve(srcDir, 'highlighter/index.ts'));

const files = (dir: string, suffix?: string): string[] =>
  readdirSync(dir)
    .filter(name => !suffix || name.endsWith(suffix))
    .sort();

export const grammarFiles = (srcDir: string, pkgDir: string, spec?: string): Plugin | false => {
  if (chosenHighlighter(srcDir, spec) !== 'treeSitter') return false;
  const grammars = resolve(pkgDir, 'grammars');
  const licences = resolve(pkgDir, 'licenses');
  return {
    name: 'extension:grammar-files',
    buildStart() {
      for (const dir of [grammars, licences])
        if (!existsSync(dir))
          throw new Error(
            `${dir} is missing — the tree-sitter highlighter needs its module and grammar files: ` +
              '`HIGHLIGHTER=tree-sitter crates/review-wasm/build.sh`, then `pnpm --filter @extension/review-wasm ready:tree-sitter`',
          );
    },
    generateBundle() {
      for (const name of files(grammars))
        this.emitFile({ type: 'asset', fileName: `grammars/${name}`, source: readFileSync(resolve(grammars, name)) });
      for (const name of files(licences, '.txt'))
        this.emitFile({
          type: 'asset',
          fileName: `licenses/${name}`,
          source: readFileSync(resolve(licences, name), 'utf-8'),
        });
    },
  };
};
