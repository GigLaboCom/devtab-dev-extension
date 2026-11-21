/**
 * docs/tools/specs/unix-time.md §7: the table, and the inputs of the other tools — a 10- or 13-digit number is a
 * plausible value for several of them, and the first tool that says yes opens without a question.
 */
import { detectUnixTime } from './detect';
import { describe, expect, it } from 'vitest';

describe('detectUnixTime (§7)', () => {
  it.each([
    '1700000000',
    '1700000000000',
    '1700000000.123',
    ' 1763640000 ',
    '1700000000.123456789',
    '2023-11-14T22:13:20Z',
    '2023-11-14T23:13:20+01:00',
    '2023-11-14T23:13:20.123+01:00[Europe/Berlin]',
    '2023-11-14 22:13:20Z',
    'Tue, 14 Nov 2023 22:13:20 GMT',
    'Tue, 14 Nov 2023 23:13:20 +0100',
    '\n2023-11-14T22:13:20.5Z\n',
  ])('yes: %j', text => {
    expect(detectUnixTime(text)).toBe(true);
  });

  it.each([
    // US phone numbers, 11 digits
    '2125551234',
    '4155552671',
    '14155552671',
    '89161234567',
    // outside 2001–2033, other lengths
    '0123456789',
    '999999999',
    '2000000000',
    '17000000000',
    '1700000000000000',
    '1234567890123456789',
    '1700000000.',
    '1700000000.1234567890',
    '-1700000000',
    '+1700000000',
    // dates without a time, without seconds or without a zone, basic format
    '2023-11-14',
    '2023-11-14T22:13',
    '2023-11-14T22:13:20',
    '20231114',
    '20231114T221320Z',
    '2023-13-14T22:13:20Z',
    '2023-11-14T22:13:20+24:00',
    // mail dates without a weekday or seconds
    '14 Nov 2023 22:13:20 GMT',
    'Tue, 14 Nov 2023 22:13 GMT',
    'Tue Nov 14 2023 23:13:20 GMT+0100 (Central European Standard Time)',
    // other tools: number-base, color, cron
    '255',
    '0xff',
    '#ffffff',
    '0 0 * * *',
    '*/5 * * * *',
    // json, query strings
    '{"exp":1700000000}',
    'exp=1700000000',
    '[1700000000]',
    '"1700000000"x',
    // uuid, jwt
    '550e8400-e29b-41d4-a716-446655440000',
    '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    'eyJhbGciOiJIUzI1NiJ9.e30.x',
    // A made-up sample token for the test, not a credential — the secret scanner is told so.
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3MDAwMDAwMDB9.c2lnbmF0dXJl', // gitleaks:allow
    // base64, hex-ascii
    'SGVsbG8=',
    '48656c6c6f',
    'deadbeef',
    'MTcwMDAwMDAwMA==',
    // regexp, yaml, text-diff, url
    '^\\d{10}$',
    '(\\d+)-\\w*',
    '/1700000000/g',
    'exp: 1700000000',
    'time: 2023-11-14T22:13:20Z',
    '- 1700000000',
    '@@ -1 +1 @@\n-1700000000\n+1700000001',
    'https://example.com/?t=1700000000',
    '%31%37',
    // two values, words, empty
    '1700000000 1700000001',
    '1700000000\n1700000001',
    'now',
    '',
    '   ',
  ])('no: %j', text => {
    expect(detectUnixTime(text)).toBe(false);
  });

  it('longer than 64 characters is never recognised, and long input returns at once', () => {
    expect(detectUnixTime(`2023-11-14T22:13:20.123456789+01:00[${'A'.repeat(30)}]`)).toBe(false);
    const start = performance.now();
    for (const text of ['1'.repeat(300_000), `2023-11-14T22:13:20.${'1'.repeat(300_000)}Z`, ' '.repeat(300_000)])
      expect(detectUnixTime(text)).toBe(false);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
