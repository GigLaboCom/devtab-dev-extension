/**
 * The contract of seam `PlanSource` (./source.ts): one suite, run against every implementation — `memoryPlans`
 * (memory.test.ts), `remotePlans` over a fake chrome.storage and a fake runtime that answers through the real plans
 * worker (remote.test.ts), `samplePlans` (sample.test.ts, with the parts that need a scripted place left out).
 */
import { describe, expect, it, vi } from 'vitest';
import type { PlanSource, PlansView } from './source';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export interface PlanSourceHarness {
  /** A source as a new page would build it over the same place. */
  open(): PlanSource;
  /** Puts the place into the shape that should give `view` at the harness's now. */
  put?(view: PlansView['kind'], options?: { readonly fetchedAgoMs?: number; readonly body?: unknown }): Promise<void>;
  /** The next refresh ends like this. */
  answerNext?(
    outcome: { readonly body: unknown } | { readonly fail: 'offline' | 'server' | 'rate-limited' | 'server-busy' },
  ): void;
  /** Moves the harness's clock and its timers. */
  advance(ms: number): void;
  settle(): Promise<void>;
  /** A valid catalog with a `maxAge` of one day, whose id is `catalog`. */
  catalog?(catalog: string): unknown;
}

export const planSourceContract = (name: string, make: () => PlanSourceHarness): void => {
  describe(`PlanSource contract: ${name}`, () => {
    it('current() does not throw; after ready it is not loading when nobody asked', async () => {
      const harness = make();
      const source = harness.open();
      expect(() => source.current()).not.toThrow();
      await source.ready;
      expect(source.current().kind).not.toBe('loading');
      source.dispose();
    });

    it('ready resolves within 2 s', async () => {
      const harness = make();
      const source = harness.open();
      let resolved = false;
      void source.ready.then(() => (resolved = true));
      harness.advance(2_000);
      await harness.settle();
      expect(resolved).toBe(true);
      source.dispose();
    });

    it('refresh never rejects, whatever the answer', async () => {
      const harness = make();
      const source = harness.open();
      await source.ready;
      for (const fail of ['offline', 'server', 'rate-limited', 'server-busy'] as const) {
        harness.answerNext?.({ fail });
        harness.advance(HOUR);
        await expect(source.refresh('person')).resolves.toBeUndefined();
      }
      harness.answerNext?.({ body: { v: 2 } });
      harness.advance(HOUR);
      await expect(source.refresh('person')).resolves.toBeUndefined();
      const aborted = new AbortController();
      aborted.abort();
      await expect(source.refresh('person', aborted.signal)).resolves.toBeUndefined();
      source.dispose();
    });

    it('after dispose nothing is heard and refresh still resolves', async () => {
      const harness = make();
      const source = harness.open();
      await source.ready;
      const heard = vi.fn();
      source.subscribe(heard);
      source.dispose();
      harness.advance(31 * DAY);
      await harness.settle();
      await expect(source.refresh('person')).resolves.toBeUndefined();
      expect(heard).not.toHaveBeenCalled();
    });

    const sample = make();
    if (!sample.put || !sample.answerNext || !sample.catalog) return;

    describe('a source over a stored record', () => {
      it.each(['idle', 'fresh', 'stale', 'unavailable', 'unsupported'] as const)(
        '%s is what an open page shows for its record',
        async kind => {
          const harness = make();
          await harness.put!(kind);
          const source = harness.open();
          await source.ready;
          await harness.settle();
          expect(source.current().kind).toBe(kind);
          source.dispose();
        },
      );

      it('each change is heard once, an equal one is not; the undo stops it; a throwing listener spoils no other', async () => {
        const harness = make();
        const source = harness.open();
        await source.ready;
        const thrower = vi.fn(() => {
          throw new Error('a listener’s own failure');
        });
        const heard = vi.fn();
        source.subscribe(thrower);
        const undo = source.subscribe(heard);
        harness.answerNext!({ body: harness.catalog!('one') });
        await source.refresh('person');
        await harness.settle();
        // `loading` first (with the new list once it is stored, if that comes before the answer), `fresh` last; never
        // the same view twice in a row.
        const views = heard.mock.calls.map(([v]) => v as PlansView);
        expect(views[0].kind).toBe('loading');
        expect(views.at(-1)?.kind).toBe('fresh');
        views.slice(1).forEach((view, i) => expect(view).not.toEqual(views[i]));
        expect(thrower).toHaveBeenCalledTimes(views.length);
        heard.mockClear();
        await harness.put!('fresh', { body: harness.catalog!('one'), fetchedAgoMs: 0 });
        await harness.settle();
        expect(heard).not.toHaveBeenCalled();
        undo();
        harness.answerNext!({ body: harness.catalog!('two') });
        await source.refresh('person');
        await harness.settle();
        expect(heard).not.toHaveBeenCalled();
        source.dispose();
      });

      it('fresh turns stale by a timer exactly at fetchedAt + maxAge, and unusable at + 30 days', async () => {
        const harness = make();
        await harness.put!('fresh', { body: harness.catalog!('aging'), fetchedAgoMs: 0 });
        const source = harness.open();
        await source.ready;
        await harness.settle();
        expect(source.current().kind).toBe('fresh');
        harness.advance(DAY - 1);
        await harness.settle();
        expect(source.current().kind).toBe('fresh');
        harness.advance(1);
        await harness.settle();
        expect(source.current().kind).toBe('stale');
        harness.advance(29 * DAY);
        await harness.settle();
        expect(source.current().kind).toBe('idle');
        source.dispose();
      });

      it('a stale list never comes as fresh: its view is `stale`, and while asking it shows as `loading` with it', async () => {
        const harness = make();
        await harness.put!('stale');
        const source = harness.open();
        await source.ready;
        await harness.settle();
        expect(source.current().kind).toBe('stale');
        harness.answerNext!({ fail: 'offline' });
        const views: PlansView[] = [];
        source.subscribe(view => views.push(view));
        await source.refresh('person');
        await harness.settle();
        expect(views[0]).toMatchObject({ kind: 'loading', stale: {} });
        expect(source.current().kind).toBe('stale');
        source.dispose();
      });

      it('after a successful refresh: fresh, with the new catalog whole', async () => {
        const harness = make();
        await harness.put!('stale', { body: harness.catalog!('old') });
        const source = harness.open();
        await source.ready;
        harness.answerNext!({ body: harness.catalog!('new') });
        await source.refresh('person');
        await harness.settle();
        const view = source.current();
        expect(view.kind).toBe('fresh');
        expect(view.kind === 'fresh' && view.catalog.catalog).toBe('new');
        source.dispose();
      });

      it('two pages over one place see one view', async () => {
        const harness = make();
        const one = harness.open();
        const two = harness.open();
        await Promise.all([one.ready, two.ready]);
        harness.answerNext!({ body: harness.catalog!('shared') });
        await one.refresh('person');
        await harness.settle();
        expect(two.current()).toEqual(one.current());
        expect(two.current().kind).toBe('fresh');
        one.dispose();
        two.dispose();
      });
    });
  });
};
