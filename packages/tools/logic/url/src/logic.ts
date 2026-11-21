/**
 * The URL tool's logic (docs/tools/specs/url.md §9): percent-encoding and decoding of text, parsing a URL into its
 * parts and query parameters, and the start page's `detectUrl`. Pure: no React, no DOM, no chrome, no network — a URL
 * is only parsed, never fetched or resolved.
 *
 * Which standard decides what (§5):
 *   encoding   the bytes are UTF-8 (a lone surrogate becomes U+FFFD); hex digits upper case (RFC 3986 §2.1). What stays
 *              as is depends on the style: `component` — RFC 3986 «unreserved» (§2.3), space `%20`; `form` — the URL
 *              Standard's application/x-www-form-urlencoded set (§1.3, §5.2), space `+`, as URLSearchParams; `whole` —
 *              ECMA-262 encodeURI's set plus `[`, `]` and an existing `%XX`.
 *   decoding   the URL Standard's percent-decode (§1.3) once, then UTF-8 decode without BOM (WHATWG Encoding §6):
 *              invalid bytes become U+FFFD, a leading BOM is kept; `+` is a space only when asked.
 *   parsing    the platform's WHATWG URL parser (`new URL(input)`, no base): case, dot segments, default ports,
 *              Punycode (IDNA, URL Standard §3.3) and the query (`searchParams`, §5.1) are the browser's.
 */

import { decodeUrl } from './codec';
import { DEFAULT_PORTS, originOf, platformParse, SCHEME, stripped, trimEdges } from './platform';
import type { PartKey } from './platform';

export interface UrlPart {
  key: PartKey;
  value: string;
  /** Percent-decoded value, only for username, password, pathname, hash and only when it differs. */
  decoded?: string;
  /** Port only: the value is the scheme's default port, absent from the URL. */
  isDefault?: boolean;
}

export interface QueryParam {
  name: string;
  value: string;
}

export type ParseResult =
  | {
      ok: true;
      href: string;
      /** Always nine, in the order of PartKey above. */
      parts: UrlPart[];
      params: QueryParam[];
      /** The input had a tab or a line break between its first and last non-space characters. */
      removedWhitespace: boolean;
    }
  | { ok: false; message: string };

export const MAX_INPUT = 5 * 1024 * 1024;
export const MAX_PARSE_INPUT = 1024 * 1024;
export const LIVE_INPUT = 256 * 1024;
export const MAX_PARAM_ROWS = 1000;

export const NOT_ABSOLUTE = 'Not an absolute URL: add a scheme such as https://';
export const NOT_VALID = 'Not a valid URL.';

/** The parts in the order the table shows them, with their labels (§5 «Части»). */
export const PART_LABELS: Readonly<Record<PartKey, string>> = {
  protocol: 'Scheme',
  username: 'Username',
  password: 'Password',
  hostname: 'Host',
  port: 'Port',
  origin: 'Origin',
  pathname: 'Path',
  search: 'Query',
  hash: 'Fragment',
};
const PART_KEYS = Object.keys(PART_LABELS) as PartKey[];

const decodedIfDifferent = (value: string): string | undefined => {
  const { text } = decodeUrl(value, { plusAsSpace: false });
  return text === value ? undefined : text;
};

/** Parses `input` as the browser does, with no base (§5 «Разбор»). Never throws. */
export const parseUrl = (input: string): ParseResult => {
  const url = platformParse(input);
  if (!url) return { ok: false, message: SCHEME.test(stripped(input)) ? NOT_VALID : NOT_ABSOLUTE };
  const parts = PART_KEYS.map((key): UrlPart => {
    const value = key === 'origin' ? originOf(url) : url[key];
    if (key === 'port' && value === '' && DEFAULT_PORTS[url.protocol] !== undefined)
      return { key, value: DEFAULT_PORTS[url.protocol]!, isDefault: true };
    if (key === 'username' || key === 'password' || key === 'pathname' || key === 'hash') {
      const decoded = decodedIfDifferent(value);
      if (decoded !== undefined) return { key, value, decoded };
    }
    return { key, value };
  });
  const params: QueryParam[] = [];
  for (const [name, value] of url.searchParams) params.push({ name, value });
  return {
    ok: true,
    href: url.href,
    parts,
    params,
    removedWhitespace: /[\t\n\r]/.test(trimEdges(input)),
  };
};

/**
 * Pretty JSON (2 spaces) of the parameters (§5 «JSON параметров»): an object, names in the order they first appear, a
 * name seen once gives a string, seen more often an array of strings. Written by hand rather than through an object, so
 * that `__proto__` is an ordinary key and a name that looks like an array index (`?b=1&2=x`) keeps its place — a
 * JavaScript object would move it to the front.
 */
export const paramsToJson = (params: readonly QueryParam[]): string => {
  const byName = new Map<string, string[]>();
  for (const { name, value } of params) {
    const values = byName.get(name);
    if (values) values.push(value);
    else byName.set(name, [value]);
  }
  if (byName.size === 0) return '{}';
  const lines: string[] = [];
  for (const [name, values] of byName) {
    const value =
      values.length === 1
        ? JSON.stringify(values[0])
        : `[\n${values.map(v => `    ${JSON.stringify(v)}`).join(',\n')}\n  ]`;
    lines.push(`  ${JSON.stringify(name)}: ${value}`);
  }
  return `{\n${lines.join(',\n')}\n}`;
};
