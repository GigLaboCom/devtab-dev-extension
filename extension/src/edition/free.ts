/**
 * `Edition`: the free version (D21) — every tool works in full; what the person chooses in a tool lives in the page's
 * memory while the page is open, nothing of it is written anywhere, and a tool opens with its defaults on every visit:
 * the storage of the saved parameters is switched off, and with it "Reset settings". The other per-tool settings ("Copy
 * automatically after generating") are kept as before.
 */
import { noParameterStorage } from '@workspace/tools-host';
import type { Edition } from './edition';

export const free: Edition = {
  id: 'free',
  parameters: noParameterStorage,
};
