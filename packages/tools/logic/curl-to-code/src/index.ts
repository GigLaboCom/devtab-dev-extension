/** @workspace/tool-logic-curl-to-code — the cURL to Code tool's logic, everything its component and its definition use. */
export * from './logic';
export { curlUrlEncode, parseCurl } from './parse';
export { generate, GENERATORS } from './generate';
export { isCmdForm, splitWords } from './words';
export type { Word, Words } from './words';
export type * from './types';
