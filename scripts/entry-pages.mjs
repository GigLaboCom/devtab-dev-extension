#!/usr/bin/env node
// How the browser enters the extension's pages, as the build sees it: bundles the composition roots
// extension/src/newTab/index.ts (seam NewTabOverride) and extension/src/options/index.ts (seam OptionsPage) — plain
// modules, relative imports only; read-definitions.mjs — and prints the chosen definitions:
//   { "newTab": { "id", "newtab": "<page>" | null, "start": { "id", "title", "opens" } },
//     "options": { "id", "page", "openInTab" } }
// scripts/validate-build.sh and the e2e checks hold the built manifest (`chrome_url_overrides`, `options_ui`) to it, so
// the choice in those two files is the one source of whether the build is the New Tab page and how its options open.
//
// Usage: node scripts/entry-pages.mjs
import { at, readDefinitions } from './read-definitions.mjs';

const pages = await readDefinitions(`
  import { newTab } from ${at('extension/src/newTab/index.ts')};
  import { optionsPage } from ${at('extension/src/options/index.ts')};
  export default {
    newTab: { id: newTab.id, newtab: newTab.newtab ?? null, start: newTab.start },
    options: { id: optionsPage.id, page: optionsPage.page, openInTab: optionsPage.openInTab },
  };
`);
process.stdout.write(`${JSON.stringify(pages)}\n`);
