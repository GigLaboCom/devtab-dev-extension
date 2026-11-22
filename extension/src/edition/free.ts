/**
 * `Edition`: the free version (D21) — every tool works in full; what the person chooses in a tool lives in the page's
 * memory while the page is open, nothing of it is written to storage, and a tool opens with its defaults on every
 * visit. No "Reset settings". The other per-tool settings ("Copy automatically after generating") are kept as before.
 */
import { memoryToolSettingsArea } from '@workspace/tools-host';
import type { Edition } from './edition';

export const free: Edition = {
  id: 'free',
  pro: false,
  parameters: () => memoryToolSettingsArea(),
};
