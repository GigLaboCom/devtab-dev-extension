import { fieldResults, strictMatcher } from './finder';
import { findDestinations, fuzzyMatcher } from './fuzzy';
import { DESTINATIONS } from '@src/shared/destinations';
import { describe, expect, it } from 'vitest';

const titles = (query: string) => findDestinations(query, DESTINATIONS).map(d => d.title);
const strict = (query: string) => strictMatcher.match(query, DESTINATIONS).map(f => f.destination.title);

describe('the start page field', () => {
  it('finds our places by title first, then by keyword', () => {
    expect(titles('json')[0]).toBe('JSON');
    expect(titles('Comp')[0]).toBe('Compare code');
    expect(titles('diff')).toContain('Compare code');
    expect(titles('git')).toEqual(['Projects']);
    expect(titles('theme')).toEqual(['Settings']);
    expect(titles('minify')).toEqual(['JSON']);
    expect(titles('   ')).toEqual([]);
  });

  it('puts web search last, and only when it is on', () => {
    const on = fieldResults('json', { destinations: DESTINATIONS, webSearch: true });
    expect(on[0]).toMatchObject({ kind: 'open', destination: { id: 'tools/json' } });
    expect(on.at(-1)).toEqual({ kind: 'web', text: 'json' });
    expect(fieldResults('json', { destinations: DESTINATIONS, webSearch: false }).some(r => r.kind === 'web')).toBe(
      false,
    );
  });

  it('when nothing of ours matches, the web search is the first row — what Enter takes', () => {
    expect(fieldResults(' kittens 42 ', { destinations: DESTINATIONS, webSearch: true })).toEqual([
      { kind: 'web', text: 'kittens 42' },
    ]);
    expect(fieldResults('kittens', { destinations: DESTINATIONS, webSearch: false })).toEqual([]);
  });

  it('matches with the matcher it is given: strict by default, fuzzy when the start page has it', () => {
    const b64 = (matcher = strictMatcher) =>
      fieldResults('b64', { destinations: DESTINATIONS, webSearch: false, matcher }).map(r =>
        r.kind === 'open' ? r.destination.title : r.kind === 'web' ? r.text : r.title,
      );
    expect(b64()).toEqual([]);
    // Every tool whose title or a keyword has b, 6, 4 in order: Base64 (№ 2), Base64 Image (№ 27), Base64 File (№ 38) —
    // titles first — and SVG to CSS (№ 34, keyword "base64").
    expect(b64(fuzzyMatcher)).toEqual(['Base64', 'Base64 Image', 'Base64 File', 'SVG to CSS']);
  });
});

describe('PlaceMatcher: the strict matcher, what the start page has before its first paint', () => {
  // Every query the strict tiers answer: exact, prefix, word start, substring — by title or keyword.
  const STRICT = [
    'json',
    'HASH',
    'hásh',
    'comp',
    'projects',
    'diff',
    'minify',
    'git',
    'theme',
    'u',
    'uid',
    'Comp',
    'e',
  ];

  // The fuzzy matcher puts the same places first, in the same order, and may only add weaker matches after them: a
  // near miss of some tool's keyword ("comp" against "commonmark") is its business, and must not break this.
  it.each(STRICT)('ranks %j as the fuzzy matcher ranks its best matches', query => {
    const strict = strictMatcher.match(query, DESTINATIONS, 50);
    expect(fuzzyMatcher.match(query, DESTINATIONS, 50).slice(0, strict.length)).toEqual(strict);
  });

  it('leaves the subsequences, the near misses and words in another order to the fuzzy matcher', () => {
    for (const query of ['b64', 'pswd', 'cmp', 'pasword', 'histroy', 'code compare'])
      expect([query, strict(query)]).toEqual([query, []]);
  });

  it('keeps one or two letters to prefixes and word starts, as the fuzzy one does', () => {
    expect(strict('od')).toEqual([]);
    // Not a fixed pair of titles: the list is whatever tools exist, so a tool added later must not break this.
    const startingWithU = DESTINATIONS.filter(d => /^u/i.test(d.title)).map(d => d.title);
    expect(startingWithU.length).toBeGreaterThan(1);
    expect(strict('u').slice(0, 2)).toEqual(startingWithU.slice(0, 2));
  });
});
