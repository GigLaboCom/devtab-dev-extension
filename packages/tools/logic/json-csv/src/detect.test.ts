/**
 * `detectCsv` (docs/tools/specs/json-csv.md §7): the specification's table, then the inputs of the other tools —
 * comma-separated text is also prose, code and lists, and the first tool that says yes is opened without a question.
 */
import { detectCsv } from './logic';
import { describe, expect, it } from 'vitest';

describe('detectCsv', () => {
  it('§7: yes', () => {
    for (const text of ['id,name\n1,Ann\n2,Bob', 'a;b;c\n1;2;3\n4;5;6', 'a\tb\n1\t2\n3\t4'])
      expect(detectCsv(text), text).toBe(true);
  });

  it('§7: no', () => {
    for (const text of [
      'a,b\n1,2',
      'Hello, world\nGood, bye\nSee, you',
      'SELECT a, b FROM t\nWHERE x, y\nORDER BY z, w',
      'one\ntwo\nthree',
      '{"a":1}',
      '[1,2]',
      'a: 1\nb: 2\nc: 3',
      '* * * * *',
    ])
      expect(detectCsv(text), text).toBe(false);
  });

  it('after a byte order mark and around white space; quoted fields with line breaks count as one record', () => {
    expect(detectCsv('\uFEFF  id,name\r\n1,Ann\r\n2,Bob\r\n\n')).toBe(true);
    expect(detectCsv('id,note\n1,"two\nlines"\n2,x')).toBe(true);
    expect(detectCsv('a|b|c\n1|2|3\n4|5|6')).toBe(true);
    expect(detectCsv('')).toBe(false);
    expect(detectCsv('  \n ')).toBe(false);
  });

  it('a comma before a space somewhere and a bare comma elsewhere is a table', () => {
    expect(detectCsv('name,city\n"Smith, J.",Paris\nAnn,Rome')).toBe(true);
  });

  it('an unclosed quote or unequal records in the first ten are not a table', () => {
    expect(detectCsv('a,b\n"x,1\n2,3')).toBe(false);
    expect(detectCsv('a,b\n1,2\n3,4,5')).toBe(false);
  });

  it('reads only the start of a long text', () => {
    const long = `id,name\n${'1,Ann\n'.repeat(200_000)}`;
    const started = performance.now();
    expect(detectCsv(long)).toBe(true);
    // A broken record after the first 64 Ki characters changes nothing.
    expect(detectCsv(`${long}"broken`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(5_000);
  }, 60_000);

  it('the other tools’ inputs are not CSV', () => {
    for (const text of [
      // json, yaml-json
      '{"a": [1, 2]}',
      '[{"id":1},{"id":2}]',
      'a: 1\nb: [1, 2]\nc: x, y',
      '- one, two\n- three, four\n- five, six',
      // sql-format
      'select id, name from users\nwhere id in (1, 2)\norder by name, id',
      'INSERT INTO t (a, b) VALUES (1, 2);\nINSERT INTO t (a, b) VALUES (3, 4);\nINSERT INTO t (a, b) VALUES (5, 6);',
      // code-format: code with commas and tabs
      'const a = [1, 2, 3];\nfoo(a, b);\nbar(c, d);',
      'function f(a, b) {\n\treturn a + b;\n}',
      '\tfmt.Println(a)\n\tfmt.Println(b)\n\tfmt.Println(c)',
      '.a { margin: 0; }\n.b { padding: 0; }\n.c { color: red; }',
      // markdown-preview: a table, framed or not
      '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |',
      'a | b\n--- | ---\n1 | 2\n3 | 4',
      '# Title\n\nSome text, with commas.\n- item, one',
      // lines, case, text
      'apple, banana\ncherry, date\negg, fig',
      'one\ntwo\nthree\nfour',
      'userName\nuser_name\nUserName',
      // cron, unix-time, uuid, base64, jwt, url, hex, number bases, color, regexp
      '0 9 * * 1-5',
      '*/15 0,12 * * *\n0 0 1,15 * *\n30 4 * * 0',
      '1700000000',
      '2024-01-02T03:04:05Z',
      '550e8400-e29b-41d4-a716-446655440000',
      'SGVsbG8sIHdvcmxkIQ==',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
      'https://example.com/a?b=1&c=2',
      '48 65 6c 6c 6f',
      '0x48, 0x65, 0x6c',
      'rgb(255, 0, 0)\nhsl(0, 100%, 50%)\n#ff0000',
      '^(\\d{3}),(\\d{4})$',
      // html-entities, backslash-escape
      '&lt;a href=&quot;x&quot;&gt;',
      '"He said \\"hi\\", then left"',
    ])
      expect(detectCsv(text), JSON.stringify(text)).toBe(false);
  });
});
