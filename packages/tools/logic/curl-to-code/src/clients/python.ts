/**
 * The Python clients (docs/tools/specs/curl-to-code.md §5, «Код»): `requests` and the standard library's `http.client`
 * (no dependency). One family: they share the Python literals.
 */
import {
  capitals,
  lower,
  noDecompress,
  noRedirects,
  partHead,
  perWaitTimeout,
  queryWarnings,
  repeatsNames,
  splitUrl,
  asciiUrl,
} from './common';
import { isAscii } from '../literals/common';
import { pyBytes, pyString } from '../literals/python';
import type { Clients, FormField, Generator } from '../types';

/** A text for Python's HTTP clients: `str`, or UTF-8 `bytes` when it is not ASCII (they would send Latin-1 or fail). */
const pyText = (text: string): string => (isAscii(text) ? pyString(text) : `${pyString(text)}.encode()`);
const utf8 = new TextEncoder();
const STRIP = ".replace(b'\\r', b'').replace(b'\\n', b'')";

const PY_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const requests: Generator = {
  generate(request) {
    const warnings: string[] = [];
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
      blocks.push(`with open(${pyString(body.path)}, 'rb') as f:\n    data = f.read()${body.strip ? STRIP : ''}`);
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
    if (request.timeoutSeconds !== null) {
      args.push(`timeout=${String(request.timeoutSeconds)}`);
      warnings.push(perWaitTimeout('requests'));
    }
    if (request.insecure) args.push('verify=False');
    // requests.head() does not follow redirects unless asked; every other helper does.
    if (request.followRedirects && request.method === 'HEAD') args.push('allow_redirects=True');

    // PreparedRequest.prepare_method: requests sends every method in capitals.
    if (request.method !== request.method.toUpperCase()) warnings.push(capitals('requests', request.method));
    const helper = PY_METHODS.has(request.method);
    const call = helper ? `requests.${lower(request.method)}(` : 'requests.request(';
    if (!helper) args.unshift(pyString(request.method));
    blocks.push(
      helper && args.length === 1
        ? `response = ${call}${args[0]})`
        : `response = ${call}\n${args.map(a => `    ${a},\n`).join('')})`,
    );
    warnings.push(...queryWarnings(request.url, 'requests'));
    return { text: `${blocks.join('\n\n')}\n`, warnings };
  },
};

/**
 * `http.client`: the URL is split here (scheme, host and port, path with query; the fragment is not sent), the body is
 * bytes or ASCII text (a `str` body is sent as Latin-1), a header value that is not ASCII is UTF-8 bytes (a `str` one
 * is sent as Latin-1). It has no form: the parts are written as curl writes them. It follows no redirects and
 * decompresses nothing; its timeout is per socket operation.
 */
const httpClient: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const imports = new Set(['http.client']);
    const blocks: string[] = [];
    // http.client takes only ASCII in the request line: the rest is percent-encoded, as curl does in the path.
    const parts = splitUrl(asciiUrl(request.url)) ?? { scheme: 'http', authority: '', target: '/', userinfo: false };
    warnings.push(...queryWarnings(request.url, 'the code'));
    let authority = parts.authority;
    if (parts.userinfo) {
      authority = authority.slice(authority.lastIndexOf('@') + 1);
      warnings.push('http.client does not read user:password@ in the URL; left out.');
    }
    const https = parts.scheme === 'https';
    if (!https && parts.scheme !== 'http')
      warnings.push(`http.client speaks HTTP and HTTPS only; the code uses HTTP for ${parts.scheme}://.`);

    const connArgs = [pyString(authority)];
    if (request.timeoutSeconds !== null) {
      connArgs.push(`timeout=${String(request.timeoutSeconds)}`);
      warnings.push(perWaitTimeout('http.client'));
    }
    if (request.insecure && https) {
      imports.add('ssl');
      blocks.push(
        'context = ssl.create_default_context()\ncontext.check_hostname = False\ncontext.verify_mode = ssl.CERT_NONE',
      );
      connArgs.push('context=context');
    }

    const headers = request.headers.map(([n, v]) => `    ${pyString(n)}: ${pyText(v)},\n`);
    if (request.user) {
      imports.add('base64');
      // Written out so the credentials stay readable in the code.
      headers.push(
        `    'Authorization': 'Basic ' + base64.b64encode(${pyString(`${request.user[0]}:${request.user[1]}`)}.encode()).decode(),\n`,
      );
    }
    const body = request.body;
    let bodyArg: string | null = null;
    if (body?.kind === 'raw') {
      blocks.push(`body = ${pyText(body.text)}`);
      bodyArg = 'body';
    } else if (body?.kind === 'binary') {
      blocks.push(`body = ${pyBytes(body.bytes)}`);
      bodyArg = 'body';
    } else if (body?.kind === 'file') {
      imports.add('pathlib');
      blocks.push(`body = pathlib.Path(${pyString(body.path)}).read_bytes()${body.strip ? STRIP : ''}`);
      bodyArg = 'body';
    } else if (body?.kind === 'multipart') {
      imports.add('uuid');
      if (body.fields.some(f => 'file' in f)) imports.add('pathlib');
      const content = (f: FormField): string =>
        'file' in f ? `pathlib.Path(${pyString(f.file)}).read_bytes()` : `${pyString(f.value)}.encode()`;
      blocks.push(
        [
          'boundary = uuid.uuid4().hex',
          'parts = [',
          ...body.fields.map(f => `    (${pyBytes(utf8.encode(partHead(f)))}, ${content(f)}),`),
          ']',
          "body = b''.join(",
          "    b'--' + boundary.encode() + b'\\r\\n' + head + b'\\r\\n\\r\\n' + content + b'\\r\\n'",
          '    for head, content in parts',
          ")\nbody += b'--' + boundary.encode() + b'--\\r\\n'",
        ].join('\n'),
      );
      headers.push("    'Content-Type': 'multipart/form-data; boundary=' + boundary,\n");
      bodyArg = 'body';
    }
    blocks.push(headers.length > 0 ? `headers = {\n${headers.join('')}}` : 'headers = {}');

    const call = [pyString(request.method), pyString(parts.target)];
    if (bodyArg) call.push(`body=${bodyArg}`);
    call.push('headers=headers');
    blocks.push(
      [
        `conn = http.client.${https ? 'HTTPSConnection' : 'HTTPConnection'}(${connArgs.join(', ')})`,
        `conn.request(${call.join(', ')})`,
        'response = conn.getresponse()',
        'print(response.read().decode())',
      ].join('\n'),
    );
    if (request.compressed) warnings.push(noDecompress('http.client'));
    if (request.followRedirects) warnings.push(noRedirects('http.client'));
    const head = [...imports].sort().map(i => `import ${i}`);
    return { text: `${[head.join('\n'), ...blocks].join('\n\n')}\n`, warnings };
  },
};

export const clients: Clients = { python: requests, 'http-client': httpClient };
