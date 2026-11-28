/**
 * Seam `CompanionInstall`: one contract suite run against each implementation — made once and kept, the same in two
 * connections, a new one after the storage is cleared, a malformed value replaced — and the default's own cases: the
 * number kept as a plain string under `companionInstall`, storage that cannot be read or written gives none.
 */
import {
  COMPANION_INSTALL_KEY,
  isInstallNumber,
  memoryCompanionInstall,
  newInstallNumber,
  storedCompanionInstall,
} from './companionInstall';
import { describe, expect, it } from 'vitest';
import type { CompanionInstall } from './companionInstall';

type Area = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

/** chrome.storage.local as the tests hold it. */
const fakeArea = (data: Record<string, unknown> = {}) => {
  const area = {
    get: (key: string) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
    set: (items: Record<string, unknown>) => (Object.assign(data, items), Promise.resolve()),
  } as unknown as Area;
  return { area, data };
};

interface Subject {
  /** A page of this installation over the same storage (a reload is a new one). */
  page(): CompanionInstall;
  value(): unknown;
  put(value: unknown): void;
  clear(): void;
}

const contract = (name: string, subject: (make?: () => string) => Subject): void => {
  describe(`CompanionInstall: ${name}`, () => {
    it('makes a number at the first ask, in the contract’s shape, and keeps it', async () => {
      const s = subject();
      const number = await s.page().get();
      expect(isInstallNumber(number)).toBe(true);
      expect(number).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(s.value()).toBe(number);
    });

    it('the same number in two connections and after a reload', async () => {
      const s = subject();
      const page = s.page();
      const first = await page.get();
      expect(await page.get()).toBe(first);
      expect(await s.page().get()).toBe(first);
    });

    it('a kept number is said as it is', async () => {
      const s = subject();
      s.put('kept_number-0123456789');
      expect(await s.page().get()).toBe('kept_number-0123456789');
    });

    it('the storage cleared: a new number', async () => {
      const s = subject();
      const page = s.page();
      const first = await page.get();
      s.clear();
      const second = await page.get();
      expect(isInstallNumber(second)).toBe(true);
      expect(second).not.toBe(first);
      expect(s.value()).toBe(second);
    });

    it.each([
      ['a number', 42],
      ['too short', 'abc123'],
      ['too long', 'a'.repeat(65)],
      ['a space', 'abcdefgh ijklmnopq'],
      ['an object', { install: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }],
      ['null', null],
    ])('a malformed value (%s) is replaced by a new number', async (_, bad) => {
      const s = subject();
      s.put(bad);
      const number = await s.page().get();
      expect(isInstallNumber(number)).toBe(true);
      expect(s.value()).toBe(number);
    });

    it('a maker that gives no proper number: none, nothing kept', async () => {
      const s = subject(() => 'short');
      expect(await s.page().get()).toBeNull();
      expect(s.value()).toBeUndefined();
    });
  });
};

contract('chrome.storage.local (a fake area)', make => {
  const { area, data } = fakeArea();
  return {
    page: () => storedCompanionInstall(() => area, make),
    value: () => data[COMPANION_INSTALL_KEY],
    put: value => void (data[COMPANION_INSTALL_KEY] = value),
    clear: () => void delete data[COMPANION_INSTALL_KEY],
  };
});

contract('the page’s memory', make => {
  // The memory is the storage: every "page" over it is the same one.
  const install = memoryCompanionInstall(undefined, make);
  return {
    page: () => install,
    value: () => install.kept.value,
    put: value => void (install.kept.value = value),
    clear: () => void (install.kept.value = undefined),
  };
});

describe('CompanionInstall: chrome.storage.local', () => {
  it('keeps the number as a plain string under `companionInstall`, nothing else written', async () => {
    const { area, data } = fakeArea({ other: 1 });
    const number = await storedCompanionInstall(() => area).get();
    expect(data).toEqual({ other: 1, companionInstall: number });
    expect(typeof data.companionInstall).toBe('string');
  });

  it('no storage on the page: none', async () => {
    expect(await storedCompanionInstall(() => null).get()).toBeNull();
  });

  it('a read that fails, a write that fails, a storage that throws: none, no error', async () => {
    const reads = { get: () => Promise.reject(new Error('no')), set: () => Promise.resolve() } as unknown as Area;
    const writes = { get: () => Promise.resolve({}), set: () => Promise.reject(new Error('quota')) } as unknown as Area;
    expect(await storedCompanionInstall(() => reads).get()).toBeNull();
    expect(await storedCompanionInstall(() => writes).get()).toBeNull();
    expect(
      await storedCompanionInstall(() => {
        throw new Error('no chrome');
      }).get(),
    ).toBeNull();
  });

  it('another page made one at the same moment: the one kept is the one said', async () => {
    const data: Record<string, unknown> = {};
    const area = {
      get: (key: string) => Promise.resolve(key in data ? { [key]: data[key] } : {}),
      set: (items: Record<string, unknown>) => {
        Object.assign(data, items);
        data[COMPANION_INSTALL_KEY] = 'the-other-page-0000000000';
        return Promise.resolve();
      },
    } as unknown as Area;
    expect(await storedCompanionInstall(() => area).get()).toBe('the-other-page-0000000000');
  });

  it('the default maker: a UUID, new every time', () => {
    const [one, two] = [newInstallNumber(), newInstallNumber()];
    expect(isInstallNumber(one) && isInstallNumber(two)).toBe(true);
    expect(one).toHaveLength(36);
    expect(one).not.toBe(two);
  });
});
