/**
 * One Hash or Verify off the page's thread (docs/tools/specs/password-hash.md §5.9): the page starts a worker per piece
 * of work and terminates it after the answer, so the wasm memory (up to 1 GiB) goes with it; Cancel is the same
 * terminate. Loaded from this file by runner.ts — never from `blob:` or `data:`. The password arrives in the message
 * and lives here until the worker ends; nothing is logged.
 */
import { runJob } from '@workspace/tool-logic-password-hash';
import type { Job, JobResult } from '@workspace/tool-logic-password-hash';

export type PasswordHashRequest = Job;
export type PasswordHashReply = JobResult;

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PasswordHashRequest>) => void) | null;
  postMessage: (reply: PasswordHashReply) => void;
};

scope.onmessage = ({ data }) => {
  void runJob(data).then(reply => scope.postMessage(reply));
};
