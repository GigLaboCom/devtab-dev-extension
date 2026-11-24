/**
 * Plans records for the tests of seam `PlanSource` (src/plans/*.test.ts): the placeholder catalog under another id,
 * and a record that gives each view at a moment.
 */
import { SAMPLE_CATALOG } from '@src/plans/sample';
import type { PlansView } from '@src/plans/source';
import type { PlansRecord } from '@src/shared/plansRecord';

const DAY = 86_400_000;

/** The placeholder catalog (a day fresh) with the id `catalog`. */
export const catalogNamed = (catalog: string) => ({ ...SAMPLE_CATALOG, catalog });

/** A record that gives `view` at `now`. */
export const recordFor = (
  view: PlansView['kind'],
  now: number,
  options: { readonly fetchedAgoMs?: number; readonly body?: unknown } = {},
): PlansRecord | undefined => {
  const body = options.body ?? SAMPLE_CATALOG;
  switch (view) {
    case 'idle':
      return undefined;
    case 'fresh':
      return { v: 1, fetchedAt: now - (options.fetchedAgoMs ?? 0), body, attempts: { failures: 0 } };
    case 'stale':
      return { v: 1, fetchedAt: now - (options.fetchedAgoMs ?? 2 * DAY), body, attempts: { failures: 0 } };
    case 'unavailable':
      return { v: 1, failure: { at: now, why: 'offline' }, attempts: { failures: 1, last: now - DAY } };
    case 'unsupported':
      return { v: 1, failure: { at: now, why: 'unsupported' }, attempts: { failures: 1, last: now - DAY } };
    default:
      throw new Error(`no record gives ${view}`);
  }
};
