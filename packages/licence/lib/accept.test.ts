import { acceptActivation, acceptRefresh } from './accept';
import { claimsAt } from './testing';
import { parseClaims } from './verify';
import { describe, expect, it } from 'vitest';
import type { WireClaims } from './testing';

const NOW = Date.UTC(2026, 10, 24);
const DAY_S = 86_400;
const claims = (at: number, overrides?: Partial<WireClaims>) => parseClaims(claimsAt(at, overrides))!;
const revokedAt = (at: number) => {
  const iat = Math.floor(at / 1000);
  return claims(at, { status: 'revoked', reason: 'refund', chk: iat, warn: iat, exp: iat });
};

describe('acceptRefresh (§4.3)', () => {
  const held = claims(NOW);

  it('the same iat is accepted', () => {
    expect(acceptRefresh(held, claims(NOW))).toEqual({ accept: true });
  });

  it('a newer token is accepted; an older one is not', () => {
    expect(acceptRefresh(held, claims(NOW + DAY_S * 1000))).toEqual({ accept: true });
    expect(acceptRefresh(held, claims(NOW - 1000))).toEqual({ accept: false, why: 'older' });
  });

  it('another licence or another installation is not', () => {
    expect(acceptRefresh(held, claims(NOW, { lid: 'lic_OTHER00000001' }))).toEqual({
      accept: false,
      why: 'other-licence',
    });
    expect(acceptRefresh(held, claims(NOW, { inst: 'otherInstTEST000000000' }))).toEqual({
      accept: false,
      why: 'other-installation',
    });
  });

  it('a newer revoked after active is accepted; an old revoked after a newer active is not', () => {
    expect(acceptRefresh(held, revokedAt(NOW + 1000))).toEqual({ accept: true });
    expect(acceptRefresh(claims(NOW + 5000), revokedAt(NOW))).toEqual({ accept: false, why: 'older' });
  });
});

describe('acceptActivation (§4.3)', () => {
  const inst = claimsAt(NOW).inst;

  it('an active token for the installation sent is accepted', () => {
    expect(acceptActivation(inst, claims(NOW))).toEqual({ accept: true });
  });

  it('a revoked or ended one is not', () => {
    expect(acceptActivation(inst, revokedAt(NOW))).toEqual({ accept: false, why: 'not-active' });
    const iat = Math.floor(NOW / 1000);
    const ended = claims(NOW, { status: 'ended', chk: iat + 7 * DAY_S, warn: iat, exp: iat });
    expect(acceptActivation(inst, ended)).toEqual({ accept: false, why: 'not-active' });
  });

  it('one for another installation is not', () => {
    expect(acceptActivation('otherInstTEST000000000', claims(NOW))).toEqual({
      accept: false,
      why: 'other-installation',
    });
  });
});
