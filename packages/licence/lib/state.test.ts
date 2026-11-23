/**
 * The table of states (pro-entitlement §4.1), one test per row, named by the row; `nextBoundary` and `decisionTime`;
 * and the tokens of the issuing rules' table of cases (§5.1, rows 1–16), signed and checked, read at the days the
 * table names.
 */
import { decisionTime, evaluate, nextBoundary } from './state';
import { claimsAt, makeTestKey, signToken } from './testing';
import { parseClaims, verifyToken } from './verify';
import { describe, expect, it } from 'vitest';
import type { Stored } from './state';
import type { WireClaims } from './testing';
import type { Claims, RevokeReason } from './types';

const DAY = 86_400_000;
const DAY_S = 86_400;
const IAT = Date.UTC(2026, 10, 1);
const INST = 'testInstTEST0000000000';

const claims = (overrides?: Partial<WireClaims>): Claims => parseClaims(claimsAt(IAT, { inst: INST, ...overrides }))!;
const token = (c: Claims = claims()): Stored => ({ kind: 'token', claims: c, inst: INST });
const at = (days: number) => IAT + days * DAY;
const ended = () => claims({ status: 'ended', chk: IAT / 1000 + 7 * DAY_S, warn: IAT / 1000, exp: IAT / 1000 });
const revoked = (reason: RevokeReason) =>
  claims({ status: 'revoked', reason, chk: IAT / 1000, warn: IAT / 1000, exp: IAT / 1000 });

describe('evaluate — the table of §4.1', () => {
  it('row 1: no record → free', () => {
    expect(evaluate({ kind: 'none' }, at(1), 0)).toEqual({ kind: 'free' });
  });

  it('row 2: a record that does not read → invalid: unreadable', () => {
    expect(evaluate({ kind: 'unreadable' }, at(1), 0)).toEqual({ kind: 'invalid', reason: 'unreadable' });
  });

  it.each([
    [3, 'malformed'],
    [4, 'unsupported'],
    [5, 'unknown-key'],
    [6, 'signature'],
    [7, 'claims'],
  ] as const)('row %i: a token refused as %s → invalid with that reason', (_row, reason) => {
    expect(evaluate({ kind: 'rejected', reason }, at(1), 0)).toEqual({ kind: 'invalid', reason });
  });

  it('row 8: a checked token of another installation → invalid: foreign', () => {
    expect(evaluate({ kind: 'token', claims: claims(), inst: 'otherInstTEST000000000' }, at(1), 0)).toEqual({
      kind: 'invalid',
      reason: 'foreign',
    });
  });

  it('row 9: active, day 1 → active, not due', () => {
    expect(evaluate(token(), at(1), 0)).toMatchObject({ kind: 'active', due: false });
  });

  it('row 10: active, day 8 → active, due (nothing shown to the person)', () => {
    expect(evaluate(token(), at(8), 0)).toMatchObject({ kind: 'active', due: true });
  });

  it('row 11: active, exactly chk → due (the boundary is in "due")', () => {
    expect(evaluate(token(), at(7), 0)).toMatchObject({ kind: 'active', due: true });
  });

  it('row 12: active, 1 ms before warn → still active, due', () => {
    expect(evaluate(token(), at(23) - 1, 0)).toMatchObject({ kind: 'active', due: true });
  });

  it('row 13: active, exactly warn → grace', () => {
    expect(evaluate(token(), at(23), 0).kind).toBe('grace');
  });

  it('row 14: active, exactly exp → expired', () => {
    expect(evaluate(token(), at(30), 0).kind).toBe('expired');
  });

  it('row 15: active, day 45 → expired', () => {
    expect(evaluate(token(), at(45), 0).kind).toBe('expired');
  });

  it('row 16: the clock behind the server’s (iat ahead) → active, not due: the decision time is never below iat', () => {
    expect(evaluate(token(), at(-5), 0)).toMatchObject({ kind: 'active', due: false });
  });

  it('row 17: the clock put back inside the window → counted by the mark', () => {
    expect(evaluate(token(), at(2), at(20))).toMatchObject({ kind: 'active', due: true });
  });

  it('row 18: the clock put back after the window → expired: Pro is not extended', () => {
    expect(evaluate(token(), at(10), at(31)).kind).toBe('expired');
  });

  it('row 19: the clock ran ahead → expired early', () => {
    expect(evaluate(token(), at(400), 0).kind).toBe('expired');
  });

  it('row 20: the clock back again, the mark left in the future → expired', () => {
    expect(evaluate(token(), at(5), at(400)).kind).toBe('expired');
  });

  it('row 21: ended → ended, whatever the time and mark', () => {
    for (const [now, seen] of [
      [at(0), 0],
      [at(100), at(200)],
    ])
      expect(evaluate(token(ended()), now!, seen!).kind).toBe('ended');
  });

  it.each(['refund', 'deactivated', 'key-blocked', 'seat-limit', 'unknown-installation'] as const)(
    'row 22: revoked, reason %s → revoked with that reason',
    reason => {
      expect(evaluate(token(revoked(reason)), at(1), 0)).toMatchObject({ kind: 'revoked', reason });
    },
  );

  it('row 23: active with paid before exp → active: paid is only shown', () => {
    const c = claims({ paid: IAT / 1000 + 5 * DAY_S });
    expect(evaluate(token(c), at(10), 0)).toMatchObject({ kind: 'active', licence: { paidUntil: at(5) } });
  });

  it('row 24: a mark that is not a number, negative or NaN counts as 0 → as row 9', () => {
    for (const seen of ['x' as unknown as number, -5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(evaluate(token(), at(1), seen)).toMatchObject({ kind: 'active', due: false });
  });
});

describe('evaluate: what it says about the licence', () => {
  it('the facts carry the token’s times, paid, term and renews', () => {
    const c = claims({ paid: IAT / 1000 + 30 * DAY_S, term: 'year', renews: false });
    expect(evaluate(token(c), at(1), 0)).toEqual({
      kind: 'active',
      due: false,
      licence: {
        lid: c.lid,
        checkedAt: IAT,
        checkAfter: at(7),
        warnFrom: at(23),
        validUntil: at(30),
        paidUntil: at(30),
        term: 'year',
        renews: false,
      },
    });
  });

  it('without term and renews the facts have neither', () => {
    const state = evaluate(token(), at(1), 0);
    expect(state.kind === 'active' && ('term' in state.licence || 'renews' in state.licence)).toBe(false);
  });
});

describe('nextBoundary', () => {
  it('chk, then warn, then exp ahead of the decision time; none after exp', () => {
    expect(nextBoundary(token(), at(1), 0)).toBe(at(7));
    expect(nextBoundary(token(), at(7), 0)).toBe(at(23));
    expect(nextBoundary(token(), at(23), 0)).toBe(at(30));
    expect(nextBoundary(token(), at(30), 0)).toBeUndefined();
  });

  it('counts from the mark when it is ahead of the clock', () => {
    expect(nextBoundary(token(), at(1), at(10))).toBe(at(23));
  });

  it('no boundary for ended, revoked, invalid, free or another installation’s token', () => {
    expect(nextBoundary(token(ended()), at(1), 0)).toBeUndefined();
    expect(nextBoundary(token(revoked('refund')), at(1), 0)).toBeUndefined();
    expect(nextBoundary({ kind: 'rejected', reason: 'signature' }, at(1), 0)).toBeUndefined();
    expect(nextBoundary({ kind: 'unreadable' }, at(1), 0)).toBeUndefined();
    expect(nextBoundary({ kind: 'none' }, at(1), 0)).toBeUndefined();
    expect(nextBoundary({ kind: 'token', claims: claims(), inst: 'otherInstTEST000000000' }, at(1), 0)).toBeUndefined();
  });
});

describe('decisionTime', () => {
  it('is max(now, seen, iat)', () => {
    expect(decisionTime(at(5), at(3), claims())).toBe(at(5));
    expect(decisionTime(at(5), at(9), claims())).toBe(at(9));
    expect(decisionTime(at(-2), 0, claims())).toBe(IAT);
    expect(decisionTime(at(-2), 0)).toBe(at(-2));
  });

  it('a mark that is not a finite non-negative number counts as 0', () => {
    expect(decisionTime(at(1), Number.NaN, claims())).toBe(at(1));
    expect(decisionTime(at(1), -1, claims())).toBe(at(1));
  });
});

/**
 * The issuing rules (§5.1): what the server signs at `iat` for a licence. `end` is the end of what was paid: a
 * subscription's `paid + 14 days`, a complimentary licence's `paid`, none without `paid`.
 */
const issue = (
  iat: number,
  licence: { status: 'active' | 'ended' | 'revoked'; paid: number | null; term?: 'month' | 'year'; renews?: boolean },
): WireClaims => {
  const base = claimsAt(iat * 1000, { inst: INST });
  if (licence.status === 'revoked')
    return { ...base, status: 'revoked', reason: 'refund', chk: iat, warn: iat, exp: iat, paid: licence.paid };
  const end = licence.paid === null ? null : licence.paid + (licence.term ? 14 * DAY_S : 0);
  const extra = { ...(licence.term ? { term: licence.term } : {}) };
  if (licence.status === 'ended' || (end !== null && end <= iat))
    return {
      ...base,
      ...extra,
      status: 'ended',
      chk: iat + 7 * DAY_S,
      warn: iat,
      exp: iat,
      paid: licence.paid,
      renews: false,
    };
  const renews = licence.renews === undefined ? {} : { renews: licence.renews };
  if (end === null) return { ...base, ...extra, ...renews, paid: null };
  const exp = Math.min(iat + 30 * DAY_S, end);
  const chk = Math.min(iat + 7 * DAY_S, exp);
  const warn = Math.max(exp - 7 * DAY_S, chk);
  return { ...base, ...extra, ...renews, chk, warn, exp, paid: licence.paid };
};

describe('the issuing rules’ table of cases (§5.1): what the extension sees', () => {
  const iat = Math.floor(IAT / 1000);
  const d = (days: number) => iat + Math.round(days * DAY_S);
  const sub = (paidInDays: number, extra: { term?: 'month' | 'year'; renews?: boolean } = {}) =>
    ({ status: 'active', paid: d(paidInDays), term: 'month', renews: true, ...extra }) as const;
  // [row, licence, status, chk, warn, exp] — days from iat, as the table writes them.
  const CASES = [
    [1, sub(30), 'active', 7, 23, 30],
    [2, sub(365, { term: 'year' }), 'active', 7, 23, 30],
    [3, sub(20, { renews: false }), 'active', 7, 23, 30],
    [4, sub(10), 'active', 7, 17, 24],
    [5, sub(0), 'active', 7, 7, 14],
    [6, sub(-3), 'active', 7, 7, 11],
    [7, sub(-8), 'active', 6, 6, 6],
    [8, sub(-13.5), 'active', 0.5, 0.5, 0.5],
    [9, sub(-14), 'ended', 7, 0, 0],
    [10, sub(-20), 'ended', 7, 0, 0],
    [11, { status: 'active', paid: null }, 'active', 7, 23, 30],
    [12, { status: 'active', paid: d(3) }, 'active', 3, 3, 3],
    [13, { status: 'active', paid: d(40) }, 'active', 7, 23, 30],
    [14, { status: 'active', paid: d(-1) }, 'ended', 7, 0, 0],
    [15, { status: 'ended', paid: d(-40), term: 'month' }, 'ended', 7, 0, 0],
    [16, { status: 'revoked', paid: null }, 'revoked', 0, 0, 0],
  ] as const;

  it.each(CASES)(
    'row %i: %o is signed %s with chk, warn, exp at the table’s days',
    async (_row, licence, status, chk, warn, exp) => {
      const key = await makeTestKey();
      const wire = issue(iat, licence);
      expect([wire.status, wire.chk, wire.warn, wire.exp]).toEqual([status, d(chk), d(warn), d(exp)]);
      const verified = await verifyToken(
        await signToken(wire, { kid: key.publicKey.kid, privateKey: key.privateKey }),
        [key.publicKey],
      );
      // No `active` the rules give is refused as breaking the fields.
      expect(verified.ok).toBe(true);
      if (!verified.ok) return;
      const stored: Stored = { kind: 'token', claims: verified.claims, inst: INST };
      const kind = (days: number) => evaluate(stored, d(days) * 1000, 0).kind;
      if (status !== 'active') {
        expect(kind(0)).toBe(status);
        return;
      }
      // Before chk: active and not due; at chk: due (or past warn / exp when they coincide); at warn: grace unless it is
      // also exp; at exp: expired.
      expect(evaluate(stored, d(chk) * 1000 - 1, 0)).toMatchObject({ kind: 'active', due: false });
      if (chk < warn) expect(evaluate(stored, d(chk) * 1000, 0)).toMatchObject({ kind: 'active', due: true });
      expect(kind(warn)).toBe(warn < exp ? 'grace' : 'expired');
      expect(kind(exp)).toBe('expired');
    },
  );
});
