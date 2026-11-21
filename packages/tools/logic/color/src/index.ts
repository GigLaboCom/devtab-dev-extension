/**
 * @workspace/tool-logic-color — the Color tool's logic, everything its component and its `detect` use. One module per
 * concern: `detect` (and the syntax check it shares with `parseColor`) never brings the colour library along.
 */
export * from './detect';
export * from './logic';
export { COLOR_FUNCTIONS, COLOR_SPACES, isColorFunction } from './syntax';
