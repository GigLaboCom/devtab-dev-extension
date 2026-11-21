/**
 * The finder's fuzzy matching (fuzzy.ts over finder.ts): the ranking table — query → the first results expected over the real places
 * of the build — then the thresholds, case and diacritics, non-Latin text, why a row matched, the tie-break by recent
 * use, and the time over 500 places. docs/extension-structure.md §18.10 has the same table.
 */
import { MAX_MATCHES, findDestinations, matchDestinations } from './fuzzy';
import { DESTINATIONS } from '@src/shared/destinations';
import { describe, expect, it } from 'vitest';
import type { Destination } from '@src/shared/destinations';

const first = (query: string, n = 1) =>
  findDestinations(query, DESTINATIONS)
    .slice(0, n)
    .map(d => d.title);

/** query → the title(s) expected first, and why (the tier that must win). */
const RANKING: Array<[string, string[], string]> = [
  ['json', ['JSON'], 'title exact'],
  ['HASH', ['Hash'], 'case does not count'],
  ['hásh', ['Hash'], 'diacritics do not count'],
  ['comp', ['Compare code'], 'title prefix'],
  ['review', ['Live review'], 'a title word starts with it'],
  ['diff', ['Text Diff', 'Compare code'], 'a title word beats a keyword (Compare code: keyword exact)'],
  ['minify', ['JSON'], 'keyword exact'],
  ['git', ['Live review'], 'keyword exact'],
  ['theme', ['Settings'], 'keyword exact'],
  ['u', ['URL', 'Unix Time', 'UUID / ULID'], 'one letter: prefixes only, in registry order'],
  ['uid', ['UUID / ULID'], 'title substring'],
  ['b64', ['Base64'], 'subsequence at word starts (b, 64)'],
  ['pswd', ['Password Generator'], 'subsequence from a word start'],
  ['cmp', ['Compare code'], 'subsequence from a word start'],
  ['pasword', ['Password Generator'], 'near miss: a letter missing'],
  ['bsae64', ['Base64'], 'near miss: two letters swapped'],
  ['histroy', ['History'], 'near miss: two letters swapped'],
  ['hitsory', ['History'], 'near miss: two letters swapped'],
  ['code compare', ['Compare code'], 'words in another order'],
  ['generator password', ['Password Generator'], 'words in another order'],
];

describe('the ranking table', () => {
  it.each(RANKING)('%s → %j (%s)', (query, titles) => {
    expect(first(query, titles.length)).toEqual(titles);
  });
});

describe('thresholds: honest and quiet', () => {
  it('one or two letters stay strict: a prefix or a word start, never a substring', () => {
    expect(first('od', 5)).toEqual([]);
    // Inside "review" only ('ev' starts a word since Cron's keyword "every minute", so it matches Cron there).
    expect(first('ie', 5)).toEqual([]);
    expect(first('co', 1)).toEqual(['Compare code']);
  });

  it('nothing rather than weak matches: no subsequence that does not begin at a word start, no near miss under four', () => {
    expect(first('zzzz', 5)).toEqual([]);
    expect(first('xjq', 5)).toEqual([]);
    // A substring, not a scatter of letters elsewhere: every place found holds "ash" whole, in its title or in a
    // keyword. Not a fixed list of titles: a new tool whose keyword happens to contain it (a "backslash") must not
    // break this.
    const ash = findDestinations('ash', DESTINATIONS, 5);
    expect(ash.map(d => d.title)).toContain('Hash');
    expect(ash.every(d => [d.title, ...d.keywords].some(text => text.toLowerCase().includes('ash')))).toBe(true);
    expect(first('hsah', 5)).toEqual(['Hash']); // near miss
    expect(first('hsa', 5)).toEqual([]); // three letters: no near miss
  });

  it('a short query does not fill the start page: at most six rows', () => {
    expect(findDestinations('e', DESTINATIONS).length).toBeLessThanOrEqual(MAX_MATCHES);
  });
});

describe('why a row matched', () => {
  it('the matched letters of the title, or the keyword it matched by', () => {
    const [b64] = matchDestinations('b64', DESTINATIONS);
    expect(b64.destination.title).toBe('Base64');
    expect(b64.match.positions.map(i => b64.destination.title[i]).join('')).toBe('B64');
    const [minify] = matchDestinations('minify', DESTINATIONS);
    expect(minify.match).toEqual({ positions: [], keyword: 'minify' });
    const [code] = matchDestinations('code compare', DESTINATIONS);
    expect(code.match.positions.map(i => code.destination.title[i]).join('')).toBe('Comparecode');
  });
});

describe('non-Latin text and other alphabets', () => {
  const place = (id: string, title: string, keywords: string[] = []): Destination => ({
    id,
    kind: 'tool',
    title,
    summary: '',
    keywords,
    hash: `#/tools/${id}`,
  });
  const places = [
    place('a', 'Сравнение кода', ['дифф']),
    place('b', 'Ёлка и ёж'),
    place('c', '比较代码'),
    place('d', 'Crème Brûlée'),
  ];
  const titles = (q: string) => findDestinations(q, places).map(d => d.title);

  it('Cyrillic, ё and е, CJK, Latin with diacritics', () => {
    expect(titles('срав')).toEqual(['Сравнение кода']);
    expect(titles('кода')).toEqual(['Сравнение кода']);
    expect(titles('дифф')).toEqual(['Сравнение кода']);
    expect(titles('елка')).toEqual(['Ёлка и ёж']);
    expect(titles('比较')).toEqual(['比较代码']);
    expect(titles('creme brulee')).toEqual(['Crème Brûlée']);
    expect(titles('сравнинеи')).toEqual([]);
  });
});

describe('ties', () => {
  it('broken by the places opened last, then by the registry’s order — never at random', () => {
    // The expected ids come from the registry, not from a fixed list: a tool added later must not break this.
    const startingWithU = DESTINATIONS.filter(d => /^u/i.test(d.title)).map(d => d.id);
    expect(startingWithU.length).toBeGreaterThan(2);
    expect(findDestinations('u', DESTINATIONS, 2).map(d => d.id)).toEqual(startingWithU.slice(0, 2));
    expect(findDestinations('u', DESTINATIONS, 2, ['#/tools/uuid']).map(d => d.id)).toEqual([
      'tools/uuid',
      startingWithU.find(id => id !== 'tools/uuid'),
    ]);
    expect(findDestinations('u', DESTINATIONS, 5)).toEqual(findDestinations('u', DESTINATIONS, 5));
  });
});

describe('time', () => {
  it('500 places, a query per key press: well under a frame', () => {
    const many: Destination[] = Array.from({ length: 500 }, (_, i) => ({
      id: `tools/t${i}`,
      kind: 'tool',
      title: `${['Base', 'Hash', 'Password', 'Compare', 'Regex'][i % 5]} Tool ${i} Generator`,
      summary: '',
      keywords: ['encode', 'decode', `kw${i}`, 'convert text'],
      hash: `#/tools/t${i}`,
      parent: 'tools',
    }));
    const queries = ['b', 'ba', 'bas', 'b64', 'pswd', 'pasword', 'regex tool', 'zzzz', 'generator 42'];
    const started = performance.now();
    for (let round = 0; round < 5; round++) for (const q of queries) matchDestinations(q, many, many.length);
    const perQuery = (performance.now() - started) / (5 * queries.length);
    // Recorded in docs/extension-structure.md §18.10; the bound is generous for a busy test machine.
    expect(perQuery, `${perQuery.toFixed(2)} ms per query over 500 places`).toBeLessThan(50);
  });
});
