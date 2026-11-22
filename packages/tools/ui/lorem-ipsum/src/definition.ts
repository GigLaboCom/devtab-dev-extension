/**
 * The Lorem Ipsum tool as a host lists it (docs/tools/specs/lorem-ipsum.md): the description, its history declaration
 * and its component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else
 * at run time — no logic, no library — so a host reads it at build time and lists the tool without its code. No
 * `./detect` (§7): a generator takes no text, so there is nothing pasted for it to recognise.
 */
import { loremIpsumHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'lorem-ipsum',
  title: 'Lorem Ipsum',
  summary: 'Generate placeholder text: words, sentences or paragraphs.',
  keywords: ['lorem', 'ipsum', 'placeholder', 'dummy text', 'filler', 'generator', 'paragraphs', 'text'],
  order: 30,
  history: loremIpsumHistory,
  // Makes a text on request (Generate); Copy copies it whole, as shown: one text, not lines.
  output: { origin: 'generated', copies: 'text' },
  load: () => import('./LoremIpsumTool'),
};
