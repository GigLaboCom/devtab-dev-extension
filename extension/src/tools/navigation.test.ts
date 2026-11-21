/**
 * The tools' navigation in this host (navigation.ts) against the seam's shared contract, and the rows of
 * docs/tools/specs/text-diff.md §10 that are about this host: its routes, its list and its search.
 */
import { addressOf, hashNavigation, pageNavigation } from './navigation';
import { TOOLS, toolById } from './registry';
import { clearHandoff, peekHandoff } from '@src/app/handoff';
import { parseRoute, routeHash } from '@src/app/route';
import { takeHandedTexts } from '@src/compare/handoff';
import { DESTINATIONS } from '@src/shared/destinations';
import { findDestinations } from '@src/shared/fuzzy';
import { navigationContract } from '@workspace/tools-host/navigation-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostPlace } from '@workspace/tools-host';

const take = (place: HostPlace) => {
  if ('tool' in place) {
    const text = peekHandoff(place.tool);
    clearHandoff();
    return text === undefined ? undefined : [{ text }];
  }
  if (place.part !== 'compare') return undefined;
  const texts = takeHandedTexts();
  return texts.length ? texts.map(t => ({ text: t.text, ...(t.name ? { name: t.name } : {}) })) : undefined;
};

navigationContract('this page’s address', () => {
  window.location.hash = '#/start';
  return {
    navigation: pageNavigation(window),
    places: [{ part: 'compare' }, { part: 'settings' }, { tool: 'json' }, { tool: 'text-diff' }],
    missing: [{ tool: 'nope' }, { part: 'nope' }, { part: 'tools/json' }, { part: '' }],
    receiving: [{ part: 'compare' }, { tool: 'json' }],
    where: () => window.location.href,
    entries: () => window.history.length,
    take,
  };
});

describe('the tools’ navigation', () => {
  beforeEach(() => {
    window.location.hash = '#/start';
  });
  afterEach(() => {
    takeHandedTexts();
    clearHandoff();
  });

  it('knows a tool by the registry and a part by the sections’ own addresses', () => {
    const has = (id: string) => toolById(id) !== undefined;
    expect(addressOf({ tool: 'text-diff' }, has)).toBe('#/tools/text-diff');
    expect(addressOf({ tool: 'nope' }, has)).toBeNull();
    expect(addressOf({ part: 'compare' }, has)).toBe('#/compare');
    expect(addressOf({ part: 'history' }, has)).toBe('#/history');
    expect(addressOf({ part: 'start' }, has)).toBe('#/start');
    expect(addressOf({ part: 'tools/json' }, has)).toBeNull();
    expect(addressOf({ part: 'nope' }, has)).toBeNull();
  });

  it('hands «Compare code» two texts with their names, a tool its first text, a section that takes nothing none', async () => {
    const handToTool = vi.fn();
    const handToCompare = vi.fn();
    const location = { hash: '', replace: vi.fn() };
    const navigation = hashNavigation({ location, hasTool: () => true, handToTool, handToCompare, clear: vi.fn() });
    const payload = { texts: [{ text: 'a\nb\n', name: 'old.txt' }, { text: 'a\nb' }, { text: 'third' }] };
    expect(await navigation.go({ part: 'compare' }, { payload })).toBe(true);
    expect(handToCompare).toHaveBeenCalledWith([
      { text: 'a\nb\n', name: 'old.txt' },
      { text: 'a\nb', name: null },
    ]);
    expect(location.hash).toBe('#/compare');
    expect(await navigation.go({ tool: 'json' }, { payload, replace: true })).toBe(true);
    expect(handToTool).toHaveBeenCalledWith('json', 'a\nb\n');
    expect(location.replace).toHaveBeenCalledWith('#/tools/json');
    handToCompare.mockClear();
    expect(await navigation.go({ part: 'settings' }, { payload })).toBe(true);
    expect(handToCompare).not.toHaveBeenCalled();
  });

  it('replaces the tool’s own address with «Compare code»: one entry, and Back leads before it (§10 row 5)', async () => {
    window.location.hash = '#/tools';
    const entries = window.history.length;
    window.location.hash = '#/tools/text-diff';
    expect(window.history.length).toBe(entries + 1);
    expect(await pageNavigation(window).go({ part: 'compare' }, { replace: true })).toBe(true);
    expect(window.location.hash).toBe('#/compare');
    expect(window.history.length).toBe(entries + 1);
  });
});

describe('docs/tools/specs/text-diff.md §10 in this host', () => {
  it('row 1: `#/tools/text-diff` is the tools section with the tool — the route itself does not change', () => {
    expect(parseRoute('#/tools/text-diff')).toEqual({ section: 'tools', tool: 'text-diff' });
  });

  it('row 2: `{ section: "compare" }` is `#/compare`, where the tool leads', () => {
    expect(routeHash({ section: 'compare' })).toBe('#/compare');
    expect(addressOf({ part: 'compare' }, () => false)).toBe(routeHash({ section: 'compare' }));
  });

  it('row 3 (corrected): an unknown address is the start page now, not «Compare code»', () => {
    expect(parseRoute('#/nope')).toEqual({ section: 'start' });
  });

  it('rows 4 and 9 (corrected): Text Diff is a tool of the registry, number 10; the first tool is still JSON', () => {
    expect(toolById('text-diff')?.order).toBe(10);
    expect(TOOLS[0]?.id).toBe('json');
  });

  it('row 10: the field and the palette find Text Diff by “diff”, “compare” and “text diff”, and the keywords', () => {
    const titles = (query: string) => findDestinations(query, DESTINATIONS).map(d => d.title);
    for (const query of ['diff', 'compare', 'text diff', 'difference', 'side by side', 'merge'])
      expect(titles(query), query).toContain('Text Diff');
    expect(titles('compare')).toContain('Compare code');
  });
});
