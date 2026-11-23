/**
 * What JSON and CSV remembers between uses (D21; docs/tools/settings.md): the direction, Header row and every option
 * of both directions — each direction's delimiter apart, flattening, line breaks, quoting, the formula protection, the
 * BOM, type detection, empty cells, dotted headers, the indent. Never the input, its file or its name, or the result
 * (the history keeps the input, D17).
 *
 * The direction chosen by a pasted text (detectCsv) or by an opened file's extension, and the Tab a `.tsv` file sets,
 * are for that visit only; Swap is the person's choice and is saved with the delimiter it hands to the new direction.
 */
import { DEFAULT_OPTIONS } from './entries';
import { declareSettings, setting } from '@workspace/tools-host';
import type { JsonCsvOptionsPayload } from './history';
import type { Delimiter } from '@workspace/tool-logic-json-csv';
import type { SettingsValues } from '@workspace/tools-host';

const DELIMITERS = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' } as const satisfies Record<string, Delimiter>;
type DelimiterName = keyof typeof DELIMITERS;
const NAMES = Object.keys(DELIMITERS) as DelimiterName[];

/** A delimiter as it is saved (`comma`, …). */
export const nameOfDelimiter = (d: Delimiter): DelimiterName => NAMES.find(name => DELIMITERS[name] === d)!;

const { toCsv: csv, toJson: json } = DEFAULT_OPTIONS;

export const jsonCsvSettings = declareSettings({
  schema: 1,
  fields: {
    direction: setting.oneOf(['to-csv', 'to-json'], DEFAULT_OPTIONS.direction),
    header: setting.boolean(DEFAULT_OPTIONS.header),
    csvDelimiter: setting.oneOf(NAMES, nameOfDelimiter(csv.delimiter)),
    csvFlatten: setting.boolean(csv.flatten),
    csvNewline: setting.oneOf(['crlf', 'lf'], csv.newline),
    csvQuoteAll: setting.boolean(csv.quoteAll),
    csvProtectFormulas: setting.boolean(csv.protectFormulas),
    csvBom: setting.boolean(csv.bom),
    jsonDelimiter: setting.oneOf(['auto', ...NAMES], 'auto'),
    jsonDetectTypes: setting.boolean(json.detectTypes),
    jsonEmpty: setting.oneOf(['null', 'string', 'omit'], json.empty),
    jsonNest: setting.boolean(json.nest),
    jsonIndent: setting.oneOf([2, 4, 'tab', 'minify'], json.layout),
  },
});

export type JsonCsvSettings = SettingsValues<typeof jsonCsvSettings>;

/** The direction and options the saved values stand for. */
export const optionsOfSaved = (v: JsonCsvSettings): JsonCsvOptionsPayload => ({
  direction: v.direction,
  header: v.header,
  toCsv: {
    delimiter: DELIMITERS[v.csvDelimiter],
    flatten: v.csvFlatten,
    newline: v.csvNewline,
    quoteAll: v.csvQuoteAll,
    protectFormulas: v.csvProtectFormulas,
    bom: v.csvBom,
  },
  toJson: {
    delimiter: v.jsonDelimiter === 'auto' ? 'auto' : DELIMITERS[v.jsonDelimiter],
    detectTypes: v.jsonDetectTypes,
    empty: v.jsonEmpty,
    nest: v.jsonNest,
    layout: v.jsonIndent,
  },
});

/** All the saved values of a direction and its options (an opened entry's, for the visit). */
export const savedOfOptions = (o: JsonCsvOptionsPayload): JsonCsvSettings => ({
  direction: o.direction,
  header: o.header,
  csvDelimiter: nameOfDelimiter(o.toCsv.delimiter),
  csvFlatten: o.toCsv.flatten,
  csvNewline: o.toCsv.newline,
  csvQuoteAll: o.toCsv.quoteAll,
  csvProtectFormulas: o.toCsv.protectFormulas,
  csvBom: o.toCsv.bom,
  jsonDelimiter: o.toJson.delimiter === 'auto' ? 'auto' : nameOfDelimiter(o.toJson.delimiter),
  jsonDetectTypes: o.toJson.detectTypes,
  jsonEmpty: o.toJson.empty,
  jsonNest: o.toJson.nest,
  jsonIndent: o.toJson.layout,
});
