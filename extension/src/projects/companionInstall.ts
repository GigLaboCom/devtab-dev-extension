/**
 * Seam `CompanionInstall` — the number of this installation of the extension that the page says to the companion in
 * `hello.install` (the companion's contract; D42, the companion's step O3). When a file is opened from the system and
 * no page of the extension is there, the companion starts the browser itself; if the extension is in more than one of
 * its profiles, it tells them apart by this number, looking for its bytes in the extension's own storage folder of each
 * profile. So the default keeps it in `chrome.storage.local` under `companionInstall` as a plain string — not inside an
 * object, not encoded.
 *
 * The number is a random string of 16–64 characters `A–Z a–z 0–9 - _` (`crypto.randomUUID()`), made at the first
 * connection to the companion and said in every handshake after it. A value that is not one is replaced by a new one;
 * storage that cannot be read or written gives none, and the handshake goes without it. The number goes nowhere else:
 * not into a log, not to the site, not into an error. The same in both editions.
 */

/** chrome.storage.local key of the installation's number. */
export const COMPANION_INSTALL_KEY = 'companionInstall';

/** What the companion takes as a number (the contract's `minLength`, `maxLength` and `pattern` of `hello.install`). */
const SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

export const isInstallNumber = (value: unknown): value is string => typeof value === 'string' && SHAPE.test(value);

export interface CompanionInstall {
  /** This installation's number: the kept one, or one made and kept now; null when the storage cannot keep one. */
  get(): Promise<string | null>;
}

/** A new number. */
export const newInstallNumber = (): string => crypto.randomUUID();

type Area = Pick<chrome.storage.StorageArea, 'get' | 'set'>;

/** The extension's memory: one key in chrome.storage.local. */
export const storedCompanionInstall = (area: () => Area | null, make = newInstallNumber): CompanionInstall => {
  const read = async (found: Area): Promise<unknown> => (await found.get(COMPANION_INSTALL_KEY))[COMPANION_INSTALL_KEY];
  return {
    async get() {
      try {
        const found = area();
        if (!found) return null;
        const kept = await read(found);
        if (isInstallNumber(kept)) return kept;
        const made = make();
        if (!isInstallNumber(made)) return null;
        await found.set({ [COMPANION_INSTALL_KEY]: made });
        // Another page of the extension may have made one at the same moment: the one kept is the one said.
        const now = await read(found);
        return isInstallNumber(now) ? now : null;
      } catch {
        return null;
      }
    },
  };
};

/** chrome.storage.local of the page, when there is one. */
export const chromeCompanionInstall = (): CompanionInstall =>
  storedCompanionInstall(() => (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null));

/** Keeps the number for the page's life only: a host without storage, and tests (`kept` is what it holds). */
export const memoryCompanionInstall = (
  start?: unknown,
  make = newInstallNumber,
): CompanionInstall & { kept: { value: unknown } } => {
  const kept = { value: start };
  return {
    kept,
    get() {
      if (isInstallNumber(kept.value)) return Promise.resolve(kept.value);
      const made = make();
      if (!isInstallNumber(made)) return Promise.resolve(null);
      kept.value = made;
      return Promise.resolve(made);
    },
  };
};
