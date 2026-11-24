import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Variants of composition roots (DEVTAB_VARIANT) as the build reads them — shared by the build's own override
 * (vite.config.ts, variantOverride) and the manifest, which Vite loads before any plugin exists
 * (./licenceOrigin.ts). `<part>:<variant>[,<part>:<variant>…]` names, for each part, the variant its root
 * src/<part>/index.ts reads instead of the one written there.
 */

/** A root's one line of choice: `export { <variant> as <name> } from './<variant>';`. */
export const ROOT_LINE = /^export \{ (\w+) as (\w+) \} from '\.\/(\w+)';$/m;

/**
 * Part → variant from DEVTAB_VARIANT; empty when unset. A pair that is not two words of letters, a part named twice or
 * a part without a root is an error.
 */
export const parseVariants = (spec: string | undefined, srcDir: string): ReadonlyMap<string, string> => {
  const variants = new Map<string, string>();
  if (!spec) return variants;
  for (const pair of spec.split(',')) {
    const [part, variant, extra] = pair.split(':');
    if (!part || !variant || extra !== undefined || !/^[A-Za-z]+$/.test(part) || !/^[A-Za-z]+$/.test(variant))
      throw new Error(`DEVTAB_VARIANT is <part>:<variant>[,<part>:<variant>…] (edition:fixedFree), not "${spec}"`);
    if (variants.has(part)) throw new Error(`DEVTAB_VARIANT names the part "${part}" twice: "${spec}"`);
    const root = resolve(srcDir, part, 'index.ts');
    if (!existsSync(root)) throw new Error(`DEVTAB_VARIANT: there is no composition root ${root}`);
    variants.set(part, variant);
  }
  return variants;
};

/** The variant a root names as written. */
export const writtenChoice = (root: string): string => {
  const found = ROOT_LINE.exec(readFileSync(root, 'utf-8'));
  if (!found) throw new Error(`${root}: no "export { … as … } from './…';" line`);
  return found[1];
};
