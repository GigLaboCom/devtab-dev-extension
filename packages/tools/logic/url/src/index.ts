/**
 * @workspace/tool-logic-url — the URL tool's logic, everything its component and its definition use. One module per
 * concern, so the definition's `detectUrl` brings only the codec and the platform parser to the start page.
 */
export * from './codec';
export * from './detect';
export { isBlankUrl } from './platform';
export type { PartKey } from './platform';
export * from './logic';
