/**
 * The JSON to Code tool's history entries as the component writes and reads them: the drafts, their labels, the search
 * excerpt, and the options read back from a payload (what is missing or not understood falls back to the defaults).
 */
import { DEFAULT_OPTIONS, LANGUAGES } from '@workspace/tool-logic-json-to-code';
import type { JsonToCodeOptionsPayload, JsonToCodeResultPayload } from './history';
import type { CodeResult, Language } from '@workspace/tool-logic-json-to-code';
import type { HistoryDraft } from '@workspace/tools-host';

export const languageLabel = (language: Language): string =>
  LANGUAGES.find(l => l.value === language)?.label ?? language;

const ACTION_LABEL: Record<JsonToCodeResultPayload['action'], string> = { copy: 'copied', generate: 'generated' };

/** The root's name as typed, or the default. */
const rootLabel = (rootName: string): string => rootName.trim() || 'Root';

/** `TypeScript · Root · copied`, `Go · UserProfile · error at line 3, column 1 · generated`. */
export const resultLabel = (p: JsonToCodeResultPayload): string =>
  [
    languageLabel(p.language),
    rootLabel(p.rootName),
    p.ok ? '' : `error at line ${p.error?.line}, column ${p.error?.column}`,
    ACTION_LABEL[p.action],
  ]
    .filter(Boolean)
    .join(' · ');

export const editLabel = (language: Language, length: number): string =>
  `Edit · ${languageLabel(language)} · ${length.toLocaleString('en-US')} characters`;

/** The first characters of the sample, for the History list's text search. */
export const excerpt = (text: string): string => text.slice(0, 2000);

const json = (value: string): Blob => new Blob([value], { type: 'application/json' });
const plain = (value: string): Blob => new Blob([value], { type: 'text/plain' });

export const editDraft = (text: string, options: JsonToCodeOptionsPayload): HistoryDraft => ({
  kind: 'edit',
  payload: { ...options },
  label: editLabel(options.language, text.length),
  text: excerpt(text),
  blobs: { input: json(text) },
});

export const resultDraft = (
  text: string,
  options: JsonToCodeOptionsPayload,
  action: JsonToCodeResultPayload['action'],
  result: CodeResult,
): HistoryDraft => {
  const payload: JsonToCodeResultPayload = {
    ...options,
    action,
    ok: result.ok,
    ...(result.ok
      ? { samples: result.notes.samples }
      : { error: { line: result.error.line, column: result.error.column, message: result.error.message } }),
  };
  return {
    kind: 'result',
    payload,
    label: resultLabel(payload),
    text: excerpt(text),
    blobs: result.ok ? { input: json(text), output: plain(result.text) } : { input: json(text) },
  };
};

const isLanguage = (v: unknown): v is Language => LANGUAGES.some(l => l.value === v);

/** The options an entry was made with. */
export const readEntry = (payload: unknown): JsonToCodeOptionsPayload => {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Partial<JsonToCodeOptionsPayload>;
  return {
    language: isLanguage(p.language) ? p.language : DEFAULT_OPTIONS.language,
    rootName: typeof p.rootName === 'string' ? p.rootName : DEFAULT_OPTIONS.rootName,
    declaration: p.declaration === 'type' ? 'type' : 'interface',
    exportTypes: p.exportTypes !== false,
  };
};
