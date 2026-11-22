// The generated code sends the request curl sends (docs/tools/specs/curl-to-code.md §10, column «Проверено», and §15):
// for each command of the corpus below, the real curl of this machine sends it through bash to a server of this file on
// the loopback interface, and so does the code the tool writes for it, in every client the machine can run:
//   JavaScript fetch and Node fetch (Node), Python http.client (python3), Go (`go run`), Rust (reqwest 0.12 built by cargo
//   offline: its crates must already be in cargo's cache), Java (a JDK 11+, `java Main.java`), Ruby, Swift (`swift`),
//   wget.
// Three clients need a library the machine does not have; their code runs against a stand-in that records the call and
// imitates what the library does to it, as its documentation and sources describe (cited in each stand-in) — this
// checks the values the code passes and the shell quoting, not the library's own wire format:
//   Python requests, Node axios, HTTPie.
// PHP, C#, Kotlin, Dart and PowerShell are not run at all (no runtime here): their literals are read by readers written
// from the specifications (literals.test.ts, clients.test.ts).
//
// The server compares method, path with query, every header the command sets and the body bytes (a form: its fields,
// without the boundary). A client may differ from curl only where the tool's warning for it says so (a header left out,
// a Content-Type it adds, a body it cannot send, a method it writes in capitals, an option it cannot express): those
// differences are taken out of the comparison by reading the warnings, never by a list here. Also checked: with `-L`
// the client follows the redirect, with `-k` it reaches a server whose certificate it cannot check, with
// `--compressed` it asks for a compressed response — unless its warning says it cannot.
//
// Heavy and needs loopback ports, so it runs only on request: CURL_TO_CODE_VERIFY=1 pnpm --filter
// @workspace/tool-logic-curl-to-code test src/verify.test.ts (CURL_TO_CODE_VERIFY_OUT=<file> writes the results).
// Only commands written here are given to bash, and only addresses on 127.0.0.1 are ever contacted.
import { parseCurl, splitWords } from './index';
import { convert, ready } from './testing';
import { beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createTlsServer } from 'node:tls';
import type { Target } from './index';
import type { Server, Socket } from 'node:net';

/** Runs a program with standard input closed; its standard output, or why it failed. */
const run = (
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', status => {
      const stdout = Buffer.concat(out).toString('utf8');
      if (status === 0) resolve({ stdout });
      else reject(new Error(`${file} exited ${status}: ${Buffer.concat(err).toString('utf8')}`));
    });
  });
/** bash 4.2 or later sends the commands: a Unicode escape in $'…' needs it (macOS's /bin/bash is 3.2). */
const BASH =
  ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash'].find(path => {
    if (!existsSync(path)) return false;
    const r = spawnSync(path, ['-c', 'printf %s "${BASH_VERSINFO[0]}${BASH_VERSINFO[1]}"'], { encoding: 'utf8' });
    return r.status === 0 && Number(r.stdout) >= 42;
  }) ?? '/bin/bash';
const ON = process.env.CURL_TO_CODE_VERIFY === '1';
const has = (command: string, args: string[]): boolean => {
  try {
    return spawnSync(command, args, { stdio: 'ignore', timeout: 30_000 }).status === 0;
  } catch {
    return false;
  }
};
const JAVA = [
  process.env.JAVA_HOME && join(process.env.JAVA_HOME, 'bin/java'),
  '/opt/homebrew/opt/openjdk/bin/java',
  '/usr/local/opt/openjdk/bin/java',
  'java',
].find((j): j is string => !!j && (j === 'java' || existsSync(j)) && has(j, ['-version']));

/** The corpus: `URL` stands for the server's address, `TLS` for its address over TLS. Token-like samples are made up. */
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
  // Added with the clients of 2026-11-22.
  ['follows a redirect with -L', 'curl -L URL/hop'],
  ['-k over TLS', 'curl -k TLS/secure'],
  ['Host header', "curl -H 'Host: h.example' URL/host"],
  ["Firefox's Connection and TE", "curl -H 'Connection: keep-alive' -H 'TE: trailers' URL/ff"],
  ['GET with a body', "curl -X GET -d 'x=1' URL/getbody"],
  ['a method in small letters', 'curl -X purge URL/lower'],
  ['a standard method in small letters', "curl -X post -d 'a=1' URL/lowpost"],
  [
    'hostile credentials and form',
    "curl -u $'u\\'\"\\\\$x:p\\'\"\\\\`$(x)%s' -F $'n\\'\"\\\\${x}=v\\'\"\\\\`%s\\u2028' -F $'f=@photo.png' URL/hostile",
  ],
  ['a JSON body with spaces around it', `curl -H 'Content-Type: application/json' --data-raw ' {"a":1} ' URL/sp`],
  ['a body that only looks like JSON', `curl -H 'Content-Type: application/json' --data-raw 'not json' URL/nj`],
  ['a POST body without Content-Type', 'curl -X POST -T upload.txt URL/post-file'],
  ['a URL that is not ASCII', "curl 'URL/é?q=ü'"],
  ['form names that are not ASCII', "curl -F 'имя=значение' -F 'файл=@photo.png' URL/ru"],
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

/**
 * Headers a client sets by itself: compared only when the command sets them. `upgrade` and `http2-settings` are Java's
 * offer of HTTP/2 over a plain connection (h2c), which a server may ignore.
 */
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
  'upgrade',
  'http2-settings',
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
  return {
    method: seen.method,
    url: percentCase(seen.url),
    headers,
    body: multipart ? multipartFields(contentType, seen.body) : seen.body.toString('hex'),
  };
};

const sorted = (n: Normal): Normal => ({
  ...n,
  headers: Object.fromEntries(Object.entries(n.headers).sort(([a], [b]) => (a < b ? -1 : 1))),
});

// ----------------------------------------------------------------------------------------------------------------------
// The server: HTTP/1.1 read by hand over net and tls, so any method reaches it as written (Node's own HTTP parser
// refuses methods it does not know or in small letters). One request per connection; `/hop` redirects to `/landed`.

interface Recorder {
  plain: Server;
  tls: Server;
  port: number;
  tlsPort: number;
  take: () => Seen[];
}

const handle =
  (record: (s: Seen) => void) =>
  (socket: Socket): void => {
    let buf = Buffer.alloc(0);
    let done = false;
    socket.on('error', () => {});
    socket.on('data', chunk => {
      if (done) return;
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const lines = buf.subarray(0, end).toString('latin1').split('\r\n');
      const [method = '', url = ''] = lines[0]!.split(' ');
      const headers = lines.slice(1).map(l => {
        const colon = l.indexOf(':');
        return [l.slice(0, colon), l.slice(colon + 1).trim()] as [string, string];
      });
      const get = (n: string): string | undefined => headers.find(([k]) => k.toLowerCase() === n)?.[1];
      if (get('expect')?.toLowerCase() === '100-continue' && buf.length === end + 4)
        socket.write('HTTP/1.1 100 Continue\r\n\r\n');
      let rest = buf.subarray(end + 4);
      let body: Buffer;
      if (get('transfer-encoding')?.toLowerCase().includes('chunked')) {
        const out: Buffer[] = [];
        let at = 0;
        for (;;) {
          const nl = rest.indexOf('\r\n', at);
          if (nl < 0) return;
          const size = parseInt(rest.subarray(at, nl).toString('latin1'), 16);
          if (size === 0) {
            if (rest.length < nl + 4) return;
            break;
          }
          if (rest.length < nl + 2 + size + 2) return;
          out.push(rest.subarray(nl + 2, nl + 2 + size));
          at = nl + 2 + size + 2;
        }
        body = Buffer.concat(out);
      } else {
        const length = Number(get('content-length') ?? 0);
        if (rest.length < length) return;
        body = rest.subarray(0, length);
      }
      rest = Buffer.alloc(0);
      done = true;
      record({ method, url, headers, body });
      socket.end(
        url === '/hop'
          ? 'HTTP/1.1 302 Found\r\nLocation: /landed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'
          : 'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok',
      );
    });
  };

const listen = (server: Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve(typeof a === 'object' && a ? a.port : 0);
    });
  });

const startServers = async (dir: string): Promise<Recorder> => {
  let seen: Seen[] = [];
  const record = (s: Seen): void => void seen.push(s);
  // A certificate for 127.0.0.1 that no client trusts: made here with openssl, thrown away with the folder.
  const made = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { encoding: 'utf8' },
  );
  if (made.status !== 0) throw new Error(made.stderr);
  const plain = createNetServer(handle(record));
  const tls = createTlsServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')), ALPNProtocols: ['http/1.1'] },
    handle(record),
  );
  const [port, tlsPort] = [await listen(plain), await listen(tls)];
  return {
    plain,
    tls,
    port,
    tlsPort,
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

// ----------------------------------------------------------------------------------------------------------------------
// What the warnings allow to differ. Each pattern is a warning the writers emit (clients/common.ts and the writers).

interface Allowed {
  headers: Set<string>;
  addedType: boolean;
  noBody: boolean;
  capitals: boolean;
  noForm: boolean;
  noTls: boolean;
  noRedirects: boolean;
  noDecompress: boolean;
  /** Form fields may come in another order. */
  formOrder: boolean;
  /** Form names may be written otherwise. */
  formNames: boolean;
  /** The query's characters beyond ASCII may be percent-encoded. */
  query: boolean;
}

const allowedBy = (warnings: string[]): Allowed => {
  const a: Allowed = {
    headers: new Set(),
    addedType: false,
    noBody: false,
    capitals: false,
    noForm: false,
    noTls: false,
    noRedirects: false,
    noDecompress: false,
    formOrder: false,
    formNames: false,
    query: false,
  };
  for (const w of warnings) {
    const header = /^The (\S+) header: .*; left out\.$/.exec(w);
    if (header) a.headers.add(header[1]!.toLowerCase());
    if (/^A browser does not let fetch set the (\S+) header/.test(w))
      a.headers.add(/set the (\S+) header/.exec(w)![1]!.toLowerCase());
    if (/adds Content-Type: application\/x-www-form-urlencoded to a body without one\.$/.test(w)) a.addedType = true;
    if (/cannot send a body with (GET|HEAD); the body is left out\.$/.test(w)) a.noBody = true;
    if (/sends the method in capitals: /.test(w)) a.capitals = true;
    if (/cannot send a multipart form/.test(w)) a.noForm = true;
    if (/^-k: .* cannot skip certificate checks/.test(w)) a.noTls = true;
    if (/^-L: .* (does not follow redirects|follows redirects of GET and HEAD only)/.test(w)) a.noRedirects = true;
    if (/^--compressed: .* does not decompress/.test(w)) a.noDecompress = true;
    if (/the order differs\.$/.test(w)) a.formOrder = true;
    if (/writes this form name or file name otherwise than curl/.test(w)) a.formNames = true;
    if (/^The URL's query has characters that are not ASCII/.test(w)) a.query = true;
  }
  return a;
};

const applyAllowed = (want: Normal, got: Normal, a: Allowed): [Normal, Normal] => {
  const w = structuredClone(want);
  const g = structuredClone(got);
  for (const h of a.headers) {
    delete w.headers[h];
    delete g.headers[h];
  }
  if (a.addedType && !('content-type' in w.headers)) delete g.headers['content-type'];
  if (a.noBody) w.body = '';
  if (a.capitals) w.method = w.method.toUpperCase();
  // The server reads the request line as Latin-1: UTF-8 bytes are characters 0x80–0xFF.
  if (a.query) w.url = w.url.replace(/[\x80-\xff]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const fields = (n: Normal): void => {
    if (n.headers['content-type'] !== 'multipart/form-data') return;
    let parsed = JSON.parse(n.body) as Array<[string | null, string | null, string]>;
    if (a.formNames) parsed = parsed.map(([, f, c]) => [null, f === null ? null : '', c]);
    if (a.formOrder) parsed = parsed.sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));
    n.body = JSON.stringify(parsed);
  };
  if (a.formNames || a.formOrder) {
    fields(w);
    fields(g);
  }
  if (a.noForm) {
    w.body = '';
    delete w.headers['content-type'];
    delete g.headers['content-type'];
  }
  return [sorted(w), sorted(g)];
};

// ----------------------------------------------------------------------------------------------------------------------
// Stand-ins.

const PY_REQUESTS = `# A stand-in for requests: records the call as JSON on stdout, sends nothing. As requests does
# (requests/models.py, PreparedRequest): the method in capitals, str headers and auth in Latin-1, bytes as they are.
import base64, json

def _bytes(v):
    return v if isinstance(v, bytes) else v.encode('latin-1')

# urllib3 2.x, fields.format_multipart_header_param: the HTML5 way, as curl.
def _html5(s):
    return s.translate({10: '%0A', 13: '%0D', 34: '%22'})

def _call(method, url, headers=None, data=None, files=None, auth=None, timeout=None, verify=True, allow_redirects=True):
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
            fields.append([_html5(name), None if filename is None else _html5(filename), content.hex()])
    print(json.dumps({'method': method.upper(), 'url': url, 'headers': hs, 'body': body.hex(), 'fields': fields}))
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

/**
 * A stand-in for axios 1.x: records the call as JSON on stdout, sends nothing. It does to the config what axios does
 * (lib/core/dispatchRequest.js, lib/defaults/index.js `transformRequest`, lib/adapters/http.js): the method in
 * capitals; a string body with a JSON Content-Type parsed and sent trimmed, or JSON-encoded when it is not JSON; a
 * PUT, POST or PATCH without a Content-Type gets application/x-www-form-urlencoded; `auth` becomes Basic of the UTF-8
 * of user:password (Node's http `auth`); header values are sent as Latin-1 bytes (Node's http).
 */
const AXIOS = `export default async function axios(config) {
  const method = (config.method ?? 'get').toUpperCase();
  const headers = Object.entries(config.headers ?? {});
  const type = headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] ?? '';
  let data = config.data;
  let body = Buffer.alloc(0);
  let fields = null;
  if (typeof data === 'string' && type.includes('application/json')) {
    try { JSON.parse(data); data = data.trim(); } catch { data = JSON.stringify(data); }
  }
  // lib/helpers/formDataToStream.js escapeName: CR, LF and " as %0D, %0A, %22.
  const escapeName = s => s.replace(/[\\r\\n"]/g, m => ({ '\\r': '%0D', '\\n': '%0A', '"': '%22' })[m]);
  if (data instanceof FormData) {
    fields = [];
    for (const [k, v] of data.entries())
      fields.push([escapeName(k), typeof v === 'string' ? null : escapeName(v.name), Buffer.from(typeof v === 'string' ? v : new Uint8Array(await v.arrayBuffer())).toString('hex')]);
  } else if (typeof data === 'string') body = Buffer.from(data, 'utf8');
  else if (data !== undefined) body = Buffer.from(data);
  if (data !== undefined && !type && ['POST', 'PUT', 'PATCH'].includes(method))
    headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  if (config.auth) headers.push(['Authorization', 'Basic ' + Buffer.from(config.auth.username + ':' + config.auth.password).toString('base64')]);
  console.log(JSON.stringify({ method, url: config.url, headers: headers.map(([k, v]) => [k, Buffer.from(String(v), 'latin1').toString('latin1')]), body: body.toString('hex'), fields }));
  return { data: '' };
}
`;

/**
 * A stand-in for HTTPie 3 (\`http\`): records the request it would send as JSON on stdout, sends nothing. It reads its
 * arguments as HTTPie does (httpie/cli/argtypes.py \`KeyValueArgType\`: tokens, escapes, the first and longest
 * separator; httpie/cli/definition.py for the options), with the subset of options the tool writes: the method in
 * capitals; \`Name:value\`, \`Name;\` (empty), \`Name:\` (unset); \`name=value\` and \`name@path\` with --multipart (text
 * fields first, then files: httpie/uploads.py); the body from --raw or standard input, whose default Content-Type is
 * application/json (httpie/client.py \`make_default_headers\`); --auth as Basic of UTF-8
 * (httpie/plugins/builtin.py).
 */
const HTTPIE = `#!/usr/bin/env python3
import base64, json, os, sys
SEPS = sorted([':', ';', ':@', '==', '=', ':=', '@', '=@', ':=@'], key=len)
SPECIAL = set(''.join(SEPS))

class Escaped(str):
    pass

def tokenize(s):
    tokens = ['']
    chars = iter(s)
    for c in chars:
        if c == '\\\\':
            c = next(chars, '')
            if c not in SPECIAL:
                tokens[-1] += '\\\\' + c
            else:
                tokens.extend([Escaped(c), ''])
        else:
            tokens[-1] += c
    return tokens

# requests-toolbelt's encoder writes names with urllib3's fields: the HTML5 way, as curl.
def html5(s):
    return s.translate({10: '%0A', 13: '%0D', 34: '%22'})

def item(s):
    tokens = tokenize(s)
    for i, t in enumerate(tokens):
        if isinstance(t, Escaped):
            continue
        found = {}
        for sep in SEPS:
            pos = t.find(sep)
            if pos != -1:
                found[pos] = sep
        if found:
            sep = found[min(found)]
            key, value = t.split(sep, 1)
            return ''.join(tokens[:i]) + key, sep, value + ''.join(tokens[i + 1:])
    raise SystemExit('not an item: ' + s)

args = sys.argv[1:]
opts = {}
pos = []
i = 0
while i < len(args):
    a = args[i]
    if a in ('--auth', '--raw'):
        opts[a] = args[i + 1]; i += 2; continue
    if a.startswith('--'):
        opts[a.split('=')[0]] = a.split('=', 1)[1] if '=' in a else True; i += 1; continue
    pos.append(a); i += 1
method, url, items = pos[0].upper(), pos[1], pos[2:]
headers, fields, files = [], [], []
for it in items:
    key, sep, value = item(it)
    if sep == ':':
        headers.append([key, value if value != '' else None])
    elif sep == ';':
        headers.append([key, ''])
    elif sep == '=':
        fields.append([html5(key), None, value.encode('utf-8', 'surrogateescape').hex()])
    elif sep == '@':
        files.append([html5(key), html5(os.path.basename(value)), open(value, 'rb').read().hex()])
    else:
        raise SystemExit('separator not written by the tool: ' + sep)
body = b''
if '--raw' in opts:
    body = opts['--raw'].encode('utf-8', 'surrogateescape')
elif not sys.stdin.isatty():
    body = sys.stdin.buffer.read()
has_type = any(k.lower() == 'content-type' for k, _ in headers)
if (body or '--raw' in opts) and not has_type and '--multipart' not in opts:
    headers.insert(0, ['Content-Type', 'application/json'])
if '--auth' in opts:
    headers.append(['Authorization', 'Basic ' + base64.b64encode(opts['--auth'].encode('utf-8', 'surrogateescape')).decode()])
out = {'method': method, 'url': url, 'headers': [[k, v.encode('utf-8', 'surrogateescape').decode('latin-1')] for k, v in headers if v is not None], 'body': body.hex(), 'fields': (fields + files) if '--multipart' in opts else None}
print(json.dumps(out))
`;

interface Recorded {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body: string;
  fields: Array<[string, string | null, string]> | null;
}

/** A stand-in's record as the server would have seen it. */
const fromRecord = (call: Recorded, set: Set<string>): Normal => {
  const u = new URL(call.url);
  const got = normal(
    {
      method: call.method,
      url: `${u.pathname}${u.search}`,
      headers: call.headers,
      body: Buffer.from(call.body, 'hex'),
    },
    set,
  );
  if (call.fields) {
    // A name as the server reads it: its UTF-8 bytes as Latin-1 characters.
    const bytes = (s: string | null): string | null => (s === null ? null : Buffer.from(s, 'utf8').toString('latin1'));
    got.headers['content-type'] = 'multipart/form-data';
    got.body = JSON.stringify(call.fields.map(([n, f, c]) => [bytes(n), bytes(f), c]));
  }
  return got;
};

const CARGO = `[package]
name = "verify"
version = "0.1.0"
edition = "2021"

[dependencies]
reqwest = { version = "0.12", features = ["blocking", "multipart", "gzip", "brotli", "deflate"] }

[workspace]
`;

const HEAVY = { timeout: 1_800_000 };

interface Result {
  name: string;
  target: string;
  status: 'same' | 'same-but-warned' | 'differs' | 'not-run';
  detail?: string;
}

beforeAll(ready);

describe.skipIf(!ON)('the code sends what curl sends', () => {
  it('in every client the machine can run, for every command of the corpus', HEAVY, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'curl-to-code-verify-'));
    const servers = await startServers(dir);
    const { take } = servers;
    const base = `http://127.0.0.1:${servers.port}`;
    const tlsBase = `https://127.0.0.1:${servers.tlsPort}`;
    const results: Result[] = [];
    try {
      writeFileSync(join(dir, 'body.json'), '{"a":1,\r\n"b":2}\n');
      writeFileSync(join(dir, 'upload.txt'), 'line 1\r\nline 2\n');
      writeFileSync(join(dir, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2]));
      writeFileSync(join(dir, 'requests.py'), PY_REQUESTS);
      mkdirSync(join(dir, 'node_modules/axios'), { recursive: true });
      writeFileSync(join(dir, 'node_modules/axios/package.json'), '{"type":"module","main":"index.js"}\n');
      writeFileSync(join(dir, 'node_modules/axios/index.js'), AXIOS);
      mkdirSync(join(dir, 'bin'));
      writeFileSync(join(dir, 'bin/http'), HTTPIE);
      chmodSync(join(dir, 'bin/http'), 0o755);
      const go = has('go', ['version']);
      const cargo = has('cargo', ['--version']);
      const ruby = has('ruby', ['--version']);
      const swift = has('swift', ['--version']);
      const wget = has('wget', ['--version']);
      const rustDir = process.env.CURL_TO_CODE_CARGO_DIR ?? join(tmpdir(), 'curl-to-code-verify-rust');
      const cases = [
        ...CORPUS.map(([name, command]) => ({ name, translate: command, send: command })),
        ...CMD_FORM.map(([name, cmd, bash]) => ({ name, translate: cmd, send: bash })),
      ].map(c => {
        const fill = (s: string): string => s.replaceAll('TLS', tlsBase).replaceAll('URL', base);
        return { ...c, translate: fill(c.translate), send: fill(c.send) };
      });
      const code = (c: { name: string; translate: string }, target: Target): { text: string; warnings: string[] } => {
        const r = convert(c.translate, target);
        if (!r.ok) throw new Error(`${c.name}: ${r.error.message}`);
        return r;
      };

      // Rust: one binary per case, built at once.
      if (cargo) {
        mkdirSync(join(rustDir, 'src/bin'), { recursive: true });
        writeFileSync(join(rustDir, 'Cargo.toml'), CARGO);
        writeFileSync(join(rustDir, 'src/main.rs'), 'fn main() {}\n');
        cases.forEach((c, i) => writeFileSync(join(rustDir, `src/bin/case${i}.rs`), code(c, 'rust').text));
        const built = spawnSync('cargo', ['build', '--offline', '--bins', '--quiet'], {
          cwd: rustDir,
          encoding: 'utf8',
          env: { ...process.env, CARGO_TARGET_DIR: join(rustDir, 'target') },
        });
        expect(built.stderr, 'cargo build').toBe('');
      }

      const execute = async (file: string, args: string[], timeout = 60_000): Promise<string | Error> => {
        const out = await run(file, args, {
          cwd: dir,
          timeout,
          env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, JAVA_TOOL_OPTIONS: '' },
        }).catch((e: Error) => e);
        return out instanceof Error ? out : out.stdout;
      };

      for (const [i, c] of cases.entries()) {
        const set = setBy(c.translate);
        take();
        await run(BASH, ['-c', c.send], { cwd: dir, timeout: 20_000 }).catch(e => e);
        const fromCurl = take();
        if (fromCurl.length === 0) {
          results.push({ name: c.name, target: 'curl', status: 'differs', detail: 'curl sent nothing' });
          continue;
        }
        const want = normal(fromCurl[0]!, set);
        const curlPaths = fromCurl.map(s => s.url);
        const curlEncoding = fromCurl[0]!.headers.find(([n]) => n.toLowerCase() === 'accept-encoding')?.[1] ?? '';
        if (c.name.includes('--compressed'))
          results.push({
            name: c.name,
            target: 'curl',
            status: /gzip|deflate|br/.test(curlEncoding) ? 'same' : 'differs',
            detail: `curl's Accept-Encoding: ${curlEncoding}`,
          });

        /** Compares one client's requests (`seen`), or a stand-in's record, with curl's. */
        const compare = (target: string, warnings: string[], seen: Seen[] | Normal | Error, standIn = false): void => {
          const allowed = allowedBy(warnings);
          const first = Array.isArray(seen) ? seen[0] : seen instanceof Error ? undefined : seen;
          if (!first) {
            if (c.name.startsWith('-k') && allowed.noTls)
              results.push({
                name: c.name,
                target,
                status: 'same-but-warned',
                detail: 'cannot skip certificate checks',
              });
            else
              results.push({
                name: c.name,
                target,
                status: 'differs',
                detail: seen instanceof Error ? seen.message.slice(0, 2000) : 'no request',
              });
            return;
          }
          const got =
            'body' in first && typeof first.body === 'string' ? (first as Normal) : normal(first as Seen, set);
          const [w, g] = applyAllowed(want, got, allowed);
          const problems: string[] = [];
          if (JSON.stringify(w) !== JSON.stringify(g)) problems.push(JSON.stringify({ got: g, want: w }));
          if (Array.isArray(seen) && !standIn) {
            if (c.name.includes('-L')) {
              const paths = seen.map(s => s.url);
              const expected = allowed.noRedirects ? curlPaths.slice(0, 1) : curlPaths;
              if (JSON.stringify(paths) !== JSON.stringify(expected))
                problems.push(`redirects: ${JSON.stringify(paths)}, curl ${JSON.stringify(curlPaths)}`);
            }
            if (c.name.includes('--compressed') && !allowed.noDecompress) {
              const enc = seen[0]!.headers.find(([n]) => n.toLowerCase() === 'accept-encoding')?.[1] ?? '';
              if (!/gzip|deflate|br/.test(enc)) problems.push(`no compression asked for (Accept-Encoding: ${enc})`);
            }
          }
          const warnedDifference = JSON.stringify(sorted(want)) !== JSON.stringify(sorted(got));
          results.push({
            name: c.name,
            target,
            status: problems.length > 0 ? 'differs' : warnedDifference ? 'same-but-warned' : 'same',
            ...(problems.length > 0
              ? { detail: problems.join('\n') }
              : warnedDifference
                ? { detail: warnings.join(' | ') }
                : {}),
          });
        };
        const live = async (target: Target, file: string, args: string[], timeout?: number): Promise<void> => {
          const r = code(c, target);
          const out = await execute(file, args, timeout);
          const seen = take();
          compare(target, r.warnings, seen.length > 0 ? seen : out instanceof Error ? out : []);
        };
        const standIn = async (target: Target, file: string, args: string[]): Promise<void> => {
          const r = code(c, target);
          const out = await execute(file, args);
          take();
          if (out instanceof Error) compare(target, r.warnings, out, true);
          else
            compare(target, r.warnings, fromRecord(JSON.parse(out.trim().split('\n').at(-1)!) as Recorded, set), true);
        };

        // JavaScript: fetch (written for a browser, run by Node), Node's fetch, axios (stand-in).
        writeFileSync(join(dir, `case${i}.mjs`), code(c, 'javascript').text);
        await live('javascript', 'node', [`case${i}.mjs`]);
        writeFileSync(join(dir, `node${i}.mjs`), code(c, 'node').text);
        await live('node', 'node', ['--no-warnings', `node${i}.mjs`]);
        writeFileSync(join(dir, `axios${i}.mjs`), code(c, 'axios').text);
        await standIn('axios', 'node', [`axios${i}.mjs`]);

        // Python: requests (stand-in), http.client (the real one, isolated from the folder's stand-ins).
        writeFileSync(join(dir, `case${i}.py`), code(c, 'python').text);
        await standIn('python', 'python3', ['-E', '-s', `case${i}.py`]);
        writeFileSync(join(dir, `client${i}.py`), code(c, 'http-client').text);
        await live('http-client', 'python3', ['-I', `client${i}.py`]);

        // The command line: HTTPie (stand-in), wget.
        await standIn('httpie', BASH, ['-c', code(c, 'httpie').text]);
        if (wget) await live('wget', BASH, ['-c', code(c, 'wget').text]);
        else results.push({ name: c.name, target: 'wget', status: 'not-run' });

        // Java, Go, Rust, Ruby, Swift.
        if (JAVA) {
          mkdirSync(join(dir, `java${i}`));
          writeFileSync(join(dir, `java${i}/Main.java`), code(c, 'java').text);
          await live('java', JAVA, [join(dir, `java${i}/Main.java`)]);
        } else results.push({ name: c.name, target: 'java', status: 'not-run' });
        if (go) {
          mkdirSync(join(dir, `go${i}`));
          writeFileSync(join(dir, `go${i}/main.go`), code(c, 'go').text);
          const r = code(c, 'go');
          const out = await run('go', ['run', join(dir, `go${i}/main.go`)], {
            cwd: dir,
            timeout: 120_000,
            env: { ...process.env, GO111MODULE: 'off' },
          }).catch((e: Error) => e);
          const seen = take();
          compare('go', r.warnings, seen.length > 0 ? seen : out instanceof Error ? out : []);
        }
        if (cargo) await live('rust', join(rustDir, 'target/debug', `case${i}`), []);
        if (ruby) {
          writeFileSync(join(dir, `case${i}.rb`), code(c, 'ruby').text);
          await live('ruby', 'ruby', ['-W0', `case${i}.rb`]);
        } else results.push({ name: c.name, target: 'ruby', status: 'not-run' });
        if (swift) {
          writeFileSync(join(dir, `case${i}.swift`), code(c, 'swift').text);
          await live('swift', 'swift', [`case${i}.swift`], 180_000);
        } else results.push({ name: c.name, target: 'swift', status: 'not-run' });
      }
    } finally {
      servers.plain.close();
      servers.tls.close();
      rmSync(dir, { recursive: true, force: true });
    }
    const out = process.env.CURL_TO_CODE_VERIFY_OUT;
    if (out) writeFileSync(out, JSON.stringify(results, null, 2));
    const failed = results.filter(r => r.status === 'differs');
    expect(failed).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});
