/**
 * What applies to one open text, and where each value came from (research §2.5, §4.8): a pure function over the
 * levels, strongest first —
 *
 *   1. file        the person's choice for this file in the indent indicator (lives while the file is open);
 *   2. project     the project's settings for this file — its `.editorconfig` (Pro; ./project.ts); `null` for a scratch,
 *                  «Compare code», a project that says nothing, and in the free edition;
 *   3. detected    the indentation the text already uses (./detect.ts), when the set says to detect it;
 *   4. language    the language's row of the active set;
 *   5. general     the active set's general values;
 *   6. default     the built-in values (./model.ts), for what the set does not hold.
 *
 * Each value is resolved on its own: a level that sets only the size leaves the style to the levels below it. The
 * project gives the size as EditorConfig does, two numbers (`indentSize`, `tabWidth`) where the editor has one: which
 * one applies follows the style in force — tabs take the tab width, spaces the indent size, each falling back to the
 * other (research §4.1). Which set is active is the caller's (`profile`): the Default set, or the profile chosen
 * globally or for the project (Pro, ./profiles.ts) — the same shape.
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

/** What a project says about a file (its `.editorconfig`, ./project.ts). Only these fields have a meaning there. */
export interface ProjectValues {
  indentStyle?: IndentStyle;
  /** EditorConfig's `indent_size`: what one indent level is when indenting with spaces. */
  indentSize?: number;
  /** EditorConfig's `tab_width`: how wide a tab is, so the size when indenting with tabs. */
  tabWidth?: number;
}

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
  // Levels 3, 2 and 1, each over what is below it: the style first, since the project's size depends on it.
  const detected = values.detectIndent ? input.detected : null;
  const project = input.project;
  const isStyle = (style: unknown): style is IndentStyle => style === 'space' || style === 'tab';
  const isSize = (size: unknown): size is number => typeof size === 'number' && Number.isFinite(size);
  for (const [source, style] of [
    ['detected', detected?.indentStyle],
    ['project', project?.indentStyle],
    ['file', input.file?.indentStyle],
  ] as const) {
    if (!isStyle(style)) continue;
    values.indentStyle = style;
    sources.indentStyle = source;
  }
  const projectSize = project
    ? values.indentStyle === 'tab'
      ? isSize(project.tabWidth)
        ? project.tabWidth
        : project.indentSize
      : isSize(project.indentSize)
        ? project.indentSize
        : project.tabWidth
    : undefined;
  for (const [source, size] of [
    ['detected', detected?.indentSize],
    ['project', projectSize],
    ['file', input.file?.indentSize],
  ] as const) {
    if (!isSize(size)) continue;
    values.indentSize = clampSize(size);
    sources.indentSize = source;
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
