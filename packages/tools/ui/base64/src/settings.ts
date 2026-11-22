/**
 * What the Base64 tool remembers between uses (D21; docs/tools/settings.md): the direction and the Encode options —
 * never the input or the result (the history keeps those, D17). A paste from the start page opens Decode for that
 * visit only.
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const base64Settings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['encode', 'decode'], 'encode'),
    alphabet: setting.oneOf(['standard', 'url'], 'standard'),
    padding: setting.boolean(true),
    lineLength: setting.oneOf([0, 64, 76], 0),
  },
});
