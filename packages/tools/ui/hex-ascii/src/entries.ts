/** Labels, search text, payload guards and the option lists of the Hex and Text tool (the component's chunk only). */
import type { BytesPerLine, HexAsciiPayload, Mode } from './history';
import type { OutputFormat, TextEncodingId } from '@workspace/tool-logic-hex-ascii';

/** §8: the Encoding select. */
export const ENCODINGS: ReadonlyArray<{ value: TextEncodingId; label: string }> = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'iso-8859-1', label: 'ISO-8859-1' },
];

/** §8: the Format select, with a sample of each. */
export const FORMATS: ReadonlyArray<{ value: OutputFormat; label: string; short: string }> = [
  { value: 'plain', label: 'Plain — 48656c', short: 'Plain' },
  { value: 'spaced', label: 'Spaced — 48 65 6c', short: 'Spaced' },
  { value: 'colons', label: 'Colons — 48:65:6c', short: 'Colons' },
  { value: 'commas', label: 'Commas — 48, 65, 6c', short: 'Commas' },
  { value: 'c', label: 'C array — 0x48, 0x65', short: 'C array' },
  { value: 'escaped', label: 'Escaped — \\x48\\x65', short: 'Escaped' },
  { value: 'dump', label: 'Dump — offsets and text', short: 'Dump' },
];

export const BYTES_PER_LINE: ReadonlyArray<{ value: BytesPerLine; label: string }> = [
  { value: 0, label: 'No wrapping' },
  { value: 8, label: '8' },
  { value: 16, label: '16' },
  { value: 32, label: '32' },
];

export const isMode = (v: unknown): v is Mode => v === 'to-hex' || v === 'to-text';
export const isEncoding = (v: unknown): v is TextEncodingId => ENCODINGS.some(e => e.value === v);
export const isFormat = (v: unknown): v is OutputFormat => FORMATS.some(f => f.value === v);
export const isBytesPerLine = (v: unknown): v is BytesPerLine => v === 0 || v === 8 || v === 16 || v === 32;

const encodingLabel = (e: TextEncodingId): string => ENCODINGS.find(x => x.value === e)?.label ?? e;
const formatLabel = (f: OutputFormat): string => FORMATS.find(x => x.value === f)?.short ?? f;

export const entryLabel = (p: HexAsciiPayload, inputLength: number): string =>
  [
    p.mode === 'to-hex' ? 'Text to hex' : 'Hex to text',
    encodingLabel(p.encoding),
    p.mode === 'to-hex' ? formatLabel(p.format) : '',
    p.mode === 'to-hex' && p.uppercase ? 'uppercase' : '',
    p.mode === 'to-hex' && p.format !== 'dump' && p.bytesPerLine ? `${p.bytesPerLine} per line` : '',
    p.outcome === 'error' && p.error ? `error at line ${p.error.line}, column ${p.error.column}` : '',
    p.byteCount !== undefined ? `${p.byteCount.toLocaleString('en-US')} ${p.byteCount === 1 ? 'byte' : 'bytes'}` : '',
    p.firstInvalidByte !== undefined
      ? `not valid ${p.encoding === 'utf-8' ? 'UTF-8' : 'UTF-16'} from byte ${p.firstInvalidByte.toLocaleString('en-US')}`
      : '',
    p.outcome === 'error' ? `${inputLength.toLocaleString('en-US')} characters` : '',
    p.action === 'copy' ? 'copied' : p.action === 'swap' ? 'swapped' : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What History's text search looks in: the start of the input and of the result. */
export const excerpt = (input: string, output: string): string =>
  output === '' ? input.slice(0, 2000) : `${input.slice(0, 1000)}\n${output.slice(0, 1000)}`;
