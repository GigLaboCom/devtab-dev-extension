/**
 * The cURL to Code tool as a host lists it (docs/tools/specs/curl-to-code.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { curlToCodeHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'curl-to-code',
  title: 'cURL to Code',
  summary: 'Turn a curl command into code: fetch, axios, Python, Java, C#, PHP, Go, Rust and more.',
  // The catalogue entry has to stay under 200 bytes (pnpm validate:growth; this one is 194): one word per language
  // people search by, Dart left out. Several languages in one keyword would fit more, but the field's fuzzy matching
  // then finds letters across them ("git" in "go rust kotlin swift").
  keywords: [
    'curl',
    'copy as curl',
    'javascript',
    'fetch',
    'axios',
    'python',
    'java',
    'c#',
    'php',
    'go',
    'rust',
    'kotlin',
    'swift',
    'ruby',
    'powershell',
    'httpie',
    'wget',
  ],
  order: 32,
  history: curlToCodeHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./CurlToCodeTool'),
};
