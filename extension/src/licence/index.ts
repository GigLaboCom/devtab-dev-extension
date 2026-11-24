/**
 * The composition root of the licence configuration — seam `LicenceConfig` (./config.ts): the keys the build trusts,
 * the licence server it may contact and through what, the hosts a plan card may link to. Today the store build's
 * `production`, which has no address and no key yet: nothing is ever sent. The e2e build reads `test` (a scripted
 * server, DEVTAB_VARIANT=…,licence:test) and development against the mock reads `mock` (…,licence:mock) without editing
 * this file (extension/vite.config.ts); the manifest's CSP follows the same choice (extension/build/licenceOrigin.ts).
 */
export { production as licence } from './production';
