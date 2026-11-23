/**
 * What the URL tool remembers between uses (D21; docs/tools/settings.md): the mode, how Encode encodes and whether
 * Decode reads + as a space — never the text, the URL or any result (the history keeps those, D17). Swap is the
 * person's change of mode and is saved; a paste from the start page opens the mode that recognised it (Parse or Decode)
 * for that visit only.
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const urlSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['encode', 'decode', 'parse'], 'encode'),
    style: setting.oneOf(['component', 'form', 'whole'], 'component'),
    plusAsSpace: setting.boolean(false),
  },
});
