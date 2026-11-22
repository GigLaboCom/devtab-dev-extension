/**
 * The five drafts this tool knows (docs/tools/specs/json-schema.md §5 п. 1, 19): their identifiers — URIs that are
 * matched and written, never fetched — titles and what sets them apart.
 */

export type Draft = '2020-12' | '2019-09' | 'draft-07' | 'draft-06' | 'draft-04';

/** Newest first: the order of the Draft lists. */
export const DRAFTS: readonly Draft[] = ['2020-12', '2019-09', 'draft-07', 'draft-06', 'draft-04'];

/** The identifier each draft's meta-schema carries, as `$schema` of a schema written for it. */
export const DRAFT_URI: Readonly<Record<Draft, string>> = {
  '2020-12': 'https://json-schema.org/draft/2020-12/schema',
  '2019-09': 'https://json-schema.org/draft/2019-09/schema',
  'draft-07': 'http://json-schema.org/draft-07/schema#',
  'draft-06': 'http://json-schema.org/draft-06/schema#',
  'draft-04': 'http://json-schema.org/draft-04/schema#',
};

/** What the lists show: `2020-12`, `2019-09`, `Draft 7`, `Draft 6`, `Draft 4`. */
export const draftLabel = (d: Draft): string => (d.startsWith('draft-') ? `Draft ${Number(d.slice(6))}` : d);

/** In a sentence: `draft 2020-12`, `draft 7`. */
export const draftName = (d: Draft): string => (d.startsWith('draft-') ? `draft ${Number(d.slice(6))}` : `draft ${d}`);

/** Release order: draft-04 < draft-06 < draft-07 < 2019-09 < 2020-12. */
export const draftRank = (d: Draft): number =>
  ({ 'draft-04': 4, 'draft-06': 6, 'draft-07': 7, '2019-09': 2019, '2020-12': 2020 })[d];

/** A URI as people write it in `$schema`: with or without the trailing `#`, http or https. */
const normalize = (uri: string): string => uri.replace(/#$/, '').replace(/^http:/, 'https:');

const BY_URI = new Map(DRAFTS.map(d => [normalize(DRAFT_URI[d]), d]));

/** The draft a `$schema` value names, or null when it names none of the five. */
export const draftOfUri = (uri: string): Draft | null => BY_URI.get(normalize(uri)) ?? null;

export const isDraft = (value: unknown): value is Draft => DRAFTS.includes(value as Draft);
