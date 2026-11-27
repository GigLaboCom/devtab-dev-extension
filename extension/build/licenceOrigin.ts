import { parseVariants, writtenChoice } from './variants';
import { EXAMPLE_SITE_ORIGIN, MOCK_ORIGIN } from '../src/licence/mockOrigin';
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

/**
 * The site whose pages may talk to the service worker (`externally_connectable`, manifest.config.ts): the origin of
 * the chosen configuration's site, or DEVTAB_SITE_ORIGIN when set (`https://<host>[:port]`, or `http://localhost` /
 * `http://127.0.0.1` with a port for a site on this machine). None — the key is left out, as in the store build until
 * the site exists. The worker and the settings read the same list back from the manifest (src/background/licence/
 * external.ts), so this one setting decides all three.
 */
const SITE_ORIGINS: Readonly<Record<string, string | undefined>> = {
  production: production.siteUrl === undefined ? undefined : new URL(production.siteUrl).origin,
  test: EXAMPLE_SITE_ORIGIN,
  mock: EXAMPLE_SITE_ORIGIN,
};

export const isSiteOrigin = (text: string): boolean =>
  /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(text) || /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/.test(text);

export const siteOrigin = (
  srcDir: string = resolve(__dirname, '../src'),
  spec: string | undefined = process.env.DEVTAB_VARIANT,
  override: string | undefined = process.env.DEVTAB_SITE_ORIGIN,
): string | undefined => {
  const set = override?.trim();
  if (set) {
    if (!isSiteOrigin(set))
      throw new Error(`DEVTAB_SITE_ORIGIN must be https://<host>[:port] or http://localhost:<port>, got "${set}"`);
    return set;
  }
  const chosen = parseVariants(spec, srcDir).get('licence') ?? writtenChoice(resolve(srcDir, 'licence/index.ts'));
  return SITE_ORIGINS[chosen];
};
