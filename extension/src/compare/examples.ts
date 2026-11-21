/**
 * Seam `ExampleSource` — what «Compare code» shows when nothing is loaded (docs/replaceable-behaviors.md). The default
 * is the pairs bundled with the extension, one per language of languages.ts: `examples/<language>/before.<ext>.txt`
 * and `after.<ext>.txt` (the `.txt` keeps the type checker, the linter and the formatter away from them; the page
 * shows the names without it). Each pair is short, written for this page, and its diff has the interesting cases: a
 * line with a small change inside it, added lines, removed lines, a block that moved, an unchanged stretch.
 *
 * The texts are one chunk of their own (examples.data.ts), loaded the first time an example is shown: the start page
 * and the shell do not carry them.
 */
export interface ExampleSide {
  /** What the side's bar names. */
  name: string;
  text: string;
}

export interface ExamplePair {
  language: string;
  before: ExampleSide;
  after: ExampleSide;
}

export interface ExampleSource {
  /** The pair for a language; null when there is none. */
  load(language: string): Promise<ExamplePair | null>;
}

/** Bundled pairs, keyed by their paths (`./examples/<language>/<side>.<ext>.txt` → text). */
export const pairsOf = (files: Record<string, string>): Record<string, ExamplePair> => {
  const pairs: Record<string, Partial<ExamplePair>> = {};
  for (const [path, text] of Object.entries(files)) {
    const match = /\/examples\/([\w-]+)\/(before|after)(\.[\w.]+)?\.txt$/.exec(path);
    if (!match) continue;
    const [, language, side, extension = ''] = match;
    const pair = (pairs[language!] ??= { language });
    pair[side as 'before' | 'after'] = { name: `${side}${extension}`, text };
  }
  return Object.fromEntries(
    Object.entries(pairs).filter((entry): entry is [string, ExamplePair] => !!entry[1].before && !!entry[1].after),
  );
};

export const bundledExamples = (): ExampleSource => ({
  load: async language => (await import('./examples.data')).EXAMPLES[language] ?? null,
});
