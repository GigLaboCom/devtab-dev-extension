/**
 * `Edition`: the free version (D21, D24, D25) — every tool works in full, and nothing of the product's memory is kept:
 *
 *   - what the person chooses in a tool lives in the page's memory while the page is open, nothing of it is written
 *     anywhere, and a tool opens with its defaults on every visit: the storage of the saved parameters is switched off,
 *     and with it "Reset settings";
 *   - the tool history records nothing: the tools are told it is off, its store is an empty one in this page's memory
 *     that nothing writes to, and the history's database in the profile, if a Pro build left one, is neither opened,
 *     read nor deleted (a Pro build in the same profile finds it as it was);
 *   - "Copy automatically after generating" does not exist: no switch in Settings, no generator copies by itself, and a
 *     stored "on" is left as it is. The Copy buttons work as in Pro.
 */
import { noParameterStorage } from '@workspace/tools-host';
import { memoryStore } from '@workspace/tools-shared/history';
import type { Edition } from './edition';

export const free: Edition = {
  id: 'free',
  parameters: noParameterStorage,
  history: () => ({ store: memoryStore(), recording: false }),
  automaticCopying: false,
};
