/**
 * The table of named character references (HTML Standard §13.5) the decoder looks names up in. It is data generated
 * from the standard's published list (namedReferences.generated.ts, scripts/generate-tables.mjs) and weighs about
 * 23 KB, so it is never part of what loads first: `loadReferenceTable` imports it on first use — a chunk of its own in
 * a build — and keeps the parsed table for later calls. Nothing here touches the network.
 */

/**
 * Keys exactly as the standard's list writes them, without the leading `&`: `amp;` for every name and also `amp` for
 * the 106 names that work without a semicolon. Values are what the reference stands for: one or two code points.
 */
export type ReferenceTable = ReadonlyMap<string, string>;

const isNameUnit = (c: number): boolean =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);

/**
 * Reads the compact form of namedReferences.generated.ts: each name, then a marker — `&` (also works without a
 * semicolon; one code point), `;` (one code point) or `:` (two code points) — then the value.
 */
export const parseTable = (compact: string): ReferenceTable => {
  const table = new Map<string, string>();
  let i = 0;
  while (i < compact.length) {
    let j = i;
    while (j < compact.length && isNameUnit(compact.charCodeAt(j))) j++;
    const name = compact.slice(i, j);
    const marker = compact[j];
    let k = j + 1;
    for (let n = marker === ':' ? 2 : 1; n > 0; n--) k += (compact.codePointAt(k) ?? 0) > 0xffff ? 2 : 1;
    const value = compact.slice(j + 1, k);
    table.set(`${name};`, value);
    if (marker === '&') table.set(name, value);
    i = k;
  }
  return table;
};

let loading: Promise<ReferenceTable> | null = null;

/** The whole table, loaded once on first use (a separate chunk in a build); later calls get the same table. */
export const loadReferenceTable = (): Promise<ReferenceTable> => {
  loading ??= import('./namedReferences.generated.ts').then(m => parseTable(m.NAMED_REFERENCES));
  return loading;
};
