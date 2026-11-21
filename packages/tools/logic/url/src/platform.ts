/**
 * The platform's WHATWG URL parser (`new URL(input)`, no base), held to the URL Standard where Node's and Chrome's
 * differ. Shared by `parseUrl` and the start page's `detectUrl`; not exported from the package beyond `isBlankUrl`.
 */
import { decodeUrl, encodeUrl } from './codec';

export type PartKey =
  'protocol' | 'username' | 'password' | 'hostname' | 'port' | 'origin' | 'pathname' | 'search' | 'hash';

/**
 * Without the C0 controls and spaces the URL parser drops at the edges (URL Standard §4.4). A loop, not a regular
 * expression: `[…]+$` would rescan every run of spaces inside a long input.
 */
export const trimEdges = (input: string): string => {
  let start = 0;
  let end = input.length;
  while (start < end && input.charCodeAt(start) <= 0x20) start++;
  while (end > start && input.charCodeAt(end - 1) <= 0x20) end--;
  return input.slice(start, end);
};
/** What it drops anywhere: ASCII tab and newline. */
const TAB_OR_NEWLINE = /[\t\n\r]/g;
export const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** The input as the URL parser starts from it: no C0 controls or spaces at the edges, no tabs or newlines anywhere. */
export const stripped = (input: string): string => trimEdges(input).replace(TAB_OR_NEWLINE, '');

/**
 * Is there nothing to parse — an empty input, or only what the parser drops (spaces, C0 controls, tabs, newlines)?
 * Parse shows nothing then, not an error (§6). An addition to §9: the component asks it before `parseUrl`.
 */
export const isBlankUrl = (input: string): boolean => stripped(input) === '';

/** The default port of a special scheme (URL Standard §4.2); `file:` has none. */
export const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
};
const SPECIAL = new Set([...Object.keys(DEFAULT_PORTS), 'file:']);
/** A forbidden domain code point (URL Standard §3.2): a domain that holds one after decoding is not a host. */
const forbiddenInDomain = (host: string): boolean => {
  for (let i = 0; i < host.length; i++) {
    const c = host.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || '#%/:<>?@[\\]^|'.includes(host[i]!)) return true;
  }
  return false;
};
const NON_ASCII = /[\u{80}-\u{10FFFF}]+/gu;

export type Fields = Record<Exclude<PartKey, 'origin'>, string> & { href: string; searchParams: URLSearchParams };

/**
 * The platform's parser, held to the URL Standard where Node's and Chrome's differ (§5 «Разбор», checked by running
 * both on the same inputs, 2026-11-21: Node 22.20, Chrome for Testing 159). Pinned by the tests:
 *   - a special URL's host: Chrome escapes what it does not accept (`exa mple.com` → `exa%20mple.com`, also a no-break
 *     or ideographic space, which IDNA maps to a space) and `*` (→ `%2A`). The standard refuses a domain with a
 *     forbidden code point and keeps `*`: the host is decoded, then refused or kept as decoded;
 *   - `file://localhost/` has an empty host (the standard; Chrome keeps `localhost`);
 *   - a non-special URL with non-ASCII characters: the standard escapes them as UTF-8 everywhere (Chrome refuses some,
 *     U+3000 in the host): they are escaped before parsing, which gives the standard's answer on both;
 *   - `^` in a path is escaped (`%5E`: the current standard's path set, as Chrome; Node 22.20 keeps it).
 * Not pinned: Chrome escapes `|` in a path and `'` in user info, which the standard keeps; a `%7C` or `%27` may have
 * been typed, so it cannot be undone. The decoded values are the same on both.
 */
export const platformParse = (input: string): Fields | null => {
  const scheme = SCHEME.exec(stripped(input))?.[0].toLowerCase();
  const source =
    scheme !== undefined && !SPECIAL.has(scheme) ? input.replace(NON_ASCII, s => encodeUrl(s, 'component')) : input;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  const f: Fields = {
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    searchParams: url.searchParams,
  };
  const tail = (): string => f.pathname + f.search + f.hash;
  if (SPECIAL.has(f.protocol)) {
    let host = f.hostname;
    if (host.includes('%')) {
      const decoded = decodeUrl(host, { plusAsSpace: false });
      if (decoded.invalidUtf8 || forbiddenInDomain(decoded.text)) return null;
      host = decoded.text;
    }
    if (f.protocol === 'file:' && host === 'localhost') host = '';
    if (host !== f.hostname) {
      const userinfo = f.username || f.password ? `${f.username}${f.password ? `:${f.password}` : ''}@` : '';
      f.hostname = host;
      f.href = `${f.protocol}//${userinfo}${host}${f.port ? `:${f.port}` : ''}${tail()}`;
    }
  }
  if (f.pathname.startsWith('/') && f.pathname.includes('^')) {
    const head = f.href.slice(0, f.href.length - tail().length);
    f.pathname = f.pathname.replaceAll('^', '%5E');
    f.href = head + tail();
  }
  return f;
};

/** The URL Standard's origin (§4.7): a tuple for http(s), ws(s) and ftp, the inner URL's for blob, else opaque. */
export const originOf = (f: Fields): string => {
  if (DEFAULT_PORTS[f.protocol] !== undefined) return `${f.protocol}//${f.hostname}${f.port ? `:${f.port}` : ''}`;
  if (f.protocol === 'blob:') {
    const inner = platformParse(f.pathname);
    if (inner && (inner.protocol === 'http:' || inner.protocol === 'https:')) return originOf(inner);
  }
  return 'null';
};
