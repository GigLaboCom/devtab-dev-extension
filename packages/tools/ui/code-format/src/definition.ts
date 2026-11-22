/**
 * The Code Formatter as a host lists it (docs/tools/specs/code-format.md): the description, its history declaration and
 * its component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at
 * run time — no logic, no Prettier — so a host reads it at build time and lists the tool without its code. Recognising
 * pasted text is `./detect` (src/detect.ts). No default shortcut.
 */
import { codeFormatHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'code-format',
  title: 'Code Formatter',
  summary: 'Format JavaScript, TypeScript, CSS, SCSS, LESS, HTML, XML, Markdown and YAML.',
  keywords: [
    'format',
    'prettier',
    'beautify',
    'pretty print',
    'javascript',
    'typescript',
    'css',
    'scss',
    'less',
    'html',
    'xml',
    'markdown',
    'yaml',
  ],
  order: 20,
  history: codeFormatHistory,
  // Formats what a person types, pastes or opens: the result is derived from their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./CodeFormatTool'),
};
