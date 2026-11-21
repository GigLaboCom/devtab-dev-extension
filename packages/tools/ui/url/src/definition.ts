/**
 * The URL tool as a host lists it (docs/tools/specs/url.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. This module is part of every host page that lists the tools, so it
 * imports only the light `detect` and the declaration — never the component or a library.
 */
import { urlHistory } from './history';
import { detectUrl } from '@workspace/tool-logic-url';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'url',
  title: 'URL',
  summary: 'Percent-encode and decode text, split a URL into parts and list its query.',
  keywords: ['url', 'uri', 'encode', 'decode', 'percent', 'query', 'parameters', 'parse', 'encodeURIComponent'],
  order: 3,
  detect: detectUrl,
  history: urlHistory,
  load: () => import('./UrlTool'),
};
