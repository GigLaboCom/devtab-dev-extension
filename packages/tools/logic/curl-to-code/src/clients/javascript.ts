/**
 * The JavaScript clients (docs/tools/specs/curl-to-code.md §5, «Код»): `fetch` in a browser, `fetch` in Node.js 18+ and
 * axios in Node.js. One family: they share the JavaScript literals and are loaded together.
 */
import {
  basicValue,
  bodyWithoutType,
  capitals,
  defaultType,
  headerValue,
  hasFiles,
  lower,
  milliseconds,
  noBodyWith,
  queryWarnings,
  screenHeaders,
  utf8Header,
} from './common';
import { isAscii } from '../literals/common';
import { jsBytes, jsLatin1, jsString } from '../literals/javascript';
import type { Clients, CurlRequest, FormField, Generator } from '../types';

/** Fetch Standard §2.2.2, "forbidden request-header": a browser drops them. */
const FORBIDDEN = new Set([
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
]);
const NORMALIZED = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);
const isForbidden = (name: string): boolean =>
  FORBIDDEN.has(lower(name)) || lower(name).startsWith('proxy-') || lower(name).startsWith('sec-');

/**
 * What Node's fetch (undici, Node 22) does with a header, checked against a loopback server: it replaces Host and
 * Content-Length with its own and throws on Keep-Alive, Upgrade, Expect and Transfer-Encoding; Connection only as
 * `close` or `keep-alive`. Everything else of the browser's list — Cookie, Referer, Origin, TE, Sec-… — it sends.
 */
const NODE_RULES = {
  host: 'own',
  'content-length': 'own',
  'keep-alive': 'refused',
  upgrade: 'refused',
  expect: 'refused',
  'transfer-encoding': 'refused',
} as const;
const nodeRefuses = (name: string, value: string): boolean =>
  lower(name) in NODE_RULES || (lower(name) === 'connection' && !/^(?:close|keep-alive)$/i.test(value));

const headerLines = (headers: ReadonlyArray<[string, string]>, client: string, warnings: string[]): string[] =>
  headers.map(([name, value]) => {
    if (isAscii(value)) return `    ${jsString(name)}: ${jsString(value)}`;
    warnings.push(utf8Header(name, client));
    return `    ${jsString(name)}: ${jsLatin1(value)}`;
  });

const formLines = (fields: FormField[]): string[] => [
  'const form = new FormData();',
  ...fields.map(f =>
    'file' in f
      ? `form.append(${jsString(f.name)}, new Blob([await readFile(${jsString(f.file)})]), ${jsString(f.filename)});`
      : `form.append(${jsString(f.name)}, ${jsString(f.value)});`,
  ),
  '',
];

const fileRead = (path: string, strip: boolean): string =>
  strip ? `(await readFile(${jsString(path)})).filter(b => b !== 10 && b !== 13)` : `await readFile(${jsString(path)})`;

/** `fetch` in a browser (`node: false`) or in Node.js (`node: true`). */
const fetchWriter = (node: boolean): Generator => ({
  generate(request) {
    const client = node ? "Node's fetch" : 'fetch';
    const warnings: string[] = [];
    const lines: string[] = [];
    const body = request.body;
    if (hasFiles(request)) {
      lines.push("import { readFile } from 'node:fs/promises';", '');
      if (!node) warnings.push('The code reads files with node:fs: run it in Node.');
    }
    if (node && request.insecure)
      lines.push("process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // -k: no certificate checks in this process", '');
    if (body?.kind === 'multipart') lines.push(...formLines(body.fields));

    const options: string[] = [];
    if (request.method !== 'GET') options.push(`  method: ${jsString(request.method)}`);
    // Fetch Standard §2.2.1 "normalize": these six are sent in capitals whatever their case.
    if (NORMALIZED.has(request.method.toUpperCase()) && request.method !== request.method.toUpperCase())
      warnings.push(capitals(client, request.method));
    let headers = request.headers;
    if (node)
      headers = headers.filter(([name, value]) => {
        if (!nodeRefuses(name, value)) return true;
        const rule = NODE_RULES[lower(name) as keyof typeof NODE_RULES] ?? 'refused';
        screenHeaders([[name, value]], client, { [lower(name)]: rule }, warnings);
        return false;
      });
    else
      for (const [name] of headers)
        if (isForbidden(name))
          warnings.push(
            `A browser does not let fetch set the ${name} header (${nodeRefuses(name, headerValue(request, name) ?? '') ? 'nor does Node' : 'Node does'}).`,
          );
    const lines2 = headerLines(headers, client, warnings);
    if (request.user) lines2.push(`    'Authorization': ${jsString(basicValue(request.user))}`);
    if (lines2.length > 0) options.push(`  headers: {\n${lines2.join(',\n')}\n  }`);
    if (body && (request.method === 'GET' || request.method === 'HEAD'))
      warnings.push(noBodyWith(client, request.method));
    else if (body) {
      const value =
        body.kind === 'raw'
          ? jsString(body.text)
          : body.kind === 'binary'
            ? jsBytes(body.bytes)
            : body.kind === 'multipart'
              ? 'form'
              : fileRead(body.path, body.strip);
      options.push(`  body: ${value}`);
    }
    if (request.timeoutSeconds !== null)
      options.push(`  signal: AbortSignal.timeout(${milliseconds(request.timeoutSeconds)})`);
    if (!node && request.insecure) warnings.push('-k: fetch cannot skip certificate checks; left out.');

    lines.push(
      options.length === 0
        ? `const response = await fetch(${jsString(request.url)});`
        : `const response = await fetch(${jsString(request.url)}, {\n${options.join(',\n')}\n});`,
    );
    if (node) lines.push('console.log(await response.text());');
    warnings.push(...queryWarnings(request.url, client));
    return { text: `${lines.join('\n')}\n`, warnings };
  },
});

/** Would axios (1.x, `transformRequest`) send a string body as it is? With a JSON Content-Type it parses the string and
 * sends it trimmed, or JSON-encodes it when it is not JSON; then the code passes a Buffer instead. */
const axiosKeepsString = (request: CurlRequest, text: string): boolean => {
  if (!(headerValue(request, 'Content-Type') ?? '').includes('application/json')) return true;
  try {
    JSON.parse(text);
  } catch {
    return false;
  }
  return text.trim() === text;
};

const axios: Generator = {
  generate(request) {
    const warnings: string[] = [];
    const top = ['// npm install axios', "import axios from 'axios';"];
    if (request.insecure) top.push("import https from 'node:https';");
    if (hasFiles(request)) top.push("import { readFile } from 'node:fs/promises';");
    const lines = [...top, ''];
    const body = request.body;
    if (body?.kind === 'multipart') lines.push(...formLines(body.fields));

    const config: string[] = [];
    if (request.method !== 'GET') config.push(`  method: ${jsString(request.method)}`);
    if (request.method !== request.method.toUpperCase()) warnings.push(capitals('axios', request.method));
    config.push(`  url: ${jsString(request.url)}`);
    const headers = headerLines(request.headers, 'Node', warnings);
    if (headers.length > 0) config.push(`  headers: {\n${headers.join(',\n')}\n  }`);
    if (request.user)
      config.push(
        `  auth: {\n    username: ${jsString(request.user[0])},\n    password: ${jsString(request.user[1])}\n  }`,
      );
    if (body) {
      const value =
        body.kind === 'raw'
          ? axiosKeepsString(request, body.text)
            ? jsString(body.text)
            : `Buffer.from(${jsString(body.text)})`
          : body.kind === 'binary'
            ? `Buffer.from([${Array.from(body.bytes, b => `0x${b.toString(16).padStart(2, '0')}`).join(', ')}])`
            : body.kind === 'multipart'
              ? 'form'
              : fileRead(body.path, body.strip);
      config.push(`  data: ${value}`);
      if (bodyWithoutType(request) && ['post', 'put', 'patch'].includes(lower(request.method)))
        warnings.push(defaultType('axios'));
    }
    if (request.timeoutSeconds !== null)
      config.push(`  signal: AbortSignal.timeout(${milliseconds(request.timeoutSeconds)})`);
    if (request.insecure) config.push('  httpsAgent: new https.Agent({ rejectUnauthorized: false })');
    lines.push(`const response = await axios({\n${config.join(',\n')}\n});`, 'console.log(response.data);');
    warnings.push(...queryWarnings(request.url, 'axios'));
    return { text: `${lines.join('\n')}\n`, warnings };
  },
};

export const clients: Clients = { javascript: fetchWriter(false), node: fetchWriter(true), axios };
