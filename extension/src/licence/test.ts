/**
 * DEVTAB_LICENCE_TEST — `LicenceConfig` of the e2e build (DEVTAB_VARIANT=…,licence:test), never of a store build.
 * Its server is a script the test puts into chrome.storage.local (`licenceFakeServer`, src/background/licence/
 * scriptedFetch.ts): the browser's fetch is never called, its address is fake and stays out of the CSP. The one key it
 * trusts is the test key scripts/licence-test-key.mjs made in .state/licence-test/ — `virtual:licence-test-key` exists
 * only in this variant (extension/vite.config.ts, licenceTestKey()); the private half never enters a build.
 */
import { EXAMPLE_SITE_ORIGIN } from './mockOrigin';
import { scriptedFetch } from '@src/background/licence/scriptedFetch';
import testKey from 'virtual:licence-test-key';
import type { LicenceConfig } from './config';

export const test: LicenceConfig = {
  id: 'test',
  origin: 'https://licence-fake.invalid',
  keys: [testKey],
  transport: ({ local }) => scriptedFetch(local),
  payHosts: ['web.example.invalid'],
  siteUrl: `${EXAMPLE_SITE_ORIGIN}/pro/`,
  testCurrencies: ['XTS'],
  marks: ['DEVTAB_LICENCE_TEST'],
};
