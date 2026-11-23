/**
 * What the JWT tool remembers between uses (D21; docs/tools/settings.md): how a typed secret is read — in Decode and,
 * on its own, in Sign — and whether Sign compacts the JSON. Never a token, a secret, a public or a private key, a
 * header or a payload: those are input (the history keeps tokens and keys only encrypted, D17; a signing key not even
 * then). The formats are not secret themselves.
 *
 * Not saved either: the mode — the tool opens in Decode, where a pasted token goes, and a Sign view always starts from
 * its example with an empty key (docs/defaults.md §5) — and the algorithm, which is the header's own "alg".
 */
import { declareSettings, setting } from '@workspace/tools-host';
import type { SecretFormat } from '@workspace/tool-logic-jwt';

const SECRET_FORMATS: readonly SecretFormat[] = ['text', 'base64', 'hex', 'jwk'];

export const jwtSettings = declareSettings({
  schema: 1,
  fields: {
    secretFormat: setting.oneOf(SECRET_FORMATS, 'text'),
    compact: setting.boolean(true),
    signSecretFormat: setting.oneOf(SECRET_FORMATS, 'text'),
  },
});
