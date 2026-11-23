/**
 * What the Subnet Calculator remembers between uses (D21; docs/tools/settings.md): the task and how Split divides a block
 * (Split by) — never a block, an address, a list, the new prefix length or the count (what is allowed depends on the
 * block; the history keeps them with it, D17), nor a result or a page of it. A paste from the start page opens
 * Summarize (several blocks) or Explain for that visit only.
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const subnetSettings = declareSettings({
  schema: 1,
  fields: {
    task: setting.oneOf(['explain', 'match', 'split', 'summarize'], 'explain'),
    by: setting.oneOf(['prefix', 'count'], 'prefix'),
  },
});
