// Every curl option of docs/tools/specs/curl-to-code.md §5 «Параметры `curl`», long and short, and the request rules
// of «Запрос»: what each does to the method, the headers, the body and the warnings. Where curl 8.7.1 behaves
// otherwise than the draft said (checked against a loopback server, verify.test.ts), the test follows curl and the
// specification's §15 says so.
import { curlUrlEncode, parseCurl, splitWords } from './index';
import { describe, expect, it } from 'vitest';
import type { CurlRequest } from './index';

const parse = (command: string): { request: CurlRequest; warnings: string[] } => {
  const w = splitWords(command);
  if (!w.ok) throw new Error(w.message);
  const p = parseCurl(w.words);
  if (!p.ok) throw new Error(`${p.offset}: ${p.message}`);
  return p;
};
const req = (command: string): CurlRequest => parse(command).request;
const warns = (command: string): string[] => parse(command).warnings;
const failure = (command: string) => {
  const w = splitWords(command);
  if (!w.ok) throw new Error(w.message);
  return parseCurl(w.words);
};
const U = 'https://a.example/x';

describe('the start of the command', () => {
  it.each(['curl', 'CURL', 'curl.exe', 'Curl.EXE', '$ curl'])('%s', start => {
    expect(req(`${start} ${U}`).url).toBe(U);
  });
  it.each(['wget', 'curly', 'http', '$', '$ wget'])('%s is refused', start => {
    expect(failure(`${start} ${U}`)).toEqual({ ok: false, message: 'the command must start with curl', offset: 0 });
  });
});

describe('URLs', () => {
  it('--url and positional', () => {
    expect(req('curl --url https://a.example/u').url).toBe('https://a.example/u');
  });
  it('without a scheme: http://', () => {
    expect(req('curl a.example:8080/x?y=1').url).toBe('http://a.example:8080/x?y=1');
    expect(req('curl ftp://a.example/').url).toBe('ftp://a.example/');
  });
  it('several: the first, with a warning', () => {
    const p = parse('curl https://a.example/1 https://a.example/2 --url https://a.example/3');
    expect(p.request.url).toBe('https://a.example/1');
    expect(p.warnings).toEqual(['3 URLs: only the first one is translated.']);
  });
  it('-- ends the options', () => {
    expect(parse('curl -- -weird').request.url).toBe('http://-weird');
  });
  it('none: an error at the start of the command', () => {
    expect(failure('  curl -X POST')).toEqual({ ok: false, message: 'no URL in the command', offset: 2 });
  });
  it('as written: nothing re-encoded', () => {
    expect(req("curl 'https://a.example/p?a=1&b=%20x#f'").url).toBe('https://a.example/p?a=1&b=%20x#f');
  });
});

describe('options with values', () => {
  it.each([
    ['-X PUT', 'PUT'],
    ['-XPUT', 'PUT'],
    ['--request PATCH', 'PATCH'],
    ['-X post', 'post'],
  ])('%s → method %s', (option, method) => expect(req(`curl ${option} ${U}`).method).toBe(method));

  it('a value that looks like an option is still the value', () => {
    expect(req(`curl -H -s ${U}`).headers).toEqual([]);
    expect(warns(`curl -H -s ${U}`)).toEqual(['-H "-s" is not a header (no colon); ignored.']);
    expect(req(`curl -d -x ${U}`).body).toEqual({ kind: 'raw', text: '-x' });
  });

  it.each([`curl ${U} -H`, `curl ${U} --header`, `curl ${U} -sH`, `curl ${U} -d`, `curl ${U} --json`])(
    '%s: needs a value, at the option',
    command => {
      const r = failure(command);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message).toMatch(/^(-H|--header|-d|--json) needs a value$/);
        expect(r.offset).toBe(command.lastIndexOf(' ') + 1);
      }
    },
  );

  it('--name=value is not a form curl knows', () => {
    expect(warns(`curl --header=X:1 ${U}`)).toEqual(['Unknown option --header=X:1; ignored.']);
  });
});

describe('headers', () => {
  it.each([
    ['-H "X-A: 1"', [['X-A', '1']]],
    ['--header "X-A:1"', [['X-A', '1']]],
    ['-H "X-A:   spaced  "', [['X-A', 'spaced']]],
    ['-H "X-E;"', [['X-E', '']]],
    ['-H "X-A: 1" -H "x-a: 2" -H "X-A: 3"', [['X-A', '1, 2, 3']]],
    ['-H "Cookie: a=1" -H "cookie: b=2"', [['Cookie', 'a=1;b=2']]],
    ['-H "Host: b.example"', [['Host', 'b.example']]],
  ])('%s', (option, headers) => expect(req(`curl ${option} ${U}`).headers).toEqual(headers));

  it.each([
    ['-H "Accept:"', '-H "Accept:" removes a header curl adds itself; ignored.'],
    ['-H "nocolon"', '-H "nocolon" is not a header (no colon); ignored.'],
    ['-H "Z;x"', '-H "Z;x" is not a header (no colon); ignored.'],
    ['-H ": x"', '-H ": x" is not a header (no colon); ignored.'],
    ['-H @headers.txt', '--header @headers.txt: files are not read; left out.'],
  ])('%s is left out: %s', (option, warning) => {
    const p = parse(`curl ${option} ${U}`);
    expect(p.request.headers).toEqual([]);
    expect(p.warnings).toEqual([warning]);
  });

  it('-A, -e (;auto dropped), --oauth2-bearer, -b (joined with ;) — after -H, in their order', () => {
    expect(
      req(`curl -b a=1 -H "X: 1" --user-agent u -e "https://r.example/;auto" --cookie b=2 --oauth2-bearer t ${U}`)
        .headers,
    ).toEqual([
      ['X', '1'],
      ['Cookie', 'a=1;b=2'],
      ['User-Agent', 'u'],
      ['Referer', 'https://r.example/'],
      ['Authorization', 'Bearer t'],
    ]);
  });
  it('-A "" sends no User-Agent of its own; -e ";auto" no Referer', () => {
    expect(req(`curl -A '' -e ';auto' ${U}`).headers).toEqual([]);
  });
  it('a header from -H wins over the option that sets the same one, as in curl', () => {
    const p = parse(`curl -H "Cookie: x=1" -b y=2 -H "user-agent: me" -A other --referer r -H "Referer: s" ${U}`);
    expect(p.request.headers).toEqual([
      ['Cookie', 'x=1'],
      ['user-agent', 'me'],
      ['Referer', 's'],
    ]);
    expect(p.warnings).toEqual([
      '-b is ignored: the command also sets a Cookie header, which curl sends instead.',
      '-A is ignored: the command also sets a User-Agent header, which curl sends instead.',
      '--referer is ignored: the command also sets a Referer header, which curl sends instead.',
    ]);
  });
  it('-b without = is a cookie file', () => {
    const p = parse(`curl -b cookies.txt ${U}`);
    expect(p.request.headers).toEqual([]);
    expect(p.warnings).toEqual(['-b cookies.txt: a cookie file is not read; ignored.']);
  });
});

describe('the body and the method', () => {
  it.each([
    ['-d a=1', 'a=1'],
    ['--data a=1', 'a=1'],
    ['--data-ascii a=1', 'a=1'],
    ['--data-binary a=1', 'a=1'],
    ['--data-raw @a', '@a'],
    ['-d a -d b', 'a&b'],
    ["-d a -d ''", 'a&'],
    ["-d '' -d b", 'b'],
    ['--data-urlencode "a b"', 'a+b'],
    ['--data-urlencode "=a&b"', 'a%26b'],
    ['--data-urlencode "n=a b"', 'n=a+b'],
    ['--data-urlencode "a@b=c d"', 'a@b=c+d'],
  ])('%s → POST, form type, body %j', (option, body) => {
    const r = req(`curl ${option} ${U}`);
    expect(r.method).toBe('POST');
    expect(r.body).toEqual({ kind: 'raw', text: body });
    expect(r.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']]);
  });

  it('--json parts are joined with nothing, other parts with & — in the order of the command, as curl does', () => {
    expect(req(`curl -d a=1 --json '{"x":1}' -d b=2 ${U}`).body).toEqual({ kind: 'raw', text: 'a=1{"x":1}&b=2' });
    expect(req(`curl --json a --json b -d c ${U}`).body).toEqual({ kind: 'raw', text: 'ab&c' });
  });
  it('--json sets Content-Type and Accept unless the command does', () => {
    expect(req(`curl --json '{}' ${U}`).headers).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'application/json'],
    ]);
    expect(req(`curl -H 'Accept: text/plain' --json '{}' ${U}`).headers).toEqual([
      ['Accept', 'text/plain'],
      ['Content-Type', 'application/json'],
    ]);
  });
  it('a Content-Type of the command replaces the form type', () => {
    expect(req(`curl -H 'content-type: text/plain' -d x ${U}`).headers).toEqual([['content-type', 'text/plain']]);
  });

  it.each([
    ['-X DELETE -d x', 'DELETE'],
    ['-I', 'HEAD'],
    ['--head', 'HEAD'],
    ['-G -d a=1', 'GET'],
    ['--get', 'GET'],
    ['-F a=1', 'POST'],
    ['-T f.txt', 'PUT'],
    ['', 'GET'],
  ])('%s → %s', (option, method) => expect(req(`curl ${option} ${U}`).method).toBe(method));

  it('-G: the data goes into the URL, with ? or &; no body, no form type', () => {
    expect(req('curl -G https://a.example/s -d a=1 -d b=2')).toMatchObject({
      url: 'https://a.example/s?a=1&b=2',
      body: null,
      headers: [],
    });
    expect(req('curl -G "https://a.example/s?x=1#f" -d a=1').url).toBe('https://a.example/s?x=1&a=1');
  });

  it('a file: the code reads it when it is the whole body (§15)', () => {
    expect(req(`curl -d @b.json ${U}`).body).toEqual({ kind: 'file', path: 'b.json', strip: true });
    expect(req(`curl --data-ascii @b.json ${U}`).body).toEqual({ kind: 'file', path: 'b.json', strip: true });
    expect(req(`curl --data-binary @b.json ${U}`).body).toEqual({ kind: 'file', path: 'b.json', strip: false });
    expect(req(`curl --json @b.json ${U}`).body).toEqual({ kind: 'file', path: 'b.json', strip: false });
  });
  it('a file among other parts, or standard input: left out, named', () => {
    const p = parse(`curl -d @b.json -d x=1 --data-binary @- ${U}`);
    expect(p.request.body).toEqual({ kind: 'raw', text: 'x=1' });
    expect(p.warnings).toEqual([
      '--data @b.json: files are not read; that part of the body is left out.',
      '--data-binary @-: files are not read; that part of the body is left out.',
    ]);
    const only = parse(`curl -d @- ${U}`);
    expect(only.request).toMatchObject({ method: 'POST', body: null });
    expect(only.request.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']]);
  });
  it('--data-urlencode with a file is left out', () => {
    expect(parse(`curl --data-urlencode n@f.txt --data-urlencode user@example.com ${U}`).warnings).toEqual([
      '--data-urlencode n@f.txt: files are not read; left out.',
      '--data-urlencode user@example.com: files are not read; left out.',
    ]);
  });
  it('-T: PUT with the file; a URL ending in / gets the file name, as curl does', () => {
    expect(req('curl -T up/f.txt https://a.example/d/')).toMatchObject({
      method: 'PUT',
      url: 'https://a.example/d/f.txt',
      body: { kind: 'file', path: 'up/f.txt', strip: false },
    });
    expect(req('curl --upload-file f.txt https://a.example').url).toBe('https://a.example/f.txt');
    expect(req('curl -T f.txt https://a.example/d/g.txt?x=1').url).toBe('https://a.example/d/g.txt?x=1');
    expect(warns(`curl -T - ${U}`)).toEqual(['--upload-file -: files are not read; left out.']);
  });
  it("binary data from $'…' stays bytes", () => {
    expect(req(`curl --data-binary $'\\xff\\x00z' -d a ${U}`).body).toEqual({
      kind: 'binary',
      bytes: Uint8Array.of(0xff, 0x26, 0x61),
    });
  });
  it('a body is exactly its characters: JSON is not read, numbers are not touched', () => {
    const json = '{"n":12345678901234567890,"f":1.0,"e":1e400,"s":"\\u00e9"}';
    expect(req(`curl --data-raw '${json}' ${U}`).body).toEqual({ kind: 'raw', text: json });
  });
});

describe('-F', () => {
  it('text fields, --form and --form-string', () => {
    expect(req(`curl -F a=1 --form 'b=x y' --form-string 'c=@not-a-file;type=x' ${U}`).body).toEqual({
      kind: 'multipart',
      fields: [
        { name: 'a', value: '1' },
        { name: 'b', value: 'x y' },
        { name: 'c', value: '@not-a-file;type=x' },
      ],
    });
  });
  it('a file: read by the code, with its name', () => {
    expect(req(`curl -F 'p=@dir/photo.png' -F 'q=@"a;b.txt";filename=c.txt' ${U}`).body).toEqual({
      kind: 'multipart',
      fields: [
        { name: 'p', file: 'dir/photo.png', filename: 'photo.png' },
        { name: 'q', file: 'a;b.txt', filename: 'c.txt' },
      ],
    });
  });
  it('the parameters after ; are cut off as curl does, with a warning (§15)', () => {
    const p = parse(`curl -F 'a=1;type=text/plain' -F 'b=x;y' -F 'c="q;r"' ${U}`);
    expect(p.request.body).toEqual({
      kind: 'multipart',
      fields: [
        { name: 'a', value: '1' },
        { name: 'b', value: 'x' },
        { name: 'c', value: 'q;r' },
      ],
    });
    expect(p.warnings).toEqual([
      '-F a: ";type=", ";filename=" and similar are not translated; left out.',
      '-F b: ";type=", ";filename=" and similar are not translated; left out.',
    ]);
  });
  it('<file, standard input and a field without =', () => {
    expect(warns(`curl -F 'a=<f.txt' -F b=@- -F nofield ${U}`)).toEqual([
      '-F a=<f.txt: files are not read; that field is left out.',
      '-F b=@-: files are not read; that field is left out.',
      '-F "nofield" is not a form field (no =); ignored.',
    ]);
  });
  it('with -d: the form, and a warning', () => {
    const p = parse(`curl -d x -F a=1 ${U}`);
    expect(p.request.body?.kind).toBe('multipart');
    expect(p.request.headers).toEqual([]);
    expect(p.warnings).toEqual(['-F together with -d: curl refuses this; the form is used.']);
  });
  it('a Content-Type of the command is left out: the client writes the boundary', () => {
    const p = parse(`curl -H 'Content-Type: multipart/form-data' -F a=1 ${U}`);
    expect(p.request.headers).toEqual([]);
    expect(p.warnings).toEqual([
      '-H "Content-Type: …" is left out: the client writes the form\'s own Content-Type with its boundary.',
    ]);
  });
});

describe('-u', () => {
  it.each([
    ['-u a:b', ['a', 'b']],
    ['--user a:b:c', ['a', 'b:c']],
    ["-u ':'", ['', '']],
  ])('%s', (option, user) => expect(req(`curl ${option} ${U}`).user).toEqual(user));
  it('without a colon: an empty password, a warning that does not repeat it', () => {
    const p = parse(`curl -u ann ${U}`);
    expect(p.request.user).toEqual(['ann', '']);
    expect(p.warnings).toEqual(['-u has no password: curl would ask for one; the code uses an empty password.']);
  });
  it('with --oauth2-bearer: the bearer, as curl sends', () => {
    const p = parse(`curl --oauth2-bearer T -u a:b ${U}`);
    expect(p.request.user).toBeNull();
    expect(p.request.headers).toEqual([['Authorization', 'Bearer T']]);
  });
});

describe('-k, -m, the options with no code, those not translated, unknown ones', () => {
  it('-k, --insecure', () => {
    expect(req(`curl -k ${U}`).insecure).toBe(true);
    expect(req(`curl --insecure ${U}`).insecure).toBe(true);
  });
  it.each([
    ['-m 5', 5],
    ['--max-time 2.5', 2.5],
    ['-m .5', 0.5],
    ['-m 1e1', 10],
  ])('%s → %s s', (option, seconds) => expect(req(`curl ${option} ${U}`).timeoutSeconds).toBe(seconds));
  it.each(['-m 0', '-m -1', '-m abc', '-m 0x10'])('%s is not a positive number', option => {
    const p = parse(`curl ${option} ${U}`);
    expect(p.request.timeoutSeconds).toBeNull();
    expect(p.warnings).toEqual([`--max-time ${option.slice(3)} is not a positive number of seconds; ignored.`]);
  });

  it("no warning: what changes only curl's own output; --compressed and -L are flags of the request", () => {
    const silent =
      '-s -S -v -i -O -f -# -0 -g -N -L --silent --show-error --verbose --include --remote-name --fail ' +
      '--fail-with-body --progress-bar --no-progress-meter --http1.0 --http1.1 --http2 --globoff --no-buffer --raw ' +
      '--compressed-ssh --compressed --location --location-trusted --no-keepalive --no-silent -o out -w %{http_code} ' +
      '-D h.txt --output out --write-out x --dump-header h --trace t --trace-ascii t --stderr e';
    const p = parse(`curl ${silent} ${U}`);
    expect(p.warnings).toEqual([]);
    expect(p.request).toEqual({
      method: 'GET',
      url: U,
      headers: [],
      body: null,
      user: null,
      insecure: false,
      timeoutSeconds: null,
      compressed: true,
      followRedirects: true,
    });
    expect(parse(`curl -sSLfv ${U}`).warnings).toEqual([]);
    expect(req(`curl ${U}`)).toMatchObject({ compressed: false, followRedirects: false });
    expect(req(`curl --location-trusted ${U}`).followRedirects).toBe(true);
    expect(req(`curl -L --no-location ${U}`).followRedirects).toBe(false);
    expect(req(`curl -k --compressed --no-insecure --no-compressed ${U}`)).toMatchObject({
      insecure: false,
      compressed: false,
    });
  });

  it.each([
    '--connect-timeout 3',
    '-x http://p:1',
    '--proxy http://p:1',
    '-U u:p',
    '--proxy-user u:p',
    '-c jar',
    '--cookie-jar jar',
    '-E c.pem',
    '--cert c.pem',
    '--key k.pem',
    '--cacert ca.pem',
    '--retry 3',
    '--resolve a:443:1.2.3.4',
    '--limit-rate 1k',
    '-r 0-9',
    '--range 0-9',
    '-K cfg',
    '--config cfg',
    '--url-query a=b',
    '--variable a=b',
    '--expand-url x',
    '--digest',
    '--http3',
    '-4',
    '--retry-delay 5',
  ])('%s is named, its value skipped', option => {
    const p = parse(`curl ${option} ${U}`);
    expect(p.request.url).toBe(U);
    expect(p.warnings).toEqual([`${option.split(' ')[0]} is not translated; ignored.`]);
  });

  it('unknown options are named, never dropped silently', () => {
    expect(warns(`curl --frobnicate -W ${U}`)).toEqual([
      'Unknown option --frobnicate; ignored.',
      'Unknown option -W; ignored.',
    ]);
    expect(warns(`curl --verb ${U}`)).toEqual(['Unknown option --verb; ignored.']);
  });

  it('warnings are listed once, in order', () => {
    expect(warns(`curl --digest --digest -W -W ${U}`)).toEqual([
      '--digest is not translated; ignored.',
      'Unknown option -W; ignored.',
    ]);
  });
});

describe('curlUrlEncode (§5: as curl 8.7.1)', () => {
  it.each([
    ['hello world&more', 'hello+world%26more'],
    ['ü/?', '%C3%BC%2F%3F'],
    ['AZaz09-._~', 'AZaz09-._~'],
    ["*!'()", '%2A%21%27%28%29'],
    ['😀', '%F0%9F%98%80'],
  ])('%j → %j', (text, encoded) => expect(curlUrlEncode(text)).toBe(encoded));
});
