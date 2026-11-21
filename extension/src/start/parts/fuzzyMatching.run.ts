/** Fuzzy matching's code: the fuzzy PlaceMatcher. */
import { fuzzyMatcher } from '../../shared/fuzzy';
import type { OptionCode } from '../part';

export const create = (): OptionCode => ({ context: { matcher: fuzzyMatcher } });
