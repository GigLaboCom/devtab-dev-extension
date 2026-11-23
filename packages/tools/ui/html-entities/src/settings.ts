/**
 * What the HTML Entities tool remembers between uses (D21; docs/tools/settings.md): the direction, what Encode
 * escapes and how it writes numbers (kept while Only & < > " ' greys it out) — never the input or the result (the
 * history keeps those, D17). Swap is the person's change of direction and is saved; a paste from the start page opens
 * Decode for that visit only.
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const htmlEntitiesSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['encode', 'decode'], 'encode'),
    scope: setting.oneOf(['special', 'nonAscii'], 'special'),
    format: setting.oneOf(['decimal', 'hex'], 'decimal'),
  },
});
