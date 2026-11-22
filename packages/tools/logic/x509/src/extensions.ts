/**
 * The extensions the tool decodes (docs/tools/specs/x509.md §5.8, RFC 5280 §4.2, RFC 6962 §3.3, RFC 7633), each as
 * lines of text. Addresses (OCSP, CA issuers, CRLs, CPS) are text: nothing here — or anywhere in the tool — fetches.
 */
import { formatIp } from './ip';
import { POISON } from './messages';
import { readName, readRdn, rdnString } from './names';
import { ACCESS_METHODS, CPS, KEY_PURPOSES, KEY_USAGE, POLICIES, REASONS, TLS_FEATURES, USER_NOTICE } from './oids';
import { unicodeDomain } from './punycode';
import { fail, hexColons, integerHex, isType, kids, must, sequence } from './read';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import {
  contentOf,
  describeTag,
  explicit,
  isContext,
  isStringType,
  readBitString,
  readBoolean,
  readInteger,
  readNull,
  readOctetString,
  readOid,
  readString,
  UNIVERSAL,
} from '@workspace/tools-shared/der';
import { formatIsoUtc } from '@workspace/tools-shared/time';
import type { Tlv } from '@workspace/tools-shared/der';

/** What decoding an extension may tell the certificate besides its lines. */
export interface ExtensionContext {
  /** Basic constraints say `CA: yes`. */
  ca?: boolean;
  /** Warnings about the certificate (strings that break their type's rule). */
  warnings: string[];
}

type Decoder = (der: Uint8Array, value: Tlv, context: ExtensionContext) => string[];

const text = (der: Uint8Array, tlv: Tlv, as: 'IA5String'): string => must(readString(der, tlv, as)).text;

/** One GeneralName (RFC 5280 §4.2.1.6) as `DNS example.com`, `IP 192.0.2.10`, `Directory CN=…`. */
export const generalName = (der: Uint8Array, tlv: Tlv, context: ExtensionContext, constraint = false): string => {
  if (tlv.cls !== 'context') return fail(tlv.start, `expected a GeneralName, found ${describeTag(tlv)}`, 'wrong-type');
  switch (tlv.tag) {
    case 0: {
      const [type, value, extra] = implicitSequence(der, tlv, 'an other name');
      if (!isType(type, UNIVERSAL.OBJECT_IDENTIFIER))
        return fail(tlv.body, 'an other name starts with its type (an OBJECT IDENTIFIER)');
      if (!value || !isContext(value, 0) || extra) return fail(tlv.start, 'an other name holds its value in [0]');
      const oid = must(readOid(der, type));
      const held = must(explicit(der, value));
      const shown = isStringType(held)
        ? must(readString(der, held)).text
        : hexColons(der.subarray(held.start, held.end));
      return `Other name ${oid}: ${shown}`;
    }
    case 1:
      return `Email ${text(der, tlv, 'IA5String')}`;
    case 2: {
      const name = text(der, tlv, 'IA5String');
      const unicode = unicodeDomain(name);
      return unicode ? `DNS ${name} (${unicode})` : `DNS ${name}`;
    }
    case 3:
      return `X.400 address ${hexColons(contentOf(der, tlv))}`;
    case 4:
      return `Directory ${readName(der, must(explicit(der, tlv)), 'directory name', context.warnings).rfc4514}`;
    case 5:
      return `EDI party name ${hexColons(contentOf(der, tlv))}`;
    case 6:
      return `URI ${text(der, tlv, 'IA5String')}`;
    case 7:
      if (tlv.constructed) return fail(tlv.start, 'an IP address must be primitive', 'constructed-string');
      return `IP ${formatIp(contentOf(der, tlv), constraint)}`;
    case 8:
      return `Registered ID ${must(readOid(der, tlv, true))}`;
    default:
      return fail(tlv.start, `[${tlv.tag}] is not a GeneralName`);
  }
};

const generalNames = (der: Uint8Array, items: Tlv[], context: ExtensionContext): string[] =>
  items.map(item => generalName(der, item, context));

/** An implicitly tagged constructed element read as the SEQUENCE it stands for. */
const implicitSequence = (der: Uint8Array, tlv: Tlv, what: string): Tlv[] => {
  if (!tlv.constructed) return fail(tlv.start, `${what} must be constructed`, 'not-constructed');
  return kids(der, tlv);
};

const bits = (der: Uint8Array, tlv: Tlv, names: string[], implicit = false): string[] => {
  const { bytes } = must(readBitString(der, tlv, implicit));
  const set: string[] = [];
  for (let i = 0; i < bytes.length * 8; i++) if (bytes[i >> 3]! & (0x80 >> (i & 7))) set.push(names[i] ?? `bit ${i}`);
  return set;
};

const basicConstraints: Decoder = (der, value, context) => {
  const items = sequence(der, value, 'basic constraints (a SEQUENCE)');
  let i = 0;
  let ca = false;
  if (isType(items[i], UNIVERSAL.BOOLEAN)) ca = must(readBoolean(der, items[i++]!));
  let path: string | undefined;
  if (isType(items[i], UNIVERSAL.INTEGER)) path = must(readInteger(der, items[i++]!)).toString();
  if (items[i]) fail(items[i]!.start, `unexpected ${describeTag(items[i]!)} in basic constraints`);
  context.ca = ca;
  return [`CA: ${ca ? 'yes' : 'no'}${path !== undefined ? `, path length ${path}` : ''}`];
};

const keyUsage: Decoder = (der, value) => {
  const set = bits(der, value, KEY_USAGE);
  return [set.length > 0 ? set.join(', ') : '(none)'];
};

const extendedKeyUsage: Decoder = (der, value) => {
  const items = sequence(der, value, 'extended key usage (a SEQUENCE of purposes)');
  if (items.length === 0) fail(value.start, 'extended key usage lists no purpose');
  return [
    items
      .map(item => {
        const oid = must(readOid(der, item));
        return KEY_PURPOSES[oid] ?? oid;
      })
      .join(', '),
  ];
};

const alternativeNames: Decoder = (der, value, context) => {
  const items = sequence(der, value, 'a list of names (GeneralNames)');
  if (items.length === 0) fail(value.start, 'the list of names is empty');
  return generalNames(der, items, context);
};

const subjectKeyIdentifier: Decoder = (der, value) => [hexColons(must(readOctetString(der, value)))];

const authorityKeyIdentifier: Decoder = (der, value, context) => {
  const lines: string[] = [];
  for (const item of sequence(der, value, 'the authority key identifier (a SEQUENCE)')) {
    if (isContext(item, 0) && !item.constructed) lines.push(`Key ID ${hexColons(contentOf(der, item))}`);
    else if (isContext(item, 1))
      for (const name of generalNames(der, implicitSequence(der, item, 'the issuer'), context))
        lines.push(`Issuer ${name}`);
    else if (isContext(item, 2) && !item.constructed) {
      must(readInteger(der, item, true));
      lines.push(`Serial ${integerHex(der, item)}`);
    } else fail(item.start, `unexpected ${describeTag(item)} in the authority key identifier`);
  }
  return lines;
};

const crlDistributionPoints: Decoder = (der, value, context) => {
  const lines: string[] = [];
  for (const point of sequence(der, value, 'CRL distribution points (a SEQUENCE)')) {
    for (const part of sequence(der, point, 'a distribution point (a SEQUENCE)')) {
      if (isContext(part, 0)) {
        const name = must(explicit(der, part));
        if (isContext(name, 0)) lines.push(...generalNames(der, implicitSequence(der, name, 'a full name'), context));
        else if (isContext(name, 1)) {
          implicitSequence(der, name, 'a relative name');
          const rdn = readRdn(
            der,
            { ...name, cls: 'universal', tag: UNIVERSAL.SET },
            'distribution point',
            context.warnings,
          );
          lines.push(`Relative name ${rdnString(rdn)}`);
        } else fail(name.start, `unexpected ${describeTag(name)} in a distribution point name`);
      } else if (isContext(part, 1)) lines.push(`Reasons: ${bits(der, part, REASONS, true).join(', ')}`);
      else if (isContext(part, 2))
        for (const issuer of generalNames(der, implicitSequence(der, part, 'the CRL issuer'), context))
          lines.push(`CRL issuer ${issuer}`);
      else fail(part.start, `unexpected ${describeTag(part)} in a distribution point`);
    }
  }
  return lines;
};

const authorityInformationAccess: Decoder = (der, value, context) =>
  sequence(der, value, 'authority information access (a SEQUENCE)').map(item => {
    const [method, location, extra] = sequence(der, item, 'an access description (a SEQUENCE)');
    if (!isType(method, UNIVERSAL.OBJECT_IDENTIFIER) || !location || extra)
      return fail(item.start, 'an access description is a method and a location');
    const oid = must(readOid(der, method));
    const where = generalName(der, location, context);
    return `${ACCESS_METHODS[oid] ?? oid} ${where.startsWith('URI ') ? where.slice(4) : where}`;
  });

/** DisplayText (RFC 5280 §4.2.1.4): IA5String, VisibleString, BMPString or UTF8String. */
const displayText = (der: Uint8Array, tlv: Tlv | undefined): string => {
  if (!tlv || !isStringType(tlv)) return fail(tlv?.start ?? 0, 'a notice text must be a string');
  return must(readString(der, tlv)).text;
};

const certificatePolicies: Decoder = (der, value) => {
  const lines: string[] = [];
  for (const policy of sequence(der, value, 'certificate policies (a SEQUENCE)')) {
    const [id, qualifiers, extra] = sequence(der, policy, 'a policy (a SEQUENCE)');
    if (!isType(id, UNIVERSAL.OBJECT_IDENTIFIER))
      return fail(policy.body, 'a policy starts with its OBJECT IDENTIFIER');
    if (extra) fail(extra.start, `unexpected ${describeTag(extra)} after a policy’s qualifiers`);
    const oid = must(readOid(der, id));
    lines.push(POLICIES[oid] ? `${oid} ${POLICIES[oid]}` : oid);
    if (!qualifiers) continue;
    for (const qualifier of sequence(der, qualifiers, 'policy qualifiers (a SEQUENCE)')) {
      const [qid, q] = sequence(der, qualifier, 'a policy qualifier (a SEQUENCE)');
      if (!isType(qid, UNIVERSAL.OBJECT_IDENTIFIER) || !q)
        return fail(qualifier.start, 'a policy qualifier is an identifier and a value');
      const qoid = must(readOid(der, qid));
      if (qoid === CPS) lines.push(`CPS ${must(readString(der, q, 'IA5String')).text}`);
      else if (qoid === USER_NOTICE) {
        for (const part of sequence(der, q, 'a user notice (a SEQUENCE)')) {
          if (isType(part, UNIVERSAL.SEQUENCE)) {
            const [organization, numbers] = sequence(der, part, 'a notice reference (a SEQUENCE)');
            const list = sequence(der, numbers, 'notice numbers (a SEQUENCE)').map(n =>
              must(readInteger(der, n)).toString(),
            );
            lines.push(
              `Notice reference: ${displayText(der, organization)}, ${list.length === 1 ? 'notice' : 'notices'} ${list.join(', ')}`,
            );
          } else lines.push(`User notice: ${displayText(der, part)}`);
        }
      } else lines.push(`${qoid}: ${hexColons(der.subarray(q.start, q.end))}`);
    }
  }
  return lines;
};

const nameConstraints: Decoder = (der, value, context) => {
  const lines: string[] = [];
  for (const part of sequence(der, value, 'name constraints (a SEQUENCE)')) {
    const word = isContext(part, 0) ? 'Permitted' : isContext(part, 1) ? 'Excluded' : undefined;
    if (!word) return fail(part.start, `unexpected ${describeTag(part)} in name constraints`);
    for (const subtree of implicitSequence(der, part, `the ${word.toLowerCase()} subtrees`)) {
      const [base, ...limits] = sequence(der, subtree, 'a subtree (a SEQUENCE)');
      if (!base) return fail(subtree.start, 'a subtree has no name');
      let range = '';
      for (const limit of limits) {
        if (!(isContext(limit, 0) || isContext(limit, 1)) || limit.constructed)
          return fail(limit.start, `unexpected ${describeTag(limit)} in a subtree`);
        range += `${range ? ', ' : ''}${limit.tag === 0 ? 'minimum' : 'maximum'} ${must(readInteger(der, limit, true))}`;
      }
      lines.push(`${word} ${generalName(der, base, context, true)}${range ? ` (${range})` : ''}`);
    }
  }
  return lines;
};

/** RFC 6962 §3.3: a TLS-encoded SignedCertificateTimestampList inside the OCTET STRING. */
const signedCertificateTimestamps: Decoder = (der, value) => {
  const data = must(readOctetString(der, value));
  const base = value.body;
  let p = 0;
  const u = (n: number): bigint => {
    if (p + n > data.length) fail(base + p, 'the timestamp list ends too early');
    let v = 0n;
    for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(data[p + i]!);
    p += n;
    return v;
  };
  const total = Number(u(2));
  if (total !== data.length - 2) fail(base, `the timestamp list declares ${total} bytes, ${data.length - 2} are there`);
  const lines: string[] = [];
  while (p < data.length) {
    const length = Number(u(2));
    const end = p + length;
    if (end > data.length) fail(base + p, 'a timestamp is longer than the list');
    const at = p;
    const version = Number(u(1));
    if (version !== 0) {
      lines.push(`Version ${version + 1} timestamp (not read)`);
      p = end;
      continue;
    }
    if (p + 32 > end) fail(base + p, 'a timestamp ends inside its log ID');
    const logId = bytesToBase64(data.subarray(p, p + 32));
    p += 32;
    const ms = u(8);
    const extensions = Number(u(2));
    p += extensions;
    u(2); // hash and signature algorithms
    const signature = Number(u(2));
    p += signature;
    if (p !== end) fail(base + at, 'a timestamp’s fields do not fill it');
    lines.push(`Log ID ${logId}, ${formatIsoUtc(ms * 1_000_000n)}`);
  }
  return [`${lines.length} ${lines.length === 1 ? 'SCT' : 'SCTs'}`, ...lines];
};

const precertificatePoison: Decoder = (der, value) => {
  must(readNull(der, value));
  return [POISON];
};

const tlsFeature: Decoder = (der, value) => [
  sequence(der, value, 'TLS features (a SEQUENCE of numbers)')
    .map(item => {
      const n = must(readInteger(der, item)).toString();
      return TLS_FEATURES[n] ?? n;
    })
    .join(', '),
];

export const DECODERS: Record<string, Decoder> = {
  '2.5.29.19': basicConstraints,
  '2.5.29.15': keyUsage,
  '2.5.29.37': extendedKeyUsage,
  '2.5.29.17': alternativeNames,
  '2.5.29.18': alternativeNames,
  '2.5.29.14': subjectKeyIdentifier,
  '2.5.29.35': authorityKeyIdentifier,
  '2.5.29.31': crlDistributionPoints,
  '1.3.6.1.5.5.7.1.1': authorityInformationAccess,
  '2.5.29.32': certificatePolicies,
  '2.5.29.30': nameConstraints,
  '1.3.6.1.4.1.11129.2.4.2': signedCertificateTimestamps,
  '1.3.6.1.4.1.11129.2.4.3': precertificatePoison,
  '1.3.6.1.5.5.7.1.24': tlsFeature,
};
