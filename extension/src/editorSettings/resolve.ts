/**
 * What applies to one open text, and where each value came from (research §2.5, §4.8): a pure function over the
 * levels, strongest first —
 *
 *   1. file        the person's choice for this file in the indent indicator (lives while the file is open);
 *   2. project     the project's settings for this file — `.editorconfig` (stage 3, Pro); no level yet: `null`;
 *   3. detected    the indentation the text already uses (./detect.ts), when the set says to detect it;
 *   4. language    the language's row of the active set;
 *   5. general     the active set's general values;
 *   6. default     the built-in values (./model.ts), for what the set does not hold.
 *
 * Each value is resolved on its own: a level that sets only the size leaves the style to the levels below it. Which set
 * is active is the caller's (`profile`): today always the Default set; with profiles (stage 2, Pro) the profile chosen
 * globally or for the project — the same shape, so this function does not change.
 */
import { BUILT_IN_VALUES, INDENT_SIZE_MAX, INDENT_SIZE_MIN } from './model';
import type { DetectedIndent } from './detect';
import type { EditorSet, EditorValues, IndentStyle, LanguageValues } from './model';
import type { EditorSettings } from '@extension/review-wasm';

/** The person's choice for one open file in the indicator. */
export interface FileChoice {
  indentStyle?: IndentStyle;
  indentSize?: number;
}

/** What a project says about a file (stage 3: `.editorconfig`). Only these fields have a meaning there. */
export type ProjectValues = Partial<Pick<EditorValues, 'indentStyle' | 'indentSize'>>;

/** Where a value came from: the level that set it. */
export type Source = 'file' | 'project' | 'detected' | 'language' | 'general' | 'default';

export interface ResolveInput {
  /** The active set (levels 4 and 5); a stored set is complete, a partial one falls through to the built-in values. */
  profile: { base: Partial<EditorValues>; languages: Readonly<Record<string, LanguageValues>> } | EditorSet;
  /** A language id of the editor (src/compare/languages.ts). */
  language: string;
  /** What the text's own indentation says (level 3); null: nothing detected. */
  detected: DetectedIndent | null;
  /** What the project says (level 2); null until stage 3. */
  project: ProjectValues | null;
  /** The person's choice for this file (level 1); null: none. */
  file: FileChoice | null;
  /** The built-in values (level 6); the model's unless a test says otherwise. */
  builtIn?: Readonly<EditorValues>;
}

export interface Effective {
  values: EditorValues;
  /** For each value, the level it came from. */
  sources: Record<keyof EditorValues, Source>;
}

const clampSize = (size: number): number => Math.min(INDENT_SIZE_MAX, Math.max(INDENT_SIZE_MIN, Math.round(size)));

/** What applies to a text, value by value, strongest level first. */
export const effectiveEditorSettings = (input: ResolveInput): Effective => {
  const builtIn = input.builtIn ?? BUILT_IN_VALUES;
  const language = input.profile.languages[input.language] ?? {};
  const base = input.profile.base;
  const values = { ...builtIn } as EditorValues;
  const sources = {} as Record<keyof EditorValues, Source>;
  const keys = Object.keys(builtIn) as Array<keyof EditorValues>;
  /** Levels 4–6 for one value. */
  const fromSet = <K extends keyof EditorValues>(key: K): [EditorValues[K], Source] => {
    const own = (language as Partial<EditorValues>)[key];
    if (own !== undefined) return [own as EditorValues[K], 'language'];
    if (base[key] !== undefined) return [base[key] as EditorValues[K], 'general'];
    return [builtIn[key], 'default'];
  };
  for (const key of keys) {
    const [value, source] = fromSet(key);
    (values as unknown as Record<string, unknown>)[key] = value;
    sources[key] = source;
  }
  // Level 3 only where the set says to detect; then 2, then 1 — each over what is below it.
  const detected = values.detectIndent ? input.detected : null;
  const levels: Array<[Source, Partial<Pick<EditorValues, 'indentStyle' | 'indentSize'>> | null]> = [
    ['detected', detected],
    ['project', input.project],
    ['file', input.file],
  ];
  for (const [source, level] of levels) {
    if (!level) continue;
    if (level.indentStyle === 'space' || level.indentStyle === 'tab') {
      values.indentStyle = level.indentStyle;
      sources.indentStyle = source;
    }
    if (typeof level.indentSize === 'number' && Number.isFinite(level.indentSize)) {
      values.indentSize = clampSize(level.indentSize);
      sources.indentSize = source;
    }
  }
  values.indentSize = clampSize(values.indentSize);
  return { values, sources };
};

/** The strongest level among the indent's two values: what the indicator names. */
export const indentSource = (effective: Effective): Source => {
  const order: Source[] = ['file', 'project', 'detected', 'language', 'general', 'default'];
  const { indentStyle, indentSize } = effective.sources;
  return order[Math.min(order.indexOf(indentStyle), order.indexOf(indentSize))]!;
};

/** What the editor module is given for a text: every value it shows (the detection switch stays here). */
export const toModuleSettings = ({ values }: Effective): EditorSettings => ({
  indentStyle: values.indentStyle,
  indentSize: values.indentSize,
  softWrap: values.softWrap,
  whitespace: values.whitespace,
  indentGuides: values.indentGuides,
  lineNumbers: values.lineNumbers,
  fontSize: values.fontSize,
});
