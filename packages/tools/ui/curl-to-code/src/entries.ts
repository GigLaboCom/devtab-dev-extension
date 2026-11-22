/**
 * The cURL to Code tool's history entries (schema 1), loaded with the component. A record holds the command as typed
 * and the code (blobs: up to 16 MiB each) and, in its payload, the language. The kind is secret (history.ts): the whole
 * record is sealed — label and blobs included — so the label may name the method and the host.
 */
import { isTarget, targetInfo } from '@workspace/tool-logic-curl-to-code';
import type { Target } from '@workspace/tool-logic-curl-to-code';
import type { HistoryDraft } from '@workspace/tools-host';

export interface CurlEntryPayload {
  target: Target;
}

/** "POST api.example.com → Python (requests)": the method and the host of the command, and the language. */
export const entryLabel = (command: string, target: Target): string => {
  // The first 4 KiB only, and no pattern that backtracks over a long run (a body of megabytes has no '://').
  const head = command.slice(0, 4096);
  const method = /(?:^|\s)(?:-X|--request)\s*['"]?([A-Za-z]+)/.exec(head)?.[1]?.toUpperCase();
  const scheme = head.indexOf('://');
  const host = scheme < 0 ? undefined : /^([^/\s'"^?#]+)/.exec(head.slice(scheme + 3))?.[1];
  const what = [method, host].filter(Boolean).join(' ') || 'curl';
  return `${what} → ${targetInfo(target).label}`;
};

export const draftOf = (command: string, target: Target, code: string): HistoryDraft => ({
  kind: 'converted',
  payload: { target },
  label: entryLabel(command, target),
  blobs: { command: new Blob([command]), code: new Blob([code]) },
});

/** The payload of schema 1, or undefined when it is not one. */
export const readPayload = (value: unknown): CurlEntryPayload | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const target = (value as Record<string, unknown>).target;
  return isTarget(target) ? { target } : undefined;
};
