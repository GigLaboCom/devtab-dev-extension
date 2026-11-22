// The four generators (docs/tools/specs/curl-to-code.md §5, «Код»): one contract every generator passes, and hostile
// requests — every string of them (address, method, header value, body, credentials, form names and values, file
// paths) full of quotes, backslashes, line breaks, `${`, backticks, `%`, NUL, non-ASCII, U+2028, a bidi control — whose
// code is then read by the language: JavaScript is run in node:vm with a stand-in fetch that records its arguments,
// Python against a stand-in requests module (`python3`, when present), Go by `gofmt -l` and `go vet` (compiled, never
// run: nothing here is sent anywhere). Sending real requests, Rust included, is verify.test.ts, on loopback only.
import { GENERATORS, generate } from './generate';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type { CurlRequest, Target } from './types';

const HEAVY = { timeout: 120_000 };
const has = (command: string, args: string[]): boolean => {
  try {
    return spawnSync(command, args, { stdio: 'ignore', timeout: 20_000 }).status === 0;
  } catch {
    return false;
  }
};
const PYTHON = has('python3', ['--version']);
const GO = has('go', ['version']);

const NASTY = 'a\'b"c\\d ${x} `y` %s %% \n\r\t\u0000\u0007\u007f\u0085 é Ж 😀 \u{2028}\u{2029} \u{202e}end';

const base = (over: Partial<CurlRequest> = {}): CurlRequest => ({
  method: 'GET',
  url: 'https://a.example/x',
  headers: [],
  body: null,
  user: null,
  insecure: false,
  timeoutSeconds: null,
  ...over,
});

/** Requests that between them use every kind of string a generator writes. */
const HOSTILE: Array<[string, CurlRequest]> = [
  [
    'raw body, headers, credentials',
    base({
      method: 'POST',
      url: `https://a.example/p?q=${encodeURIComponent(NASTY)}&r='"\\\`\${}`,
      headers: [
        ['X-Plain', NASTY.replace(/[^\x20-\x7e]/g, '')],
        ['X-Unicode', 'Jörg Ж 😀'],
        ['Content-Type', 'text/plain'],
      ],
      body: { kind: 'raw', text: NASTY },
      user: [`u'"\\\${}\``, `p:${NASTY}`],
      timeoutSeconds: 1.5,
      insecure: true,
    }),
  ],
  ['a method of its own', base({ method: 'PURGE"\\\'', headers: [['Host', 'h.example']] })],
  ['binary', base({ method: 'PUT', body: { kind: 'binary', bytes: Uint8Array.of(0, 0x22, 0x27, 0x5c, 0x80, 0xff) } })],
  [
    'multipart',
    base({
      method: 'POST',
      body: {
        kind: 'multipart',
        fields: [
          { name: `n'"\\`, value: NASTY },
          { name: 'n2', file: `dir/it's "q".txt`, filename: `it's "q".txt` },
          { name: `n'"\\`, value: 'again' },
        ],
      },
      timeoutSeconds: 3,
    }),
  ],
  ['a file, stripped', base({ method: 'POST', body: { kind: 'file', path: `p'"\\ é.json`, strip: true } })],
  ['a file', base({ method: 'POST', body: { kind: 'file', path: 'b.bin', strip: false } })],
];

const TARGETS = Object.keys(GENERATORS) as Target[];

describe('the generators’ contract', () => {
  it.each(TARGETS)('%s: a program that ends with a line break, the same for the same request', target => {
    for (const [, request] of HOSTILE) {
      const a = generate(request, target);
      expect(a.text.endsWith('\n')).toBe(true);
      expect(a.text.endsWith('\n\n')).toBe(false);
      expect(generate(request, target)).toEqual(a);
      expect(Array.isArray(a.warnings)).toBe(true);
    }
  });
  it.each(TARGETS)('%s: a plain GET has no warnings', target => {
    expect(generate(base(), target).warnings).toEqual([]);
  });
  it('JavaScript: GET or HEAD with a body leaves the body out, with a warning', () => {
    const g = generate(base({ body: { kind: 'raw', text: 'x' } }), 'javascript');
    expect(g.text).not.toContain('body:');
    expect(g.warnings).toEqual(['fetch cannot send a body with GET; the body is left out.']);
  });
  it('JavaScript: the forbidden request headers of the Fetch Standard are named', () => {
    const g = generate(
      base({
        headers: [
          ['Sec-Fetch-Site', 'x'],
          ['Proxy-Thing', 'y'],
          ['DNT', '1'],
          ['X-Ok', 'z'],
        ],
      }),
      'javascript',
    );
    expect(g.warnings).toEqual([
      'A browser does not let fetch set the Sec-Fetch-Site header (Node does).',
      'A browser does not let fetch set the Proxy-Thing header (Node does).',
      'A browser does not let fetch set the DNT header (Node does).',
    ]);
  });
  it('Python: a repeated form name is written as a list of pairs', () => {
    expect(generate(HOSTILE[3]![1], 'python').text).toContain('files = [\n');
  });
  it('Go and Rust: whole seconds and milliseconds', () => {
    expect(generate(base({ timeoutSeconds: 3 }), 'go').text).toContain('Timeout: 3 * time.Second,');
    expect(generate(base({ timeoutSeconds: 0.0001 }), 'go').text).toContain('Timeout: 1 * time.Millisecond,');
    expect(generate(base({ timeoutSeconds: 3 }), 'rust').text).toContain('.timeout(Duration::from_secs(3))');
    expect(generate(base({ timeoutSeconds: 0.25 }), 'javascript').text).toContain('AbortSignal.timeout(250)');
  });
  it('Go: Host is req.Host', () => {
    expect(generate(base({ headers: [['host', 'h.example']] }), 'go').text).toContain('\treq.Host = "h.example"');
  });
});

// ----------------------------------------------------------------------------------------------------------------------

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: boolean;
}

/** Runs generated JavaScript with a fetch that records its call; readFile answers with the path's bytes. */
const runJs = async (code: string): Promise<Recorded> => {
  let recorded: Recorded | undefined;
  const source = `(async () => {\n${code.replace(/^import .*\n/m, '')}\n})()`;
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
    FormData,
    Blob,
    Uint8Array,
    AbortSignal,
  });
  return recorded!;
};

const utf8 = (s: string): string => Buffer.from(s, 'utf8').toString('latin1');

describe('JavaScript reads back every string (node:vm, a stand-in fetch)', () => {
  it('raw body, headers, credentials', async () => {
    const [, r] = HOSTILE[0]!;
    const got = await runJs(generate(r, 'javascript').text);
    expect(got.url).toBe(r.url);
    expect(got.method).toBe('POST');
    expect(got.body).toBe(NASTY);
    expect(got.signal).toBe(true);
    // fetch sends a header's characters as bytes: the UTF-8 bytes as Latin-1 characters.
    expect(got.headers).toEqual({
      'X-Plain': r.headers[0]![1],
      'X-Unicode': utf8('Jörg Ж 😀'),
      'Content-Type': 'text/plain',
      Authorization: `Basic ${Buffer.from(`${r.user![0]}:${r.user![1]}`, 'utf8').toString('base64')}`,
    });
  });
  it('a method of its own, binary, multipart, files', async () => {
    expect((await runJs(generate(HOSTILE[1]![1], 'javascript').text)).method).toBe('PURGE"\\\'');
    expect(Array.from((await runJs(generate(HOSTILE[2]![1], 'javascript').text)).body as Uint8Array)).toEqual([
      0, 0x22, 0x27, 0x5c, 0x80, 0xff,
    ]);
    const form = (await runJs(generate(HOSTILE[3]![1], 'javascript').text)).body as FormData;
    const entries = [...form.entries()];
    expect(entries.map(([k]) => k)).toEqual([`n'"\\`, 'n2', `n'"\\`]);
    expect(entries[0]![1]).toBe(NASTY);
    expect((entries[1]![1] as File).name).toBe(`it's "q".txt`);
    expect(await (entries[1]![1] as File).text()).toBe(`file:dir/it's "q".txt\r\n`);
    const stripped = (await runJs(generate(HOSTILE[4]![1], 'javascript').text)).body as Uint8Array;
    expect(Buffer.from(stripped).toString('utf8')).toBe(`file:p'"\\ é.json`);
    const whole = (await runJs(generate(HOSTILE[5]![1], 'javascript').text)).body as Uint8Array;
    expect(Buffer.from(whole).toString('utf8')).toBe('file:b.bin\r\n');
  });
});

const PY_STANDIN = `import base64, json
def _b(v):
    return v if isinstance(v, bytes) else v.encode('latin-1')
def _call(method, url, headers=None, data=None, files=None, auth=None, timeout=None, verify=True):
    out = {'method': method, 'url': url, 'headers': {k: _b(v).hex() for k, v in (headers or {}).items()},
           'data': None if data is None else _b(data).hex(), 'timeout': timeout, 'verify': verify,
           'auth': None if auth is None else [_b(x).hex() for x in auth], 'files': None}
    if files is not None:
        items = files.items() if isinstance(files, dict) else files
        out['files'] = [[k, f, v.read().hex() if hasattr(v, 'read') else v.encode('utf-8').hex()] for k, (f, v) in items]
    print(json.dumps(out))
    class R:
        text = ''
    return R()
def get(url, **kw): return _call('GET', url, **kw)
def post(url, **kw): return _call('POST', url, **kw)
def put(url, **kw): return _call('PUT', url, **kw)
def request(method, url, **kw): return _call(method, url, **kw)
`;

const hex = (s: string): string => Buffer.from(s, 'utf8').toString('hex');

describe.skipIf(!PYTHON)('Python reads back every string (a stand-in requests module)', () => {
  it('every hostile request', HEAVY, () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-py-'));
    try {
      writeFileSync(join(dir, 'requests.py'), PY_STANDIN);
      mkdirSync(join(dir, 'dir'));
      writeFileSync(join(dir, `dir/it's "q".txt`), 'Q\r\n');
      writeFileSync(join(dir, `p'"\\ é.json`), 'a\r\nb\n');
      writeFileSync(join(dir, 'b.bin'), Buffer.from([0, 0xff, 0x0d, 0x0a]));
      const calls = HOSTILE.map(([, r], i) => {
        writeFileSync(join(dir, `c${i}.py`), generate(r, 'python').text);
        const out = spawnSync('python3', ['-E', '-s', `c${i}.py`], { cwd: dir, encoding: 'utf8' });
        expect(out.stderr).toBe('');
        return JSON.parse(out.stdout);
      });
      const [r0] = [HOSTILE[0]![1]];
      expect(calls[0]).toEqual({
        method: 'POST',
        url: r0.url,
        headers: Object.fromEntries(r0.headers.map(([n, v]) => [n, hex(v)])),
        data: hex(NASTY),
        timeout: 1.5,
        verify: false,
        auth: [hex(r0.user![0]), hex(r0.user![1])],
        files: null,
      });
      expect(calls[1].method).toBe('PURGE"\\\'');
      expect(calls[2].data).toBe('0022275c80ff');
      expect(calls[3].files).toEqual([
        [`n'"\\`, null, hex(NASTY)],
        ['n2', `it's "q".txt`, hex('Q\r\n')],
        [`n'"\\`, null, hex('again')],
      ]);
      expect(calls[4].data).toBe(hex('ab'));
      expect(calls[5].data).toBe('00ff0d0a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!GO)('Go compiles every hostile request, gofmt-clean (go vet; never run)', () => {
  it('every hostile request', HEAVY, () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-go-'));
    try {
      HOSTILE.forEach(([, r], i) => {
        mkdirSync(join(dir, `c${i}`));
        writeFileSync(join(dir, `c${i}/main.go`), generate(r, 'go').text);
      });
      writeFileSync(join(dir, 'go.mod'), 'module verify\n\ngo 1.21\n');
      expect(spawnSync('gofmt', ['-l', '.'], { cwd: dir, encoding: 'utf8' }).stdout).toBe('');
      const vet = spawnSync('go', ['vet', './...'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, GOFLAGS: '-mod=mod' },
      });
      expect(vet.stderr).toBe('');
      expect(vet.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
