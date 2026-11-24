/**
 * "A page opened" — the main occasion on which the service worker sees whether the licence is due for a check (a new
 * tab opens all the time; there is no alarm). Tiny on purpose: it sits in the start route's first chunk, so it imports
 * neither the licence package nor the edition's root (an ESLint rule holds it). One read of the record `entitlement`;
 * a message only when it is there — a profile without a licence sends nothing at all. Every failure is swallowed.
 */
import { ENTITLEMENT_KEY } from '@src/shared/licenceRecords';
import type { LicenceRequest } from '@src/shared/licenceMessages';

const OPENED: LicenceRequest = { type: 'licence/opened', v: 1 };

/** Tells the worker a page opened, when this profile has a licence record; errors are swallowed. */
export const sayOpened = (chromeApi: {
  readonly storage: { readonly local: Pick<chrome.storage.LocalStorageArea, 'get'> };
  readonly runtime: Pick<typeof chrome.runtime, 'sendMessage'>;
}): void => {
  try {
    chromeApi.storage.local
      .get(ENTITLEMENT_KEY)
      .then(rows => {
        if ((rows as Record<string, unknown>)[ENTITLEMENT_KEY] !== undefined)
          return chromeApi.runtime.sendMessage(OPENED);
      })
      .catch(() => undefined);
  } catch {
    // No storage here (a page outside the extension): nothing to say.
  }
};
