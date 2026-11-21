/**
 * The URL tool as a host lists it (docs/tools/specs/url.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at
 * run time — a host reads it at build time and lists the tool without its code. Recognising pasted text is `./detect`.
 */
import { urlHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'url',
  title: 'URL',
  summary: 'Percent-encode and decode text, split a URL into parts and list its query.',
  keywords: ['url', 'uri', 'encode', 'decode', 'percent', 'query', 'parameters', 'parse', 'encodeURIComponent'],
  order: 3,
  history: urlHistory,
  // Encodes, decodes and splits what a person types or pastes: a conversion of their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./UrlTool'),
};
