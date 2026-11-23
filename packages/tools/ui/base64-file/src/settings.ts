/**
 * What Base64 File remembers between uses (D21; docs/tools/settings.md §3): the direction and Encode's output — Base64
 * or a data URI, the alphabet, padding and line length — never a file, its name or type, the decoded bytes' name, the
 * Base64 or a pasted text (the history keeps the file, D17). Text handed over from the start page opens Decode for that
 * visit only; a file dropped, pasted or chosen opens Encode, a text pasted on the page in Encode opens Decode, and an
 * opened entry shows its own — all for the visit only.
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const base64FileSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['encode', 'decode'], 'encode'),
    form: setting.oneOf(['base64', 'dataUri'], 'base64'),
    alphabet: setting.oneOf(['standard', 'url'], 'standard'),
    padding: setting.boolean(true),
    lineLength: setting.oneOf([0, 64, 76], 0),
  },
});
