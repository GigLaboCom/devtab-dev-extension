#!/usr/bin/env node
// The editor's highlighter as the build sees it (extension/build/highlighter.ts: the pair `highlighter:<variant>` of
// DEVTAB_VARIANT, or the root extension/src/highlighter/index.ts as written), and for the mixed tree-sitter build what
// it must ship besides its module — from the split table crates/review-wasm/grammars.json:
//   { "highlighter": "<id>", "pkg": "packages/review-wasm/<pkg>",
//     "licences": ["<CRATE>-LICENSE.txt", …] }   the licences the tree-sitter build must carry: the runtime's and every
//                                                grammar crate the table builds in or ships as a file
// For scripts/validate-build.sh (Checks 13 and 14) and the e2e checks. Usage: [DEVTAB_VARIANT=…] node
// scripts/highlighter-config.mjs
import { join } from 'node:path';
import { licenceFile, readTable } from '../crates/review-wasm/grammars/build.mjs';
import { at, readDefinitions, ROOT } from './read-definitions.mjs';

const highlighter = await readDefinitions(
  `
  import { chosenHighlighter } from ${at('extension/build/highlighter.ts')};
  export default chosenHighlighter(${JSON.stringify(join(ROOT, 'extension/src'))}, ${JSON.stringify(process.env.DEVTAB_VARIANT ?? '')});
`,
  { external: ['node:*'] },
);
const table = readTable();
const treeSitter = highlighter === 'treeSitter';
const config = {
  highlighter,
  pkg: treeSitter ? 'packages/review-wasm/pkg-tree-sitter' : 'packages/review-wasm/pkg',
  licences: treeSitter
    ? [
        ...new Set([
          licenceFile(table.runtime.crate),
          ...table.languages.filter(e => e.grammar !== 'none').map(e => licenceFile(e.crate)),
        ]),
      ].sort()
    : [],
};
process.stdout.write(`${JSON.stringify(config)}\n`);
