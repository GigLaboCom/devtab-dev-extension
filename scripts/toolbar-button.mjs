#!/usr/bin/env node
// The toolbar button as the build sees it: bundles the composition root extension/src/toolbar/index.ts (plain modules,
// relative imports only; read-definitions.mjs) and prints the chosen definition: `{ "id", "popup": "<page>" | null }`.
// scripts/validate-build.sh and scripts/e2e-check.mjs hold the built manifest, the shipped pages and the service worker
// to it, so the choice in that one file is the one source of what the button is.
//
// Usage: node scripts/toolbar-button.mjs
import { at, readDefinitions } from './read-definitions.mjs';

const button = await readDefinitions(`
  import { toolbarButton } from ${at('extension/src/toolbar/index.ts')};
  export default { id: toolbarButton.id, popup: toolbarButton.popup ?? null };
`);
process.stdout.write(`${JSON.stringify(button)}\n`);
