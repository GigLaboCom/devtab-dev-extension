/**
 * Seam `LicenceConfig` — the one place that says which keys a build trusts, where its service worker asks about the
 * licence and through what (the browser's fetch, or a test's script), which hosts a plan card may link to and which
 * currency for trials a price may use. The composition root (./index.ts) names one configuration: `production` (the
 * store build; no address and no keys until the licence server exists), `test` (the e2e build's scripted server) or
 * `mock` (development against `pnpm mock:backend` on the loopback address). The e2e and the development build choose
 * theirs with DEVTAB_VARIANT (extension/vite.config.ts), as the free build chooses its edition.
 *
 * Nothing here reads storage when imported: scripts bundle the root and run it in Node (scripts/licence-config.mjs).
 * No private key is ever part of a configuration.
 */
import type { PublicKeyEntry } from '@extension/licence';

export interface LicenceConfig {
  readonly id: 'production' | 'test' | 'mock';
  /** The licence server: `https://<host>` (the mock: `http://127.0.0.1:<port>`), no path; `undefined` — cannot activate. */
  readonly origin: string | undefined;
  /** The public keys the build trusts. */
  readonly keys: readonly PublicKeyEntry[];
  /** What the worker's requests go through: the browser's fetch, or a test's script. */
  transport(env: { readonly local: Pick<chrome.storage.LocalStorageArea, 'get' | 'set'> }): typeof fetch;
  /** Hosts a plan card may link to (checkout, manage, the site's plans page). */
  readonly payHosts: readonly string[];
  /** The site's plans page ("https://web.example.invalid/pro/"), or `undefined`. */
  readonly siteUrl: string | undefined;
  /**
   * Currencies a price may use besides those Intl.supportedValuesOf('currency') lists: ['XTS'] in the `test` and
   * `mock` configurations, always [] in `production` (the build check holds it).
   */
  readonly testCurrencies: readonly string[];
  /**
   * The marks of a configuration for tests or development, kept as data in the built code so the store build's check
   * finds them (scripts/validate-build.sh, Check 17); absent in `production`.
   */
  readonly marks?: readonly string[];
}

/** The host shown in texts ("licence.example.invalid"), or `undefined`. */
export const hostOf = (config: Pick<LicenceConfig, 'origin'>): string | undefined => {
  if (config.origin === undefined) return undefined;
  try {
    return new URL(config.origin).hostname || undefined;
  } catch {
    return undefined;
  }
};
