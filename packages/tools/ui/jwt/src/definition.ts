/**
 * The JWT tool as a host lists it (docs/tools/specs/jwt.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. This module is part of every host page that lists the tools, so it
 * imports only the light `detect` and the declaration — never the component, the decoder or the verifier.
 */
import { jwtHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'jwt',
  title: 'JWT',
  summary: 'Decode a JSON Web Token and check its signature with your key.',
  keywords: [
    'jwt',
    'jws',
    'token',
    'bearer',
    'decode',
    'verify',
    'signature',
    'claims',
    'exp',
    'hs256',
    'rs256',
    'es256',
  ],
  order: 4,
  history: jwtHistory,
  // Decodes and checks the token a person pastes: the result is derived from their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./JwtTool'),
};
