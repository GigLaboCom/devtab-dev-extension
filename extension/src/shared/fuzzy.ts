/**
 * The fuzzy `PlaceMatcher` (finder.ts has the seam, the tiers and the strict matcher): the strict tiers, then
 *
 *   7 / 8   a subsequence from a word start, ranked by its letters at word starts and in a row (`b64` → Base64, `pswd` →
 *           Password, `cmp` → Compare code)
 *   9 / 10  a near miss: one letter wrong, missing, extra or two letters swapped against a word (`histroy`, `pasword`),
 *           from four letters
 *
 * and words in another order matched word by word (`code compare`). Below a subsequence that does not begin at a word
 * start nothing is shown. A chunk of its own: the start page loads it after its first paint, while its "Fuzzy matching"
 * part is on; the shell's palette imports it.
 */
import { tieredMatcher } from './finder';
import type { Destination } from './destinations';
import type { Found, Hit, LooseHit, PlaceMatcher } from './finder';

export { MAX_MATCHES } from './finder';

/** At most one edit (a letter wrong, missing, extra, or two swapped) between a and b. */
const nearly = (a: string, b: string): boolean => {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  return (
    a.slice(i + 1) === b.slice(i + 1) ||
    a.slice(i + 1) === b.slice(i) ||
    a.slice(i) === b.slice(i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
  );
};

const loose: LooseHit = (q, t, starts): Hit | null => {
  // A subsequence from a word start, each next letter taken at a word start when one comes before a plain one.
  for (let first = 0; first < t.length; first++) {
    if (!starts[first] || t[first] !== q[0]) continue;
    const positions = [first];
    let bonus = 2;
    for (let k = 1, i = first + 1; k < q.length && i < t.length; k++) {
      const plain = t.indexOf(q[k], i);
      if (plain < 0) break;
      let next = plain;
      for (let j = i; j < t.length; j++)
        if (starts[j] && t[j] === q[k]) {
          next = j;
          break;
        }
      if (next > plain && next - plain > 2) next = plain;
      bonus += (starts[next] ? 2 : 0) + (next === positions[positions.length - 1] + 1 ? 1 : 0);
      positions.push(next);
      i = next + 1;
    }
    if (positions.length === q.length) return { tier: 4, bonus, positions };
  }
  if (q.length >= 4)
    for (const [i, s] of starts.entries()) {
      if (!s) continue;
      const rest = t.slice(i).split(/[^\p{L}\p{N}]/u)[0];
      if (nearly(q, rest) || nearly(q, t.slice(i, i + q.length))) return { tier: 5, bonus: 0, positions: [] };
    }
  return null;
};

export const fuzzyMatcher: PlaceMatcher = tieredMatcher(loose, true);

/** Our places matching the query with why, best first (fuzzy). */
export const matchDestinations = (
  query: string,
  destinations: readonly Destination[],
  limit?: number,
  recent?: readonly string[],
): Found[] => fuzzyMatcher.match(query, destinations, limit, recent);

/** Our places matching the query, best first (fuzzy). */
export const findDestinations = (
  query: string,
  destinations: readonly Destination[],
  limit?: number,
  recent?: readonly string[],
): Destination[] => matchDestinations(query, destinations, limit, recent).map(m => m.destination);
