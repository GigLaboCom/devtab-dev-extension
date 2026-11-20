import { startReloadServer } from '../reload-server.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReloadServer } from '../reload-server.js';
import type { InjectionKind, WatchRebuildConfig } from '../types.js';
import type { Plugin } from 'vite';

// injections/ ships as raw self-contained JS at the package root (the reference bundled its
// TS injections with rollup+sucrase in `ready`; raw JS removes that build step entirely).
const injectionsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../injections');
const injections: Record<InjectionKind, string> = {
  reload: readFileSync(resolve(injectionsDir, 'reload.js'), 'utf8'),
  refresh: readFileSync(resolve(injectionsDir, 'refresh.js'), 'utf8'),
};

const wrap = (id: string, url: string, code: string): string =>
  `(function () {\nlet __HMR_ID = ${JSON.stringify(id)};\nlet __HMR_URL = ${JSON.stringify(url)};\n${code}\n})();\n`;

/**
 * Taken from the second sample extension (docs/extension-structure.md; itself from the reference boilerplate's @extension/hmr watchRebuildPlugin), adapted to a single
 * crxjs build: instead of injecting into every chunk, `rules` pick which chunks get which client
 * (`refresh` for extension pages such as popup/options, `reload` for a service worker once one
 * exists). Chunks matching no rule are left byte-identical to prod.
 *
 * In watch mode it runs the reload server itself (`startReloadServer`: the port is picked on the first build — free
 * and, in a container, published to the host), bakes the server's URL into the clients, and after every rebuild
 * broadcasts DO_UPDATE. A one-off build (no watch) injects nothing.
 */
export const watchRebuildPlugin = (config: WatchRebuildConfig): Plugin => {
  let server: Promise<ReloadServer | null> | undefined;

  return {
    name: 'extension:watch-rebuild',
    apply: 'build',
    buildStart() {
      if (this.meta.watchMode) server ??= startReloadServer(config.id, { startPort: config.startPort });
    },
    async generateBundle(_options, bundle) {
      const live = await server;
      if (!live) return;
      for (const [key, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue;
        const moduleId = (output.facadeModuleId ?? '').split('\\').join('/');
        const rule = config.rules.find(r => r.match.test(moduleId) || r.match.test(key));
        if (!rule) continue;
        output.code = wrap(config.id, live.url, injections[rule.inject]) + output.code;
      }
    },
    async closeBundle() {
      (await server)?.broadcast(config.id);
    },
  };
};
