/**
 * Names (RFC 5280 §4.1.2.4; docs/tools/specs/x509.md §5.5): the attributes in the certificate's order, the RFC 4514
 * string, and what the summary shows.
 */
import { EMPTY_NAME, warnMalformedString } from './messages';
import { ATTRIBUTES } from './oids';
import { fail, isType, must, sequence } from './read';
import { describeTag, isStringType, readOid, readString, UNIVERSAL } from '@workspace/tools-shared/der';
import { bytesToHex } from '@workspace/tools-shared/hex';
import type { Tlv } from '@workspace/tools-shared/der';

export interface NameAttribute {
  oid: string;
  /** The table's label (§5.5), or the OID. */
  label: string;
  /** The RFC 4514 short name (`CN`), when the table has one. */
  short?: string;
  /** The text of a string value; otherwise `#` and the hex of the value's DER. */
  value: string;
  /** The value's type: `UTF8String`, `PrintableString`, … or the tag of a value that is not a string. */
  type: string;
  /** The DER of the value. */
  raw: Uint8Array;
  /** Set when the bytes break the string type's rule. */
  malformed?: string;
}

export interface Name {
  /** RDNs in the certificate's order; each a list of attributes (more than one: a multi-valued RDN). */
  rdns: NameAttribute[][];
  /** The DER of the whole Name (compared byte for byte: self-issued, the chain). */
  der: Uint8Array;
  /** RFC 4514: RDNs in reverse order, `,` between them, `+` inside one; `(empty)` for an empty name. */
  rfc4514: string;
  /** What the summary shows: the (last) common name, else the RFC 4514 string. */
  display: string;
}

/** RFC 4514 §2.4: `\` before `" + , ; < > \` anywhere, before `#` or a space at the start and a space at the end; NUL → `\00`. */
export const escapeRfc4514 = (text: string): string => {
  const chars = Array.from(text);
  return chars
    .map((c, i) => {
      if (c === '\u0000') return '\\00';
      if ('"+,;<>\\'.includes(c)) return `\\${c}`;
      if (i === 0 && (c === '#' || c === ' ')) return `\\${c}`;
      if (i === chars.length - 1 && c === ' ') return '\\ ';
      return c;
    })
    .join('');
};

/** One attribute in RFC 4514: `CN=text` for a short name with a string value, otherwise `oid=#hex`. */
const rfc4514Of = (a: NameAttribute): string =>
  a.short && isStringValue(a)
    ? `${a.short}=${escapeRfc4514(a.value)}`
    : `${a.short ?? a.oid}=#${bytesToHex(a.raw, { uppercase: true })}`;

/** A value of one of the string types (their names end in `String`; `BIT STRING` and `OCTET STRING` do not). */
const isStringValue = (a: NameAttribute): boolean => a.type.endsWith('String');

/** An RDN (a SET of attributes) in RFC 4514: the attributes joined by `+`. */
export const rdnString = (rdn: NameAttribute[]): string => rdn.map(rfc4514Of).join('+');

/** Reads `SET OF AttributeTypeAndValue` — one RDN. `warnings` gets what the field's strings break. */
export const readRdn = (der: Uint8Array, set: Tlv, field: string, warnings: string[]): NameAttribute[] => {
  const items = sequence(der, set, 'a SET of attributes (RDN)', UNIVERSAL.SET);
  if (items.length === 0) fail(set.start, 'an RDN has no attributes');
  return items.map(item => {
    const [type, value, extra] = sequence(der, item, 'an attribute (SEQUENCE of type and value)');
    if (!isType(type, UNIVERSAL.OBJECT_IDENTIFIER))
      return fail(item.body, 'an attribute’s type must be an OBJECT IDENTIFIER');
    if (!value) return fail(item.start, 'an attribute has no value');
    if (extra) fail(extra.start, `unexpected ${describeTag(extra)} after an attribute’s value`);
    const oid = must(readOid(der, type));
    const known = ATTRIBUTES[oid];
    const raw = der.slice(value.start, value.end);
    const base = { oid, label: known?.label ?? oid, ...(known?.short ? { short: known.short } : {}), raw };
    if (isStringType(value)) {
      const s = must(readString(der, value));
      if (s.malformed) warnings.push(warnMalformedString(field, s.malformed));
      return { ...base, value: s.text, type: s.type, ...(s.malformed ? { malformed: s.malformed } : {}) };
    }
    return { ...base, value: `#${bytesToHex(raw, { uppercase: true })}`, type: describeTag(value) };
  });
};

/** Reads a Name (`SEQUENCE OF RDN`). */
export const readName = (der: Uint8Array, tlv: Tlv | undefined, field: string, warnings: string[]): Name => {
  const items = sequence(der, tlv, `the ${field} (a Name)`);
  const rdns = items.map(set => readRdn(der, set, field, warnings));
  const rfc4514 = rdns.length === 0 ? EMPTY_NAME : [...rdns].reverse().map(rdnString).join(',');
  const cns = rdns.flat().filter(a => a.oid === '2.5.4.3');
  const display = cns.length > 0 ? cns[cns.length - 1]!.value : rfc4514;
  return { rdns, der: der.slice(tlv!.start, tlv!.end), rfc4514, display };
};
