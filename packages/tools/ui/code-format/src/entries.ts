/** Payload, label, search text and guards of the tool's history entries (the component's chunk only). */
import { DEFAULT_SETTINGS, LANGUAGES, LANGUAGE_LABELS } from '@workspace/tool-logic-code-format';
import type { CodeLanguage, FormatSettings } from '@workspace/tool-logic-code-format';

export type Choice = 'auto' | CodeLanguage;
/** The options as a plain record (a type alias, so that it is JSON for the history). */
export type SettingsRecord = { [K in keyof FormatSettings]: FormatSettings[K] };

/** Payload of schema 1. `action` is set when the person took the result (committed), absent for an edit snapshot. */
export type CodeFormatPayload = {
  /** What the Language list said: `auto` or a language. */
  choice: Choice;
  /** The language the code was formatted as. */
  language: CodeLanguage;
  settings: SettingsRecord;
  outcome: 'ok' | 'error';
  error?: { message: string; line?: number; column?: number };
  lines?: number;
  action?: 'run' | 'copy' | 'save';
};

const INDENT_LABEL: Record<string, string> = { 2: '2 spaces', 4: '4 spaces', tab: 'Tab' };

export const entryLabel = (p: CodeFormatPayload, inputLength: number): string =>
  [
    p.choice === 'auto' ? `${LANGUAGE_LABELS[p.language]} (Auto)` : LANGUAGE_LABELS[p.language],
    INDENT_LABEL[String(p.settings.indent)] ?? '',
    p.outcome === 'error' && p.error
      ? p.error.line !== undefined
        ? `error at line ${p.error.line}, column ${p.error.column}`
        : 'error'
      : '',
    `${inputLength.toLocaleString('en-US')} characters`,
    p.action === 'run' ? 'run' : p.action === 'copy' ? 'copied' : p.action === 'save' ? 'saved' : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What History's text search looks in: the start of the code and of the result. */
export const excerpt = (input: string, output: string): string =>
  output === '' ? input.slice(0, 2000) : `${input.slice(0, 1000)}\n${output.slice(0, 1000)}`;

export const isLanguage = (v: unknown): v is CodeLanguage => (LANGUAGES as readonly unknown[]).includes(v);
export const isChoice = (v: unknown): v is Choice => v === 'auto' || isLanguage(v);

/** The options of a payload, each checked; what is missing or unknown is the default. */
export const settingsOf = (v: unknown): FormatSettings => {
  const s = (typeof v === 'object' && v !== null ? v : {}) as Partial<Record<keyof FormatSettings, unknown>>;
  const pick = <K extends keyof FormatSettings>(key: K, allowed: readonly FormatSettings[K][]): FormatSettings[K] =>
    (allowed as readonly unknown[]).includes(s[key]) ? (s[key] as FormatSettings[K]) : DEFAULT_SETTINGS[key];
  return {
    indent: pick('indent', [2, 4, 'tab']),
    lineWidth: pick('lineWidth', [80, 100, 120]),
    semi: pick('semi', [true, false]),
    singleQuote: pick('singleQuote', [true, false]),
    trailingComma: pick('trailingComma', ['all', 'es5', 'none']),
    whitespace: pick('whitespace', ['css', 'strict', 'ignore']),
    proseWrap: pick('proseWrap', ['preserve', 'always', 'never']),
  };
};

/** The MIME type a language's text is kept and saved with. */
export const MIME: Record<CodeLanguage, string> = {
  javascript: 'text/javascript',
  typescript: 'text/plain',
  css: 'text/css',
  scss: 'text/plain',
  less: 'text/plain',
  html: 'text/html',
  xml: 'application/xml',
  markdown: 'text/markdown',
  yaml: 'application/yaml',
};
