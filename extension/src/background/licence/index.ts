/**
 * The licence in the service worker, assembled: the records (./store.ts), the server of the build's licence
 * configuration (./server.ts over its transport; none without an origin), the logic (./worker.ts) and the plans list
 * (src/background/plans), behind one listener of runtime.onMessage that answers only our main page (./sender.ts). The
 * listeners are registered when the script first runs — an event that woke the worker is lost otherwise.
 *
 * The network: only here, only to the configuration's origin, only with a licence — or for the plans list when the
 * person asks. The store build's configuration has no origin yet, so it sends nothing at all.
 */
import { trustedSender } from './sender';
import { httpLicenceServer } from './server';
import { licenceStore } from './store';
import { licenceWorker } from './worker';
import { httpPlansServer } from '../plans/fetchPlans';
import { plansWorker } from '../plans/worker';
import { createDebug } from '@extension/logger';
import { intlCurrencies } from '@src/plans/model';
import { isLicenceMessage, isLicenceRequest } from '@src/shared/licenceMessages';
import type { LicenceConfig } from '@src/licence/config';
import type { LicenceReply, PlansReply } from '@src/shared/licenceMessages';

const debug = createDebug('extension:licence');

export interface LicenceWorkerEnvironment {
  readonly chrome: {
    readonly runtime: Pick<typeof chrome.runtime, 'id' | 'getURL' | 'onMessage' | 'onStartup' | 'onInstalled'>;
    readonly storage: {
      readonly local: Pick<chrome.storage.LocalStorageArea, 'get' | 'set' | 'remove' | 'setAccessLevel'>;
    };
  };
  readonly config: LicenceConfig;
  /** For tests; default: Date.now. */
  readonly now?: () => number;
}

export const startLicence = ({ chrome: api, config, now = Date.now }: LicenceWorkerEnvironment): void => {
  const { local } = api.storage;
  // No content scripts exist; this keeps it so should one ever come (the pages and this worker are trusted contexts).
  try {
    local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(error => debug.warn('storage access level', error));
  } catch (error) {
    debug.warn('storage access level', error);
  }

  const store = licenceStore(local);
  const fetchImpl = config.transport({ local });
  const licence = licenceWorker({
    store,
    server: config.origin ? httpLicenceServer(config.origin, fetchImpl, now) : undefined,
    keys: config.keys,
    now,
    random: () => globalThis.crypto.getRandomValues(new Uint8Array(16)),
  });
  const plans = plansWorker({
    area: local,
    server: config.origin ? httpPlansServer(config.origin, fetchImpl, now) : undefined,
    rules: { payHosts: config.payHosts, currencies: new Set([...intlCurrencies(), ...config.testCurrencies]) },
    now,
    hasLicence: async () => Boolean((await store.read()).licence?.secret),
  });

  api.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isLicenceMessage(message)) return undefined;
    if (!isLicenceRequest(message)) {
      sendResponse({ v: 1, ok: false, error: 'version' } satisfies LicenceReply);
      return false;
    }
    if (!trustedSender(sender, api.runtime)) {
      sendResponse({ v: 1, ok: false, error: 'refused' } satisfies LicenceReply);
      return false;
    }
    const answer: Promise<LicenceReply | PlansReply> =
      message.type === 'plans/refresh'
        ? plans.refresh({ reason: message.reason }).then(outcome => ({ v: 1, ...outcome }))
        : licence.handle(message);
    void answer.then(sendResponse);
    return true;
  });
  api.runtime.onStartup.addListener(() => void licence.trigger('startup'));
  api.runtime.onInstalled.addListener(() => void licence.trigger('installed'));
};
