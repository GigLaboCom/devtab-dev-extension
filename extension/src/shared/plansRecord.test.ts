/** The record `plans` as the pages read it, and how fresh its list is (pro-plans §4.6, §8.1). */
import { freshness, readPlansRecord } from './plansRecord';
import { describe, expect, it } from 'vitest';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('readPlansRecord', () => {
  it('no record → none', () => {
    expect(readPlansRecord(undefined)).toBe('none');
    expect(readPlansRecord(null)).toBe('none');
  });

  it('a record of this shape is read; unknown extra fields are left out', () => {
    const record = {
      v: 1,
      fetchedAt: 1000,
      body: { v: 1, plans: [] },
      failure: { at: 2000, why: 'offline' },
      attempts: { last: 2000, failures: 1, retryAfter: 3000, retryCause: 'server-busy' },
      extra: true,
    };
    const read: Record<string, unknown> = { ...record };
    delete read.extra;
    expect(readPlansRecord(record)).toEqual(read);
    expect(readPlansRecord({ v: 1, attempts: { failures: 0 } })).toEqual({ v: 1, attempts: { failures: 0 } });
  });

  it.each([
    ['another v', { v: 2, attempts: { failures: 0 } }],
    ['no v', { attempts: { failures: 0 } }],
    ['not an object', 'plans'],
    ['an array', [{ v: 1 }]],
    ['no attempts', { v: 1 }],
    ['failures not a whole number', { v: 1, attempts: { failures: 0.5 } }],
    ['fetchedAt a string', { v: 1, fetchedAt: 'today', attempts: { failures: 0 } }],
    ['a failure with an unknown reason', { v: 1, failure: { at: 1, why: 'gone' }, attempts: { failures: 1 } }],
    ['an unknown retry cause', { v: 1, attempts: { failures: 1, retryCause: 'later' } }],
  ])('%s → unreadable', (_name, raw) => {
    expect(readPlansRecord(raw)).toBe('unreadable');
  });
});

describe('freshness', () => {
  const at = 1_800_000_000_000;
  const maxAge = DAY;

  it('exactly fetchedAt → fresh; maxAge − 1 ms → fresh; exactly maxAge → stale', () => {
    expect(freshness(at, maxAge, at)).toBe('fresh');
    expect(freshness(at, maxAge, at + maxAge - 1)).toBe('fresh');
    expect(freshness(at, maxAge, at + maxAge)).toBe('stale');
  });

  it('30 days − 1 ms → stale; exactly 30 days → expired', () => {
    expect(freshness(at, maxAge, at + 30 * DAY - 1)).toBe('stale');
    expect(freshness(at, maxAge, at + 30 * DAY)).toBe('expired');
  });

  it('now before fetchedAt (the clock put back) → stale: the record’s time cannot be trusted', () => {
    expect(freshness(at, maxAge, at - 1)).toBe('stale');
    expect(freshness(at, maxAge, at - 400 * DAY)).toBe('stale');
  });
});
