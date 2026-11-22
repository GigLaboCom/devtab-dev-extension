/**
 * The table of character names (docs/tools/specs/string-inspector.md §5.3): 178 names from the Unicode Character
 * Database 16.0.0, generated into names.generated.ts by scripts/generate-names.mjs. It is data, so it is never part of
 * what a page loads first: `loadNames` imports it on first use — a chunk of its own in a build — and keeps the parsed
 * table for later calls. A browser has no table of names; nothing here touches the network.
 */

/** Code point → its name, e.g. 0x200b → `ZERO WIDTH SPACE`. */
export type NameTable = ReadonlyMap<number, string>;

/** Reads the compact form of names.generated.ts: `XXXX:NAME` joined by `;`. */
export const parseNames = (compact: string): NameTable =>
  new Map(
    compact.split(';').map(entry => {
      const at = entry.indexOf(':');
      return [parseInt(entry.slice(0, at), 16), entry.slice(at + 1)] as const;
    }),
  );

let loading: Promise<NameTable> | null = null;

/** The whole table, loaded once on first use (a separate chunk in a build); later calls get the same table. */
export const loadNames = (): Promise<NameTable> => {
  loading ??= import('./names.generated.ts').then(m => parseNames(m.NAMES));
  return loading;
};
