/**
 * The Case Converter as a host lists it (docs/tools/specs/case.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at
 * run time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 *
 * No `detect` (§7): any text is a valid input, and the strings that look like names — `someVariableName`, `user-id` —
 * are just as much Base64, hex or plain words, so a rule that caught them would open this tool for other tools' input.
 * A person picks it by its name. No default `shortcut` either.
 */
import { caseHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'case',
  title: 'Case Converter',
  summary: 'Convert text and identifiers to camelCase, snake_case, kebab-case and other cases.',
  keywords: [
    'case',
    'camelcase',
    'pascalcase',
    'snake_case',
    'kebab-case',
    'constant',
    'title case',
    'sentence case',
    'upper',
    'lower',
    'identifier',
    'rename',
  ],
  order: 14,
  history: caseHistory,
  // Converts what a person types or pastes into every case: a conversion of their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./CaseTool'),
};
