/**
 * The contract of seam `EditionSource` (./source.ts): one suite, run against every implementation (editions.test.ts
 * runs it on the two fixed sources). The half that needs `put` and `advance` — a source that follows a stored licence
 * — runs only where the harness has them.
 */
import { describe, expect, it, vi } from 'vitest';
import type { EditionSource, SourceState } from './source';

const DAY = 86_400_000;

export interface EditionSourceHarness {
  /** A source as a new page would build it over the same place. */
  open(): EditionSource;
  /**
   * Puts the place into the shape that should give `state` (a licensed harness signs and stores a token issued at
   * `at.now` with the usual spans of 7 / 23 / 30 days); absent for fixed sources.
   */
  put?(state: SourceState['kind'], at?: { readonly now: number }): Promise<void>;
  /** Moves the harness's clock (and its timers); absent where time does not matter. */
  advance?(ms: number): void;
  settle(): Promise<void>;
}

/** The licence states a source that follows a licence reports (the table of states). */
const LICENCE_STATES: readonly SourceState['kind'][] = [
  'free',
  'active',
  'grace',
  'expired',
  'ended',
  'revoked',
  'invalid',
];

export const editionSourceContract = (name: string, make: () => EditionSourceHarness): void => {
  describe(`EditionSource contract: ${name}`, () => {
    it('current() does not throw, and after ready it is not unknown', async () => {
      const harness = make();
      const source = harness.open();
      expect(() => source.current()).not.toThrow();
      await source.ready;
      expect(source.current().kind).not.toBe('unknown');
      source.dispose();
    });

    it('ready resolves within 2 s, with the state current() gives at that moment', async () => {
      const harness = make();
      const source = harness.open();
      let resolved: { state: SourceState; current: SourceState } | undefined;
      void source.ready.then(state => (resolved = { state, current: source.current() }));
      harness.advance?.(2_000);
      await harness.settle();
      expect(resolved).toBeDefined();
      expect(resolved!.state).toEqual(resolved!.current);
      expect(resolved!.state.kind).not.toBe('unknown');
      source.dispose();
    });

    it('a listener is not called while nothing changes; its undo and dispose do not throw', async () => {
      const harness = make();
      const source = harness.open();
      await source.ready;
      const heard = vi.fn();
      const undo = source.subscribe(heard);
      await harness.settle();
      expect(heard).not.toHaveBeenCalled();
      expect(() => undo()).not.toThrow();
      expect(() => source.dispose()).not.toThrow();
    });

    it('it has a licence’s controls exactly when it follows a licence', () => {
      const source = make().open();
      expect(Boolean((source as { licence?: unknown }).licence)).toBe(source.id === 'licensed');
      source.dispose();
    });

    const sample = make();
    if (!sample.put || !sample.advance) return;

    describe('a source that follows a stored licence', () => {
      it.each(LICENCE_STATES)('%s reaches an open page without a reload', async kind => {
        const harness = make();
        const source = harness.open();
        await source.ready;
        await harness.put!(kind);
        await harness.settle();
        expect(source.current().kind).toBe(kind);
        source.dispose();
      });

      it('each change is heard once, an equal state is not; the undo stops it; a throwing listener spoils no other', async () => {
        const harness = make();
        const source = harness.open();
        await source.ready;
        const thrower = vi.fn(() => {
          throw new Error('a listener’s own failure');
        });
        const heard = vi.fn();
        source.subscribe(thrower);
        const undo = source.subscribe(heard);
        await harness.put!('active');
        await harness.settle();
        await harness.put!('active');
        await harness.settle();
        expect(heard.mock.calls.map(([s]) => (s as SourceState).kind)).toEqual(['active']);
        expect(thrower).toHaveBeenCalledTimes(1);
        undo();
        await harness.put!('revoked');
        await harness.settle();
        expect(heard).toHaveBeenCalledTimes(1);
        source.dispose();
      });

      it('the warn and exp boundaries arrive by a timer', async () => {
        const harness = make();
        const source = harness.open();
        await harness.put!('active');
        await harness.settle();
        expect(source.current().kind).toBe('active');
        harness.advance!(23 * DAY);
        await harness.settle();
        expect(source.current().kind).toBe('grace');
        harness.advance!(7 * DAY);
        await harness.settle();
        expect(source.current().kind).toBe('expired');
        source.dispose();
      });

      it('two pages over one place see one state', async () => {
        const harness = make();
        const one = harness.open();
        const two = harness.open();
        await harness.put!('ended');
        await harness.settle();
        expect(one.current()).toEqual(two.current());
        one.dispose();
        two.dispose();
      });

      it('after dispose nothing is heard', async () => {
        const harness = make();
        const source = harness.open();
        await source.ready;
        const heard = vi.fn();
        source.subscribe(heard);
        source.dispose();
        await harness.put!('active');
        await harness.settle();
        expect(heard).not.toHaveBeenCalled();
      });
    });
  });
};
