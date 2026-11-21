/**
 * The Hash tool as a host lists it (docs/tools/specs/hash.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. No `detect` (§7): any text can be hashed, so no paste is recognised as
 * this tool's input, and the package has no `./detect`. Data only: it imports its history declaration and nothing else
 * at run time — never the component, the logic or @noble/hashes.
 */
import { hashHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'hash',
  title: 'Hash',
  summary: 'MD5, SHA-1 and SHA-2 hashes and HMAC of text or a file.',
  keywords: ['hash', 'md5', 'sha1', 'sha256', 'sha384', 'sha512', 'hmac', 'checksum', 'digest'],
  order: 8,
  history: hashHistory,
  // Hashes the text or file a person gives it: the digest is derived from their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./HashTool'),
};
