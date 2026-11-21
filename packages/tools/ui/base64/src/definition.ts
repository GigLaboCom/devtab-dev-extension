/**
 * The Base64 tool as a host lists it (docs/tools/specs/base64.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. This module is part of every host page that lists the tools, so it
 * imports only the light `detect` and the declaration — never the component or a library.
 */
import { base64History } from './history';
import { detectBase64 } from '@workspace/tool-logic-base64';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'base64',
  title: 'Base64',
  summary: 'Encode text to Base64 and decode it back, standard or URL-safe.',
  keywords: ['base64', 'encode', 'decode', 'base64url', 'url-safe', 'atob', 'btoa', 'pem'],
  order: 2,
  detect: detectBase64,
  history: base64History,
  load: () => import('./Base64Tool'),
};
