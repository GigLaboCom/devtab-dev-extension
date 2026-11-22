/**
 * The attribute names whose React property differs (docs/tools/specs/html-to-jsx.md §5 «Имена атрибутов»): 306 pairs
 * from React's `possibleStandardNames`, generated into attribute-names.json by scripts/generate-attribute-names.mjs from
 * the installed `react-dom` (MIT; the notice ships in licenses/). It is data, so it is never part of what a page loads
 * first: `loadAttributeNames` imports it on first use — a chunk of its own in a build — and keeps the table for later
 * calls. Nothing here touches the network.
 */

/** An attribute's name in lower case → its React property: `class` → `className`, `stroke-width` → `strokeWidth`. */
export type AttributeNames = ReadonlyMap<string, string>;

/** The data file's shape: a header (where the pairs come from) and the pairs. */
export interface AttributeNamesFile {
  source: string;
  package: string;
  version: string;
  license: string;
  sha256: string;
  count: number;
  names: Record<string, string>;
}

/** The table from the data file's content. */
export const attributeNamesFrom = (file: AttributeNamesFile): AttributeNames => new Map(Object.entries(file.names));

let loading: Promise<AttributeNames> | null = null;

/** The whole table, loaded once on first use (a separate chunk in a build); later calls get the same table. */
export const loadAttributeNames = (): Promise<AttributeNames> => {
  loading ??= import('./attribute-names.json', { with: { type: 'json' } }).then(m =>
    attributeNamesFrom(m.default as AttributeNamesFile),
  );
  return loading;
};
