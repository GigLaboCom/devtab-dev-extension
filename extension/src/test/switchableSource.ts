/**
 * An `EditionSource` whose state a test sets — the stand-in for a source that follows a licence, to check that the host
 * and the pages follow a change of the edition on an open page. `PRO` and `FREE` are a licence state of each edition.
 */
import type { LicenceFacts } from '@extension/licence';
import type { EditionSource, SourceState } from '@src/edition/source';

const FACTS: LicenceFacts = {
  lid: 'lic_TEST0000000001',
  checkedAt: Date.UTC(2026, 10, 1),
  checkAfter: Date.UTC(2026, 10, 8),
  warnFrom: Date.UTC(2026, 10, 24),
  validUntil: Date.UTC(2026, 11, 1),
  paidUntil: null,
};

/** A licence state whose edition is Pro. */
export const PRO: SourceState = { kind: 'active', licence: FACTS, due: false };
/** A licence state whose edition is the free one. */
export const FREE: SourceState = { kind: 'free' };

export const switchableSource = (
  initial: SourceState = FREE,
): EditionSource & { set(state: SourceState): void; readonly listeners: number } => {
  let state = initial;
  const listeners = new Set<(state: SourceState) => void>();
  return {
    id: 'licensed',
    current: () => state,
    ready: Promise.resolve(initial),
    subscribe: listener => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose: () => listeners.clear(),
    set: next => {
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
    get listeners() {
      return listeners.size;
    },
  };
};
