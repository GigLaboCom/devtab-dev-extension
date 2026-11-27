/**
 * The page's one finder: what the start page's field and the shell's palette offer for a query, in order; the first
 * row is what Enter takes.
 *
 *   1. our sections and tools that match the query (below), best first;
 *   2. "Search the web for …" — last, and only when web search is on (the start page's field; the palette has none).
 *
 * How a place matches is seam `PlaceMatcher` (docs/replaceable-behaviors.md). Matching is ranked the way the editors'
 * "go to file" pickers and the terminal fuzzy finders rank — by tier, a title above a keyword in each tier:
 *
 *   0 title exact · 1 title prefix · 2 a title word starts with it · 3 keyword exact · 4 a keyword (word) starts with it
 *   5 title substring · 6 keyword substring · 7 title subsequence · 8 keyword subsequence · 9 title near miss
 *   10 keyword near miss
 *
 * Two implementations. `strictMatcher`, here, ranks tiers 0–6: it is small and is all the start page has before its
 * first paint. `fuzzyMatcher` (fuzzy.ts) adds the subsequences, the near misses and words in another order (tiers
 * 7–10): a chunk of its own that the start page loads after its first paint (the "Fuzzy matching" part) and the shell's
 * palette always has. A query both rank gets the same rows from both.
 *
 * Case and diacritics do not count (`é` is `e`). Word starts are after a space or a sign, at a capital after a small
 * letter and where letters and digits meet ("Base64": `b`, `64`). One or two letters stay strict: tiers 0–4 only.
 * Ties: more letters at word starts and in a row, then the places opened last, then the registry's order — the list
 * never reorders at random.
 *
 * Pasted text is not the finder's: the tools' `detect` recognises it (seam `PasteRecogniser`, tools/recogniser.ts).
 * Pure: no storage, no network; the text only lives in the field.
 */
import type { Destination } from './destinations';

/** Why a place matched: the matched letters of its title, or the keyword it matched by. */
export interface Match {
  /** Indexes into the title, ascending. */
  positions: readonly number[];
  keyword?: string;
}

export type FieldResult =
  | { kind: 'open'; destination: Destination; match?: Match }
  | { kind: 'web'; text: string }
  /** A command of a section that has a target now (the palette's alone: src/shortcuts/actions.ts). */
  | { kind: 'command'; id: string; title: string; match?: Match };

/** Rows that belong together; a group with a label is shown and announced under it. */
export interface FinderGroup {
  id: string;
  label?: string;
  results: readonly FieldResult[];
}

export interface Found {
  destination: Destination;
  match: Match;
}

/** Seam `PlaceMatcher`: our places matching a query with why, best first; `recent` — route hashes, last opened first. */
export interface PlaceMatcher {
  match(query: string, destinations: readonly Destination[], limit?: number, recent?: readonly string[]): Found[];
}

export const MAX_MATCHES = 6;

/** Lower case without diacritics, one character for one: indexes stay the original's. */
export const fold = (text: string): string => {
  let out = '';
  for (const c of text) {
    const base = (c.normalize('NFD')[0] ?? c).toLowerCase();
    out += base.length === c.length ? base : c;
  }
  return out;
};

const ALNUM = /[\p{L}\p{N}]/u;
export const startsOf = (text: string): boolean[] =>
  [...text].map((c, i) => {
    const p = text[i - 1];
    if (!ALNUM.test(c)) return false;
    return (
      !p ||
      !ALNUM.test(p) ||
      (c !== c.toLowerCase() && p === p.toLowerCase() && p !== p.toUpperCase()) ||
      /\d/.test(c) !== /\d/.test(p)
    );
  });

const range = (from: number, n: number): number[] => Array.from({ length: n }, (_, i) => from + i);

/** One query word against one text, before the title / keyword split: 0 exact … 5 near miss. */
export interface Hit {
  tier: number;
  bonus: number;
  positions: number[];
}

/** The tiers beyond a substring (4 subsequence, 5 near miss) for a query of three letters or more; fuzzy.ts has them. */
export type LooseHit = (q: string, t: string, starts: readonly boolean[]) => Hit | null;

const hitIn = (q: string, original: string, loose?: LooseHit): Hit | null => {
  const t = fold(original);
  const starts = startsOf(original);
  if (t === q) return { tier: 0, bonus: 0, positions: range(0, q.length) };
  if (t.startsWith(q)) return { tier: 1, bonus: 0, positions: range(0, q.length) };
  const word = starts.findIndex((s, i) => s && t.startsWith(q, i));
  if (word >= 0) return { tier: 2, bonus: 0, positions: range(word, q.length) };
  if (q.length < 3) return null;
  const at = t.indexOf(q);
  if (at >= 0) return { tier: 3, bonus: 0, positions: range(at, q.length) };
  return loose ? loose(q, t, starts) : null;
};

const TITLE_TIER = [0, 1, 2, 5, 7, 9];
const KEYWORD_TIER = [3, 4, 4, 6, 8, 10];

type Best = Hit & { keyword?: string };

/** The best hit of one query word in a place: its title, else its keywords. */
const hitInPlace = (q: string, d: Destination, loose?: LooseHit): Best | null => {
  const found: Best[] = [];
  const title = hitIn(q, d.title, loose);
  if (title) found.push({ ...title, tier: TITLE_TIER[title.tier] });
  if (!title || title.tier > 2)
    for (const keyword of d.keywords) {
      const h = hitIn(q, keyword, loose);
      if (h) found.push({ tier: KEYWORD_TIER[h.tier], bonus: h.bonus, positions: [], keyword });
    }
  found.sort((a, b) => a.tier - b.tier || b.bonus - a.bonus);
  return found[0] ?? null;
};

/** How a place matches the whole query: as one, or (with `byWords`) word by word in any order — the worst word rules. */
const matchOf = (q: string, d: Destination, loose: LooseHit | undefined, byWords: boolean): Best | null => {
  const whole = hitInPlace(q, d, loose);
  const words = q.split(' ');
  if (whole || !byWords || words.length < 2) return whole;
  const hits = words.map(w => hitInPlace(w, d, loose));
  if (hits.some(h => !h)) return null;
  const all = hits as Best[];
  return {
    tier: Math.max(...all.map(h => h.tier)),
    bonus: all.reduce((s, h) => s + h.bonus, 0),
    positions: [...new Set(all.flatMap(h => h.positions))].sort((a, b) => a - b),
    keyword: all.find(h => h.keyword)?.keyword,
  };
};

/** A matcher over the tiers above; `loose` adds tiers 7–10, `byWords` the words in another order (fuzzy.ts). */
export const tieredMatcher = (loose?: LooseHit, byWords = false): PlaceMatcher => ({
  match(query, destinations, limit = MAX_MATCHES, recent = []) {
    const q = fold(query.trim().replace(/\s+/g, ' '));
    if (!q) return [];
    const rank = (d: Destination): number => {
      const i = recent.indexOf(d.hash);
      return i < 0 ? Infinity : i;
    };
    return destinations
      .map((destination, index) => ({ destination, index, hit: matchOf(q, destination, loose, byWords) }))
      .filter((m): m is typeof m & { hit: Best } => m.hit !== null)
      .sort(
        (a, b) =>
          a.hit.tier - b.hit.tier ||
          b.hit.bonus - a.hit.bonus ||
          rank(a.destination) - rank(b.destination) ||
          a.index - b.index,
      )
      .slice(0, limit)
      .map(({ destination, hit }) => ({
        destination,
        match: { positions: hit.positions, ...(hit.keyword ? { keyword: hit.keyword } : {}) },
      }));
  },
});

/** Tiers 0–6: exact, prefix, word start, substring — what the start page matches with before its first paint. */
export const strictMatcher: PlaceMatcher = tieredMatcher();

export const fieldResults = (
  query: string,
  options: {
    destinations: readonly Destination[];
    webSearch: boolean;
    recent?: readonly string[];
    /** The start page's context gives it: strict until the fuzzy matcher has arrived (or when it is off). */
    matcher?: PlaceMatcher;
  },
): FieldResult[] => {
  const text = query.trim();
  if (!text) return [];
  const matcher = options.matcher ?? strictMatcher;
  const results: FieldResult[] = matcher
    .match(text, options.destinations, MAX_MATCHES, options.recent)
    .map(found => ({ kind: 'open', ...found }));
  if (options.webSearch) results.push({ kind: 'web', text });
  return results;
};
