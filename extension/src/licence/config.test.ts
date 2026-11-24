/**
 * Seam `LicenceConfig`: the host a text names, the three configurations (the store build's has no address, no key,
 * no host and no currency for trials before the server exists), the root's choice, and the origin the manifest's CSP
 * allows for each choice (build/licenceOrigin.ts).
 */
import { licence } from './index';
import { hostOf } from './config';
import { mock } from './mock';
import { production } from './production';
import { test as testConfig } from './test';
import { licenceOrigin } from '../../build/licenceOrigin';
import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

describe('hostOf', () => {
  it.each([
    ['https://licence.example.invalid', 'licence.example.invalid'],
    ['http://127.0.0.1:8790', '127.0.0.1'],
    [undefined, undefined],
    ['not an address', undefined],
  ])('%s → %s', (origin, host) => {
    expect(hostOf({ origin })).toBe(host);
  });
});

describe('the configurations', () => {
  it('production, before the server exists: no address, no key, no host to link to, no currency for trials', () => {
    expect(production).toMatchObject({
      id: 'production',
      origin: undefined,
      keys: [],
      payHosts: [],
      siteUrl: undefined,
      testCurrencies: [],
    });
    expect(production.marks).toBeUndefined();
    expect(production.transport({ local: {} as never })).toBe(fetch);
  });

  it('the root names production', () => {
    expect(licence).toBe(production);
  });

  it('test: the fake address, the one test key, the scripted server, XTS, and its mark', () => {
    expect(testConfig).toMatchObject({
      id: 'test',
      origin: 'https://licence-fake.invalid',
      payHosts: ['web.example.invalid'],
      siteUrl: 'https://web.example.invalid/pro/',
      testCurrencies: ['XTS'],
      marks: ['DEVTAB_LICENCE_TEST'],
    });
    expect(testConfig.keys).toHaveLength(1);
    expect(testConfig.keys[0].kid).toMatch(/^test-/);
    expect(testConfig.transport({ local: {} as never })).not.toBe(fetch);
  });

  it('mock: the loopback address, the mock’s two keys, the browser’s fetch, XTS, and both marks', () => {
    expect(mock).toMatchObject({
      id: 'mock',
      origin: 'http://127.0.0.1:8790',
      payHosts: ['web.example.invalid'],
      siteUrl: 'https://web.example.invalid/pro/',
      testCurrencies: ['XTS'],
      marks: ['DEVTAB_LICENCE_TEST', 'DEVTAB_MOCK_BACKEND'],
    });
    expect(mock.keys.map(k => k.kid)).toEqual(['mock-vitest00-p1', 'mock-vitest00-p2']);
    expect(mock.transport({ local: {} as never })).toBe(fetch);
  });
});

describe('the origin the manifest’s CSP allows', () => {
  it('as written (production): none; licence:mock — the mock’s; licence:test — none (its server is a script)', () => {
    expect(licenceOrigin(SRC, undefined)).toBeUndefined();
    expect(licenceOrigin(SRC, 'edition:fixedFree')).toBeUndefined();
    expect(licenceOrigin(SRC, 'edition:licensed,licence:mock')).toBe('http://127.0.0.1:8790');
    expect(licenceOrigin(SRC, 'edition:licensed,licence:test')).toBeUndefined();
    expect(licenceOrigin(SRC, 'licence:production')).toBeUndefined();
  });

  it('refuses a configuration it does not know, and a variant spec that is not one', () => {
    expect(() => licenceOrigin(SRC, 'licence:staging')).toThrow(/not one the manifest knows/);
    expect(() => licenceOrigin(SRC, 'licence:mock,licence:test')).toThrow(/twice/);
    expect(() => licenceOrigin(SRC, 'licence')).toThrow(/DEVTAB_VARIANT/);
  });
});
