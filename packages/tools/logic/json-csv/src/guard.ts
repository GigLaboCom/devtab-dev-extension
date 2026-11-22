/**
 * The one exception a conversion can meet: a result longer than a JavaScript string may be (about 2^29 characters in
 * V8) — a header of long names repeated on every row of 32 MB of CSV, say. It comes back as an error like any other.
 */
import { errorAt } from '@workspace/tools-shared/json-scan';
import type { Converted } from './types';

export const TOO_LONG = 'the result is longer than the browser can hold in one text';

export const guarded = <N>(text: string, convert: () => Converted<N>): Converted<N> => {
  try {
    return convert();
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, error: errorAt(text, TOO_LONG, 0) };
    throw error;
  }
};
