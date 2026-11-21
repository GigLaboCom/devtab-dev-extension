/**
 * Open a tool for pasted text: text pasted into the empty field goes to the tools' `detect`, and the tool that
 * recognises it opens with it (option, no permission). The tools' `detect` (src/tools/detectors.ts) loads when the page
 * is idle after its first paint, or at the first paste if that comes sooner — the paste then waits for it. Off: pasted
 * text is text in the field, found and searched like typed text.
 */
import type { OptionPart } from '../part';

export const recognisePastePart: OptionPart = {
  id: 'recognisePaste',
  kind: 'option',
  title: 'Open a tool for pasted text',
  description:
    'Text pasted into the empty field opens the tool that recognises it: JSON in the JSON tool, a UUID in UUID / ULID. Off: pasted text stays in the field, like typed text.',
  defaultOn: true,
  permissions: [],
  loadAt: 'idle',
  provides: ['recognise'],
  load: () => import('./recognisePaste.run'),
};
