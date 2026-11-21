/**
 * @workspace/tool-logic-jwt — the JWT tool's logic (docs/tools/specs/jwt.md §9), everything its component and its
 * definition use. `detect` is a module of its own: the definition (part of every page that lists the tools) takes only
 * it.
 */
export * from './detect';
export * from './decode';
export * from './claims';
export * from './key';
export * from './verify';
