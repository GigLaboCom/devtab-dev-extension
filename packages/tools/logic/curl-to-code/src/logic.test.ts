// Every row of docs/tools/specs/curl-to-code.md §10 with its expected value, the errors of §6 word for word, the
// warnings of §5, and §7's examples for detectCurl. Rows the specification's §15 corrects carry a comment saying so.
import { CREDENTIALS_NOTE, LIVE_INPUT, MAX_INPUT, SHELL_VARIABLES, detectCurl, parseCurl, splitWords } from './index';
import { convert as curlToCode, ready } from './testing';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CodeResult, Target } from './index';

beforeAll(ready);

const ok = (text: string, target: Target = 'javascript'): Extract<CodeResult, { ok: true }> => {
  const r = curlToCode(text, target);
  if (!r.ok) throw new Error(`${r.error.line}:${r.error.column} ${r.error.message}`);
  return r;
};
const code = (text: string, target: Target = 'javascript'): string => ok(text, target).text;
const warnings = (text: string, target: Target = 'javascript'): string[] => ok(text, target).warnings;
const error = (text: string): string => {
  const r = curlToCode(text, 'javascript');
  if (r.ok) throw new Error('expected an error');
  return `${r.error.line}:${r.error.column} ${r.error.message}`;
};
const request = (text: string) => {
  const w = splitWords(text);
  if (!w.ok) throw new Error(w.message);
  const p = parseCurl(w.words);
  if (!p.ok) throw new Error(p.message);
  return p.request;
};

const ITEMS = `curl -X POST https://api.example.com/items -H 'Content-Type: application/json' -d '{"name":"pen","qty":2}'`;

const GO_SAMPLE = `package main

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
)

func main() {
	body := strings.NewReader(\`{"name":"pen","qty":2}\`)
	req, err := http.NewRequest("POST", "https://api.example.com/items", body)
	if err != nil {
		log.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()
	out, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%s\\n", out)
}
`;

const RUST_SAMPLE = `// Cargo.toml: reqwest = { version = "0.12", features = ["blocking"] }

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = reqwest::blocking::Client::new();
    let response = client
        .post("https://api.example.com/items")
        .header("Content-Type", "application/json")
        .body(r#"{"name":"pen","qty":2}"#)
        .send()?;
    println!("{}", response.text()?);
    Ok(())
}
`;

describe('§10 examples', () => {
  it('a bare URL — JavaScript and Python', () => {
    expect(code('curl https://api.example.com/users')).toBe(
      "const response = await fetch('https://api.example.com/users');\n",
    );
    expect(code('curl https://api.example.com/users', 'python')).toBe(
      "import requests\n\nresponse = requests.get('https://api.example.com/users')\n",
    );
  });

  it('POST with a JSON body — JavaScript, Python, Go (sample 1), Rust (sample 2)', () => {
    expect(code(ITEMS)).toBe(
      "const response = await fetch('https://api.example.com/items', {\n  method: 'POST',\n  headers: {\n    'Content-Type': 'application/json'\n  },\n  body: '{\"name\":\"pen\",\"qty\":2}'\n});\n",
    );
    expect(code(ITEMS, 'python')).toBe(
      "import requests\n\nheaders = {\n    'Content-Type': 'application/json',\n}\n\ndata = '{\"name\":\"pen\",\"qty\":2}'\n\nresponse = requests.post(\n    'https://api.example.com/items',\n    headers=headers,\n    data=data,\n)\n",
    );
    expect(code(ITEMS, 'go')).toBe(GO_SAMPLE);
    expect(code(ITEMS, 'rust')).toBe(RUST_SAMPLE);
  });

  it('two --data parts: POST, the form type, joined with &', () => {
    const js = code("curl 'https://api.example.com/items' --data 'a=1' --data 'b=2'");
    expect(js).toContain("  method: 'POST',");
    expect(js).toContain("'Content-Type': 'application/x-www-form-urlencoded'");
    expect(js).toContain("  body: 'a=1&b=2'");
  });

  it('-G moves the encoded data into the URL', () => {
    expect(code("curl -G https://api.example.com/search --data-urlencode 'q=hello world&more' -d lang=en")).toBe(
      "const response = await fetch('https://api.example.com/search?q=hello+world%26more&lang=en');\n",
    );
  });

  it('--data-urlencode: content, =content, name=content', () => {
    expect(
      code("curl --data-urlencode 'a b' --data-urlencode '=c&d' --data-urlencode 'e=ü/?' https://api.example.com/f"),
    ).toContain("  body: 'a+b&c%26d&e=%C3%BC%2F%3F'");
  });

  it('-u with a colon in the password, in all four, with the credentials note', () => {
    const cmd = "curl -u 'ann:pa:ss' https://api.example.com/me";
    expect(code(cmd)).toContain("'Authorization': 'Basic YW5uOnBhOnNz'");
    expect(code(cmd, 'python')).toContain("    auth=('ann', 'pa:ss'),\n");
    expect(code(cmd, 'go')).toContain('req.SetBasicAuth("ann", "pa:ss")');
    expect(code(cmd, 'rust')).toContain('.basic_auth("ann", Some("pa:ss"))');
    for (const t of ['javascript', 'python', 'go', 'rust'] as const) expect(ok(cmd, t).hasCredentials).toBe(true);
  });

  it('-F fields — JavaScript, Python, Go, Rust', () => {
    const cmd = "curl -F name=Ann -F 'note=a b' https://api.example.com/form";
    expect(code(cmd)).toBe(
      "const form = new FormData();\nform.append('name', 'Ann');\nform.append('note', 'a b');\n\nconst response = await fetch('https://api.example.com/form', {\n  method: 'POST',\n  body: form\n});\n",
    );
    expect(code(cmd, 'python')).toContain("files = {\n    'name': (None, 'Ann'),\n    'note': (None, 'a b'),\n}");
    const go = code(cmd, 'go');
    expect(go).toContain('form := multipart.NewWriter(&body)');
    expect(go).toContain('form.WriteField("name", "Ann")');
    expect(go).toContain('req.Header.Set("Content-Type", form.FormDataContentType())');
    const rust = code(cmd, 'rust');
    expect(rust).toContain('Form::new()\n        .text("name", "Ann")\n        .text("note", "a b");');
    expect(rust).toContain('features = ["blocking", "multipart"]');
  });

  it('--json: POST, its two headers, the body as written', () => {
    const js = code('curl --json \'{"a":1}\' https://api.example.com/x');
    expect(js).toContain("  method: 'POST',");
    expect(js).toContain("    'Content-Type': 'application/json',\n    'Accept': 'application/json'\n");
    expect(js).toContain('  body: \'{"a":1}\'');
  });

  const BASH = `curl 'https://api.example.com/api' \\\n  -H 'accept: */*' \\\n  -b 'sid=abc; theme=dark' \\\n  --data-raw $'{"text":"line1\\\\nline2 é it\\'s"}'`;
  it('"Copy as cURL (bash)" — JavaScript', () => {
    const r = ok(BASH);
    expect(r.text).toContain(
      "  headers: {\n    'accept': '*/*',\n    'Cookie': 'sid=abc; theme=dark',\n    'Content-Type': 'application/x-www-form-urlencoded'\n  },",
    );
    expect(r.text).toContain('  body: \'{"text":"line1\\\\nline2 é it\\\'s"}\'');
    expect(r.warnings).toEqual(['A browser does not let fetch set the Cookie header (Node does).']);
    expect(r.hasCredentials).toBe(true);
  });
  it('"Copy as cURL (bash)" — Python, Go, Rust', () => {
    expect(code(BASH, 'python')).toContain('data = \'{"text":"line1\\\\nline2 é it\\\'s"}\'.encode()');
    expect(code(BASH, 'go')).toContain('strings.NewReader(`{"text":"line1\\nline2 é it\'s"}`)');
    expect(code(BASH, 'rust')).toContain('.body(r#"{"text":"line1\\nline2 é it\'s"}"#)');
  });

  it('"Copy as cURL (cmd)" is the same request as its bash form', () => {
    const cmd =
      'curl ^"https://api.example.com/api?q=1^&x=2^" ^\n  -H ^"accept: application/json^" ^\n  --data-raw ^"^{^\\^"a^\\^":1^}^"';
    expect(request(cmd)).toEqual(
      request("curl 'https://api.example.com/api?q=1&x=2' -H 'accept: application/json' --data-raw '{\"a\":1}'"),
    );
    expect(splitWords(cmd)).toMatchObject({ ok: true, form: 'cmd' });
  });

  it('glued short options: -sSL -XPUT -H…', () => {
    const js = code("curl -sSL -XPUT -H'X-Trace: 1' https://api.example.com/put -d 'x=1'");
    expect(js).toContain("  method: 'PUT',");
    expect(js).toContain("    'X-Trace': '1',");
    expect(js).toContain("'Content-Type': 'application/x-www-form-urlencoded'");
    expect(js).toContain("  body: 'x=1'");
  });

  it('-k -m 2.5 --compressed in all four', () => {
    const cmd = 'curl -k -m 2.5 --compressed https://api.example.com/slow';
    expect(code(cmd)).toContain('  signal: AbortSignal.timeout(2500)');
    expect(warnings(cmd)).toEqual(['-k: fetch cannot skip certificate checks; left out.']);
    expect(code(cmd, 'python')).toContain('    timeout=2.5,\n    verify=False,\n');
    const go = code(cmd, 'go');
    expect(go).toContain('Timeout: 2500 * time.Millisecond');
    expect(go).toContain('InsecureSkipVerify: true');
    expect(code(cmd, 'rust')).toContain(
      '.danger_accept_invalid_certs(true)\n        .timeout(Duration::from_millis(2500))',
    );
  });

  it('a pipe after the command', () => {
    const r = ok('curl -s https://api.example.com/users | jq .');
    expect(r.text).toBe("const response = await fetch('https://api.example.com/users');\n");
    expect(r.warnings).toEqual(['Only the curl command is translated; "| jq ." after it is ignored.']);
  });

  it('shell variables stay as written, with one warning', () => {
    const r = ok('curl "https://api.example.com/users/$ID" -H "Authorization: Bearer $TOKEN"');
    expect(r.text).toBe(
      "const response = await fetch('https://api.example.com/users/$ID', {\n  headers: {\n    'Authorization': 'Bearer $TOKEN'\n  }\n});\n",
    );
    expect(r.warnings).toEqual([SHELL_VARIABLES]);
  });

  it('-u with an Authorization header: the header only, a warning', () => {
    const r = ok("curl -H 'Authorization: Bearer t0k' -u a:b https://api.example.com/me");
    expect(r.text).toContain("'Authorization': 'Bearer t0k'");
    expect(r.text).not.toContain('Basic');
    expect(r.warnings).toEqual([
      '-u is ignored: the command also sets an Authorization header, which curl sends instead.',
    ]);
  });

  it('a method of its own — Python and Rust', () => {
    const cmd = 'curl -X PURGE https://api.example.com/cache';
    expect(code(cmd, 'python')).toContain(
      "response = requests.request(\n    'PURGE',\n    'https://api.example.com/cache',\n)",
    );
    expect(code(cmd, 'rust')).toContain(
      '.request(reqwest::Method::from_bytes(b"PURGE")?, "https://api.example.com/cache")',
    );
  });

  it('no scheme: http://', () => {
    expect(code('curl api.example.com/plain')).toContain("fetch('http://api.example.com/plain')");
  });

  it('-d @file: the code reads the file (§15: the draft left it out) — POST and the form type stay', () => {
    const r = ok('curl -d @body.json https://api.example.com/upload');
    expect(r.text).toContain("  method: 'POST',");
    expect(r.text).toContain("'Content-Type': 'application/x-www-form-urlencoded'");
    expect(r.text).toContain("  body: (await readFile('body.json')).filter(b => b !== 10 && b !== 13)");
    expect(r.text.startsWith("import { readFile } from 'node:fs/promises';\n\n")).toBe(true);
    expect(r.warnings).toEqual(['The code reads files with node:fs: run it in Node.']);
  });

  it('a body with non-ASCII and an emoji — Python encodes it', () => {
    expect(code("curl -d 'name=Jörg 🙂' https://api.example.com/n", 'python')).toContain(
      "data = 'name=Jörg 🙂'.encode()",
    );
  });

  it('an empty header and a removed one', () => {
    const r = ok("curl -H 'X-Empty;' -H 'Accept:' https://api.example.com/h");
    expect(r.text).toContain("'X-Empty': ''");
    expect(r.warnings).toEqual(['-H "Accept:" removes a header curl adds itself; ignored.']);
  });

  it('-I: HEAD', () => {
    expect(code('curl -I https://api.example.com/')).toContain("  method: 'HEAD'");
  });

  it('-A, -e, two -b', () => {
    const r = ok("curl -A 'probe' -e https://ref.example/ -b 'a=1' -b 'b=2' https://api.example.com/c");
    expect(r.text).toContain(
      "    'User-Agent': 'probe',\n    'Referer': 'https://ref.example/',\n    'Cookie': 'a=1;b=2'\n",
    );
    expect(r.warnings).toEqual([
      'A browser does not let fetch set the Referer header (Node does).',
      'A browser does not let fetch set the Cookie header (Node does).',
    ]);
  });

  it('a repeated header is merged with ", "', () => {
    expect(code("curl -H 'X-A: 1' -H 'x-a: 2' https://api.example.com/r")).toContain("'X-A': '1, 2'");
  });

  it('escapes in double quotes; a backtick escaped is no substitution', () => {
    const r = ok('curl "https://api.example.com/q" -H "X-Note: say \\"hi\\" \\$5" -d "v=\\`x\\`"');
    expect(r.text).toContain("'X-Note': 'say \"hi\" $5'");
    expect(r.text).toContain("  body: 'v=`x`'");
    expect(r.warnings).toEqual([]);
  });

  it('--oauth2-bearer', () => {
    expect(code('curl --oauth2-bearer abc123 https://api.example.com/o')).toContain("'Authorization': 'Bearer abc123'");
  });

  it('a comment after the command', () => {
    expect(code('curl https://api.example.com/c2 # fetch it')).toBe(
      "const response = await fetch('https://api.example.com/c2');\n",
    );
  });

  it('an unknown option and one not translated', () => {
    const r = ok('curl --frobnicate --proxy http://p:1 https://api.example.com/u');
    expect(r.text).toBe("const response = await fetch('https://api.example.com/u');\n");
    expect(r.warnings).toEqual(['Unknown option --frobnicate; ignored.', '--proxy is not translated; ignored.']);
  });

  it('empty input: an empty result', () => {
    expect(curlToCode('', 'javascript')).toEqual({ ok: true, text: '', warnings: [], hasCredentials: false });
    expect(curlToCode(' \n\t \n', 'go')).toEqual({ ok: true, text: '', warnings: [], hasCredentials: false });
  });

  it('the errors of §6, with their place', () => {
    expect(error('wget https://api.example.com/')).toBe('1:1 the command must start with curl');
    expect(error('curl https://api.example.com/ -H')).toBe('1:31 -H needs a value');
    expect(error("curl 'https://api.example.com/")).toBe('1:6 unterminated single quote');
    expect(error('curl "https://api.example.com/')).toBe('1:6 unterminated double quote');
    expect(error("curl $'https://api.example.com/")).toBe("1:6 unterminated $'…' string");
    expect(error('curl -X POST')).toBe('1:1 no URL in the command');
    expect(error('Invoke-WebRequest https://api.example.com/')).toBe('1:1 the command must start with curl');
    expect(error('curl https://a.example/ \\\n  -H')).toBe('2:3 -H needs a value');
  });

  it('9.5 MiB of body in --data-raw is translated, every byte kept (§12)', () => {
    const body = 'x'.repeat(9.5 * 1024 * 1024);
    const r = ok(`curl --data-raw '${body}' https://api.example.com/big`);
    expect(r.text.length).toBeGreaterThan(body.length);
    expect(r.text).toContain(`  body: '${body}'`);
  });
});

describe('worst inputs of 1 MiB stay linear (no backtracking, no rescans)', () => {
  const MIB = 1024 * 1024;
  it.each<[string, string]>([
    ['unclosed $( everywhere', `curl https://a.example/ ${'$('.repeat(MIB / 2)}`],
    ['nested $( … )', `curl https://a.example/ ${'$('.repeat(MIB / 4)}${')'.repeat(MIB / 4)}`],
    ['escaped quotes in "…"', `curl https://a.example/ -d "${'\\"'.repeat(MIB / 2)}"`],
    ["escapes in $'…'", `curl https://a.example/ -d $'${'\\x41'.repeat(MIB / 4)}'`],
    ['carets of cmd', `curl ^"https://a.example/^" -d ^"${'^&'.repeat(MIB / 2)}^"`],
    ['a header of semicolons', `curl https://a.example/ -H '${';'.repeat(MIB)}'`],
    ['words', `curl https://a.example/ ${'-s '.repeat(MIB / 3)}`],
    [
      'different unknown options',
      `curl https://a.example/ ${Array.from({ length: 50_000 }, (_, i) => `--x${i}`).join(' ')}`,
    ],
    ['URLs', `curl ${'a '.repeat(MIB / 2)}`],
    [
      'different headers',
      `curl https://a.example/ ${Array.from({ length: 50_000 }, (_, i) => `-H h${i}:v`).join(' ')}`,
    ],
    ['backticks', `curl https://a.example/ ${'`'.repeat(MIB)}`],
  ])('%s', (_name, command) => {
    const t0 = performance.now();
    const r = curlToCode(command, 'javascript');
    // Generous for a loaded machine; a quadratic walk over 1 MiB takes minutes.
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(typeof r.ok).toBe('boolean');
  });
});

describe('the credentials note (§5 «Предупреждения»)', () => {
  it('Authorization, Cookie, Proxy-Authorization or -u — and not otherwise', () => {
    expect(ok("curl -H 'Authorization: x' https://a.example/").hasCredentials).toBe(true);
    expect(ok("curl -H 'proxy-authorization: x' https://a.example/").hasCredentials).toBe(true);
    expect(ok("curl -b 'a=1' https://a.example/").hasCredentials).toBe(true);
    expect(ok('curl -u a:b https://a.example/').hasCredentials).toBe(true);
    expect(ok("curl -H 'X-Token: x' https://a.example/").hasCredentials).toBe(false);
    expect(CREDENTIALS_NOTE).toBe('The code contains credentials from the command. Do not share it as is.');
  });
  it('a warning never repeats a password or a credential header', () => {
    const w = warnings("curl -u 's3cret' -H 'Authorization Bearer s3cret' -H 'Cookie' https://a.example/");
    expect(w.join('\n')).not.toContain('s3cret');
    expect(w).toContain('-u has no password: curl would ask for one; the code uses an empty password.');
    expect(w).toContain('-H "Authorization" is not a header (no colon); ignored.');
  });
});

describe('limits', () => {
  it('are those of §12', () => {
    expect(LIVE_INPUT).toBe(1024 * 1024);
    expect(MAX_INPUT).toBe(16 * 1024 * 1024);
  });
});

describe('§7 detectCurl', () => {
  it.each([
    ['curl https://api.example.com/users', true],
    ['$ curl -X POST api.example.com/x -d a=1', true],
    ['curl ^"https://x.example/^" ^', true],
    ['  CURL.EXE https://x.example/', true],
    ['curl\t-s x', true],
    ['curl up with a book', false],
    ['curling.example.com', false],
    ['{"curl": "-X"}', false],
    ['https://api.example.com/?a=1', false],
    ['wget https://x.example/', false],
    ['curl', false],
    ['', false],
  ])('%j → %s', (text, want) => expect(detectCurl(text)).toBe(want));

  it('reads only the first 4 KiB', () => {
    expect(detectCurl(`curl ${'a'.repeat(5000)} -s`)).toBe(false);
    expect(detectCurl(`curl -s ${'a'.repeat(5000)}`)).toBe(true);
  });
});
