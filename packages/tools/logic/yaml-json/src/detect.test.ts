/** detectYaml (docs/tools/specs/yaml-json.md §7): the table of §7, the inputs of the other tools, long input. */
import { detectYaml } from './detect';
import { describe, expect, it } from 'vitest';

describe('detectYaml', () => {
  it.each([
    'a: 1\nb: 2',
    'name: demo\nitems:\n  - x\n  - y',
    '- a\n- b',
    'apiVersion: v1\nkind: Pod',
    '# c\nx: 1\ny: 2',
    'title: x\nbody: |\n  multi\n  line',
    'Subject: hi\nFrom: me',
    '---\napiVersion: v1\nkind: Pod\nmetadata:\n  name: web\n',
    '%YAML 1.2\n---\na: 1\nb: 2',
    'services:\n  web:\n    image: "nginx:1.27"\n    ports:\n      - "80:80"\n',
    'name: x\n"quoted key": 1\n\'single\': 2',
    'on:\n  push:\n    branches: [main]\njobs:\n  build:\n    runs-on: ubuntu-latest\n',
    'a: 1\r\nb: 2\r\n',
    'x-defaults: &defaults\n  restart: always\nweb:\n  <<: *defaults\n',
  ])('yes: %j', text => {
    expect(detectYaml(text)).toBe(true);
  });

  it.each([
    '',
    '   \n  ',
    '---\na: 1',
    'a: 1',
    '{"a":1}',
    '[1, 2]',
    '"a: 1\\nb: 2"',
    'hello world',
    'Note: this is a sentence.',
    'Hello: world\nThis is text',
    'key=value',
    'Error: something failed\n    at foo (file.js:1:2)',
    '* * * * *',
    '0 5 * * 1',
    // A made-up sample token for the test, not a credential — the secret scanner is told so.
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', // gitleaks:allow
    'SELECT a FROM t',
    'SELECT a,\n  b\nFROM t\nWHERE x = 1',
    'http://x.y/a:b',
    'https://example.com/path?a=1&b=2',
    'SGVsbG8sIFdvcmxkIQ==',
    '550e8400-e29b-41d4-a716-446655440000',
    '1700000000',
    '2024-01-15T10:00:00Z',
    '^\\d{3}-\\d{4}$',
    '/a+b/gi',
    '#ff8800',
    'rgb(255, 136, 0)',
    'HTTP/1.1 200 OK\nContent-Type: text/html\nServer: x',
    'Traceback (most recent call last):\n  File "x.py", line 1, in <module>\nValueError: bad',
    'Exception in thread "main" java.lang.Error: x\n\tat Foo.main(Foo.java:1)',
    '--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-a\n+b',
    '# Title\n\nSome text here.\nMore text.',
    'const a = 1;\nconst b: number = 2;',
    'a { color: red; }\nb { color: blue; }',
    '[section]\nkey = value',
    'KEY=value\nOTHER=1',
    'a,b,c\n1,2,3',
    '<div class="a">\n  <p>x</p>\n</div>',
    'Dear team: thanks.\nSee you.',
  ])('no: %j', text => {
    expect(detectYaml(text)).toBe(false);
  });

  it('looks at the first 100 lines only', () => {
    expect(detectYaml(`${'a: 1\n'.repeat(100)}this is prose`)).toBe(true);
    expect(detectYaml(`${'a: 1\n'.repeat(99)}this is prose`)).toBe(false);
  });

  it('long input is answered at once and over 1 Mi it is not ours', () => {
    const long = `a: ${'x'.repeat(300_000)}\nb: ${'y: '.repeat(100_000)}`;
    const prose = 'word: '.repeat(60_000);
    const t0 = performance.now();
    expect(detectYaml(long)).toBe(true);
    expect(detectYaml(prose)).toBe(false);
    expect(detectYaml(`a: 1\nb: ${'"'.repeat(300_000)}`)).toBe(true);
    expect(detectYaml(`a: 1\n${' '.repeat(300_000)}x\nb: 2`)).toBe(true);
    expect(detectYaml(`a: 1\nb: 2\n${'c'.repeat(1024 * 1024)}`)).toBe(false);
    // A guard against runaway matching (seconds), not a speed test.
    expect(performance.now() - t0).toBeLessThan(1_000);
  });
});
