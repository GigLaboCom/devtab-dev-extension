/**
 * The Key Pairs tool's history entries (D17; specification §11): a draft holds only public material — the public key
 * text (`publicOnly`: OpenSSH lines stay lines, JWK stays JWK without private members, PEM becomes SPKI PEM, a private
 * key becomes its public key) and the parameters. Built from keys the logic read and completed, never from the input,
 * so a pasted private key cannot reach the history.
 */
import { describe, publicOnly } from '@workspace/tool-logic-keys';
import type { Algorithm, ReadKey, RsaJwkAlg, RsaSize } from '@workspace/tool-logic-keys';
import type { HistoryDraft } from '@workspace/tools-host';

export interface GeneratedPayload {
  algorithm: Algorithm;
  size?: RsaSize;
  rsaAlg?: RsaJwkAlg;
  addKid: boolean;
  comment: string;
  /** The public key: the OpenSSH line (with its comment), or SPKI PEM for X25519. */
  publicText: string;
  fingerprint: string;
}

export interface InspectedPayload {
  /** The public-only text of the keys read (the field gets it back). */
  publicText: string;
  count: number;
  /** Whether a private key was read (its public key is what is kept). */
  fromPrivate: boolean;
  fingerprint: string;
}

const fingerprintOf = (fp: { sha256: string | null; spkiBase64: string }): string =>
  fp.sha256 ?? `SPKI SHA-256 ${fp.spkiBase64}`;

export const generatedDraft = (
  key: ReadKey,
  options: { algorithm: Algorithm; size: RsaSize; rsaAlg: RsaJwkAlg; addKid: boolean },
  fp: { sha256: string | null; spkiBase64: string },
): HistoryDraft => {
  const fingerprint = fingerprintOf(fp);
  const payload: GeneratedPayload = {
    algorithm: options.algorithm,
    ...(options.algorithm === 'RSA' ? { size: options.size, rsaAlg: options.rsaAlg } : {}),
    addKid: options.addKid,
    comment: key.comment ?? '',
    publicText: publicOnly([key]),
    fingerprint,
  };
  return {
    kind: 'generated',
    payload: payload as unknown as HistoryDraft['payload'],
    label: `${describe(key)} · ${fingerprint}`,
    text: `${payload.publicText}\n${fingerprint}`.slice(0, 2000),
  };
};

export const inspectedDraft = (
  keys: readonly ReadKey[],
  fp: { sha256: string | null; spkiBase64: string },
): HistoryDraft => {
  const fingerprint = fingerprintOf(fp);
  const payload: InspectedPayload = {
    publicText: publicOnly(keys),
    count: keys.length,
    fromPrivate: keys.some(k => (k.data.type === 'rsa' ? !!k.data.priv : !!k.data.d)),
    fingerprint,
  };
  const more = keys.length > 1 ? ` and ${keys.length - 1} more` : '';
  return {
    kind: 'inspected',
    payload: payload as unknown as HistoryDraft['payload'],
    label: `${describe(keys[0]!)}${more} · ${fingerprint}`,
    text: `${payload.publicText}\n${fingerprint}`.slice(0, 2000),
  };
};

/** An entry's public text and, for a generated pair, its settings; undefined when it cannot be read. */
export const readEntry = (
  kind: string,
  payload: unknown,
): { publicText: string; generated?: Pick<GeneratedPayload, 'algorithm' | 'size' | 'rsaAlg'> } | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Partial<GeneratedPayload & InspectedPayload>;
  if (typeof p.publicText !== 'string') return undefined;
  if (kind !== 'generated') return { publicText: p.publicText };
  return {
    publicText: p.publicText,
    generated: {
      algorithm: p.algorithm ?? 'Ed25519',
      ...(p.size ? { size: p.size } : {}),
      ...(p.rsaAlg ? { rsaAlg: p.rsaAlg } : {}),
    },
  };
};
