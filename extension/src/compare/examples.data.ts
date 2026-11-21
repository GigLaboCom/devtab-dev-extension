/**
 * The bundled example pairs (examples.ts), one chunk: loaded the first time «Compare code» shows an example.
 */
import { pairsOf } from './examples';

const files = import.meta.glob('./examples/*/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export const EXAMPLES = pairsOf(files);
