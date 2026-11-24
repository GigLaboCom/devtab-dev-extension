import { toolCatalogue } from './build/toolCatalogue';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

// As in vite.config.ts (not imported from there: that file loads the crxjs plugin, which the tests do not need).
const CSP_ALIASES = { 'react-remove-scroll': resolve(__dirname, 'src/shared/csp/removeScroll.tsx') };

/**
 * The keys modules of the licence variants (src/licence/test.ts, mock.ts), which only those builds make from files in
 * .state/: in the tests, public keys made in memory for each run — no key on disk, none in the sources.
 */
const LICENCE_KEYS: Readonly<Record<string, string>> = {
  'virtual:licence-test-key': `
    import { makeTestKey } from '@extension/licence/testing';
    export default (await makeTestKey('test-vitest00')).publicKey;`,
  'virtual:licence-mock-keys': `
    import { makeTestKey } from '@extension/licence/testing';
    export default [(await makeTestKey('mock-vitest00-p1')).publicKey, (await makeTestKey('mock-vitest00-p2')).publicKey];`,
};
const licenceKeysForTests = (): Plugin => ({
  name: 'extension:licence-keys-for-tests',
  resolveId: source => (source in LICENCE_KEYS ? `\0${source}` : null),
  load: id => (id.startsWith('\0') ? (LICENCE_KEYS[id.slice(1)] ?? null) : null),
});

/**
 * Dedicated test config (as in the sibling extensions): it does NOT load `@crxjs/vite-plugin` (build-only), only the
 * path alias of `vite.config.ts`. jsdom: the page test mounts the shell over a fake `chrome`; the rest is DOM-free.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  // The tool catalogue the pages import (build/toolCatalogue.ts), from the same definitions as the build.
  plugins: [toolCatalogue(resolve(__dirname, '..')), licenceKeysForTests()],
  resolve: {
    alias: {
      '@src': resolve(__dirname, 'src'),
      ...CSP_ALIASES,
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // What jsdom lacks and the pages use (Blob.text, scrollIntoView).
    setupFiles: ['src/test/setup.ts'],
    // Process CSS read as text (`?raw`), so the style check in src/dna.test.ts lints the files and not '' (by default
    // vitest stubs CSS) — as in the second sibling extension. Only those: a plain CSS import (the shell's shell.css)
    // would be inserted into jsdom, whose parser does not take `@layer` with a nested `@media`.
    css: { include: [/\?raw$/] },
  },
});
