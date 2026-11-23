/**
 * What the Hash tool remembers between uses (D21; docs/tools/settings.md): how the input is read (Text, Hex, Base64 or
 * File), how the hashes are written, whether they are HMACs, and how the key is read. Never the input, a file or its
 * name, the HMAC key (a secret), the expected hash of Compare with, or a result (the history keeps those only
 * encrypted, D17). The key format is not a secret itself.
 */
import { declareSettings, setting } from '@workspace/tools-host';

export const hashSettings = declareSettings({
  schema: 1,
  fields: {
    inputFormat: setting.oneOf(['text', 'hex', 'base64', 'file'], 'text'),
    output: setting.oneOf(['hex', 'HEX', 'base64'], 'hex'),
    hmac: setting.boolean(false),
    keyFormat: setting.oneOf(['text', 'hex', 'base64'], 'text'),
  },
});
