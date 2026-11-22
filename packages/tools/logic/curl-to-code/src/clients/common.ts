/**
 * What the client writers share (docs/tools/specs/curl-to-code.md §5, «Код»): timeouts, credentials, the headers a client
 * sets itself or refuses, a multipart part as curl writes it, and the warnings' words. Every warning names the option
 * or header it is about and what the code does instead (§5, «Предупреждения»).
 */
import { isInvisible } from '../literals/common';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import type { CurlRequest, FormField } from '../types';

export const utf8 = new TextEncoder();
export const lower = (s: string): string => s.toLowerCase();

/** Whole milliseconds of a timeout, at least 1 (0 would mean "no timeout" or "abort at once"). */
export const milliseconds = (seconds: number): number => Math.max(1, Math.round(seconds * 1000));

/** `Basic <Base64 of the UTF-8 of user:password>`, as curl sends it. */
export const basicValue = ([user, password]: [string, string]): string =>
  `Basic ${bytesToBase64(utf8.encode(`${user}:${password}`))}`;

/** Do two fields of a form share a name? */
export const repeatsNames = (fields: readonly FormField[]): boolean =>
  new Set(fields.map(f => f.name)).size !== fields.length;

export const hasFiles = (request: CurlRequest): boolean =>
  request.body?.kind === 'file' || (request.body?.kind === 'multipart' && request.body.fields.some(f => 'file' in f));

export const headerValue = (request: CurlRequest, name: string): string | undefined =>
  request.headers.find(([n]) => lower(n) === lower(name))?.[1];

/** Does the request have a body of bytes (not a form) and no Content-Type of its own (`-T file`)? */
export const bodyWithoutType = (request: CurlRequest): boolean =>
  request.body !== null && request.body.kind !== 'multipart' && headerValue(request, 'Content-Type') === undefined;

// ----------------------------------------------------------------------------------------------------------------------
// Headers a client sets itself or refuses.

/** What a client does with a header of the command: `own` — sets it itself, `refused` — will not send it. */
export type HeaderRule = 'own' | 'refused';

/**
 * The headers of the request a client can send, and a warning for each one it cannot: "The Host header: Node's fetch
 * sets it itself; left out." Rules are by lower-case name.
 */
export const screenHeaders = (
  headers: ReadonlyArray<[string, string]>,
  client: string,
  rules: Readonly<Record<string, HeaderRule>>,
  warnings: string[],
): Array<[string, string]> =>
  headers.filter(([name]) => {
    const rule = rules[lower(name)];
    if (!rule) return true;
    warnings.push(`The ${name} header: ${client} ${rule === 'own' ? 'sets it itself' : 'refuses it'}; left out.`);
    return false;
  });

// ----------------------------------------------------------------------------------------------------------------------
// Warnings shared by several clients.

export const insecureWarning = (client: string): string => `-k: ${client} cannot skip certificate checks; left out.`;
export const perWaitTimeout = (client: string): string =>
  `-m: ${client} times out each wait for the server, not the whole request.`;
export const noDecompress = (client: string): string =>
  `--compressed: ${client} does not decompress responses; left out.`;
export const noRedirects = (client: string): string => `-L: ${client} does not follow redirects; left out.`;
export const noBodyWith = (client: string, method: string): string =>
  `${client} cannot send a body with ${method}; the body is left out.`;
export const defaultType = (client: string): string =>
  `${client} adds Content-Type: application/x-www-form-urlencoded to a body without one.`;
export const utf8Header = (name: string, client: string): string =>
  `The ${name} header is written as UTF-8 bytes, as curl sends it: ${client} sends a header's characters as bytes.`;
export const nonAsciiHeader = (name: string, client: string): string =>
  `The ${name} header: ${client} sends only ASCII in a header; left out.`;
export const readsFiles = (how: string): string => `The code reads files with ${how}.`;
export const capitals = (client: string, method: string): string =>
  `${client} sends the method in capitals: ${method.toUpperCase()}.`;

/**
 * A warning for each form field whose name or file name the client writes otherwise than curl (curl: `"` as %22, CR as
 * %0D, LF as %0A, everything else as it is): `trouble` — the characters it writes otherwise, `how` — what it does.
 */
export const formNameWarnings = (
  fields: readonly FormField[],
  client: string,
  trouble: RegExp,
  how: string,
  filenameTrouble: RegExp = trouble,
): string[] =>
  fields
    .filter(f => trouble.test(f.name) || ('file' in f && filenameTrouble.test(f.filename)))
    .map(f => `-F ${f.name}: ${client} writes this form name or file name otherwise than curl (${how}).`);

// ----------------------------------------------------------------------------------------------------------------------
// A multipart part as curl 8 writes it, for the clients that have no form of their own (Java, Swift, http.client).

/** curl's form escaping of a name or file name (mime.c, the HTML5 strategy): `"` → %22, CR → %0D, LF → %0A. */
const escapeFormName = (name: string): string =>
  name.replaceAll('"', '%22').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

/** curl's guess of a file part's type from its name (mime.c, `ContentTypeForFilename`). */
const FILE_TYPES: ReadonlyArray<[string, string]> = [
  ['.gif', 'image/gif'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain'],
  ['.htm', 'text/html'],
  ['.html', 'text/html'],
  ['.pdf', 'application/pdf'],
  ['.xml', 'application/xml'],
];
const fileType = (filename: string): string =>
  FILE_TYPES.find(([ext]) => lower(filename).endsWith(ext))?.[1] ?? 'application/octet-stream';

/** The header lines of a part, joined by CRLF, without the blank line after them. */
export const partHead = (field: FormField): string =>
  'file' in field
    ? `Content-Disposition: form-data; name="${escapeFormName(field.name)}"; filename="${escapeFormName(field.filename)}"\r\nContent-Type: ${fileType(field.filename)}`
    : `Content-Disposition: form-data; name="${escapeFormName(field.name)}"`;

// ----------------------------------------------------------------------------------------------------------------------
// Addresses.

/**
 * Would a strict RFC 3986 parser take the URL as it is (java.net.URI, Ruby's URI)? Only the characters RFC 3986 allows
 * (unreserved, reserved, `%` with two hex digits); `nonAscii` — whether the parser also takes characters above U+007F
 * (java.net.URI does, Ruby's does not).
 */
export const strictUrl = (url: string, nonAscii: boolean): boolean =>
  /^(?:[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]|%[0-9A-Fa-f]{2})*$/.test(nonAscii ? url.replace(/[^\0-\x7f]/g, 'a') : url) &&
  ![...url].some(c => isInvisible(c.codePointAt(0)!));

/** Does the query of the URL (after `?`, before `#`) have characters that are not ASCII? */
const nonAsciiQuery = (url: string): boolean => {
  const q = url.indexOf('?');
  if (q < 0) return false;
  const hash = url.indexOf('#', q);
  return /[^\0-\x7f]/.test(url.slice(q, hash < 0 ? undefined : hash));
};

/**
 * curl 8 percent-encodes the characters of a URL's path that are not ASCII but sends those of its query as UTF-8
 * bytes (checked with curl 8.7.1); the clients percent-encode both — all but libcurl (PHP) and Go's net/http.
 */
export const queryWarnings = (url: string, client: string): string[] =>
  nonAsciiQuery(url)
    ? [
        `The URL's query has characters that are not ASCII: curl sends them as UTF-8 bytes, ${client} percent-encodes them.`,
      ]
    : [];

/** The URL with every character that is not ASCII percent-encoded (UTF-8), for clients that take only ASCII. */
export const asciiUrl = (url: string): string => url.replace(/[^\0-\x7f]+/gu, s => encodeURIComponent(s));

/** A URL as scheme, authority (host[:port]), target (path and query, `/` when empty) — the fragment is not sent. */
export interface UrlParts {
  scheme: string;
  authority: string;
  target: string;
  /** user:password@ in the authority (curl sends it as Basic credentials). */
  userinfo: boolean;
}

export const splitUrl = (url: string): UrlParts | null => {
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^#]*)/.exec(url);
  if (!m) return null;
  const target = m[3] === '' ? '/' : m[3]!.startsWith('?') ? `/${m[3]}` : m[3]!;
  return { scheme: lower(m[1]!), authority: m[2]!, target, userinfo: m[2]!.includes('@') };
};
