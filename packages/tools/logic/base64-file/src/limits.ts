/**
 * The tool's limits and the words it says about them (docs/tools/specs/base64-file.md §6, §12). The checks are the
 * component's; the functions of the logic take any size.
 */

/** Encode: a file up to 2 GiB, inclusive; larger is refused by its size before it is read. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
/** Decode: a text file of Base64 up to 3 GiB (the Base64 of 2 GiB is 2.67 GiB, wrapped a little more). */
export const MAX_TEXT_BYTES = 3 * 1024 * 1024 * 1024;
/** Decode: the most text the field holds; a larger paste is kept out of it (a Blob) and decoded in the worker. */
export const FIELD_MAX_CHARS = 4 * 1024 * 1024;
/** Decode: up to this, the page decodes on every change; above, 300 ms after the last one, in the worker. */
export const LIVE_CHARS = 256 * 1024;
export const SETTLE_MS = 300;
/** Encode: an output up to this is shown whole; longer, its first SHOWN_CHARS. */
export const SHOW_WHOLE_CHARS = 1024 * 1024;
export const SHOWN_CHARS = 65_536;
/** Encode: Copy takes an output up to this; longer is refused in words and Save offered. */
export const COPY_MAX_CHARS = 16 * 1024 * 1024;
/** Show text: the first bytes shown as text. */
export const SHOW_TEXT_BYTES = 1024 * 1024;
/** Progress is reported every this many bytes read. */
export const PROGRESS_BYTES = 16 * 1024 * 1024;

const COUNT = new Intl.NumberFormat('en-US');
export const formatCount = (n: number): string => COUNT.format(n);

/** '0 bytes', '1 byte', '1,023 bytes', '1,024 bytes (1.0 KiB)', '1,269,328 bytes (1.2 MiB)', '… (2.0 GiB)'. */
export const formatSize = (bytes: number): string => {
  const exact = `${formatCount(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  if (bytes < 1024) return exact;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (unit < units.length - 1 && Number(value.toFixed(1)) >= 1024) {
    value /= 1024;
    unit++;
  }
  return `${exact} (${value.toFixed(1)} ${units[unit]})`;
};

/** A size in the largest binary unit for the refusals: '2.5 GiB'. */
const shortSize = (bytes: number): string => formatSize(bytes).replace(/^.*\((.*)\)$/, '$1');

export const fileTooLarge = (bytes: number): string =>
  `The file is ${formatCount(bytes)} bytes (${shortSize(bytes)}). This tool works with files up to 2 GiB.`;
export const textFileTooLarge = (bytes: number): string =>
  `The text file is ${formatCount(bytes)} bytes (${shortSize(bytes)}). This tool reads Base64 text up to 3 GiB.`;

export const shownNote = (length: number, copyable: boolean): string =>
  `Showing the first ${formatCount(SHOWN_CHARS)} of ${formatCount(length)} characters. ${copyable ? 'Copy copies all.' : 'Too large to copy: Save saves all.'}`;
export const textShownNote = (shown: number, size: number): string =>
  `Showing the first ${formatCount(shown)} of ${formatCount(size)} bytes as text.`;
export const pastedNote = (chars: number): string =>
  `Pasted text: ${formatCount(chars)} characters, not shown in the field.`;
export const textFileNote = (name: string, bytes: number): string =>
  `Text file: ${name}, ${formatCount(bytes)} bytes, not shown in the field.`;

export const ONLY_FIRST = 'Only the first file is used.';
export const IS_TEXT = 'This is text.';
export const NOT_TEXT_FILE = 'Not Base64 text: the file was opened in Encode.';
export const UNREADABLE = 'This file could not be read.';
