// The generated code sends the request curl sends (docs/tools/specs/curl-to-code.md §10, column «Проверено»): for each
// command of the corpus below, the real curl of this machine sends it through bash to a server of this file on the
// loopback interface, and so does the code the tool writes for it — JavaScript run by Node (`fetch`), Go by `go run`,
// Rust built with reqwest 0.12 by cargo (offline: the crates must already be in cargo's cache). The server compares
// method, path with query, every header the command sets and the body bytes (a form: its fields, without the
// boundary). Python's `requests` is not installed here: its code runs against a stand-in module that records the
// call, and the recorded method, URL, headers, body and auth are compared the same way — the stand-in is not
// requests, so this checks the values the code passes, not requests' own wire format.
//
// Heavy and needs a loopback port, so it runs only on request: CURL_TO_CODE_VERIFY=1 pnpm --filter
// @workspace/tool-logic-curl-to-code test src/verify.test.ts. Only commands written here are given to bash, and only
// addresses on 127.0.0.1 are ever contacted.
import { curlToCode, parseCurl, splitWords } from './index';
import { describe, expect, it } from 'vitest';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Target } from './index';
import type { IncomingMessage, Server } from 'node:http';

const run = promisify(execFile);
/** bash 4.2 or later sends the commands: $'\u2028' needs it (macOS's /bin/bash is 3.2). */
const BASH =
  ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash'].find(path => {
    if (!existsSync(path)) return false;
    const r = spawnSync(path, ['-c', 'printf %s "${BASH_VERSINFO[0]}${BASH_VERSINFO[1]}"'], { encoding: 'utf8' });
    return r.status === 0 && Number(r.stdout) >= 42;
  }) ?? '/bin/bash';
const ON = process.env.CURL_TO_CODE_VERIFY === '1';
const has = (command: string, args: string[]): boolean => {
  try {
    return spawnSync(command, args, { stdio: 'ignore', timeout: 20_000 }).status === 0;
  } catch {
    return false;
  }
};

/** The corpus: `URL` stands for the server's address. Samples that look like tokens are made up for this test. */
const CORPUS: Array<[name: string, command: string]> = [
  ['bare URL', 'curl URL/users'],
  ['POST JSON', `curl -X POST URL/items -H 'Content-Type: application/json' -d '{"name":"pen","qty":2}'`],
  ['two --data', "curl 'URL/items' --data 'a=1' --data 'b=2'"],
  ['-G with --data-urlencode', "curl -G URL/search --data-urlencode 'q=hello world&more' -d lang=en"],
  ['--data-urlencode forms', "curl --data-urlencode 'a b' --data-urlencode '=c&d' --data-urlencode 'e=ü/?' URL/f"],
  ['-u with a colon', "curl -u 'ann:pa:ss' URL/me"],
  ['-F fields', "curl -F name=Ann -F 'note=a b' URL/form"],
  ['--json', `curl --json '{"a":1}' URL/x`],
  [
    'Copy as cURL (bash)',
    `curl 'URL/api' \\\n  -H 'accept: */*' \\\n  -b 'sid=abc; theme=dark' \\\n  --data-raw $'{"text":"line1\\\\nline2 é it\\'s"}'`,
  ],
  ['glued short options', "curl -sSL -XPUT -H'X-Trace: 1' URL/put -d 'x=1'"],
  ['timeout, --compressed', 'curl -m 2.5 --compressed URL/slow'],
  ['a method of its own', 'curl -X PURGE URL/cache'],
  ['non-ASCII body', "curl -d 'name=Jörg 🙂' URL/n"],
  ['empty and removed header', "curl -H 'X-Empty;' -H 'Accept:' URL/h"],
  ['HEAD', 'curl -I URL/'],
  ['-A -e -b -b', "curl -A 'probe' -e https://ref.example/ -b 'a=1' -b 'b=2' URL/c"],
  ['repeated header', "curl -H 'X-A: 1' -H 'x-a: 2' URL/r"],
  ['double-quote escapes', 'curl "URL/q" -H "X-Note: say \\"hi\\" \\$5" -d "v=\\`x\\`"'],
  ['--oauth2-bearer', 'curl --oauth2-bearer abc123 URL/o'],
  ['-u with Authorization', "curl -H 'Authorization: Bearer t0k' -u a:b URL/me"],
  ['-d @file', 'curl -d @body.json URL/upload'],
  ['--data-binary @file', 'curl --data-binary @body.json URL/upload'],
  ['--json @file', 'curl --json @body.json URL/upload'],
  ['-T file', 'curl -T upload.txt URL/up/'],
  ['-F file', "curl -F 'photo=@photo.png' -F n=1 URL/form"],
  ['binary body', "curl --data-binary $'\\x00\\xff\\x80end' URL/bin"],
  ['non-ASCII header', "curl -H 'X-Name: Jörg Ж' URL/h2"],
  [
    'quotes, backslashes, ${, backticks, %, U+2028',
    "curl -H $'X-Q: a\\'b\"c\\\\d ${x} `y` %s' -d $'q\\'\"\\\\${x}`%s\\u2028\\n\\tend' URL/lit",
  ],
  ['non-ASCII credentials', "curl -u 'jörg:pässwörd' URL/me2"],
  ['query as written', "curl 'URL/p?a=1&b=%20x&c=%c3%a9'"],
  ['DELETE', 'curl -X DELETE URL/items/7'],
  ['numbers untouched', `curl --data-raw '{"n":12345678901234567890,"f":1.0,"e":1e400}' URL/num`],
  ['empty part', "curl -d a -d '' URL/sep"],
  ['--json and -d mixed', `curl -d a=1 --json '{"x":1}' -d b=2 URL/mix`],
];

/** "Copy as cURL (cmd)" of a command above: translated from the cmd form, sent by curl from its bash form. */
const CMD_FORM: Array<[name: string, cmd: string, bash: string]> = [
  [
    'Copy as cURL (cmd)',
    'curl ^"URL/api?q=1^&x=2^" ^\n  -H ^"accept: application/json^" ^\n  --data-raw ^"^{^\\^"a^\\^":1^}^"',
    "curl 'URL/api?q=1&x=2' -H 'accept: application/json' --data-raw '{\"a\":1}'",
  ],
];

interface Seen {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body: Buffer;
}

/** The comparable form of a request: method, URL (percent escapes in capitals), the headers set, the body. */
interface Normal {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

const percentCase = (url: string): string => url.replace(/%[0-9a-f]{2}/gi, m => m.toUpperCase());

/** The fields of a multipart body, without the boundary: name, filename, content in hex. */
const multipartFields = (contentType: string, body: Buffer): string => {
  const boundary = /boundary=("?)([^";]+)\1/.exec(contentType)?.[2];
  if (!boundary) return 'no boundary';
  const parts = body.toString('latin1').split(`--${boundary}`).slice(1, -1);
  return JSON.stringify(
    parts.map(p => {
      const [head, ...rest] = p.replace(/^\r\n/, '').split('\r\n\r\n');
      const content = rest.join('\r\n\r\n').replace(/\r\n$/, '');
      const name = /name="([^"]*)"/.exec(head!)?.[1];
      const filename = /filename="([^"]*)"/.exec(head!)?.[1] ?? null;
      return [name, filename, Buffer.from(content, 'latin1').toString('hex')];
    }),
  );
};

/** Headers every client sets by itself: compared only when the command sets them. */
const OWN = new Set([
  'host',
  'user-agent',
  'accept',
  'accept-encoding',
  'accept-language',
  'content-length',
  'connection',
  'sec-fetch-mode',
  'transfer-encoding',
]);

const normal = (seen: Seen, set: Set<string>): Normal => {
  const headers: Record<string, string> = {};
  let contentType = '';
  for (const [name, value] of seen.headers) {
    const n = name.toLowerCase();
    if (n === 'content-type') contentType = value;
    if (OWN.has(n) && !set.has(n)) continue;
    headers[n] = n in headers ? headers[n] + (n === 'cookie' ? ';' : ', ') + value : value;
  }
  const multipart = contentType.startsWith('multipart/form-data');
  if (multipart) headers['content-type'] = 'multipart/form-data';
  // Header order is not part of the request (Go sends them sorted by name).
  const sorted = Object.fromEntries(Object.entries(headers).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    method: seen.method,
    url: percentCase(seen.url),
    headers: sorted,
    body: multipart ? multipartFields(contentType, seen.body) : seen.body.toString('hex'),
  };
};

const startServer = async (): Promise<{ server: Server; port: number; take: () => Seen[] }> => {
  let seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = req.rawHeaders;
      const headers: Array<[string, string]> = [];
      for (let i = 0; i < raw.length; i += 2) headers.push([raw[i]!, raw[i + 1]!]);
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers, body: Buffer.concat(chunks) });
      res.end('ok');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    server,
    port,
    take: () => {
      const out = seen;
      seen = [];
      return out;
    },
  };
};

/** The headers a command sets (lower case), from the tool's own request model. */
const setBy = (command: string): Set<string> => {
  const words = splitWords(command);
  if (!words.ok) throw new Error(words.message);
  const parsed = parseCurl(words.words);
  if (!parsed.ok) throw new Error(parsed.message);
  return new Set(parsed.request.headers.map(([n]) => n.toLowerCase()));
};

const PY_STANDIN = `# A stand-in for requests: records the call as JSON on stdout, sends nothing.
import base64, json

def _bytes(v):
    return v if isinstance(v, bytes) else v.encode('latin-1')

def _call(method, url, headers=None, data=None, files=None, auth=None, timeout=None, verify=True):
    hs = [[k, _bytes(v).decode('latin-1')] for k, v in (headers or {}).items()]
    if auth is not None:
        u, p = (_bytes(x) for x in auth)
        hs.append(['Authorization', 'Basic ' + base64.b64encode(u + b':' + p).decode()])
    body = b'' if data is None else _bytes(data)
    fields = None
    if files is not None:
        items = files.items() if isinstance(files, dict) else files
        fields = []
        for name, (filename, value) in items:
            content = value.read() if hasattr(value, 'read') else value.encode('utf-8')
            fields.append([name, filename, content.hex()])
    print(json.dumps({'method': method, 'url': url, 'headers': hs, 'body': body.hex(), 'fields': fields,
                      'timeout': timeout, 'verify': verify}))
    class Response:
        text = ''
    return Response()

def get(url, **kw): return _call('GET', url, **kw)
def post(url, **kw): return _call('POST', url, **kw)
def put(url, **kw): return _call('PUT', url, **kw)
def patch(url, **kw): return _call('PATCH', url, **kw)
def delete(url, **kw): return _call('DELETE', url, **kw)
def head(url, **kw): return _call('HEAD', url, **kw)
def options(url, **kw): return _call('OPTIONS', url, **kw)
def request(method, url, **kw): return _call(method, url, **kw)
`;

const CARGO = `[package]
name = "verify"
version = "0.1.0"
edition = "2021"

[dependencies]
reqwest = { version = "0.12", features = ["blocking", "multipart"] }

[workspace]
`;

const HEAVY = { timeout: 600_000 };

describe.skipIf(!ON)('the code sends what curl sends', () => {
  it('in every client, for every command of the corpus', HEAVY, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-verify-'));
    const { server, port, take } = await startServer();
    const base = `http://127.0.0.1:${port}`;
    const results: Array<{ name: string; target: string; ok: boolean; detail?: string }> = [];
    try {
      writeFileSync(join(dir, 'body.json'), '{"a":1,\r\n"b":2}\n');
      writeFileSync(join(dir, 'upload.txt'), 'line 1\r\nline 2\n');
      writeFileSync(join(dir, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2]));
      writeFileSync(join(dir, 'requests.py'), PY_STANDIN);
      const go = has('go', ['version']);
      const cargo = has('cargo', ['--version']);
      const rustDir = process.env.CURL_TO_CODE_CARGO_DIR ?? join(tmpdir(), 'curl-to-code-verify-rust');
      const cases = [
        ...CORPUS.map(([name, command]) => ({ name, translate: command, send: command })),
        ...CMD_FORM.map(([name, cmd, bash]) => ({ name, translate: cmd, send: bash })),
      ].map(c => ({ ...c, translate: c.translate.replaceAll('URL', base), send: c.send.replaceAll('URL', base) }));

      // Rust: one binary per case, built at once.
      if (cargo) {
        mkdirSync(join(rustDir, 'src/bin'), { recursive: true });
        writeFileSync(join(rustDir, 'Cargo.toml'), CARGO);
        writeFileSync(join(rustDir, 'src/main.rs'), 'fn main() {}\n');
        cases.forEach((c, i) => {
          const r = curlToCode(c.translate, 'rust');
          if (r.ok) writeFileSync(join(rustDir, `src/bin/case${i}.rs`), r.text);
        });
        const built = spawnSync('cargo', ['build', '--offline', '--bins', '--quiet'], {
          cwd: rustDir,
          encoding: 'utf8',
          env: { ...process.env, CARGO_TARGET_DIR: join(rustDir, 'target') },
        });
        expect(built.stderr, 'cargo build').toBe('');
      }

      for (const [i, c] of cases.entries()) {
        const set = setBy(c.translate);
        take();
        await run(BASH, ['-c', c.send], { cwd: dir, timeout: 20_000 }).catch(e => e);
        const fromCurl = take();
        if (fromCurl.length !== 1) {
          results.push({ name: c.name, target: 'curl', ok: false, detail: `${fromCurl.length} requests` });
          continue;
        }
        const want = normal(fromCurl[0]!, set);
        const compare = (target: string, got: Normal | undefined, error?: string): void => {
          const ok = got !== undefined && JSON.stringify(got) === JSON.stringify(want);
          results.push({ name: c.name, target, ok, ...(ok ? {} : { detail: error ?? JSON.stringify({ got, want }) }) });
        };
        const code = (target: Target): string => {
          const r = curlToCode(c.translate, target);
          if (!r.ok) throw new Error(`${c.name}: ${r.error.message}`);
          return r.text;
        };

        // JavaScript in Node.
        writeFileSync(join(dir, `case${i}.mjs`), code('javascript'));
        const js = await run('node', [`case${i}.mjs`], { cwd: dir, timeout: 20_000 }).catch((e: Error) => e);
        const jsSeen = take();
        compare('javascript', jsSeen[0] && normal(jsSeen[0], set), js instanceof Error ? js.message : undefined);

        // Go.
        if (go) {
          const goDir = join(dir, `go${i}`);
          mkdirSync(goDir);
          writeFileSync(join(goDir, 'main.go'), code('go'));
          const out = await run('go', ['run', join(goDir, 'main.go')], {
            cwd: dir,
            timeout: 120_000,
            env: { ...process.env, GO111MODULE: 'off' },
          }).catch((e: Error) => e);
          const goSeen = take();
          compare('go', goSeen[0] && normal(goSeen[0], set), out instanceof Error ? out.message : undefined);
        }

        // Rust.
        if (cargo) {
          const out = await run(join(rustDir, 'target/debug', `case${i}`), [], { cwd: dir, timeout: 30_000 }).catch(
            (e: Error) => e,
          );
          const rustSeen = take();
          compare('rust', rustSeen[0] && normal(rustSeen[0], set), out instanceof Error ? out.message : undefined);
        }

        // Python, against the stand-in.
        writeFileSync(join(dir, `case${i}.py`), code('python'));
        const py = await run('python3', ['-E', '-s', `case${i}.py`], { cwd: dir, timeout: 20_000 }).catch(
          (e: Error) => e,
        );
        if (py instanceof Error) compare('python (stand-in)', undefined, py.message);
        else {
          const call = JSON.parse(py.stdout) as {
            method: string;
            url: string;
            headers: Array<[string, string]>;
            body: string;
            fields: Array<[string, string | null, string]> | null;
          };
          const u = new URL(call.url);
          const seen: Seen = {
            method: call.method,
            url: `${u.pathname}${u.search}`,
            headers: call.headers,
            body: Buffer.from(call.body, 'hex'),
          };
          const got = normal(seen, set);
          if (call.fields) {
            got.headers = Object.fromEntries(
              Object.entries({ ...got.headers, 'content-type': 'multipart/form-data' }).sort(([a], [b]) =>
                a < b ? -1 : 1,
              ),
            );
            got.body = JSON.stringify(call.fields);
          }
          compare('python (stand-in)', got);
        }
      }
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
    const out = process.env.CURL_TO_CODE_VERIFY_OUT;
    if (out) writeFileSync(out, JSON.stringify(results, null, 2));
    const failed = results.filter(r => !r.ok);
    expect(failed).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});
