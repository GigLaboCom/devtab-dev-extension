/**
 * @workspace/tool-logic-date-calc — the Date Calculator tool's logic (docs/tools/specs/date-calc.md §9), everything its
 * component and its `detect` use. `detect` is a module of its own that imports nothing.
 */
export * from './detect';
export * from './moment';
export * from './duration';
export * from './calendar';
export * from './zones';
export { MAX_INPUT, OUT_OF_RANGE, clockChanges, clockChangeText, lengthWords } from './clock';
export type { ClockChange } from './clock';
// The component imports only its own logic: the shared pieces it needs come through here.
export { browserTimeZone, formatIsoUtc, resolveTimeZone, zoneOptions } from '@workspace/tools-shared/time';
export type { ZoneOption } from '@workspace/tools-shared/time';
