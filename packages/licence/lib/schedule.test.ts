/** When the worker asks the server again (pro-entitlement §6.4.4): each row of the table, the pauses, Retry-After. */
import { backoffMs, retryAfterAt, shouldCheck } from './schedule';
import { describe, expect, it } from 'vitest';
import type { Attempts, Trigger } from './schedule';
import type { EditionState, LicenceFacts } from './state';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const IAT = Date.UTC(2026, 10, 1);
const at = (days: number) => IAT + days * DAY;

const facts = (overrides?: Partial<LicenceFacts>): LicenceFacts => ({
  lid: 'lic_TEST0000000001',
  checkedAt: IAT,
  checkAfter: at(7),
  warnFrom: at(23),
  validUntil: at(30),
  paidUntil: null,
  ...overrides,
});
const endedFacts = (paidUntil: number | null) =>
  facts({ checkAfter: at(7), warnFrom: IAT, validUntil: IAT, paidUntil });

const NONE: Attempts = { failures: 0 };
const decide = (
  state: EditionState,
  now: number,
  options: { attempts?: Attempts; trigger?: Trigger; hasSecret?: boolean; seen?: number } = {},
) =>
  shouldCheck(
    {
      hasSecret: options.hasSecret ?? true,
      state,
      attempts: options.attempts ?? NONE,
      trigger: options.trigger ?? 'opened',
    },
    now,
    options.seen ?? 0,
  );

describe('shouldCheck — the table of §6.4.4, first fitting row decides', () => {
  const active = (due: boolean): EditionState => ({ kind: 'active', licence: facts(), due });

  it('no secret in the record → no (no-secret), even for the button', () => {
    expect(decide(active(true), at(8), { hasSecret: false })).toEqual({ check: false, why: 'no-secret' });
    expect(decide(active(true), at(8), { hasSecret: false, trigger: 'button' })).toMatchObject({ why: 'no-secret' });
  });

  it('retryAfter ahead → no (retry-after, notBefore), the button too', () => {
    const attempts = { failures: 1, retryAfter: at(8) + HOUR };
    for (const trigger of ['opened', 'button'] as const)
      expect(decide(active(true), at(8), { attempts, trigger })).toEqual({
        check: false,
        why: 'retry-after',
        notBefore: at(8) + HOUR,
      });
    expect(decide(active(true), at(8) + HOUR, { attempts })).toEqual({ check: true });
  });

  it('the button within 60 s of the last attempt → no (backoff, notBefore); after 60 s → yes, in any state', () => {
    const attempts = { failures: 0, last: at(8) - 30_000 };
    expect(decide(active(false), at(8), { attempts, trigger: 'button' })).toEqual({
      check: false,
      why: 'backoff',
      notBefore: at(8) + 30_000,
    });
    for (const state of [
      active(false),
      { kind: 'revoked', licence: facts(), reason: 'refund' } as const,
      { kind: 'ended', licence: endedFacts(at(-100)) } as const,
    ])
      expect(decide(state, at(8), { attempts: { failures: 5, last: at(8) - MINUTE }, trigger: 'button' })).toEqual({
        check: true,
      });
  });

  it('revoked → no (manual-only)', () => {
    expect(decide({ kind: 'revoked', licence: facts(), reason: 'seat-limit' }, at(8))).toEqual({
      check: false,
      why: 'manual-only',
    });
  });

  it('ended 30 days after paid (or iat without paid) → no (manual-only)', () => {
    expect(decide({ kind: 'ended', licence: endedFacts(at(-25)) }, at(8))).toMatchObject({ why: 'manual-only' });
    expect(decide({ kind: 'ended', licence: endedFacts(null) }, at(30))).toMatchObject({ why: 'manual-only' });
    expect(decide({ kind: 'ended', licence: endedFacts(null) }, at(30) - 1)).toEqual({ check: true });
  });

  it('ended before chk → no (not-due); at chk → yes', () => {
    const ended: EditionState = { kind: 'ended', licence: endedFacts(IAT) };
    expect(decide(ended, at(3))).toEqual({ check: false, why: 'not-due', notBefore: at(7) });
    expect(decide(ended, at(7))).toEqual({ check: true });
  });

  it('active before chk → no (not-due); counted by the mark when the clock is behind', () => {
    expect(decide(active(false), at(3))).toEqual({ check: false, why: 'not-due', notBefore: at(7) });
    expect(decide(active(false), at(3), { seen: at(8) })).toEqual({ check: true });
  });

  it.each(['grace', 'expired', 'invalid'] as const)('%s is urgent: once an hour after a failure', kind => {
    const state: EditionState = kind === 'invalid' ? { kind, reason: 'signature' } : { kind, licence: facts() };
    expect(decide(state, at(25))).toEqual({ check: true });
    const failed = { failures: 4, last: at(25) - 30 * MINUTE };
    expect(decide(state, at(25), { attempts: failed })).toEqual({
      check: false,
      why: 'backoff',
      notBefore: at(25) + 30 * MINUTE,
    });
    expect(decide(state, at(25) + 30 * MINUTE, { attempts: failed })).toEqual({ check: true });
  });

  it('active and due, or ended past chk: after the growing pause', () => {
    const ended: EditionState = { kind: 'ended', licence: endedFacts(IAT) };
    for (const state of [active(true), ended]) {
      expect(decide(state, at(8))).toEqual({ check: true });
      const two = { failures: 2, last: at(8) - HOUR };
      expect(decide(state, at(8), { attempts: two })).toEqual({
        check: false,
        why: 'backoff',
        notBefore: at(8) + HOUR,
      });
      expect(decide(state, at(8) + HOUR, { attempts: two })).toEqual({ check: true });
    }
  });

  it('every trigger but the button follows the same rules', () => {
    for (const trigger of ['startup', 'installed', 'opened'] as const) {
      expect(decide(active(false), at(3), { trigger })).toMatchObject({ why: 'not-due' });
      expect(decide(active(true), at(8), { trigger })).toEqual({ check: true });
    }
  });

  it('free with a secret (no token next to it) asks nothing on its own', () => {
    expect(decide({ kind: 'free' }, at(8))).toEqual({ check: false, why: 'manual-only' });
  });
});

describe('backoffMs', () => {
  it.each([
    [0, 0, 0],
    [1, HOUR, HOUR],
    [2, 2 * HOUR, HOUR],
    [3, 4 * HOUR, HOUR],
    [4, 8 * HOUR, HOUR],
    [5, 12 * HOUR, HOUR],
    [10, 12 * HOUR, HOUR],
  ])('%i failures → %i ms, urgent %i ms', (failures, normal, urgent) => {
    expect(backoffMs(failures, false)).toBe(normal);
    expect(backoffMs(failures, true)).toBe(failures === 0 ? 0 : urgent);
  });
});

describe('retryAfterAt', () => {
  const NOW = Date.UTC(2026, 10, 24, 12);

  it('seconds', () => {
    expect(retryAfterAt('120', NOW)).toBe(NOW + 120_000);
    expect(retryAfterAt(' 3600 ', NOW)).toBe(NOW + HOUR);
  });

  it('an HTTP date', () => {
    expect(retryAfterAt(new Date(NOW + 2 * HOUR).toUTCString(), NOW)).toBe(NOW + 2 * HOUR);
  });

  it('kept within 60 s … 24 h', () => {
    expect(retryAfterAt('5', NOW)).toBe(NOW + MINUTE);
    expect(retryAfterAt('0', NOW)).toBe(NOW + MINUTE);
    expect(retryAfterAt('999999', NOW)).toBe(NOW + DAY);
    expect(retryAfterAt(new Date(NOW - HOUR).toUTCString(), NOW)).toBe(NOW + MINUTE);
    expect(retryAfterAt(new Date(NOW + 3 * DAY).toUTCString(), NOW)).toBe(NOW + DAY);
  });

  it('unreadable → undefined', () => {
    for (const header of [null, '', 'soon', '-5', '1.5', '12 34', 'Mon, 99 Foo 2026'])
      expect(retryAfterAt(header, NOW)).toBeUndefined();
  });
});
