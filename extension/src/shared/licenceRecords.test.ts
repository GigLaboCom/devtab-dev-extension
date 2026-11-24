/** The record `entitlement` as the pages read it: none, unreadable, or the record — a bad clock mark counts as 0. */
import { readEntitlement } from './licenceRecords';
import { describe, expect, it } from 'vitest';

const RECORD = { v: 1, inst: 'q3V2mZ0bTEST0000000000', token: 'a.b.c', seen: 1_000 };

describe('readEntitlement', () => {
  it('no record is none', () => {
    expect(readEntitlement(undefined)).toBe('none');
    expect(readEntitlement(null)).toBe('none');
  });

  it.each([
    ['a string', 'a.b.c'],
    ['an array', [RECORD]],
    ['another version', { ...RECORD, v: 2 }],
    ['no version', { inst: RECORD.inst, token: RECORD.token, seen: 0 }],
    ['no token', { v: 1, inst: RECORD.inst, seen: 0 }],
    ['a token that is not text', { ...RECORD, token: 42 }],
    ['no installation', { v: 1, token: RECORD.token, seen: 0 }],
  ])('%s is unreadable', (_what, raw) => {
    expect(readEntitlement(raw)).toBe('unreadable');
  });

  it('a record of this shape is read; extra fields are ignored', () => {
    expect(readEntitlement({ ...RECORD, later: true })).toEqual(RECORD);
  });

  it.each([
    ['missing', undefined],
    ['text', '5'],
    ['negative', -1],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
  ])('a clock mark that is %s counts as 0', (_what, seen) => {
    expect(readEntitlement({ ...RECORD, seen })).toEqual({ ...RECORD, seen: 0 });
  });
});
