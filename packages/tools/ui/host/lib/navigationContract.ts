/**
 * The contract suite of the navigation seam (`ToolNavigation`): every implementation runs it — the default that needs
 * no host here (navigation.test.ts), the extension's over its address (extension/src/tools/navigation.test.ts).
 * Written against the interface; a harness says which places its host has and shows where the person is.
 */
import { describe, expect, it } from 'vitest';
import type { HandedText, HostPlace, ToolNavigation } from './navigation';

export interface NavigationHarness {
  navigation: ToolNavigation;
  /** Places this host has (none: a host with nowhere to go), each at an address of its own. The person starts at none
   *  of them. */
  places: readonly HostPlace[];
  /** Places this host does not have. */
  missing: readonly HostPlace[];
  /** Places among `places` that take what is handed to them. */
  receiving: readonly HostPlace[];
  /** Where the person is: the host's address, or whatever stands for it. */
  where(): string;
  /** How many entries the host's history has. */
  entries(): number;
  /** What `place` takes when it opens — then nothing more — or undefined. */
  take(place: HostPlace): readonly HandedText[] | undefined;
}

const PAYLOAD = { texts: [{ text: 'first text 7f3a', name: 'a.json' }, { text: 'second text 7f3a' }] };

export const navigationContract = (name: string, make: () => NavigationHarness): void => {
  describe(`ToolNavigation contract: ${name}`, () => {
    it('refuses a place the host does not have, and stays where it was with nothing handed over', async () => {
      const h = make();
      for (const place of h.missing) {
        const [at, entries] = [h.where(), h.entries()];
        expect(await h.navigation.go(place, { payload: PAYLOAD })).toBe(false);
        expect(h.where()).toBe(at);
        expect(h.entries()).toBe(entries);
        expect(h.take(place)).toBeUndefined();
      }
    });

    it('goes to a place it has, adding one entry to the host’s history', async () => {
      const h = make();
      for (const place of h.places) {
        const [before, entries] = [h.where(), h.entries()];
        expect(await h.navigation.go(place)).toBe(true);
        expect(h.where()).not.toBe(before);
        expect(h.entries()).toBe(entries + 1);
      }
    });

    it('with replace, takes the place of the current entry: Back leads to where the person was before', async () => {
      const h = make();
      const entries = h.entries();
      for (const place of h.places) {
        const before = h.where();
        expect(await h.navigation.go(place, { replace: true })).toBe(true);
        expect(h.where()).not.toBe(before);
        expect(h.entries()).toBe(entries);
      }
    });

    it('hands a receiving place its texts in order, once, through memory — never in the address', async () => {
      const h = make();
      for (const place of h.receiving) {
        expect(await h.navigation.go(place, { payload: PAYLOAD })).toBe(true);
        expect(h.where()).not.toContain('7f3a');
        const taken = h.take(place);
        expect(taken?.length).toBeGreaterThan(0);
        expect(taken!.map(t => t.text)).toEqual(PAYLOAD.texts.slice(0, taken!.length).map(t => t.text));
        expect(h.take(place)).toBeUndefined();
      }
    });

    it('a later going without a payload leaves nothing stale for the place to take', async () => {
      const h = make();
      for (const place of h.receiving) {
        await h.navigation.go(place, { payload: PAYLOAD });
        await h.navigation.go(place);
        expect(h.take(place)).toBeUndefined();
      }
    });
  });
};
