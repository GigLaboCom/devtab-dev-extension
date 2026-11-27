/**
 * DEVTAB_LICENCE_TEST, DEVTAB_MOCK_BACKEND — `LicenceConfig` for development against the mock licence server
 * (`pnpm mock:backend`, scripts/mock-backend; DEVTAB_VARIANT=edition:licensed,licence:mock), never of a store build.
 * The worker talks to the mock on the loopback address with the browser's fetch; the build's CSP allows that one
 * address (manifest.config.ts). The keys it trusts are the two the mock generated into .state/mock-backend/public.json —
 * `virtual:licence-mock-keys` exists only in this variant (extension/vite.config.ts, licenceMockKeys()).
 */
import { EXAMPLE_SITE_ORIGIN, MOCK_ORIGIN } from './mockOrigin';
import mockKeys from 'virtual:licence-mock-keys';
import type { LicenceConfig } from './config';

export const mock: LicenceConfig = {
  id: 'mock',
  origin: MOCK_ORIGIN,
  keys: mockKeys,
  transport: () => fetch,
  payHosts: ['web.example.invalid'],
  siteUrl: `${EXAMPLE_SITE_ORIGIN}/pro/`,
  testCurrencies: ['XTS'],
  marks: ['DEVTAB_LICENCE_TEST', 'DEVTAB_MOCK_BACKEND'],
};
