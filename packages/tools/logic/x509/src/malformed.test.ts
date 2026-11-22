// Malformed input: every one gives a worded error with its place — never an exception, a hang or a wrong field.
// Truncations at every byte, lengths that overrun, BER (indefinite and non-minimal), huge declared lengths, deep
// nesting, garbage around PEM, and seeded random mutations of every fixture. Bounds are on the work's shape (a
// megabyte is read like a kilobyte, times the size), not on milliseconds.
import { COULD_NOT_DECODE, MAX_BLOCKS, NO_CERTIFICATE, parseCertificate, readInput } from './index';
import { certificate, extension, int, seq, tlv } from './der-builder';
import { readTlv } from '@workspace/tools-shared/der';
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Tlv } from '@workspace/tools-shared/der';

const DIR = join(__dirname, '../fixtures');
const derOf = (name: string): Uint8Array => {
  const b = readInput({ text: readFileSync(join(DIR, `${name}.pem`), 'utf8') }).blocks[0];
  if (b?.kind !== 'certificate') throw new Error(name);
  return b.der;
};
const FIXTURES = readdirSync(DIR)
  .filter(f => f.endsWith('.pem'))
  .map(f => f.slice(0, -4));
/** A sentence that starts with its place. */
const WORDED = /^Byte \d+: \S[^]*\.$/;
const HEAVY = { timeout: 60_000 };

/** Reads like the page does; returns the error message, or null when it read a certificate. */
const outcome = (der: Uint8Array): string | null => {
  const r = parseCertificate(der);
  return r.ok ? null : r.message;
};

const random = (seed: number) => {
  let state = seed >>> 0 || 1;
  return (n: number): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % n;
  };
};

/** Every constructed element the strict reader descends into (not the DER inside OCTET STRINGs). */
const elements = (der: Uint8Array): Array<{ tlv: Tlv; parent: Tlv | null }> => {
  const out: Array<{ tlv: Tlv; parent: Tlv | null }> = [];
  const root = readTlv(der, 0);
  if (!root.ok) return out;
  const stack: Array<{ tlv: Tlv; parent: Tlv | null }> = [{ tlv: root.tlv, parent: null }];
  while (stack.length) {
    const item = stack.pop()!;
    out.push(item);
    if (!item.tlv.constructed) continue;
    for (let at = item.tlv.body; at < item.tlv.end;) {
      const child = readTlv(der, at, item.tlv.end);
      if (!child.ok) break;
      stack.push({ tlv: child.tlv, parent: item.tlv });
      at = child.tlv.end;
    }
  }
  return out;
};

describe('truncated certificates', () => {
  it.each(['spec-ed', 'spec-leaf', 'ed448'])('%s cut at every byte: Byte 0, longer than the data left', name => {
    const der = derOf(name);
    for (let n = 1; n < der.length; n++) {
      const cut = der.slice(0, n);
      const read = readInput({ bytes: cut });
      if (n === 1) {
        // One byte (0x30) is a certificate whose header is cut off.
        expect(outcome(cut)).toBe('Byte 0: the data ends inside the element’s header (truncated certificate?).');
        continue;
      }
      expect(read.blocks[0]?.kind, `at ${n}`).toBe('certificate');
      expect(outcome(cut), `at ${n}`).toMatch(
        /^Byte 0: the (element is longer than the data left|data ends inside the element’s header) \(truncated certificate\?\)\.$/,
      );
    }
    expect(readInput({ bytes: new Uint8Array() })).toEqual({ blocks: [], message: NO_CERTIFICATE });
  });

  it('a truncated Base64 PEM body: an error, never a certificate', () => {
    const text = readFileSync(join(DIR, 'spec-leaf.pem'), 'utf8');
    const lines = text.trim().split('\n');
    for (let keep = 1; keep < lines.length - 1; keep++) {
      const cut = [...lines.slice(0, keep), lines[lines.length - 1]].join('\n');
      const block = readInput({ text: cut }).blocks[0]!;
      if (block.kind === 'error')
        expect(block.message).toMatch(
          /^The CERTIFICATE block (is empty|is not valid Base64\. Line \d+, column \d+: .+)\.$/,
        );
      else expect(block.kind === 'certificate' && outcome(block.der)).toMatch(WORDED);
    }
  });
});

describe('lengths that overrun', () => {
  it.each(['spec-leaf', 'leaf-p256', 'issuing-rsa4096'])(
    '%s: one more byte in any inner length is refused where the overrun shows',
    name => {
      const der = derOf(name);
      let tried = 0;
      for (const { tlv: t, parent } of elements(der)) {
        if (!parent || t.header !== 2 || der[t.start + 1]! >= 0x7f) continue;
        const bad = der.slice();
        bad[t.start + 1]!++;
        tried++;
        const message = outcome(bad);
        // The last element of its parent overruns the parent at once; any other swallows its sibling's first byte,
        // and the trouble shows where what is left of that sibling stops reading — inside the same parent. The data's own
        // end reads as a truncation.
        const last = t.end === parent.end;
        const expected = last
          ? parent.end === der.length
            ? `Byte ${t.start}: the element is longer than the data left (truncated certificate?).`
            : `Byte ${t.start}: the element runs past the end of the element that contains it.`
          : undefined;
        if (expected) expect(message, `element at ${t.start}`).toBe(expected);
        else {
          expect(message, `element at ${t.start}`).toMatch(WORDED);
          const at = Number(/^Byte (\d+)/.exec(message!)![1]);
          expect(at, `element at ${t.start}`).toBeGreaterThanOrEqual(t.start);
          expect(at, `element at ${t.start}`).toBeLessThanOrEqual(parent.end);
        }
      }
      expect(tried).toBeGreaterThan(20);
    },
  );

  it('one less byte in any inner length: worded, never an exception', () => {
    const der = derOf('leaf-p256');
    for (const { tlv: t, parent } of elements(der)) {
      if (!parent || t.header !== 2 || der[t.start + 1] === 0) continue;
      const bad = der.slice();
      bad[t.start + 1]!--;
      const message = outcome(bad);
      if (message !== null) expect(message, `element at ${t.start}`).toMatch(WORDED);
    }
  });

  it('a huge declared length', () => {
    expect(outcome(new Uint8Array([0x30, 0x84, 0x7f, 0xff, 0xff, 0xff, 0x30, 0x00]))).toBe(
      'Byte 0: the element is longer than the data left (truncated certificate?).',
    );
    expect(outcome(new Uint8Array([0x30, 0x88, 1, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'Byte 0: the declared length takes 8 bytes (at most 4).',
    );
    const der = derOf('spec-ed');
    const inner = der.slice();
    // tbsCertificate starts at 3 (30 82 01 14 | 30 81 c7 …): make its length 0x7fffffff.
    const huge = new Uint8Array([...inner.subarray(0, 4), 0x30, 0x84, 0x7f, 0xff, 0xff, 0xff, ...inner.subarray(7)]);
    huge[2] = ((huge.length - 4) >> 8) & 0xff;
    huge[3] = (huge.length - 4) & 0xff;
    expect(outcome(huge)).toBe('Byte 4: the element is longer than the data left (truncated certificate?).');
  });
});

describe('BER is refused (DER only)', () => {
  it('indefinite lengths, outside and inside', () => {
    const der = derOf('spec-ed');
    const outer = new Uint8Array([0x30, 0x80, ...der.subarray(4), 0x00, 0x00]);
    expect(outcome(outer)).toBe('Byte 0: indefinite length is BER, not DER.');
    const t = readTlv(der, 4);
    if (!t.ok) throw new Error();
    const body = Array.from(der.subarray(t.tlv.body, t.tlv.end));
    const rest = Array.from(der.subarray(t.tlv.end));
    const inner = new Uint8Array(tlv(0x30, [0x30, 0x80, ...body, 0, 0], rest));
    expect(outcome(inner)).toBe('Byte 4: indefinite length is BER, not DER.');
  });

  it('non-minimal lengths and integers, a BOOLEAN that is not 0x00 / 0xFF', () => {
    const der = derOf('spec-ed');
    const n = der.length - 4;
    const longLength = new Uint8Array([0x30, 0x83, 0x00, n >> 8, n & 0xff, ...der.subarray(4)]);
    expect(outcome(longLength)).toBe('Byte 0: the length is not in its shortest form (BER, not DER).');
    expect(outcome(certificate({ serial: tlv(0x02, [0x00, 0x01]) }))).toMatch(
      /^Byte \d+: an INTEGER is not in its shortest form \(BER, not DER\)\.$/,
    );
    expect(outcome(certificate({ serial: [0x02, 0x81, 0x01, 0x05] }))).toMatch(
      /^Byte \d+: the length is not in its shortest form \(BER, not DER\)\.$/,
    );
    expect(
      outcome(certificate({ extensions: [seq(tlv(0x06, [0x55, 0x1d, 0x13]), [0x01, 0x01, 0x01], tlv(0x04, seq()))] })),
    ).toMatch(/^Byte \d+: a BOOLEAN must be one byte, 0x00 or 0xFF\.$/);
    expect(
      outcome(
        certificate({
          subject: tlv(0x30, tlv(0x31, tlv(0x30, tlv(0x06, [0x55, 4, 3]), tlv(0x2c, tlv(0x0c, [0x41]))))),
        }),
      ),
    ).toMatch(/^Byte \d+: a constructed UTF8String is BER, not DER\.$/);
  });
});

describe('deep nesting', () => {
  const nest = (levels: number, inner: number[] = [0x05, 0x00]): number[] => {
    let out = inner;
    for (let i = 0; i < levels; i++) out = seq(out);
    return out;
  };

  it('deeper than 32 levels in the certificate: refused with the place', () => {
    expect(outcome(certificate({ issuer: nest(40) }))).toMatch(
      /^Byte \d+: elements are nested deeper than 32 levels\.$/,
    );
  });

  it('inside an extension: that extension cannot be decoded, the rest is read', () => {
    const r = parseCertificate(
      certificate({ extensions: [extension('2.5.29.17', nest(60)), extension('2.5.29.19', seq())] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.certificate.extensions[0]!.value).toMatchObject({
      kind: 'hex',
      error: COULD_NOT_DECODE,
      detail: expect.stringMatching(/^Byte \d+: elements are nested deeper than 32 levels\.$/),
    });
    expect(r.certificate.extensions[1]!.value).toEqual({ kind: 'text', lines: ['CA: no'] });
  });

  it('a megabyte of nesting returns, without a stack overflow', HEAVY, () => {
    // 30 84 <len> repeated; lengths deliberately overrun — the reader stops at the first level that is wrong.
    const bytes = new Uint8Array(1_048_576);
    for (let i = 0; i + 6 <= bytes.length; i += 6) bytes.set([0x30, 0x84, 0x00, 0x0f, 0xff, 0xff], i);
    expect(outcome(bytes)).toMatch(WORDED);
    expect(readInput({ bytes }).blocks).toHaveLength(1);
  });
});

describe('garbage around and inside PEM', () => {
  it('seeded random text built from PEM pieces: never throws, every message is a sentence', HEAVY, () => {
    const leaf = readFileSync(join(DIR, 'spec-leaf.pem'), 'utf8');
    const pieces = [
      '-----BEGIN CERTIFICATE-----',
      '-----END CERTIFICATE-----',
      '-----BEGIN ',
      '-----END ',
      '-----',
      '-----BEGIN PRIVATE KEY-----',
      '-----BEGIN X509 CRL-----',
      'MIIB',
      'AAAA',
      '====',
      '!',
      '\n',
      '\r\n',
      ' ',
      '\u0000',
      '😀',
      '\\n',
      leaf,
      leaf.slice(0, 200),
      leaf.slice(300),
    ];
    const next = random(26);
    for (let i = 0; i < 3000; i++) {
      let text = '';
      const count = 1 + next(12);
      for (let k = 0; k < count; k++) text += pieces[next(pieces.length)];
      const read = readInput({ text });
      for (const block of read.blocks) {
        if (block.kind === 'certificate') {
          const m = outcome(block.der);
          if (m !== null) expect(m).toMatch(WORDED);
        } else expect(block.message).toMatch(/^[A-Z][^]*[.]$|openssl pkcs7 -print_certs$/);
      }
      if (read.message !== undefined) expect(read.message).toMatch(/\.$/);
    }
  });

  it(
    'a megabyte of BEGIN lines without END is read once, not once per block (the work grows with the size)',
    HEAVY,
    () => {
      const unit = '-----BEGIN CERTIFICATE-----\nAAAA\n';
      const small = readInput({ text: unit.repeat(1_000) });
      const big = readInput({ text: unit.repeat(30_000) });
      expect(small.blocks.length).toBeLessThanOrEqual(MAX_BLOCKS);
      expect(big.blocks.length).toBe(20);
      expect(big.message).toBe('Only the first 20 certificates are shown.');
      const others = readInput({ text: '-----BEGIN X-----\n'.repeat(60_000) });
      expect(others.blocks).toHaveLength(MAX_BLOCKS);
      expect(others.message).toBe('Only the first 100 PEM blocks were read.');
    },
  );
});

describe('seeded random mutations of every fixture', () => {
  it.each(FIXTURES)('%s: 400 mutations, each read or refused in words', HEAVY, name => {
    const der = derOf(name);
    const next = random(der.length);
    let refusedCount = 0;
    for (let i = 0; i < 400; i++) {
      const bad = der.slice();
      const kind = next(4);
      const at = next(bad.length);
      if (kind === 0) bad[at] = next(256);
      else if (kind === 1) bad[at] = bad[at]! ^ (1 << next(8));
      else if (kind === 2) bad[at] = [0x00, 0x80, 0x81, 0x84, 0xff, 0x1f, 0x30, 0x24][next(8)]!;
      else bad.copyWithin(at, next(bad.length));
      const message = outcome(bad);
      if (message === null) continue;
      refusedCount++;
      expect(message).toMatch(WORDED);
    }
    expect(refusedCount).toBeGreaterThan(0);
  });
});

describe('a megabyte of input reads in time proportional to its size', () => {
  it('Base64 without PEM lines, a certificate with a huge extension, and a huge INTEGER', HEAVY, () => {
    expect(readInput({ text: 'A'.repeat(1_048_576) })).toEqual({ blocks: [], message: NO_CERTIFICATE });
    const big = certificate({ extensions: [extension('1.2.3.4', new Array(900_000).fill(7))] });
    const r = parseCertificate(big);
    expect(r.ok && r.certificate.extensions[0]!.value.kind).toBe('hex');
    const serial = certificate({ serial: tlv(0x02, [0x01, ...new Array(500_000).fill(0x23)]) });
    const s = parseCertificate(serial);
    expect(s.ok && s.certificate.serialDecimal).toBe('');
    expect(s.ok && s.certificate.serialHex.length).toBe(1_000_002);
    expect(int(1)).toEqual([2, 1, 1]);
  });
});
