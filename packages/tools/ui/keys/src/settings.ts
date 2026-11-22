/**
 * What the Key Pairs tool remembers between uses (D21; docs/tools/settings.md, row 43): the mode, the algorithm and RSA
 * size, the JWK algorithm of RSA, whether JWKs get a `kid`, and the forms shown. Never a key — not the private one, not
 * the public one —, the input or the comment (data of one pair, like the htpasswd user of Password Hash).
 */
import { ALGORITHMS, RSA_JWK_ALGS, RSA_SIZES } from '@workspace/tool-logic-keys';
import { declareSettings, setting } from '@workspace/tools-host';
import type { SettingsValues } from '@workspace/tools-host';

export const keysSettings = declareSettings({
  schema: 1,
  fields: {
    mode: setting.oneOf(['generate', 'inspect'], 'generate'),
    algorithm: setting.oneOf(ALGORITHMS, 'Ed25519'),
    size: setting.oneOf(RSA_SIZES, 3072),
    rsaAlg: setting.oneOf(RSA_JWK_ALGS, 'RS256'),
    addKid: setting.boolean(true),
    publicForm: setting.oneOf(['pem', 'pkcs1', 'openssh', 'jwk'], 'openssh'),
    privateForm: setting.oneOf(['pkcs8', 'traditional', 'openssh', 'jwk'], 'pkcs8'),
  },
});

export type KeysSettings = SettingsValues<typeof keysSettings>;
