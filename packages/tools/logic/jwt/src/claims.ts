/**
 * The claims of a payload (docs/tools/specs/jwt.md §5.6, §5.8): the times `exp`, `nbf`, `iat` as NumericDates and the
 * status they give now, and the rows of the claims table. Instants are written by the shared time module only
 * (`formatIsoUtc`, `formatReadable`, `relativeTime` of @workspace/tools-shared/time).
 */
import { isObject } from './decode';
import { formatIsoUtc, formatReadable, relativeTime } from '@workspace/tools-shared/time';

/** 9999-12-31T23:59:59Z and 0001-01-01T00:00:00Z in seconds: a NumericDate outside is "Out of range" (§5.6). */
export const MAX_NUMERIC_DATE = 253_402_300_799;
export const MIN_NUMERIC_DATE = -62_135_596_800;

export const NOT_NUMERIC_DATE = 'Not a NumericDate (RFC 7519 §2)';
export const OUT_OF_RANGE = 'Out of range';

export type ClaimTime = {
  name: 'exp' | 'nbf' | 'iat';
  value: unknown;
  /** Undefined when not a NumericDate or out of range. */
  date?: Date;
  /** Out of range, but the value read as milliseconds is not. */
  millisecondsHint?: Date;
};

const TIME_NAMES = new Set(['exp', 'nbf', 'iat']);
const inRange = (seconds: number): boolean => seconds >= MIN_NUMERIC_DATE && seconds <= MAX_NUMERIC_DATE;
/** Seconds (maybe fractional) → a Date at whole milliseconds. */
const dateOf = (seconds: number): Date => new Date(Math.round(seconds * 1000));

/** The time claims of a payload, in the payload's order; none when the payload is not a claims set. */
export const timeClaims = (payload: unknown): ClaimTime[] => {
  if (!isObject(payload)) return [];
  const out: ClaimTime[] = [];
  for (const [name, value] of Object.entries(payload)) {
    if (!TIME_NAMES.has(name)) continue;
    const claim: ClaimTime = { name: name as ClaimTime['name'], value };
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (inRange(value)) claim.date = dateOf(value);
      else if (inRange(value / 1000)) claim.millisecondsHint = dateOf(value / 1000);
    }
    out.push(claim);
  }
  return out;
};

export type TimeStatus =
  | { kind: 'expired'; at: number }
  | { kind: 'not-yet'; at: number }
  | { kind: 'valid'; until?: number }
  | { kind: 'no-expiry' }
  // `exp` or `nbf` is there but is no date (not a NumericDate, or out of range): no status is shown (§5.6)
  | { kind: 'unknown' };

/**
 * The status the times give at `nowMs` (§5.6), exact to the millisecond, no allowance for clock skew: expired when
 * now ≥ exp (RFC 7519 §4.1.4), not yet when now < nbf (§4.1.5); `issuedInFuture` when iat > now.
 */
export const timeStatus = (claims: ClaimTime[], nowMs: number): { status: TimeStatus; issuedInFuture: boolean } => {
  const find = (name: ClaimTime['name']) => claims.find(c => c.name === name);
  const exp = find('exp');
  const nbf = find('nbf');
  const iat = find('iat');
  const issuedInFuture = !!iat?.date && iat.date.getTime() > nowMs;
  if ((exp && !exp.date) || (nbf && !nbf.date)) return { status: { kind: 'unknown' }, issuedInFuture };
  const expMs = exp?.date?.getTime();
  const nbfMs = nbf?.date?.getTime();
  if (expMs !== undefined && nowMs >= expMs) return { status: { kind: 'expired', at: expMs }, issuedInFuture };
  if (nbfMs !== undefined && nowMs < nbfMs) return { status: { kind: 'not-yet', at: nbfMs }, issuedInFuture };
  if (expMs !== undefined) return { status: { kind: 'valid', until: expMs }, issuedInFuture };
  return { status: nbfMs !== undefined ? { kind: 'valid' } : { kind: 'no-expiry' }, issuedInFuture };
};

/** "now" of the shared module, as a phrase after a verb: "just now". */
const relative = (tMs: number, nowMs: number): string => {
  const text = relativeTime(tMs, nowMs);
  return text === 'now' ? 'just now' : text;
};

/** The status line of §5.6, and the addition about `iat`; undefined when there is no status. */
export const timeStatusText = ({ status }: { status: TimeStatus }, nowMs: number): string | undefined => {
  switch (status.kind) {
    case 'expired':
      return `Expired ${relative(status.at, nowMs)}`;
    case 'not-yet':
      return `Not valid yet: starts ${relative(status.at, nowMs)}`;
    case 'valid': {
      if (status.until === undefined) return 'No expiry (no "exp" claim)';
      // "in 25 minutes" of the shared module → "25 minutes"; under a second it says "now".
      const ahead = relativeTime(status.until, nowMs);
      return ahead.startsWith('in ') ? `Valid for ${ahead.slice(3)} more` : 'Valid for less than a second more';
    }
    case 'no-expiry':
      return 'No expiry (no "exp" claim)';
    case 'unknown':
      return undefined;
  }
};
export const ISSUED_IN_FUTURE = 'Issued in the future';

/** The three lines of a time claim (§5.6): ISO 8601 UTC, the local time, the relative time; or why there are none. */
export const timeLines = (
  claim: ClaimTime,
  nowMs: number,
  timeZone?: string,
): { iso: string; local: string | null; relative: string } | { message: string; hint?: string } => {
  if (!claim.date) {
    if (typeof claim.value !== 'number' || !Number.isFinite(claim.value)) return { message: NOT_NUMERIC_DATE };
    return claim.millisecondsHint
      ? { message: OUT_OF_RANGE, hint: `Looks like milliseconds: ${isoOf(claim.millisecondsHint)}` }
      : { message: OUT_OF_RANGE };
  }
  const ms = claim.date.getTime();
  const past = ms <= nowMs;
  const rel = relative(ms, nowMs);
  const phrase =
    claim.name === 'exp'
      ? `${past ? 'expired' : 'expires'} ${rel}`
      : claim.name === 'nbf'
        ? `${past ? 'started' : 'starts'} ${rel}`
        : `issued ${rel}`;
  return { iso: isoOf(claim.date), local: formatReadable(ms, timeZone), relative: phrase };
};

/** "2025-11-19T13:00:00Z", milliseconds only when they are not zero (formatIsoUtc: the shortest exact fraction). */
export const isoOf = (date: Date): string => formatIsoUtc(BigInt(date.getTime()) * 1_000_000n);

export type ClaimRow = {
  name: string;
  /** The registered claim's meaning (RFC 7519 §4.1); absent for others. */
  label?: string;
  /** One line: a registered string as is, `aud` joined with ", ", others as JSON with numbers as written. */
  value: string;
  /** For `exp`, `nbf`, `iat`. */
  time?: ClaimTime;
};

const LABELS: Record<string, string> = {
  iss: 'Issuer',
  sub: 'Subject',
  aud: 'Audience',
  exp: 'Expires',
  nbf: 'Not before',
  iat: 'Issued at',
  jti: 'Token ID',
};
export const CLAIM_VALUE_MAX = 200;

const oneLine = (raw: unknown): string => {
  const text = JSON.stringify(raw) ?? String(raw);
  return text.length > CLAIM_VALUE_MAX ? `${text.slice(0, CLAIM_VALUE_MAX)}…` : text;
};

/** The claims table (§5.8): the payload's members in its order. `json` is the plain value, `raw` keeps number sources. */
export const claimRows = (json: unknown, raw: unknown): ClaimRow[] => {
  if (!isObject(json) || !isObject(raw)) return [];
  const times = new Map(timeClaims(json).map(t => [t.name as string, t]));
  return Object.keys(json).map(name => {
    const value = json[name];
    const label = Object.hasOwn(LABELS, name) ? LABELS[name] : undefined;
    const shown =
      label && typeof value === 'string'
        ? value
        : name === 'aud' && Array.isArray(value) && value.every(v => typeof v === 'string')
          ? value.join(', ')
          : oneLine(raw[name]);
    const clipped = shown.length > CLAIM_VALUE_MAX ? `${shown.slice(0, CLAIM_VALUE_MAX)}…` : shown;
    return { name, ...(label ? { label } : {}), value: clipped, ...(times.has(name) ? { time: times.get(name) } : {}) };
  });
};
