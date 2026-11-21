import { defaultToolHost, memoryHost } from './host';
import { navigationOf, noNavigation } from './navigation';
import { navigationContract } from './navigationContract';
import { describe, expect, it } from 'vitest';
import type { ToolNavigation } from './navigation';

navigationContract('no host', () => ({
  navigation: noNavigation,
  places: [],
  missing: [{ part: 'compare' }, { tool: 'json' }, { part: 'settings' }],
  receiving: [],
  where: () => 'here',
  entries: () => 1,
  take: () => undefined,
}));

describe('navigationOf', () => {
  it('a tool rendered with no host, or with a host that keeps none, cannot go anywhere and is told so', async () => {
    expect(navigationOf(undefined)).toBe(noNavigation);
    expect(navigationOf(memoryHost())).toBe(noNavigation);
    expect(navigationOf(defaultToolHost)).toBe(noNavigation);
    expect(await navigationOf(undefined).go({ part: 'compare' }, { replace: true })).toBe(false);
  });

  it('takes the host’s own navigation when it has one', () => {
    const navigation: ToolNavigation = { go: () => Promise.resolve(true) };
    expect(navigationOf({ ...memoryHost(), navigation })).toBe(navigation);
  });
});
