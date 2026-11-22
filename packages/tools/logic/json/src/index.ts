/**
 * @workspace/tool-logic-json — the JSON tool's logic, everything its component, its worker and its `detect` use: this
 * tool's own functions, and from the shared scanner what the page needs as well (reading a file, the limits of showing a
 * result, the types).
 */
export * from './logic';
export { SHOW_RESULT_CHARS, SHOW_RESULT_LINES, decodeTextFile } from '@workspace/tools-shared/json-scan';
export type {
  DuplicateKey,
  Indent,
  JsonErrorInfo,
  JsonNotes,
  Layout,
  ParseOptions,
} from '@workspace/tools-shared/json-scan';
