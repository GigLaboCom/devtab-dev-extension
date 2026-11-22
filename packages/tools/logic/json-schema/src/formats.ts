import { draftRank } from './drafts';
import { aLabelLength, labelPasses, punycodeDecode } from './idna';
import type { Draft } from './drafts';
/**
 * The formats the tool checks when `Check formats` is on (docs/tools/specs/json-schema.md §5 п. 24). Every check is
 * one anchored expression without nested repetition, or a walk over the characters: linear on any string. A format this
 * module does not know is never checked (an annotation, as the standard says).
 */

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const validDate = (y: number, m: number, d: number): boolean =>
  m >= 1 && m <= 12 && d >= 1 && d <= (m === 2 && isLeap(y) ? 29 : DAYS[m - 1]!);

const date = (s: string): boolean => {
  const m = DATE.exec(s);
  return !!m && validDate(Number(m[1]), Number(m[2]), Number(m[3]));
};

const TIME = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/;

/** RFC 3339 full-time; a leap second (:60) only where it falls on 23:59 UTC. */
const time = (s: string): boolean => {
  const m = TIME.exec(s);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (h > 23 || min > 59 || sec > 60) return false;
  let offset = 0;
  if (!m[4]) {
    const oh = Number(m[6]);
    const om = Number(m[7]);
    if (oh > 23 || om > 59) return false;
    offset = (m[5] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  if (sec === 60) {
    const utc = (((h * 60 + min - offset) % 1440) + 1440) % 1440;
    return utc === 23 * 60 + 59;
  }
  return true;
};

const dateTime = (s: string): boolean => {
  const t = s.search(/[Tt]/);
  return t === 10 && date(s.slice(0, 10)) && time(s.slice(11));
};

const DURATION =
  /^P(?:\d+W|(?:\d+Y(?:\d+M(?:\d+D)?)?|\d+M(?:\d+D)?|\d+D)(?:T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))?|T(?:\d+H(?:\d+M(?:\d+S)?)?|\d+M(?:\d+S)?|\d+S))$/;

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const ipv4 = (s: string): boolean => IPV4.test(s);

const HEX4 = /^[0-9A-Fa-f]{1,4}$/;
const ipv6 = (s: string): boolean => {
  if (s.length > 45 || !/^[0-9A-Fa-f:.]+$/.test(s)) return false;
  let text = s;
  const lastColon = text.lastIndexOf(':');
  if (text.includes('.')) {
    if (!ipv4(text.slice(lastColon + 1))) return false;
    text = `${text.slice(0, lastColon + 1)}0:0`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return false;
  const parts = (h: string): string[] | null => (h === '' ? [] : h.split(':'));
  const left = parts(halves[0]!);
  const right = halves.length === 2 ? parts(halves[1]!) : [];
  if (!left || !right) return false;
  if (![...left, ...right].every(g => HEX4.test(g))) return false;
  const n = left.length + right.length;
  return halves.length === 2 ? n <= 7 : n === 8;
};

const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
/** RFC 1123 host names; from draft 7 on (RFC 5890) an A-label (`xn--…`) must be valid Punycode of a valid U-label. */
const hostname = (s: string, draft: Draft = '2020-12'): boolean => {
  if (s.length === 0 || s.length > 253) return false;
  const idna = draftRank(draft) >= 7;
  return s.split('.').every(l => {
    if (!LABEL.test(l)) return false;
    if (!idna) return true;
    if (/^xn--/i.test(l)) {
      const u = punycodeDecode(l.slice(4));
      return u !== null && u.length > 0 && labelPasses(u);
    }
    return !(l.length >= 4 && l[2] === '-' && l[3] === '-');
  });
};

// Letters, marks, digits, the CONTEXTO/CONTEXTJ characters and the PVALID exceptions of RFC 5892 §2.6. The joiners stand
// apart: inside the class after a mark they would read as one joined sequence.
const U_LABEL =
  /^(?:[\p{L}\p{M}\p{N}\u00B7\u0375\u05F3\u05F4\u30FB\u00DF\u03C2\u06FD\u06FE\u0F0B\u3007-]|\u200C|\u200D)+$/u;
/** Unicode host names: mapped as UTS 46 roughly does (NFKC, lower case), then each label as an A-label or a U-label. */
const idnHostname = (s: string): boolean => {
  if (s.length === 0) return false;
  // UTS 46 maps a zero width space (and the other default ignorables of its table) to nothing.
  const mapped = s
    .replace(/[\u00AD\u200B\u2060\uFEFF]/g, '')
    .normalize('NFKC')
    .toLowerCase();
  const labels = mapped.split(/[.\u3002\uFF0E\uFF61]/);
  let total = labels.length - 1;
  for (const l of labels) {
    let u = l;
    if (/^xn--/.test(l)) {
      const decoded = punycodeDecode(l.slice(4));
      // An A-label decodes to a U-label: not plain ASCII, already in its mapped form, of allowed characters.
      if (decoded === null || ![...decoded].some(ch => ch.charCodeAt(0) > 0x7f) || !U_LABEL.test(decoded)) return false;
      if (decoded.normalize('NFKC').toLowerCase() !== decoded) return false;
      u = decoded;
    } else if (!U_LABEL.test(l)) return false;
    if (!labelPasses(u)) return false;
    const len = aLabelLength(u);
    if (len > 63) return false;
    total += len;
  }
  return total <= 253;
};

const ATEXT = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]";
const DOT_ATOM = new RegExp(`^${ATEXT}+(?:\\.${ATEXT}+)*$`);
const QUOTED = /^"(?:[^"\\\r\n]|\\[\x20-\x7e])*"$/;
const email = (s: string, idn: boolean): boolean => {
  const at = s.lastIndexOf('@');
  if (at <= 0 || at === s.length - 1) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const localOk = idn
    ? QUOTED.test(local) || /^[^\s@".()<>[\]\\,;:]+(?:\.[^\s@".()<>[\]\\,;:]+)*$/u.test(local)
    : QUOTED.test(local) || DOT_ATOM.test(local);
  if (!localOk || local.length > 64) return false;
  if (domain.startsWith('[') && domain.endsWith(']')) {
    const inner = domain.slice(1, -1);
    return inner.toLowerCase().startsWith('ipv6:') ? ipv6(inner.slice(5)) : ipv4(inner);
  }
  return idn ? idnHostname(domain) : hostname(domain, '2020-12');
};

// RFC 3986 characters: unreserved, sub-delims, ':' '@', percent-encodings; IRIs add ucschar (RFC 3987).
const PCT = '%[0-9A-Fa-f]{2}';
const UNRES = "A-Za-z0-9\\-._~!$&'()*+,;=";
const UCS = '\\u{A0}-\\u{D7FF}\\u{F900}-\\u{FDCF}\\u{FDF0}-\\u{FFEF}\\u{10000}-\\u{EFFFD}';
const uriRe = (iri: boolean, relative: boolean): RegExp => {
  const c = `[${UNRES}${iri ? UCS : ''}]`;
  const pchar = `(?:${c}|${PCT}|[:@])`;
  const userinfo = `(?:${c}|${PCT}|:)*`;
  const host = `(?:\\[[0-9A-Fa-f:.vV]+\\]|(?:${c}|${PCT})*)`;
  const authority = `(?:${userinfo}@)?${host}(?::\\d*)?`;
  const path = `(?:/${pchar}*)*`;
  const query = `(?:${pchar}|[/?]${iri ? `|[\\u{E000}-\\u{F8FF}\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}]` : ''})*`;
  const fragment = `(?:${pchar}|[/?])*`;
  const hier = `(?://${authority}${path}|/(?:${pchar}+${path})?|${pchar}+${path}|)`;
  const scheme = '[A-Za-z][A-Za-z0-9+.-]*';
  const relPart = `(?://${authority}${path}|/(?:${pchar}+${path})?|(?:${c}|${PCT}|@)+${path}|)`;
  const absolute = `${scheme}:${hier}(?:\\?${query})?(?:#${fragment})?`;
  const rel = `${relPart}(?:\\?${query})?(?:#${fragment})?`;
  return new RegExp(`^(?:${absolute}${relative ? `|${rel}` : ''})$`, 'u');
};
const ipLiteralOk = (s: string): boolean => {
  const open = s.indexOf('//[');
  if (open < 0) return true;
  const close = s.indexOf(']', open);
  if (close < 0) return false;
  const inner = s.slice(open + 3, close);
  return /^v[0-9A-Fa-f]+\./i.test(inner) || ipv6(inner);
};
const URI = uriRe(false, false);
const URI_REF = uriRe(false, true);
const IRI = uriRe(true, false);
const IRI_REF = uriRe(true, true);

const uriTemplate = (s: string): boolean => {
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === '}') return false;
    if (c !== '{') {
      const code = c.charCodeAt(0);
      if (code <= 0x20 || code === 0x7f || '"<>\\^`|'.includes(c)) return false;
      if (c === '%' && !/^%[0-9A-Fa-f]{2}/.test(s.slice(i, i + 3))) return false;
      i++;
      continue;
    }
    const end = s.indexOf('}', i);
    if (end < 0) return false;
    let body = s.slice(i + 1, end);
    if (body.includes('{')) return false;
    if (/^[+#./;?&=,!@|]/.test(body)) body = body.slice(1);
    const vars = body.split(',');
    for (const v of vars) {
      if (!/^(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*(?::[1-9]\d{0,3}|\*)?$/.test(v))
        return false;
    }
    i = end + 1;
  }
  return true;
};

const JSON_POINTER = /^(?:\/(?:[^~/]|~[01])*)*$/;
const RELATIVE_POINTER = /^(?:0|[1-9]\d*)(?:#|(?:\/(?:[^~/]|~[01])*)*)$/;

/** ECMA-262 with the `u` flag: the strict grammar (no Annex B identity escapes such as `\\a`). */
const regex = (s: string): boolean => {
  try {
    new RegExp(s, 'u');
    return true;
  } catch {
    return false;
  }
};

const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

const CHECKS: Record<string, (s: string, draft: Draft) => boolean> = {
  'date-time': dateTime,
  date,
  time,
  duration: s => DURATION.test(s),
  email: s => email(s, false),
  'idn-email': s => email(s, true),
  hostname: (s, draft) => hostname(s, draft),
  'idn-hostname': idnHostname,
  ipv4,
  ipv6,
  uri: s => URI.test(s) && ipLiteralOk(s),
  'uri-reference': s => URI_REF.test(s) && ipLiteralOk(s),
  iri: s => IRI.test(s) && ipLiteralOk(s),
  'iri-reference': s => IRI_REF.test(s) && ipLiteralOk(s),
  'uri-template': uriTemplate,
  'json-pointer': s => JSON_POINTER.test(s),
  'relative-json-pointer': s => RELATIVE_POINTER.test(s),
  regex,
  uuid: s => UUID.test(s),
};

export const FORMATS: readonly string[] = Object.keys(CHECKS);

/** Does the string pass the format? null — a format this tool does not check (an annotation only). */
export const checkFormat = (format: string, value: string, draft: Draft = '2020-12'): boolean | null => {
  const check = CHECKS[format];
  return check ? check(value, draft) : null;
};

/** For a violation's sentence: `Is not a valid <name> (format "<f>").` */
export const FORMAT_NAMES: Readonly<Record<string, string>> = {
  'date-time': 'date and time',
  date: 'date',
  time: 'time',
  duration: 'duration',
  email: 'email address',
  'idn-email': 'internationalized email address',
  hostname: 'host name',
  'idn-hostname': 'internationalized host name',
  ipv4: 'IPv4 address',
  ipv6: 'IPv6 address',
  uri: 'URI',
  'uri-reference': 'URI reference',
  iri: 'IRI',
  'iri-reference': 'IRI reference',
  'uri-template': 'URI template',
  'json-pointer': 'JSON Pointer',
  'relative-json-pointer': 'relative JSON Pointer',
  regex: 'regular expression',
  uuid: 'UUID',
};
