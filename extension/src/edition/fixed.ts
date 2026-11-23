/**
 * `EditionSource`: the edition chosen at build time. It never changes, reads nothing and asks nobody; `ready` is
 * already resolved. The build's two fixed sources are ./fixedPro.ts and ./fixedFree.ts.
 */
import type { EditionSource, SourceState } from './source';

/** Never changes; `ready` is already resolved. */
export const fixedSource = (edition: 'pro' | 'free'): EditionSource => {
  const state: SourceState = { kind: 'fixed', edition };
  return {
    id: edition === 'pro' ? 'fixedPro' : 'fixedFree',
    current: () => state,
    ready: Promise.resolve(state),
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
};
