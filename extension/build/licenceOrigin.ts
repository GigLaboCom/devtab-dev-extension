import { parseVariants, writtenChoice } from './variants';
import { MOCK_ORIGIN } from '../src/licence/mockOrigin';
import { production } from '../src/licence/production';
import { resolve } from 'node:path';

/**
 * The licence server's origin a build's CSP allows (`connect-src`, manifest.config.ts). The manifest is read before
 * the build's plugins exist, so it cannot import the licence root as a DEVTAB_VARIANT pair rewrites it, and the `test`
 * and `mock` configurations import keys that exist only inside their build: this reads the same choice — the pair
 * `licence:<variant>`, or the root's line as written — and answers the address that configuration's worker reaches
 * over the network. `test` reaches none: its server is a script in storage, and its fake address stays out of the CSP.
 */
const NETWORK_ORIGINS: Readonly<Record<string, string | undefined>> = {
  production: production.origin,
  test: undefined,
  mock: MOCK_ORIGIN,
};

export const licenceOrigin = (
  srcDir: string = resolve(__dirname, '../src'),
  spec: string | undefined = process.env.DEVTAB_VARIANT,
): string | undefined => {
  const chosen = parseVariants(spec, srcDir).get('licence') ?? writtenChoice(resolve(srcDir, 'licence/index.ts'));
  if (!Object.hasOwn(NETWORK_ORIGINS, chosen))
    throw new Error(`The licence configuration "${chosen}" is not one the manifest knows (build/licenceOrigin.ts)`);
  return NETWORK_ORIGINS[chosen];
};
