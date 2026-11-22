/**
 * The X.509 tool's history entries (D17): a draft is made only from certificates that were read — each written again
 * by `toPem` — so nothing else of the input (a private key pasted with them, text around the blocks, an opened file's
 * other bytes) can reach the history. Reading an entry back gives that PEM text.
 */
import { toPem } from '@workspace/tool-logic-x509';
import type { Certificate } from '@workspace/tool-logic-x509';
import type { HistoryDraft } from '@workspace/tools-host';

export interface X509Payload {
  count: number;
  /** An opened file's name and size; the file itself is not kept, its certificates are. */
  file?: { name: string; size: number };
}

/** `www.example.com`, `www.example.com and 2 more`. */
export const labelOf = (certificates: Certificate[]): string =>
  `${certificates[0]!.subject.display}${certificates.length > 1 ? ` and ${certificates.length - 1} more` : ''}`;

/** What History's search finds: the subjects, the issuers and the DNS names. */
const searchText = (certificates: Certificate[]): string =>
  certificates
    .flatMap(c => [
      c.subject.rfc4514,
      c.issuer.rfc4514,
      ...c.extensions
        .filter(e => e.oid === '2.5.29.17' && e.value.kind === 'text')
        .flatMap(e => (e.value.kind === 'text' ? e.value.lines : [])),
    ])
    .join('\n')
    .slice(0, 2000);

export const draftOf = (certificates: Certificate[], file?: { name: string; size: number }): HistoryDraft => ({
  kind: 'read',
  payload: { count: certificates.length, ...(file ? { file } : {}) } satisfies X509Payload,
  label: labelOf(certificates),
  text: searchText(certificates),
  blobs: { certificates: new Blob([certificates.map(c => toPem(c.der)).join('')], { type: 'application/x-pem-file' }) },
});

export const readPayload = (payload: unknown): X509Payload | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Partial<X509Payload>;
  if (typeof p.count !== 'number') return undefined;
  const file =
    p.file && typeof p.file.name === 'string' && typeof p.file.size === 'number'
      ? { name: p.file.name, size: p.file.size }
      : undefined;
  return { count: p.count, ...(file ? { file } : {}) };
};
