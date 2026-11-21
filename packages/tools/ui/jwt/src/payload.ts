/**
 * The JWT tool's history payload (schema 1) and its labels, loaded with the component (not with the definition). A
 * record holds the token as typed, what the tool made of it, and — kind `checked` — the key field as typed. Both kinds
 * are secret (history.ts): the whole record is sealed, label included, so the label may name the algorithm and the result.
 */
import type { SecretFormat, Verification } from '@workspace/tool-logic-jwt';
import type { HistoryDraft } from '@workspace/tools-host';

export type KeyField = { field: 'secret'; format: SecretFormat; text: string } | { field: 'public'; text: string };

/** Payload of schema 1. */
export type JwtPayload = {
  token: string;
  kind: 'jws' | 'jwe';
  alg?: string;
  /** The signature's state when it was recorded. */
  signature: Verification['state'];
  key?: KeyField;
};

const FORMATS: readonly SecretFormat[] = ['text', 'base64', 'hex', 'jwk'];

const STATE_WORDS: Record<Verification['state'], string> = {
  'no-key': 'signature not verified',
  valid: 'signature verified',
  invalid: 'signature does not match',
  'cannot-verify': 'cannot verify',
  unsecured: 'unsecured',
};

/** "HS256 · signature verified"; a JWE: "JWE · dir". */
export const entryLabel = (p: JwtPayload): string =>
  p.kind === 'jwe' ? `JWE · ${p.alg ?? 'no alg'}` : `${p.alg ?? 'No alg'} · ${STATE_WORDS[p.signature]}`;

export const draftOf = (p: JwtPayload): HistoryDraft => ({
  kind: p.key ? 'checked' : 'decoded',
  payload: p as unknown as HistoryDraft['payload'],
  label: entryLabel(p),
});

/** A payload of schema 1 read back, or undefined when it is not one. */
export const readPayload = (value: unknown): JwtPayload | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const p = value as Record<string, unknown>;
  if (typeof p.token !== 'string' || (p.kind !== 'jws' && p.kind !== 'jwe')) return undefined;
  if (p.alg !== undefined && typeof p.alg !== 'string') return undefined;
  if (typeof p.signature !== 'string' || !(p.signature in STATE_WORDS)) return undefined;
  const k = p.key as Record<string, unknown> | undefined;
  let key: KeyField | undefined;
  if (k !== undefined) {
    if (typeof k !== 'object' || k === null || typeof k.text !== 'string') return undefined;
    if (k.field === 'public') key = { field: 'public', text: k.text };
    else if (k.field === 'secret' && FORMATS.includes(k.format as SecretFormat))
      key = { field: 'secret', format: k.format as SecretFormat, text: k.text };
    else return undefined;
  }
  return {
    token: p.token,
    kind: p.kind,
    ...(p.alg !== undefined ? { alg: p.alg as string } : {}),
    signature: p.signature as Verification['state'],
    ...(key ? { key } : {}),
  };
};
