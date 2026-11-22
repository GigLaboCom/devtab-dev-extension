/**
 * The quoting table (lexis.ts) is the library's: for each of the 14 dialects, the strings, quoted names, line comments
 * and nesting of block comments of `sql-formatter` 15.9.0's `tokenizerOptions`. A new version of the library that reads
 * a dialect differently fails here first, not in a person's query.
 */
import { LEXIS, scanSql } from './lexis';
import { DIALECTS } from './logic';
import * as library from 'sql-formatter';
import { describe, expect, it } from 'vitest';
import type { Span } from './lexis';
import type { DialectOptions } from 'sql-formatter';

type QuoteType = string | { quote: string; prefixes: string[]; requirePrefix?: boolean } | { regex: string };

/** The library's quote type in the table's terms: `''-qq` → `'` doubled, `$$` → a dollar tag, `[]` → `[`. */
const asRule = (type: QuoteType): object | null => {
  if (typeof type !== 'string' && 'regex' in type) return null;
  const name = typeof type === 'string' ? type : type.quote;
  const [quote, escape] = (
    {
      '``': ['`', 'qq'],
      '[]': ['[', 'qq'],
      $$: ['$$', 'raw'],
      '{}': ['{', 'raw'],
      "q''": ["q'", 'raw'],
      "'''..'''": ["'''", 'bs'],
      '""".."""': ['"""', 'bs'],
    } as Record<string, [string, string]>
  )[name] ?? [name[0]!, name.slice(3)];
  return {
    quote,
    escape,
    ...(typeof type !== 'string' ? { prefixes: type.prefixes } : {}),
    ...(typeof type !== 'string' && type.requirePrefix ? { requirePrefix: true } : {}),
  };
};

const dialectOf = (id: string): DialectOptions => (library as unknown as Record<string, DialectOptions>)[id]!;

describe('the quoting table follows the library', () => {
  it.each(DIALECTS)('%s', id => {
    const options = dialectOf(id).tokenizerOptions as unknown as {
      stringTypes: QuoteType[];
      identTypes: QuoteType[];
      variableTypes?: QuoteType[];
      lineCommentTypes?: string[];
      nestedBlockComments?: boolean;
    };
    const ours = LEXIS[id];
    expect(ours.strings).toEqual(options.stringTypes.map(asRule).filter(Boolean));
    // Quoted variables (`${name}` of Spark) are read like quoted names; MySQL's `@'x'` is a string after `@`.
    const variables = (options.variableTypes ?? [])
      .map(asRule)
      .filter((r): r is { quote: string } => r !== null)
      .filter(
        r =>
          !ours.strings.some(s => s.quote === r.quote) &&
          !options.identTypes.map(asRule).some(i => (i as { quote: string }).quote === r.quote),
      );
    expect(ours.identifiers).toEqual([...options.identTypes.map(asRule), ...variables]);
    expect(ours.lineComments).toEqual(options.lineCommentTypes ?? ['--']);
    expect(ours.nestedComments).toBe(Boolean(options.nestedBlockComments));
  });
});

describe('scanSql', () => {
  const spans = (text: string, id: (typeof DIALECTS)[number] = 'sql'): Array<[Span['kind'], string, boolean]> => {
    const out: Array<[Span['kind'], string, boolean]> = [];
    scanSql(text, id, s => out.push([s.kind, text.slice(s.start, s.end), s.closed]));
    return out;
  };

  it('reports strings, names and comments in order, each whole', () => {
    expect(spans(`select 'a''b', "c""d", \`e\` -- f\n/* g */ from t`)).toEqual([
      ['string', "'a''b'", true],
      ['identifier', '"c""d"', true],
      ['identifier', '`e`', true],
      ['line-comment', '-- f', true],
      ['block-comment', '/* g */', true],
    ]);
  });

  it('a line comment ends before \\r, \\n or \\r\\n', () => {
    expect(spans('-- a\r\n-- b\r-- c')).toEqual([
      ['line-comment', '-- a', true],
      ['line-comment', '-- b', true],
      ['line-comment', '-- c', true],
    ]);
  });

  it('prefixes decide the escapes: E-strings and U& names in PostgreSQL, raw strings in BigQuery and Spark', () => {
    expect(spans("select E'a\\'b', 'c\\', U&\"d\" from t", 'postgresql')).toEqual([
      ['string', "E'a\\'b'".slice(1), true],
      ['string', "'c\\'", true],
      ['identifier', '"d"', true],
    ]);
    expect(spans("select r'\\', '\\'' from t", 'bigquery')).toEqual([
      ['string', "'\\'", true],
      ['string', "'\\''", true],
    ]);
    // A letter that ends a longer name is no prefix: `ae'…'` is a name and a plain string.
    expect(spans("select ae'a\\'b' from t", 'postgresql')).toEqual([
      ['string', "'a\\'", true],
      ['string', "' from t", false],
    ]);
  });

  it('Oracle q-quotes with paired and plain delimiters, and N before them', () => {
    expect(spans("select q'[a]b]', Q'{x}', nq'<y>', q'!z!', sequence from dual", 'plsql')).toEqual([
      ['string', "q'[a]b]'", true],
      ['string', "Q'{x}'", true],
      ['string', "q'<y>'", true],
      ['string', "q'!z!'", true],
    ]);
  });

  it('dollar tags, Spark variables, SQL Server braces and brackets', () => {
    expect(spans('select $fn$ a $$ b $fn$, $1 from t', 'postgresql')).toEqual([['string', '$fn$ a $$ b $fn$', true]]);
    expect(spans('select ${var} from t', 'spark')).toEqual([['identifier', '{var}', true]]);
    expect(spans('select {fn now()}, [a]]b] from t', 'transactsql')).toEqual([
      ['string', '{fn now()}', true],
      ['identifier', '[a]]b]', true],
    ]);
  });

  it('an unclosed string or comment runs to the end', () => {
    expect(spans("select 'abc")).toEqual([['string', "'abc", false]]);
    expect(spans('select /* abc')).toEqual([['block-comment', '/* abc', false]]);
  });
});
