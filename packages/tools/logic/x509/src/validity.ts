/**
 * The validity period (docs/tools/specs/x509.md §5.4): the status at `now` (both bounds included), its words, the
 * period in days. Relative times are the shared rule (jwt.md §5.6, @workspace/tools-shared/time).
 */
import { formatIsoUtc, formatReadable, relativeTime } from '@workspace/tools-shared/time';
import type { CertTime } from './certificate';

export type ValidityStatus =
  | { kind: 'valid'; until: number | null }
  | { kind: 'expired'; at: number }
  | { kind: 'not-yet'; at: number }
  | { kind: 'unknown' };

export const validityStatus = (notBefore: CertTime, notAfter: CertTime, nowMs: number): ValidityStatus => {
  if (!notBefore.date || !notAfter.date) return { kind: 'unknown' };
  const from = notBefore.date.getTime();
  const to = notAfter.date.getTime();
  if (nowMs < from) return { kind: 'not-yet', at: from };
  if (!notAfter.noExpiry && nowMs > to) return { kind: 'expired', at: to };
  return { kind: 'valid', until: notAfter.noExpiry ? null : to };
};

/** `Valid: expires in 23 years`, `Expired 10 months ago`, `Not valid yet: starts in 3 years`; none when unknown. */
export const validityText = (status: ValidityStatus, nowMs: number): string | undefined => {
  switch (status.kind) {
    case 'valid':
      return status.until === null
        ? 'Valid: no expiration date'
        : `Valid: expires ${relativeTime(status.until, nowMs)}`;
    case 'expired':
      return `Expired ${relativeTime(status.at, nowMs)}`;
    case 'not-yet':
      return `Not valid yet: starts ${relativeTime(status.at, nowMs)}`;
    case 'unknown':
      return undefined;
  }
};

/** `floor((notAfter − notBefore) / 86 400 000)` days: `366 days`, `1 day`; none when a time is not valid. */
export const validityPeriod = (notBefore: CertTime, notAfter: CertTime): string | undefined => {
  if (!notBefore.date || !notAfter.date) return undefined;
  const days = Math.floor((notAfter.date.getTime() - notBefore.date.getTime()) / 86_400_000);
  return `${days} ${Math.abs(days) === 1 ? 'day' : 'days'}`;
};

/** One time in three lines (§5.4): ISO 8601 UTC, the browser's local form, relative to `now`; none when not valid. */
export const timeLines = (
  time: CertTime,
  nowMs: number,
  timeZone?: string,
  locale?: string,
): { iso: string; local: string | null; relative: string } | undefined => {
  if (!time.date) return undefined;
  const ms = time.date.getTime();
  return {
    iso: formatIsoUtc(BigInt(ms) * 1_000_000n),
    local: formatReadable(ms, timeZone, locale),
    relative: relativeTime(ms, nowMs),
  };
};
