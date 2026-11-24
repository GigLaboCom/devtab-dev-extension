/**
 * `LicenceConfig` of the store build. Until the licence server exists it has no address and trusts no key: the
 * service worker asks nobody, nothing can be activated, and the build's CSP stays `connect-src 'self'`. When the
 * server is there, its origin, the two public keys (`p1` signs, `p2` waits), the site's hosts and its plans page are
 * written here — and a development build (IS_DEV) still gets no origin: it never contacts the production server.
 */
import type { LicenceConfig } from './config';

export const production: LicenceConfig = {
  id: 'production',
  origin: undefined,
  keys: [],
  transport: () => fetch,
  payHosts: [],
  siteUrl: undefined,
  testCurrencies: [],
};
