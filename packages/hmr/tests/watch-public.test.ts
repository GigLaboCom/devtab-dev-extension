import { filesUnder, watchPublicPlugin } from '../lib/plugins/watch-public-plugin.js';
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tree = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'watch-public-'));
  mkdirSync(join(root, 'icons'));
  writeFileSync(join(root, 'theme-boot.js'), '');
  writeFileSync(join(root, 'icons', 'icon-16.png'), '');
  return root;
};

describe('watchPublicPlugin', () => {
  it('lists every file under the public dir, nested ones too', () => {
    const root = tree();
    expect(filesUnder(root).sort()).toEqual([join(root, 'icons', 'icon-16.png'), join(root, 'theme-boot.js')]);
    expect(filesUnder(join(root, 'missing'))).toEqual([]);
  });

  it('adds them to the watch only in watch mode', () => {
    const root = tree();
    const run = (watchMode: boolean): string[] => {
      const watched: string[] = [];
      const plugin = watchPublicPlugin(root);
      const hook = plugin.buildStart as (this: unknown) => void;
      hook.call({ meta: { watchMode }, addWatchFile: (f: string) => watched.push(f) });
      return watched;
    };
    expect(run(false)).toEqual([]);
    expect(run(true)).toHaveLength(2);
  });
});
