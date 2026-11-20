import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Every file under `dir`, recursively; none when it does not exist. */
export const filesUnder = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
        entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
      )
    : [];

/**
 * From the reference boilerplate (chrome-extension-boilerplate-react-vite, `@extension/hmr` `watchPublicPlugin`):
 * `vite build --watch` does not watch `publicDir`, so an edited icon or `theme-boot.js` needed a restart of `pnpm dev`
 * (the sibling extensions document exactly that). Adding every public file to the watch makes such an edit rebuild —
 * the build copies `public/` again — and the reload client reloads the extension as after any other change.
 * The reference used fast-glob; a plain recursive readdir is enough here. A file ADDED to `public/` while
 * `pnpm dev` runs is still only picked up on the next rebuild or restart.
 */
export const watchPublicPlugin = (publicDir: string): Plugin => ({
  name: 'extension:watch-public',
  apply: 'build',
  buildStart() {
    if (!this.meta.watchMode) return;
    for (const file of filesUnder(publicDir)) this.addWatchFile(file);
  },
});
