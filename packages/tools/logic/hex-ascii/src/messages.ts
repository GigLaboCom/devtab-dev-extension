/**
 * The words the tool says (docs/tools/specs/hex-ascii.md §3, §6): the byte count, the notes under the result and the
 * refusals of §12. Here rather than in the component so the logic's tests hold every text of §6 word for word.
 */
import type { TextEncodingId } from './logic';

/** `N bytes` (`1 byte` for one), with `,` between thousands (§3). */
export const bytesLabel = (n: number): string => `${n.toLocaleString('en-US')} ${n === 1 ? 'byte' : 'bytes'}`;

export const TEXT_TOO_LARGE = 'Text is larger than 1 MB. Text to hex works with up to 1 MB.';
export const HEX_TOO_LARGE = 'Input is larger than 5 MB. Hex to text works with up to 5 MB.';
export const SURROGATES_NOTE = 'Unpaired surrogates were replaced with U+FFFD (ef bf bd).';
export const BOM_NOTE = 'Starts with a byte order mark (U+FEFF).';

/** Where the bytes stop being valid text in the chosen encoding (§6). */
export const invalidNote = (encoding: TextEncodingId, firstInvalidByte: number): string => {
  const at = firstInvalidByte.toLocaleString('en-US');
  return encoding === 'utf-8'
    ? `Not valid UTF-8 from byte ${at}: invalid bytes are shown as U+FFFD. ISO-8859-1 shows every byte as one character.`
    : `Not valid UTF-16 from byte ${at} (an unpaired surrogate or an odd last byte): shown as U+FFFD.`;
};

/**
 * How many control characters the text has (§5 «Показ управляющих символов»). C1 has no Control Pictures, so when some
 * of them are C1 the note says those stay invisible instead of claiming every one is a symbol.
 */
export const controlsNote = (count: number, c1Count = 0): string => {
  const what = `Contains ${count.toLocaleString('en-US')} control ${count === 1 ? 'character' : 'characters'}`;
  if (c1Count === 0)
    return `${what}, shown as ${count === 1 ? 'a symbol' : 'symbols'}. Copy copies the real characters.`;
  if (c1Count === count)
    return `${what} (C1, U+0080–U+009F): they have no symbols and stay invisible. Copy copies the real characters.`;
  return `${what}, shown as symbols; C1 (U+0080–U+009F) has no symbols and stays invisible. Copy copies the real characters.`;
};
