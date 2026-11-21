/**
 * What the start page's field offers for a query, in order; the first row is what Enter takes.
 *
 *   1. our sections and tools whose title or keywords match (title before keyword, prefix before substring);
 *   2. "Search the web for …" — last, and only when web search is on.
 *
 * Pasted text goes to the tools' `detect` first (`detectTool`): the tool that recognises it opens with the text.
 * Pure: no storage, no network; the text only lives in the field.
 */
import type { Destination } from '@src/shared/destinations';

export type FieldResult = { kind: 'open'; destination: Destination } | { kind: 'web'; text: string };

export const MAX_MATCHES = 6;

const score = (destination: Destination, query: string): number => {
  const title = destination.title.toLowerCase();
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.split(/\s+/).some(word => word.startsWith(query))) return 2;
  const keywords = destination.keywords.map(k => k.toLowerCase());
  if (keywords.some(k => k === query)) return 3;
  if (keywords.some(k => k.startsWith(query) || k.split(/\s+/).some(word => word.startsWith(query)))) return 4;
  if (title.includes(query)) return 5;
  if (query.length >= 3 && keywords.some(k => k.includes(query))) return 6;
  return Infinity;
};

/** Our places matching the query, best first; the registry's order breaks ties. */
export const findDestinations = (
  query: string,
  destinations: readonly Destination[],
  limit = MAX_MATCHES,
): Destination[] => {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return [];
  return destinations
    .map((destination, index) => ({ destination, index, score: score(destination, q) }))
    .filter(m => m.score !== Infinity)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map(m => m.destination);
};

export const fieldResults = (
  query: string,
  options: { destinations: readonly Destination[]; webSearch: boolean },
): FieldResult[] => {
  const text = query.trim();
  if (!text) return [];
  const results: FieldResult[] = findDestinations(text, options.destinations).map(destination => ({
    kind: 'open',
    destination,
  }));
  if (options.webSearch) results.push({ kind: 'web', text });
  return results;
};

/** The first tool whose `detect` recognises pasted text. */
export const detectTool = <T extends { detect?: (text: string) => boolean }>(
  text: string,
  tools: readonly T[],
): T | undefined => (text.trim() ? tools.find(tool => tool.detect?.(text)) : undefined);
