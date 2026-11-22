/**
 * The JSON to Code tool's logic (docs/tools/specs/json-to-code.md §9): JSON samples in, type declarations for
 * TypeScript, Go, Rust or Python out. JSON is read by the shared exact scanner only (`parseJsonValues`, comments
 * allowed): numbers stay as written, so `1.0`, `2e3` and `12345678901234567890` keep their kind, keys keep their order,
 * and a repeated key is seen (its last value gives the type). Pure: no React, no DOM, no chrome.
 */
import { WRITERS } from './emit';
import { inferShape } from './infer';
import { parseJsonValues } from '@workspace/tools-shared/json-scan';
import type { Language } from './emit';
import type { JsonErrorInfo } from '@workspace/tools-shared/json-scan';

export type { Language } from './emit';
export type { JsonErrorInfo } from '@workspace/tools-shared/json-scan';
export type { NumberKind, ObjectShape, Shape, TypeShape } from './infer';
export { inferShape, numberKind } from './infer';
export { keyWords, singularWords } from './names';

export interface CodeOptions {
  language: Language;
  /** The raw text of the Root type field. */
  rootName: string;
  /** TypeScript only. */
  declaration: 'interface' | 'type';
  /** TypeScript only. */
  exportTypes: boolean;
}

export interface DuplicateKey {
  key: string;
  line: number;
  column: number;
  offset: number;
}

export interface CodeNotes {
  samples: number;
  duplicates: DuplicateKey[];
}

export type CodeResult = { ok: true; text: string; notes: CodeNotes } | { ok: false; error: JsonErrorInfo };

/** Up to this many characters the result follows every change (§12). */
export const LIVE_INPUT = 1024 * 1024;
/** Above this many characters the input is refused (§12). */
export const MAX_INPUT = 16 * 1024 * 1024;

export const LANGUAGES: ReadonlyArray<{ value: Language; label: string }> = [
  { value: 'typescript', label: 'TypeScript' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'python', label: 'Python' },
];

export const DEFAULT_OPTIONS: CodeOptions = {
  language: 'typescript',
  rootName: '',
  declaration: 'interface',
  exportTypes: true,
};

export const jsonToCode = (text: string, options: CodeOptions): CodeResult => {
  if (text.trim() === '') return { ok: true, text: '', notes: { samples: 0, duplicates: [] } };
  const parsed = parseJsonValues(text, { allowComments: true });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const shape = inferShape(parsed.values, options.rootName);
  return {
    ok: true,
    text: `${WRITERS[options.language](shape, options)}\n`,
    notes: {
      samples: parsed.values.length,
      duplicates: parsed.notes.duplicateKeys.map(({ key, line, column, offset }) => ({ key, line, column, offset })),
    },
  };
};

/** A key in a note: 40 characters at most, then `…`. */
const shortKey = (key: string): string => {
  const chars = [...key];
  return chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : key;
};

/** The notes under the result (§5 «Заметки»), in their order. */
export const describeNotes = (notes: CodeNotes): string[] => {
  const lines: string[] = [];
  if (notes.samples > 1)
    lines.push(`${notes.samples.toLocaleString('en-US')} samples merged: keys missing from some of them are optional.`);
  const first = notes.duplicates[0];
  if (first) {
    const where = `"${shortKey(first.key)}" at line ${first.line}, column ${first.column}: the type follows its last value, as JSON.parse does.`;
    lines.push(
      notes.duplicates.length === 1
        ? `Duplicate key ${where}`
        : `${notes.duplicates.length.toLocaleString('en-US')} duplicate keys, the first: ${where}`,
    );
  }
  return lines;
};
