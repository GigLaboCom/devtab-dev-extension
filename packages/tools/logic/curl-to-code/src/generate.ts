/**
 * The code for a request, one generator per client (docs/tools/specs/curl-to-code.md §5, «Код»): JavaScript `fetch`,
 * Python `requests`, Go `net/http`, Rust `reqwest` (blocking). Every string goes through the language's literal writer
 * (literals.ts); nothing of the request is put into code any other way.
 */
import {
  goBytes,
  goString,
  isAscii,
  jsBytes,
  jsLatin1,
  jsString,
  pyBytes,
  pyString,
  rustBytes,
  rustString,
} from './literals';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import type { CurlRequest, FormField, Generated, Generator, Target } from './types';

const utf8 = new TextEncoder();
const lower = (s: string): string => s.toLowerCase();

/** Whole milliseconds of a timeout, at least 1 (0 would mean "no timeout" or "abort at once"). */
const milliseconds = (seconds: number): number => Math.max(1, Math.round(seconds * 1000));

/** Distinct names in a form (Python writes a list when a name repeats). */
const repeatsNames = (fields: FormField[]): boolean => new Set(fields.map(f => f.name)).size !== fields.length;

// ----------------------------------------------------------------------------------------------------------------------
// JavaScript (fetch)

/** Fetch Standard §2.2.2, "forbidden request-header": a browser drops them; Node sends them. */
const FORBIDDEN = new Set(
  [
    'accept-charset',
    'accept-encoding',
    'access-control-request-headers',
    'access-control-request-method',
    'connection',
    'content-length',
    'cookie',
    'cookie2',
    'date',
    'dnt',
    'expect',
    'host',
    'keep-alive',
    'origin',
    'referer',
    'set-cookie',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'via',
  ].map(lower),
);
const isForbidden = (name: string): boolean =>
  FORBIDDEN.has(lower(name)) || lower(name).startsWith('proxy-') || lower(name).startsWith('sec-');

const javascript: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const lines: string[] = [];
    const body = request.body;
    const files = body?.kind === 'file' || (body?.kind === 'multipart' && body.fields.some(f => 'file' in f));
    if (files) {
      lines.push("import { readFile } from 'node:fs/promises';", '');
      warnings.push('The code reads files with node:fs: run it in Node.');
    }
    if (body?.kind === 'multipart') {
      lines.push('const form = new FormData();');
      for (const f of body.fields)
        lines.push(
          'file' in f
            ? `form.append(${jsString(f.name)}, new Blob([await readFile(${jsString(f.file)})]), ${jsString(f.filename)});`
            : `form.append(${jsString(f.name)}, ${jsString(f.value)});`,
        );
      lines.push('');
    }

    const options: string[] = [];
    if (request.method !== 'GET') options.push(`  method: ${jsString(request.method)}`);
    const headers = request.headers.map(([name, value]) => {
      if (isForbidden(name)) warnings.push(`A browser does not let fetch set the ${name} header (Node does).`);
      if (isAscii(value)) return `    ${jsString(name)}: ${jsString(value)}`;
      warnings.push(
        `The ${name} header is written as UTF-8 bytes, as curl sends it: fetch sends a header's characters as bytes.`,
      );
      return `    ${jsString(name)}: ${jsLatin1(value)}`;
    });
    if (request.user) {
      const basic = bytesToBase64(utf8.encode(`${request.user[0]}:${request.user[1]}`));
      headers.push(`    'Authorization': ${jsString(`Basic ${basic}`)}`);
    }
    if (headers.length > 0) options.push(`  headers: {\n${headers.join(',\n')}\n  }`);
    if (body && (request.method === 'GET' || request.method === 'HEAD'))
      warnings.push(`fetch cannot send a body with ${request.method}; the body is left out.`);
    else if (body) {
      const value =
        body.kind === 'raw'
          ? jsString(body.text)
          : body.kind === 'binary'
            ? jsBytes(body.bytes)
            : body.kind === 'multipart'
              ? 'form'
              : body.strip
                ? `(await readFile(${jsString(body.path)})).filter(b => b !== 10 && b !== 13)`
                : `await readFile(${jsString(body.path)})`;
      options.push(`  body: ${value}`);
    }
    if (request.timeoutSeconds !== null)
      options.push(`  signal: AbortSignal.timeout(${milliseconds(request.timeoutSeconds)})`);
    if (request.insecure) warnings.push('-k: fetch cannot skip certificate checks; left out.');

    lines.push(
      options.length === 0
        ? `const response = await fetch(${jsString(request.url)});`
        : `const response = await fetch(${jsString(request.url)}, {\n${options.join(',\n')}\n});`,
    );
    return { text: `${lines.join('\n')}\n`, warnings };
  },
};

// ----------------------------------------------------------------------------------------------------------------------
// Python (requests)

const PY_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
/** A text for requests: `str`, or UTF-8 `bytes` when it is not ASCII (requests would send Latin-1 or fail). */
const pyText = (text: string): string => (isAscii(text) ? pyString(text) : `${pyString(text)}.encode()`);

const python: Generator = {
  generate(request) {
    const blocks: string[] = ['import requests'];
    const args: string[] = [pyString(request.url)];
    if (request.headers.length > 0) {
      blocks.push(`headers = {\n${request.headers.map(([n, v]) => `    ${pyString(n)}: ${pyText(v)},\n`).join('')}}`);
      args.push('headers=headers');
    }
    const body = request.body;
    if (body?.kind === 'raw') {
      blocks.push(`data = ${pyText(body.text)}`);
      args.push('data=data');
    } else if (body?.kind === 'binary') {
      blocks.push(`data = ${pyBytes(body.bytes)}`);
      args.push('data=data');
    } else if (body?.kind === 'file') {
      const read = body.strip ? "f.read().replace(b'\\r', b'').replace(b'\\n', b'')" : 'f.read()';
      blocks.push(`with open(${pyString(body.path)}, 'rb') as f:\n    data = ${read}`);
      args.push('data=data');
    } else if (body?.kind === 'multipart') {
      const value = (f: FormField): string =>
        'file' in f ? `(${pyString(f.filename)}, open(${pyString(f.file)}, 'rb'))` : `(None, ${pyString(f.value)})`;
      blocks.push(
        repeatsNames(body.fields)
          ? `files = [\n${body.fields.map(f => `    (${pyString(f.name)}, ${value(f)}),\n`).join('')}]`
          : `files = {\n${body.fields.map(f => `    ${pyString(f.name)}: ${value(f)},\n`).join('')}}`,
      );
      args.push('files=files');
    }
    if (request.user) args.push(`auth=(${pyText(request.user[0])}, ${pyText(request.user[1])})`);
    if (request.timeoutSeconds !== null) args.push(`timeout=${String(request.timeoutSeconds)}`);
    if (request.insecure) args.push('verify=False');

    const helper = PY_METHODS.has(request.method);
    const call = helper ? `requests.${lower(request.method)}(` : 'requests.request(';
    if (!helper) args.unshift(pyString(request.method));
    blocks.push(
      helper && args.length === 1
        ? `response = ${call}${args[0]})`
        : `response = ${call}\n${args.map(a => `    ${a},\n`).join('')})`,
    );
    return { text: `${blocks.join('\n\n')}\n`, warnings: [] };
  },
};

// ----------------------------------------------------------------------------------------------------------------------
// Go (net/http)

const goDuration = (seconds: number): string =>
  Number.isInteger(seconds) ? `${seconds} * time.Second` : `${milliseconds(seconds)} * time.Millisecond`;

const FATAL = '\tif err != nil {\n\t\tlog.Fatal(err)\n\t}';

const go: Generator = {
  generate(request) {
    const imports = new Set(['fmt', 'io', 'log', 'net/http']);
    const main: string[] = [];
    const after: string[] = [];
    const body = request.body;
    let bodyArg = 'nil';
    if (body?.kind === 'raw') {
      imports.add('strings');
      main.push(`\tbody := strings.NewReader(${goString(body.text)})`);
      bodyArg = 'body';
    } else if (body?.kind === 'binary') {
      imports.add('strings');
      main.push(`\tbody := strings.NewReader(${goBytes(body.bytes)})`);
      bodyArg = 'body';
    } else if (body?.kind === 'file') {
      imports.add('bytes').add('os');
      main.push(`\tdata, err := os.ReadFile(${goString(body.path)})`, FATAL);
      if (body.strip)
        main.push(
          '\tdata = bytes.ReplaceAll(data, []byte("\\r"), nil)',
          '\tdata = bytes.ReplaceAll(data, []byte("\\n"), nil)',
        );
      main.push('\tbody := bytes.NewReader(data)');
      bodyArg = 'body';
    } else if (body?.kind === 'multipart') {
      imports.add('bytes').add('mime/multipart');
      main.push('\tvar body bytes.Buffer', '\tform := multipart.NewWriter(&body)');
      for (const f of body.fields)
        main.push(
          'file' in f
            ? `\taddFile(form, ${goString(f.name)}, ${goString(f.file)}, ${goString(f.filename)})`
            : `\tform.WriteField(${goString(f.name)}, ${goString(f.value)})`,
        );
      main.push('\tform.Close()');
      bodyArg = '&body';
      if (body.fields.some(f => 'file' in f)) {
        imports.add('os');
        after.push(
          '',
          'func addFile(form *multipart.Writer, field, path, filename string) {',
          '\tdata, err := os.ReadFile(path)',
          FATAL,
          '\tpart, err := form.CreateFormFile(field, filename)',
          FATAL,
          '\tpart.Write(data)',
          '}',
        );
      }
    }
    main.push(
      `\treq, err := http.NewRequest(${goString(request.method)}, ${goString(request.url)}, ${bodyArg})`,
      FATAL,
    );
    if (body?.kind === 'multipart') main.push('\treq.Header.Set("Content-Type", form.FormDataContentType())');
    for (const [name, value] of request.headers)
      main.push(
        lower(name) === 'host'
          ? `\treq.Host = ${goString(value)}`
          : `\treq.Header.Set(${goString(name)}, ${goString(value)})`,
      );
    if (request.user) main.push(`\treq.SetBasicAuth(${goString(request.user[0])}, ${goString(request.user[1])})`);
    main.push('');

    let client = 'http.DefaultClient';
    if (request.timeoutSeconds !== null || request.insecure) {
      const fields: string[] = [];
      if (request.timeoutSeconds !== null) {
        imports.add('time');
        fields.push(`\t\tTimeout: ${goDuration(request.timeoutSeconds)},`);
      }
      if (request.insecure) {
        imports.add('crypto/tls');
        fields.push(
          '\t\tTransport: &http.Transport{',
          '\t\t\tTLSClientConfig: &tls.Config{InsecureSkipVerify: true},',
          '\t\t},',
        );
      }
      main.push('\tclient := &http.Client{', ...fields, '\t}');
      client = 'client';
    }
    main.push(
      `\tresp, err := ${client}.Do(req)`,
      FATAL,
      '\tdefer resp.Body.Close()',
      '\tout, err := io.ReadAll(resp.Body)',
      FATAL,
      '\tfmt.Printf("%s\\n", out)',
    );
    const sorted = [...imports].sort();
    const text = [
      'package main',
      '',
      'import (',
      ...sorted.map(i => `\t"${i}"`),
      ')',
      '',
      'func main() {',
      ...main,
      '}',
      ...after,
    ].join('\n');
    return { text: `${text}\n`, warnings: [] };
  },
};

// ----------------------------------------------------------------------------------------------------------------------
// Rust (reqwest, blocking)

const RUST_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

const rustDuration = (seconds: number): string =>
  Number.isInteger(seconds) ? `Duration::from_secs(${seconds})` : `Duration::from_millis(${milliseconds(seconds)})`;

const rust: Generator = {
  generate(request) {
    const body = request.body;
    const multipart = body?.kind === 'multipart';
    const top = [
      `// Cargo.toml: reqwest = { version = "0.12", features = [${multipart ? '"blocking", "multipart"' : '"blocking"'}] }`,
      '',
    ];
    if (request.timeoutSeconds !== null) top.push('use std::time::Duration;', '');
    const main: string[] = ['fn main() -> Result<(), Box<dyn std::error::Error>> {'];
    if (body?.kind === 'multipart') {
      main.push('    let form = reqwest::blocking::multipart::Form::new()');
      body.fields.forEach((f, i) => {
        const end = i === body.fields.length - 1 ? ';' : '';
        main.push(
          'file' in f
            ? `        .file(${rustString(f.name)}, ${rustString(f.file)})?${end}`
            : `        .text(${rustString(f.name)}, ${rustString(f.value)})${end}`,
        );
      });
      if (body.fields.length === 0) main[main.length - 1] += ';';
    }
    if (body?.kind === 'file') {
      main.push(`    let ${body.strip ? 'mut ' : ''}data = std::fs::read(${rustString(body.path)})?;`);
      if (body.strip) main.push("    data.retain(|b| *b != b'\\r' && *b != b'\\n');");
    }
    if (request.timeoutSeconds !== null || request.insecure) {
      main.push('    let client = reqwest::blocking::Client::builder()');
      if (request.insecure) main.push('        .danger_accept_invalid_certs(true)');
      if (request.timeoutSeconds !== null) main.push(`        .timeout(${rustDuration(request.timeoutSeconds)})`);
      main.push('        .build()?;');
    } else main.push('    let client = reqwest::blocking::Client::new();');
    main.push('    let response = client');
    const url = rustString(request.url);
    main.push(
      RUST_METHODS.has(request.method)
        ? `        .${lower(request.method)}(${url})`
        : `        .request(reqwest::Method::from_bytes(${rustBytes(utf8.encode(request.method))})?, ${url})`,
    );
    for (const [name, value] of request.headers)
      main.push(
        `        .header(${rustString(name)}, ${isAscii(value) ? rustString(value) : `${rustString(value)}.as_bytes()`})`,
      );
    if (request.user)
      main.push(`        .basic_auth(${rustString(request.user[0])}, Some(${rustString(request.user[1])}))`);
    if (body?.kind === 'raw') main.push(`        .body(${rustString(body.text)})`);
    else if (body?.kind === 'binary') main.push(`        .body(&${rustBytes(body.bytes)}[..])`);
    else if (body?.kind === 'file') main.push('        .body(data)');
    else if (body?.kind === 'multipart') main.push('        .multipart(form)');
    main.push('        .send()?;', '    println!("{}", response.text()?);', '    Ok(())', '}');
    return { text: `${[...top, ...main].join('\n')}\n`, warnings: [] };
  },
};

/** The generators by target: the one place a target is chosen. */
export const GENERATORS: Readonly<Record<Target, Generator>> = { javascript, python, go, rust };

export const generate = (request: CurlRequest, target: Target): Generated => GENERATORS[target].generate(request);
