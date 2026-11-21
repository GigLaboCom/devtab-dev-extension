/**
 * The Text Diff tool as a host lists it (docs/tools/specs/text-diff.md): the description, its history declaration and
 * its component, loaded only when the tool is opened. The tool is the way to «Compare code» from the tools — found in
 * the list, in search and in the palette by its title and keywords — and has no page of its own: opened, it asks the
 * host to go to the comparison (TextDiffTool.tsx). No `detect` (§7): the comparison takes two texts and `detect` sees
 * one; a pasted unified diff is not recognised either (§14). No default shortcut: «Compare code» has its own. This
 * module is part of every host page that lists the tools, so it imports only the declaration.
 */
import { textDiffHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'text-diff',
  title: 'Text Diff',
  summary: 'Compare two texts side by side. Opens Compare code.',
  keywords: ['diff', 'text diff', 'compare', 'difference', 'changes', 'side by side', 'merge'],
  order: 10,
  history: textDiffHistory,
  // Makes nothing: it leads to Compare code, whose result comes from the two texts a person brings there.
  output: { origin: 'input' },
  load: () => import('./TextDiffTool'),
};
