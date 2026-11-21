/**
 * The Base64 tool as a host lists it (docs/tools/specs/base64.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at
 * run time — a host reads it at build time and lists the tool without its code. Recognising pasted text is `./detect`.
 */
import { base64History } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'base64',
  title: 'Base64',
  summary: 'Encode text to Base64 and decode it back, standard or URL-safe.',
  keywords: ['base64', 'encode', 'decode', 'base64url', 'url-safe', 'atob', 'btoa', 'pem'],
  order: 2,
  history: base64History,
  // Encodes and decodes what a person types or pastes: a conversion of their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./Base64Tool'),
};
