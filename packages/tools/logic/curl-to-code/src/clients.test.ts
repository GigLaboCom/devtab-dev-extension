// The seventeen client writers (docs/tools/specs/curl-to-code.md §5, «Код»): one contract every writer passes; every
// body kind in every client; and hostile requests — every string of them (address, method, header names and values,
// body, credentials, form names and values, file paths) full of quotes, backslashes, line breaks, `${`, `$(`, backticks,
// `%`, NUL, non-ASCII, U+2028, a bidi control, typographic quotes — whose code is then read by the language or a
// stand-in, without sending anything:
//   JavaScript fetch, Node fetch, axios — run in node:vm with a stand-in fetch / axios that records its call;
//   Python requests and http.client — run by python3 against stand-in modules that record the call;
//   Go — gofmt and go vet (compiled, never run); Java — javac; Ruby — ruby -c; Swift — swiftc -typecheck;
//   HTTPie and wget — run by bash with shell functions in their place that record their arguments;
//   Kotlin, C#, PHP, Dart, PowerShell — every literal of the program read by the readers of readers.testing.ts.
// Sending real requests is verify.test.ts, on loopback only. The table of warnings by client is warnings.test.ts.
import { isInvisible } from './literals/common';
import { scan } from './readers.testing';
import { ALL_TARGETS, generate, ready, request as base } from './testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { Language } from './readers.testing';
import type { CurlRequest, Target } from './types';

beforeAll(ready);

const HEAVY = { timeout: 240_000 };
const has = (command: string, args: string[]): boolean => {
  try {
    return spawnSync(command, args, { stdio: 'ignore', timeout: 30_000 }).status === 0;
  } catch {
    return false;
  }
};
const PYTHON = has('python3', ['--version']);
const GO = has('go', ['version']);
const RUBY = has('ruby', ['--version']);
const SWIFTC = has('swiftc', ['--version']);
const BASH = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash'].find(existsSync);
const JAVAC = [
  process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin/javac'),
  '/opt/homebrew/opt/openjdk/bin/javac',
  '/usr/local/opt/openjdk/bin/javac',
].find((j): j is string => !!j && existsSync(j) && has(j, ['-version']));

const NASTY =
  'a\'b"c\\d ${x} $(y) `z` %s %% #{w} {$v} \n\r\t\u{0}\u{7}\u{7f}\u{85} é Ж 😀 \u{2018}q\u{2019} \u{201c}d\u{201d} \u{2028}\u{2029} \u{202e}end';
/** NASTY without what a command line or a header cannot hold. */
const PRINTABLE = [...NASTY].filter(c => !isInvisible(c.codePointAt(0)!)).join('');

/** Requests that between them use every kind of string a writer writes, and every body kind. */
const HOSTILE: Array<[string, CurlRequest]> = [
  [
    'raw body, headers, credentials',
    base({
      method: 'POST',
      url: `https://a.example/p?q=${encodeURIComponent(NASTY)}&r='"\\\`\${}`,
      headers: [
        ['X-Plain', PRINTABLE.replace(/[^\x20-\x7e]/g, '')],
        ['X-Unicode', 'Jörg Ж 😀'],
        ['Content-Type', 'text/plain'],
      ],
      body: { kind: 'raw', text: NASTY },
      user: [`u'"\\\${}\`$(x)`, `p:${NASTY.replaceAll('\u{0}', '')}`],
      timeoutSeconds: 1.5,
      insecure: true,
      compressed: true,
      followRedirects: true,
    }),
  ],
  [
    'a method of its own',
    base({
      method: 'PURGE',
      headers: [
        ['Host', 'h.example'],
        ['X-Empty', ''],
      ],
    }),
  ],
  [
    'binary',
    base({
      method: 'PUT',
      headers: [['Content-Type', 'application/octet-stream']],
      body: { kind: 'binary', bytes: Uint8Array.of(1, 0x22, 0x24, 0x27, 0x5c, 0x60, 0x80, 0xff) },
    }),
  ],
  [
    'multipart',
    base({
      method: 'POST',
      body: {
        kind: 'multipart',
        fields: [
          { name: `n'"\\$x`, value: PRINTABLE },
          { name: 'n2', file: `dir/it's "q".txt`, filename: `it's "q".txt` },
          { name: 'n3', value: 'again' },
        ],
      },
      timeoutSeconds: 3,
    }),
  ],
  [
    'a file, stripped',
    base({
      method: 'POST',
      headers: [['Content-Type', 'application/json']],
      body: { kind: 'file', path: `p'"\\$ é.json`, strip: true },
    }),
  ],
  ['a file', base({ method: 'PUT', body: { kind: 'file', path: 'b.bin', strip: false } })],
];

const SAMPLE = base({
  method: 'POST',
  url: 'https://api.example.com/items',
  headers: [['Content-Type', 'application/json']],
  body: { kind: 'raw', text: '{"name":"pen","qty":2}' },
});

describe('the writers’ contract', () => {
  it('every target has a writer', () => expect(ALL_TARGETS).toHaveLength(17));
  it.each(ALL_TARGETS)('%s: a program that ends with one line break, the same for the same request', target => {
    for (const [, request] of [...HOSTILE, ['sample', SAMPLE] as const]) {
      const a = generate(request, target);
      expect(a.text.endsWith('\n')).toBe(true);
      expect(a.text.endsWith('\n\n')).toBe(false);
      expect(a.text).not.toMatch(/[ \t]+\n/);
      expect(generate(request, target)).toEqual(a);
      expect(new Set(a.warnings).size).toBe(a.warnings.length);
    }
  });
  it.each(ALL_TARGETS)('%s: a plain GET and the §10 sample have no warnings', target => {
    expect(generate(base(), target).warnings).toEqual([]);
    expect(generate(SAMPLE, target).warnings).toEqual([]);
  });
  it.each(ALL_TARGETS)('%s: the address, the method, the header and the body are in the code', target => {
    const text = generate(SAMPLE, target).text;
    // http.client takes the host and the path apart.
    expect(text).toMatch(target === 'http-client' ? /'api\.example\.com'[^]*'\/items'/ : /api\.example\.com\/items/);
    expect(text).toMatch(/POST|Post|post/);
    expect(text).toContain('Content-Type');
    expect(text).toMatch(/pen/);
  });
});

// ----------------------------------------------------------------------------------------------------------------------
// Every body kind in every client: what carries it (a marker of the client's API) and what the client cannot carry.

const KINDS: Array<[kind: string, request: CurlRequest]> = [
  [
    'text',
    base({
      method: 'POST',
      headers: [['Content-Type', 'application/x-www-form-urlencoded']],
      body: { kind: 'raw', text: 'a=1&b=2' },
    }),
  ],
  [
    'JSON as text',
    base({ method: 'POST', headers: [['Content-Type', 'application/json']], body: { kind: 'raw', text: '{"n":1.0}' } }),
  ],
  [
    'form',
    base({
      method: 'POST',
      body: {
        kind: 'multipart',
        fields: [
          { name: 'a', value: '1' },
          { name: 'f', file: 'p.png', filename: 'p.png' },
        ],
      },
    }),
  ],
  [
    'file',
    base({
      method: 'POST',
      headers: [['Content-Type', 'application/json']],
      body: { kind: 'file', path: 'b.json', strip: false },
    }),
  ],
  ['file without line breaks', base({ method: 'POST', body: { kind: 'file', path: 'b.json', strip: true } })],
  ['bytes', base({ method: 'POST', body: { kind: 'binary', bytes: Uint8Array.of(0x41, 0xff) } })],
];

/** For each client and body kind, a piece of code that carries the body (null: the client cannot, with a warning). */
const CARRIERS: Readonly<Record<Target, readonly (string | null)[]>> = {
  javascript: [
    "body: 'a=1&b=2'",
    `body: '{"n":1.0}'`,
    'body: form',
    "await readFile('b.json')",
    'b !== 10 && b !== 13',
    'new Uint8Array([0x41, 0xff])',
  ],
  node: [
    "body: 'a=1&b=2'",
    `body: '{"n":1.0}'`,
    'body: form',
    "await readFile('b.json')",
    'b !== 10 && b !== 13',
    'new Uint8Array([0x41, 0xff])',
  ],
  axios: [
    "data: 'a=1&b=2'",
    `data: '{"n":1.0}'`,
    'data: form',
    "await readFile('b.json')",
    'b !== 10 && b !== 13',
    'Buffer.from([0x41, 0xff])',
  ],
  python: [
    "data = 'a=1&b=2'",
    `data = '{"n":1.0}'`,
    "'f': ('p.png', open('p.png', 'rb'))",
    "open('b.json', 'rb')",
    ".replace(b'\\r', b'')",
    "data = b'A\\xff'",
  ],
  'http-client': [
    "body = 'a=1&b=2'",
    `body = '{"n":1.0}'`,
    "pathlib.Path('p.png').read_bytes()",
    "pathlib.Path('b.json').read_bytes()",
    ".replace(b'\\r', b'')",
    "body = b'A\\xff'",
  ],
  httpie: [
    "--raw 'a=1&b=2'",
    `--raw '{"n":1.0}'`,
    "'f@p.png'",
    "< 'b.json'",
    "tr -d '\\r\\n' < 'b.json' |",
    "printf 'A\\377' |",
  ],
  wget: [
    "--body-data 'a=1&b=2'",
    `--body-data '{"n":1.0}'`,
    null,
    "--body-file 'b.json'",
    `--body-data "$(tr -d '\\r\\n' < 'b.json')"`,
    "--body-data $'A\\xff'",
  ],
  java: [
    'ofString("a=1&b=2")',
    'ofString("{\\"n\\":1.0}")',
    'Files.readAllBytes(Path.of("p.png"))',
    'ofFile(Path.of("b.json"))',
    'withoutLineBreaks(',
    'new byte[] { 65, -1 }',
  ],
  csharp: [
    'GetBytes("a=1&b=2")',
    'GetBytes("{\\"n\\":1.0}")',
    'form.Add(new ByteArrayContent(File.ReadAllBytes("p.png")), "f", "p.png")',
    'File.ReadAllBytes("b.json")',
    "b != '\\r' && b != '\\n'",
    'new byte[] { 0x41, 0xFF }',
  ],
  php: [
    "CURLOPT_POSTFIELDS => 'a=1&b=2'",
    `CURLOPT_POSTFIELDS => '{"n":1.0}'`,
    "new CURLFile('p.png', '', 'p.png')",
    "file_get_contents('b.json')",
    'str_replace(["\\r", "\\n"]',
    'CURLOPT_POSTFIELDS => "A\\xff"',
  ],
  powershell: [
    "Body = 'a=1&b=2'",
    `Body = '{"n":1.0}'`,
    "(Get-Item -LiteralPath 'p.png')",
    "InFile = 'b.json'",
    '$_ -ne 13 -and $_ -ne 10',
    'Body = [byte[]](0x41, 0xFF)',
  ],
  go: [
    'strings.NewReader("a=1&b=2")',
    'strings.NewReader(`{"n":1.0}`)',
    'addFile(form, "f", "p.png", "p.png")',
    'os.ReadFile("b.json")',
    'bytes.ReplaceAll(data, []byte("\\r"), nil)',
    'strings.NewReader("A\\xff")',
  ],
  rust: [
    '.body("a=1&b=2")',
    '.body(r#"{"n":1.0}"#)',
    '.file("f", "p.png")?',
    'std::fs::read("b.json")?',
    "data.retain(|b| *b != b'\\r' && *b != b'\\n')",
    '.body(&b"A\\xff"[..])',
  ],
  kotlin: [
    '"a=1&b=2".toRequestBody()',
    '"{\\"n\\":1.0}".toRequestBody()',
    '.addFormDataPart("f", "p.png", File("p.png").asRequestBody())',
    'File("b.json").asRequestBody()',
    'it != 10.toByte() && it != 13.toByte()',
    'byteArrayOf(65, -1).toRequestBody()',
  ],
  dart: [
    "utf8.encode('a=1&b=2')",
    `utf8.encode('{"n":1.0}')`,
    "http.MultipartFile.fromPath('f', 'p.png', filename: 'p.png')",
    "File('b.json').readAsBytes()",
    '(b) => b != 10 && b != 13',
    'request.bodyBytes = [0x41, 0xff];',
  ],
  ruby: [
    "request.body = 'a=1&b=2'",
    `request.body = '{"n":1.0}'`,
    "['f', File.open('p.png'), { filename: 'p.png' }]",
    "File.binread('b.json')",
    '.delete("\\r\\n")',
    'request.body = "A\\xff".b',
  ],
  swift: [
    'Data("a=1&b=2".utf8)',
    'Data("{\\"n\\":1.0}".utf8)',
    'Data(contentsOf: URL(fileURLWithPath: "p.png"))',
    'Data(contentsOf: URL(fileURLWithPath: "b.json"))',
    '.filter { $0 != 10 && $0 != 13 }',
    'Data([0x41, 0xFF])',
  ],
};

describe('every body kind in every client', () => {
  it.each(ALL_TARGETS)('%s', target => {
    KINDS.forEach(([kind, request], i) => {
      const g = generate(request, target);
      const carrier = CARRIERS[target][i];
      if (carrier === null) expect(g.warnings.join('\n'), `${target} ${kind}`).toMatch(/cannot send/);
      else expect(g.text, `${target} ${kind}`).toContain(carrier);
    });
  });
  it('JSON is never parsed into a structure of the language: the body is the text as written', () => {
    const json = base({
      method: 'POST',
      headers: [['Content-Type', 'application/json']],
      body: { kind: 'raw', text: '{"n":12345678901234567890,"f":1.0}' },
    });
    for (const t of ALL_TARGETS) expect(generate(json, t).text, t).toMatch(/12345678901234567890\D*?1\.0/);
  });
});

// ----------------------------------------------------------------------------------------------------------------------
// JavaScript, read back in node:vm with stand-ins.

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: boolean;
}

const runFetch = async (code: string): Promise<FetchCall> => {
  let recorded: FetchCall | undefined;
  const source = `(async () => {\n${code.replace(/^import .*\n/gm, '')}\n})()`;
  await runInNewContext(source, {
    fetch: async (
      url: string,
      init: { method?: string; headers?: Record<string, string>; body?: unknown; signal?: unknown } = {},
    ) => {
      recorded = {
        url,
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        body: init.body,
        signal: !!init.signal,
      };
      return { text: async () => '' };
    },
    readFile: async (path: string) => Buffer.from(`file:${path}\r\n`, 'utf8'),
    process: { env: {} },
    console: { log: () => {} },
    FormData,
    Blob,
    Uint8Array,
    AbortSignal,
  });
  return recorded!;
};

const runAxios = async (code: string): Promise<Record<string, unknown>> => {
  let recorded: Record<string, unknown> | undefined;
  const source = `(async () => {\n${code.replace(/^(?:\/\/|import) .*\n/gm, '')}\n})()`;
  await runInNewContext(source, {
    axios: async (config: Record<string, unknown>) => {
      recorded = config;
      return { data: '' };
    },
    https: {
      Agent: class {
        constructor(public options: unknown) {}
      },
    },
    readFile: async (path: string) => Buffer.from(`file:${path}\r\n`, 'utf8'),
    console: { log: () => {} },
    Buffer,
    FormData,
    Blob,
    AbortSignal,
  });
  return recorded!;
};

const latin1Utf8 = (s: string): string => Buffer.from(s, 'utf8').toString('latin1');

describe('JavaScript reads back every string (node:vm, stand-ins)', () => {
  it.each(['javascript', 'node'] as const)('%s', async target => {
    const [, r] = HOSTILE[0]!;
    const got = await runFetch(generate(r, target).text);
    expect(got.url).toBe(r.url);
    expect(got.method).toBe('POST');
    expect(got.body).toBe(NASTY);
    expect(got.signal).toBe(true);
    expect(got.headers).toEqual({
      'X-Plain': r.headers[0]![1],
      'X-Unicode': latin1Utf8('Jörg Ж 😀'),
      'Content-Type': 'text/plain',
      Authorization: `Basic ${Buffer.from(`${r.user![0]}:${r.user![1]}`, 'utf8').toString('base64')}`,
    });
    expect((await runFetch(generate(HOSTILE[1]![1], target).text)).method).toBe('PURGE');
    expect(Array.from((await runFetch(generate(HOSTILE[2]![1], target).text)).body as Uint8Array)).toEqual([
      1, 0x22, 0x24, 0x27, 0x5c, 0x60, 0x80, 0xff,
    ]);
    const form = (await runFetch(generate(HOSTILE[3]![1], target).text)).body as FormData;
    const entries = [...form.entries()];
    expect(entries.map(([k]) => k)).toEqual([`n'"\\$x`, 'n2', 'n3']);
    expect(entries[0]![1]).toBe(PRINTABLE);
    expect((entries[1]![1] as File).name).toBe(`it's "q".txt`);
    expect(await (entries[1]![1] as File).text()).toBe(`file:dir/it's "q".txt\r\n`);
    const stripped = (await runFetch(generate(HOSTILE[4]![1], target).text)).body as Uint8Array;
    expect(Buffer.from(stripped).toString('utf8')).toBe(`file:p'"\\$ é.json`);
  });
  it('axios', async () => {
    const [, r] = HOSTILE[0]!;
    const got = await runAxios(generate(r, 'axios').text);
    expect(got).toMatchObject({
      method: 'POST',
      url: r.url,
      data: NASTY,
      auth: { username: r.user![0], password: r.user![1] },
    });
    expect(got.headers).toEqual({
      'X-Plain': r.headers[0]![1],
      'X-Unicode': latin1Utf8('Jörg Ж 😀'),
      'Content-Type': 'text/plain',
    });
    expect((got.httpsAgent as { options: unknown }).options).toEqual({ rejectUnauthorized: false });
    expect([...((await runAxios(generate(HOSTILE[2]![1], 'axios').text)).data as Buffer)]).toEqual([
      1, 0x22, 0x24, 0x27, 0x5c, 0x60, 0x80, 0xff,
    ]);
    const form = (await runAxios(generate(HOSTILE[3]![1], 'axios').text)).data as FormData;
    expect([...form.keys()]).toEqual([`n'"\\$x`, 'n2', 'n3']);
  });
});

// ----------------------------------------------------------------------------------------------------------------------
// Python, against stand-in modules.

const PY_REQUESTS = `import json
def _b(v):
    return v if isinstance(v, bytes) else v.encode('latin-1')
def _call(method, url, headers=None, data=None, files=None, auth=None, timeout=None, verify=True, allow_redirects=True):
    out = {'method': method, 'url': url, 'headers': {k: _b(v).hex() for k, v in (headers or {}).items()},
           'data': None if data is None else _b(data).hex(), 'auth': None if auth is None else [_b(x).hex() for x in auth],
           'files': None}
    if files is not None:
        items = files.items() if isinstance(files, dict) else files
        out['files'] = [[k, f, v.read().hex() if hasattr(v, 'read') else v.encode('utf-8').hex()] for k, (f, v) in items]
    print(json.dumps(out))
def get(url, **kw): return _call('GET', url, **kw)
def post(url, **kw): return _call('POST', url, **kw)
def put(url, **kw): return _call('PUT', url, **kw)
def request(method, url, **kw): return _call(method, url, **kw)
`;

/** A stand-in for the standard library's http.client (it shadows the real one in the folder): records the call. */
const PY_HTTP_CLIENT = `import json
class _Conn:
    def __init__(self, host, timeout=None, context=None):
        self.host = host
    def request(self, method, target, body=None, headers=None):
        b = body if isinstance(body, bytes) or body is None else body.encode('latin-1')
        print(json.dumps({'host': self.host, 'method': method, 'target': target, 'body': None if b is None else b.hex(),
                          'headers': {k: (v if isinstance(v, bytes) else v.encode('latin-1')).hex() for k, v in headers.items()}}))
    def getresponse(self):
        class R:
            def read(self): return b''
        return R()
HTTPConnection = HTTPSConnection = _Conn
`;

const hex = (s: string): string => Buffer.from(s, 'utf8').toString('hex');

describe.skipIf(!PYTHON)('Python reads back every string (stand-in modules)', () => {
  it('requests and http.client', HEAVY, () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-py-'));
    try {
      writeFileSync(join(dir, 'requests.py'), PY_REQUESTS);
      mkdirSync(join(dir, 'http'));
      writeFileSync(join(dir, 'http/__init__.py'), '');
      writeFileSync(join(dir, 'http/client.py'), PY_HTTP_CLIENT);
      mkdirSync(join(dir, 'dir'));
      writeFileSync(join(dir, `dir/it's "q".txt`), 'Q\r\n');
      writeFileSync(join(dir, `p'"\\$ é.json`), 'a\r\nb\n');
      writeFileSync(join(dir, 'b.bin'), Buffer.from([0, 0xff, 0x0d, 0x0a]));
      const calls = (target: Target) =>
        HOSTILE.map(([, r], i) => {
          writeFileSync(join(dir, `c${i}.py`), generate(r, target).text);
          const out = spawnSync('python3', ['-E', '-s', `c${i}.py`], { cwd: dir, encoding: 'utf8' });
          expect(out.stderr).toBe('');
          return JSON.parse(out.stdout);
        });
      const r0 = HOSTILE[0]![1];
      const req = calls('python');
      expect(req[0]).toEqual({
        method: 'POST',
        url: r0.url,
        headers: Object.fromEntries(r0.headers.map(([n, v]) => [n, hex(v)])),
        data: hex(NASTY),
        auth: [hex(r0.user![0]), hex(r0.user![1])],
        files: null,
      });
      expect(req[1].method).toBe('PURGE');
      expect(req[2].data).toBe('0122242' + '75c6080ff');
      expect(req[3].files).toEqual([
        [`n'"\\$x`, null, hex(PRINTABLE)],
        ['n2', `it's "q".txt`, hex('Q\r\n')],
        ['n3', null, hex('again')],
      ]);
      expect(req[4].data).toBe(hex('ab'));
      expect(req[5].data).toBe('00ff0d0a');

      const cl = calls('http-client');
      const u = new URL(r0.url);
      expect(cl[0]).toMatchObject({
        host: 'a.example',
        method: 'POST',
        target: u.pathname + r0.url.slice(r0.url.indexOf('?')),
        body: hex(NASTY),
      });
      expect(cl[0].headers['X-Unicode']).toBe(hex('Jörg Ж 😀'));
      expect(Buffer.from(cl[0].headers.Authorization, 'hex').toString()).toBe(
        `Basic ${Buffer.from(`${r0.user![0]}:${r0.user![1]}`, 'utf8').toString('base64')}`,
      );
      expect(cl[1]).toMatchObject({ method: 'PURGE', target: '/x', body: null });
      expect(cl[2].body).toBe('01222427' + '5c6080ff');
      const multipart = Buffer.from(cl[3].body, 'hex').toString('latin1');
      expect(multipart).toContain(
        `Content-Disposition: form-data; name="n'%22\\$x"\r\n\r\n${Buffer.from(PRINTABLE, 'utf8').toString('latin1')}\r\n`,
      );
      expect(multipart).toContain(
        `name="n2"; filename="it's %22q%22.txt"\r\nContent-Type: text/plain\r\n\r\nQ\r\n\r\n`,
      );
      expect(cl[4].body).toBe(hex('ab'));
      expect(cl[5].body).toBe('00ff0d0a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ----------------------------------------------------------------------------------------------------------------------
// Compiled or checked by the language, never run.

const writeAll = (dir: string, target: Target, file: (i: number) => string): void =>
  HOSTILE.forEach(([, r], i) => {
    const path = join(dir, file(i));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, generate(r, target).text);
  });

describe('the languages take every hostile program (compiled or checked, never run)', () => {
  it.skipIf(!GO)('Go: gofmt-clean, go vet', HEAVY, () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-go-'));
    try {
      writeAll(dir, 'go', i => `c${i}/main.go`);
      writeFileSync(join(dir, 'go.mod'), 'module verify\n\ngo 1.21\n');
      expect(spawnSync('gofmt', ['-l', '.'], { cwd: dir, encoding: 'utf8' }).stdout).toBe('');
      const vet = spawnSync('go', ['vet', './...'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GOFLAGS: '-mod=mod' },
      });
      expect(vet.stderr).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.skipIf(!JAVAC)('Java: javac', HEAVY, () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-java-'));
    try {
      writeAll(dir, 'java', i => `c${i}/Main.java`);
      for (let i = 0; i < HOSTILE.length; i++) {
        const r = spawnSync(
          JAVAC!,
          ['-encoding', 'UTF-8', '-d', join(dir, `c${i}/out`), join(dir, `c${i}/Main.java`)],
          {
            encoding: 'utf8',
            env: { ...process.env, JAVA_TOOL_OPTIONS: '' },
          },
        );
        expect(r.stderr.replace(/^Picked up JAVA_TOOL_OPTIONS.*\n/m, ''), `case ${i}`).toBe('');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.skipIf(!RUBY)('Ruby: ruby -c', HEAVY, () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-ruby-'));
    try {
      writeAll(dir, 'ruby', i => `c${i}.rb`);
      for (let i = 0; i < HOSTILE.length; i++)
        expect(spawnSync('ruby', ['-c', join(dir, `c${i}.rb`)], { encoding: 'utf8' }).stdout).toBe('Syntax OK\n');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it.skipIf(!SWIFTC)('Swift: swiftc -typecheck', HEAVY, () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-swift-'));
    try {
      writeAll(dir, 'swift', i => `c${i}/main.swift`);
      for (let i = 0; i < HOSTILE.length; i++) {
        const r = spawnSync('swiftc', ['-typecheck', join(dir, `c${i}/main.swift`)], { encoding: 'utf8' });
        expect(r.status, `case ${i}: ${r.stderr}`).toBe(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ----------------------------------------------------------------------------------------------------------------------
// The command line, run by bash with functions in the clients' place.

describe.skipIf(!BASH)('HTTPie and wget: bash gives the clients the arguments the tool meant', () => {
  /** Runs the command with functions in the clients' place: their arguments and standard input. */
  const call = (code: string, dir: string): { args: string[]; stdin: Buffer } => {
    const script = `http() { printf '%s\\0' "$@" > .args; cat > .stdin; }\nwget() { printf '%s\\0' "$@" > .args; : > .stdin; }\n${code}`;
    const r = spawnSync(BASH!, ['-c', script], { cwd: dir, encoding: 'buffer', input: '' });
    expect(r.stderr.toString()).toBe('');
    const args = readFileSync(join(dir, '.args'));
    const out: string[] = [];
    for (let at = 0; at < args.length;) {
      const end = args.indexOf(0, at);
      out.push(args.subarray(at, end).toString('utf8'));
      at = end + 1;
    }
    return { args: out, stdin: readFileSync(join(dir, '.stdin')) };
  };
  const after = (args: string[], option: string): string | undefined => args[args.indexOf(option) + 1];

  it('every hostile request', () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-sh-'));
    try {
      mkdirSync(join(dir, 'dir'));
      writeFileSync(join(dir, `dir/it's "q".txt`), 'Q');
      writeFileSync(join(dir, `p'"\\$ é.json`), 'a\r\nb\n');
      writeFileSync(join(dir, 'b.bin'), 'B');
      const [, r0] = HOSTILE[0]!;
      const h = call(generate(r0, 'httpie').text, dir);
      expect(after(h.args, '--auth')).toBe(`${r0.user![0]}:${r0.user![1]}`);
      expect(h.args).toContain(r0.url);
      expect(h.args).toContain('X-Unicode:Jörg Ж 😀');
      expect(h.args).toContain(`X-Plain:${r0.headers[0]![1]}`);
      // The body has a NUL: HTTPie gets it through printf on standard input.
      expect(h.stdin.toString('utf8')).toBe(NASTY);
      const w = call(generate(r0, 'wget').text, dir);
      expect(w.args).toEqual(expect.arrayContaining([r0.url, 'X-Unicode: Jörg Ж 😀', r0.user![0], r0.user![1]]));
      expect(w.args).not.toContain('--body-data');

      const form = call(generate(HOSTILE[3]![1], 'httpie').text, dir).args;
      expect(form).toEqual(expect.arrayContaining([`n'"\\$x=${PRINTABLE}`, `n2@dir/it's "q".txt`, 'n3=again']));
      expect(after(call(generate(HOSTILE[4]![1], 'wget').text, dir).args, '--body-data')).toBe('ab');
      expect(call(generate(HOSTILE[4]![1], 'httpie').text, dir).stdin.toString()).toBe('ab');
      expect(call(generate(HOSTILE[5]![1], 'httpie').text, dir).stdin.toString()).toBe('B');
      expect(after(call(generate(HOSTILE[5]![1], 'wget').text, dir).args, '--body-file')).toBe('b.bin');
      expect([...call(generate(HOSTILE[2]![1], 'httpie').text, dir).stdin]).toEqual([
        1, 0x22, 0x24, 0x27, 0x5c, 0x60, 0x80, 0xff,
      ]);
      const special = call(
        generate(
          base({
            headers: [
              ['X-S', '=a:b;c@d'],
              ['X-E', ''],
            ],
          }),
          'httpie',
        ).text,
        dir,
      ).args;
      expect(special).toEqual(expect.arrayContaining(['X-S:\\=a:b;c@d', 'X-E;']));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('wget gets the bytes of a body that is not UTF-8', () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-sh-'));
    try {
      const script = `wget() { while [ $# -gt 0 ]; do [ "$1" = --body-data ] && printf '%s' "$2"; shift; done; }\n${generate(HOSTILE[2]![1], 'wget').text}`;
      const r = spawnSync(BASH!, ['-c', script], { cwd: dir, encoding: 'buffer' });
      expect([...r.stdout]).toEqual([1, 0x22, 0x24, 0x27, 0x5c, 0x60, 0x80, 0xff]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ----------------------------------------------------------------------------------------------------------------------
// The languages with no runtime here: every literal of every hostile program, read by the spec readers.

const READ: Array<[Language, Target]> = [
  ['kotlin', 'kotlin'],
  ['csharp', 'csharp'],
  ['php', 'php'],
  ['dart', 'dart'],
  ['powershell', 'powershell'],
];

describe('Kotlin, C#, PHP, Dart, PowerShell: every literal of every hostile program reads back (spec readers)', () => {
  it.each(READ)('%s', (language, target) => {
    const [, r0] = HOSTILE[0]!;
    const literals = scan(language, generate(r0, target).text);
    expect(literals).toContain(r0.url);
    expect(literals).toContain(NASTY);
    const joined = literals.join('\n');
    expect(joined).toContain(r0.headers[0]![1]);
    expect(joined).toContain(r0.user![0]);
    expect(joined).toContain(r0.user![1]);
    const form = scan(language, generate(HOSTILE[3]![1], target).text).join('\n');
    expect(form).toContain(`n'"\\$x`);
    expect(form).toContain(PRINTABLE);
    expect(form).toContain(`dir/it's "q".txt`);
    const file = scan(language, generate(HOSTILE[4]![1], target).text);
    expect(file).toContain(`p'"\\$ é.json`);
    for (const [, r] of HOSTILE.slice(1)) expect(() => scan(language, generate(r, target).text)).not.toThrow();
  });
});
