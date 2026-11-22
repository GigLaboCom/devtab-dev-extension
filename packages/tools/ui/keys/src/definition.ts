/**
 * The Key Pairs tool as a host lists it (docs/tools/specs/keys.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { keysHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'keys',
  title: 'Key Pairs',
  summary: 'Generate RSA, EC and Ed25519 key pairs; convert keys between PEM, JWK and OpenSSH; fingerprints.',
  keywords: [
    'rsa',
    'ssh',
    'ed25519',
    'ecdsa',
    'jwk',
    'pem',
    'pkcs8',
    'public key',
    'fingerprint',
    'generator',
    'keygen',
  ],
  order: 43,
  history: keysHistory,
  // Makes values on request (Generate); one generation copies the result as one text.
  output: { origin: 'generated', copies: 'text' },
  load: () => import('./KeysTool'),
};
