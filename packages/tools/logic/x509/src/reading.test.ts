// What the page draws from one input (reading.ts): the certificates, the messages with their places, sizes and times.
import { formatSize, readCertificates, timeLines } from './index';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pem = (name: string): string => readFileSync(join(__dirname, '../fixtures', `${name}.pem`), 'utf8');
const LEAF = pem('spec-leaf');
const LEAF_DER = Buffer.from(LEAF.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');

describe('readCertificates', () => {
  it('one block: the messages of §6 word for word, no place', () => {
    expect(readCertificates({ text: 'hello' })).toEqual({
      certificates: [],
      messages: [
        {
          tone: 'error',
          text: 'No certificate found. Paste a PEM block (-----BEGIN CERTIFICATE-----) or Base64 DER, or open a .crt / .der file.',
        },
      ],
    });
  });

  it('several blocks: each message starts with its line; skipped blocks and bytes left are notes', () => {
    const extra = Buffer.concat([LEAF_DER, Buffer.from([5, 0])]).toString('base64');
    const text = [
      LEAF.trimEnd(),
      '-----BEGIN PUBLIC KEY-----',
      'MFkw',
      '-----END PUBLIC KEY-----',
      '-----BEGIN CERTIFICATE-----',
      extra,
      '-----END CERTIFICATE-----',
      '-----BEGIN CERTIFICATE-----',
      'MIIB',
    ].join('\n');
    const r = readCertificates({ text });
    expect(r.certificates.map(c => c.subject.display)).toEqual(['test.example.com', 'test.example.com']);
    expect(r.messages).toEqual([
      { tone: 'note', text: 'Line 18: A "PUBLIC KEY" block is not a certificate; it was skipped.' },
      { tone: 'note', text: 'Line 21: 2 extra bytes after the certificate were ignored.' },
      { tone: 'error', text: 'Line 24: The CERTIFICATE block has no END line.' },
    ]);
  });

  it('a certificate that does not parse: its DER error with the place', () => {
    const r = readCertificates({ bytes: new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]) });
    expect(r.messages).toEqual([
      { tone: 'error', text: 'Byte 0: this is not a certificate (expected a SEQUENCE of three elements).' },
    ]);
  });
});

describe('formatSize and timeLines', () => {
  it('sizes as hash §8: bytes, KB, MB (1 024)', () => {
    expect([formatSize(1), formatSize(703), formatSize(1229), formatSize(1_048_577)]).toEqual([
      '1 byte',
      '703 bytes',
      '1.2 KB',
      '1 MB',
    ]);
  });

  it('three lines of a time in a given zone and locale; none for a time that is not RFC 5280’s', () => {
    const date = new Date(Date.UTC(2025, 10, 19, 12));
    const lines = timeLines(
      { raw: '251119120000Z', type: 'UTCTime', valid: true, date },
      Date.UTC(2026, 10, 19),
      'Europe/Berlin',
      'en-US',
    );
    expect([lines?.iso, lines?.local?.replace(/\u202f/g, ' '), lines?.relative]).toEqual([
      '2025-11-19T12:00:00Z',
      'Nov 19, 2025, 1:00:00 PM GMT+1',
      '12 months ago',
    ]);
    expect(timeLines({ raw: 'x', type: 'UTCTime', valid: false }, 0)).toBeUndefined();
  });
});
