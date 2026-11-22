/**
 * One piece of work as the tool's worker runs it (docs/tools/specs/password-hash.md §5.9): a Hash or a Verify, its
 * time, or why it failed in words. Plain data in and out, so it crosses `postMessage` as it is.
 */
import { hashPassword, verifyPassword } from './compute';
import { failureMessage } from './messages';
import { parseHash } from './parse';
import type { HashRequest } from './compute';

export type Job =
  { op: 'hash'; request: HashRequest } | { op: 'verify'; password: string; hash: string; secret?: string };
export type JobResult =
  | { ok: true; op: 'hash'; encoded: string; ms: number }
  | { ok: true; op: 'verify'; match: boolean; ms: number }
  | { ok: false; message: string };

const now = (): number => (typeof performance === 'undefined' ? Date.now() : performance.now());

export const runJob = async (job: Job): Promise<JobResult> => {
  const began = now();
  try {
    if (job.op === 'hash') {
      const encoded = await hashPassword(job.request);
      return { ok: true, op: 'hash', encoded, ms: now() - began };
    }
    const parsed = parseHash(job.hash);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    const match = await verifyPassword(job.password, parsed.hash, job.secret);
    return { ok: true, op: 'verify', match, ms: now() - began };
  } catch (error) {
    return { ok: false, message: failureMessage(error) };
  }
};
