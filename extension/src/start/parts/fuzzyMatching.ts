/**
 * Fuzzy matching: the field also finds our places from letters in order and from a typo (option, no permission). Its
 * matcher (src/shared/fuzzy.ts) loads after the first paint; until then, and with this off, the field matches strictly
 * — names that start with or contain what is typed (src/shared/finder.ts).
 */
import type { OptionPart } from '../part';

export const fuzzyMatchingPart: OptionPart = {
  id: 'fuzzyMatching',
  kind: 'option',
  title: 'Fuzzy matching',
  description:
    'The field also finds tools and sections from letters in order and with a typo: “b64”, “pswd”, “pasword”. Off: only names and keywords that start with or contain what you type.',
  defaultOn: true,
  permissions: [],
  loadAt: 'idle',
  provides: ['matcher'],
  load: () => import('./fuzzyMatching.run'),
};
