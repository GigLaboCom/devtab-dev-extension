/**
 * What the Lines tool remembers between uses (D21; docs/tools/settings.md): the pipeline the person built — which steps
 * are on and every option inside them, the custom separators, the prefix and the suffix included (they configure how
 * lines are written, they are not the lines). Never the input or the result, the Filter text (a search for this input,
 * often the data itself) or the shuffled order (the history keeps those, D17).
 *
 * A typed text is kept up to 512 characters as JSON (`TEXT_JSON_MAX`), so that the whole record — four texts at their
 * longest and every other field away from its default — stays within what a tool may keep
 * (`SAVED_PARAMETERS_MAX_CHARS`, 4,096). A longer one is used on the page and not saved; what was saved stays.
 */
import {
  BLANK_MODES,
  DEFAULT_STEPS,
  DUPLICATE_MODES,
  FILTER_MODES,
  JOIN_WITH,
  NUMBER_FORMATS,
  ORDER_KINDS,
  PADDING,
  SORT_BY,
  SPLIT_ON,
  TRIM_WHERE,
} from './steps';
import { declareSettings, setting } from '@workspace/tools-host';
import type { Choice } from './steps';

/** The longest typed text kept, as JSON with its quotes. */
export const TEXT_JSON_MAX = 514;

const text = setting.text({ maxLength: TEXT_JSON_MAX, test: s => JSON.stringify(s).length <= TEXT_JSON_MAX }, '');
const choice = <T extends string>(choices: ReadonlyArray<Choice<T>>, fallback: NoInfer<T>) =>
  setting.oneOf(
    choices.map(c => c.value),
    fallback,
  );
const d = DEFAULT_STEPS;

export const linesSettings = declareSettings({
  schema: 1,
  fields: {
    splitEnabled: setting.boolean(d.split.enabled),
    splitOn: choice(SPLIT_ON, d.split.on),
    splitCustom: text,
    trimEnabled: setting.boolean(d.trim.enabled),
    trimEnds: choice(TRIM_WHERE, d.trim.mode),
    trimCollapse: setting.boolean(d.trim.collapse),
    filterEnabled: setting.boolean(d.filter.enabled),
    filterMode: choice(FILTER_MODES, d.filter.mode),
    filterMatchCase: setting.boolean(d.filter.matchCase),
    blankEnabled: setting.boolean(d.blank.enabled),
    blankMode: choice(BLANK_MODES, d.blank.mode),
    duplicatesEnabled: setting.boolean(d.duplicates.enabled),
    duplicatesMode: choice(DUPLICATE_MODES, d.duplicates.mode),
    duplicatesIgnoreCase: setting.boolean(d.duplicates.ignoreCase),
    duplicatesIgnoreWhitespace: setting.boolean(d.duplicates.ignoreWhitespace),
    orderEnabled: setting.boolean(d.order.enabled),
    orderKind: choice(ORDER_KINDS, d.order.kind),
    orderSort: choice(SORT_BY, d.order.sort),
    orderDescending: setting.boolean(d.order.descending),
    orderUppercaseFirst: setting.boolean(d.order.uppercaseFirst),
    affixEnabled: setting.boolean(d.affix.enabled),
    affixPrefix: text,
    affixSuffix: text,
    numberEnabled: setting.boolean(d.number.enabled),
    numberFormat: choice(NUMBER_FORMATS, d.number.format),
    numberStart: setting.oneOf([1, 0], d.number.start),
    numberPad: choice(PADDING, d.number.pad),
    joinEnabled: setting.boolean(d.join.enabled),
    joinWith: choice(JOIN_WITH, d.join.with),
    joinCustom: text,
  },
});
