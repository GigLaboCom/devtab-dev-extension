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
    // Process CSS, so a `?raw` CSS import is the file's text (by default vitest stubs CSS to '', and the style check in
    // src/dna.test.ts would lint an empty string) — as in the second sibling extension.
    css: { include: [/.+/] },
  },
});
