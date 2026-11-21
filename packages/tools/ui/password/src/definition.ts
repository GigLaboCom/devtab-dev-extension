/**
 * The Password Generator as a host lists it (docs/tools/specs/password.md): the description, its history declaration
 * and its component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing
 * else at run time — never the component, the logic or the word list. No `./detect` (§7): the tool takes no input.
 */
import { passwordHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'password',
  title: 'Password Generator',
  summary: 'Generate strong passwords and passphrases. Kept only encrypted, with a master password.',
  keywords: ['password', 'passphrase', 'generator', 'random', 'secure', 'diceware', 'words', 'entropy'],
  order: 7,
  history: passwordHistory,
  // Makes passwords on request (Generate); Copy / Copy all: one per line, no line break at the end.
  output: { origin: 'generated', copies: 'lines' },
  load: () => import('./PasswordTool'),
};
