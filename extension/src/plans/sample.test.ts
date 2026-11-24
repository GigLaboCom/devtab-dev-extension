/** `samplePlans`, the showcase variant: the seam's contract (the parts it can run), and its placeholder list. */
import { planSourceContract } from './contract';
import { samplePlans } from './sample';
import { samplePlans as byVariantName } from './samplePlans';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanSourceEnvironment } from './source';

const T0 = Date.UTC(2026, 10, 24, 12);
const ENV = { chrome: {} } as unknown as PlanSourceEnvironment;

describe('with the clock and timers of the test', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  planSourceContract('samplePlans', () => ({
    open: () => samplePlans({ ...ENV, now: () => Date.now() }),
    advance: ms => vi.advanceTimersByTime(ms),
    settle: async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    },
  }));
});

describe('samplePlans', () => {
  it('has the module its variant names (DEVTAB_VARIANT=…,plans:samplePlans rewrites the root to ./samplePlans)', () => {
    expect(byVariantName).toBe(samplePlans);
  });

  it('shows the placeholder list at once — three plans in XTS on `.invalid` hosts, marked as test material', async () => {
    const source = samplePlans({ ...ENV, now: () => T0 });
    expect(source.id).toBe('samplePlans');
    const view = await source.ready;
    expect(view.kind).toBe('fresh');
    if (view.kind !== 'fresh') return;
    expect(view.catalog.catalog).toContain('DEVTAB_LICENCE_TEST');
    expect(view.catalog.plans.map(p => [p.id, p.price?.currency ?? null])).toEqual([
      ['free', null],
      ['pro-monthly', 'XTS'],
      ['pro-annual', 'XTS'],
    ]);
    expect(
      view.catalog.plans.every(p => p.checkoutUrl === null || new URL(p.checkoutUrl).hostname.endsWith('.invalid')),
    ).toBe(true);
    source.dispose();
  });
});
