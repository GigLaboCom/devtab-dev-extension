/** A certificate's DER written again as PEM (docs/tools/specs/x509.md §3): 64 characters a line, `\n`, a final `\n`. */
import { bytesToBase64 } from '@workspace/tools-shared/base64';

export const toPem = (der: Uint8Array): string =>
  `-----BEGIN CERTIFICATE-----\n${bytesToBase64(der, { lineLength: 64 })}\n-----END CERTIFICATE-----\n`;
