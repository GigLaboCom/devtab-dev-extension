import { toolCatalogue } from './build/toolCatalogue';
import manifest from './manifest.config';
import product from './product.json';
import { toolbarButton } from './src/toolbar';
import { pagesOf } from './src/toolbar/button';
import { crx } from '@crxjs/vite-plugin';
import { IS_DEV, IS_PROD } from '@extension/env';
import { watchPublicPlugin, watchRebuildPlugin } from '@extension/hmr';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Plugin } from 'vite';

// Build output lives at the WORKSPACE root (../dist), as in both sibling extensions — `chrome://extensions` keeps
// loading <repo>/dist.
const outDir = resolve(__dirname, '../dist');
const publicDir = resolve(__dirname, 'public');

/**
 * Dev watch-mode fix (from the sibling extensions): crxjs emits manifest-declared entries inside the transform of its
 * virtual manifest module (`/@crx/manifest`). Rollup's watcher reuses its module cache, so on incremental rebuilds
 * that transform is skipped and the manifest pass can lose its entries. Forcing this one module to re-transform keeps
 * every rebuild complete.
 */
const crxWatchRebuildFix = (): Plugin => ({
  name: 'extension:crx-watch-rebuild-fix',
  apply: 'build',
  shouldTransformCachedModule({ id }) {
    return id.includes('@crx/manifest') ? true : null;
  },
});

/** `%PRODUCT_NAME%` in the pages' <title> → the product's name from product.json (the one place it lives). */
const productName = (): Plugin => ({
  name: 'extension:product-name',
  transformIndexHtml: html => html.replaceAll('%PRODUCT_NAME%', product.name),
});

/**
 * Licences that travel with what ships: from packages/review-wasm/licenses, gpui-kit and gpui (Apache-2.0; also covers
 * the gpui-kit theme files of @extension/theme), imara-diff (Apache-2.0, the module's line diff) and the fonts compiled
 * into the wasm (SIL OFL 1.1); from @workspace/dna, the OFL of the IBM Plex files the pages load.
 */
const emitLicences = (): Plugin => {
  const sources = [
    ...readdirSync(resolve(__dirname, '../packages/review-wasm/licenses'))
      .filter(name => name.endsWith('.txt'))
      .map(name => resolve(__dirname, '../packages/review-wasm/licenses', name)),
    resolve(__dirname, '../packages/dna/fonts/OFL-IBMPlex.txt'),
  ];
  return {
    name: 'extension:emit-licences',
    generateBundle() {
      for (const path of sources) {
        this.emitFile({
          type: 'asset',
          fileName: `licenses/${basename(path)}`,
          source: readFileSync(path, 'utf-8'),
        });
      }
    },
  };
};

/**
 * Radix locks the page scroll under an open Select list or modal menu with react-remove-scroll, which inserts a
 * <style> element; the CSP (`style-src 'self'`) refuses it with a console error. The CSP stays; the lock goes
 * (src/shared/csp/removeScroll.tsx). vitest.config.ts repeats it.
 */
const CSP_ALIASES = {
  'react-remove-scroll': resolve(__dirname, 'src/shared/csp/removeScroll.tsx'),
};

export default defineConfig({
  resolve: {
    alias: {
      '@src': resolve(__dirname, 'src'),
      ...CSP_ALIASES,
    },
    // The UI kit and the tools' packages bring React as a peer: one copy on the page, whichever package asks.
    dedupe: ['react', 'react-dom'],
  },
  publicDir,
  plugins: [
    // Tailwind v4 over @workspace/dna (src/app/app.css): a plain CSS file in dist/, no runtime and no inline style.
    tailwindcss(),
    react(),
    // The tools as data for the start page, the palette and the sidebar (build/toolCatalogue.ts): `virtual:tool-catalogue`.
    toolCatalogue(resolve(__dirname, '..')),
    crx({ manifest }),
    productName(),
    emitLicences(),
    IS_DEV && crxWatchRebuildFix(),
    // From the reference boilerplate: `public/` (icons, theme-boot.js) is watched too, so editing it rebuilds.
    IS_DEV && watchPublicPlugin(publicDir),
    // Dev-only auto-reload (@extension/hmr): `reload` = chrome.runtime.reload() after every rebuild, which also
    // reloads the open main page. In the service worker AND the main page: Chrome stops an idle service worker, and
    // its socket with it. The editor page needs none — it lives inside the main page.
    IS_DEV &&
      watchRebuildPlugin({
        id: 'extension-hmr',
        rules: [
          { match: /src\/background\/index\.ts$/, inject: 'reload' },
          { match: /src\/app\/index\.html$/, inject: 'reload' },
        ],
      }),
  ],
  build: {
    outDir,
    emptyOutDir: true,
    // The main page (a tab: the New Tab page and the options) and the editor page (its iframe), plus the pages the chosen
    // toolbar button needs (src/toolbar/index.ts): the menu's popup page, or none — then nothing of it is built.
    rollupOptions: {
      input: {
        app: resolve(__dirname, 'src/app/index.html'),
        viewer: resolve(__dirname, 'src/viewer/index.html'),
        ...Object.fromEntries(
          Object.entries(pagesOf(toolbarButton)).map(([name, page]) => [name, resolve(__dirname, page)]),
        ),
      },
    },
    // The editor module is ~20 MB of wasm: a file of its own (`?url`), never inlined.
    assetsInlineLimit: 0,
    // Dev is a real `vite build --watch` (as in the sibling extensions), not the Vite dev server: watch mode emits
    // real files into dist/, so the loaded unpacked extension behaves like prod.
    watch: IS_DEV ? { chokidar: { awaitWriteFinish: true } } : null,
    sourcemap: IS_DEV,
    minify: IS_PROD,
    // Gzip-sizing 20 MB of wasm on every build is slow and says nothing new.
    reportCompressedSize: false,
  },
});
