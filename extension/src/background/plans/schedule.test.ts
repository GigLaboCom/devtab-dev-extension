/** When the worker asks for the plans list: every rule of the plans document §4.5. */
import { plansBackoffMs, shouldFetchPlans } from './schedule';
import { describe, expect, it } from 'vitest';
import type { PlansRecord } from '@src/shared/plansRecord';

const NOW = Date.UTC(2026, 10, 24, 12);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const record = (
  fetchedAgo: number | undefined,
  attempts: PlansRecord['attempts'] = { failures: 0 },
  maxAge = 86_400,
): PlansRecord => ({
  v: 1,
  ...(fetchedAgo !== undefined ? { fetchedAt: NOW - fetchedAgo, body: { v: 1, maxAge } } : {}),
  attempts,
});

describe('shouldFetchPlans', () => {
  it('a free installation never asks on `opened` — even with nothing stored', () => {
    expect(shouldFetchPlans({ record: undefined, reason: 'opened', hasLicence: false }, NOW)).toEqual({
      fetch: false,
      why: 'not-asked',
    });
    expect(shouldFetchPlans({ record: record(40 * 86_400_000), reason: 'opened', hasLicence: false }, NOW).fetch).toBe(
      false,
    );
  });

  it('a press with nothing stored, or a list that is not fresh, asks', () => {
    expect(shouldFetchPlans({ record: undefined, reason: 'person', hasLicence: false }, NOW)).toEqual({ fetch: true });
    expect(shouldFetchPlans({ record: record(2 * 86_400_000), reason: 'person', hasLicence: false }, NOW)).toEqual({
      fetch: true,
    });
  });

  it('a fresh list is shown, not asked again — on a press or on `opened`', () => {
    expect(shouldFetchPlans({ record: record(HOUR), reason: 'person', hasLicence: false }, NOW)).toEqual({
      fetch: false,
      why: 'fresh',
    });
    expect(shouldFetchPlans({ record: record(HOUR), reason: 'opened', hasLicence: true }, NOW)).toEqual({
      fetch: false,
      why: 'fresh',
    });
  });

  it('freshness keeps the server’s maxAge within 1 h … 7 days', () => {
    expect(
      shouldFetchPlans({ record: record(30 * MINUTE, { failures: 0 }, 1), reason: 'opened', hasLicence: true }, NOW)
        .fetch,
    ).toBe(false);
    expect(
      shouldFetchPlans(
        { record: record(8 * 86_400_000, { failures: 0 }, 1e9), reason: 'opened', hasLicence: true },
        NOW,
      ).fetch,
    ).toBe(true);
  });

  it('a press within 60 s of the last request is refused with when it may come', () => {
    expect(
      shouldFetchPlans(
        { record: record(undefined, { failures: 1, last: NOW - 10_000 }), reason: 'person', hasLicence: false },
        NOW,
      ),
    ).toEqual({
      fetch: false,
      why: 'button-limit',
      notBefore: NOW + 50_000,
    });
    expect(
      shouldFetchPlans(
        { record: record(undefined, { failures: 1, last: NOW - MINUTE }), reason: 'person', hasLicence: false },
        NOW,
      ).fetch,
    ).toBe(true);
  });

  it('a Retry-After ahead refuses everyone, the press too', () => {
    const held = record(undefined, {
      failures: 1,
      last: NOW - HOUR,
      retryAfter: NOW + MINUTE,
      retryCause: 'server-busy',
    });
    expect(shouldFetchPlans({ record: held, reason: 'person', hasLicence: true }, NOW)).toEqual({
      fetch: false,
      why: 'retry-after',
      notBefore: NOW + MINUTE,
    });
  });

  it('`opened` with a licence: after failures it waits 5 min, doubling up to 6 h', () => {
    const after = (failures: number, ago: number) =>
      shouldFetchPlans(
        { record: record(undefined, { failures, last: NOW - ago }), reason: 'opened', hasLicence: true },
        NOW,
      );
    expect(after(0, 0)).toEqual({ fetch: true });
    expect(after(1, 4 * MINUTE).fetch).toBe(false);
    expect(after(1, 5 * MINUTE).fetch).toBe(true);
    expect(after(3, 19 * MINUTE)).toEqual({ fetch: false, why: 'backoff', notBefore: NOW + MINUTE });
    expect(after(20, 6 * HOUR - 1).fetch).toBe(false);
    expect(after(20, 6 * HOUR).fetch).toBe(true);
  });

  it('plansBackoffMs', () => {
    expect([0, 1, 2, 3, 7, 8, 50].map(plansBackoffMs)).toEqual([0, 5, 10, 20, 320, 360, 360].map(m => m * MINUTE));
  });
});
