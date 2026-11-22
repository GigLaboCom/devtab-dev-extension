/**
 * The JSON and CSV tool's logic: the functions and types of docs/tools/specs/json-csv.md §9, with their signatures.
 * Pure: no React, no DOM, no chrome. JSON is read only by the shared exact scanner (@workspace/tools-shared/json-scan),
 * never by `JSON.parse`, so a value a double cannot hold reaches the CSV as written; CSV is read and written by this
 * package's own RFC 4180 code (§11: no library). Sizes are the component's to check (LIVE_INPUT, MAX_INPUT); these
 * functions take any input and throw nothing.
 */
export * from './types';
export { DELIMITER_NAMES, detectDelimiter, looksLikeFormula, readCsv } from './csv';
export { jsonToCsv, withBom } from './toCsv';
export { csvToJson } from './toJson';
export { describeLosses, describeNotes, describeTable, formatMegabytes, measureText } from './notes';
export { detectCsv } from './detect';
