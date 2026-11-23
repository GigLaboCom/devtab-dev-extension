/**
 * The steps as the page holds them (docs/tools/specs/lines.md §4, §8): what each control shows, including the choices
 * the logic sees only as their result (Split on `Custom…` with its field, Join with `Custom…`), the defaults of §4, the
 * option lists with their words, the mapping to the logic's Pipeline, and a reader that takes a stored value back
 * (a history entry) field by field, falling back to the default where a field is missing or not one of the choices.
 * The saved parameters (settings.ts) are the same steps as flat keys: `flatOf` and `stepsOf` go between the two.
 */
import type { linesSettings } from './settings';
import type {
  BlankMode,
  DuplicateMode,
  NumberAfter,
  NumberPad,
  OrderKind,
  Pipeline,
  SortKind,
  TrimMode,
} from '@workspace/tool-logic-lines';
import type { SettingsValues } from '@workspace/tools-host';

export type SplitOn = 'comma' | 'semicolon' | 'tab' | 'pipe' | 'whitespace' | 'custom';
export type JoinWith = 'comma-space' | 'comma' | 'semicolon-space' | 'space' | 'tab' | 'pipe' | 'nothing' | 'custom';
export type NumberFormat = 'dot' | 'paren' | 'colon' | 'space' | 'tab';
export type FilterMode = 'keep' | 'remove';

export interface Steps {
  split: { enabled: boolean; on: SplitOn; custom: string };
  trim: { enabled: boolean; mode: TrimMode; collapse: boolean };
  filter: { enabled: boolean; mode: FilterMode; text: string; matchCase: boolean };
  blank: { enabled: boolean; mode: BlankMode };
  duplicates: { enabled: boolean; mode: DuplicateMode; ignoreCase: boolean; ignoreWhitespace: boolean };
  order: { enabled: boolean; kind: OrderKind; sort: SortKind; descending: boolean; uppercaseFirst: boolean };
  affix: { enabled: boolean; prefix: string; suffix: string };
  number: { enabled: boolean; format: NumberFormat; start: 0 | 1; pad: NumberPad };
  join: { enabled: boolean; with: JoinWith; custom: string };
}

export type StepId = keyof Steps;

/** §4: every step off, the defaults inside. */
export const DEFAULT_STEPS: Steps = {
  split: { enabled: false, on: 'comma', custom: '' },
  trim: { enabled: false, mode: 'both', collapse: false },
  filter: { enabled: false, mode: 'keep', text: '', matchCase: false },
  blank: { enabled: false, mode: 'all' },
  duplicates: { enabled: false, mode: 'remove', ignoreCase: false, ignoreWhitespace: false },
  order: { enabled: false, kind: 'sort', sort: 'alphabetical', descending: false, uppercaseFirst: false },
  affix: { enabled: false, prefix: '', suffix: '' },
  number: { enabled: false, format: 'dot', start: 1, pad: 'none' },
  join: { enabled: false, with: 'comma-space', custom: '' },
};

/** The steps in the order they apply (§5.2), with their checkbox words (§8). */
export const STEP_ORDER: ReadonlyArray<{ id: StepId; label: string }> = [
  { id: 'split', label: 'Split lines' },
  { id: 'trim', label: 'Trim' },
  { id: 'filter', label: 'Filter' },
  { id: 'blank', label: 'Remove blank lines' },
  { id: 'duplicates', label: 'Duplicates' },
  { id: 'order', label: 'Order' },
  { id: 'affix', label: 'Prefix and suffix' },
  { id: 'number', label: 'Number lines' },
  { id: 'join', label: 'Join into one line' },
];

export interface Choice<T extends string> {
  value: T;
  label: string;
}

export const SPLIT_ON: ReadonlyArray<Choice<SplitOn>> = [
  { value: 'comma', label: 'Comma (,)' },
  { value: 'semicolon', label: 'Semicolon (;)' },
  { value: 'tab', label: 'Tab' },
  { value: 'pipe', label: 'Pipe (|)' },
  { value: 'whitespace', label: 'Whitespace' },
  { value: 'custom', label: 'Custom…' },
];
const SPLIT_TEXT: Record<Exclude<SplitOn, 'whitespace' | 'custom'>, string> = {
  comma: ',',
  semicolon: ';',
  tab: '\t',
  pipe: '|',
};

export const TRIM_WHERE: ReadonlyArray<Choice<TrimMode>> = [
  { value: 'both', label: 'Both ends' },
  { value: 'start', label: 'Start' },
  { value: 'end', label: 'End' },
];

export const FILTER_MODES: ReadonlyArray<Choice<FilterMode>> = [
  { value: 'keep', label: 'Keep lines containing' },
  { value: 'remove', label: 'Remove lines containing' },
];

export const BLANK_MODES: ReadonlyArray<Choice<BlankMode>> = [
  { value: 'all', label: 'All' },
  { value: 'repeated', label: 'Keep one in a row' },
];

export const DUPLICATE_MODES: ReadonlyArray<Choice<DuplicateMode>> = [
  { value: 'remove', label: 'Remove duplicates' },
  { value: 'duplicated', label: 'Keep only duplicated' },
  { value: 'unique', label: 'Keep only unique' },
  { value: 'count', label: 'Count occurrences' },
];

export const ORDER_KINDS: ReadonlyArray<Choice<OrderKind>> = [
  { value: 'sort', label: 'Sort' },
  { value: 'reverse', label: 'Reverse' },
  { value: 'shuffle', label: 'Shuffle' },
];

export const SORT_BY: ReadonlyArray<Choice<SortKind>> = [
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'natural', label: 'Natural (file2 before file10)' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'length', label: 'Length' },
  { value: 'codepoint', label: 'Code point' },
];

export type Direction = 'ascending' | 'descending';
export const DIRECTIONS: ReadonlyArray<Choice<Direction>> = [
  { value: 'ascending', label: 'Ascending' },
  { value: 'descending', label: 'Descending' },
];

export const NUMBER_FORMATS: ReadonlyArray<Choice<NumberFormat>> = [
  { value: 'dot', label: '1. item' },
  { value: 'paren', label: '1) item' },
  { value: 'colon', label: '1: item' },
  { value: 'space', label: '1 item' },
  { value: 'tab', label: '1 [Tab] item' },
];
const NUMBER_AFTER: Record<NumberFormat, NumberAfter> = { dot: '. ', paren: ') ', colon: ': ', space: ' ', tab: '\t' };

export type StartAt = '1' | '0';
export const START_AT: ReadonlyArray<Choice<StartAt>> = [
  { value: '1', label: 'Start at 1' },
  { value: '0', label: 'Start at 0' },
];

export const PADDING: ReadonlyArray<Choice<NumberPad>> = [
  { value: 'none', label: 'No padding' },
  { value: 'spaces', label: 'Pad with spaces' },
  { value: 'zeros', label: 'Pad with zeros' },
];

export const JOIN_WITH: ReadonlyArray<Choice<JoinWith>> = [
  { value: 'comma-space', label: 'Comma and space' },
  { value: 'comma', label: 'Comma' },
  { value: 'semicolon-space', label: 'Semicolon and space' },
  { value: 'space', label: 'Space' },
  { value: 'tab', label: 'Tab' },
  { value: 'pipe', label: 'Pipe' },
  { value: 'nothing', label: 'Nothing' },
  { value: 'custom', label: 'Custom…' },
];
const JOIN_TEXT: Record<Exclude<JoinWith, 'custom'>, string> = {
  'comma-space': ', ',
  comma: ',',
  'semicolon-space': '; ',
  space: ' ',
  tab: '\t',
  pipe: '|',
  nothing: '',
};

/** Uppercase first applies to Alphabetical and Natural only (§4, §8). */
export const takesUppercaseFirst = (kind: SortKind): boolean => kind === 'alphabetical' || kind === 'natural';

/** What the logic runs. */
export const toPipeline = (s: Steps): Pipeline => ({
  split: {
    enabled: s.split.enabled,
    separator:
      s.split.on === 'whitespace'
        ? { kind: 'whitespace' }
        : { kind: 'text', text: s.split.on === 'custom' ? s.split.custom : SPLIT_TEXT[s.split.on] },
  },
  trim: { ...s.trim },
  filter: {
    enabled: s.filter.enabled,
    keep: s.filter.mode === 'keep',
    text: s.filter.text,
    matchCase: s.filter.matchCase,
  },
  blank: { ...s.blank },
  duplicates: { ...s.duplicates },
  order: {
    enabled: s.order.enabled,
    kind: s.order.kind,
    sort: {
      kind: s.order.sort,
      descending: s.order.descending,
      uppercaseFirst: takesUppercaseFirst(s.order.sort) && s.order.uppercaseFirst,
    },
  },
  affix: { ...s.affix },
  number: { enabled: s.number.enabled, after: NUMBER_AFTER[s.number.format], start: s.number.start, pad: s.number.pad },
  join: { enabled: s.join.enabled, separator: s.join.with === 'custom' ? s.join.custom : JOIN_TEXT[s.join.with] },
});

/** Every step off, their options kept (Use as input, §4). */
export const allOff = (s: Steps): Steps =>
  Object.fromEntries(Object.entries(s).map(([id, step]) => [id, { ...step, enabled: false }])) as unknown as Steps;

export const isShuffling = (s: Steps): boolean => s.order.enabled && s.order.kind === 'shuffle';

/** Names of the enabled steps, for a history entry's label: "Trim · Duplicates · Sort: Natural". */
export const describeSteps = (s: Steps): string[] =>
  STEP_ORDER.filter(({ id }) => s[id].enabled).map(({ id, label }) => {
    if (id !== 'order') return label;
    if (s.order.kind !== 'sort') return s.order.kind === 'reverse' ? 'Reverse' : 'Shuffle';
    const by = SORT_BY.find(c => c.value === s.order.sort)!.label.replace(/ \(.*\)$/, '');
    return `Sort: ${by}${s.order.descending ? ', descending' : ''}`;
  });

const oneOf = <T extends string | number>(choices: readonly T[], value: unknown, fallback: T): T =>
  choices.includes(value as T) ? (value as T) : fallback;
const values = <T extends string>(choices: ReadonlyArray<Choice<T>>): T[] => choices.map(c => c.value);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const text = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/** Steps from a stored value (a history entry's payload), field by field over the defaults. */
export const readSteps = (raw: unknown): Steps => {
  const r = record(raw);
  const d = DEFAULT_STEPS;
  const step = (id: StepId) => record(r[id]);
  const split = step('split');
  const trim = step('trim');
  const filter = step('filter');
  const blank = step('blank');
  const dup = step('duplicates');
  const order = step('order');
  const affix = step('affix');
  const number = step('number');
  const join = step('join');
  return {
    split: {
      enabled: bool(split.enabled, false),
      on: oneOf(values(SPLIT_ON), split.on, d.split.on),
      custom: text(split.custom, ''),
    },
    trim: {
      enabled: bool(trim.enabled, false),
      mode: oneOf(values(TRIM_WHERE), trim.mode, d.trim.mode),
      collapse: bool(trim.collapse, false),
    },
    filter: {
      enabled: bool(filter.enabled, false),
      mode: oneOf(values(FILTER_MODES), filter.mode, d.filter.mode),
      text: text(filter.text, ''),
      matchCase: bool(filter.matchCase, false),
    },
    blank: { enabled: bool(blank.enabled, false), mode: oneOf(values(BLANK_MODES), blank.mode, d.blank.mode) },
    duplicates: {
      enabled: bool(dup.enabled, false),
      mode: oneOf(values(DUPLICATE_MODES), dup.mode, d.duplicates.mode),
      ignoreCase: bool(dup.ignoreCase, false),
      ignoreWhitespace: bool(dup.ignoreWhitespace, false),
    },
    order: {
      enabled: bool(order.enabled, false),
      kind: oneOf(values(ORDER_KINDS), order.kind, d.order.kind),
      sort: oneOf(values(SORT_BY), order.sort, d.order.sort),
      descending: bool(order.descending, false),
      uppercaseFirst: bool(order.uppercaseFirst, false),
    },
    affix: { enabled: bool(affix.enabled, false), prefix: text(affix.prefix, ''), suffix: text(affix.suffix, '') },
    number: {
      enabled: bool(number.enabled, false),
      format: oneOf(values(NUMBER_FORMATS), number.format, d.number.format),
      start: oneOf([0, 1] as const, number.start, d.number.start),
      pad: oneOf(values(PADDING), number.pad, d.number.pad),
    },
    join: {
      enabled: bool(join.enabled, false),
      with: oneOf(values(JOIN_WITH), join.with, d.join.with),
      custom: text(join.custom, ''),
    },
  };
};

/** The steps as saved parameters: one flat key per option, everything but the Filter text. */
export type SavedSteps = SettingsValues<typeof linesSettings>;

/** The steps as saved parameters (the Filter text is not one). */
export const flatOf = (s: Steps): SavedSteps => ({
  splitEnabled: s.split.enabled,
  splitOn: s.split.on,
  splitCustom: s.split.custom,
  trimEnabled: s.trim.enabled,
  trimEnds: s.trim.mode,
  trimCollapse: s.trim.collapse,
  filterEnabled: s.filter.enabled,
  filterMode: s.filter.mode,
  filterMatchCase: s.filter.matchCase,
  blankEnabled: s.blank.enabled,
  blankMode: s.blank.mode,
  duplicatesEnabled: s.duplicates.enabled,
  duplicatesMode: s.duplicates.mode,
  duplicatesIgnoreCase: s.duplicates.ignoreCase,
  duplicatesIgnoreWhitespace: s.duplicates.ignoreWhitespace,
  orderEnabled: s.order.enabled,
  orderKind: s.order.kind,
  orderSort: s.order.sort,
  orderDescending: s.order.descending,
  orderUppercaseFirst: s.order.uppercaseFirst,
  affixEnabled: s.affix.enabled,
  affixPrefix: s.affix.prefix,
  affixSuffix: s.affix.suffix,
  numberEnabled: s.number.enabled,
  numberFormat: s.number.format,
  numberStart: s.number.start,
  numberPad: s.number.pad,
  joinEnabled: s.join.enabled,
  joinWith: s.join.with,
  joinCustom: s.join.custom,
});

/** The steps from saved parameters and the Filter text the page holds. */
export const stepsOf = (v: SavedSteps, filterText: string): Steps => ({
  split: { enabled: v.splitEnabled, on: v.splitOn, custom: v.splitCustom },
  trim: { enabled: v.trimEnabled, mode: v.trimEnds, collapse: v.trimCollapse },
  filter: { enabled: v.filterEnabled, mode: v.filterMode, text: filterText, matchCase: v.filterMatchCase },
  blank: { enabled: v.blankEnabled, mode: v.blankMode },
  duplicates: {
    enabled: v.duplicatesEnabled,
    mode: v.duplicatesMode,
    ignoreCase: v.duplicatesIgnoreCase,
    ignoreWhitespace: v.duplicatesIgnoreWhitespace,
  },
  order: {
    enabled: v.orderEnabled,
    kind: v.orderKind,
    sort: v.orderSort,
    descending: v.orderDescending,
    uppercaseFirst: v.orderUppercaseFirst,
  },
  affix: { enabled: v.affixEnabled, prefix: v.affixPrefix, suffix: v.affixSuffix },
  number: { enabled: v.numberEnabled, format: v.numberFormat, start: v.numberStart, pad: v.numberPad },
  join: { enabled: v.joinEnabled, with: v.joinWith, custom: v.joinCustom },
});

/** The saved parameters that differ between two sets of steps — what a change of the person's touched. */
export const changedOf = (before: Steps, after: Steps): Partial<SavedSteps> => {
  const a = flatOf(before);
  const b = flatOf(after);
  return Object.fromEntries(
    (Object.keys(b) as Array<keyof SavedSteps>).filter(key => a[key] !== b[key]).map(key => [key, b[key]]),
  ) as Partial<SavedSteps>;
};
