import { toolCatalogue } from './build/toolCatalogue';
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// As in vite.config.ts (not imported from there: that file loads the crxjs plugin, which the tests do not need).
const CSP_ALIASES = { 'react-remove-scroll': resolve(__dirname, 'src/shared/csp/removeScroll.tsx') };

/**
 * Dedicated test config (as in the sibling extensions): it does NOT load `@crxjs/vite-plugin` (build-only), only the
 * path alias of `vite.config.ts`. jsdom: the page test mounts the shell over a fake `chrome`; the rest is DOM-free.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  // The tool catalogue the pages import (build/toolCatalogue.ts), from the same definitions as the build.
  plugins: [toolCatalogue(resolve(__dirname, '..'))],
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
