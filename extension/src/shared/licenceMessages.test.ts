/** The licence messages: which messages are ours, which are v1 requests, and the licence key as it is sent. */
import { isLicenceMessage, isLicenceRequest, normaliseKey } from './licenceMessages';
import { describe, expect, it } from 'vitest';

describe('isLicenceRequest', () => {
  it.each([
    [{ type: 'licence/opened', v: 1 }],
    [{ type: 'licence/activate', v: 1, key: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD' }],
    [{ type: 'licence/check', v: 1 }],
    [{ type: 'licence/deactivate', v: 1 }],
    [{ type: 'licence/remove', v: 1 }],
    [{ type: 'plans/refresh', v: 1, reason: 'person' }],
    [{ type: 'plans/refresh', v: 1, reason: 'opened' }],
  ])('%o is one', message => {
    expect(isLicenceRequest(message)).toBe(true);
    expect(isLicenceMessage(message)).toBe(true);
  });

  it.each([
    [{ type: 'licence/check', v: 2 }],
    [{ type: 'licence/check' }],
    [{ type: 'licence/activate', v: 1 }],
    [{ type: 'licence/activate', v: 1, key: 7 }],
    [{ type: 'plans/refresh', v: 1, reason: 'timer' }],
  ])('%o is ours, but not a v1 request (the worker answers `version`)', message => {
    expect(isLicenceMessage(message)).toBe(true);
    expect(isLicenceRequest(message)).toBe(false);
  });

  it.each([[undefined], [null], ['licence/check'], [[{ type: 'licence/check', v: 1 }]], [{ type: 'viewer/ready' }]])(
    '%o is not ours at all (no answer)',
    message => {
      expect(isLicenceMessage(message)).toBe(false);
      expect(isLicenceRequest(message)).toBe(false);
    },
  );
});

describe('normaliseKey', () => {
  it('trims and drops the spaces inside, whatever they are', () => {
    expect(normaliseKey('  DTD-TEST-AAAA-BBBB-CCCC-DDDD \n')).toBe('DTD-TEST-AAAA-BBBB-CCCC-DDDD');
    expect(normaliseKey('DTD TEST\tAAAA BBBB\nCCCC DDDD')).toBe('DTDTESTAAAABBBBCCCCDDDD');
  });

  it('keeps 16 to 128 printable ASCII characters', () => {
    expect(normaliseKey('A'.repeat(16))).toBe('A'.repeat(16));
    expect(normaliseKey('A'.repeat(128))).toBe('A'.repeat(128));
    expect(normaliseKey('A'.repeat(15))).toBeUndefined();
    expect(normaliseKey('A'.repeat(129))).toBeUndefined();
    expect(normaliseKey('')).toBeUndefined();
  });

  it('refuses what is not printable ASCII', () => {
    expect(normaliseKey('DTD-TEST-AAAA-BBBB-CCCC-DDDÐ')).toBeUndefined();
    expect(normaliseKey('DTD-TEST-AAAA-BBBB-CCCC-\u0007DDD')).toBeUndefined();
    expect(normaliseKey('DTD-TEST-AAAA-BBBB-CCCC-DDD D')).toBe('DTD-TEST-AAAA-BBBB-CCCC-DDDD');
  });
});
