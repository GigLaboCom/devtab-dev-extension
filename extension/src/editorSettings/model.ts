/**
 * The editor's settings as data (D39; docs/research/editor-settings.md §4): what one set holds, its built-in values,
 * the limits, and how a stored record is read back (`normalizeEditorSettings`, `migrateEditorSettings`). Pure: no
 * storage, no DOM (./store.ts keeps it, ./resolve.ts decides what applies to a file).
 *
 * A set is general values plus values by language; the language keys are the ids of the editor's one language list
 * (src/compare/languages.ts). The built-in language values are not a hidden layer: they are the pre-filled rows of the
 * Default set, seen and changed in Settings → Editor like any other — Go indents with tabs; YAML and Ruby by 2; Markdown
 * and Plain text wrap. A language without a row takes the general values.
 *
 * Stored (version 1) — the Default set, which every edition reads: `{version, base, languages}`. Another profile is
 * a set of the same shape under a name (Pro: a second record of its own, ./profiles.ts); a set never holds the theme or
 * the shortcuts (§4.3).
 */
import { LANGUAGES } from '@src/compare/languages';

/** What Tab inserts and what one indent level is. */
export type IndentStyle = 'space' | 'tab';

/** The values of one set: what applies to a file when nothing stronger says otherwise. */
export interface EditorValues {
  indentStyle: IndentStyle;
  /** Spaces per level and the width of a tab (one number: the editor has no separate tab width). */
  indentSize: number;
  /** The file's own indentation, when it has enough indented lines, wins over these values (./detect.ts). */
  detectIndent: boolean;
  /** The code font size in px; null: the theme's. */
  fontSize: number | null;
  /** Long lines wrap (one file alone; side by side nothing wraps). */
  softWrap: boolean;
  /** Spaces and tabs drawn visibly. */
  whitespace: boolean;
  indentGuides: boolean;
  lineNumbers: boolean;
}

/** What a language may set of its own: the values that differ by language. Left out: the general value. */
export type LanguageValues = Partial<Pick<EditorValues, 'indentStyle' | 'indentSize' | 'softWrap'>>;

/** The fields a language row may hold, in the order Settings shows them. */
export const LANGUAGE_FIELDS = ['indentStyle', 'indentSize', 'softWrap'] as const satisfies ReadonlyArray<
  keyof LanguageValues
>;

/** One set: the general values and the languages' own. */
export interface EditorSet {
  base: EditorValues;
  /** By language id (src/compare/languages.ts). An id this build does not know is kept, not applied. */
  languages: Record<string, LanguageValues>;
}

/** The stored record of the Default set. */
export interface EditorSettingsRecord extends EditorSet {
  version: 1;
}

export const EDITOR_SETTINGS_VERSION = 1;

/** The limits of a stored set (§4.6). A value outside is not stored: the field takes its default. */
export const INDENT_SIZE_MIN = 1;
export const INDENT_SIZE_MAX = 16;
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 32;
/** Rows of languages kept, with room for the list to grow. */
export const LANGUAGES_MAX = 64;
/** The longest record written, as JSON (UTF-16 units). */
export const RECORD_MAX_CHARS = 65_536;
const LANGUAGE_ID = /^[a-z][a-z0-9_+#-]{0,31}$/;

/** The built-in values: the last level, and what the Default set starts with. */
export const BUILT_IN_VALUES: Readonly<EditorValues> = Object.freeze({
  indentStyle: 'space',
  indentSize: 4,
  detectIndent: true,
  fontSize: null,
  softWrap: false,
  whitespace: false,
  indentGuides: true,
  lineNumbers: true,
});

/**
 * The languages' built-in rows of the Default set (§4.2): Go is indented with tabs (gofmt); YAML and Ruby by two spaces
 * (their style guides); Markdown and Plain text are prose, so they wrap.
 */
export const BUILT_IN_LANGUAGES: Readonly<Record<string, Readonly<LanguageValues>>> = Object.freeze({
  go: { indentStyle: 'tab' },
  markdown: { softWrap: true },
  ruby: { indentSize: 2 },
  text: { softWrap: true },
  yaml: { indentSize: 2 },
});

const copyLanguages = (languages: Readonly<Record<string, Readonly<LanguageValues>>>): Record<string, LanguageValues> =>
  Object.fromEntries(Object.entries(languages).map(([id, values]) => [id, { ...values }]));

/** The Default set as it starts: the built-in values and the built-in language rows. */
export const defaultEditorSettings = (): EditorSettingsRecord => ({
  version: 1,
  base: { ...BUILT_IN_VALUES },
  languages: copyLanguages(BUILT_IN_LANGUAGES),
});

/** Whether the editor knows the language (an id of src/compare/languages.ts). */
export const isEditorLanguage = (id: string): boolean => LANGUAGES.some(l => l.id === id);

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === 'object' && raw !== null && !Array.isArray(raw);

/** An indent size within the limits, or undefined. */
export const indentSizeOf = (raw: unknown): number | undefined =>
  typeof raw === 'number' && Number.isInteger(raw) && raw >= INDENT_SIZE_MIN && raw <= INDENT_SIZE_MAX
    ? raw
    : undefined;

/** A font size within the limits, null for the theme's, or undefined. */
const fontSizeOf = (raw: unknown): number | null | undefined =>
  raw === null
    ? null
    : typeof raw === 'number' && Number.isInteger(raw) && raw >= FONT_SIZE_MIN && raw <= FONT_SIZE_MAX
      ? raw
      : undefined;

const styleOf = (raw: unknown): IndentStyle | undefined => (raw === 'space' || raw === 'tab' ? raw : undefined);
const flagOf = (raw: unknown): boolean | undefined => (typeof raw === 'boolean' ? raw : undefined);

/** General values as far as they can be read; each field that cannot is its built-in value. */
export const normalizeValues = (raw: unknown): EditorValues => {
  const r = isRecord(raw) ? raw : {};
  return {
    indentStyle: styleOf(r.indentStyle) ?? BUILT_IN_VALUES.indentStyle,
    indentSize: indentSizeOf(r.indentSize) ?? BUILT_IN_VALUES.indentSize,
    detectIndent: flagOf(r.detectIndent) ?? BUILT_IN_VALUES.detectIndent,
    fontSize: fontSizeOf(r.fontSize) ?? BUILT_IN_VALUES.fontSize,
    softWrap: flagOf(r.softWrap) ?? BUILT_IN_VALUES.softWrap,
    whitespace: flagOf(r.whitespace) ?? BUILT_IN_VALUES.whitespace,
    indentGuides: flagOf(r.indentGuides) ?? BUILT_IN_VALUES.indentGuides,
    lineNumbers: flagOf(r.lineNumbers) ?? BUILT_IN_VALUES.lineNumbers,
  };
};

/** A language's row as far as it can be read: what cannot be read is left out (the general value applies). */
export const normalizeLanguageValues = (raw: unknown): LanguageValues => {
  const r = isRecord(raw) ? raw : {};
  const indentStyle = styleOf(r.indentStyle);
  const indentSize = indentSizeOf(r.indentSize);
  const softWrap = flagOf(r.softWrap);
  return {
    ...(indentStyle !== undefined && { indentStyle }),
    ...(indentSize !== undefined && { indentSize }),
    ...(softWrap !== undefined && { softWrap }),
  };
};

/**
 * Version → 1. Version 1 is the first; a record of a newer build is read as far as this one understands it (its
 * unknown fields are not kept when this build writes). Nothing stored: the Default set as it starts.
 */
export const migrateEditorSettings = (raw: unknown): Record<string, unknown> | null => (isRecord(raw) ? raw : null);

/**
 * One set as far as it can be read — the Default set's fields, or a profile's (./profiles.ts): general values each of
 * its type (the built-in value where it is not), and at most `LANGUAGES_MAX` language rows with a valid id.
 */
export const normalizeSet = (source: Record<string, unknown>): EditorSet => {
  const languages = isRecord(source.languages) ? source.languages : {};
  return {
    base: normalizeValues(source.base),
    languages: Object.fromEntries(
      Object.entries(languages)
        .filter(([id, values]) => LANGUAGE_ID.test(id) && isRecord(values))
        .slice(0, LANGUAGES_MAX)
        .map(([id, values]) => [id, normalizeLanguageValues(values)]),
    ),
  };
};

/** The stored record as this build reads it: every field of its type, within the limits, the rest its default. */
export const normalizeEditorSettings = (raw: unknown): EditorSettingsRecord => {
  const source = migrateEditorSettings(raw);
  if (!source) return defaultEditorSettings();
  return { version: 1, ...normalizeSet(source) };
};

/** A set as it starts: the built-in values and the built-in language rows (what "Reset" puts back in any profile). */
export const builtInSet = (): EditorSet => ({
  base: { ...BUILT_IN_VALUES },
  languages: copyLanguages(BUILT_IN_LANGUAGES),
});

/** Two language rows say the same. */
export const sameLanguageValues = (a: LanguageValues | undefined, b: LanguageValues | undefined): boolean =>
  LANGUAGE_FIELDS.every(field => a?.[field] === b?.[field]);

/** The set with a language's row changed; `undefined` removes the row. */
export const withLanguage = <T extends EditorSet>(
  record: T,
  language: string,
  values: LanguageValues | undefined,
): T => {
  const languages = { ...record.languages };
  if (values === undefined) delete languages[language];
  else languages[language] = normalizeLanguageValues(values);
  return { ...record, languages };
};

/** The set with a language's row back to its built-in one (a language with none: no row). */
export const withLanguageReset = <T extends EditorSet>(record: T, language: string): T => {
  const builtIn = BUILT_IN_LANGUAGES[language];
  return withLanguage(record, language, builtIn ? { ...builtIn } : undefined);
};

/** Whether a language's row differs from its built-in one (what "Reset" would change). */
export const languageChanged = (record: EditorSet, language: string): boolean => {
  const builtIn = BUILT_IN_LANGUAGES[language];
  const row = record.languages[language];
  return builtIn ? !sameLanguageValues(row, builtIn) : row !== undefined;
};
