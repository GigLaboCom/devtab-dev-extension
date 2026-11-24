/** `memoryPlans`: the seam's contract over a record in memory and scripted answers, and its count of refreshes. */
import { planSourceContract } from './contract';
import { memoryPlans } from './memory';
import { SAMPLE_CATALOG, SAMPLE_RULES } from './sample';
import { catalogNamed, recordFor } from '@src/test/plansRecords';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlansScript } from './memory';
import type { PlansRecord } from '@src/shared/plansRecord';

const T0 = Date.UTC(2026, 10, 24, 12);

describe('with the clock and timers of the test', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  planSourceContract('memoryPlans', () => {
    // One script object: the pages a harness opens share its place. Its record is read when the first page opens.
    const replies: NonNullable<PlansScript['replies']>[number][] = [];
    const script: { record?: PlansRecord; readonly replies: typeof replies } = { replies };
    return {
      open: () => memoryPlans(script, () => Date.now(), SAMPLE_RULES),
      put: async (view, options) => {
        script.record = recordFor(view, Date.now(), options);
      },
      answerNext: outcome => void replies.push(outcome),
      advance: ms => vi.advanceTimersByTime(ms),
      settle: async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      },
      catalog: catalogNamed,
    };
  });
});

describe('memoryPlans', () => {
  it('counts the refreshes, takes the answers one by one, and is offline once they run out', async () => {
    const source = memoryPlans({ replies: [{ body: SAMPLE_CATALOG }] }, () => T0, SAMPLE_RULES);
    await source.ready;
    expect(source.current()).toEqual({ kind: 'idle' });
    await source.refresh('person');
    expect(source.current().kind).toBe('fresh');
    await source.refresh('person');
    expect(source.calls).toBe(2);
    // The list stays, fresh: the failure of the second answer replaces nothing.
    expect(source.current().kind).toBe('fresh');
    source.dispose();
  });

  it('with the default rules (no host to link to, the currencies Intl knows) the placeholder catalog keeps only Free', async () => {
    const source = memoryPlans({ replies: [{ body: SAMPLE_CATALOG }] }, () => T0);
    await source.refresh('person');
    const view = source.current();
    expect(view.kind === 'fresh' && view.catalog.plans.map(p => p.id)).toEqual(['free']);
    source.dispose();
  });
});
