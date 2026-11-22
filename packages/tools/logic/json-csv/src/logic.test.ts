/**
 * Every row of docs/tools/specs/json-csv.md §10 as a test with the specification's expected value (the fuzz rows and
 * the delimiter count are in properties.test.ts, §7 in detect.test.ts), then what §5 and §6 state that §10 does not
 * show. CRLF is written `\r\n`; a CSV → JSON result is compared minified, which is the specification's notation.
 */
import {
  DEFAULT_TO_CSV,
  DEFAULT_TO_JSON,
  csvToJson,
  describeNotes,
  detectDelimiter,
  jsonToCsv,
  readCsv,
  withBom,
} from './logic';
import { describe, expect, it } from 'vitest';
import type { Converted, ToCsvNotes, ToCsvOptions, ToJsonNotes, ToJsonOptions } from './logic';

const toCsv = (json: string, options: Partial<ToCsvOptions> = {}): Converted<ToCsvNotes> =>
  jsonToCsv(json, { ...DEFAULT_TO_CSV, ...options });
const toJson = (csv: string, options: Partial<ToJsonOptions> = {}): Converted<ToJsonNotes> =>
  csvToJson(csv, { ...DEFAULT_TO_JSON, layout: 'minify', ...options });

const csvOf = (json: string, options: Partial<ToCsvOptions> = {}): string => {
  const r = toCsv(json, options);
  if (!r.ok) throw new Error(`Line ${r.error.line}, column ${r.error.column}: ${r.error.message}`);
  return r.text;
};
const jsonOf = (csv: string, options: Partial<ToJsonOptions> = {}): string => {
  const r = toJson(csv, options);
  if (!r.ok) throw new Error(`Line ${r.error.line}, column ${r.error.column}: ${r.error.message}`);
  return r.text;
};
const errorOf = (r: Converted<unknown>): string => {
  if (r.ok) throw new Error(`expected an error, got ${r.text}`);
  return `${r.error.line}:${r.error.column} ${r.error.message}`;
};
const csvNotes = (json: string, options: Partial<ToCsvOptions> = {}): ToCsvNotes => {
  const r = toCsv(json, options);
  if (!r.ok) throw new Error(r.error.message);
  return r.notes;
};
const jsonNotes = (csv: string, options: Partial<ToJsonOptions> = {}): ToJsonNotes => {
  const r = toJson(csv, options);
  if (!r.ok) throw new Error(r.error.message);
  return r.notes;
};

describe('§10, JSON → CSV', () => {
  it('row 1: an array of objects, the header row, CRLF after every record', () => {
    expect(csvOf('[{"id":1,"name":"Ann","ok":true},{"id":2,"name":"Bob","ok":false}]')).toBe(
      'id,name,ok\r\n1,Ann,true\r\n2,Bob,false\r\n',
    );
  });

  it('row 2: columns are the union of the keys in order of first appearance', () => {
    expect(csvOf('[{"a":1,"b":2},{"b":3,"c":4},{"c":5,"a":6}]')).toBe('a,b,c\r\n1,2,\r\n,3,4\r\n6,,5\r\n');
  });

  it('row 3: nested objects flatten with a dotted path, an array is JSON text', () => {
    expect(csvOf('[{"id":1,"address":{"city":"Paris","geo":{"lat":1.5}},"tags":["a","b"]}]')).toBe(
      'id,address.city,address.geo.lat,tags\r\n1,Paris,1.5,"[""a"",""b""]"\r\n',
    );
  });

  it('row 4: Flatten off — a nested object is JSON text too', () => {
    expect(csvOf('[{"id":1,"address":{"city":"Paris"}}]', { flatten: false })).toBe(
      'id,address\r\n1,"{""city"":""Paris""}"\r\n',
    );
  });

  it('row 5: an empty object and an empty array', () => {
    expect(csvOf('[{"a":{},"b":[]}]')).toBe('a,b\r\n{},[]\r\n');
  });

  it('row 6: null and "" are empty cells, 0 is 0', () => {
    expect(csvOf('[{"a":null,"b":"","c":0}]')).toBe('a,b,c\r\n,,0\r\n');
  });

  it('row 7: quoting by RFC 4180 §2.6–2.7; a leading space needs no quotes', () => {
    expect(csvOf('[{"t":"a,b","q":"say \\"hi\\"","n":"line1\\nline2","s":" lead"}]')).toBe(
      't,q,n,s\r\n"a,b","say ""hi""","line1\nline2", lead\r\n',
    );
  });

  it('row 8: numbers as written; two are inexact', () => {
    const json = '[{"id":12345678901234567890,"p":1.50,"e":1E400,"z":-0}]';
    expect(csvOf(json)).toBe('id,p,e,z\r\n12345678901234567890,1.50,1E400,-0\r\n');
    expect(csvNotes(json).inexactNumbers).toBe(2);
  });

  it('row 9: integer keys keep their place', () => {
    expect(csvOf('[{"b":1,"2":2,"1":3}]')).toBe('b,2,1\r\n1,2,3\r\n');
  });

  it('row 10: formula-like strings get a quote prefix; the number -5 does not; 5 protected', () => {
    const json = '[{"f":"=SUM(A1:A2)","p":"+1 555","m":"-x","at":"@cmd","n":-5,"tab":"\\tx"}]';
    expect(csvOf(json)).toBe('f,p,m,at,n,tab\r\n"\'=SUM(A1:A2)","\'+1 555","\'-x","\'@cmd",-5,"\'\tx"\r\n');
    expect(csvNotes(json).protectedCells).toBe(5);
  });

  it('row 11: Protect from formulas off', () => {
    expect(csvOf('[{"f":"=SUM(A1:A2)"}]', { protectFormulas: false })).toBe('f\r\n=SUM(A1:A2)\r\n');
  });

  it('row 12: Semicolon — a comma inside a cell needs no quotes, a semicolon does', () => {
    expect(csvOf('[{"a":"1,5","b":"x;y"}]', { delimiter: ';' })).toBe('a;b\r\n1,5;"x;y"\r\n');
  });

  it('row 13: Tab', () => {
    expect(csvOf('[{"a":"x\\ty","b":2}]', { delimiter: '\t' })).toBe('a\tb\r\n"x\ty"\t2\r\n');
  });

  it('row 14: LF', () => {
    expect(csvOf('[{"a":1},{"a":2}]', { newline: '\n' })).toBe('a\n1\n2\n');
  });

  it('row 15: Quote all fields', () => {
    expect(csvOf('[{"a":1,"b":"x"}]', { quoteAll: true })).toBe('"a","b"\r\n"1","x"\r\n');
  });

  it('row 16: Header row off', () => {
    expect(csvOf('[{"a":1,"b":2}]', { header: false })).toBe('1,2\r\n');
  });

  it('row 17: an array of arrays is records as they are', () => {
    expect(csvOf('[["id","name"],[1,"Ann"],[2,"Bob, Jr."]]')).toBe('id,name\r\n1,Ann\r\n2,"Bob, Jr."\r\n');
  });

  it('row 18: an array of values is one column, value', () => {
    expect(csvOf('["x","y",3]')).toBe('value\r\nx\r\ny\r\n3\r\n');
  });

  it('row 19: one object is one record', () => {
    expect(csvOf('{"a":1,"b":"x"}')).toBe('a,b\r\n1,x\r\n');
  });

  it('row 20: [] is an empty result with its note', () => {
    const r = toCsv('[]');
    expect(r.ok && r.text).toBe('');
    expect(r.ok && r.notes.emptyArray).toBe(true);
    expect(r.ok && describeNotes(r.notes)).toEqual(['The JSON array is empty.']);
  });

  it('row 21: items of different kinds', () => {
    expect(errorOf(toCsv('[{"a":1},[1,2]]'))).toBe(
      '1:10 every item must be of one kind: the first is an object, this one is an array',
    );
  });

  it('row 22: a number at the root', () => {
    expect(errorOf(toCsv('42'))).toBe('1:1 expected an array of objects, an array of arrays or one object');
  });

  it('row 23: a dotted key and a nested object give one column', () => {
    expect(errorOf(toCsv('[{"a.b":1,"a":{"b":2}}]'))).toBe(
      '1:16 two values for column "a.b" in one row (a key with a dot and a nested object?)',
    );
  });

  it('row 24: a repeated key', () => {
    expect(errorOf(toCsv('[{"a":1,"a":2}]'))).toBe(
      '1:9 duplicate key "a": a row can\'t have two values for one column',
    );
  });

  it('row 25: non-ASCII names and values', () => {
    expect(csvOf('[{"имя":"Анна","e":"🙂"}]')).toBe('имя,e\r\nАнна,🙂\r\n');
  });

  it('row 26: JSON errors are the scanner’s, with its place', () => {
    expect(errorOf(toCsv('[{"a":1},]'))).toBe('1:10 trailing comma');
  });
});

describe('§10, CSV → JSON', () => {
  it('row 27: types by the look of a cell', () => {
    expect(jsonOf('id,name,ok\r\n1,Ann,true\r\n2,Bob,false\r\n')).toBe(
      '[{"id":1,"name":"Ann","ok":true},{"id":2,"name":"Bob","ok":false}]',
    );
  });

  it('row 28: quoted fields with delimiters, doubled quotes and line breaks', () => {
    expect(jsonOf('a,b,c\n"x,y","say ""hi""","line1\nline2"\n')).toBe(
      '[{"a":"x,y","b":"say \\"hi\\"","c":"line1\\nline2"}]',
    );
  });

  it('row 29: what is a number and what is not; one inexact', () => {
    const csv =
      'n,z,lead,plus,exp,big,neg0,b1,b2,b3,nul,sp\n42,0,007,+1,1e5,12345678901234567890,-0,true,TRUE,True,null, 42\n';
    expect(jsonOf(csv)).toBe(
      '[{"n":42,"z":0,"lead":"007","plus":"+1","exp":1e5,"big":12345678901234567890,"neg0":-0,"b1":true,"b2":true,"b3":true,"nul":"null","sp":" 42"}]',
    );
    expect(jsonNotes(csv).inexactNumbers).toBe(1);
  });

  it('row 30: Detect types off — every cell a string', () => {
    expect(jsonOf('n,b\n42,true\n', { detectTypes: false })).toBe('[{"n":"42","b":"true"}]');
  });

  it('row 31: Empty cells — null, Empty string, Leave out', () => {
    expect(jsonOf('a,b,c\n1,,3\n', { empty: 'null' })).toBe('[{"a":1,"b":null,"c":3}]');
    expect(jsonOf('a,b,c\n1,,3\n', { empty: 'string' })).toBe('[{"a":1,"b":"","c":3}]');
    expect(jsonOf('a,b,c\n1,,3\n', { empty: 'omit' })).toBe('[{"a":1,"c":3}]');
  });

  it('row 32: a short record — the missing cells are empty, one short row', () => {
    expect(jsonOf('a,b,c\n1,2\n')).toBe('[{"a":1,"b":2,"c":null}]');
    expect(jsonNotes('a,b,c\n1,2\n').shortRows).toBe(1);
  });

  it('row 33: a long record is an error at its start', () => {
    expect(errorOf(toJson('a,b\n1,2,3\n'))).toBe('2:1 this row has 3 fields, the header has 2');
  });

  it('row 34: Auto finds the semicolon; a comma inside a value stays', () => {
    const csv = 'a;b;c\n1,5;2;x\n3;4;y\n';
    expect(jsonOf(csv)).toBe('[{"a":"1,5","b":2,"c":"x"},{"a":3,"b":4,"c":"y"}]');
    expect(jsonNotes(csv).delimiter).toBe(';');
  });

  it('row 35: Auto finds a tab and a pipe', () => {
    expect(jsonOf('a\tb\n1\t2\n')).toBe('[{"a":1,"b":2}]');
    expect(jsonOf('a|b|c\n1|2|3\n')).toBe('[{"a":1,"b":2,"c":3}]');
  });

  it('row 36: no delimiter fits — a comma, one column', () => {
    expect(jsonOf('hello world\nfoo\n')).toBe('[{"hello world":"foo"}]');
    expect(jsonNotes('hello world\nfoo\n').delimiter).toBe(',');
  });

  it('row 37: an unclosed quote, at the opening quote', () => {
    expect(errorOf(toJson('a,b\n"x,1\n'))).toBe('2:1 unclosed quote: the field never ends');
  });

  it('row 38: text after a closing quote, at that character', () => {
    expect(errorOf(toJson('a,b\n"x"y,1\n'))).toBe(
      '2:4 unexpected text after a closing quote (a quote inside a field must be doubled: "")',
    );
  });

  it('row 39: a quote inside an unquoted field is an ordinary character', () => {
    expect(jsonOf('a,b\n5" pipe,1\n')).toBe('[{"a":"5\\" pipe","b":1}]');
  });

  it('row 40: a byte order mark, lone CRs, blank lines', () => {
    expect(jsonOf('\uFEFFa,b\n1,2\n')).toBe('[{"a":1,"b":2}]');
    expect(jsonOf('a,b\r1,2\r')).toBe('[{"a":1,"b":2}]');
    expect(jsonOf('a,b\n\n1,2\n\n')).toBe('[{"a":1,"b":2}]');
  });

  it('row 41: only a header row', () => {
    expect(jsonOf('a,b\n')).toBe('[]');
  });

  it('row 42: a repeated name becomes name_2', () => {
    expect(jsonOf('id,name,id\n1,x,2\n')).toBe('[{"id":1,"name":"x","id_2":2}]');
    expect(jsonNotes('id,name,id\n1,x,2\n').renamed).toEqual([{ column: 3, from: 'id', to: 'id_2' }]);
  });

  it('row 43: an empty name becomes column_<n>', () => {
    expect(jsonOf('a,,c\n1,2,3\n')).toBe('[{"a":1,"column_2":2,"c":3}]');
  });

  it('row 44: Header row off — an array of arrays', () => {
    expect(jsonOf('a,b\n1,2\n', { header: false })).toBe('[["a","b"],[1,2]]');
  });

  it('row 45: Nest dotted headers', () => {
    expect(jsonOf('id,address.city,address.zip\n1,Paris,75001\n', { nest: true })).toBe(
      '[{"id":1,"address":{"city":"Paris","zip":75001}}]',
    );
  });

  it('row 46: Nest — a column that is a value and a parent', () => {
    expect(errorOf(toJson('a,a.b\n1,2\n', { nest: true }))).toBe(
      '1:1 column "a" is both a value and the parent of "a.b"',
    );
  });

  it('row 47: non-ASCII', () => {
    expect(jsonOf('имя,e\nАнна,🙂\n')).toBe('[{"имя":"Анна","e":"🙂"}]');
  });

  it('row 48: the quote prefix of the formula guard is not removed', () => {
    expect(jsonOf("f\n'=SUM(A1)\n")).toBe('[{"f":"\'=SUM(A1)"}]');
  });

  it('row 49: spaces around values are kept', () => {
    expect(jsonOf('a , b\n 1 , 2\n')).toBe('[{"a ":" 1 "," b":" 2"}]');
  });
});

describe('§6, what a person sees', () => {
  it('the error rows of §6', () => {
    expect(errorOf(toCsv('[{"a":1},[1,2]]'))).toMatch(/^1:10 /);
    expect(errorOf(toCsv('42'))).toMatch(/^1:1 /);
    expect(errorOf(toCsv('[{"a":1,"a":2}]'))).toMatch(/^1:9 /);
    expect(errorOf(toCsv('[{"a.b":1,"a":{"b":2}}]'))).toMatch(/^1:16 /);
    expect(errorOf(toCsv('[{"a":1},]'))).toMatch(/^1:10 /);
    expect(errorOf(toJson('a,b\n"x,1'))).toMatch(/^2:1 /);
    expect(errorOf(toJson('a,b\n"x"y,1'))).toMatch(/^2:4 /);
    expect(errorOf(toJson('a,b\n1,2,3'))).toMatch(/^2:1 /);
    expect(errorOf(toJson('a,a.b\n1,2', { nest: true }))).toMatch(/^1:1 /);
  });

  it('a short record: the value of §6 and the note', () => {
    expect(csvToJson('a,b,c\n1,2', DEFAULT_TO_JSON)).toMatchObject({
      ok: true,
      text: '[\n  {\n    "a": 1,\n    "b": 2,\n    "c": null\n  }\n]',
    });
    // Two records with different counts fit no delimiter: Auto falls back to the comma and says so.
    expect(describeNotes(jsonNotes('a,b,c\n1,2'))).toEqual([
      'No delimiter found: read as comma-separated.',
      '1 row has fewer fields than the header: the missing cells are empty.',
    ]);
  });

  it('the notes of §5 «Заметки», word for word', () => {
    expect(describeNotes(csvNotes('[{"id":1,"name":"Ann","x":1},{"id":2,"name":"Bob","x":2}]'))).toEqual([
      '2 rows × 3 columns.',
    ]);
    expect(describeNotes(csvNotes('[{"c":"=HYPERLINK(\\"http://x\\")"}]'))[1]).toBe(
      "1 cell starts with = + - @ or a tab and was prefixed with ' so spreadsheets show it as text.",
    );
    expect(describeNotes(csvNotes('[{"a":"=1","b":"+2","c":"-3","d":"@4","e":"\\t5"}]'))[1]).toBe(
      "5 cells start with = + - @ or a tab and were prefixed with ' so spreadsheets show them as text.",
    );
    expect(describeNotes(jsonNotes('a;b;c\n1;2;3'))).toEqual(['Detected delimiter: semicolon.']);
    expect(describeNotes(jsonNotes('a\tb\n1\t2'))).toEqual(['Detected delimiter: tab.']);
    expect(describeNotes(jsonNotes('a|b\n1|2'))).toEqual(['Detected delimiter: pipe.']);
    expect(describeNotes(jsonNotes('a,b\n1,2', { delimiter: ',' }))).toEqual([]);
    expect(describeNotes(jsonNotes('a,a,,d\n1,2,3,4'))).toEqual([
      'Detected delimiter: comma.',
      'Renamed columns: 2 (a → a_2), 3 (empty → column_3).',
    ]);
    expect(describeNotes(jsonNotes('a,b,c\n1\n2'))[1]).toBe(
      '2 rows have fewer fields than the header: the missing cells are empty.',
    );
    expect(describeNotes(jsonNotes('a\n12345678901234567890'))).toContain(
      "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it.",
    );
  });

  it('scenario 1 (§2): Bob has an empty city; the size note', () => {
    const json = '[{"id":1,"name":"Ann","address":{"city":"Paris"}},{"id":2,"name":"Bob"}]';
    expect(csvOf(json)).toBe('id,name,address.city\r\n1,Ann,Paris\r\n2,Bob,\r\n');
    expect(describeNotes(csvNotes(json))[0]).toBe('2 rows × 3 columns.');
  });

  it('scenario 3 (§2): a formula in a quoted cell', () => {
    expect(csvOf('[{"comment":"=HYPERLINK(\\"http://x\\")"}]')).toBe('comment\r\n"\'=HYPERLINK(""http://x"")"\r\n');
  });

  it('scenario 4 (§2): a zip code keeps its leading zero, a quantity is a number', () => {
    expect(jsonOf('zip,qty\n01234,3\n')).toBe('[{"zip":"01234","qty":3}]');
  });

  it('scenario 7 (§2): long identifiers keep their digits', () => {
    expect(csvOf('[{"id":12345678901234567890}]')).toBe('id\r\n12345678901234567890\r\n');
  });
});

describe('§5, what §10 does not show', () => {
  it('the kinds named when items differ', () => {
    expect(errorOf(toCsv('[{"a":1},"x"]'))).toBe(
      '1:10 every item must be of one kind: the first is an object, this one is a string',
    );
    expect(errorOf(toCsv('[[1],{"a":1}]'))).toBe(
      '1:6 every item must be of one kind: the first is an array, this one is an object',
    );
    expect(errorOf(toCsv('[null,[1]]'))).toBe(
      '1:7 every item must be of one kind: the first is null, this one is an array',
    );
    expect(errorOf(toCsv('[true,{}]'))).toBe(
      '1:7 every item must be of one kind: the first is true or false, this one is an object',
    );
    // Values of different types are one kind: one column.
    expect(csvOf('["a",1,true,null]')).toBe('value\r\na\r\n1\r\ntrue\r\n""\r\n');
  });

  it('every root that is not an array or an object is refused, at the value', () => {
    for (const json of ['"x"', 'true', 'null', '  -1.5'])
      expect(errorOf(toCsv(json))).toMatch(/expected an array of objects, an array of arrays or one object$/);
    expect(errorOf(toCsv('\n  "x"'))).toBe('2:3 expected an array of objects, an array of arrays or one object');
  });

  it('the scanner’s errors: empty input, nesting deeper than its limit, comments', () => {
    expect(errorOf(toCsv(''))).toBe('1:1 empty input');
    expect(errorOf(toCsv(`${'['.repeat(1001)}${']'.repeat(1001)}`))).toMatch(/nesting deeper than 1000 levels$/);
    expect(errorOf(toCsv('[{"a":1} // c\n]'))).toMatch(/comments are not allowed in JSON$/);
  });

  it('a byte order mark before the JSON is skipped', () => {
    expect(csvOf('\uFEFF[{"a":1}]')).toBe('a\r\n1\r\n');
  });

  it('a repeated key inside a cell (an array, or Flatten off) is JSON text, not an error', () => {
    expect(csvOf('[{"a":[{"x":1,"x":2}]}]')).toBe('a\r\n"[{""x"":1,""x"":2}]"\r\n');
    expect(csvOf('[{"a":{"x":1,"x":2}}]', { flatten: false })).toBe('a\r\n"{""x"":1,""x"":2}"\r\n');
    expect(errorOf(toCsv('[{"a":{"x":1,"x":2}}]'))).toBe(
      '1:14 duplicate key "x": a row can\'t have two values for one column',
    );
    // A repeated key whose values are objects flattened into different columns is still repeated.
    expect(errorOf(toCsv('[{"a":{"x":1},"a":{"y":2}}]'))).toMatch(/^1:15 duplicate key "a"/);
  });

  it('flattens to any depth; a key with a dot in another row shares the column', () => {
    expect(csvOf('[{"a":{"b":{"c":{"d":1}}}}]')).toBe('a.b.c.d\r\n1\r\n');
    expect(csvOf('[{"a.b":1},{"a":{"b":2}}]')).toBe('a.b\r\n1\r\n2\r\n');
  });

  it('compact JSON text keeps literals as written', () => {
    expect(csvOf('[{"a":[1.50, "\\u00e9", {"k" : null}, true, 1E400]}]')).toBe(
      'a\r\n"[1.50,""\\u00e9"",{""k"":null},true,1E400]"\r\n',
    );
  });

  it('an array of arrays: ragged records, Header row and Flatten change nothing, nested values are JSON text', () => {
    const json = '[[1],[1,2,3],[{"a":{"b":1}}]]';
    expect(csvOf(json)).toBe('1\r\n1,2,3\r\n"{""a"":{""b"":1}}"\r\n');
    expect(csvOf(json, { header: false, flatten: false })).toBe(csvOf(json));
    expect(csvNotes(json)).toMatchObject({ rows: 3, columns: 3 });
  });

  it('a record of one empty field is written "" — a blank line would be skipped by a reader', () => {
    expect(csvOf('[{"a":null},{"a":"x"},{"b":1}]')).toBe('a,b\r\n,\r\nx,\r\n,1\r\n');
    expect(csvOf('[{"a":null},{"a":"x"}]')).toBe('a\r\n""\r\nx\r\n');
    expect(csvOf('[{"":1}]')).toBe('""\r\n1\r\n');
    expect(jsonOf(csvOf('[{"a":null},{"a":"x"}]'))).toBe('[{"a":null},{"a":"x"}]');
  });

  it('Quote all fields quotes empty cells and names too', () => {
    expect(csvOf('[{"a":null,"b":""},{"c":1}]', { quoteAll: true })).toBe('"a","b","c"\r\n"","",""\r\n"","","1"\r\n');
  });

  it('the formula guard covers names, a leading carriage return, and not true, null or compact JSON', () => {
    expect(csvOf('[{"=a":"\\rx","b":["=x"],"c":true}]')).toBe('"\'=a",b,c\r\n"\'\rx","[""=x""]",true\r\n');
    expect(csvNotes('[{"=a":"\\rx"}]').protectedCells).toBe(2);
    // Not at the start: nothing to guard.
    expect(csvOf('[{"a":"1=1","b":" =x"}]')).toBe('a,b\r\n1=1, =x\r\n');
  });

  it('with the guard off, formula-like cells are counted and the note warns', () => {
    const notes = csvNotes('[{"a":"=1","b":"@x"}]', { protectFormulas: false });
    expect(notes).toMatchObject({ protectedCells: 0, formulaCells: 2 });
    expect(describeNotes(notes)[1]).toBe(
      '2 cells start with = + - @ or a tab: a spreadsheet may run them as formulas (turn on "Protect from formulas").',
    );
  });

  it('quoting is by the chosen delimiter: a comma needs no quotes with a tab, a tab does', () => {
    expect(csvOf('[{"a":"x,y","b":"p|q"}]', { delimiter: '\t' })).toBe('a\tb\r\nx,y\tp|q\r\n');
    expect(csvOf('[{"a":"x,y","b":"p|q"}]', { delimiter: '|' })).toBe('a|b\r\nx,y|"p|q"\r\n');
    expect(csvOf('[{"a":"x\\ry"}]')).toBe('a\r\n"x\ry"\r\n');
  });

  it('Add BOM: U+FEFF first, for Save only', () => {
    expect(withBom('a\r\n1\r\n')).toBe('\uFEFFa\r\n1\r\n');
  });

  it('what CSV loses is counted for the note', () => {
    const notes = csvNotes('[{"a":"","b":"42","c":[1],"d":{"e":1},"f":null},{"a":"TRUE"}]');
    expect(notes.lost).toEqual({ blanks: 5, typedStrings: 2, jsonText: 1, flattened: true, emptyNames: 0 });
    expect(describeNotes(notes).at(-1)).toBe(
      'Not kept by CSV: 5 empty strings or missing keys (an empty cell, like null); 2 strings that look like a number or true/false (read back as one); 1 array or object (JSON text in a cell, read back as a string); nesting (put back only by "Nest dotted headers").',
    );
    expect(describeNotes(csvNotes('[{"a":1,"b":"x","c":null,"d":true}]'))).toEqual(['1 row × 4 columns.']);
    expect(describeNotes(csvNotes('[{"":1}]')).at(-1)).toBe(
      'Not kept by CSV: 1 empty key (a column without a name, read back as column_N).',
    );
  });
});

describe('§5, reading CSV', () => {
  it('records end at CRLF, LF or a lone CR, mixed; the last line needs no line break', () => {
    expect(jsonOf('a,b\r\n1,2\n3,4\r5,6')).toBe('[{"a":1,"b":2},{"a":3,"b":4},{"a":5,"b":6}]');
  });

  it('inside quotes, CRLF, CR and the delimiter are part of the value', () => {
    expect(jsonOf('a\n"x\r\ny\rz,w"\n')).toBe('[{"a":"x\\r\\ny\\rz,w"}]');
  });

  it('a line of spaces is a record, not a blank line; a quoted empty field is a record too', () => {
    expect(jsonOf('a,b\n  \n""\n', { empty: 'string' })).toBe('[{"a":"  ","b":""},{"a":"","b":""}]');
    expect(jsonNotes('a,b\n  \n""\n').shortRows).toBe(2);
  });

  it('a quoted field that ends the text, and a delimiter that ends a line, give a field', () => {
    expect(readCsv('a,"b"', ',')).toEqual({ ok: true, records: [{ offset: 0, fields: ['a', 'b'] }] });
    expect(readCsv('a,\n,', ',')).toEqual({
      ok: true,
      records: [
        { offset: 0, fields: ['a', ''] },
        { offset: 3, fields: ['', ''] },
      ],
    });
  });

  it('a quote not at the start of a field is a character; a field after spaces is not quoted', () => {
    expect(readCsv('a "b" c, "d"', ',')).toEqual({ ok: true, records: [{ offset: 0, fields: ['a "b" c', ' "d"'] }] });
  });

  it('offsets are UTF-16 and skip the byte order mark; maxRecords stops early', () => {
    expect(readCsv('\uFEFF🙂,x\n\n1,2\n3,4', ',', 2)).toEqual({
      ok: true,
      records: [
        { offset: 1, fields: ['🙂', 'x'] },
        { offset: 7, fields: ['1', '2'] },
      ],
    });
  });

  it('error places count UTF-16 and every kind of line break', () => {
    expect(errorOf(toJson('a,b\r\n🙂,"x"y'))).toMatch(/^2:7 unexpected text after a closing quote/);
    expect(errorOf(toJson('a,b\r1,2\r"x'))).toBe('3:1 unclosed quote: the field never ends');
  });

  it('without a header row, records may have any length; Leave out is null in an array', () => {
    expect(jsonOf('1\n1,,3\n', { header: false, empty: 'omit' })).toBe('[[1],[1,null,3]]');
    expect(jsonNotes('1\n1,,3\n', { header: false })).toMatchObject({ rows: 2, columns: 3 });
  });

  it('renaming takes the first free name and never one the header already has', () => {
    expect(jsonOf('id,id_2,id,,column_4,\n1,2,3,4,5,6', { detectTypes: false })).toBe(
      '[{"id":"1","id_2":"2","id_3":"3","column_4_2":"4","column_4":"5","column_6":"6"}]',
    );
  });

  it('long lists of renamed columns are cut after five', () => {
    expect(describeNotes(jsonNotes(`a${',a'.repeat(7)}\n1${',1'.repeat(7)}`, { delimiter: ',' }))).toEqual([
      'Renamed columns: 2 (a → a_2), 3 (a → a_3), 4 (a → a_4), 5 (a → a_5), 6 (a → a_6) and 2 more.',
    ]);
  });

  it('types: numbers by the JSON grammar only, booleans in three spellings, everything else a string', () => {
    const cells = ['1.', '.5', '0x1F', '1 000', 'NaN', 'Infinity', '1,5', '-', '1e', '01', '2024-01-02', 'tRUE', 'N/A'];
    expect(JSON.parse(jsonOf(cells.join('\n'), { header: false, delimiter: ';' }))).toEqual(cells.map(c => [c]));
    expect(jsonOf('-1.5E+10\n0.0\nFALSE\nFalse', { header: false })).toBe('[[-1.5E+10],[0.0],[false],[false]]');
  });

  it('Nest: column order decides where a group stands; a group of left-out cells is left out', () => {
    expect(jsonOf('a.x,b,a.y\n1,2,3', { nest: true })).toBe('[{"a":{"x":1,"y":3},"b":2}]');
    expect(jsonOf('id,address.city,address.zip\n1,,\n2,Paris,', { nest: true, empty: 'omit' })).toBe(
      '[{"id":1},{"id":2,"address":{"city":"Paris"}}]',
    );
    expect(jsonOf('a.b.c,a.b.d\n1,2', { nest: true })).toBe('[{"a":{"b":{"c":1,"d":2}}}]');
    // The parent after its child, and a value under a deeper parent.
    expect(errorOf(toJson('x,a.b,a\n1,2,3', { nest: true }))).toBe(
      '1:7 column "a" is both a value and the parent of "a.b"',
    );
    expect(errorOf(toJson('a.b,a.b.c\n1,2', { nest: true }))).toBe(
      '1:1 column "a.b" is both a value and the parent of "a.b.c"',
    );
    // As deep as the JSON scanner reads, without the call stack; deeper is refused at the column.
    const deep = Array.from({ length: 999 }, () => 'k').join('.');
    expect(jsonOf(`${deep}\n1`, { nest: true })).toBe(`[${'{"k":'.repeat(999)}1${'}'.repeat(999)}]`);
    expect(errorOf(toJson(`a,${deep}.k\n1,2`, { nest: true }))).toBe(
      `1:3 column "${'k.'.repeat(20)}…" nests deeper than 1000 levels`,
    );
  });

  it('Nest without a header row does nothing; dotted names without Nest stay names', () => {
    expect(jsonOf('a.b\n1', { nest: true, header: false })).toBe('[["a.b"],[1]]');
    expect(jsonOf('a.b\n1')).toBe('[{"a.b":1}]');
  });

  it('strings are escaped exactly, control characters too', () => {
    expect(jsonOf('a\n"\u0001\t\\ /"', { delimiter: ',' })).toBe('[{"a":"\\u0001\\t\\\\ /"}]');
  });

  it('the indents print like the JSON tool: one member a line, ": ", no line break at the end', () => {
    const csv = 'a,b\n1,x\n';
    const value = [{ a: 1, b: 'x' }];
    expect(jsonOf(csv, { layout: 2 })).toBe(JSON.stringify(value, null, 2));
    expect(jsonOf(csv, { layout: 4 })).toBe(JSON.stringify(value, null, 4));
    expect(jsonOf(csv, { layout: 'tab' })).toBe(JSON.stringify(value, null, '\t'));
    expect(jsonOf('a\n', { layout: 2 })).toBe('[]');
    expect(jsonOf('a.b\n', { layout: 2, nest: true })).toBe('[]');
    expect(jsonOf('a,b\n,', { layout: 2, empty: 'omit' })).toBe('[\n  {}\n]');
  });

  it('a delimiter chosen by hand is used as is, and nothing is said about it', () => {
    expect(jsonOf('a;b\n1;2', { delimiter: ',' })).toBe('[{"a;b":"1;2"}]');
    expect(jsonNotes('a;b\n1;2', { delimiter: ',' })).toMatchObject({ detected: false, fallback: false });
  });

  it('no delimiter fits: the fallback is said', () => {
    expect(describeNotes(jsonNotes('hello world\nfoo'))).toEqual(['No delimiter found: read as comma-separated.']);
  });
});

describe('§5 «Разделитель»', () => {
  it('the most fields wins; a tie goes to the earlier in the list; none — null', () => {
    expect(detectDelimiter('a,b;c\n1,2;3')).toBe(',');
    expect(detectDelimiter('a;b;c,d\n1;2;3,4')).toBe(';');
    expect(detectDelimiter('a|b\tc|d\n1|2\t3|4')).toBe('|');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('hello\nworld')).toBeNull();
    expect(detectDelimiter('')).toBeNull();
    // Unequal counts do not fit.
    expect(detectDelimiter('a,b\n1,2,3')).toBeNull();
  });

  it('quotes count: a delimiter inside quotes is not one, text after a closing quote rules a delimiter out', () => {
    expect(detectDelimiter('"a;b",c\n"1;2",3')).toBe(',');
    expect(detectDelimiter('"a";"b"\n"1";"2"')).toBe(';');
  });

  it('only the first ten records count', () => {
    expect(detectDelimiter(`${'a,b\n'.repeat(10)}1,2,3,4\n`)).toBe(',');
    expect(detectDelimiter(`${'a,b\n'.repeat(9)}1,2,3,4\n`)).toBeNull();
  });
});

describe('limits', () => {
  it('the worst inputs of 1 MB stay linear', () => {
    // Bound the shape, not milliseconds: a quadratic reader would take minutes here, a linear one milliseconds.
    const inputs = [
      '"'.repeat(1 << 20),
      `"${'""'.repeat(1 << 19)}`,
      ','.repeat(1 << 20),
      `a\n${'"x""y",'.repeat(1 << 17)}`,
      '\n'.repeat(1 << 20),
      `${'a.'.repeat(1 << 18)}a\n1`,
    ];
    for (const text of inputs) {
      const started = performance.now();
      csvToJson(text, { ...DEFAULT_TO_JSON, nest: true });
      jsonToCsv(text, DEFAULT_TO_CSV);
      expect(performance.now() - started).toBeLessThan(30_000);
    }
  }, 120_000);
});
