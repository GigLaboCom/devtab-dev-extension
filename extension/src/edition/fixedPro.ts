/**
 * `EditionSource`: Pro, chosen at build time — today's build (there is no licence check yet: Pro is selected so the
 * features can be seen, an implementer's choice, docs/defaults.md §2).
 */
import { fixedSource } from './fixed';
import type { EditionSourceFactory } from './source';

export const fixedPro: EditionSourceFactory = Object.assign(() => fixedSource('pro'), { id: 'fixedPro' as const });
