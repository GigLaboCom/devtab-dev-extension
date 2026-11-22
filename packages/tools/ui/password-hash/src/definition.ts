/**
 * The Password Hash tool as a host lists it (docs/tools/specs/password-hash.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { passwordHashHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'password-hash',
  title: 'Password Hash',
  summary: 'Create and verify bcrypt, Argon2, scrypt and PBKDF2 password hashes.',
  keywords: ['bcrypt', 'argon2', 'scrypt', 'pbkdf2', 'htpasswd', 'password', 'verify', 'salt', 'kdf'],
  order: 36,
  history: passwordHashHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./PasswordHashTool'),
};
